// Rooms inside the flats: a flat template fitted into every unit of a typical floor. The generator lays flats as
// plates (src/doc/site.ts); this splits each plate the way Indian flats are usually planned:
// - a band along the outside wall for the rooms that need daylight: the living room by the entrance, then the
//   bedrooms (the master first);
// - behind it, a wet band of kitchen, utility and toilets (toilets ventilate to a duct when they can't reach the
//   outside wall, as openings.ts assumes);
// - a foyer and passage along the corridor wall, when the flat is deep enough to want one.
// Widths go out minimum first (each room gets its rule's minimum width, then the rest is shared by weight), so a
// narrow flat squeezes its rooms evenly and the checks show where it falls short. Units that aren't simple
// rectangles (corner flats) are laid out in the rectangle round them and each room cut to the flat's outline.
// The minimum sizes are UDCPR 2020's room rules as commonly summarised (chapter 9), as assumed: check them.
import type { BuildingReport } from '../doc/site';
import { area as mpArea, fromFlat, inter, outlines } from '../doc/ground';
import type { FloorPlan } from './openings';

export type RoomKind = 'living' | 'bed' | 'kitchen' | 'toilet' | 'bath' | 'foyer' | 'balcony' | 'utility' | 'passage';
export interface Room {
  kind: RoomKind; name: string;
  /** world x, z, … */
  ring: number[];
  area: number;
  /** its narrow side (m) */
  width: number;
  minArea: number; minWidth: number;
  ok: boolean;
}
export interface FlatRooms {
  unit: number; t: number; rooms: Room[]; ok: boolean;
  /** partitions between the rooms (x0, z0, x1, z1): room edges that aren't on the flat's own walls */
  walls: number[][];
}

/** Minimum carpet area (m²) and width (m) by room, as assumed from UDCPR 2020 chapter 9 (one habitable room at
 *  9.5 m², the others 7.5 m², both 2.4 m wide; kitchen 5.5 m² and 1.8 m; a toilet with bath and WC 2.8 m² and
 *  1.2 m; a bath alone 1.8 m²; a passage 1.0 m wide). */
export const ROOM_MIN: Record<RoomKind, { area: number; width: number }> = {
  living: { area: 9.5, width: 2.4 },
  bed: { area: 7.5, width: 2.4 },
  kitchen: { area: 5.5, width: 1.8 },
  toilet: { area: 2.8, width: 1.2 },
  bath: { area: 1.8, width: 1.2 },
  foyer: { area: 0, width: 1.0 },
  passage: { area: 0, width: 1.0 },
  utility: { area: 0, width: 0.9 },
  balcony: { area: 0, width: 0.9 },
};

export const ROOM_COLOR: Record<RoomKind, string> = {
  living: '#f3c26b', bed: '#8fb8e8', kitchen: '#e88f6a', toilet: '#7fd1c7', bath: '#7fd1c7',
  foyer: '#d9d4c7', passage: '#d9d4c7', utility: '#c7b8e0', balcony: '#b9dca0',
};

const BEDS = [1, 2, 3], BATHS = [1, 2, 3];
const TOILET_W = 1.6, KITCHEN_MAX = 3.6, UTILITY_MAX = 2.0;

interface Item { kind: RoomKind; name: string; min: number; weight: number; max?: number }

/** Share `W` among the items: each its minimum width first, the rest by weight (no more than its max, the spill to
 *  the others); squeezed in proportion when even the minimums don't fit. */
function share(items: Item[], W: number): number[] {
  const mins = items.map((x) => x.min), sum = mins.reduce((s, v) => s + v, 0);
  if (sum >= W) return mins.map((m) => (m * W) / (sum || 1));
  const w = [...mins];
  let rest = W - sum, open = items.map((_, i) => i);
  for (let pass = 0; pass < 6 && rest > 1e-6 && open.length; pass++) {
    const tw = open.reduce((s, i) => s + items[i].weight, 0) || 1;
    let spill = 0;
    const next: number[] = [];
    for (const i of open) {
      const add = (rest * items[i].weight) / tw, cap = items[i].max ?? Infinity;
      if (w[i] + add > cap) { spill += w[i] + add - cap; w[i] = cap; } else { w[i] += add; next.push(i); }
    }
    rest = spill; open = next;
  }
  // nothing left to take the spill: the last item has it
  if (rest > 1e-6) w[w.length - 1] += rest;
  return w;
}

function centroid(r: number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  return [x / (r.length / 2), z / (r.length / 2)];
}
function ringArea(r: number[]) { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a / 2); }
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const onRing = (r: number[], x: number, z: number, tol = 0.05) => {
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; if (segDist(x, z, r[i], r[i + 1], r[j], r[j + 1]) < tol) return true; }
  return false;
};

/** The flat's frame: origin and `u` along its outside wall, `v` into the flat. The outside wall is the edge the
 *  outside openings sit on (the longest of them), else the one facing the corridor's opposite, else the longest. */
function frameOf(ring: number[], ui: number, plan: FloorPlan) {
  const [cx, cz] = centroid(ring);
  const edges: { x0: number; z0: number; ux: number; uz: number; nx: number; nz: number; L: number; out: number; door: boolean }[] = [];
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length, x0 = ring[i], z0 = ring[i + 1], L = Math.hypot(ring[j] - x0, ring[j + 1] - z0);
    if (L < 0.3) continue;
    const ux = (ring[j] - x0) / L, uz = (ring[j + 1] - z0) / L;
    // n into the flat
    let nx = -uz, nz = ux;
    if ((cx - (x0 + ring[j]) / 2) * nx + (cz - (z0 + ring[j + 1]) / 2) * nz < 0) { nx = -nx; nz = -nz; }
    let out = 0, door = false;
    for (const o of plan.openings) {
      if (o.unit !== ui || segDist(o.x, o.z, x0, z0, ring[j], ring[j + 1]) > 0.1) continue;
      if (o.outside) out += o.w; else door = true;
    }
    edges.push({ x0, z0, ux, uz, nx, nz, L, out, door });
  }
  const doorEdge = edges.find((e) => e.door);
  let face = [...edges].filter((e) => e.out > 0).sort((a, b) => b.out - a.out || b.L - a.L)[0];
  // no outside openings: the edge facing away from the entrance, else the longest
  if (!face && doorEdge) face = [...edges].sort((a, b) => (a.nx * doorEdge.nx + a.nz * doorEdge.nz) - (b.nx * doorEdge.nx + b.nz * doorEdge.nz))[0];
  if (!face) face = [...edges].sort((a, b) => b.L - a.L)[0];
  const { x0: ox, z0: oz, ux, uz, nx, nz } = face;
  const toL = (x: number, z: number): [number, number] => [(x - ox) * ux + (z - oz) * uz, (x - ox) * nx + (z - oz) * nz];
  const toW = (u: number, v: number): [number, number] => [ox + ux * u + nx * v, oz + uz * u + nz * v];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { const [u, v] = toL(ring[i], ring[i + 1]); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  // the entrance: which end of the frame it's nearer (the living room goes there)
  const d1 = plan.openings.find((o) => o.unit === ui && o.tag === 'D1');
  const entryAtEnd = d1 ? toL(d1.x, d1.z)[0] > (u0 + u1) / 2 : false;
  const rect = Math.abs(ringArea(ring) - (u1 - u0) * (v1 - v0)) < 0.02 * (u1 - u0) * (v1 - v0);
  return { toL, toW, u0, u1, v0, v1, entryAtEnd, rect };
}

/** The template for a flat type: the daylight band's rooms, the wet band's. */
function template(t: number): { front: Item[]; wet: Item[] } {
  const beds = BEDS[t] ?? 1, baths = BATHS[t] ?? 1;
  const front: Item[] = [{ kind: 'living', name: 'Living', min: ROOM_MIN.living.width, weight: 1.45 }];
  for (let i = 0; i < beds; i++) front.push({ kind: 'bed', name: i === 0 ? (beds > 1 ? 'Master bedroom' : 'Bedroom') : `Bedroom ${i + 1}`, min: ROOM_MIN.bed.width, weight: i === 0 ? 1.15 : 1 });
  const wet: Item[] = [{ kind: 'kitchen', name: 'Kitchen', min: ROOM_MIN.kitchen.width, weight: 1, max: KITCHEN_MAX }];
  if (t >= 1) wet.push({ kind: 'utility', name: 'Utility', min: 0.9, weight: 0.6, max: UTILITY_MAX });
  for (let i = 0; i < baths; i++) wet.push({ kind: 'toilet', name: baths > 1 ? `Toilet ${i + 1}` : 'Toilet', min: ROOM_MIN.toilet.width, weight: 0.25, max: TOILET_W + 0.4 });
  // whatever the wet band has left over: a dining space by the kitchen
  wet.push({ kind: 'living', name: 'Dining', min: 0, weight: 0.01 });
  return { front, wet };
}

/** Fit the rooms into every flat on a building's typical floor. */
/** DCPR 2034 Table 14 (Reg. 37(2)), read from the regulation: habitable rooms and the kitchen by width only (2.4 m,
 *  1.8 m), a bathroom 1.5 m² and 1.1 m, a combined bath and WC 2.2 m² and 1.1 m. */
export const ROOM_MIN_DCPR: Record<RoomKind, { area: number; width: number }> = {
  ...ROOM_MIN,
  living: { area: 0, width: 2.4 }, bed: { area: 0, width: 2.4 }, kitchen: { area: 0, width: 1.8 },
  toilet: { area: 2.2, width: 1.1 }, bath: { area: 1.5, width: 1.1 },
};
export const roomMin = (code?: string) => (code && code !== 'udcpr' ? ROOM_MIN_DCPR : ROOM_MIN);

export function fitRooms(b: BuildingReport, plan: FloorPlan, code?: string): FlatRooms[] {
  const MIN = roomMin(code);
  return b.units.map((u, ui): FlatRooms => {
    if (u.t === 3) return { unit: ui, t: u.t, rooms: [], ok: true, walls: [] };
    const F = frameOf(u.ring, ui, plan);
    const W = F.u1 - F.u0, D = F.v1 - F.v0;
    // the bands: daylight rooms ~55 % of the depth (at least 3 m, at most 5 m), the wet band behind, a passage
    // along the corridor when what's left is deep enough for both
    const front = Math.min(5, Math.max(3, D * 0.55));
    const back = Math.max(0, D - front);
    const wetD = back > 3.6 ? Math.min(3, Math.max(2.4, back * 0.6)) : back;
    const passD = back - wetD;
    const T = template(u.t);
    const cells: { kind: RoomKind; name: string; a: number; b: number; c: number; d: number }[] = [];
    const lay = (items: Item[], va: number, vb: number) => {
      if (vb - va < 0.3) return;
      const ws = share(items, W);
      // a dining space too narrow to use goes to the kitchen
      const di = items.findIndex((x) => x.name === 'Dining'), ki = items.findIndex((x) => x.kind === 'kitchen');
      if (di >= 0 && ki >= 0 && ws[di] < 1.2) { ws[ki] += ws[di]; ws[di] = 0; }
      // the living room by the entrance: lay from whichever end it's at
      let at = 0;
      items.forEach((x, i) => {
        if (ws[i] < 0.05) { at += ws[i]; return; }
        const a = F.entryAtEnd ? F.u1 - at - ws[i] : F.u0 + at, c = a + ws[i];
        cells.push({ kind: x.kind, name: x.name, a, b: F.v0 + va, c, d: F.v0 + vb });
        at += ws[i];
      });
    };
    lay(T.front, 0, front);
    // (a shallow flat has no wet band of its own: the kitchen and toilets share the daylight band's depth)
    if (wetD >= 1.2) lay(T.wet, front, front + wetD);
    if (passD >= 0.6) cells.push({ kind: 'passage', name: 'Foyer & passage', a: F.u0, b: F.v0 + front + wetD, c: F.u1, d: F.v1 });

    const rooms: Room[] = [];
    for (const c of cells) {
      const corners = [F.toW(c.a, c.b), F.toW(c.c, c.b), F.toW(c.c, c.d), F.toW(c.a, c.d)].flat();
      let ring = corners;
      if (!F.rect) {
        // a corner flat: the room cut to the flat's outline (its largest piece)
        const pieces = outlines(inter(fromFlat(corners), fromFlat(u.ring)));
        if (!pieces.length) continue;
        ring = pieces.sort((p, q) => ringArea(q) - ringArea(p))[0];
      }
      const area = F.rect ? (c.c - c.a) * (c.d - c.b) : mpArea(fromFlat(ring));
      if (area < 0.3) continue;
      let ua = Infinity, ub = -Infinity, va = Infinity, vb = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { const [uu, vv] = F.toL(ring[i], ring[i + 1]); ua = Math.min(ua, uu); ub = Math.max(ub, uu); va = Math.min(va, vv); vb = Math.max(vb, vv); }
      const width = Math.min(ub - ua, vb - va), m = MIN[c.kind];
      // (the dining space is whatever's left: never a failing room of its own)
      const minArea = c.name === 'Dining' ? 0 : m.area, minWidth = c.name === 'Dining' ? 0 : m.width;
      rooms.push({ kind: c.kind, name: c.name, ring, area, width, minArea, minWidth, ok: area >= minArea - 0.05 && width >= minWidth - 0.02 });
    }

    // partitions: room edges not on the flat's own walls, each once
    const walls: number[][] = [], seen = new Set<string>();
    for (const r of rooms) for (let i = 0; i < r.ring.length; i += 2) {
      const j = (i + 2) % r.ring.length, x0 = r.ring[i], z0 = r.ring[i + 1], x1 = r.ring[j], z1 = r.ring[j + 1];
      if (Math.hypot(x1 - x0, z1 - z0) < 0.1) continue;
      if (onRing(u.ring, (x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const k = [x0, z0, x1, z1].map((v) => Math.round(v * 20)), key = k[0] < k[2] || (k[0] === k[2] && k[1] <= k[3]) ? k.join() : [k[2], k[3], k[0], k[1]].join();
      if (seen.has(key)) continue;
      seen.add(key); walls.push([x0, z0, x1, z1]);
    }
    return { unit: ui, t: u.t, rooms, ok: rooms.every((r) => r.ok), walls };
  });
}
