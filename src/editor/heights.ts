// Auto height in the editor: the road tool's live long-section while drawing, and a built road's long-section, from
// the terrain, the water and what the road crosses (src/doc/structure.ts decides the kinds).
import { signal } from '@preact/signals';
import type { Editor } from './editor';
import * as ops from '../doc/ops';
import { classify, gradeGuide, kindOfSection, STRUCT_RULES, type Pin, type ProfileSample, type Stretch, type StructKind, type StructRules } from '../doc/structure';
import type { Id, SectionObj } from '../doc/types';
import type { V2 } from '../net/model';
import { settings } from './state';
import { assetOf, lineShape } from '../assets';
import { railProfile } from '../build/railauto';

/** A long-section to draw: samples along the line, its stretches and (a built road) the section of each stretch. */
export interface LongSectionData {
  samples: ProfileSample[];
  stretches: Stretch[];
  cls: string;
  len: number;
  /** a built road: the section each stretch is (same order) */ ids?: Id[];
  /** crossings with other roads: where, and the other road's level */ marks?: { s: number; z: number; join: boolean }[];
}

/** The road tool's long-section while it draws (null when it isn't drawing, or auto height is off). */
export const liveSection = signal<LongSectionData | null>(null);

export const structRules = (): StructRules => ({ ...STRUCT_RULES, ...settings.value.structRules });

/** Designed ground (after terraforming, before roads are cut in), metres above sea level. */
export const groundOf = (E: Editor) => (x: number, z: number) => E.hf.sample(x, z) + E.hf.base;

/** Water surface (m above sea level) at a point when it's over water (river, lake, sea), else null. */
export function waterAt(E: Editor, x: number, z: number): number | null {
  const T = E.world?.tile?.terrain, hf = E.hf;
  if (!T?.waterMask || T.n !== hf.n) return null;
  const i = Math.round((x - hf.x0) / hf.cell), j = Math.round((z - hf.z0) / hf.cell);
  if (i < 0 || j < 0 || i >= hf.n || j >= hf.n) return null;
  const k = j * hf.n + i;
  return T.waterMask[k] ? T.waterLevel[k] : null;
}

/** Resample a polyline every ~`step` m: points and arc length. */
function resample(pts: V2[], step = 4): { p: V2[]; s: number[]; len: number } {
  const p: V2[] = [pts[0]], s = [0];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 1; j <= k; j++) { const t = j / k; p.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s.push(acc + L * t); }
    acc += L;
  }
  return { p, s, len: acc };
}

function segHit(a: V2, b: V2, c: V2, d: V2): number | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den, u = (qx * rz - qz * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/** Arc lengths where a polyline (with cumulative lengths) crosses railways at grade and wide streams. */
function railAndStreamCrossings(E: Editor, P: V2[], S: number[]): { s: number; half: number; kind: 'rail' | 'water' }[] {
  const tile = E.world?.tile;
  if (!tile) return [];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const out: { s: number; half: number; kind: 'rail' | 'water' }[] = [];
  const test = (q: ArrayLike<number>, half: number, kind: 'rail' | 'water') => {
    const n = q.length / 2;
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (let i = 0; i < n; i++) { bx0 = Math.min(bx0, q[i * 2]); bx1 = Math.max(bx1, q[i * 2]); bz0 = Math.min(bz0, q[i * 2 + 1]); bz1 = Math.max(bz1, q[i * 2 + 1]); }
    if (bx0 > x1 || bx1 < x0 || bz0 > z1 || bz1 < z0) return;
    for (let i = 0; i + 1 < P.length; i++) for (let j = 0; j + 1 < n; j++) {
      const t = segHit(P[i], P[i + 1], [q[j * 2], q[j * 2 + 1]], [q[j * 2 + 2], q[j * 2 + 3]]);
      if (t !== null) out.push({ s: S[i] + (S[i + 1] - S[i]) * t, half, kind });
    }
  };
  for (const r of tile.rails ?? []) if (!r.bridge && !r.tunnel) test(r.pts, 6, 'rail');
  for (const w of tile.waterways ?? []) if (w.width >= 8) test(w.pts, w.width / 2 + 3, 'water');
  // drawn tracks at grade (only the rail / metro layers: a city has many thousand utility lines)
  for (const k of ['rail', 'metro']) for (const l of E.doc.linesOf(k)) if (Math.abs(l.depth) < 1) test(l.pts, l.size / 2 + 3, 'rail');
  return out;
}

/**
 * Work out a stretch being drawn along `pts` (with its own arc lengths) from level z0 to z1 (m above sea level, a
 * straight grade): the profile, the crossings (junctions at the same level; a bridge over / tunnel under the rest,
 * railways and wide streams), and the stretches. `skip` = sections to leave out of the crossings.
 */
export function planStretch(E: Editor, pts: V2[], z0: number, z1: number, cls: string, skip: Set<Id> = new Set(), pins: Pin[] = []): LongSectionData {
  const R = structRules(), G = groundOf(E);
  // about 4 m apart (coarser on very long stretches, so the preview stays quick)
  let len0 = 0;
  for (let i = 1; i < pts.length; i++) len0 += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const r = resample(pts, Math.max(4, len0 / 500)), L = r.len || 1;
  const zAt = (s: number) => z0 + ((z1 - z0) * s) / L;
  const samples: ProfileSample[] = r.p.map((p, i) => ({ s: r.s[i], road: zAt(r.s[i]), ground: G(p[0], p[1]), water: waterAt(E, p[0], p[1]) }));
  clearWater(samples, L);
  const force = (s: number, half: number, k: StructKind) => {
    for (const q of samples) if (Math.abs(q.s - s) <= half && !q.force) q.force = k;
  };
  // other roads: at the same level a junction (ground), else over (a bridge) or under (a tunnel) with room around it
  const lifts = samples.map((q) => q.road - q.ground);
  const marks: { s: number; z: number; join: boolean }[] = [];
  if (r.len > 1) {
    for (const c of ops.crossingsOf(E.doc, r.p, lifts, skip, (a, b, cc, d) => E.hit.query(a, b, cc, d))) {
      const i = Math.min(samples.length - 1, Math.max(0, r.s.findIndex((x) => x >= c.s)));
      marks.push({ s: c.s, z: samples[i].ground + c.otherLift, join: c.join });
      if (c.join || c.s < 1.5 || c.s > r.len - 1.5) continue;
      const o = E.doc.get<'section'>(c.other);
      const t = o ? E.C.typeOf(o) : null;
      const half = (t ? Math.max(t.hwL, t.hwR) : 6) + 4;
      force(c.s, half, c.lift > c.otherLift ? 'bridge' : 'tunnel');
    }
  }
  for (const c of railAndStreamCrossings(E, r.p, r.s)) {
    const i = Math.min(samples.length - 1, Math.max(0, r.s.findIndex((x) => x >= c.s)));
    const d = samples[i].road - samples[i].ground;
    force(c.s, c.half, c.kind === 'water' || d >= -R.cut ? 'bridge' : 'tunnel');
  }
  const stretches = classify(samples, cls, R, pins);
  return { samples, stretches, cls, len: r.len, marks };
}

/** Climb off a water deck (as the importer's water bridges do), and the steepest a deck may rise off the line's ends. */
const WET_GRADE = 0.03, WET_END = 0.05;

/**
 * Bridges clear the water (as imported ones do: the Bandra–Worli Sea Link reaches 20 m): over each run of water the
 * road is raised to its surface plus a clearance growing with the width crossed (4 m for a river, up to 20 m), easing
 * off it at 3 %; the line's own ends stay where they were drawn.
 */
export function clearWater(P: ProfileSample[], L: number) {
  const runs: [number, number, number][] = [];
  for (let i = 0; i < P.length; i++) {
    if (P[i].water == null) continue;
    let j = i, lv = P[i].water!;
    while (j + 1 < P.length && P[j + 1].water != null) { j++; lv = Math.max(lv, P[j].water!); }
    runs.push([P[i].s, P[j].s, lv + Math.min(20, Math.max(4, (P[j].s - P[i].s) / 50))]);
    i = j;
  }
  if (!runs.length) return;
  for (const q of P) {
    let need = -Infinity;
    for (const [a, b, top] of runs) need = Math.max(need, top - WET_GRADE * (q.s < a ? a - q.s : q.s > b ? q.s - b : 0));
    const cap = q.road + WET_END * Math.min(q.s, L - q.s);
    q.road = Math.max(q.road, Math.min(need, cap));
  }
}

/** Road level at arc length s along a long-section (interpolated between its samples). */
export function levelAt(d: LongSectionData, s: number): number {
  const P = d.samples;
  let i = 1;
  while (i < P.length - 1 && P[i].s < s) i++;
  const f = Math.max(0, Math.min(1, (s - P[i - 1].s) / (P[i].s - P[i - 1].s || 1)));
  return P[i - 1].road + (P[i].road - P[i - 1].road) * f;
}

/**
 * Build a planned stretch (the road tool's commit): one section per stretch along the planned level — a straight
 * grade from a's level to b's, raised to clear any water — its ends exactly at a's and b's; junctions where its ground
 * stretches cross roads at their level. Inside a transaction.
 */
export function drawPlanned(E: Editor, a: ops.PenPoint, liftA: number, b: ops.PenPoint, pieces: number[][], cls: string, plan: LongSectionData, opt: { road?: Id; parts?: import('../net/model').Part[]; asset?: string } = {}) {
  const G = groundOf(E), L = ops.piecesLength(pieces), z0 = G(a.x, a.z) + liftA, z1 = G(b.x, b.z) + (b.lift ?? 0);
  const k = L / (plan.len || 1);
  const stretches = plan.stretches.map((x) => ({ ...x, s0: x.s0 * k, s1: x.s1 * k }));
  const P0 = plan.samples[0].road, P1 = plan.samples[plan.samples.length - 1].road;
  const z = (s: number) => { const f = s / (L || 1); return z0 + (z1 - z0) * f + levelAt(plan, s / k) - (P0 + (P1 - P0) * f); };
  const r = ops.drawAuto(E.doc, a, b, pieces, cls, stretches, z, G, opt);
  // junctions only where it runs on the ground: bridges and tunnels pass over / under what they cross (a bridge's
  // anchors don't carry its level between them, so a crossing check on them could pull its deck down to a road)
  const onGround = r.sections.filter((id) => { const q = E.doc.get<'section'>(id); return !!q && !ops.offGrade(q); });
  const c = onGround.length ? ops.autoConnect(E.doc, onGround) : { joined: 0, bridged: 0 };
  return { ...r, ...c };
}

/** Sections of a road (or of the given sections) in order along it, each with its direction. */
export function roadChain(E: Editor, ids: Id[]): { s: SectionObj; fwd: boolean }[] {
  const chains = ops.chainsOf(E.doc, ids);
  return chains.sort((a, b) => b.length - a.length)[0] ?? [];
}

/** A built road's long-section: one stretch per section, kinds from its level flags (and pins). */
export function roadLevels(E: Editor, ids: Id[]): LongSectionData | null {
  const chain = roadChain(E, ids);
  if (!chain.length) return null;
  const G = groundOf(E), R = structRules();
  const samples: ProfileSample[] = [], stretches: Stretch[] = [], out: Id[] = [];
  let base = 0;
  const cls = chain[0].s.cls;
  for (const { s, fwd } of chain) {
    const Lv = ops.sectionLevels(E.doc, s, G);
    const idx = Lv.s.map((_, i) => i);
    if (!fwd) idx.reverse();
    const first = samples.length;
    for (const i of idx) {
      const u = fwd ? Lv.s[i] : Lv.len - Lv.s[i];
      if (samples.length && i === idx[0]) continue; // shared with the previous section's last sample
      samples.push({ s: base + u, road: Lv.z[i], ground: G(Lv.pts[i][0], Lv.pts[i][1]), water: waterAt(E, Lv.pts[i][0], Lv.pts[i][1]) });
    }
    const kind = kindOfSection(s);
    const part = samples.slice(Math.max(0, first - 1));
    const one = classify(part, s.cls, R);
    const auto = one.sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))[0]?.kind ?? kind;
    let grade = 0, depth = 0;
    for (let i = 1; i < part.length; i++) {
      const ds = part[i].s - part[i - 1].s;
      if (ds > 0.5) { const g = (part[i].road - part[i - 1].road) / ds; if (Math.abs(g) > Math.abs(grade)) grade = g; }
    }
    for (const q of part) if (Math.abs(q.road - q.ground) > Math.abs(depth)) depth = q.road - q.ground;
    stretches.push({ s0: base, s1: base + Lv.len, kind, auto, pinned: s.pin ? true : undefined, grade, steep: Math.abs(grade) > gradeGuide(s.cls) + 1e-4, depth });
    out.push(s.id);
    base += Lv.len;
  }
  return { samples, stretches, cls, len: base, ids: out };
}


/** Pin a built stretch (section) to a kind, or unpin it (undefined: back to what the rules make of it). */
export function pinSection(E: Editor, id: Id, kind: StructKind | undefined) {
  const s = E.doc.get<'section'>(id);
  if (!s) return;
  const G = groundOf(E), R = structRules();
  let auto: StructKind | undefined;
  if (!kind) {
    const Lv = ops.sectionLevels(E.doc, s, G);
    const P: ProfileSample[] = Lv.s.map((u, i) => ({ s: u, road: Lv.z[i], ground: G(Lv.pts[i][0], Lv.pts[i][1]), water: waterAt(E, Lv.pts[i][0], Lv.pts[i][1]) }));
    auto = classify(P, s.cls, R).sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))[0]?.kind;
  }
  E.edit(kind ? 'Pin structure' : 'Unpin structure', () => ops.pinStructure(E.doc, id, kind, G, auto));
}

/**
 * A rail / metro line's long-section (for the line inspector): a track drawn at grade gets its auto height (as the
 * scene builds it, src/build/railauto.ts); one set as a viaduct or a tunnel is that all along, at its set depth.
 */
export function trackLevels(E: Editor, id: Id): LongSectionData | null {
  const l = E.doc.get<'line'>(id);
  if (!l || lineShape(l) !== 'route' || l.pts.length < 4) return null;
  const hf = E.hf, base = hf.base, metro = l.layer === 'metro', cls = metro ? 'metro' : 'rail';
  const p = assetOf(l)?.profile, prof = p?.type === 'track' ? p : undefined;
  const auto = prof?.structure === 'grade' && l.props.bridge !== 1 && Math.abs(l.depth) <= 0.5;
  const wet = (x: number, z: number) => { const w = waterAt(E, x, z); return w === null ? null : w - base; };
  const pr = auto ? railProfile(l.pts, metro, (x, z) => hf.sample(x, z), wet, -l.depth) : null;
  if (pr) {
    const samples = pr.samples.map((q) => ({ ...q, road: q.road + base, ground: q.ground + base, water: q.water == null ? null : q.water + base }));
    return { samples, stretches: pr.stretches, cls, len: pr.len };
  }
  // set by hand (or too short to work out): one kind all along, the depth below (above) the ground
  const kind: StructKind = l.props.bridge === 1 || l.depth < -0.5 ? 'bridge' : l.depth > 3 || prof?.structure === 'tunnel' ? 'tunnel' : 'ground';
  const pts: V2[] = [];
  for (let i = 0; i < l.pts.length; i += 2) pts.push([l.pts[i], l.pts[i + 1]]);
  const r = resample(pts, 8);
  if (r.len < 1) return null;
  const lift = kind === 'bridge' ? Math.max(-l.depth, 7.5) : kind === 'tunnel' ? -(l.depth > 3 ? l.depth : 15) : -l.depth;
  // a viaduct runs straight between its ends, rising over humps but never dipping into valleys (as src/build/rail.ts draws it)
  const g0 = hf.sample(r.p[0][0], r.p[0][1]) + lift, g1 = hf.sample(r.p[r.p.length - 1][0], r.p[r.p.length - 1][1]) + lift;
  const samples: ProfileSample[] = r.p.map((q, i) => {
    const g = hf.sample(q[0], q[1]);
    const road = kind === 'bridge' ? Math.max(g0 + (g1 - g0) * (r.s[i] / r.len), g + lift * 0.8) : g + lift;
    return { s: r.s[i], road: road + base, ground: g + base, water: waterAt(E, q[0], q[1]) };
  });
  let grade = 0, depth = 0;
  for (let i = 1; i < samples.length; i++) { const ds = samples[i].s - samples[i - 1].s; if (ds > 0.5) { const g = (samples[i].road - samples[i - 1].road) / ds; if (Math.abs(g) > Math.abs(grade)) grade = g; } }
  for (const q of samples) if (Math.abs(q.road - q.ground) > Math.abs(depth)) depth = q.road - q.ground;
  return { samples, stretches: [{ s0: 0, s1: r.len, kind, auto: kind, grade, steep: Math.abs(grade) > gradeGuide(cls) + 1e-4, depth }], cls, len: r.len };
}
