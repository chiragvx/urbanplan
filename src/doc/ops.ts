// Editing operations on the City Document. All of them must run inside doc.transact(); the UI, the console API
// and the CLI share these, so a scripted edit and a mouse edit are the same thing.
import { fitCubics, type Part, type V2 } from '../net/model';
import type { CityDoc } from './doc';
import { newId } from './ids';
import { INHERITED, type Anchor, type Id, type JunctionObj, type LineObj, type RoadObj, type SectionObj } from './types';
import { flip, template } from './xsection';

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------- Bézier helpers ----------------

export function bezAt(c: number[], t: number): V2 {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}

/** de Casteljau split of a cubic at t → [left, right] control points. */
export function splitCubic(c: number[], t: number): [number[], number[]] {
  const L = (a: number, b: number) => a + (b - a) * t;
  const p01 = [L(c[0], c[2]), L(c[1], c[3])], p12 = [L(c[2], c[4]), L(c[3], c[5])], p23 = [L(c[4], c[6]), L(c[5], c[7])];
  const p012 = [L(p01[0], p12[0]), L(p01[1], p12[1])], p123 = [L(p12[0], p23[0]), L(p12[1], p23[1])];
  const m = [L(p012[0], p123[0]), L(p012[1], p123[1])];
  return [[c[0], c[1], p01[0], p01[1], p012[0], p012[1], m[0], m[1]], [m[0], m[1], p123[0], p123[1], p23[0], p23[1], c[6], c[7]]];
}

/** Anchors with ends snapped to the section's junctions. */
export function anchorsOf(doc: CityDoc, s: SectionObj): Anchor[] {
  const P = s.path.map((p) => ({ ...p }));
  const A = doc.get<'junction'>(s.a), B = doc.get<'junction'>(s.b);
  if (A) { P[0].x = A.x; P[0].z = A.z; P[0].lift = A.lift; }
  if (B) { const l = P[P.length - 1]; l.x = B.x; l.z = B.z; l.lift = B.lift; }
  return P;
}

export function cubicsOf(P: Anchor[]): number[][] {
  const out: number[][] = [];
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1];
    out.push([a.x, a.z, a.x + a.ox, a.z + a.oz, b.x + b.ix, b.z + b.iz, b.x, b.z]);
  }
  return out;
}

/** Densely sampled polyline of a path with arc length, plus which piece / parameter each sample came from. */
export function samplePath(P: Anchor[], per = 24) {
  const C = cubicsOf(P);
  const pts: V2[] = [], s: number[] = [], k: number[] = [], t: number[] = [], lift: number[] = [];
  let acc = 0;
  C.forEach((c, i) => {
    for (let j = i === 0 ? 0 : 1; j <= per; j++) {
      const tt = j / per, q = bezAt(c, tt);
      if (pts.length) acc += Math.hypot(q[0] - pts[pts.length - 1][0], q[1] - pts[pts.length - 1][1]);
      pts.push(q); s.push(acc); k.push(i); t.push(tt);
      lift.push(P[i].lift + (P[i + 1].lift - P[i].lift) * tt);
    }
  });
  return { pts, s, k, t, lift, len: acc };
}

/** Nearest point on a section path: piece index, parameter, arc length, distance. */
export function nearestOnPath(P: Anchor[], q: V2) {
  const S = samplePath(P, 32);
  let best = 0, bd = Infinity;
  for (let i = 0; i < S.pts.length; i++) { const d = Math.hypot(S.pts[i][0] - q[0], S.pts[i][1] - q[1]); if (d < bd) { bd = d; best = i; } }
  // refine on the piece
  const C = cubicsOf(P), k = S.k[best];
  let lo = Math.max(0, S.t[best] - 1 / 32), hi = Math.min(1, S.t[best] + 1 / 32);
  for (let it = 0; it < 20; it++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    const d1 = Math.hypot(bezAt(C[k], m1)[0] - q[0], bezAt(C[k], m1)[1] - q[1]), d2 = Math.hypot(bezAt(C[k], m2)[0] - q[0], bezAt(C[k], m2)[1] - q[1]);
    if (d1 < d2) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, p = bezAt(C[k], t);
  return { k, t, p, d: Math.hypot(p[0] - q[0], p[1] - q[1]), s: S.s[best], len: S.len };
}

/** Fit anchors to a polyline (keeps the ends; G1 cubic pieces within `tol` metres). */
export function anchorsFromPolyline(pts: V2[], lifts: number[], tol = 0.4, t0?: V2, t1?: V2): Anchor[] {
  const n = pts.length;
  const norm = (v: V2): V2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const a = t0 ?? norm([pts[Math.min(2, n - 1)][0] - pts[0][0], pts[Math.min(2, n - 1)][1] - pts[0][1]]);
  const b = t1 ?? norm([pts[n - 1][0] - pts[Math.max(0, n - 3)][0], pts[n - 1][1] - pts[Math.max(0, n - 3)][1]]);
  const C = fitCubics(pts, a, b, tol);
  // lift at each anchor: from the nearest input sample
  const acc = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const liftAt = (q: V2) => { let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; bi = i; } }); return lifts[bi] ?? 0; };
  const out: Anchor[] = [];
  C.forEach((c, i) => {
    out.push({ x: r2(c[0][0]), z: r2(c[0][1]), ix: i ? r2(C[i - 1][2][0] - C[i - 1][3][0]) : 0, iz: i ? r2(C[i - 1][2][1] - C[i - 1][3][1]) : 0, ox: r2(c[1][0] - c[0][0]), oz: r2(c[1][1] - c[0][1]), lift: r2(liftAt(c[0])) });
  });
  const L = C[C.length - 1];
  out.push({ x: r2(L[3][0]), z: r2(L[3][1]), ix: r2(L[2][0] - L[3][0]), iz: r2(L[2][1] - L[3][1]), ox: 0, oz: 0, lift: r2(lifts[n - 1] ?? 0) });
  return out;
}

// ---------------- junctions ----------------

export function newJunction(doc: CityDoc, x: number, z: number, lift = 0): JunctionObj {
  const j: JunctionObj = { kind: 'junction', id: newId('j'), x: r2(x), z: r2(z), lift: r2(lift), signals: false };
  doc.create(j);
  return j;
}

export function moveJunction(doc: CityDoc, id: Id, x: number, z: number) {
  doc.update(id, { x: r2(x), z: r2(z) });
}

/** Merge junction `src` into `dst`: every section ending at src now ends at dst (sections joining the two vanish). */
export function mergeJunctions(doc: CityDoc, src: Id, dst: Id) {
  if (src === dst) return;
  for (const s of doc.sectionsAt(src)) {
    const a = s.a === src ? dst : s.a, b = s.b === src ? dst : s.b;
    if (a === b) { doc.remove(s.id); continue; }
    doc.update(s.id, { a, b });
  }
  const S = doc.get<'junction'>(src), D = doc.get<'junction'>(dst);
  if (S?.signals && D && !D.signals) doc.set(dst, 'signals', true);
  doc.remove(src);
}

/** Connect a junction to a point on a section (splits the section there and merges). */
export function connectToSection(doc: CityDoc, junction: Id, section: Id, at: V2): Id | null {
  const r = splitSection(doc, section, at);
  if (!r) return null;
  mergeJunctions(doc, junction, r.junction);
  return r.junction;
}

// ---------------- sections ----------------

/** Copy of a section for a new section (new id, given ends and path); its own overrides stay its own. */
function derive(doc: CityDoc, s: SectionObj, a: Id, b: Id, path: Anchor[]): SectionObj {
  const own = INHERITED.filter((k) => doc.editState(s.id, k) === 'own');
  return { ...structuredClone(s), id: newId('s'), a, b, path, own };
}

/**
 * Split a section at a point: a new junction there and two new sections (the original is removed).
 * Returns the new junction id and the two section ids.
 */
export function splitSection(doc: CityDoc, id: Id, at: V2): { junction: Id; parts: [Id, Id] } | null {
  const s = doc.get<'section'>(id);
  if (!s) return null;
  const P = anchorsOf(doc, s);
  const n = nearestOnPath(P, at);
  if (n.s < 1 || n.len - n.s < 1) return null; // too close to an end: that's the junction itself
  const C = cubicsOf(P);
  const [l, r] = splitCubic(C[n.k], n.t);
  const lift = P[n.k].lift + (P[n.k + 1].lift - P[n.k].lift) * n.t;
  const mid: V2 = [l[6], l[7]];
  const j = newJunction(doc, mid[0], mid[1], lift);
  const first: Anchor[] = P.slice(0, n.k + 1).map((p) => ({ ...p }));
  first[n.k] = { ...first[n.k], ox: r2(l[2] - l[0]), oz: r2(l[3] - l[1]) };
  first.push({ x: j.x, z: j.z, ix: r2(l[4] - l[6]), iz: r2(l[5] - l[7]), ox: 0, oz: 0, lift: j.lift });
  const second: Anchor[] = [{ x: j.x, z: j.z, ix: 0, iz: 0, ox: r2(r[2] - r[0]), oz: r2(r[3] - r[1]), lift: j.lift }];
  const rest = P.slice(n.k + 1).map((p) => ({ ...p }));
  rest[0] = { ...rest[0], ix: r2(r[4] - r[6]), iz: r2(r[5] - r[7]) };
  second.push(...rest);
  const A = derive(doc, s, s.a, j.id, first), B = derive(doc, s, j.id, s.b, second);
  doc.remove(id);
  doc.create(A); doc.create(B);
  return { junction: j.id, parts: [A.id, B.id] };
}

/** Join the two sections meeting at a 2-way junction into one (the first one's properties win). */
export function joinAt(doc: CityDoc, junction: Id): Id | null {
  const S = doc.sectionsAt(junction).filter((s) => s.a !== s.b);
  if (S.length !== 2) return null;
  let [p, q] = S;
  // orient p → junction → q
  let P = anchorsOf(doc, p), Q = anchorsOf(doc, q);
  if (p.a === junction) { P = reversePath(P); p = { ...p, a: p.b, b: p.a, parts: flip(p.parts) }; }
  if (q.b === junction) { Q = reversePath(Q); q = { ...q, a: q.b, b: q.a }; }
  if (p.a === q.b) return null; // would make a loop with no junction
  const joint: Anchor = { ...P[P.length - 1], ox: Q[0].ox, oz: Q[0].oz };
  const path = [...P.slice(0, -1), joint, ...Q.slice(1)];
  const m: SectionObj = { ...derive(doc, S[0], p.a, q.b, path), parts: p.parts };
  doc.remove(S[0].id); doc.remove(S[1].id);
  doc.remove(junction);
  doc.create(m);
  return m.id;
}

export function reversePath(P: Anchor[]): Anchor[] {
  return [...P].reverse().map((p) => ({ ...p, ix: p.ox, iz: p.oz, ox: p.ix, oz: p.iz }));
}

/** Reverse a section's direction (ends swap, cross-section mirrors so traffic keeps its side). */
export function reverseSection(doc: CityDoc, id: Id) {
  const s = doc.get<'section'>(id);
  if (!s) return;
  doc.update(id, { a: s.b, b: s.a, path: reversePath(s.path), parts: flip(s.parts) });
}

/** Straight line between the two junctions. */
export function straighten(doc: CityDoc, id: Id) {
  const s = doc.get<'section'>(id);
  if (!s) return;
  const P = anchorsOf(doc, s);
  const a = P[0], b = P[P.length - 1];
  const dx = (b.x - a.x) / 3, dz = (b.z - a.z) / 3;
  doc.set(id, 'path', [{ ...a, ix: 0, iz: 0, ox: r2(dx), oz: r2(dz) }, { ...b, ix: r2(-dx), iz: r2(-dz), ox: 0, oz: 0 }]);
}

/** Simplify / smooth a section's curve: refit with a looser tolerance (fewer, rounder pieces). */
export function smoothSection(doc: CityDoc, id: Id, tol = 1.5) {
  const s = doc.get<'section'>(id);
  if (!s) return;
  const S = samplePath(anchorsOf(doc, s), 16);
  doc.set(id, 'path', anchorsFromPolyline(S.pts, S.lift, tol));
}

/** Make a section a circular arc of radius R between its junctions (bulging to the side it bulges now). */
export function arcSection(doc: CityDoc, id: Id, R: number) {
  const s = doc.get<'section'>(id);
  if (!s) return;
  const P = anchorsOf(doc, s);
  const a = P[0], b = P[P.length - 1];
  const chord = Math.hypot(b.x - a.x, b.z - a.z);
  if (R < chord / 2 + 0.01) R = chord / 2 + 0.01;
  // which side does it bulge now?
  const S = samplePath(P, 8);
  const m = S.pts[Math.floor(S.pts.length / 2)];
  const side = Math.sign((b.x - a.x) * (m[1] - a.z) - (b.z - a.z) * (m[0] - a.x)) || 1;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const h = Math.sqrt(R * R - (chord / 2) ** 2);
  const nx = -(b.z - a.z) / chord, nz = (b.x - a.x) / chord; // left normal of a→b
  const cx = mx - nx * h * side, cz = mz - nz * h * side;
  const a0 = Math.atan2(a.z - cz, a.x - cx);
  const a1 = Math.atan2(b.z - cz, b.x - cx);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const pts: V2[] = [], lifts: number[] = [];
  const n = Math.max(8, Math.ceil(Math.abs(sweep) / 0.05));
  for (let i = 0; i <= n; i++) { const ang = a0 + (sweep * i) / n; pts.push([cx + Math.cos(ang) * R, cz + Math.sin(ang) * R]); lifts.push(a.lift + ((b.lift - a.lift) * i) / n); }
  doc.set(id, 'path', anchorsFromPolyline(pts, lifts, 0.05));
}

/**
 * Bend: drag the point of the section nearest to `grab` by (dx, dz). The ends stay; the displacement falls off
 * smoothly towards them (a sine bump), and the curve is refitted. `base` is the path at drag start.
 */
export function bendSection(doc: CityDoc, id: Id, base: Anchor[], grab: V2, dx: number, dz: number) {
  const S = samplePath(base, 20);
  let gi = 0, gd = Infinity;
  S.pts.forEach((p, i) => { const d = Math.hypot(p[0] - grab[0], p[1] - grab[1]); if (d < gd) { gd = d; gi = i; } });
  const sg = S.s[gi], L = S.len;
  if (L < 1) return;
  const w = (s: number) => (s <= sg ? Math.sin((Math.PI / 2) * (s / Math.max(sg, 1e-6))) : Math.sin((Math.PI / 2) * ((L - s) / Math.max(L - sg, 1e-6))));
  const pts: V2[] = S.pts.map((p, i) => { const k = Math.max(0, w(S.s[i])) ** 1.5; return [p[0] + dx * k, p[1] + dz * k]; });
  pts[0] = S.pts[0]; pts[pts.length - 1] = S.pts[S.pts.length - 1];
  doc.set(id, 'path', anchorsFromPolyline(pts, S.lift, 0.25));
}

/** Move a set of junctions / anchors / lines by an offset (sections between moved junctions move whole). */
export function translate(doc: CityDoc, ids: Id[], dx: number, dz: number) {
  const juncs = new Set<Id>(), secs = new Set<Id>(), lines = new Set<Id>();
  for (const id of ids) {
    const o = doc.get(id);
    if (!o) continue;
    if (o.kind === 'junction') juncs.add(id);
    else if (o.kind === 'section') { secs.add(id); juncs.add(o.a); juncs.add(o.b); }
    else if (o.kind === 'road') for (const s of doc.sectionsOf(id)) { secs.add(s.id); juncs.add(s.a); juncs.add(s.b); }
    else if (o.kind === 'line') lines.add(id);
    else if (o.kind === 'building') doc.set(id, 'outer', o.outer.map((v, i) => r2(v + (i % 2 ? dz : dx))));
  }
  for (const j of juncs) { const J = doc.get<'junction'>(j)!; doc.update(j, { x: r2(J.x + dx), z: r2(J.z + dz) }); }
  for (const id of secs) {
    const s = doc.get<'section'>(id)!;
    if (s.path.length > 2) doc.set(id, 'path', s.path.map((p, i) => (i === 0 || i === s.path.length - 1 ? p : { ...p, x: r2(p.x + dx), z: r2(p.z + dz) })));
  }
  for (const id of lines) { const l = doc.get<'line'>(id)!; doc.set(id, 'pts', l.pts.map((v, i) => r2(v + (i % 2 ? dz : dx)))); }
}

/** Delete sections; junctions left with nothing attached go too; 2-way junctions left over stay (dead ends / transitions). */
export function deleteSections(doc: CityDoc, ids: Id[]) {
  const touched = new Set<Id>();
  for (const id of ids) { const s = doc.get<'section'>(id); if (!s) continue; touched.add(s.a); touched.add(s.b); doc.remove(id); }
  for (const j of touched) if (!doc.sectionsAt(j).length) doc.remove(j);
}

/** Delete a junction: a 2-way junction is dissolved (its sections joined); otherwise its sections go with it. */
export function deleteJunction(doc: CityDoc, id: Id) {
  const S = doc.sectionsAt(id);
  if (S.length === 2 && joinAt(doc, id)) return;
  deleteSections(doc, S.map((s) => s.id));
  doc.remove(id);
}

export function deleteRoad(doc: CityDoc, id: Id) {
  deleteSections(doc, doc.sectionsOf(id).map((s) => s.id));
  doc.remove(id);
}

// ---------------- new roads ----------------

export interface PenPoint {
  x: number; z: number;
  /** outgoing handle (relative) — the pen's drag */ hx?: number; hz?: number;
  /** snapped to */ junction?: Id; section?: Id;
  /** height above the ground (bridges, flyovers) */ lift?: number;
}

/** Resolve a pen end: an existing junction, a point on a section (split it), or a new dead-end junction. */
function endpointFor(doc: CityDoc, p: PenPoint): JunctionObj {
  if (p.junction) { const j = doc.get<'junction'>(p.junction); if (j) return j; }
  if (p.section) {
    const r = splitSection(doc, p.section, [p.x, p.z]);
    if (r) return doc.get<'junction'>(r.junction)!;
  }
  return newJunction(doc, p.x, p.z, p.lift ?? 0);
}

/** Level flags for a section from its heights (anything raised is a bridge / flyover). */
function levelOf(path: Anchor[], ja: JunctionObj, jb: JunctionObj): Pick<SectionObj, 'bridge' | 'deck' | 'elevated'> {
  const top = Math.max(ja.lift, jb.lift, ...path.map((p) => p.lift));
  return top > 0.25 ? { bridge: 'overpass', deck: r2(top), elevated: true } : { bridge: 'none', deck: 0, elevated: false };
}

/**
 * Create a road from pen points: a new road object and one section per stretch between junction / section snaps.
 * Returns the new road id.
 */
export function createRoad(doc: CityDoc, pts: PenPoint[], cls: string, name = '', parts?: Part[]): Id | null {
  if (pts.length < 2) return null;
  const road: RoadObj = { kind: 'road', id: newId('r'), name, cls };
  doc.create(road);
  const P = parts ?? template(cls);
  // break into stretches at interior snaps
  let start = 0;
  const startJ = endpointFor(doc, pts[0]);
  let jA = startJ;
  for (let i = 1; i < pts.length; i++) {
    const last = i === pts.length - 1;
    if (!last && !pts[i].junction && !pts[i].section) continue;
    const jB = endpointFor(doc, pts[i]);
    const seg = pts.slice(start, i + 1);
    const path: Anchor[] = seg.map((p, k) => {
      const prev = seg[k - 1], next = seg[k + 1];
      // default handles: a third of the way to the neighbours (Catmull-Rom style tangents) unless dragged
      let ox = p.hx ?? 0, oz = p.hz ?? 0;
      if (p.hx === undefined && prev && next) { ox = (next.x - prev.x) / 6; oz = (next.z - prev.z) / 6; }
      else if (p.hx === undefined && next) { ox = (next.x - p.x) / 3; oz = (next.z - p.z) / 3; }
      let ix = -(p.hx ?? 0), iz = -(p.hz ?? 0);
      if (p.hx === undefined && prev && next) { ix = -ox; iz = -oz; }
      else if (p.hx === undefined && prev) { ix = (prev.x - p.x) / 3; iz = (prev.z - p.z) / 3; }
      return { x: r2(p.x), z: r2(p.z), ix: k ? r2(ix) : 0, iz: k ? r2(iz) : 0, ox: k < seg.length - 1 ? r2(ox) : 0, oz: k < seg.length - 1 ? r2(oz) : 0, lift: r2(p.lift ?? 0) };
    });
    path[0].x = jA.x; path[0].z = jA.z; path[0].lift = jA.lift;
    const pl = path[path.length - 1];
    pl.x = jB.x; pl.z = jB.z; pl.lift = jB.lift;
    if (jA.id !== jB.id) {
      const s: SectionObj = {
        kind: 'section', id: newId('s'), a: jA.id, b: jB.id, path, parts: P.map((p) => ({ ...p })), cls, name, road: road.id,
        surface: cls === 'track' ? 'dirt' : 'asphalt', ...levelOf(path, jA, jB), viaduct: false, wayIds: [], widthSrc: 'user',
      };
      doc.create(s);
    }
    jA = jB; start = i;
  }
  return road.id;
}

/** Move sections into a road (or a new road when `road` is omitted). */
export function regroup(doc: CityDoc, sectionIds: Id[], road?: Id): Id {
  let rid = road;
  if (!rid) {
    const s0 = doc.get<'section'>(sectionIds[0])!;
    const r: RoadObj = { kind: 'road', id: newId('r'), name: s0.name, cls: s0.cls };
    doc.create(r);
    rid = r.id;
  }
  for (const id of sectionIds) doc.set(id, 'road', rid);
  return rid;
}

// ---------------- lines ----------------

export function createLine(doc: CityDoc, layer: Id, pts: number[], depth: number, size: number, name = ''): Id {
  const l: LineObj = { kind: 'line', id: newId('l'), layer, pts: pts.map(r2), depth, size, name, props: {} };
  doc.create(l);
  return l.id;
}

// ---------------- drawing a stretch (the road tool's modes) ----------------

/** Cubic pieces of a circular arc leaving `s` along unit tangent `t` and ending at `e` (straight when it can't turn). */
export function arcPieces(s: V2, t: V2, e: V2): { pieces: number[][]; R: number; end: V2 } {
  const cx = e[0] - s[0], cz = e[1] - s[1];
  const cr = t[0] * cz - t[1] * cx, dt = t[0] * cx + t[1] * cz;
  const th = Math.atan2(cr, dt), L = Math.hypot(cx, cz);
  if (Math.abs(th) < 0.003 || Math.abs(th) > 2.7 || L < 0.5) return { pieces: [line(s, e)], R: Infinity, end: L > 0.5 ? [cx / L, cz / L] : t };
  const R = L / (2 * Math.sin(Math.abs(th)));
  const sg = Math.sign(th);
  const ox = s[0] - t[1] * R * sg, oz = s[1] + t[0] * R * sg; // centre, on the side the road turns to
  const a0 = Math.atan2(s[1] - oz, s[0] - ox), sweep = 2 * th;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
  const d = sweep / n, k = (4 / 3) * Math.tan(d / 4) * R;
  const pieces: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + d * i, b = a + d;
    const p0: V2 = [ox + Math.cos(a) * R, oz + Math.sin(a) * R], p3: V2 = [ox + Math.cos(b) * R, oz + Math.sin(b) * R];
    pieces.push([p0[0], p0[1], p0[0] - Math.sin(a) * k, p0[1] + Math.cos(a) * k, p3[0] + Math.sin(b) * k, p3[1] - Math.cos(b) * k, p3[0], p3[1]]);
  }
  pieces[n - 1][6] = e[0]; pieces[n - 1][7] = e[1];
  const b = a0 + sweep;
  return { pieces, R, end: [-Math.sin(b) * sg, Math.cos(b) * sg] };
}

export function line(a: V2, b: V2): number[] {
  return [a[0], a[1], a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3, b[0], b[1]];
}

/** Cubic through a quadratic control point (the "simple curve" mode). */
export function quadPiece(a: V2, m: V2, b: V2): number[] {
  return [a[0], a[1], a[0] + ((m[0] - a[0]) * 2) / 3, a[1] + ((m[1] - a[1]) * 2) / 3, b[0] + ((m[0] - b[0]) * 2) / 3, b[1] + ((m[1] - b[1]) * 2) / 3, b[0], b[1]];
}

/**
 * Add one stretch of road from `a` to `b` along the given cubic pieces (absolute control points). Heights run
 * evenly from a's to b's. Joins an existing road (`road`) or starts a new one. Returns the ids it made / used.
 */
export function drawStretch(doc: CityDoc, a: PenPoint, b: PenPoint, pieces: number[][], cls: string, opt: { road?: Id; name?: string; parts?: Part[] } = {}): { road: Id; section: Id | null; a: Id; b: Id } {
  let road = opt.road && doc.get(opt.road) ? opt.road : '';
  if (!road) { const r: RoadObj = { kind: 'road', id: newId('r'), name: opt.name ?? '', cls }; doc.create(r); road = r.id; }
  const jA = endpointFor(doc, a);
  const jB = endpointFor(doc, b);
  if (jA.id === jB.id || !pieces.length) return { road, section: null, a: jA.id, b: jB.id };
  const C = pieces.map((c) => [...c]);
  // ends exactly on the junctions (shift the neighbouring handle with them)
  const f = C[0], l = C[C.length - 1];
  f[2] += jA.x - f[0]; f[3] += jA.z - f[1]; f[0] = jA.x; f[1] = jA.z;
  l[4] += jB.x - l[6]; l[5] += jB.z - l[7]; l[6] = jB.x; l[7] = jB.z;
  const chord = [0];
  for (const c of C) chord.push(chord[chord.length - 1] + Math.hypot(c[6] - c[0], c[7] - c[1]));
  const tot = chord[chord.length - 1] || 1;
  const path: Anchor[] = [];
  for (let k = 0; k <= C.length; k++) {
    const prev = C[k - 1], next = C[k];
    const x = next ? next[0] : prev[6], z = next ? next[1] : prev[7];
    path.push({
      x: r2(x), z: r2(z), ix: prev ? r2(prev[4] - prev[6]) : 0, iz: prev ? r2(prev[5] - prev[7]) : 0,
      ox: next ? r2(next[2] - next[0]) : 0, oz: next ? r2(next[3] - next[1]) : 0, lift: r2(jA.lift + ((jB.lift - jA.lift) * chord[k]) / tot),
    });
  }
  const P = opt.parts ?? template(cls);
  const s: SectionObj = {
    kind: 'section', id: newId('s'), a: jA.id, b: jB.id, path, parts: P.map((p) => ({ ...p })), cls, name: opt.name ?? '', road,
    surface: cls === 'track' ? 'dirt' : 'asphalt', ...levelOf(path, jA, jB), viaduct: false, wayIds: [], widthSrc: 'user',
  };
  doc.create(s);
  return { road, section: s.id, a: jA.id, b: jB.id };
}

// ---------------- crossings: junction at the same level, bridge otherwise ----------------

/** Vertical separation (m) below which two crossing roads meet in a junction. */
export const SAME_LEVEL = 2.5;

function sampled(doc: CityDoc, s: SectionObj) {
  const S = samplePath(anchorsOf(doc, s), 12);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of S.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return { S, box: [x0, z0, x1, z1] };
}

function segHit(a: V2, b: V2, c: V2, d: V2): [number, number] | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

export interface Crossing { p: V2; other: Id; s: number; lift: number; otherLift: number; join: boolean }

/** Where a polyline (with heights) crosses existing sections. `skip` = sections to ignore (itself). */
export function crossingsOf(doc: CityDoc, pts: V2[], lifts: number[], skip: Set<Id>, near?: (x0: number, z0: number, x1: number, z1: number) => Iterable<Id>): Crossing[] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const cand = near ? [...near(x0, z0, x1, z1)].map((id) => doc.get(id)).filter((o): o is SectionObj => o?.kind === 'section') : doc.all('section');
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const out: Crossing[] = [];
  for (const o of cand) {
    if (skip.has(o.id)) continue;
    // cheap reject on the control points (the curve lies inside their box)
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const a of o.path) for (const [x, z] of [[a.x, a.z], [a.x + a.ix, a.z + a.iz], [a.x + a.ox, a.z + a.oz]]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
    if (bx0 > x1 + 50 || bx1 < x0 - 50 || bz0 > z1 + 50 || bz1 < z0 - 50) continue;
    const { S, box } = sampled(doc, o);
    if (box[0] > x1 || box[2] < x0 || box[1] > z1 || box[3] < z0) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let j = 0; j + 1 < S.pts.length; j++) {
        const h = segHit(pts[i], pts[i + 1], S.pts[j], S.pts[j + 1]);
        if (!h) continue;
        const p: V2 = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * h[0], pts[i][1] + (pts[i + 1][1] - pts[i][1]) * h[0]];
        const lift = lifts[i] + (lifts[i + 1] - lifts[i]) * h[0];
        const otherLift = S.lift[j] + (S.lift[j + 1] - S.lift[j]) * h[1];
        out.push({ p, other: o.id, s: acc[i] + (acc[i + 1] - acc[i]) * h[0], lift, otherLift, join: Math.abs(lift - otherLift) < SAME_LEVEL });
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Junction of a section at a point: its end junction when the point is within `r` of it, else split there. */
function junctionOn(doc: CityDoc, id: Id, p: V2, r = 3): Id | null {
  const s = doc.get<'section'>(id);
  if (!s) return null;
  for (const j of [s.a, s.b]) { const J = doc.get<'junction'>(j); if (J && Math.hypot(J.x - p[0], J.z - p[1]) < r) return j; }
  return splitSection(doc, id, p)?.junction ?? null;
}

/**
 * Connect new sections to the roads they cross at the same level (a junction at each crossing, as Cities:
 * Skylines does); crossings at different levels stay as bridges. Returns how many of each.
 */
export function autoConnect(doc: CityDoc, ids: Id[]): { joined: number; bridged: number } {
  const work = [...ids];
  let joined = 0;
  const bridges = new Set<string>();
  for (let guard = 0; guard < 400 && work.length; guard++) {
    const id = work[work.length - 1];
    const s = doc.get<'section'>(id);
    if (!s) { work.pop(); continue; }
    const { S } = sampled(doc, s);
    const hit = crossingsOf(doc, S.pts, S.lift, new Set([id])).find((c) => {
      const o = doc.get<'section'>(c.other)!;
      // the two already meet at a junction right there
      for (const j of [o.a, o.b]) {
        if (j !== s.a && j !== s.b) continue;
        const J = doc.get<'junction'>(j);
        if (J && Math.hypot(J.x - c.p[0], J.z - c.p[1]) < 4) return false;
      }
      if (!c.join) { bridges.add(c.other); return false; }
      return true;
    });
    if (!hit) { work.pop(); continue; }
    const jo = junctionOn(doc, hit.other, hit.p);
    if (!jo) { work.pop(); continue; }
    const jn = junctionOn(doc, id, hit.p);
    if (!jn) { work.pop(); continue; }
    if (jn !== jo) mergeJunctions(doc, jn, jo);
    joined++;
    if (!doc.get(id)) {
      // split: carry on with the two halves
      work.pop();
      for (const q of doc.sectionsAt(jo)) if (q.road === s.road && !ids.includes(q.id)) work.push(q.id);
    }
  }
  return { joined, bridged: bridges.size };
}

// ---------------- levels: bridges and flyovers ----------------

/** Deck height of a flyover over a road: 5.5 m clearance plus the deck. */
export const FLYOVER_DECK = 6.5;

interface ChainItem { s: SectionObj; fwd: boolean }
/** Sections in runs through shared junctions (a road drawn in several sections). */
export function chainsOf(doc: CityDoc, ids: Id[]): ChainItem[][] {
  const secs = ids.map((id) => doc.get<'section'>(id)).filter((s): s is SectionObj => !!s);
  const at = new Map<Id, SectionObj[]>();
  for (const s of secs) for (const j of [s.a, s.b]) (at.get(j) ?? at.set(j, []).get(j)!).push(s);
  const deg = (j: Id) => at.get(j)?.length ?? 0;
  const startOf = (s: SectionObj) => (deg(s.a) !== 2 ? s.a : deg(s.b) !== 2 ? s.b : s.a);
  const used = new Set<Id>();
  const out: ChainItem[][] = [];
  const order = [...secs].sort((p, q) => (deg(startOf(p)) !== 2 ? 0 : 1) - (deg(startOf(q)) !== 2 ? 0 : 1));
  for (const s0 of order) {
    if (used.has(s0.id)) continue;
    const chain: ChainItem[] = [];
    let s: SectionObj | undefined = s0, from = startOf(s0);
    while (s && !used.has(s.id)) {
      used.add(s.id);
      const fwd: boolean = s.a === from;
      chain.push({ s, fwd });
      const to: Id = fwd ? s.b : s.a;
      s = deg(to) === 2 ? at.get(to)!.find((q) => !used.has(q.id)) : undefined;
      from = to;
    }
    out.push(chain);
  }
  return out;
}

/** Arc length of each anchor along a path. */
function anchorStations(P: Anchor[]) {
  const S = samplePath(P, 24);
  return P.map((_, k) => S.s[Math.min(S.s.length - 1, k * 24)]);
}

/** Insert an anchor at arc length `s` (keeps the curve exactly). */
function insertAt(P: Anchor[], s: number): Anchor[] {
  const S = samplePath(P, 24);
  let i = 1;
  while (i < S.s.length - 1 && S.s[i] < s) i++;
  const f = Math.max(0, Math.min(1, (s - S.s[i - 1]) / Math.max(1e-6, S.s[i] - S.s[i - 1])));
  const k = S.k[i], t = S.k[i - 1] === k ? S.t[i - 1] + (S.t[i] - S.t[i - 1]) * f : S.t[i] * f;
  const C = cubicsOf(P);
  const [l, r] = splitCubic(C[k], t);
  const out = P.map((a) => ({ ...a }));
  out[k] = { ...out[k], ox: r2(l[2] - l[0]), oz: r2(l[3] - l[1]) };
  out[k + 1] = { ...out[k + 1], ix: r2(r[4] - r[6]), iz: r2(r[5] - r[7]) };
  out.splice(k + 1, 0, { x: r2(l[6]), z: r2(l[7]), ix: r2(l[4] - l[6]), iz: r2(l[5] - l[7]), ox: r2(r[2] - r[0]), oz: r2(r[3] - r[1]), lift: 0 });
  return out;
}

/**
 * Drop interior anchors that only split a curve (removing them leaves the same shape) — e.g. ramp points left by
 * an earlier height change, so changing the height again doesn't pile them up.
 */
export function pruneSplits(P: Anchor[]): Anchor[] {
  const out = P.map((a) => ({ ...a }));
  for (let k = out.length - 2; k >= 1; k--) {
    const A = out[k - 1], M = out[k], B = out[k + 1];
    const li = Math.hypot(M.ix, M.iz), lo = Math.hypot(M.ox, M.oz);
    if (li < 1e-3 || lo < 1e-3 || (M.ix * M.ox + M.iz * M.oz) / (li * lo) > -0.999) continue;
    const t = li / (li + lo);
    const C = [A.x, A.z, A.x + A.ox / t, A.z + A.oz / t, B.x + B.ix / (1 - t), B.z + B.iz / (1 - t), B.x, B.z];
    const [l, r] = splitCubic(C, t);
    if (Math.hypot(l[6] - M.x, l[7] - M.z) > 0.1 || Math.hypot(l[4] - (M.x + M.ix), l[5] - (M.z + M.iz)) > 0.1 || Math.hypot(r[2] - (M.x + M.ox), r[3] - (M.z + M.oz)) > 0.1) continue;
    out[k - 1] = { ...A, ox: r2(C[2] - A.x), oz: r2(C[3] - A.z) };
    out[k + 1] = { ...B, ix: r2(C[4] - B.x), iz: r2(C[5] - B.z) };
    out.splice(k, 1);
  }
  return out;
}

export interface LevelResult { deck: number; grade: number; ramp: number; steep: boolean; lowered: boolean }

/**
 * Raise sections to a deck height with graded ramps at the ends of each run (a flyover). Junctions in the
 * middle that connect other roads stay on the ground and the flyover passes over them.
 */
export function elevate(doc: CityDoc, ids: Id[], deck: number, grade = 0.05, maxGrade = 0.1): LevelResult {
  let res: LevelResult = { deck, grade, ramp: 0, steep: false, lowered: false };
  for (const chain of chainsOf(doc, ids)) {
    const first = chain[0], last = chain[chain.length - 1];
    const ja = doc.get<'junction'>(first.fwd ? first.s.a : first.s.b)!, jb = doc.get<'junction'>(last.fwd ? last.s.b : last.s.a)!;
    const lens = chain.map((c) => samplePath(anchorsOf(doc, c.s), 24).len);
    const L = lens.reduce((a, b) => a + b, 0);
    if (L < 2) continue;
    // ramps at the run's ends; steeper when the run is short, then a lower deck
    let D = deck, g = grade;
    const need = Math.max(0, D - ja.lift) + Math.max(0, D - jb.lift);
    if (need / L > g) g = Math.min(maxGrade, need / L);
    if (need / L > maxGrade) D = Math.max(0, (L * maxGrade + ja.lift + jb.lift) / 2);
    const prof = (u: number) => Math.max(0, Math.min(D, ja.lift + g * u, jb.lift + g * (L - u)));
    const tops = [(D - ja.lift) / g, L - (D - jb.lift) / g].filter((u) => u > 0.5 && u < L - 0.5);
    res = { deck: r2(D), grade: g, ramp: Math.round(Math.max(0, D - Math.min(ja.lift, jb.lift)) / g), steep: g > grade + 1e-6, lowered: D < deck - 0.01 };
    let base = 0;
    chain.forEach((c, i) => {
      const len = lens[i];
      const toLocal = (u: number) => (c.fwd ? u - base : base + len - u);
      const sec = doc.get<'section'>(c.s.id)!;
      let P = pruneSplits(anchorsOf(doc, sec));
      for (const u of tops) {
        const sl = toLocal(u);
        if (sl < 3 || sl > len - 3) continue;
        if (anchorStations(P).some((x) => Math.abs(x - sl) < 4)) continue;
        P = insertAt(P, sl);
      }
      const at = anchorStations(P);
      const path = P.map((a, k) => ({ ...a, lift: r2(prof(c.fwd ? base + at[k] : base + len - at[k])) }));
      const top = Math.max(...path.map((a) => a.lift));
      doc.update(sec.id, { path, ...(top > 0.25 ? { bridge: 'overpass', deck: r2(top), elevated: true } : { bridge: 'none', deck: 0, elevated: false }) });
      // the junction at this section's far end, inside the run
      if (i < chain.length - 1) {
        const jid = c.fwd ? sec.b : sec.a;
        const lift = r2(prof(base + len));
        const next = chain[i + 1].s.id;
        const others = doc.sectionsAt(jid).filter((q) => q.id !== sec.id && q.id !== next);
        if (others.length && lift > 0.25) {
          // pass over: the run gets its own junction above the one on the ground
          const J = doc.get<'junction'>(jid)!;
          const nj = newJunction(doc, J.x, J.z, lift);
          for (const q of [sec.id, next]) { const o = doc.get<'section'>(q)!; doc.update(q, o.a === jid ? { a: nj.id } : { b: nj.id }); }
        } else doc.set(jid, 'lift', lift);
      }
      base += len;
    });
  }
  return res;
}

/** Bring sections back to the ground; flyover junctions that sit over a ground junction reconnect to it. */
export function toGround(doc: CityDoc, ids: Id[]) {
  const set = new Set(ids);
  const touched = new Set<Id>();
  for (const id of ids) {
    const s = doc.get<'section'>(id);
    if (!s) continue;
    doc.update(id, { path: pruneSplits(s.path).map((a) => ({ ...a, lift: 0 })), bridge: 'none', deck: 0, elevated: false });
    touched.add(s.a); touched.add(s.b);
  }
  for (const j of touched) {
    const J = doc.get<'junction'>(j);
    if (!J || J.lift <= 0) continue;
    // only when nothing else still needs it raised
    if (doc.sectionsAt(j).some((q) => !set.has(q.id) && (q.elevated || q.bridge !== 'none'))) continue;
    doc.set(j, 'lift', 0);
    const under = doc.all('junction').find((o) => o.id !== j && o.lift <= 0.25 && Math.hypot(o.x - J.x, o.z - J.z) < 1);
    if (under) mergeJunctions(doc, j, under.id);
  }
}

/** Highest point of sections (their deck). */
export function deckOf(doc: CityDoc, ids: Id[]): number {
  let top = 0;
  for (const id of ids) { const s = doc.get<'section'>(id); if (s) for (const a of anchorsOf(doc, s)) top = Math.max(top, a.lift); }
  return top;
}
