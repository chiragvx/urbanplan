// Palette thumbnails, drawn from the asset itself (no art): a short slanted piece of the street / track / canal /
// line, like Cities: Skylines' tiles. Cached per asset id; custom assets get theirs the same way.
import type { AssetDef } from './model';
import { channelTop } from './model';
import type { Part } from '../net/model';

const W = 112, H = 72, DPR = 2;
const cache = new Map<string, string>();

const COL: Record<Part['kind'], string> = {
  lane: '#4a4d52', bus: '#b5483f', cycle: '#3f8f6b', parking: '#6c7076', shoulder: '#8c8f93', median: '#9fb38a', sidewalk: '#c9c2b6', planter: '#7fa65a',
};

/** A data URL for the asset's tile picture. */
export function thumb(a: AssetDef): string {
  const key = a.id + (a.custom ? JSON.stringify(a.profile) : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = W * DPR; c.height = H * DPR;
  const g = c.getContext('2d')!;
  g.scale(DPR, DPR);
  draw(g, a);
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

// slanted strip: across (u, 0..1 of the width) and along (v, 0..1)
const AX = [62, 22], AL = [32, -50], O = [16, 58];
const at = (u: number, v: number): [number, number] => [O[0] + AX[0] * u + AL[0] * v, O[1] + AX[1] * u + AL[1] * v];

function quad(g: CanvasRenderingContext2D, u0: number, u1: number, v0: number, v1: number, fill: string) {
  g.beginPath();
  const p = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
  g.moveTo(...p[0]); for (const q of p.slice(1)) g.lineTo(...q); g.closePath();
  g.fillStyle = fill; g.fill();
}
function seg(g: CanvasRenderingContext2D, u: number, v0: number, v1: number, color: string, w = 1, dash: number[] = []) {
  g.beginPath(); g.setLineDash(dash); g.moveTo(...at(u, v0)); g.lineTo(...at(u, v1)); g.strokeStyle = color; g.lineWidth = w; g.stroke(); g.setLineDash([]);
}
function tree(g: CanvasRenderingContext2D, u: number, v: number, r = 4.2) {
  const [x, y] = at(u, v);
  g.beginPath(); g.arc(x, y - 3, r, 0, Math.PI * 2); g.fillStyle = '#4f8f3a'; g.fill();
  g.beginPath(); g.arc(x - 1, y - 4.2, r * 0.55, 0, Math.PI * 2); g.fillStyle = '#6fb24f'; g.fill();
}
function arrow(g: CanvasRenderingContext2D, u: number, v: number, dir: number) {
  const [x, y] = at(u, v), [dx, dy] = [AL[0] * 0.08 * dir, AL[1] * 0.08 * dir];
  g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x - dx * 0.6 - dy * 0.35, y - dy * 0.6 + dx * 0.35); g.lineTo(x - dx * 0.6 + dy * 0.35, y - dy * 0.6 - dx * 0.35); g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
}

function draw(g: CanvasRenderingContext2D, a: AssetDef) {
  const p = a.profile;
  switch (p.type) {
    case 'street': return street(g, p.parts, a.lift ?? 0);
    case 'track': return track(g, p.tracks, p.structure, p.metro);
    case 'channel': return channel(g, p.bed, p.depth, p.slope, p.freeboard, p.banks, p.lined);
    case 'conduit': return conduit(g, a);
    case 'corridor': return corridor(g, p.kv, !!p.poles);
    case 'path': return street(g, [{ kind: 'planter', width: 1, dir: 0 }, { kind: 'sidewalk', width: p.width, dir: 0 }, { kind: 'planter', width: 1, dir: 0 }], 0, a.id.includes('cycle') ? '#3f8f6b' : undefined);
    case 'point': return box(g, p.shape, a.layer?.color ?? '#888');
    case 'area': return area(g, p.fill, !!p.hatch);
  }
}

function street(g: CanvasRenderingContext2D, parts: Part[], lift: number, tint?: string) {
  const total = parts.reduce((s, q) => s + q.width, 0) || 1;
  if (lift > 0.5) { // deck on piers
    for (const v of [0.2, 0.75]) { const [x, y] = at(0.5, v); g.fillStyle = '#9b978f'; g.fillRect(x - 3, y, 6, 12); }
    g.save(); g.translate(0, -6);
  }
  if (lift < -0.5) { quad(g, -0.05, 1.05, 0, 1, '#6b5a45'); g.globalAlpha = 0.85; }
  let u = 0;
  parts.forEach((q, i) => {
    const u0 = u / total, u1 = (u + q.width) / total;
    quad(g, u0, u1, 0, 1, tint && q.kind === 'sidewalk' ? tint : COL[q.kind]);
    if (q.kind === 'planter' || q.kind === 'median' && q.width >= 1.5) for (let v = 0.12; v < 1; v += 0.3) tree(g, (u0 + u1) / 2, v, Math.min(5, 2 + q.width * 1.1));
    if (q.kind === 'lane' || q.kind === 'bus') {
      const next = parts[i + 1];
      if (next && (next.kind === 'lane' || next.kind === 'bus')) seg(g, u1, 0, 1, next.dir !== q.dir && q.dir && next.dir ? '#f5c518' : 'rgba(255,255,255,0.85)', 1, next.dir !== q.dir ? [] : [4, 4]);
      if (q.dir) arrow(g, (u0 + u1) / 2, 0.5, q.dir === 1 ? 1 : -1);
    }
    if (q.kind === 'parking') for (let v = 0.1; v < 1; v += 0.2) { g.beginPath(); g.moveTo(...at(u0, v)); g.lineTo(...at(u1, v)); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.8; g.stroke(); }
    if (q.kind === 'cycle') { const [x, y] = at((u0 + u1) / 2, 0.5); g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '7px sans-serif'; g.fillText('🚲', x - 4, y + 3); }
    u += q.width;
  });
  // kerbs
  seg(g, 0, 0, 1, 'rgba(0,0,0,0.35)', 1); seg(g, 1, 0, 1, 'rgba(0,0,0,0.35)', 1);
  if (lift > 0.5) g.restore();
  g.globalAlpha = 1;
}

function track(g: CanvasRenderingContext2D, tracks: number, structure: string, metro?: boolean) {
  if (structure === 'tunnel') {
    g.fillStyle = '#6b5a45'; g.fillRect(8, 20, 96, 44);
    for (const x of [36, 76]) { g.beginPath(); g.arc(x, 42, 14, 0, Math.PI * 2); g.fillStyle = '#2f3237'; g.fill(); g.strokeStyle = '#b0aba2'; g.lineWidth = 2; g.stroke(); g.fillStyle = metro ? '#d2479b' : '#9aa0a6'; g.fillRect(x - 8, 46, 16, 3); }
    return;
  }
  if (structure === 'viaduct') { for (const v of [0.18, 0.78]) { const [x, y] = at(0.5, v); g.fillStyle = '#a8a49b'; g.fillRect(x - 4, y - 2, 8, 16); } g.save(); g.translate(0, -8); }
  quad(g, 0, 1, 0, 1, structure === 'viaduct' || metro ? '#a7a299' : '#8a7a66');
  const n = Math.max(1, tracks);
  for (let k = 0; k < n; k++) {
    const c = (k + 0.5) / n, hw = 0.32 / n;
    for (let v = 0.04; v < 1; v += 0.08) { g.beginPath(); g.moveTo(...at(c - hw, v)); g.lineTo(...at(c + hw, v)); g.strokeStyle = '#5b4a3a'; g.lineWidth = 1.4; g.stroke(); }
    seg(g, c - hw * 0.6, 0, 1, '#e3e3e3', 1.2); seg(g, c + hw * 0.6, 0, 1, '#e3e3e3', 1.2);
  }
  if (structure === 'viaduct') { seg(g, 0, 0, 1, '#d8d4cc', 2); seg(g, 1, 0, 1, '#d8d4cc', 2); g.restore(); }
}

function channel(g: CanvasRenderingContext2D, bed: number, depth: number, slope: number, fb: number, banks: [number, number], lined: boolean) {
  // a cross-section: ground, banks, the trapezoid, water up to full supply level
  const top = bed + 2 * slope * (depth + fb), span = top + banks[0] + banks[1] + 2;
  const s = 96 / span, y0 = 30, D = Math.min(30, (depth + fb) * s * 1.6 + 6);
  const x = (m: number) => 8 + m * s;
  g.fillStyle = '#d8ceb8'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7f9c5a'; g.fillRect(0, y0 - 4, W, 4);
  g.fillStyle = '#8b7356'; g.fillRect(0, y0, W, H - y0);
  const l = 1 + banks[0], r = l + top, bl = l + slope * (depth + fb), br = r - slope * (depth + fb);
  if (banks[0] > 0.5) { g.fillStyle = '#9a9a9a'; g.fillRect(x(1), y0 - 6, banks[0] * s, 3); }
  g.beginPath(); g.moveTo(x(l), y0); g.lineTo(x(bl), y0 + D); g.lineTo(x(br), y0 + D); g.lineTo(x(r), y0); g.closePath();
  g.fillStyle = lined ? '#bdb8ad' : '#6d5a40'; g.fill();
  const wy = y0 + D * (fb / (depth + fb));
  const wl = l + slope * fb, wr = r - slope * fb;
  g.beginPath(); g.moveTo(x(wl), wy); g.lineTo(x(bl), y0 + D - 1.5); g.lineTo(x(br), y0 + D - 1.5); g.lineTo(x(wr), wy); g.closePath();
  g.fillStyle = '#3f8fc4'; g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x(wl) + 2, wy + 1, (wr - wl) * s * 0.5, 1.2);
}

function conduit(g: CanvasRenderingContext2D, a: AssetDef) {
  const p = a.profile as Extract<AssetDef['profile'], { type: 'conduit' }>;
  const depth = -(a.lift ?? -1);
  g.fillStyle = '#9fbf7a'; g.fillRect(0, 0, W, 10);
  g.fillStyle = '#8b7356'; g.fillRect(0, 10, W, H - 10);
  g.fillStyle = '#4a4d52'; g.fillRect(0, 8, W * 0.55, 3);
  g.fillStyle = '#c9c2b6'; g.fillRect(W * 0.55, 7, W * 0.45, 4);
  const cx = W * 0.72, cy = Math.min(H - 14, 14 + depth * 7);
  const r = Math.max(3, Math.min(14, (p.box ? p.box[0] : p.dia) * 10));
  g.fillStyle = a.layer?.color ?? '#888';
  if (p.box) g.fillRect(cx - r, cy - r * 0.8, r * 2, r * 1.6); else { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(cx, 11); g.lineTo(cx, cy - r); g.stroke(); g.setLineDash([]);
}

function corridor(g: CanvasRenderingContext2D, kv: number, poles: boolean) {
  g.fillStyle = '#cfe0b8'; g.fillRect(0, 0, W, H);
  quad(g, 0.15, 0.85, 0, 1, 'rgba(217,130,43,0.18)');
  const towers = [at(0.5, 0.15), at(0.5, 0.85)];
  const h = poles ? 22 : Math.min(46, 20 + kv / 18);
  for (const [x, y] of towers) {
    g.strokeStyle = poles ? '#6b5a45' : '#7b7f86'; g.lineWidth = poles ? 2 : 1.3;
    g.beginPath();
    if (poles) { g.moveTo(x, y); g.lineTo(x, y - h); g.moveTo(x - 6, y - h + 3); g.lineTo(x + 6, y - h + 3); }
    else { g.moveTo(x - 5, y); g.lineTo(x, y - h); g.lineTo(x + 5, y); g.moveTo(x - 9, y - h * 0.7); g.lineTo(x + 9, y - h * 0.7); g.moveTo(x - 7, y - h * 0.88); g.lineTo(x + 7, y - h * 0.88); }
    g.stroke();
  }
  g.strokeStyle = '#3b3f45'; g.lineWidth = 0.8;
  for (const dx of poles ? [-5, 5] : [-8, 0, 8]) {
    const yy = poles ? h - 3 : h * 0.7;
    g.beginPath(); g.moveTo(towers[0][0] + dx, towers[0][1] - yy); g.quadraticCurveTo((towers[0][0] + towers[1][0]) / 2 + dx, (towers[0][1] + towers[1][1]) / 2 - yy + 8, towers[1][0] + dx, towers[1][1] - yy); g.stroke();
  }
}

function box(g: CanvasRenderingContext2D, shape: string, color: string) {
  quad(g, -0.05, 1.05, 0, 1, '#c9d6b8');
  const h = shape === 'platform' ? 3 : shape === 'tank' ? 28 : shape === 'station' ? 12 : shape === 'stop' ? 8 : 10;
  const u0 = shape === 'platform' ? 0.3 : 0.2, u1 = shape === 'platform' ? 0.7 : 0.8, v0 = 0.2, v1 = 0.8;
  const top = (u: number, v: number): [number, number] => { const [x, y] = at(u, v); return [x, y - h]; };
  if (shape === 'tank') {
    const [x, y] = at(0.5, 0.5); g.fillStyle = '#9b978f'; g.fillRect(x - 2, y - h + 8, 4, h - 8);
    g.beginPath(); g.ellipse(x, y - h + 4, 13, 5, 0, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.fillRect(x - 13, y - h - 4, 26, 8);
    g.beginPath(); g.ellipse(x, y - h - 4, 13, 5, 0, 0, Math.PI * 2); g.fillStyle = '#e6e2da'; g.fill();
    return;
  }
  // sides then roof
  g.beginPath(); g.moveTo(...at(u1, v0)); g.lineTo(...at(u1, v1)); g.lineTo(...top(u1, v1)); g.lineTo(...top(u1, v0)); g.closePath(); g.fillStyle = shade(color, -30); g.fill();
  g.beginPath(); g.moveTo(...at(u0, v0)); g.lineTo(...at(u1, v0)); g.lineTo(...top(u1, v0)); g.lineTo(...top(u0, v0)); g.closePath(); g.fillStyle = shade(color, -15); g.fill();
  g.beginPath(); g.moveTo(...top(u0, v0)); g.lineTo(...top(u1, v0)); g.lineTo(...top(u1, v1)); g.lineTo(...top(u0, v1)); g.closePath(); g.fillStyle = shape === 'yard' ? '#b8b2a6' : color; g.fill();
  if (shape === 'yard') for (let k = 0; k < 3; k++) { const [x, y] = top(0.35 + k * 0.15, 0.5); g.fillStyle = '#6b6f75'; g.fillRect(x - 2, y - 6, 4, 6); }
}

function area(g: CanvasRenderingContext2D, fill: string, hatch: boolean) {
  g.beginPath();
  const pts = [at(0, 0.1), at(0.7, 0), at(1, 0.6), at(0.4, 1), at(0.05, 0.75)];
  g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); g.closePath();
  g.fillStyle = fill; g.globalAlpha = hatch ? 0.35 : 0.85; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = shade(fill, -40); g.lineWidth = 1.5; g.stroke();
  if (hatch) {
    g.save(); g.clip();
    g.strokeStyle = fill; g.lineWidth = 1.2;
    for (let x = -60; x < W; x += 7) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 60, 0); g.stroke(); }
    g.restore();
  }
}

function shade(hex: string, d: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, ((n >> s) & 255) + d));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/** Larger cross-section for the hover card (streets: parts with widths). */
export function sectionDiagram(a: AssetDef): { parts: { label: string; w: number; color: string }[] } | null {
  if (a.profile.type !== 'street') return null;
  const L: Record<Part['kind'], string> = { lane: 'lane', bus: 'BRT', cycle: 'cycle', parking: 'park', shoulder: 'shld', median: 'median', sidewalk: 'walk', planter: 'trees' };
  return { parts: a.profile.parts.map((p) => ({ label: L[p.kind], w: p.width, color: COL[p.kind] })) };
}
export { channelTop };
