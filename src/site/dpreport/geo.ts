// The DP report in the browser: loads the traced Development Plan from public/dpr/<city>/ (tools/dpreport/
// bake-dpreport.ts) by 1 km cell, and answers "what does the plan say here?" for a point. No map library: the viewer
// (./map.ts) and the printed report (./print.ts) both use this.
import { BASE } from '../../auth/auth';

export interface Frame { lat0: number; lon0: number; kx: number; kz: number }
export interface DprIndex {
  city: string; cell: number; frame: Frame; unit: number; cells: string[]; center: [number, number];
  classes: Record<string, { label: string; color: string }>; sheets: string[]; tiles: string; source: string;
}
/** A DP parcel: rings as [lat, lon] pairs (outer first, then holes), per polygon. */
export interface Parcel { id: string; cls: string; reserved: boolean; area: number; conf: number; sheet: string; polys: [number, number][][][]; box: [number, number, number, number] }
export interface DpRoad { name: string | null; w: number; dp: number; line: [number, number][] }
export interface DpTile { file: string; x0: number; z0: number; size: number }

const url = (p: string) => `${BASE}${p}`;
let index: Promise<DprIndex> | null = null;
export const loadIndex = (city = 'pune') => (index ??= fetch(url(`dpr/${city}/index.json`)).then((r) => r.json()));

let tiles: Promise<{ res: number; tiles: DpTile[] }> | null = null;
export const loadTiles = async (): Promise<{ res: number; tiles: DpTile[] }> => { const I = await loadIndex(); return (tiles ??= fetch(url(I.tiles)).then((r) => r.json())); };
export const tileUrl = async (t: DpTile) => { const I = await loadIndex(); return url(I.tiles.replace(/[^/]+$/, '') + t.file); };

export const toLatLon = (F: Frame, x: number, z: number): [number, number] => [F.lat0 - z / F.kz, F.lon0 + x / F.kx];
export const toXZ = (F: Frame, lat: number, lon: number): [number, number] => [(lon - F.lon0) * F.kx, -(lat - F.lat0) * F.kz];

const cells = new Map<string, Promise<{ plots: Parcel[]; roads: DpRoad[] }>>();
/** One 1 km cell's parcels and DP roads (empty where the plan has none). */
export async function loadCell(key: string): Promise<{ plots: Parcel[]; roads: DpRoad[] }> {
  const I = await loadIndex();
  if (!I.cells.includes(key)) return { plots: [], roads: [] };
  let p = cells.get(key);
  if (!p) {
    p = fetch(url(`dpr/${I.city}/c_${key}.json`)).then((r) => r.json()).then((raw: any) => {
      const F = I.frame, u = I.unit;
      const ring = (flat: number[]): [number, number][] => { const o: [number, number][] = []; for (let i = 0; i < flat.length; i += 2) o.push(toLatLon(F, flat[i] * u, flat[i + 1] * u)); return o; };
      const plots: Parcel[] = raw.plots.map((q: any) => {
        const polys = q.g.map((poly: number[][]) => poly.map(ring));
        let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
        for (const poly of polys) for (const [la, lo] of poly[0]) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
        return { id: q.id, cls: q.c, reserved: !!q.r, area: q.a, conf: q.k, sheet: q.s, polys, box: [s, w, n, e] };
      });
      const roads: DpRoad[] = raw.roads.map((r: any) => ({ name: r.n, w: r.w, dp: r.dp, line: ring(r.g) }));
      return { plots, roads };
    });
    cells.set(key, p);
  }
  return p;
}

/** The cell keys covering a lat/lon box. */
export async function cellsIn(s: number, w: number, n: number, e: number): Promise<string[]> {
  const I = await loadIndex(), F = I.frame, C = I.cell;
  const [x0, z1] = toXZ(F, s, w), [x1, z0] = toXZ(F, n, e);
  const out: string[] = [];
  for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
    const k = `${i}_${j}`; if (I.cells.includes(k)) out.push(k);
  }
  return out;
}

/** Parcels and roads round a point (deduplicated: a parcel sits in every cell its box touches). */
export async function around(lat: number, lon: number, m: number) {
  const dLat = m / 110540, dLon = m / (111320 * Math.cos((lat * Math.PI) / 180));
  const keys = await cellsIn(lat - dLat, lon - dLon, lat + dLat, lon + dLon);
  const got = await Promise.all(keys.map(loadCell));
  const plots = new Map<string, Parcel>(), roads = new Set<DpRoad>();
  for (const c of got) { for (const p of c.plots) plots.set(p.id, p); for (const r of c.roads) roads.add(r); }
  return { plots: [...plots.values()], roads: [...roads] };
}

function inRing(lat: number, lon: number, r: [number, number][]) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ai, oi] = r[i], [aj, oj] = r[j];
    if ((ai > lat) !== (aj > lat) && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) inside = !inside;
  }
  return inside;
}
export const contains = (p: Parcel, lat: number, lon: number) =>
  lat >= p.box[0] && lat <= p.box[2] && lon >= p.box[1] && lon <= p.box[3] &&
  p.polys.some((poly) => inRing(lat, lon, poly[0]) && !poly.slice(1).some((h) => inRing(lat, lon, h)));

/** metres between two points (equirectangular: fine at city scale) */
export function dist(a: [number, number], b: [number, number]) {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * k);
}
function distToLine(p: [number, number], line: [number, number][]) {
  const k = 111320 * Math.cos((p[0] * Math.PI) / 180), X = (q: [number, number]) => [(q[1] - p[1]) * k, (q[0] - p[0]) * 110540];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = X(line[i - 1]), [bx, bz] = X(line[i]), dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, -(ax * dx + az * dz) / L));
    best = Math.min(best, Math.hypot(ax + t * dx, az + t * dz));
  }
  return best;
}
const centreOf = (p: Parcel): [number, number] => { const r = p.polys[0][0]; let a = 0, o = 0; for (const [la, lo] of r) { a += la; o += lo; } return [a / r.length, o / r.length]; };
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const dirOf = (from: [number, number], to: [number, number]) => {
  const dx = (to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180), dz = to[0] - from[0];
  return DIRS[Math.round((((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360) / 45) % 8];
};

export interface Report {
  lat: number; lon: number;
  /** the parcel the point is in (null: a road on the plan, or not traced) */
  parcel: Parcel | null;
  /** the point is on the DP sheets at all */
  covered: boolean;
  /** land use within 100 m (% of the circle) */
  mix: { cls: string; pct: number }[]; unmarked: number;
  reserved: { p: Parcel; m: number; dir: string; at: [number, number] }[];
  roads: { name: string; w: number; dp: number; m: number }[];
}

/** What the traced plan says at a point. */
export async function reportAt(lat: number, lon: number): Promise<Report> {
  const { plots, roads } = await around(lat, lon, 260);
  const at: [number, number] = [lat, lon];
  const parcel = plots.find((p) => contains(p, lat, lon)) ?? null;
  // land use within 100 m: a 5 m grid
  const R = 100, S = 5, k = 111320 * Math.cos((lat * Math.PI) / 180), tally = new Map<string, number>();
  let tot = 0, none = 0;
  const pool = plots.filter((p) => p.box[0] <= lat + R / 110540 && p.box[2] >= lat - R / 110540 && p.box[1] <= lon + R / k && p.box[3] >= lon - R / k);
  for (let dx = -R; dx <= R; dx += S) for (let dz = -R; dz <= R; dz += S) {
    if (dx * dx + dz * dz > R * R) continue;
    tot++;
    const q = pool.find((p) => contains(p, lat + dz / 110540, lon + dx / k));
    if (q) tally.set(q.cls, (tally.get(q.cls) ?? 0) + 1); else none++;
  }
  const mix = [...tally].map(([cls, c]) => ({ cls, pct: Math.round((c / tot) * 100) })).filter((m) => m.pct > 0).sort((a, b) => b.pct - a.pct);
  const reserved = plots.filter((p) => p.reserved && p.area >= 100).map((p) => {
    const c = centreOf(p), inside = contains(p, lat, lon);
    return { p, m: inside ? 0 : Math.round(dist(at, c) / 5) * 5, dir: dirOf(at, c), at: c };
  }).filter((r) => r.m <= 250).sort((a, b) => a.m - b.m).slice(0, 8);
  const byName = new Map<string, { name: string; w: number; dp: number; m: number }>();
  for (const r of roads) {
    const m = Math.round(distToLine(at, r.line));
    if (m > 150) continue;
    const name = r.name ?? 'Unnamed road', prev = byName.get(name);
    if (!prev || m < prev.m) byName.set(name, { name, w: r.w, dp: r.dp, m });
  }
  return {
    lat, lon, parcel, covered: plots.length > 0 && none / tot < 0.97,
    mix, unmarked: Math.round((none / tot) * 100), reserved,
    roads: [...byName.values()].sort((a, b) => a.m - b.m).slice(0, 5),
  };
}
