// Windows and doors, placed from the design system's catalog: every flat on a typical floor gets the openings its
// rooms need along its outside walls (a balcony door or a big window for the living room, a window per bedroom and
// the kitchen, a ventilator per toilet), spread evenly with piers between, and its entrance door on the corridor.
// From the same placement: the door and window schedule, and a light and ventilation check per flat (openings at
// least 1/10 of the floor area for light, half that opening for air, as UDCPR's habitable-room rule asks; checked
// by flat until rooms are modelled).
import { pointIn, type SiteReport, type Unit } from '../doc/site';
import { openable, type DesignSystem } from './design';

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

export function planFloor(b: SiteReport['buildings'][number], ds: DesignSystem): FloorPlan {
  const openings: Opening[] = [], walls: number[][] = [], checks: UnitCheck[] = [];
  const inside = (x: number, z: number) => b.quads.some((q) => pointIn(q, x, z, 0.01)) || b.cores.some((q) => pointIn(q, x, z, 0.01));
  const inCorridor = (x: number, z: number) => b.corridors.some((q) => pointIn(q, x, z, 0.05));
  const seen = new Set<string>();
  const key = (a: number, c: number, d: number, e: number) => { const p = [a, c, d, e].map((v) => Math.round(v * 10)); return p[0] < p[2] || (p[0] === p[2] && p[1] < p[3]) ? p.join() : [p[2], p[3], p[0], p[1]].join(); };
  const wall = (x0: number, z0: number, x1: number, z1: number) => { const k = key(x0, z0, x1, z1); if (!seen.has(k)) { seen.add(k); walls.push([x0, z0, x1, z1]); } };

  b.units.forEach((u, ui) => {
    const [cx, cz] = centroid(u.ring);
    const edges: { x0: number; z0: number; ux: number; uz: number; nx: number; nz: number; L: number; out: boolean; corr: boolean }[] = [];
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
    const per: Tag[][] = outs.map(() => []);
    let k = 0;
    for (const tag of list) {
      // the next wall with room for it
      for (let tries = 0; tries < outs.length; tries++, k = (k + 1) % outs.length) {
        if (need([...per[k], tag]) <= outs[k].L) { per[k].push(tag); break; }
      }
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
        glazed += s.w * s.h; open += s.w * s.h * openable(s.kind);
        at += s.w + gap;
      }
    });
    // the entrance on the corridor, a gap in its wall
    const ce = edges.filter((e) => e.corr).sort((a, c) => c.L - a.L)[0];
    for (const e of edges) {
      if (e === ce && u.t !== 3) {
        const d = ds.doors.D1, m = Math.min(e.L - d.w / 2 - 0.3, Math.max(d.w / 2 + 0.3, 1.2));
        openings.push({ tag: 'D1', unit: ui, x: e.x0 + e.ux * m, z: e.z0 + e.uz * m, nx: e.nx, nz: e.nz, ux: e.ux, uz: e.uz, w: d.w, h: d.h, sill: 0, outside: false });
        wall(e.x0, e.z0, e.x0 + e.ux * (m - d.w / 2), e.z0 + e.uz * (m - d.w / 2));
        wall(e.x0 + e.ux * (m + d.w / 2), e.z0 + e.uz * (m + d.w / 2), e.x0 + e.ux * e.L, e.z0 + e.uz * e.L);
      } else wall(e.x0, e.z0, e.x0 + e.ux * e.L, e.z0 + e.uz * e.L);
    }
    checks.push({ t: u.t, carpet: u.carpet, glazed, open, light: glazed >= u.carpet / 10 - 1e-6, air: open >= u.carpet / 20 - 1e-6, toShaft });
  });
  for (const q of b.cores) for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; wall(q[i], q[i + 1], q[j], q[j + 1]); }
  return { openings, walls, checks };
}

/** The door and window schedule for the whole scheme: the typical floor's openings times its floors, plus the doors
 *  inside the flats (a room door per bedroom, a toilet door per toilet). */
export function schedule(d: SiteReport, plans: FloorPlan[], ds: DesignSystem, shopFloors: (b: number, unit: number) => number = () => 0): ScheduleRow[] {
  const n: Record<string, number> = { D1: 0, D2: 0, D3: 0, SD: 0, W1: 0, W2: 0, V1: 0 };
  d.buildings.forEach((b, i) => {
    // (a flat given over to shops on some floors has none of its doors and windows there)
    for (const o of plans[i].openings) n[o.tag] += b.floors - shopFloors(i, o.unit);
    b.units.forEach((u, ui) => { if (u.t === 3) return; const f = b.floors - shopFloors(i, ui); n.D2 += BEDS[u.t] * f; n.D3 += BATHS[u.t] * f; });
  });
  const m = (v: number) => `${v.toFixed(2)}`;
  const door = (t: 'D1' | 'D2' | 'D3' | 'SD', where: string): ScheduleRow => { const x = ds.doors[t]; return { tag: t, label: x.label, size: `${m(x.w)} × ${m(x.h)} m`, sill: '—', kind: x.kind.replace('-', ' '), count: n[t], where }; };
  const win = (t: 'W1' | 'W2' | 'V1', where: string): ScheduleRow => { const x = ds.windows[t]; return { tag: t, label: x.label, size: `${m(x.w)} × ${m(x.h)} m`, sill: `${m(x.sill)} m`, kind: x.kind, count: n[t], where }; };
  return [
    door('D1', 'Flat entrances'), door('D2', 'Bedrooms'), door('D3', 'Toilets'), door('SD', 'Balconies, living rooms'),
    win('W1', 'Living rooms, bedrooms'), win('W2', 'Bedrooms, kitchens'), win('V1', 'Toilets on an outside wall'),
  ].filter((r) => r.count > 0);
}
