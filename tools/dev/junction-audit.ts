// Junction overlap audit: rasterises carriageways (kerb to kerb, after trims) and junction surfaces at 0.5 m
// around every junction and measures where two road surfaces cover the same ground.
import fs from 'node:fs';
import { Heightfield } from '../../src/geo/heightfield';
import { generateNetwork } from '../../src/net/generate';

type V2 = [number, number];
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const bin = fs.readFileSync(dir + 'tile.bin');
const sec = hdr.sections.find((s: any) => s.name === 'terrain');
const hf = new Heightfield(hdr.terrain.n, hdr.terrain.cell, new Float32Array(bin.buffer.slice(bin.byteOffset + sec.offset, bin.byteOffset + sec.offset + sec.length * 4)));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const m = generateNetwork(net, hf);

interface Shape { owner: string; poly: V2[]; x0: number; z0: number; x1: number; z1: number }
const bbox = (owner: string, poly: V2[]): Shape => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return { owner, poly, x0, z0, x1, z1 };
};

// carriageway quads per segment (ground level only — elevated decks legitimately cross roads)
const shapes: Shape[] = [];
const segOf = new Map<string, number>();
for (const g of m.geos) {
  if (g.s.elevated) continue;
  const s0 = g.trimA, s1 = g.len - g.trimB;
  if (s1 - s0 < 1.5) continue;
  const n = g.pts.length / 2;
  const at = (i: number, o: number): V2 => [g.pts[i * 2] + g.nrm[i * 2] * o, g.pts[i * 2 + 1] + g.nrm[i * 2 + 1] * o];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (g.cum[i] >= s0 && g.cum[i] <= s1) idx.push(i);
  if (idx.length < 2) continue;
  for (let k = 0; k < idx.length - 1; k++) {
    const i = idx[k], j = idx[k + 1];
    const q: V2[] = [at(i, g.t.cwL), at(j, g.t.cwL), at(j, -g.t.cwR), at(i, -g.t.cwR)];
    shapes.push(bbox('s' + g.s.id, q));
  }
  segOf.set('s' + g.s.id, g.s.id);
}
for (const j of m.junctions) shapes.push(bbox('j' + j.node, j.ring)); // (lifted ones too: excluded below)

// coarse grid index
const G = 50;
const grid = new Map<string, Shape[]>();
for (const sh of shapes) for (let gx = Math.floor(sh.x0 / G); gx <= Math.floor(sh.x1 / G); gx++) for (let gz = Math.floor(sh.z0 / G); gz <= Math.floor(sh.z1 / G); gz++) {
  const k = gx + ',' + gz; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(sh);
}
const inside = (P: V2[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

const deg = new Map<number, number>();
for (const s of net.segments) { deg.set(s.a, (deg.get(s.a) ?? 0) + 1); deg.set(s.b, (deg.get(s.b) ?? 0) + 1); }
const arms = new Map<number, Set<string>>();
for (const s of net.segments) for (const nd of [s.a, s.b]) { if (!arms.has(nd)) arms.set(nd, new Set()); arms.get(nd)!.add('s' + s.id); }

const C = 0.5;
const rows: any[] = [];
const lifted = new Set(net.nodes.filter((n: any) => n.lift > 0.25).map((n: any) => 'j' + n.id));
for (const sh of shapes) if (lifted.has(sh.owner)) sh.x1 = -Infinity; // elevated junctions legitimately sit over roads
for (const j of m.junctions) {
  const node = net.nodes[j.node];
  if (lifted.has('j' + j.node)) continue;
  const me = 'j' + j.node;
  const jb = shapes.find((s) => s.owner === me)!;
  const R = Math.max(jb.x1 - jb.x0, jb.z1 - jb.z0) / 2 + 25;
  const cx = (jb.x0 + jb.x1) / 2, cz = (jb.z0 + jb.z1) / 2;
  const near = new Set<Shape>();
  for (let gx = Math.floor((cx - R) / G); gx <= Math.floor((cx + R) / G); gx++) for (let gz = Math.floor((cz - R) / G); gz <= Math.floor((cz + R) / G); gz++) for (const s of grid.get(gx + ',' + gz) ?? []) near.add(s);
  const list = [...near];
  const myArms = arms.get(j.node)!;
  let area = 0, armOnJ = 0, otherOnJ = 0, jOnJ = 0, armArm = 0, other = 0;
  const culprits = new Map<string, number>();
  for (let x = cx - R; x < cx + R; x += C) for (let z = cz - R; z < cz + R; z += C) {
    const own = new Set<string>();
    for (const s of list) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && inside(s.poly, x, z)) own.add(s.owner);
    const inJ = own.has(me);
    if (inJ) area++;
    if (own.size < 2) continue;
    // only count overlaps touching this junction's neighbourhood (within its poly or its arms)
    const mine = inJ || [...own].some((o) => myArms.has(o));
    if (!mine) continue;
    for (const o of own) if (o !== me) culprits.set(o, (culprits.get(o) ?? 0) + 1);
    if (inJ) {
      for (const o of own) {
        if (o === me) continue;
        if (o[0] === 'j') jOnJ++; else if (myArms.has(o)) armOnJ++; else otherOnJ++;
      }
    } else {
      const segs = [...own].filter((o) => o[0] === 's');
      if (segs.filter((o) => myArms.has(o)).length >= 2) armArm++; else other++;
    }
  }
  const c2 = C * C;
  const E = net.segments.filter((s: any) => s.a === j.node || s.b === j.node);
  const trims = m.geos.filter((g) => g.s.a === j.node || g.s.b === j.node).map((g) => (g.s.a === j.node ? g.trimA : g.trimB));
  rows.push({
    node: j.node, deg: deg.get(j.node), x: Math.round(node.x), z: Math.round(node.z), hull: j.hull,
    area: Math.round(area * c2), maxTrim: Math.round(Math.max(...trims)),
    armOnJ: Math.round(armOnJ * c2), otherOnJ: Math.round(otherOnJ * c2), jOnJ: Math.round(jOnJ * c2), armArm: Math.round(armArm * c2), other: Math.round(other * c2),
    worst: [...culprits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o, n]) => `${o}:${Math.round(n * c2)}`).join(' '),
    elevatedArms: E.filter((s: any) => s.elevated).length,
  });
}
rows.forEach((r) => (r.total = r.armOnJ + r.otherOnJ + r.jOnJ + r.armArm + r.other));
const by = new Map<number, any[]>();
for (const r of rows) { const d = Math.min(r.deg, 6); if (!by.has(d)) by.set(d, []); by.get(d)!.push(r); }
console.log('deg  n   hull%  bad%(>5m²)  med area  mean overlap m² [armOnJ otherOnJ jOnJ armArm other]');
for (const d of [...by.keys()].sort()) {
  const R = by.get(d)!;
  const pct = (f: (r: any) => boolean) => ((100 * R.filter(f).length) / R.length).toFixed(0).padStart(4);
  const mean = (k: string) => (R.reduce((a, r) => a + r[k], 0) / R.length).toFixed(1);
  const areas = R.map((r) => r.area).sort((a, b) => a - b);
  console.log(`${d}${d === 6 ? '+' : ' '}  ${String(R.length).padStart(4)} ${pct((r) => r.hull)} ${pct((r) => r.total > 5)}       ${String(areas[areas.length >> 1]).padStart(6)}   ${['armOnJ', 'otherOnJ', 'jOnJ', 'armArm', 'other'].map(mean).join(' ')}`);
}
console.log('\nworst 25 (deg ≥ 4):');
for (const r of rows.filter((r) => r.deg >= 4).sort((a, b) => b.total - a.total).slice(0, 25)) console.log(JSON.stringify(r));
fs.writeFileSync('tools/dev/junction-audit.json', JSON.stringify(rows));
