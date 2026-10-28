// Low-poly instanced asset kit. Units are metres; forward = +x.
// Vertex alpha 255 = tinted by instance colour; 254 = fixed colour; 3 = glows at night.
import { MeshBuilder } from '../engine/mesh';
import { hex } from '../engine/math';

const TINT = hex(0xffffff, 255);
const fixed = (c: number) => hex(c, 254);
const glow = (c: number) => hex(c, 3);

export function carMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0.18, 0.85, 4.1, 1.75, 0, TINT);                 // body
  m.box(-0.25, 0, 0.85, 1.42, 2.2, 1.55, 0, fixed(0x2a3038));    // cabin glass
  m.box(-0.25, 0, 1.42, 1.48, 2.0, 1.45, 0, TINT);               // roof
  m.box(2.04, 0.55, 0.55, 0.75, 0.06, 0.35, 0, glow(0xfff2c0));  // headlights
  m.box(2.04, -0.55, 0.55, 0.75, 0.06, 0.35, 0, glow(0xfff2c0));
  m.box(-2.04, 0.6, 0.6, 0.8, 0.06, 0.3, 0, glow(0xff2a1a));     // tail lights
  m.box(-2.04, -0.6, 0.6, 0.8, 0.06, 0.3, 0, glow(0xff2a1a));
  for (const [x, z] of [[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]]) m.box(x, z, 0, 0.5, 0.6, 0.22, 0, fixed(0x1a1a1a));
  return m;
}

export function bikeMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0.0, 0.55, 1.8, 0.14, 0, fixed(0x1d1f22));         // wheels/frame
  m.box(0.05, 0, 0.35, 0.8, 1.2, 0.42, 0, fixed(0x5a6068));      // scooter body
  m.box(-0.15, 0, 0.8, 1.42, 0.36, 0.5, 0, TINT);                // rider (shirt)
  m.box(-0.15, 0, 1.42, 1.68, 0.26, 0.26, 0, fixed(0x3a3c40));   // helmet
  m.box(0.92, 0, 0.7, 0.85, 0.05, 0.16, 0, glow(0xfff2c0));      // headlight
  m.box(-0.92, 0, 0.55, 0.65, 0.05, 0.12, 0, glow(0xff2a1a));
  return m;
}

export function autoMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0.15, 0.95, 2.7, 1.35, 0, fixed(0x1c1d1f));        // black body (Pune autos)
  m.box(-0.2, 0, 0.95, 1.72, 1.9, 1.38, 0, fixed(0x23262a));      // open sides (dark)
  m.box(0.05, 0, 1.72, 1.85, 2.4, 1.42, 0, TINT);                 // yellow canopy
  m.box(1.0, 0, 0.95, 1.72, 0.1, 1.2, 0, TINT);                   // front windscreen frame
  m.box(1.36, 0, 0.6, 0.78, 0.05, 0.25, 0, glow(0xfff2c0));
  m.box(-1.36, 0, 0.5, 0.65, 0.05, 0.9, 0, glow(0xff2a1a));
  return m;
}

export function busMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0.35, 1.25, 11.6, 2.5, 0, TINT);                    // lower body
  m.box(0, 0, 1.25, 2.55, 11.4, 2.45, 0, glow(0xb8d0d8));         // window band (lit at night)
  m.box(0, 0, 2.55, 3.15, 11.6, 2.5, 0, TINT);                    // upper body
  m.box(5.82, 0.85, 0.7, 1.0, 0.05, 0.4, 0, glow(0xfff2c0));
  m.box(5.82, -0.85, 0.7, 1.0, 0.05, 0.4, 0, glow(0xfff2c0));
  for (const x of [3.8, -3.6]) for (const z of [1.1, -1.1]) m.box(x, z, 0, 0.95, 1.0, 0.3, 0, fixed(0x1a1a1a));
  return m;
}

export function personMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0, 0.85, 0.24, 0.34, 0, fixed(0x2e3440));           // legs
  m.box(0, 0, 0.85, 1.45, 0.28, 0.44, 0, TINT);                   // torso (clothes)
  m.box(0, 0, 1.45, 1.7, 0.22, 0.22, 0, fixed(0x8a5a3c));         // head
  return m;
}

/** Low-poly tree: trunk + faceted crown. Unit height ≈ 1 → scale per instance. */
export function treeMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0, 0.42, 0.07, 0.07, 0, fixed(0x5b4632));
  const cx = 0, cy = 0.64, r = 0.36, rings = 4, segs = 7;
  const verts: [number, number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2 + (i % 2) * 0.45;
      const wob = 1 + ((i * 7 + j * 3) % 5) * 0.04;
      verts.push([cx + Math.sin(phi) * Math.cos(th) * r * wob, cy + Math.cos(phi) * r * 0.85, Math.sin(phi) * Math.sin(th) * r * wob]);
    }
  }
  const tri = (a: number[], b: number[], c: number[]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const mx = (a[0] + b[0] + c[0]) / 3 - cx, my = (a[1] + b[1] + c[1]) / 3 - cy, mz = (a[2] + b[2] + c[2]) / 3;
    if (nx * mx + ny * my + nz * mz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const i0 = m.vertex(a[0], a[1], a[2], nx, ny, nz, TINT);
    m.vertex(b[0], b[1], b[2], nx, ny, nz, TINT);
    m.vertex(c[0], c[1], c[2], nx, ny, nz, TINT);
    m.tri(i0, i0 + 1, i0 + 2);
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = verts[i * segs + j], b = verts[i * segs + ((j + 1) % segs)];
      const c = verts[(i + 1) * segs + j], d = verts[(i + 1) * segs + ((j + 1) % segs)];
      tri(a, b, d);
      tri(a, d, c);
    }
  }
  return m;
}

export function busStopMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 2.4, 2.55, 4.2, 1.8, 0, TINT);                      // roof
  m.box(-1.9, -0.7, 0, 2.4, 0.1, 0.1, 0, fixed(0x6b7075));
  m.box(1.9, -0.7, 0, 2.4, 0.1, 0.1, 0, fixed(0x6b7075));
  m.box(0, -0.8, 0.3, 2.3, 4.0, 0.05, 0, glow(0x9fb7c4));         // back panel (lit at night)
  m.box(0, -0.4, 0.45, 0.55, 3.2, 0.45, 0, fixed(0x8a8f94));      // bench
  return m;
}

export function streetLightMesh(): MeshBuilder {
  const m = new MeshBuilder();
  m.box(0, 0, 0, 7, 0.14, 0.14, 0, fixed(0x70757a));
  m.box(0.7, 0, 6.8, 7.0, 1.6, 0.2, 0, fixed(0x70757a));
  m.box(1.3, 0, 6.65, 6.8, 0.6, 0.3, 0, glow(0xfff0c8));
  return m;
}
