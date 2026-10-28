// Cross-section helpers shared by the inspector, the canvas width handles and the scripting API.
// Parts are listed left → right looking along the section (a → b); India drives on the left, so dir +1 lanes are on the left.
import { type Part, type PartKind, VERGE_KINDS, TRAFFIC_KINDS } from '../net/model';

export const PART_LABEL: Record<PartKind, string> = {
  lane: 'Lane', bus: 'Bus lane', cycle: 'Cycle track', parking: 'Parking', shoulder: 'Shoulder', median: 'Median', sidewalk: 'Footpath', planter: 'Planter',
};
export const PART_DEFAULT_W: Record<PartKind, number> = { lane: 3.25, bus: 3.5, cycle: 2, parking: 2.5, shoulder: 1, median: 1.2, sidewalk: 2, planter: 1.5 };
export const PART_MIN_W: Record<PartKind, number> = { lane: 2.5, bus: 3, cycle: 1.2, parking: 2, shoulder: 0.3, median: 0.3, sidewalk: 0.6, planter: 0.5 };
/** Standard Development Plan road widths (m) — the width tools snap to these. */
export const DP_WIDTHS = [6, 7.5, 9, 12, 15, 18, 21, 24, 30, 36, 45, 60];

const r2 = (v: number) => Math.round(v * 100) / 100;
export const clone = (parts: Part[]): Part[] => parts.map((p) => ({ ...p }));

export const totalWidth = (parts: Part[]) => r2(parts.reduce((a, p) => a + p.width, 0));
export const carriageWidth = (parts: Part[]) => r2(parts.filter((p) => !VERGE_KINDS.includes(p.kind)).reduce((a, p) => a + p.width, 0));
export const laneCount = (parts: Part[]) => {
  const L = parts.filter((p) => TRAFFIC_KINDS.includes(p.kind));
  return { f: L.filter((p) => p.dir >= 0).length, b: L.filter((p) => p.dir === -1).length, all: L.length };
};
export const footpath = (parts: Part[], side: 'L' | 'R') => {
  const P = side === 'L' ? parts : [...parts].reverse();
  return P[0]?.kind === 'sidewalk' ? P[0].width : 0;
};
export const isOneway = (parts: Part[]) => { const L = parts.filter((p) => TRAFFIC_KINDS.includes(p.kind)); return L.length > 0 && L.every((p) => p.dir === 1); };
export const hasMedian = (parts: Part[]) => parts.some((p) => p.kind === 'median');

/** Offsets of the outer edges, measured from the carriageway centre line: [left edge, right edge] (left positive). */
export function edges(parts: Part[]): { hwL: number; hwR: number; cw: number } {
  let vl = 0, vr = 0, i = 0, j = parts.length - 1;
  while (i <= j && VERGE_KINDS.includes(parts[i].kind)) vl += parts[i++].width;
  while (j >= i && VERGE_KINDS.includes(parts[j].kind)) vr += parts[j--].width;
  const cw = Math.max(0.5, totalWidth(parts) - vl - vr) / 2;
  return { hwL: cw + vl, hwR: cw + vr, cw };
}

/** "4 lanes · divided · 24 m" */
export function describe(parts: Part[]): string {
  const n = laneCount(parts);
  const bits = [n.all === 1 ? '1 lane' : `${n.all} lanes`];
  if (isOneway(parts)) bits.push('one-way');
  if (hasMedian(parts)) bits.push('divided');
  if (parts.some((p) => p.kind === 'bus')) bits.push('BRTS');
  if (parts.some((p) => p.kind === 'cycle')) bits.push('cycle track');
  bits.push(`${totalWidth(parts)} m`);
  return bits.join(' · ');
}

/** Indices of the outer verges (leading / trailing runs of footpaths and planters). */
function vergeIdx(P: Part[]): Set<number> {
  const out = new Set<number>();
  let i = 0, j = P.length - 1;
  while (i <= j && VERGE_KINDS.includes(P[i].kind)) out.add(i++);
  while (j >= i && VERGE_KINDS.includes(P[j].kind)) out.add(j--);
  return out;
}

/** Resize the whole road: verges keep their width, the carriageway parts scale (never below their minimums). */
export function setTotalWidth(parts: Part[], w: number): Part[] {
  const P = clone(parts);
  const vi = vergeIdx(P);
  const verge = P.filter((_, i) => vi.has(i)), inner = P.filter((_, i) => !vi.has(i));
  const vergeW = verge.reduce((a, p) => a + p.width, 0);
  const innerW = inner.reduce((a, p) => a + p.width, 0);
  const minInner = inner.reduce((a, p) => a + PART_MIN_W[p.kind], 0);
  let target = w - vergeW;
  if (target < minInner) {
    // not enough room: the verges give way too
    const k = Math.max(0, (w - minInner) / (vergeW || 1));
    for (const p of verge) p.width = r2(p.width * k);
    target = minInner;
  }
  if (innerW > 0) {
    // proportional, with minimums honoured
    let k = target / innerW;
    for (let it = 0; it < 4; it++) {
      let fixed = 0, free = 0;
      for (const p of inner) { if (p.width * k < PART_MIN_W[p.kind]) fixed += PART_MIN_W[p.kind]; else free += p.width; }
      if (free > 0) k = (target - fixed) / free;
    }
    for (const p of inner) p.width = r2(Math.max(PART_MIN_W[p.kind], p.width * k));
  }
  return P.filter((p) => p.width > 0.01);
}

/** Widen / narrow one side only (the centre line stays; the caller may shift the geometry). */
export function setSideWidth(parts: Part[], side: 'L' | 'R', hw: number): Part[] {
  const e = edges(parts);
  const cur = side === 'L' ? e.hwL : e.hwR;
  const d = hw - cur;
  const P = clone(parts);
  const i = side === 'L' ? 0 : P.length - 1;
  if (P[i] && VERGE_KINDS.includes(P[i].kind)) P[i].width = r2(Math.max(0.3, P[i].width + d));
  else if (d > 0) P.splice(side === 'L' ? 0 : P.length, 0, { kind: 'shoulder', width: r2(d), dir: 0 });
  return P;
}

/** Set the number of lanes in each direction, keeping the current lane width. */
export function setLanes(parts: Part[], f: number, b: number): Part[] {
  const lanes = parts.filter((p) => p.kind === 'lane');
  const lw = lanes.length ? lanes.reduce((a, p) => a + p.width, 0) / lanes.length : PART_DEFAULT_W.lane;
  const left: Part[] = [], right: Part[] = [];
  let i = 0;
  while (i < parts.length && VERGE_KINDS.includes(parts[i].kind)) left.push({ ...parts[i++] });
  let j = parts.length - 1;
  while (j >= i && VERGE_KINDS.includes(parts[j].kind)) right.unshift({ ...parts[j--] });
  const inner = parts.slice(i, j + 1);
  const kerbL = inner.filter((p, k) => k < inner.findIndex((q) => q.kind === 'lane' || q.kind === 'bus') && p.kind !== 'median').map((p) => ({ ...p }));
  const lastLane = inner.length - 1 - [...inner].reverse().findIndex((q) => q.kind === 'lane' || q.kind === 'bus');
  const kerbR = inner.filter((p, k) => k > lastLane && p.kind !== 'median').map((p) => ({ ...p }));
  const median = inner.find((p) => p.kind === 'median');
  const mid: Part[] = [];
  for (let k = 0; k < f; k++) mid.push({ kind: 'lane', width: r2(lw), dir: b === 0 && f > 0 ? 1 : 1 });
  if (median && f > 0 && b > 0) mid.push({ ...median });
  for (let k = 0; k < b; k++) mid.push({ kind: 'lane', width: r2(lw), dir: -1 });
  if (f + b === 1) mid[0].dir = 0;
  return [...left, ...kerbL, ...mid, ...kerbR, ...right];
}

export function setFootpath(parts: Part[], side: 'L' | 'R', w: number): Part[] {
  const P = clone(parts);
  const i = side === 'L' ? 0 : P.length - 1;
  if (P[i]?.kind === 'sidewalk') {
    if (w <= 0.05) P.splice(i, 1); else P[i].width = r2(w);
  } else if (w > 0.05) P.splice(side === 'L' ? 0 : P.length, 0, { kind: 'sidewalk', width: r2(w), dir: 0 });
  return P;
}

export function setMedian(parts: Part[], w: number): Part[] {
  const P = clone(parts);
  const mi = P.findIndex((p) => p.kind === 'median');
  if (mi >= 0) { if (w <= 0.05) P.splice(mi, 1); else P[mi].width = r2(w); return P; }
  if (w <= 0.05) return P;
  // insert between the last forward lane and the first backward lane
  const firstB = P.findIndex((p) => TRAFFIC_KINDS.includes(p.kind) && p.dir === -1);
  if (firstB < 0) return P;
  P.splice(firstB, 0, { kind: 'median', width: r2(w), dir: 0 });
  return P;
}

/** Reverse the direction of travel (mirror the cross-section). */
export function flip(parts: Part[]): Part[] {
  return [...parts].reverse().map((p) => ({ ...p, dir: (p.dir === 0 ? 0 : -p.dir) as Part['dir'] }));
}

export function makeOneway(parts: Part[], on: boolean): Part[] {
  const n = laneCount(parts);
  if (on) return setMedian(setLanes(parts, Math.max(1, n.all), 0), 0).map((p) => (TRAFFIC_KINDS.includes(p.kind) ? { ...p, dir: 1 as const } : p));
  const half = Math.max(1, Math.round(n.all / 2));
  return setLanes(parts, half, Math.max(1, n.all - half));
}

/** Default cross-section for a new road of a class (Pune practice). */
export function template(cls: string): Part[] {
  const L = (dir: 1 | -1 | 0, w = 3.25): Part => ({ kind: 'lane', width: w, dir });
  const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
  const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
  switch (cls) {
    case 'trunk': return [S(3), L(1, 3.5), L(1, 3.5), L(1, 3.5), M(2), L(-1, 3.5), L(-1, 3.5), L(-1, 3.5), S(3)];
    case 'primary': return [S(2.5), L(1, 3.5), L(1, 3.5), M(1.5), L(-1, 3.5), L(-1, 3.5), S(2.5)];
    case 'secondary': return [S(2), L(1, 3.3), L(1, 3.3), L(-1, 3.3), L(-1, 3.3), S(2)];
    case 'tertiary': return [S(1.8), L(1, 3.2), L(-1, 3.2), S(1.8)];
    case 'busway': return [S(2.5), L(1, 3.5), { kind: 'bus', width: 3.5, dir: 1 }, M(1), { kind: 'bus', width: 3.5, dir: -1 }, L(-1, 3.5), S(2.5)];
    case 'service': case 'track': return [L(0, 4)];
    case 'living_street': return [L(0, 5)];
    default: return [S(1.2), L(1, 3), L(-1, 3), S(1.2)];
  }
}

export const isMajorClass = (cls: string) => ['motorway', 'trunk', 'primary', 'secondary'].includes(cls);
