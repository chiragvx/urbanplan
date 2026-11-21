// Windows and doors, placed from the design system's catalog: every flat on a typical floor gets the openings its
// rooms need along its outside walls (a balcony door or a big window for the living room, a window per bedroom and
// the kitchen, a ventilator per toilet), spread evenly with piers between, and its entrance door on the corridor.
// From the same placement: the door and window schedule, and a light and ventilation check per flat (openings at
// least 1/10 of the floor area for light, half that opening for air, as UDCPR's habitable-room rule asks; checked
// by flat until rooms are modelled).
import { pointIn, type SiteReport, type Unit } from '../doc/site';
import { climateOf, compositionOf, openable, type Composition, type DesignSystem } from './design';

export type Tag = 'W1' | 'W2' | 'V1' | 'SD' | 'D1';
/** An opening on a typical floor: centred at x,z on its wall, `n` pointing out of the flat, `u` along the wall. */
export interface Opening {
  tag: Tag; unit: number;
  x: number; z: number; nx: number; nz: number; ux: number; uz: number;
  w: number; h: number; sill: number;
  /** on the outside wall (else the corridor) */
  outside: boolean;
}
export interface UnitCheck { t: number; carpet: number; glazed: number; open: number; light: boolean; air: boolean; toShaft: number }
export interface FloorPlan {
  openings: Opening[];
  /** wall runs of the typical floor (x0, z0, x1, z1), with the entrance doors' gaps left out */
  walls: number[][];
  checks: UnitCheck[];
}
export interface ScheduleRow { tag: string; label: string; size: string; sill: string; kind: string; count: number; where: string }

const BEDS = [1, 2, 3, 0], BATHS = [1, 2, 3, 1];

/** a flat's wall: from x0,z0 along u for L, n pointing out of the flat; on the outside, or onto the corridor */
interface Edge { x0: number; z0: number; ux: number; uz: number; nx: number; nz: number; L: number; out: boolean; corr: boolean }

/** A face of a building divided into bays: from ax,az along u for L, in n bays of bw. */
export interface BayLine {
  ax: number; az: number; ux: number; uz: number; L: number; n: number; bw: number;
  /** the face's outward normal; `inner` when it's against another block of the building (no facade there) */
  nx: number; nz: number; inner: boolean;
}
/** Every face of a building's blocks divided into equal bays, as near `bay` wide as fit, so each face starts and ends
 *  on a bay line (the corners). */
export function facadeBays(quads: number[][], bay: number): BayLine[] {
  const out: BayLine[] = [];
  for (const q of quads) {
    let sa = 0;
    for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; sa += q[i] * q[j + 1] - q[j] * q[i + 1]; }
    const sg = sa > 0 ? 1 : -1;
    for (let i = 0; i < q.length; i += 2) {
      const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]);
      if (L < 0.5) continue;
      const n = Math.max(1, Math.round(L / Math.max(1, bay))), ux = (q[j] - q[i]) / L, uz = (q[j + 1] - q[i + 1]) / L;
      const nx = uz * sg, nz = -ux * sg, mx = (q[i] + q[j]) / 2 + nx * 0.4, mz = (q[i + 1] + q[j + 1]) / 2 + nz * 0.4;
      out.push({ ax: q[i], az: q[i + 1], ux, uz, L, n, bw: L / n, nx, nz, inner: quads.some((o) => o !== q && pointIn(o, mx, mz, 0.01)) });
    }
  }
  return out;
}

/** a bay a flat's wall can use: its index on the face, its centre along the wall, its width, and which way the face
 *  runs against the wall (±1) */
interface Slot { k: number; t: number; bw: number; dir: number }
/** The bays of the face a flat's outside wall lies on that fall within the wall, in order; null when it lies on no
 *  face. A corner kept solid or glazed gives up the face's end bays. */
function slotsOn(e: Edge, lines: BayLine[], comp: Composition): Slot[] | null {
  for (const f of lines) {
    const dot = e.ux * f.ux + e.uz * f.uz;
    if (Math.abs(dot) < 0.999) continue;
    const off = (e.x0 - f.ax) * -f.uz + (e.z0 - f.az) * f.ux;
    if (Math.abs(off) > 0.1) continue;
    const s0 = (e.x0 - f.ax) * f.ux + (e.z0 - f.az) * f.uz, s1 = s0 + e.L * dot;
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    if (hi < 0.05 || lo > f.L - 0.05) continue;
    const ends = (comp.corner === 'solid' || comp.corner === 'glazed') && f.n >= 3;
    const out: Slot[] = [];
    for (let k = 0; k < f.n; k++) {
      if (ends && (k === 0 || k === f.n - 1)) continue;
      if (k * f.bw < lo - 0.05 || (k + 1) * f.bw > hi + 0.05) continue;
      out.push({ k, t: ((k + 0.5) * f.bw - s0) * dot, bw: f.bw, dir: dot });
    }
    // (in the wall's own order, so neighbours along it are neighbours here)
    out.sort((a, c) => a.t - c.t);
    return out;
  }
  return null;
}

function centroid(r: number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  return [x / (r.length / 2), z / (r.length / 2)];
}

/** the rooms' openings a flat wants on its outside walls, the most important first */
function wants(u: Unit, ds: DesignSystem): Tag[] {
  if (u.t === 3) return []; // offices: filled bay by bay below
  const living: Tag = ds.balcony.kind === 'none' ? 'W1' : 'SD';
  const beds: Tag[] = u.t === 0 ? ['W1'] : u.t === 1 ? ['W1', 'W2'] : ['W1', 'W1', 'W2'];
  return [living, ...beds, 'W2', ...Array(BATHS[u.t]).fill('V1')];
}

const sizeOf = (tag: Tag, ds: DesignSystem) => (tag === 'SD' || tag === 'D1' ? { ...ds.doors[tag], sill: 0 } : ds.windows[tag]);

/** the habitable rooms' share of a flat's carpet (living, bedrooms, kitchen: not the toilets, foyer and passages),
 *  which the light rules are a share of; roughly, until the check reads the fitted rooms */
const HABITABLE = 0.8;
/** the share of a jaali that's open: a screened opening gives this much of its light and air (a typical pierced
 *  screen, about half open) */
export const JAALI_OPEN = 0.5;
/** `light`: the glazing a flat needs, as a share of its habitable floor area (UDCPR 1/10 as assumed; DCPR 2034
 *  Reg. 40(1)(a) 1/6), half of it opening. */
export function planFloor(b: SiteReport['buildings'][number], ds: DesignSystem, light = 1 / 10): FloorPlan {
  const openings: Opening[] = [], walls: number[][] = [], checks: UnitCheck[] = [];
  const inside = (x: number, z: number) => b.quads.some((q) => pointIn(q, x, z, 0.01)) || b.cores.some((q) => pointIn(q, x, z, 0.01));
  const inCorridor = (x: number, z: number) => b.corridors.some((q) => pointIn(q, x, z, 0.05));
  const seen = new Set<string>();
  const key = (a: number, c: number, d: number, e: number) => { const p = [a, c, d, e].map((v) => Math.round(v * 10)); return p[0] < p[2] || (p[0] === p[2] && p[1] < p[3]) ? p.join() : [p[2], p[3], p[0], p[1]].join(); };
  const wall = (x0: number, z0: number, x1: number, z1: number) => { const k = key(x0, z0, x1, z1); if (!seen.has(k)) { seen.add(k); walls.push([x0, z0, x1, z1]); } };
  const cl = climateOf(ds), screened = (t: Tag) => (t === 'V1' ? cl.jaali !== 'none' : t === 'W2' && cl.jaali === 'windows');
  const comp = compositionOf(ds), lines = comp.rhythm === 'free' ? [] : facadeBays(b.quads, comp.bay);

  // the entrance on the corridor, a gap in its wall
  // (round a lobby there is no corridor: the door is on the wall against the core)
  const entrance = (edges: Edge[], ui: number, u: Unit) => {
    const atCore = (e: Edge) => b.cores.some((q) => pointIn(q, e.x0 + e.ux * e.L / 2 + e.nx * 0.4, e.z0 + e.uz * e.L / 2 + e.nz * 0.4, 0.05));
    const ce = edges.filter((e) => e.corr).sort((a, c) => c.L - a.L)[0] ?? edges.filter((e) => !e.out && atCore(e)).sort((a, c) => c.L - a.L)[0];
    for (const e of edges) {
      if (e === ce && u.t !== 3) {
        const d = ds.doors.D1, m = Math.min(e.L - d.w / 2 - 0.3, Math.max(d.w / 2 + 0.3, 1.2));
        openings.push({ tag: 'D1', unit: ui, x: e.x0 + e.ux * m, z: e.z0 + e.uz * m, nx: e.nx, nz: e.nz, ux: e.ux, uz: e.uz, w: d.w, h: d.h, sill: 0, outside: false });
        wall(e.x0, e.z0, e.x0 + e.ux * (m - d.w / 2), e.z0 + e.uz * (m - d.w / 2));
        wall(e.x0 + e.ux * (m + d.w / 2), e.z0 + e.uz * (m + d.w / 2), e.x0 + e.ux * e.L, e.z0 + e.uz * e.L);
      } else wall(e.x0, e.z0, e.x0 + e.ux * e.L, e.z0 + e.uz * e.L);
    }
  };

  b.units.forEach((u, ui) => {
    const [cx, cz] = centroid(u.ring);
    const edges: Edge[] = [];
    for (let i = 0; i < u.ring.length; i += 2) {
      const j = (i + 2) % u.ring.length;
      const x0 = u.ring[i], z0 = u.ring[i + 1], x1 = u.ring[j], z1 = u.ring[j + 1], L = Math.hypot(x1 - x0, z1 - z0);
      if (L < 0.5) continue;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      let nx = -uz, nz = ux;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const qx = mx + nx * 0.4, qz = mz + nz * 0.4;
      const corr = inCorridor(qx, qz), out = !corr && !inside(qx, qz);
      edges.push({ x0, z0, ux, uz, nx, nz, L, out, corr });
    }
    // the outside walls take the rooms' openings, longest wall first, as many as fit with 0.9 m piers between
    const outs = edges.filter((e) => e.out).sort((a, c) => c.L - a.L);
    let list = u.t === 3 ? [] : wants(u, ds);
    if (u.t === 3) for (const e of outs) for (let k = 0; k < Math.floor(e.L / 3.2); k++) list.push('W1');
    const need = (l: Tag[]) => l.reduce((s, t) => s + sizeOf(t, ds).w + 0.9, 0);
    const room = outs.reduce((s, e) => s + e.L, 0);
    let toShaft = 0;
    // too little outside wall: toilets ventilate to a duct first, then the kitchen's window goes
    while (list.length && need(list) > room) {
      const v = list.lastIndexOf('V1');
      if (v >= 0) { list.splice(v, 1); toShaft++; continue; }
      list.pop();
    }
    // on a bay rhythm, the openings go into the bays of the building's faces instead (every outside wall has to lie on
    // a face for that; a flat that doesn't keeps the spread below)
    const slots = comp.rhythm === 'free' ? null : outs.map((e) => slotsOn(e, lines, comp));
    if (slots && slots.every((s) => s !== null)) {
      const S = slots as Slot[][], used = S.map(() => new Set<number>());
      const centres: number[][] = S.map(() => []);
      // a free bay (or two side by side for a window wider than one) on wall ei for this size, the one furthest from
      // the openings already there (the first in the middle): its centre along the wall, or null
      const fit = (ei: number, w: number) => {
        const s = S[ei], e = outs[ei];
        let best: { t: number; ks: number[]; score: number } | null = null;
        for (let i = 0; i < s.length; i++) {
          const one = w <= s[i].bw - 0.3, two = !one && i + 1 < s.length && Math.abs(s[i + 1].k - s[i].k) === 1 && w <= 2 * s[i].bw - 0.3;
          if (!one && !two) continue;
          const ks = one ? [i] : [i, i + 1];
          if (ks.some((x) => used[ei].has(x))) continue;
          let t = one ? s[i].t : (s[i].t + s[i + 1].t) / 2;
          // (paired: the two windows of a pair drawn toward each other)
          if (one && comp.rhythm === 'paired') { const sh = Math.min(0.15 * s[i].bw, (s[i].bw - w) / 2 - 0.15); if (sh > 0) t += (s[i].k % 2 ? -1 : 1) * Math.sign(s[i].dir) * sh; }
          const score = centres[ei].length ? Math.min(...centres[ei].map((c) => Math.abs(c - t))) : -Math.abs(t - e.L / 2);
          if (!best || score > best.score) best = { t, ks, score };
        }
        return best;
      };
      const place = (tag: Tag) => {
        const w = sizeOf(tag, ds).w;
        for (let tries = 0; tries < outs.length; tries++) {
          const ei = (bk + tries) % outs.length, f = fit(ei, w);
          if (!f) continue;
          f.ks.forEach((x) => used[ei].add(x)); centres[ei].push(f.t);
          bayPer[ei].push({ tag, t: f.t });
          bk = (ei + 1) % outs.length;
          return true;
        }
        return false;
      };
      const bayPer: { tag: Tag; t: number }[][] = outs.map(() => []);
      let bk = 0, toShaft = 0;
      for (const tag of list) if (!place(tag) && tag === 'V1') toShaft++;
      const hab = u.carpet * HABITABLE, glassOf = (t: Tag) => { const z = sizeOf(t, ds); return z.w * z.h * (screened(t) ? JAALI_OPEN : 1); };
      let have = bayPer.reduce((s, l) => s + l.reduce((q, o) => q + glassOf(o.tag), 0), 0);
      if (u.t === 3) { for (let ei = 0; ei < outs.length; ei++) while (fit(ei, ds.windows.W1.w)) { bk = ei; place('W1'); } }
      else for (let guard = 0; have < hab * light - 1e-6 && guard < 12; guard++) {
        const tag = (['W1', 'W2'] as Tag[]).find((t) => place(t));
        if (!tag) break;
        have += glassOf(tag);
      }
      let glazed = 0, open = 0;
      outs.forEach((e, ei) => {
        for (const { tag, t } of bayPer[ei]) {
          const s = sizeOf(tag, ds);
          openings.push({ tag, unit: ui, x: e.x0 + e.ux * t, z: e.z0 + e.uz * t, nx: e.nx, nz: e.nz, ux: e.ux, uz: e.uz, w: s.w, h: s.h, sill: s.sill, outside: true });
          const jf = screened(tag) ? JAALI_OPEN : 1; glazed += s.w * s.h * jf; open += s.w * s.h * openable(s.kind) * jf;
        }
      });
      entrance(edges, ui, u);
      checks.push({ t: u.t, carpet: u.carpet, glazed, open, light: glazed >= hab * light - 1e-6, air: open >= (hab * light) / 2 - 1e-6, toShaft });
      return;
    }
    const per: Tag[][] = outs.map(() => []);
    let k = 0;
    for (const tag of list) {
      // the next wall with room for it
      for (let tries = 0; tries < outs.length; tries++, k = (k + 1) % outs.length) {
        if (need([...per[k], tag]) <= outs[k].L) { per[k].push(tag); break; }
      }
    }
    // short of the glazing the rules ask (a share of the habitable rooms' floor): more windows where the walls
    // have room, the bigger first, as an architect would size them up
    const hab = u.carpet * HABITABLE, glass = (t: Tag) => { const z = sizeOf(t, ds); return z.w * z.h * (screened(t) ? JAALI_OPEN : 1); };
    let have = per.reduce((s, l) => s + l.reduce((q, t) => q + glass(t), 0), 0);
    if (u.t !== 3) for (let guard = 0; have < hab * light - 1e-6 && guard < 12; guard++) {
      let added = false;
      for (const tag of ['W1', 'W2'] as Tag[]) {
        const i = outs.findIndex((e, ei) => need([...per[ei], tag]) <= e.L);
        if (i >= 0) { per[i].push(tag); have += glass(tag); added = true; break; }
      }
      if (!added) break;
    }
    let glazed = 0, open = 0;
    outs.forEach((e, ei) => {
      const tags = per[ei];
      if (!tags.length) return;
      const used = tags.reduce((s, t) => s + sizeOf(t, ds).w, 0), gap = (e.L - used) / (tags.length + 1);
      let at = gap;
      for (const tag of tags) {
        const s = sizeOf(tag, ds), m = at + s.w / 2;
        openings.push({ tag, unit: ui, x: e.x0 + e.ux * m, z: e.z0 + e.uz * m, nx: e.nx, nz: e.nz, ux: e.ux, uz: e.uz, w: s.w, h: s.h, sill: s.sill, outside: true });
        const jf = screened(tag) ? JAALI_OPEN : 1; glazed += s.w * s.h * jf; open += s.w * s.h * openable(s.kind) * jf;
        at += s.w + gap;
      }
    });
    entrance(edges, ui, u);
    checks.push({ t: u.t, carpet: u.carpet, glazed, open, light: glazed >= hab * light - 1e-6, air: open >= (hab * light) / 2 - 1e-6, toShaft });
  });
  for (const q of b.cores) for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; wall(q[i], q[i + 1], q[j], q[j + 1]); }
  return { openings, walls, checks };
}

/** The door and window schedule for the whole scheme: the typical floor's openings times its floors, plus the doors
 *  inside the flats (a room door per bedroom, a toilet door per toilet). */
export function schedule(d: SiteReport, plans: FloorPlan[], ds: DesignSystem, shopFloors: (b: number, unit: number) => number = () => 0): ScheduleRow[] {
  const n: Record<string, number> = { D1: 0, D2: 0, D3: 0, SD: 0, W1: 0, W2: 0, V1: 0 };
  d.buildings.forEach((b, i) => {
    // (a flat given over to shops on some floors has none of its doors and windows there; a formed building's
    // typical floor repeats only on the floors like it, the others not scheduled yet)
    const floors = b.repeats ?? b.floors;
    for (const o of plans[i].openings) n[o.tag] += floors - shopFloors(i, o.unit);
    b.units.forEach((u, ui) => { if (u.t === 3) return; const f = floors - shopFloors(i, ui); n.D2 += BEDS[u.t] * f; n.D3 += BATHS[u.t] * f; });
  });
  const m = (v: number) => `${v.toFixed(2)}`;
  const door = (t: 'D1' | 'D2' | 'D3' | 'SD', where: string): ScheduleRow => { const x = ds.doors[t]; return { tag: t, label: x.label, size: `${m(x.w)} × ${m(x.h)} m`, sill: '—', kind: x.kind.replace('-', ' '), count: n[t], where }; };
  const win = (t: 'W1' | 'W2' | 'V1', where: string): ScheduleRow => { const x = ds.windows[t]; return { tag: t, label: x.label, size: `${m(x.w)} × ${m(x.h)} m`, sill: `${m(x.sill)} m`, kind: x.kind, count: n[t], where }; };
  return [
    door('D1', 'Flat entrances'), door('D2', 'Bedrooms'), door('D3', 'Toilets'), door('SD', 'Balconies, living rooms'),
    win('W1', 'Living rooms, bedrooms'), win('W2', 'Bedrooms, kitchens'), win('V1', 'Toilets on an outside wall'),
  ].filter((r) => r.count > 0);
}
