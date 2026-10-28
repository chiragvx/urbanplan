// WGSL shaders. One lighting model for everything: sun + hemisphere + PCF shadows + fog.
// Material id is carried in vertex color alpha:
//   255 plain · 1 building wall (procedural windows) · 2 water · 3 glass/emissive-at-night · 4 road marking · 5 unlit highlight
const common = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  lightViewProj: mat4x4f,
  camPos: vec4f,       // xyz, w = shadow texel size
  sunDir: vec4f,       // xyz toward sun, w = time (s)
  sunColor: vec4f,     // rgb, w = night factor 0..1
  skyColor: vec4f,     // rgb, w = fog density
  groundColor: vec4f,  // rgb, w = unused
  fogColor: vec4f,     // rgb, w = unused
};
@group(0) @binding(0) var<uniform> u: U;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
};

fn toLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
`;

const lighting = /* wgsl */ `
@group(0) @binding(1) var shadowTex: texture_depth_2d;
@group(0) @binding(2) var shadowSamp: sampler_comparison;

fn hash3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453); }

fn shadowAt(world: vec3f, n: vec3f) -> f32 {
  let lp = u.lightViewProj * vec4f(world + n * 0.25, 1.0);
  let ndc = lp.xyz / lp.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) { return 1.0; }
  let ts = u.camPos.w;
  // 4 bilinear comparison taps ≈ 4x4 PCF footprint, cheap on integrated GPUs
  let z = ndc.z - 0.0008;
  var s = textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(-0.75, -0.75) * ts, z);
  s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(0.75, -0.75) * ts, z);
  s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(-0.75, 0.75) * ts, z);
  s += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(0.75, 0.75) * ts, z);
  return s * 0.25;
}

fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment
fn fsMain(v: VOut) -> @location(0) vec4f {
  var n = normalize(v.normal);
  var albedo = toLinear(v.color.rgb);
  let mat = u32(round(v.color.a * 255.0));
  let t = u.sunDir.w;
  let night = u.sunColor.w;
  var emissive = vec3f(0.0);
  var spec = 0.0;

  if (mat == 5u) { return vec4f(v.color.rgb, 1.0); }

  if (mat == 1u && abs(n.y) < 0.5) {
    // Procedural windows on building walls
    let tng = vec2f(-n.z, n.x);
    let uu = dot(v.world.xz, tng);
    let fy = fract(v.world.y / 3.2);
    let fx = fract(uu / 2.6);
    let cell = floor(vec3f(uu / 2.6, v.world.y / 3.2, dot(v.world.xz, n.xz)));
    if (v.world.y > 1.2 && fy > 0.32 && fy < 0.78 && fx > 0.22 && fx < 0.78) {
      albedo = toLinear(vec3f(0.24, 0.30, 0.36));
      spec = 0.35;
      let lit = step(0.52, hash3(cell));
      emissive = toLinear(vec3f(1.0, 0.80, 0.52)) * lit * night * 1.6;
    } else if (fy < 0.07) {
      albedo *= 0.82; // floor slab line
    }
  } else if (mat == 2u) {
    let w = v.world.xz;
    n = normalize(vec3f(sin(w.x * 0.21 + t * 1.1) * 0.06 + sin(w.y * 0.37 - t * 0.7) * 0.04, 1.0,
                        cos(w.y * 0.19 + t * 0.9) * 0.06 + cos(w.x * 0.31 + t * 1.3) * 0.04));
    spec = 0.9;
  } else if (mat == 3u) {
    emissive = albedo * night * 2.2;
  }

  let sh = shadowAt(v.world, n);
  let ndl = max(dot(n, u.sunDir.xyz), 0.0);
  let hemi = mix(u.groundColor.rgb, u.skyColor.rgb, n.y * 0.5 + 0.5);
  var col = albedo * (hemi * 0.62 + u.sunColor.rgb * ndl * sh) + emissive;

  if (spec > 0.0) {
    let vdir = normalize(u.camPos.xyz - v.world);
    let h = normalize(vdir + u.sunDir.xyz);
    col += u.sunColor.rgb * pow(max(dot(n, h), 0.0), 60.0) * spec * sh;
    let fres = pow(1.0 - max(dot(n, vdir), 0.0), 4.0);
    col = mix(col, u.skyColor.rgb, fres * spec * 0.5);
  }

  let d = distance(v.world, u.camPos.xyz);
  let fogAmt = 1.0 - exp(-pow(d * u.skyColor.w, 1.6));
  col = mix(col, u.fogColor.rgb, clamp(fogAmt, 0.0, 1.0));
  col = aces(col * 1.05);
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}
`;

const staticVS = /* wgsl */ `
@vertex
fn vsStatic(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec4f) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.world = p;
  o.normal = n;
  o.color = c;
  return o;
}
`;

const instFn = /* wgsl */ `
fn instXform(p: vec3f, ip: vec4f, isc: vec3f) -> vec3f {
  let c = cos(ip.w); let s = sin(ip.w);
  let q = p * isc;
  return vec3f(q.x * c - q.z * s, q.y, q.x * s + q.z * c) + ip.xyz;
}
fn instNormal(n: vec3f, ip: vec4f, isc: vec3f) -> vec3f {
  let c = cos(ip.w); let s = sin(ip.w);
  let m = n / isc;
  return normalize(vec3f(m.x * c - m.z * s, m.y, m.x * s + m.z * c));
}
`;

const instVS = /* wgsl */ `
${instFn}
@vertex
fn vsInst(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec4f,
          @location(3) ip: vec4f, @location(4) isc: vec3f, @location(5) icol: vec4f) -> VOut {
  var o: VOut;
  let w = instXform(p, ip, isc);
  o.pos = u.viewProj * vec4f(w, 1.0);
  o.world = w;
  o.normal = instNormal(n, ip, isc);
  // vertex alpha 255 → tinted by instance color; other alpha → material passthrough
  let tinted = c.a > 0.99;
  o.color = select(c, vec4f(c.rgb * icol.rgb, icol.a), tinted);
  return o;
}
`;

export const MAIN_SHADER = common + lighting + staticVS + instVS;

export const SHADOW_SHADER = common + instFn + /* wgsl */ `
@vertex
fn vsStaticShadow(@location(0) p: vec3f) -> @builtin(position) vec4f {
  return u.lightViewProj * vec4f(p, 1.0);
}
@vertex
fn vsInstShadow(@location(0) p: vec3f, @location(3) ip: vec4f, @location(4) isc: vec3f) -> @builtin(position) vec4f {
  return u.lightViewProj * vec4f(instXform(p, ip, isc), 1.0);
}
`;
