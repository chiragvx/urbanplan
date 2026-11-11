// The film set: a small synthetic city (2 × 2 km) for the "What If" videos, in the same tile format the editor
// loads with ?tile= (tile.json + tile.bin + network.json, see src/data/tile.ts and src/doc/base.ts). It isn't any real
// place: a flat-ish valley floor with a street grid and mock blocks, two arterials crossing at the centre (0, 0),
// and wooded hills all round so low 3D shots never see the edge of the world. Same seed, same set.
//
//   npm run film:set            → public/tiles/film/
import fs from 'node:fs';
import path from 'node:path';
import { typeFromParts, type NetNode, type NetSegment, type Network, type Part, type RoadType } from '../../src/net/model';

const ID = 'film';
const HALF = 1000, CELL = 8, N = (2 * HALF) / CELL + 1;
const BASE = 560;
const OUT = path.join('public', 'tiles', ID);

// ---------------- randomness ----------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261103);
const between = (a: number, b: number) => a + rand() * (b - a);
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------------- terrain ----------------

/** Ground height (m above sea level): a gently rolling valley floor, hills rising beyond ~550 m from the centre. */
function ground(x: number, z: number) {
  const r = Math.hypot(x, z * 1.1), a = Math.atan2(z, x);
  const floor = 2.2 * Math.sin(x / 260 + 0.4) * Math.cos(z / 330) + 1.1 * Math.sin((x + z) / 170) + x * 0.0015;
  const hills = 48 * smooth(560, 980, r) * (0.7 + 0.3 * Math.sin(a * 3 + 1.2)) + 6 * smooth(700, 1000, r) * Math.sin(x / 90) * Math.cos(z / 110);
  return BASE + floor + hills;
}

// ---------------- streets ----------------

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1 | 0): Part => ({ kind: 'lane', width: w, dir });
const XS: Record<string, { parts: Part[]; cls: string; major: boolean }> = {
  arterial: { parts: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), S(2)], cls: 'primary', major: true },
  collector: { parts: [S(2), L(3.75, 1), L(3.75, -1), S(2)], cls: 'tertiary', major: false },
  local: { parts: [S(1.5), L(3, 1), L(3, -1), S(1.5)], cls: 'residential', major: false },
};
/** grid lines (m): the two arterials on 0, collectors on ±360, local streets between */
const GRID = [-580, -470, -360, -250, -140, 0, 140, 250, 360, 470, 580];
const kindOf = (c: number) => (c === 0 ? 'arterial' : Math.abs(c) === 360 ? 'collector' : 'local');
const NAMES: Record<string, string> = { 'x0': 'Market Road', 'z0': 'Station Road', 'x-360': 'Temple Street', 'x360': 'Mill Street', 'z-360': 'Hill Road', 'z360': 'Canal Road' };
/** the arterials run on into the hills; the grid stops at its last lines */
const ART_END = 760;

const nodes: NetNode[] = [];
const nodeAt = new Map<string, number>();
const node = (x: number, z: number) => {
  const k = `${x},${z}`;
  let id = nodeAt.get(k);
  if (id === undefined) { id = nodes.length; nodes.push({ id, x, z, lift: 0 }); nodeAt.set(k, id); }
  return id;
};
const segments: NetSegment[] = [];
const types: Record<string, RoadType> = {};
let way = 1;
/** One street along a grid line, split at every crossing grid line. */
function street(axis: 'x' | 'z', c: number) {
  const kind = kindOf(c), X = XS[kind];
  const t = typeFromParts(X.parts, { major: X.major });
  types[t.id] = t;
  const end = kind === 'arterial' ? ART_END : GRID[GRID.length - 1];
  const stops = [-end, ...GRID.filter((g) => Math.abs(g) < end), end];
  const wayId = way++;
  for (let i = 0; i + 1 < stops.length; i++) {
    const [x0, z0] = axis === 'x' ? [c, stops[i]] : [stops[i], c];
    const [x1, z1] = axis === 'x' ? [c, stops[i + 1]] : [stops[i + 1], c];
    const dx = x1 - x0, dz = z1 - z0;
    segments.push({
      id: segments.length, a: node(x0, z0), b: node(x1, z1), p: [x0, z0, x0 + dx / 3, z0 + dz / 3, x0 + (2 * dx) / 3, z0 + (2 * dz) / 3, x1, z1],
      type: t.id, name: NAMES[`${axis}${c}`] ?? '', cls: X.cls, bridge: 'none', deck: 0, wayIds: [wayId],
    });
  }
}
for (const c of GRID) { street('x', c); street('z', c); }

// ---------------- blocks and buildings ----------------

interface Bld { ring: [number, number][]; h: number; kind: number; name: string }
const buildings: Bld[] = [];
const halfWidth = (c: number) => XS[kindOf(c)].parts.reduce((a, p) => a + p.width, 0) / 2;
const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const floors = (n: number) => n * 3.2 + 0.6;
/** blocks left open: a park and a school ground */
const PARKS = new Set(['-360,140', '140,-360']);
const parks: [number, number, number, number][] = [];
/** ground left vacant (x0, z0, x1, z1): the Plot Twist plot, an acre on Station Road's south side east of x 470 (the
 *  scenes widen the road; a 30 m road's edge is at z 15). Far from the centre, so the What If shots never see it. */
const VACANT: [number, number, number, number][] = [[488, 8, 562, 86]];
/** (plots are rect()s: the first corner the lowest, the third the highest) */
const vacant = (ring: [number, number][]) => VACANT.some(([x0, z0, x1, z1]) => ring[0][0] < x1 && ring[2][0] > x0 && ring[0][1] < z1 && ring[2][1] > z0);

for (let i = 0; i + 1 < GRID.length; i++) for (let j = 0; j + 1 < GRID.length; j++) {
  const gx0 = GRID[i], gx1 = GRID[i + 1], gz0 = GRID[j], gz1 = GRID[j + 1];
  const set = (c: number) => (c === 0 ? 5 : 3); // setbacks: deeper along the arterials
  const x0 = gx0 + halfWidth(gx0) + set(gx0), x1 = gx1 - halfWidth(gx1) - set(gx1);
  const z0 = gz0 + halfWidth(gz0) + set(gz0), z1 = gz1 - halfWidth(gz1) - set(gz1);
  if (PARKS.has(`${gx0},${gz0}`)) { parks.push([x0 - 2, z0 - 2, x1 + 2, z1 + 2]); continue; }
  const near = Math.min(Math.abs(gx0), Math.abs(gx1), Math.abs(gz0), Math.abs(gz1)) === 0; // fronts an arterial
  const dist = Math.hypot((gx0 + gx1) / 2, (gz0 + gz1) / 2);
  // plots along the two long sides, a courtyard between
  const alongX = x1 - x0 >= z1 - z0;
  const [a0, a1, b0, b1] = alongX ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
  const depth = Math.min((b1 - b0) / 2 - 3, 24);
  for (const side of [0, 1]) {
    let a = a0;
    while (a1 - a > 10) {
      const w = Math.min(a1 - a, between(14, 30));
      const gap = between(1.5, 4);
      const d = depth * between(0.65, 1);
      const [p0, p1] = [a, a + w - gap];
      const [q0, q1] = side === 0 ? [b0, b0 + d] : [b1 - d, b1];
      const ring = alongX ? rect(p0, q0, p1, q1) : rect(q0, p0, q1, p1);
      a += w;
      // the centre junction's corners stay open (forecourts): room for slip lanes, corner plazas, a camera
      if (Math.min(...ring.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z)))) < 42) continue;
      const tall = rand() < (near ? 0.12 : 0.05);
      const n = tall ? Math.round(between(13, 22)) : near ? Math.round(between(4, 9)) : Math.round(between(2, 6) + Math.max(0, 3 - dist / 200));
      const b = { ring, h: floors(n), kind: near && rand() < 0.5 ? 1 : n <= 3 && rand() < 0.5 ? 5 : 0, name: '' };
      // (drawn all the same, so the rest of the set comes out as it always has)
      if (!vacant(ring)) buildings.push(b);
    }
  }
}

// ---------------- land use, trees ----------------

const areas: { outer: [number, number][]; holes: [number, number][][]; kind: number }[] = [];
// the built-up valley floor, the parks, and woods on the hills (a ring round the town)
areas.push({ outer: rect(-610, -610, 610, 610), holes: [], kind: 0 });
for (const p of parks) areas.push({ outer: rect(...p), holes: [], kind: 3 });
areas.push({ outer: rect(-HALF, -HALF, HALF, HALF), holes: [rect(-650, -650, 650, 650)], kind: 4 });
const trees: number[] = [];
for (const [x0, z0, x1, z1] of parks) for (let k = 0; k < 26; k++) trees.push(between(x0 + 6, x1 - 6), between(z0 + 6, z1 - 6));

// ---------------- write ----------------

const heights = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = ground(-HALF + i * CELL, -HALF + j * CELL);
let minH = Infinity;
for (const h of heights) minH = Math.min(minH, h);

const sections: { name: string; type: string; offset: number; length: number }[] = [];
const chunks: Uint8Array[] = [];
let off = 0;
function section(name: string, arr: Float32Array | Uint32Array | Uint8Array) {
  const pad = (4 - (off % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
  sections.push({ name, type: arr.constructor.name, offset: off, length: arr.length });
  chunks.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  off += arr.byteLength;
}
/** polygons: points, per polygon [first ring, ring count], per ring [first point, point count] */
function polys(name: string, list: { outer: [number, number][]; holes: [number, number][][] }[]) {
  const P: number[] = [], poly: number[] = [], rs: number[] = [], rc: number[] = [];
  for (const p of list) {
    poly.push(rs.length, 1 + p.holes.length);
    for (const r of [p.outer, ...p.holes]) { rs.push(P.length / 2); rc.push(r.length); for (const [x, z] of r) P.push(x, z); }
  }
  section(name + 'Pts', new Float32Array(P)); section(name + 'Poly', new Uint32Array(poly));
  section(name + 'RingStart', new Uint32Array(rs)); section(name + 'RingCount', new Uint32Array(rc));
}
section('terrain', heights);
section('waterLevel', new Float32Array(N * N).fill(minH - 5));
section('waterMask', new Uint8Array(N * N));
polys('bld', buildings.map((b) => ({ outer: b.ring, holes: [] })));
section('bldHeight', new Float32Array(buildings.map((b) => b.h)));
section('bldMinHeight', new Float32Array(buildings.length));
section('bldKind', new Uint8Array(buildings.map((b) => b.kind)));
section('bldRoof', new Uint8Array(buildings.length));
polys('area', areas);
section('areaKind', new Uint8Array(areas.map((a) => a.kind)));
polys('water', []);
for (const k of ['wwPts', 'railPts']) section(k, new Float32Array(0));
for (const k of ['wwStart', 'wwCount', 'railStart', 'railCount']) section(k, new Uint32Array(0));
section('wwWidth', new Float32Array(0));
section('railFlags', new Uint8Array(0));
section('trees', new Float32Array(trees));
section('busStops', new Float32Array(0));
section('signals', new Float32Array(0));

const lat = 18.5, lon = 73.85, kz = 110540, kx = 111320 * Math.cos((lat * Math.PI) / 180);
const header = {
  version: 2, id: ID, name: 'Film set', city: 'Film set', center: [lat, lon], sizeKm: (2 * HALF) / 1000, half: HALF, proj: { kx, kz },
  bbox: [lon - HALF / kx, lat - HALF / kz, lon + HALF / kx, lat + HALF / kz], terrain: { n: N, cell: CELL },
  attribution: 'Synthetic film set (tools/film/set.ts): not a real place', busStopNames: [], bldNames: buildings.map((b) => b.name), wayFlags: {}, sections,
};
const net: Network = { half: HALF, nodes, segments, types, paths: [] };
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'tile.json'), JSON.stringify(header));
const bin = new Uint8Array(off);
let at = 0;
for (const c of chunks) { bin.set(c, at); at += c.length; }
fs.writeFileSync(path.join(OUT, 'tile.bin'), bin);
fs.writeFileSync(path.join(OUT, 'network.json'), JSON.stringify(net));
console.log(`film set → ${OUT}: ${buildings.length} buildings, ${segments.length} road pieces, ${nodes.length} nodes, terrain ${N}×${N} (${(off / 1e6).toFixed(1)} MB)`);
