// CPU-side mesh building + GPU upload.
// Vertex layout (28 bytes): position f32x3, normal f32x3, color unorm8x4 (alpha = material id).
export const VERTEX_STRIDE = 28;
const WORDS = 7;

export class MeshBuilder {
  f32: Float32Array;
  u32: Uint32Array;
  idx: Uint32Array;
  vCount = 0;
  iCount = 0;

  constructor(vCap = 1024, iCap = 2048) {
    const buf = new ArrayBuffer(vCap * VERTEX_STRIDE);
    this.f32 = new Float32Array(buf);
    this.u32 = new Uint32Array(buf);
    this.idx = new Uint32Array(iCap);
  }

  private growV(n: number) {
    if ((this.vCount + n) * WORDS <= this.f32.length) return;
    let cap = this.f32.length / WORDS;
    while (cap < this.vCount + n) cap *= 2;
    const buf = new ArrayBuffer(cap * VERTEX_STRIDE);
    new Uint32Array(buf).set(this.u32.subarray(0, this.vCount * WORDS));
    this.f32 = new Float32Array(buf);
    this.u32 = new Uint32Array(buf);
  }

  private growI(n: number) {
    if (this.iCount + n <= this.idx.length) return;
    let cap = this.idx.length;
    while (cap < this.iCount + n) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.idx.subarray(0, this.iCount));
    this.idx = next;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, color: number): number {
    this.growV(1);
    const o = this.vCount * WORDS;
    this.f32[o] = x; this.f32[o + 1] = y; this.f32[o + 2] = z;
    this.f32[o + 3] = nx; this.f32[o + 4] = ny; this.f32[o + 5] = nz;
    this.u32[o + 6] = color;
    return this.vCount++;
  }

  tri(a: number, b: number, c: number) {
    this.growI(3);
    this.idx[this.iCount++] = a; this.idx[this.iCount++] = b; this.idx[this.iCount++] = c;
  }

  /** Quad from 4 corners (in order around), flat normal. */
  quad(
    ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number, color: number,
  ) {
    const i = this.vertex(ax, ay, az, nx, ny, nz, color);
    this.vertex(bx, by, bz, nx, ny, nz, color);
    this.vertex(cx, cy, cz, nx, ny, nz, color);
    this.vertex(dx, dy, dz, nx, ny, nz, color);
    this.tri(i, i + 1, i + 2);
    this.tri(i, i + 2, i + 3);
  }

  /** Axis-aligned-ish box centred at (x, y0..y1, z), rotated by yaw around Y. */
  box(x: number, z: number, y0: number, y1: number, sx: number, sz: number, yaw: number, color: number, topColor = color) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = sx / 2, hz = sz / 2;
    const P = (lx: number, lz: number): [number, number] => [x + lx * c - lz * s, z + lx * s + lz * c];
    const p = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
    this.quad(p[0][0], y1, p[0][1], p[1][0], y1, p[1][1], p[2][0], y1, p[2][1], p[3][0], y1, p[3][1], 0, 1, 0, topColor);
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      let nx = b[1] - a[1], nz = -(b[0] - a[0]);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      // ensure outward
      const mx = (a[0] + b[0]) / 2 - x, mz = (a[1] + b[1]) / 2 - z;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      this.quad(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1], nx, 0, nz, color);
    }
  }

  clear() { this.vCount = 0; this.iCount = 0; }
}

export class GpuMesh {
  vbuf: GPUBuffer | null = null;
  ibuf: GPUBuffer | null = null;
  indexCount = 0;
  private vCap = 0;
  private iCap = 0;

  constructor(private device: GPUDevice, public label = 'mesh') {}

  upload(mb: MeshBuilder) {
    const vBytes = mb.vCount * VERTEX_STRIDE;
    const iBytes = mb.iCount * 4;
    if (vBytes > this.vCap) {
      this.vbuf?.destroy();
      this.vCap = Math.max(256, Math.ceil(vBytes * 1.25 / 4) * 4);
      this.vbuf = this.device.createBuffer({ label: this.label + '.v', size: this.vCap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (iBytes > this.iCap) {
      this.ibuf?.destroy();
      this.iCap = Math.max(256, Math.ceil(iBytes * 1.25 / 4) * 4);
      this.ibuf = this.device.createBuffer({ label: this.label + '.i', size: this.iCap, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    }
    if (vBytes) this.device.queue.writeBuffer(this.vbuf!, 0, mb.f32.buffer, 0, vBytes);
    if (iBytes) this.device.queue.writeBuffer(this.ibuf!, 0, mb.idx.buffer, 0, iBytes);
    this.indexCount = mb.iCount;
  }
}

/** Instance layout (32 bytes): pos f32x3 + yaw f32, scale f32x3, color unorm8x4. */
export const INSTANCE_STRIDE = 32;

export class InstanceGroup {
  data: Float32Array;
  u32: Uint32Array;
  count = 0;
  buffer: GPUBuffer;
  dirty = true;
  private cap: number;

  constructor(private device: GPUDevice, public mesh: GpuMesh, cap = 1024, public castShadow = true) {
    this.cap = cap;
    this.data = new Float32Array(cap * 8);
    this.u32 = new Uint32Array(this.data.buffer);
    this.buffer = device.createBuffer({ size: cap * INSTANCE_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  reset() { this.count = 0; this.dirty = true; }

  push(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, color: number) {
    if (this.count >= this.cap) this.grow();
    const o = this.count * 8;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw;
    d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = sz;
    this.u32[o + 7] = color;
    this.count++;
    this.dirty = true;
  }

  private grow() {
    this.cap *= 2;
    const next = new Float32Array(this.cap * 8);
    next.set(this.data);
    this.data = next;
    this.u32 = new Uint32Array(next.buffer);
    this.buffer.destroy();
    this.buffer = this.device.createBuffer({ size: this.cap * INSTANCE_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  upload() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.count) this.device.queue.writeBuffer(this.buffer, 0, this.data.buffer, 0, this.count * INSTANCE_STRIDE);
  }
}
