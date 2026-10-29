// Fill tool: click a plot on the DP sheet underlay and get its outline as a survey region — for anything the
// automatic tracing (tools/dp/regions.py) missed or got wrong. Works on the registered sheet images in the browser:
// flood fill from the click by colour (stopping at plot lines, labels and red verges), then trace the outline.
import type { Editor } from './editor';

const RES = 0.5;          // metres per pixel of the sheet blocks (tiles.py default)
const TOL = 40;           // RGB distance to the seed colour that still counts as the same fill
const HOLE = 1600;        // px (= 400 m²): smaller holes (labels, symbols) are filled

export interface Traced { ring: number[]; area: number; rgb: [number, number, number]; reserved: boolean; touchesEdge: boolean }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
}

/** Trace the DP fill under (x, z) within a window `span` metres across. */
export async function traceAt(E: Editor, x: number, z: number, span = 400): Promise<Traced | null> {
  const D = E.dpr;
  const ix = D.sheetIndex;
  if (!ix) return null;
  const n = Math.round(span / RES);
  const x0 = x - span / 2, z0 = z - span / 2;
  const cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  const tiles = ix.tiles.filter((t) => t.x0 < x0 + span && t.x0 + t.size > x0 && t.z0 < z0 + span && t.z0 + t.size > z0);
  if (!tiles.length) return null;
  const ims = await Promise.all(tiles.map((t) => loadImage(`${D.base}dp/${t.file}`).catch(() => null)));
  tiles.forEach((t, i) => { const im = ims[i]; if (im) ctx.drawImage(im, (t.x0 - x0) / RES, (t.z0 - z0) / RES, t.size / RES, t.size / RES); });
  const px = ctx.getImageData(0, 0, n, n).data;
  const si = Math.floor(n / 2), sj = Math.floor(n / 2);
  const at = (i: number, j: number) => (j * n + i) * 4;
  // seed colour: median of a small patch around the click (ignores a line right under the cursor)
  const sample: number[][] = [];
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const k = at(si + di, sj + dj); if (px[k + 3] > 0) sample.push([px[k], px[k + 1], px[k + 2]]); }
  if (!sample.length) return null;
  const med = (c: number) => sample.map((s) => s[c]).sort((a, b) => a - b)[sample.length >> 1];
  const seed: [number, number, number] = [med(0), med(1), med(2)];
  if (seed[0] + seed[1] + seed[2] > 735) return null; // white: road or unzoned land, nothing to fill
  const same = (k: number) => px[k + 3] > 0 && Math.hypot(px[k] - seed[0], px[k + 1] - seed[1], px[k + 2] - seed[2]) < TOL;
  // flood fill (4-connected) from the nearest matching pixel
  const mask = new Uint8Array(n * n);
  let start = -1;
  for (let r = 0; r < 4 && start < 0; r++) for (let dj = -r; dj <= r && start < 0; dj++) for (let di = -r; di <= r; di++) if (same(at(si + di, sj + dj))) { start = (sj + dj) * n + si + di; break; }
  if (start < 0) return null;
  const stack = [start];
  mask[start] = 1;
  let touchesEdge = false;
  while (stack.length) {
    const p = stack.pop()!;
    const i = p % n, j = (p - i) / n;
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) { touchesEdge = true; continue; }
    for (const q of [p - 1, p + 1, p - n, p + n]) if (!mask[q] && same(q * 4)) { mask[q] = 1; stack.push(q); }
  }
  // fill small holes: background pixels not connected to the border through background
  const outside = new Uint8Array(n * n);
  const bg: number[] = [];
  for (let i = 0; i < n; i++) for (const p of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (!mask[p] && !outside[p]) { outside[p] = 1; bg.push(p); }
  while (bg.length) {
    const p = bg.pop()!;
    const i = p % n;
    for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) if (q >= 0 && q < n * n && !mask[q] && !outside[q]) { outside[q] = 1; bg.push(q); }
  }
  // holes = enclosed background components; small ones become part of the region
  const seen = new Uint8Array(n * n);
  for (let p = 0; p < n * n; p++) {
    if (mask[p] || outside[p] || seen[p]) continue;
    const comp = [p]; seen[p] = 1;
    for (let c = 0; c < comp.length; c++) {
      const q0 = comp[c], i = q0 % n;
      for (const q of [i > 0 ? q0 - 1 : -1, i < n - 1 ? q0 + 1 : -1, q0 - n, q0 + n]) if (q >= 0 && q < n * n && !mask[q] && !outside[q] && !seen[q]) { seen[q] = 1; comp.push(q); }
    }
    if (comp.length < HOLE) for (const q of comp) mask[q] = 1;
  }
  let count = 0;
  for (let p = 0; p < n * n; p++) count += mask[p];
  if (count < 40) return null;
  // red verge around it = a reserved site
  let edge = 0, red = 0;
  for (let p = n; p < n * n - n; p++) {
    if (!mask[p]) continue;
    for (const q of [p - 2, p + 2, p - 2 * n, p + 2 * n]) {
      if (q < 0 || q >= n * n || mask[q]) continue;
      edge++;
      const k = q * 4, r = px[k], g = px[k + 1], b = px[k + 2];
      if (r > 170 && r - g > 60 && r - b > 40) red++;
    }
  }
  const ring = traceOutline(mask, n).map(([i, j]) => [x0 + i * RES, z0 + j * RES] as [number, number]);
  const simple = simplify(ring, 0.6);
  if (simple.length < 3) return null;
  return { ring: simple.flatMap(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]), area: Math.round(count * RES * RES), rgb: seed, reserved: edge > 0 && red / edge > 0.25, touchesEdge };
}

/** Outer boundary of the mask (the component containing its first pixel) as pixel-corner points, by edge following. */
function traceOutline(mask: Uint8Array, n: number): [number, number][] {
  let s = -1;
  for (let p = 0; p < n * n; p++) if (mask[p]) { s = p; break; }
  if (s < 0) return [];
  const m = (i: number, j: number) => (i >= 0 && j >= 0 && i < n && j < n ? mask[j * n + i] : 0);
  // walk the boundary between filled and empty cells along pixel corners, keeping the region on the right
  const si = s % n, sj = (s - si) / n;
  let i = si, j = sj, dir = 0; // 0 = east, 1 = south, 2 = west, 3 = north (corner coordinates)
  const out: [number, number][] = [[i, j]];
  for (let guard = 0; guard < n * n * 4; guard++) {
    // cells around corner (i, j): a = up-left, b = up-right, c = down-left, d = down-right
    const a = m(i - 1, j - 1), b = m(i, j - 1), c = m(i - 1, j), d = m(i, j);
    const right = [d, c, a, b][dir], left = [b, d, c, a][dir];
    if (left) dir = (dir + 3) % 4;          // turn left
    else if (!right) dir = (dir + 1) % 4;   // turn right
    i += [1, 0, -1, 0][dir]; j += [0, 1, 0, -1][dir];
    if (i === si && j === sj) break;
    const L = out[out.length - 1];
    if (out.length >= 2) { const P = out[out.length - 2]; if ((P[0] === L[0] && L[0] === i) || (P[1] === L[1] && L[1] === j)) out.pop(); }
    out.push([i, j]);
  }
  return out;
}

/** Douglas–Peucker on a closed ring. */
function simplify(P: [number, number][], tol: number): [number, number][] {
  if (P.length < 4) return P;
  const keep = new Uint8Array(P.length);
  const rec = (a: number, b: number) => {
    let bi = -1, bd = tol;
    const [ax, az] = P[a], [bx, bz] = P[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((P[k][0] - ax) * dz - (P[k][1] - az) * dx) / L; if (d > bd) { bd = d; bi = k; } }
    if (bi >= 0) { keep[bi] = 1; rec(a, bi); rec(bi, b); }
  };
  // split at the point farthest from the start so the closed ring simplifies well
  let far = 0, fd = -1;
  for (let k = 1; k < P.length; k++) { const d = Math.hypot(P[k][0] - P[0][0], P[k][1] - P[0][1]); if (d > fd) { fd = d; far = k; } }
  keep[0] = keep[far] = 1;
  rec(0, far);
  const Q = [...P.slice(far), P[0]];
  const keep2 = new Uint8Array(Q.length);
  const rec2 = (a: number, b: number) => {
    let bi = -1, bd = tol;
    const [ax, az] = Q[a], [bx, bz] = Q[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let k = a + 1; k < b; k++) { const d = Math.abs((Q[k][0] - ax) * dz - (Q[k][1] - az) * dx) / L; if (d > bd) { bd = d; bi = k; } }
    if (bi >= 0) { keep2[bi] = 1; rec2(a, bi); rec2(bi, b); }
  };
  rec2(0, Q.length - 1);
  const out: [number, number][] = [];
  for (let k = 0; k <= far; k++) if (keep[k]) out.push(P[k]);
  for (let k = 1; k < Q.length - 1; k++) if (keep2[k]) out.push(Q[k]);
  return out;
}
