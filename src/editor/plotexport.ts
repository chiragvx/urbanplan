// Plot sandbox exports: the plot, its building and the site around it (ground, roads, neighbouring buildings) for
// CAD and 3D tools. DXF (plan layers plus the massing as 3D faces), OBJ (vertex colours) and glTF binary. Metres,
// from the plot's centre and the ground there; DXF has Y north.
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import { UNIT_COLOR, UNIT_LABEL, type SiteReport } from '../doc/site';
import type { PlotReport } from '../doc/plot';
import { hex, prismTris, type Box } from '../build/prism';

export type ExportFormat = 'dxf' | 'obj' | 'glb';

/** a named mesh (triangles, a colour per vertex), and named plan outlines */
interface Part { name: string; pos: number[]; col: number[] }
interface Outline { layer: string; ring: number[]; closed: boolean }

const SITE = 60;

export function exportPlot(E: Editor, id: Id, fmt: ExportFormat) {
  const o = E.doc.get<'plot'>(id), r = E.plot.report(id), d = E.plot.layout(id);
  if (!o || !r) return;
  const { parts, outlines, origin } = gather(E, o.ring, r, d);
  const name = (o.name || 'plot').replace(/[^\w-]+/g, '-').toLowerCase();
  const [lat, lon] = E.app.toLatLon(origin[0], origin[1]);
  const note = `UrbanPlan plot sandbox: ${o.name}. Metres from ${lat.toFixed(6)}, ${lon.toFixed(6)} at ${(origin[2] + E.hf.base).toFixed(1)} m above sea level.`;
  if (fmt === 'dxf') save(`${name}.dxf`, dxf(parts, outlines, note), 'application/dxf');
  else if (fmt === 'obj') save(`${name}.obj`, obj(parts, note), 'text/plain');
  else save(`${name}.glb`, glb(parts), 'model/gltf-binary');
}

/** Everything to export, in metres from the plot's centre (y up from the ground there). */
function gather(E: Editor, plot: number[], r: PlotReport, d: SiteReport | null) {
  let cx = 0, cz = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const R = r.net.length >= 6 ? r.net : r.footprint;
  for (let i = 0; i < R.length; i += 2) { cx += R[i]; cz += R[i + 1]; x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, R[i + 1]); z1 = Math.max(z1, R[i + 1]); }
  cx /= R.length / 2; cz /= R.length / 2;
  const g = (x: number, z: number) => E.hf.sample(x, z);
  const y0 = g(cx, cz);
  const loc = (ring: number[]) => { const out: number[] = []; for (let i = 0; i < ring.length; i += 2) out.push(ring[i] - cx, ring[i + 1] - cz); return out; };
  const parts: Part[] = [], outlines: Outline[] = [];
  const add = (name: string, boxes: Box[], floors = true) => { if (!boxes.length) return; const t = prismTris(boxes.map((b) => ({ ...b, ring: loc(b.ring) })), floors); parts.push({ name, ...t }); };

  // the site: the ground as a grid, the roads, the buildings around
  const X0 = x0 - SITE, Z0 = z0 - SITE;
  const step = 4, nx = Math.ceil((x1 - x0 + 2 * SITE) / step), nz = Math.ceil((z1 - z0 + 2 * SITE) / step);
  const ground: Part = { name: 'ground', pos: [], col: [] };
  const gc = hex('#cfd3c4');
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const ax = X0 + i * step, az = Z0 + j * step, bx = ax + step, bz = az + step;
    const q = [[ax, az], [bx, az], [bx, bz], [ax, bz]].map(([x, z]) => [x - cx, g(x, z) - y0 - 0.05, z - cz]);
    ground.pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
    for (let k = 0; k < 6; k++) ground.col.push(...gc);
  }
  parts.push(ground);
  const near = E.hit.query(X0, Z0, X0 + nx * step, Z0 + nz * step);
  const roads: Part = { name: 'roads', pos: [], col: [] }, rc = hex('#4b4f58');
  const nbr: Box[] = [], bc = hex('#e4e1da');
  for (const id of near) {
    const s = E.doc.get(id);
    if (s?.kind === 'section' && !s.tunnel) {
      const sg = E.C.geo(id);
      if (!sg) continue;
      const P = sg.pts, N = sg.nrm, L: number[] = [], Rr: number[] = [];
      for (let k = 0; k < P.length; k += 2) {
        L.push(P[k] + N[k] * sg.t.hwL, P[k + 1] + N[k + 1] * sg.t.hwL);
        Rr.push(P[k] - N[k] * sg.t.hwR, P[k + 1] - N[k + 1] * sg.t.hwR);
      }
      for (let k = 0; k + 3 < P.length; k += 2) {
        const a = [L[k], L[k + 1]], b = [L[k + 2], L[k + 3]], c = [Rr[k + 2], Rr[k + 3]], e = [Rr[k], Rr[k + 1]];
        const v = [a, b, c, e].map(([x, z]) => [x - cx, g(x, z) - y0 + (s.elevated ? 0 : 0.05), z - cz]);
        roads.pos.push(...v[0], ...v[2], ...v[1], ...v[0], ...v[3], ...v[2]);
        for (let q = 0; q < 6; q++) roads.col.push(...rc);
      }
      outlines.push({ layer: 'ROAD-EDGE', ring: loc(L), closed: false }, { layer: 'ROAD-EDGE', ring: loc(Rr), closed: false });
      outlines.push({ layer: 'ROAD-CENTRE', ring: loc(Array.from(P)), closed: false });
    } else if (s?.kind === 'building' && s.outer.length >= 6) {
      let b = Infinity;
      for (let i = 0; i < s.outer.length; i += 2) b = Math.min(b, g(s.outer[i], s.outer[i + 1]));
      nbr.push({ ring: s.outer, y0: b - y0 + (s.minH || 0), y1: b - y0 + Math.max(3, s.h || 0), color: bc });
      outlines.push({ layer: 'CONTEXT-BUILDINGS', ring: loc(s.outer), closed: true });
    }
  }
  if (roads.pos.length) parts.push(roads);
  add('neighbours', nbr);

  // the plot
  outlines.push({ layer: 'PLOT', ring: loc(plot), closed: true });
  if (r.lostRing.length >= 6) outlines.push({ layer: 'DP-ROAD-STRIP', ring: loc(r.lostRing), closed: true });
  const env = d?.envelope.length ? d.envelope : r.footprint;
  if (env.length >= 6) outlines.push({ layer: 'ENVELOPE', ring: loc(env), closed: true });
  if (!d?.buildings.length) return { parts, outlines, origin: [cx, cz, y0] as [number, number, number] };

  // the buildings, from the lowest ground under the envelope
  let base = Infinity;
  for (let i = 0; i < env.length; i += 2) base = Math.min(base, g(env[i], env[i + 1]));
  base -= y0;
  const fh = r.rules.floorH, B = d.buildings;
  const under: Box[] = [], grey = hex('#b9bec9');
  for (let k = 0; k < d.under; k++) for (const w of d.site.stilt && k === 0 ? B.flatMap((b) => b.quads) : [d.envelope]) under.push({ ring: w, y0: base + k * fh, y1: base + (k + 1) * fh, color: grey });
  add('parking-levels', under);
  const floors = (b: (typeof B)[number], rings: number[][], color: [number, number, number]) => b.floors ? rings.flatMap((ring) => Array.from({ length: b.floors }, (_, f) => ({ ring, y0: base + (d.under + f) * fh, y1: base + (d.under + f + 1) * fh, color }))) : [];
  for (const t of [0, 1, 2, 3] as const) {
    const tag = UNIT_LABEL[t].replace(' ', '');
    add(`flats-${tag.toLowerCase()}`, B.flatMap((b) => floors(b, b.units.filter((u) => u.t === t).map((u) => u.ring), hex(UNIT_COLOR[t]))));
    for (const b of B) for (const u of b.units) if (u.t === t) outlines.push({ layer: `FLATS-${tag.toUpperCase()}`, ring: loc(u.ring), closed: true });
  }
  const cg = hex('#6b7280');
  add('cores', B.flatMap((b) => b.cores.map((c) => ({ ring: c, y0: base, y1: base + b.height + 2.5, color: cg }))));
  add('corridors', B.flatMap((b) => floors(b, b.corridors, hex('#d9dce3'))));
  for (const b of B) {
    for (const q of b.quads) outlines.push({ layer: 'BUILDING', ring: loc(q), closed: true });
    for (const c of b.cores) outlines.push({ layer: 'CORES', ring: loc(c), closed: true });
  }
  let nb = 0, np = 0;
  for (const l of d.parking.levels) {
    const layer = `PARKING-${l.kind === 'stilt' ? 'STILT' : l.kind === 'surface' ? 'SURFACE' : l.kind === 'podium' ? `P${++np}` : `B${++nb}`}`;
    for (const b of l.bays) outlines.push({ layer, ring: loc(b), closed: true });
    if (l.ramp) outlines.push({ layer, ring: loc(l.ramp), closed: true });
  }
  return { parts, outlines, origin: [cx, cz, y0] as [number, number, number] };
}

// ---------------- writers ----------------

export function save(name: string, data: string | ArrayBuffer, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** DXF R12: plan outlines on layers (Y north) and the meshes as 3D faces. */
function dxf(parts: Part[], outlines: Outline[], note: string): string {
  const out: string[] = [];
  const w = (...kv: (string | number)[]) => { for (const v of kv) out.push(String(v)); };
  const layers = [...new Set([...outlines.map((o) => o.layer), ...parts.map((p) => `3D-${p.name.toUpperCase()}`)])];
  w(999, note);
  w(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.length);
  layers.forEach((l, i) => w(0, 'LAYER', 2, l, 70, 0, 62, (i % 7) + 1, 6, 'CONTINUOUS'));
  w(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  for (const o of outlines) {
    if (o.ring.length < 4) continue;
    w(0, 'POLYLINE', 8, o.layer, 66, 1, 70, o.closed ? 1 : 0);
    for (let i = 0; i < o.ring.length; i += 2) w(0, 'VERTEX', 8, o.layer, 10, f3(o.ring[i]), 20, f3(-o.ring[i + 1]), 30, 0);
    w(0, 'SEQEND', 8, o.layer);
  }
  for (const p of parts) {
    const layer = `3D-${p.name.toUpperCase()}`;
    for (let i = 0; i < p.pos.length; i += 9) {
      const v = (k: number) => [f3(p.pos[i + k * 3]), f3(-p.pos[i + k * 3 + 2]), f3(p.pos[i + k * 3 + 1])];
      const [a, b, c] = [v(0), v(1), v(2)];
      w(0, '3DFACE', 8, layer, 10, a[0], 20, a[1], 30, a[2], 11, b[0], 21, b[1], 31, b[2], 12, c[0], 22, c[1], 32, c[2], 13, c[0], 23, c[1], 33, c[2]);
    }
  }
  w(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n');
}

/** linear to sRGB, for OBJ's vertex colours */
const srgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055).toFixed(3);

/** Wavefront OBJ: an object per part, vertex colours (sRGB) after the positions. */
function obj(parts: Part[], note: string): string {
  const out = [`# ${note}`];
  let n = 1;
  for (const p of parts) {
    out.push(`o ${p.name}`);
    for (let i = 0; i < p.pos.length; i += 3) out.push(`v ${f3(p.pos[i])} ${f3(p.pos[i + 1])} ${f3(p.pos[i + 2])} ${srgb(p.col[i])} ${srgb(p.col[i + 1])} ${srgb(p.col[i + 2])}`);
    for (let i = 0; i < p.pos.length / 3; i += 3) out.push(`f ${n + i} ${n + i + 1} ${n + i + 2}`);
    n += p.pos.length / 3;
  }
  return out.join('\n');
}

/** glTF 2.0 binary: a mesh per part (positions, normals, vertex colours). */
function glb(parts: Part[]): ArrayBuffer {
  const chunks: Float32Array[] = [];
  const views: object[] = [], accessors: object[] = [], meshes: object[] = [], nodes: object[] = [];
  let offset = 0;
  const view = (a: Float32Array, min?: number[], max?: number[]) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: a.byteLength, target: 34962 });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: a.length / 3, type: 'VEC3', ...(min ? { min, max } : {}) });
    chunks.push(a);
    offset += a.byteLength;
    return accessors.length - 1;
  };
  for (const p of parts) {
    if (!p.pos.length) continue;
    const pos = new Float32Array(p.pos), nrm = new Float32Array(pos.length);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
      const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 9; k += 3) { nrm[i + k] = nx; nrm[i + k + 1] = ny; nrm[i + k + 2] = nz; }
    }
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    const P = view(pos, min, max), N = view(nrm), C = view(new Float32Array(p.col));
    meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: P, NORMAL: N, COLOR_0: C }, material: 0 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
  }
  const json = {
    asset: { version: '2.0', generator: 'UrbanPlan plot sandbox' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    buffers: [{ byteLength: offset }], bufferViews: views, accessors,
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(enc.length / 4) * 4;
  const total = 12 + 8 + jl + 8 + offset;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(enc, 20); for (let i = enc.length; i < jl; i++) u8[20 + i] = 0x20;
  dv.setUint32(20 + jl, offset, true); dv.setUint32(24 + jl, 0x004e4942, true);
  let o = 28 + jl;
  for (const c of chunks) { u8.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), o); o += c.byteLength; }
  return buf;
}
