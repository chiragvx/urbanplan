// Stress for the CAD booleans (docs/plans/pro-design-freedom.md §3.6): radically different base shapes, each with many
// parts of all four booleans at random sizes, turns, places and floor ranges, laid out and built as the shaded view
// builds them. Checked on every floor against an oracle that applies the same booleans in order with the ground
// library, and the shaded mesh for throwing, NaN and bare cut faces. Seeded, so a failure reproduces.
import * as THREE from 'three';
import { layForm, sampleCurve, type Form } from '../../src/pro/form';
import { ccw } from '../../src/pro/form/curve';
import { mpOf } from '../../src/pro/form/shape';
import { buildForm, type Look } from '../../src/pro/form/mesh';
import { massForm, shapePlan, ellipseCurve, type MassShape } from '../../src/pro/masses';
import { shapePart, turnedPart, movedPart } from '../../src/pro/parts';
import { area, diff, inter, union, type MP } from '../../src/doc/ground';
import { opOf, type Carve, type Curve, type PartOp } from '../../src/pro/form/types';

// (the mesh paints a few small textures on a canvas: a stand-in for one, since node has no document)
const ctx2d = new Proxy({}, { get: (_, k) => (k === 'getImageData' || k === 'createImageData' ? (w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, +w) * Math.max(1, +h) * 4), width: w, height: h }) : k === 'measureText' ? () => ({ width: 0 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d, toDataURL: () => '' }) };

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; if (!c || process.env.VERBOSE) console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); return c; };
const say = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const ctx = { floorH: 3, mix: [0.3, 0.5, 0.2] as [number, number, number], sizes: [42, 65, 95] as [number, number, number] };
const lay = (f: Form) => layForm({ id: 't', spine: [0, 0, 1, 0], depth: 20, floors: f.uses.reduce((s, u) => s + u.floors, 0), form: f } as never, ctx);

// a seeded random
let seed = 1;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

// the bases: the Design shapes, and some radically different ones
const star = (n: number, R: number, r: number): Curve => ({ pts: Array.from({ length: n * 2 }, (_, k) => { const a = (k / (n * 2)) * Math.PI * 2, q = k % 2 ? r : R; return [Math.cos(a) * q, Math.sin(a) * q] as [number, number]; }) });
const comb: Curve = { pts: [[0, 0], [60, 0], [60, 30], [52, 30], [52, 8], [44, 8], [44, 30], [36, 30], [36, 8], [28, 8], [28, 30], [20, 30], [20, 8], [12, 8], [12, 30], [0, 30]] };
const bar: Curve = { pts: [[0, 0], [90, 0], [90, 9], [0, 9]] };
const ring = (R: number, r: number, n = 24): Curve => ({ pts: [...ellipseCurve(R * 2, R * 2, n).pts, ...ellipseCurve(r * 2, r * 2, n).pts.reverse()] }); // a C, nearly closed
const zig: Curve = { pts: [[0, 0], [20, 0], [30, 15], [40, 0], [60, 0], [45, 25], [60, 50], [40, 50], [30, 35], [20, 50], [0, 50], [15, 25]] };
const BASES: [string, Curve][] = [
  ...(['box', 'round', 'L', 'U', 'wedge'] as MassShape[]).map((s) => [s, shapePlan(s).plan] as [string, Curve]),
  ['star', star(7, 30, 14)], ['comb', comb], ['bar', bar], ['zigzag', zig], ['big ellipse', ellipseCurve(80, 36, 24)],
];
const PART_SHAPES: MassShape[] = ['box', 'round', 'L', 'U', 'wedge'];
const OPS: PartOp[] = ['add', 'cut', 'keep', 'xor'];

const bbox = (c: Curve) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of c.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const scaled = (c: Carve, k: number): Carve => { const b = bbox(c.ring), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; return { ...c, ring: { ...c.ring, pts: c.ring.pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k] as [number, number]) } }; };

/** n random parts on f: ops drawn from `ops`, each a shape at a random place over the plan, sized, turned, on a range */
function randomParts(f: Form, n: number, floors: number, ops: PartOp[]): Carve[] {
  const b = bbox(f.plan), out: Carve[] = [];
  for (let i = 0; i < n; i++) {
    const op = pick(ops), at: [number, number] = [b.x0 + rnd() * (b.x1 - b.x0), b.z0 + rnd() * (b.z1 - b.z0)];
    let c = shapePart(f, pick(PART_SHAPES), op, at);
    c = scaled(c, 0.15 + rnd() * (op === 'keep' ? 2.5 : 0.7));
    c = turnedPart(c, Math.round(rnd() * 24) * 15);
    if (rnd() < 0.2) c = movedPart(c, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4); // off the half-metre grid
    const lo = 1 + Math.floor(rnd() * floors), hi = rnd() < 0.4 ? floors : lo + Math.floor(rnd() * (floors - lo + 1));
    const face = op === 'cut' ? pick(['skin', 'glass', 'open'] as const) : 'glass';
    out.push({ ...c, id: `p${i}`, lo, hi, face, ...(rnd() < 0.08 ? { off: true } : {}) });
  }
  return out;
}

/** the oracle: the plan, then each part on that floor in order, by the ground library directly */
function oracle(f: Form, level: number): MP {
  const smp = (c: Curve) => mpOf(ccw(sampleCurve(c, 1.5)));
  let s: MP = union(smp(f.plan));
  const on = f.carves.filter((c) => !c.off && c.ring.pts.length >= 3 && level + 1 >= Math.min(c.lo!, c.hi!) && level + 1 <= Math.max(c.lo!, c.hi!));
  for (const c of on) {
    const m = smp(c.ring), op = opOf(c);
    s = op === 'add' ? union(s, m) : op === 'cut' ? diff(s, m) : op === 'keep' ? inter(s, m) : union(diff(s, m), diff(m, s));
  }
  return s;
}

const look: Look = {
  wall: '#cfc8bb', glass: '#5d7a8c', accent: '#8a8478', frame: '#3a3a3a', slab: '#d8d4cc', roof: '#9a958c', base: '#b5ad9f', core: '#a7a39b',
  skin: { pattern: 'balconies', spacing: 1.2, depth: 1.2, angle: 0, grade: 0, slabEdge: true, glass: 0.4 } as Look['skin'],
  roofKind: { kind: 'flat', pitch: 20, overhang: 0.6, dir: 0, parapet: 1 } as Look['roofKind'], round: 0.3,
};
/** builds it as the shaded view does; the count of NaN positions and of triangles */
function built(L: NonNullable<ReturnType<typeof lay>>, xray: number | null) {
  const B = buildForm(L, look, { xray, frame: { u: [1, 0], n: [0, 1] }, shell: null, env: null });
  let nan = 0, tris = 0;
  B.group.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (!g?.attributes?.position) return;
    const a = g.attributes.position.array; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nan++; break; }
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return { nan, tris };
}

const t0 = Date.now();
let layouts = 0, floorsChecked = 0, worst = 0, worstAt = '';
const PATTERNS = ['balconies', 'fins', 'curtain', 'grid', 'louvres', 'diagrid', 'screen', 'bands'] as const;
for (const [name, plan] of BASES) {
  for (const [label, n, ops] of [['cuts only', 12, ['cut']], ['all four', 16, OPS], ['many', 40, OPS], ['adds and cuts', 25, ['add', 'cut']]] as [string, number, PartOp[]][]) {
    for (let rep = 0; rep < 3; rep++) {
      seed = (name.length * 7919 + n * 104729 + rep * 31 + label.length) >>> 0;
      const floors = 4 + Math.floor(rnd() * 14);
      const f0 = massForm(plan, [], floors, 'residential');
      const f: Form = { ...f0, carves: randomParts(f0, n, floors, ops) };
      const at = `${name}, ${label} ×${n} (rep ${rep}, ${floors} floors)`;
      let L: ReturnType<typeof lay> = null;
      try { L = lay(f); } catch (err) { ok(false, `${at}: lays out without throwing (${(err as Error).message})`); continue; }
      if (!ok(!!L && L.floors.length === floors, `${at}: laid out, every floor`)) continue;
      layouts++;
      for (let k = 0; k < floors; k++) {
        const fl = L!.floors[k], o = area(oracle(f, k));
        floorsChecked++;
        ok(Number.isFinite(fl.area) && fl.area >= 0, `${at}, floor ${k + 1}: a sane area (${fl.area})`);
        ok(fl.rings.every((r) => r.length >= 6 && r.every(Number.isFinite)), `${at}, floor ${k + 1}: its rings are whole`);
        const err = Math.abs(fl.area - o), tol = Math.max(3, o * 0.02);
        if (err > worst) { worst = err; worstAt = `${at}, floor ${k + 1}: ${Math.round(fl.area)} vs ${Math.round(o)}`; }
        ok(err <= tol, `${at}, floor ${k + 1}: ${Math.round(fl.area)} m² as the booleans in order make it (${Math.round(o)})`);
        // (a cut faced with the skin leaves no cut face; an open one only under a floor)
        ok(fl.cuts.every((c) => c.face === 'glass' || c.face === 'open'), `${at}, floor ${k + 1}: no skin cut drawn as a cut face`);
      }
      look.skin = { ...look.skin, pattern: PATTERNS[(layouts + rep) % PATTERNS.length] } as Look['skin'];
      for (const xr of [null, Math.max(1, Math.floor(floors / 2))]) {
        try { const r = built(L!, xr); const some = L!.floors.slice(0, xr ?? floors).some((q) => q.area > 1);
          ok(r.nan === 0 && (r.tris > 0 || !some), `${at}: built ${xr === null ? 'whole' : `X-rayed to floor ${xr}`} (${r.tris} triangles, ${r.nan} with NaN)`); }
        catch (err) { ok(false, `${at}: builds as the shaded view does (${(err as Error).stack?.split('\n').slice(0, 3).join(' ')})`); }
      }
    }
  }
}
const ms = Date.now() - t0;
say(layouts === BASES.length * 12, `${layouts} layouts of ${BASES.length} base shapes, up to 40 parts each, all laid out and built`);
say(bad === 0, `${floorsChecked} floors each match the booleans applied in order (worst ${worst.toFixed(1)} m²: ${worstAt})`);
say(ms < 60000, `in ${(ms / 1000).toFixed(1)} s`);

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
