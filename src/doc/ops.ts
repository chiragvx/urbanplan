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

export interface PenPoint { x: number; z: number; /** outgoing handle (relative) — the pen's drag */ hx?: number; hz?: number; /** snapped to */ junction?: Id; section?: Id }

/** Resolve a pen end: an existing junction, a point on a section (split it), or a new dead-end junction. */
function endpointFor(doc: CityDoc, p: PenPoint): JunctionObj {
  if (p.junction) { const j = doc.get<'junction'>(p.junction); if (j) return j; }
  if (p.section) {
    const r = splitSection(doc, p.section, [p.x, p.z]);
    if (r) return doc.get<'junction'>(r.junction)!;
  }
  return newJunction(doc, p.x, p.z);
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
      return { x: r2(p.x), z: r2(p.z), ix: k ? r2(ix) : 0, iz: k ? r2(iz) : 0, ox: k < seg.length - 1 ? r2(ox) : 0, oz: k < seg.length - 1 ? r2(oz) : 0, lift: 0 };
    });
    path[0].x = jA.x; path[0].z = jA.z; path[path.length - 1].x = jB.x; path[path.length - 1].z = jB.z;
    if (jA.id !== jB.id) {
      const s: SectionObj = {
        kind: 'section', id: newId('s'), a: jA.id, b: jB.id, path, parts: P.map((p) => ({ ...p })), cls, name, road: road.id,
        surface: cls === 'track' ? 'dirt' : 'asphalt', bridge: 'none', deck: 0, elevated: false, viaduct: false, wayIds: [], widthSrc: 'user',
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
