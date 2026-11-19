// The ground under a plot from the city's terrain (the regions baked for the city editor): where a plot has a real
// place (found by its survey number, or imported with coordinates), its slope and the way it falls are read off the
// terrain grid round it, as a plane fitted through the heights. The grid is about 8 m and the source elevation data
// coarser still, so this is a fair first figure for a plot, not a survey: a contour survey overrides it.
import { loadManifest, loadPiece, type Piece, type RegionManifest } from '../data/region';

const BASE = `${import.meta.env.BASE_URL}regions/`;
const REGIONS = ['pune', 'mumbai'];

/** UTM (WGS84) easting / northing in a northern zone to latitude / longitude. Zone 43 covers Pune and Mumbai. */
export function utmToLatLon(E: number, N: number, zone = 43): [number, number] {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const x = E - 500000, y = N, m = y / k0, mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const n1 = a / Math.sqrt(1 - e2 * s * s), t1 = t * t, c1 = ep2 * c * c, r1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5, d = x / (n1 * k0);
  const lat = p1 - ((n1 * t) / r1) * (d * d / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / c;
  return [(lat * 180) / Math.PI, (zone - 1) * 6 - 180 + 3 + (lon * 180) / Math.PI];
}

const manifests = new Map<string, Promise<RegionManifest | null>>();
const pieces = new Map<string, Promise<Piece | null>>();
const manifest = (id: string) => { if (!manifests.has(id)) manifests.set(id, loadManifest(BASE + id + '/').catch(() => null)); return manifests.get(id)!; };
const piece = (id: string, i: number, j: number) => { const k = `${id}:${i}_${j}`; if (!pieces.has(k)) pieces.set(k, loadPiece(BASE + id + '/', i, j).catch(() => null)); return pieces.get(k)!; };

export interface Ground { elevation: number; slope: number; dir: number; region: string; /** the ground's rise per metre east (x) and south (z), as fitted */ gx: number; gz: number }

/** The ground round a place, `radius` metres each way: its height over sea level, its slope (%) and the compass
 *  bearing it falls toward. Null where no city's terrain covers it. */
/** A plane through heights at offsets (dx east, dz south, h): the ground's middle, slope and fall. */
function fitPlane(S: [number, number, number][], region: string): Ground | null {
  if (S.length < 5) return null;
  const n = S.length, mh = S.reduce((s, q) => s + q[2], 0) / n;
  let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  for (const [dx, dz, v] of S) { sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxh += dx * (v - mh); szh += dz * (v - mh); }
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-9) return null;
  const b = (sxh * szz - szh * sxz) / det, c = (szh * sxx - sxh * sxz) / det;
  return { elevation: Math.round(mh * 10) / 10, slope: Math.round(Math.hypot(b, c) * 1000) / 10, dir: Math.round(((Math.atan2(-b, c) * 180) / Math.PI + 360) % 360), region, gx: b, gz: c };
}

/** Anywhere else, only when asked: Open-Meteo's free elevation service (Copernicus DEM, 90 m), which is sent the
 *  plot's location. At 90 m it sees the lie of the land round a plot, not the plot itself. */
export async function groundOpen(lat: number, lon: number, radius = 45): Promise<Ground | null> {
  const r = Math.max(45, radius), kx = 111_320 * Math.cos((lat * Math.PI) / 180), kz = 110_540;
  const off: [number, number][] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) off.push([i * r, j * r]);
  const la = off.map(([, dz]) => (lat - dz / kz).toFixed(6)).join(','), lo = off.map(([dx]) => (lon + dx / kx).toFixed(6)).join(',');
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`);
  if (!res.ok) return null;
  const h = ((await res.json()) as { elevation?: number[] }).elevation;
  if (!h || h.length !== off.length) return null;
  return fitPlane(off.map(([dx, dz], k) => [dx, dz, h[k]]), 'open');
}

export async function groundAt(lat: number, lon: number, radius = 25): Promise<Ground | null> {
  for (const id of REGIONS) {
    const M = await manifest(id);
    if (!M) continue;
    const F = M.frame, x = (lon - F.lon0) * F.kx, z = -(lat - F.lat0) * F.kz, [bx0, bz0, bx1, bz1] = M.bounds;
    if (x < bx0 || x > bx1 || z < bz0 || z > bz1) continue;
    const P = M.piece;
    const h = async (px: number, pz: number): Promise<number | null> => {
      const p = await piece(id, Math.floor(px / P), Math.floor(pz / P));
      if (!p) return null;
      const [x0, z0, x1] = p.rect, cell = (x1 - x0) / (p.n - 1);
      const fi = (px - x0) / cell, fj = (pz - z0) / cell, i = Math.min(p.n - 2, Math.floor(fi)), j = Math.min(p.n - 2, Math.floor(fj)), u = fi - i, v = fj - j;
      const H = (a: number, b: number) => p.heights[b * p.n + a];
      return (H(i, j) * (1 - u) + H(i + 1, j) * u) * (1 - v) + (H(i, j + 1) * (1 - u) + H(i + 1, j + 1) * u) * v;
    };
    // a plane through a 7 × 7 grid of heights: h = a + b·dx + c·dz
    const S: [number, number, number][] = [];
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
      const dx = (i / 3) * radius, dz = (j / 3) * radius, v = await h(x + dx, z + dz);
      if (v !== null && Number.isFinite(v)) S.push([dx, dz, v]);
    }
    if (S.length < 9) return null;
    const n = S.length, mh = S.reduce((s, q) => s + q[2], 0) / n;
    let sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
    for (const [dx, dz, v] of S) { sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxh += dx * (v - mh); szh += dz * (v - mh); }
    const det = sxx * szz - sxz * sxz;
    if (Math.abs(det) < 1e-9) return null;
    const b = (sxh * szz - szh * sxz) / det, c = (szh * sxx - sxh * sxz) / det;
    const slope = Math.hypot(b, c) * 100;
    // downhill is −(b, c) in x (east), z (south): its bearing from north, clockwise
    const dir = ((Math.atan2(-b, c) * 180) / Math.PI + 360) % 360;
    return { elevation: Math.round(mh * 10) / 10, slope: Math.round(slope * 10) / 10, dir: Math.round(dir), region: id, gx: b, gz: c };
  }
  return null;
}

/** The plot's middle over its front road, off the fitted ground: the road's centre line is `roadW / 2` out from the
 *  middle of the front edge (ring in metres about the plot's middle, x east, z south, as an imported outline is). */
export function plotOverRoad(g: Ground, ring: number[], front: number, roadW: number): number {
  const n = ring.length / 2, a = front, b = (front + 1) % n;
  const ax = ring[2 * a], az = ring[2 * a + 1], bx = ring[2 * b], bz = ring[2 * b + 1];
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az) || 1;
  // the outward normal: away from the plot's middle (the origin)
  let nx = (bz - az) / L, nz = -(bx - ax) / L;
  if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  const rx = mx + (nx * roadW) / 2, rz = mz + (nz * roadW) / 2;
  return Math.round(-(g.gx * rx + g.gz * rz) * 10) / 10;
}
