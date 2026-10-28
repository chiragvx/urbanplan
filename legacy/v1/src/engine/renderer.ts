// Custom WebGPU renderer: shadow pass + 4x MSAA main pass, reversed-Z depth.
import { MAIN_SHADER, SHADOW_SHADER } from './shaders';
import { GpuMesh, InstanceGroup, VERTEX_STRIDE, INSTANCE_STRIDE } from './mesh';
import { mat4, type Mat4, type Vec3 } from './math';

const SHADOW_SIZE = 4096;
const MSAA = 4;

const vertexLayout: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'unorm8x4' },
  ],
};
const positionOnlyLayout: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
};
const instanceLayout: GPUVertexBufferLayout = {
  arrayStride: INSTANCE_STRIDE,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 3, offset: 0, format: 'float32x4' },
    { shaderLocation: 4, offset: 16, format: 'float32x3' },
    { shaderLocation: 5, offset: 28, format: 'unorm8x4' },
  ],
};

export interface FrameLighting {
  sunDir: Vec3;
  sunColor: Vec3;
  skyColor: Vec3;
  groundColor: Vec3;
  fogColor: Vec3;
  fogDensity: number;
  night: number;
  time: number;
}

export class Renderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  private staticPipe!: GPURenderPipeline;
  private instPipe!: GPURenderPipeline;
  private staticShadowPipe!: GPURenderPipeline;
  private instShadowPipe!: GPURenderPipeline;
  private uniformBuf!: GPUBuffer;
  private mainBG!: GPUBindGroup;
  private shadowBG!: GPUBindGroup;
  private shadowTex!: GPUTexture;
  private shadowView!: GPUTextureView;
  private msaaTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;
  private uniforms = new Float32Array(64);
  width = 1;
  height = 1;
  /** Render resolution multiplier (dynamic resolution). Clamped to device pixel ratio. */
  renderScale = 1;
  /** Set when static geometry changed so cached shadows must refresh. */
  shadowDirty = true;
  private lastShadow = { x: 1e9, z: 1e9, r: 0, sx: 0, sy: 0, sz: 0 };
  private lightVP: Mat4 = mat4.create();

  statics: GpuMesh[] = [];
  overlays: GpuMesh[] = []; // drawn without shadows (highlights, markings)
  instances: InstanceGroup[] = [];

  constructor(public canvas: HTMLCanvasElement) {}

  async init(): Promise<void> {
    if (!('gpu' in navigator)) throw new Error('WebGPU is not available in this browser. Try the latest Chrome or Edge.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

    const d = this.device;
    const mainModule = d.createShaderModule({ label: 'main', code: MAIN_SHADER });
    const shadowModule = d.createShaderModule({ label: 'shadow', code: SHADOW_SHADER });

    this.uniformBuf = d.createBuffer({ size: this.uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowTex = d.createTexture({
      size: [SHADOW_SIZE, SHADOW_SIZE],
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shadowView = this.shadowTex.createView();
    const shadowSampler = d.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });

    const mainBGL = d.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    const shadowBGL = d.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    this.mainBG = d.createBindGroup({
      layout: mainBGL,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuf } },
        { binding: 1, resource: this.shadowView },
        { binding: 2, resource: shadowSampler },
      ],
    });
    this.shadowBG = d.createBindGroup({ layout: shadowBGL, entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }] });

    const mainLayout = d.createPipelineLayout({ bindGroupLayouts: [mainBGL] });
    const shadowLayout = d.createPipelineLayout({ bindGroupLayouts: [shadowBGL] });

    const mainDepth: GPUDepthStencilState = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' };
    const shadowDepth: GPUDepthStencilState = {
      format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.5,
    };
    const prim: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' };
    const target = { format: this.format };

    this.staticPipe = d.createRenderPipeline({
      label: 'static',
      layout: mainLayout,
      vertex: { module: mainModule, entryPoint: 'vsStatic', buffers: [vertexLayout] },
      fragment: { module: mainModule, entryPoint: 'fsMain', targets: [target] },
      primitive: prim,
      depthStencil: mainDepth,
      multisample: { count: MSAA },
    });
    this.instPipe = d.createRenderPipeline({
      label: 'instanced',
      layout: mainLayout,
      vertex: { module: mainModule, entryPoint: 'vsInst', buffers: [vertexLayout, instanceLayout] },
      fragment: { module: mainModule, entryPoint: 'fsMain', targets: [target] },
      primitive: prim,
      depthStencil: mainDepth,
      multisample: { count: MSAA },
    });
    this.staticShadowPipe = d.createRenderPipeline({
      label: 'static-shadow',
      layout: shadowLayout,
      vertex: { module: shadowModule, entryPoint: 'vsStaticShadow', buffers: [positionOnlyLayout] },
      primitive: prim,
      depthStencil: shadowDepth,
    });
    this.instShadowPipe = d.createRenderPipeline({
      label: 'inst-shadow',
      layout: shadowLayout,
      vertex: { module: shadowModule, entryPoint: 'vsInstShadow', buffers: [positionOnlyLayout, instanceLayout] },
      primitive: prim,
      depthStencil: shadowDepth,
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.renderScale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (w === this.width && h === this.height && this.msaaTex) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.msaaTex?.destroy();
    this.depthTex?.destroy();
    this.msaaTex = this.device.createTexture({ size: [w, h], format: this.format, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    this.depthTex = this.device.createTexture({ size: [w, h], format: 'depth32float', sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  private lightMatrix(target: Vec3, radius: number, sunDir: Vec3): Mat4 {
    const dist = radius * 3;
    const eye: Vec3 = [target[0] + sunDir[0] * dist, target[1] + sunDir[1] * dist, target[2] + sunDir[2] * dist];
    const up: Vec3 = Math.abs(sunDir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4.lookAt(mat4.create(), eye, target, up);
    // Snap to shadow texels to avoid shimmering while the camera moves
    const texel = (radius * 2) / SHADOW_SIZE;
    const tx = view[12], ty = view[13];
    view[12] = Math.round(tx / texel) * texel;
    view[13] = Math.round(ty / texel) * texel;
    const proj = mat4.ortho(mat4.create(), -radius, radius, -radius, radius, 1, dist * 2);
    return mat4.multiply(mat4.create(), proj, view);
  }

  render(viewProj: Mat4, eye: Vec3, shadowFocus: Vec3, shadowRadius: number, L: FrameLighting) {
    const d = this.device;
    const u = this.uniforms;
    // Shadows are cached: only re-render when the view/sun moved enough or the world changed.
    const ls = this.lastShadow;
    const moved = Math.hypot(shadowFocus[0] - ls.x, shadowFocus[2] - ls.z) > shadowRadius * 0.08;
    const zoomed = Math.abs(shadowRadius - ls.r) > ls.r * 0.12;
    const sunMoved = Math.abs(L.sunDir[0] - ls.sx) + Math.abs(L.sunDir[1] - ls.sy) + Math.abs(L.sunDir[2] - ls.sz) > 0.004;
    const doShadow = this.shadowDirty || moved || zoomed || sunMoved;
    if (doShadow) {
      // Render a slightly larger area than needed so small pans don't expose the edge
      this.lightVP = this.lightMatrix(shadowFocus, shadowRadius * 1.15, L.sunDir);
      this.lastShadow = { x: shadowFocus[0], z: shadowFocus[2], r: shadowRadius, sx: L.sunDir[0], sy: L.sunDir[1], sz: L.sunDir[2] };
      this.shadowDirty = false;
    }
    u.set(viewProj, 0);
    u.set(this.lightVP, 16);
    u.set([eye[0], eye[1], eye[2], 1 / SHADOW_SIZE], 32);
    u.set([L.sunDir[0], L.sunDir[1], L.sunDir[2], L.time], 36);
    u.set([L.sunColor[0], L.sunColor[1], L.sunColor[2], L.night], 40);
    u.set([L.skyColor[0], L.skyColor[1], L.skyColor[2], L.fogDensity], 44);
    u.set([L.groundColor[0], L.groundColor[1], L.groundColor[2], 0], 48);
    u.set([L.fogColor[0], L.fogColor[1], L.fogColor[2], 0], 52);
    d.queue.writeBuffer(this.uniformBuf, 0, u);

    for (const g of this.instances) g.upload();

    const enc = d.createCommandEncoder();

    // Shadow pass (cached)
    if (doShadow) {
    const sp = enc.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: { view: this.shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    sp.setBindGroup(0, this.shadowBG);
    sp.setPipeline(this.staticShadowPipe);
    for (const m of this.statics) this.drawMesh(sp, m);
    sp.setPipeline(this.instShadowPipe);
    for (const g of this.instances) if (g.castShadow) this.drawInstances(sp, g);
    sp.end();
    }

    // Main pass
    // Clear to the same tone-mapped fog colour the shader converges to, so the horizon is seamless
    const tm = (x: number) => {
      x *= 1.05;
      const y = Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
      return Math.pow(y, 1 / 2.2);
    };
    const fog = L.fogColor;
    const mp = enc.beginRenderPass({
      colorAttachments: [{
        view: this.msaaTex!.createView(),
        resolveTarget: this.context.getCurrentTexture().createView(),
        clearValue: { r: tm(fog[0]), g: tm(fog[1]), b: tm(fog[2]), a: 1 },
        loadOp: 'clear',
        storeOp: 'discard',
      }],
      depthStencilAttachment: { view: this.depthTex!.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
    });
    mp.setBindGroup(0, this.mainBG);
    mp.setPipeline(this.staticPipe);
    for (const m of this.statics) this.drawMesh(mp, m);
    for (const m of this.overlays) this.drawMesh(mp, m);
    mp.setPipeline(this.instPipe);
    for (const g of this.instances) this.drawInstances(mp, g);
    mp.end();

    d.queue.submit([enc.finish()]);
  }

  private drawMesh(p: GPURenderPassEncoder, m: GpuMesh) {
    if (!m.indexCount || !m.vbuf || !m.ibuf) return;
    p.setVertexBuffer(0, m.vbuf);
    p.setIndexBuffer(m.ibuf, 'uint32');
    p.drawIndexed(m.indexCount);
  }

  private drawInstances(p: GPURenderPassEncoder, g: InstanceGroup) {
    if (!g.count || !g.mesh.indexCount) return;
    p.setVertexBuffer(0, g.mesh.vbuf!);
    p.setVertexBuffer(1, g.buffer);
    p.setIndexBuffer(g.mesh.ibuf!, 'uint32');
    p.drawIndexed(g.mesh.indexCount, g.count);
  }
}
