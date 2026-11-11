// Film overlays, drawn in a 2D canvas over the 3D frame: captions, marks on the ground (circles, dimension lines,
// tags), the "What if…" wipe, the before / after split and the end card. Pure drawing: the player says what and when.
import { BRAND, COBALT, FONT, GREEN, INK, ORANGE, PAPER, RED } from './brand';
import type { V2 } from './types';

/** the frame (CSS px): 1080 × 1920 for the vertical episodes; a scene can ask for another (Scene.size) */
export let W = 1080, H = 1920;
/** where text may go: 8% margins, and clear of the bottom 15% (Reels / Shorts draw their buttons and caption there) */
export let SAFE = { x0: 86, x1: W - 86, y0: 154, y1: Math.round(H * 0.85) };
/** Another frame size (before anything is drawn). Landscape keeps 5% margins all round: no app chrome to avoid. */
export function setFrame(w: number, h: number) {
  W = w; H = h;
  SAFE = h >= w ? { x0: 86, x1: W - 86, y0: 154, y1: Math.round(H * 0.85) } : { x0: Math.round(W * 0.05), x1: Math.round(W * 0.95), y0: Math.round(H * 0.06), y1: Math.round(H * 0.94) };
}
const inSafe = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** world point (x, z, height above the ground) → canvas pixels, or null behind the camera */
export type Project = (x: number, z: number, lift?: number) => V2 | null;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const ease = {
  inOut: (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: (u: number) => 1 - Math.pow(1 - u, 3),
  in: (u: number) => u * u * u,
  linear: (u: number) => u,
  back: (u: number) => { const c = 1.70158, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; },
};
/** 0 → 1 over [t0, t0 + fin], 1 → 0 over [t1 - fout, t1] */
export function fade(t: number, t0: number, t1: number, fin = 0.35, fout = 0.3) {
  if (t < t0 || t > t1) return 0;
  return Math.min(clamp01((t - t0) / fin), clamp01((t1 - t) / fout));
}

const font = (px: number, weight = 600) => `${weight} ${px}px ${FONT}`;

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const SIZES = { hook: { px: 74, weight: 700, lh: 1.12 }, body: { px: 54, weight: 600, lh: 1.18 }, small: { px: 40, weight: 600, lh: 1.2 } };

/** A caption card: paper text on an ink card, sliding up as it fades in. */
export function caption(ctx: CanvasRenderingContext2D, text: string, a: number, at: 'top' | 'centre' | 'bottom' = 'top', size: keyof typeof SIZES = 'body') {
  if (a <= 0) return;
  const S = SIZES[size];
  ctx.save();
  ctx.font = font(S.px, S.weight);
  const lines = wrap(ctx, text, W - 220);
  const lh = S.px * S.lh, padX = 44, padY = 34;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + padX * 2, bh = lines.length * lh + padY * 2 - (lh - S.px) ;
  const y0 = at === 'top' ? SAFE.y0 + 96 : at === 'centre' ? (H - bh) / 2 : SAFE.y1 - 40 - bh;
  const slide = (1 - ease.out(a)) * 40;
  ctx.globalAlpha = a;
  ctx.translate(0, slide);
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(12,12,13,0.9)';
  pill(ctx, (W - bw) / 2, y0, bw, bh, 30);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    // numbers in orange: anything like 17.5 m / 15 m / 1,200 m²
    drawRich(ctx, l, W / 2, y0 + padY + S.px * 0.84 + i * lh);
  });
  ctx.restore();
}

/** Centre-aligned text where measured numbers ("17.5 m") are coloured orange. */
function drawRich(ctx: CanvasRenderingContext2D, line: string, cx: number, y: number) {
  const parts = line.split(/(\d[\d,.]*\s?(?:m²|m|%|s)?)/);
  const total = ctx.measureText(line).width;
  let x = cx - total / 2;
  ctx.textAlign = 'left';
  for (const p of parts) {
    if (!p) continue;
    ctx.fillStyle = /^\d/.test(p) ? ORANGE : PAPER;
    ctx.fillText(p, x, y);
    x += ctx.measureText(p).width;
  }
  ctx.textAlign = 'center';
}

/** Polyline through projected ground points (null points break it). `u` draws it on. */
function groundPath(ctx: CanvasRenderingContext2D, P: Project, pts: V2[], closed: boolean, u: number, lift = 0.4) {
  const S = pts.map(([x, z]) => P(x, z, lift));
  const n = closed ? S.length : S.length - 1;
  const upto = n * clamp01(u);
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= Math.ceil(upto) && i <= n; i++) {
    const a = S[i % S.length];
    if (!a) { pen = false; continue; }
    let p = a;
    if (i > upto) { const b = S[(i - 1) % S.length]; if (!b) continue; const f = upto - (i - 1); p = [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f]; }
    if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; }
  }
}

/** A ring on the ground (the problem, circled): drawn on, with a soft glow. */
export function ring(ctx: CanvasRenderingContext2D, P: Project, pts: V2[], u: number, a: number, color = RED) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.lineWidth = 12;
  groundPath(ctx, P, pts, true, ease.inOut(u));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

/** A dimension line on the ground, end ticks and a label pill in the middle. */
export function dim(ctx: CanvasRenderingContext2D, P: Project, a: V2, b: V2, text: string, u: number, alpha: number, color = RED) {
  if (alpha <= 0) return;
  const A = P(a[0], a[1], 0.6), B = P(b[0], b[1], 0.6);
  if (!A || !B) return;
  const k = ease.out(clamp01(u));
  const m: V2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const A2: V2 = [m[0] + (A[0] - m[0]) * k, m[1] + (A[1] - m[1]) * k], B2: V2 = [m[0] + (B[0] - m[0]) * k, m[1] + (B[1] - m[1]) * k];
  const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10;
  ctx.strokeStyle = color; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(A2[0], A2[1]); ctx.lineTo(B2[0], B2[1]);
  for (const e of [A2, B2]) { ctx.moveTo(e[0] + nx * 22, e[1] + ny * 22); ctx.lineTo(e[0] - nx * 22, e[1] - ny * 22); }
  ctx.stroke();
  ctx.shadowBlur = 0;
  label(ctx, m[0], m[1], text, color, clamp01((u - 0.4) / 0.6));
  ctx.restore();
}

/** A label pill centred on a point. */
export function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, a: number, px = 46) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.font = font(px, 700);
  const w = ctx.measureText(text).width + px * 0.9, h = px * 1.45;
  const s = 0.85 + 0.15 * ease.back(a);
  ctx.translate(inSafe(x, SAFE.x0 + w / 2, SAFE.x1 - w / 2), inSafe(y, SAFE.y0 + h / 2, SAFE.y1 - h / 2)); ctx.scale(s, s);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.fillStyle = color;
  pill(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = PAPER;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, px * 0.04);
  ctx.restore();
}

/** A callout: a pin on the ground, a stem, and a label above it (with a tick for a step done). */
export function tag(ctx: CanvasRenderingContext2D, P: Project, p: V2, text: string, a: number, color = GREEN, tick = true) {
  if (a <= 0) return;
  const G = P(p[0], p[1], 0.5);
  if (!G) return;
  const k = ease.out(a);
  ctx.save();
  ctx.globalAlpha = a;
  // pulse on the ground
  ctx.strokeStyle = color; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.ellipse(G[0], G[1], 18 + 40 * k, (18 + 40 * k) * 0.45, 0, 0, Math.PI * 2); ctx.globalAlpha = a * (1 - k * 0.7); ctx.stroke();
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(G[0], G[1], 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = PAPER; ctx.lineWidth = 4; ctx.stroke();
  const top = Math.max(SAFE.y0 + 76, G[1] - 150 * k);
  ctx.strokeStyle = PAPER; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(G[0], G[1] - 12); ctx.lineTo(G[0], top); ctx.stroke();
  ctx.font = font(44, 700);
  const tw = ctx.measureText(text).width, ic = tick ? 52 : 0, w = tw + 56 + ic, h = 76;
  const x = inSafe(G[0] - w / 2, SAFE.x0, SAFE.x1 - w), y = top - h;
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 6;
  ctx.fillStyle = INK;
  pill(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  if (tick) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 46, y + h / 2, 22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x + 35, y + h / 2 + 1); ctx.lineTo(x + 43, y + h / 2 + 9); ctx.lineTo(x + 58, y + h / 2 - 9); ctx.stroke();
  }
  ctx.fillStyle = PAPER; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 28 + ic + (tick ? 6 : 0), y + h / 2 + 2);
  ctx.restore();
}

/** "What if…": an orange band sweeps across, the words ride on it. u: 0 → 1 over the wipe. */
export function wipe(ctx: CanvasRenderingContext2D, u: number, text: string) {
  if (u <= 0 || u >= 1) return;
  const x = -500 + (W + 1000) * ease.inOut(u);
  ctx.save();
  // the band: a thick slanted stripe with a thin cobalt edge
  ctx.translate(x, H / 2); ctx.rotate(-0.22);
  ctx.fillStyle = ORANGE; ctx.fillRect(-60, -H, 120, 2 * H);
  ctx.fillStyle = COBALT; ctx.fillRect(60, -H, 14, 2 * H);
  ctx.restore();
  const a = Math.min(clamp01(u / 0.2), clamp01((1 - u) / 0.2));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = font(150, 700);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 50;
  ctx.fillStyle = PAPER;
  ctx.fillText(text, W / 2 + (1 - ease.out(a)) * 60, H / 2);
  ctx.restore();
}

/** Split screen chrome: the divider, Today / What if labels, the measured numbers. `u` 0 → 1 as it comes in. */
export function splitChrome(ctx: CanvasRenderingContext2D, x: number, left: string, right: string, stats: { label: string; before: string; after: string }[], t: number) {
  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 20;
  ctx.fillRect(x - 4, 0, 8, H);
  ctx.beginPath(); ctx.arc(x, H * 0.44, 30, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.moveTo(x - 6, H * 0.44 - 12); ctx.lineTo(x - 18, H * 0.44); ctx.lineTo(x - 6, H * 0.44 + 12); ctx.moveTo(x + 6, H * 0.44 - 12); ctx.lineTo(x + 18, H * 0.44); ctx.lineTo(x + 6, H * 0.44 + 12); ctx.fill();
  ctx.restore();
  const la = clamp01((t - 0.3) / 0.4);
  label(ctx, Math.min(x - 170, W / 4), 300, left, RED, la, 50);
  label(ctx, Math.max(x + 170, (3 * W) / 4), 300, right, GREEN, la, 50);
  // number cards at the bottom
  const cw = SAFE.x1 - SAFE.x0, ch = 150, gap = 22, y0 = SAFE.y1 - stats.length * (ch + gap) + gap;
  stats.forEach((s, i) => {
    const a = clamp01((t - 0.7 - i * 0.35) / 0.4);
    if (a <= 0) return;
    const y = y0 + i * (ch + gap) + (1 - ease.out(a)) * 30;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(12,12,13,0.92)';
    pill(ctx, SAFE.x0, y, cw, ch, 32); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.textBaseline = 'middle';
    ctx.font = font(36, 500); ctx.fillStyle = 'rgba(250,250,249,0.7)'; ctx.textAlign = 'left';
    ctx.fillText(s.label, SAFE.x0 + 40, y + 44);
    ctx.font = font(64, 700);
    const x0 = SAFE.x0 + 40;
    ctx.fillStyle = RED; ctx.fillText(s.before, x0, y + 104);
    const bw = ctx.measureText(s.before).width;
    ctx.fillStyle = PAPER; ctx.font = font(52, 500); ctx.fillText('→', x0 + bw + 26, y + 102);
    ctx.font = font(64, 700); ctx.fillStyle = GREEN; ctx.fillText(s.after, x0 + bw + 100, y + 104);
    ctx.restore();
  });
}

/** The brand mark (the site's favicon): two orange kerbs and a white centre line on an ink tile. */
export function mark(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const k = size / 32;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(k, k);
  ctx.fillStyle = '#1b1b1d'; ctx.beginPath(); ctx.roundRect(0, 0, 32, 32, 7); ctx.fill();
  ctx.lineCap = 'round';
  ctx.strokeStyle = ORANGE; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(9, 26); ctx.lineTo(14, 6); ctx.moveTo(23, 26); ctx.lineTo(18, 6); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); for (const y of [8, 15, 22]) { ctx.moveTo(16, y); ctx.lineTo(16, y + 3); } ctx.stroke();
  ctx.restore();
}

/** End card over the frame: ink fills in, then the mark, the line, the address and the small print. */
export function endCard(ctx: CanvasRenderingContext2D, t: number, headline: string) {
  const a = clamp01(t / 0.45);
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = a;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  const m = clamp01((t - 0.25) / 0.5);
  if (m > 0) {
    ctx.save(); ctx.globalAlpha = m;
    const s = 0.6 + 0.4 * ease.back(m);
    mark(ctx, W / 2, 640, 230 * s);
    ctx.restore();
  }
  const h = clamp01((t - 0.5) / 0.5);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  if (h > 0) {
    ctx.globalAlpha = h;
    ctx.font = font(84, 700);
    ctx.fillStyle = PAPER;
    const lines = wrap(ctx, headline, W - 200);
    lines.forEach((l, i) => ctx.fillText(l, W / 2, 940 + i * 100 + (1 - ease.out(h)) * 30));
  }
  const s = clamp01((t - 0.7) / 0.35);
  if (s > 0) {
    ctx.globalAlpha = s;
    ctx.font = font(64, 700); ctx.fillStyle = ORANGE;
    ctx.fillText(BRAND.url, W / 2, 1260);
    ctx.font = font(38, 500); ctx.fillStyle = 'rgba(250,250,249,0.82)';
    ctx.fillText(BRAND.credit, W / 2, SAFE.y1 - 60);
  }
  ctx.restore();
}

/**
 * The unbranded close: the scene's closing question over the last shot, on a soft dark band in the middle third,
 * and the small print at the foot of the safe area. `t` from the close's start, `len` how long it lasts.
 */
export function closing(ctx: CanvasRenderingContext2D, t: number, question: string, len: number, note = BRAND.plain) {
  const a = clamp01(t / 0.4);
  if (a <= 0 || t > len) return;
  ctx.save();
  ctx.font = font(84, 700);
  const lines = wrap(ctx, question, SAFE.x1 - SAFE.x0 - 80), lh = 100, h = lines.length * lh + 90, y0 = H * 0.42 - h / 2;
  const g = ctx.createLinearGradient(0, y0 - 140, 0, y0 + h + 140);
  g.addColorStop(0, 'rgba(12,12,13,0)'); g.addColorStop(0.3, 'rgba(12,12,13,0.62)'); g.addColorStop(0.7, 'rgba(12,12,13,0.62)'); g.addColorStop(1, 'rgba(12,12,13,0)');
  ctx.globalAlpha = a;
  ctx.fillStyle = g; ctx.fillRect(0, y0 - 140, W, h + 280);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = PAPER;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18;
  const u = ease.out(clamp01(t / 0.5));
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 45 + (i + 0.8) * lh + (1 - u) * 30));
  ctx.shadowBlur = 0;
  ctx.globalAlpha = a * clamp01((t - 0.4) / 0.4);
  ctx.font = font(38, 500); ctx.fillStyle = 'rgba(250,250,249,0.82)';
  ctx.fillText(note, W / 2, SAFE.y1 - 60);
  ctx.restore();
}

/** A small brand bug, top right, through the video. */
export function bug(ctx: CanvasRenderingContext2D, a: number) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a * 0.92;
  ctx.font = font(36, 600);
  const tw = ctx.measureText(BRAND.name).width, y = SAFE.y0 + 31;
  mark(ctx, SAFE.x1 - tw - 40, y, 56);
  ctx.fillStyle = PAPER; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
  ctx.fillText(BRAND.name, SAFE.x1, y + 2);
  ctx.restore();
}

/** Episode chip, top left ("What If · 01"). */
export function chip(ctx: CanvasRenderingContext2D, text: string, a: number) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = font(34, 700);
  const w = ctx.measureText(text).width + 48;
  ctx.fillStyle = ORANGE;
  pill(ctx, SAFE.x0, SAFE.y0, w, 62, 31); ctx.fill();
  ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, SAFE.x0 + 24, SAFE.y0 + 32);
  ctx.restore();
}

// ---- plots (Plot Twist) ----

/** Left-aligned text with the numbers in orange (as captions colour them). */
function richLeft(ctx: CanvasRenderingContext2D, line: string, x: number, y: number, base: string) {
  for (const p of line.split(/(\d[\d,.]*\s?(?:m²|m|%)?)/)) {
    if (!p) continue;
    ctx.fillStyle = /^\d/.test(p) ? ORANGE : base;
    ctx.fillText(p, x, y);
    x += ctx.measureText(p).width;
  }
}

/** The big counter, top left: the number over its label, a line under it (floors going up). */
export function counter(ctx: CanvasRenderingContext2D, a: number, text: string, label: string, sub?: string) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = font(180, 700);
  const nw = ctx.measureText(text).width;
  ctx.font = font(44, 600);
  const lw = Math.max(ctx.measureText(label).width, sub ? ctx.measureText(sub).width : 0);
  const w = Math.max(nw, lw) + 96, h = sub ? 330 : 270, x = SAFE.x0, y = SAFE.y0 + 40 + (1 - ease.out(a)) * 30;
  ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(12,12,13,0.88)';
  pill(ctx, x, y, w, h, 36); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = font(180, 700); ctx.fillStyle = ORANGE;
  ctx.fillText(text, x + 48, y + 178);
  ctx.font = font(44, 600); ctx.fillStyle = PAPER;
  ctx.fillText(label, x + 50, y + 238);
  if (sub) { ctx.font = font(44, 500); ctx.fillStyle = 'rgba(250,250,249,0.7)'; ctx.fillText(sub, x + 50, y + 296); }
  ctx.restore();
}

/** Number cards at the foot of the safe area, in as splitChrome brings its in (a ding each, sound.ts): two to a row,
 *  `wide` ones a row of their own. `t` from the cards' start, `a` the fade out. */
export function cards(ctx: CanvasRenderingContext2D, stats: { label: string; value: string; wide?: boolean }[], t: number, a: number) {
  if (a <= 0) return;
  const cw = SAFE.x1 - SAFE.x0, ch = 150, gap = 22, half = (cw - gap) / 2;
  // rows: two narrow cards side by side, a wide one alone
  const pos: { x: number; w: number; row: number }[] = [];
  let row = 0, col = 0;
  for (const s of stats) {
    if (s.wide || col === 2) { if (col) row++; col = 0; }
    pos.push({ x: SAFE.x0 + (s.wide ? 0 : col * (half + gap)), w: s.wide ? cw : half, row });
    if (s.wide) { row++; col = 0; } else col++;
  }
  const rows = col ? row + 1 : row, y0 = SAFE.y1 - rows * (ch + gap) + gap;
  stats.forEach((s, i) => {
    const k = clamp01((t - 0.7 - i * 0.35) / 0.4);
    if (k <= 0) return;
    const { x, w } = pos[i], y = y0 + pos[i].row * (ch + gap) + (1 - ease.out(k)) * 30;
    ctx.save();
    ctx.globalAlpha = k * a;
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(12,12,13,0.92)';
    pill(ctx, x, y, w, ch, 32); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = font(36, 500); ctx.fillStyle = 'rgba(250,250,249,0.7)';
    ctx.fillText(s.label, x + 40, y + 44);
    ctx.font = font(64, 700);
    richLeft(ctx, s.value, x + 40, y + 104, PAPER);
    ctx.restore();
  });
}

// ---- montage (the landing page's intro) ----

/** A corridor on the ground (the DP's road width): a soft fill and dashed edges, drawn on along its length. */
export function band(ctx: CanvasRenderingContext2D, P: Project, pts: V2[], u: number, a: number, color = RED) {
  if (a <= 0 || pts.length < 4) return;
  // the ring is the left edge out and the right edge back: grow both from the start
  const n = pts.length / 2, k = Math.max(2, Math.round(n * ease.inOut(clamp01(u))));
  const left = pts.slice(0, k), right = pts.slice(pts.length - k).reverse();
  const L = left.map(([x, z]) => P(x, z, 0.5)), R = right.map(([x, z]) => P(x, z, 0.5));
  if (L.some((p) => !p) || R.some((p) => !p)) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.beginPath();
  L.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i]![0], R[i]![1]);
  ctx.closePath();
  ctx.fillStyle = color; ctx.globalAlpha = a * 0.22; ctx.fill();
  ctx.globalAlpha = a;
  ctx.setLineDash([26, 16]); ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8;
  for (const E of [L, R]) { ctx.beginPath(); E.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1]))); ctx.stroke(); }
  ctx.restore();
}

/** The shot's title, bottom left: a step number in orange and a line of text, on a dark glass card. */
export function shotTitle(ctx: CanvasRenderingContext2D, n: number, text: string, sub: string | undefined, a: number) {
  if (a <= 0) return;
  ctx.save();
  const k = ease.out(a);
  ctx.globalAlpha = a;
  ctx.font = font(50, 700);
  const tw = ctx.measureText(text).width;
  ctx.font = font(32, 500);
  const sw = sub ? ctx.measureText(sub).width : 0;
  const badge = 64, pad = 30, w = badge + pad * 3 + Math.max(tw, sw), h = sub ? 150 : 112;
  const x = SAFE.x0 - (1 - k) * 40, y = SAFE.y1 - h;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 36; ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(12,12,13,0.82)';
  pill(ctx, x, y, w, h, 28); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = ORANGE;
  ctx.beginPath(); ctx.arc(x + pad + badge / 2, y + h / 2, badge / 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = INK; ctx.font = font(36, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x + pad + badge / 2, y + h / 2 + 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = font(50, 700); ctx.fillStyle = PAPER;
  const tx = x + pad * 2 + badge;
  ctx.fillText(text, tx, y + (sub ? 70 : 72));
  if (sub) { ctx.font = font(32, 500); richLeft(ctx, sub, tx, y + 118, 'rgba(250,250,249,0.72)'); }
  ctx.restore();
}

/** A dip through ink (a cut between shots; the loop's ends). */
export function dip(ctx: CanvasRenderingContext2D, a: number) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp01(a); ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H); ctx.restore();
}

/**
 * The plot tool at work: a cursor clicks the corners one by one (a dashed rubber band with its length follows it from
 * the last corner), comes back to the first to close the shape, and the plot fills in. `s` is seconds since the tool
 * started, `dur` how long the drawing takes; the closed outline then stays at alpha `a`.
 */
export function drawTool(ctx: CanvasRenderingContext2D, P: Project, pts: V2[], s: number, dur: number, a: number, color = COBALT) {
  if (a <= 0 || s < 0 || pts.length < 3) return;
  const n = pts.length, legs = n + 1, slot = dur / legs;
  // the cursor comes in from outside the plot, then visits every corner and the first again
  const c0 = pts[0], cx = pts.reduce((q, p) => q + p[0], 0) / n, cz = pts.reduce((q, p) => q + p[1], 0) / n;
  const start: V2 = [c0[0] + (c0[0] - cx) * 0.9, c0[1] + (c0[1] - cz) * 0.9];
  const stops = [start, ...pts, pts[0]];
  const leg = Math.min(legs - 1, Math.floor(s / slot)), f = clamp01((s - leg * slot) / (slot * 0.72));
  const g = ease.inOut(f), A = stops[leg], B = stops[leg + 1];
  const cur: V2 = s >= dur ? pts[0] : [A[0] + (B[0] - A[0]) * g, A[1] + (B[1] - A[1]) * g];
  // corners clicked so far: corner i is clicked at the end of leg i's move
  const clickAt = (i: number) => i * slot + slot * 0.72;
  const placed = pts.filter((_, i) => s >= clickAt(i));
  const closed = s >= clickAt(n);
  const Q = (p: V2) => P(p[0], p[1], 0.6);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (closed) {
    // the plot: filled, a flash as it closes
    const k = clamp01((s - clickAt(n)) / 0.5);
    const S = pts.map(Q);
    if (S.every(Boolean)) {
      ctx.beginPath(); S.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1]))); ctx.closePath();
      ctx.fillStyle = color; ctx.globalAlpha = a * (0.16 + 0.3 * (1 - ease.out(k))); ctx.fill();
      ctx.globalAlpha = a;
      ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 24; ctx.lineWidth = 12; ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.stroke();
    }
  } else if (placed.length) {
    // the sides drawn so far
    const S = placed.map(Q);
    if (S.every(Boolean)) {
      ctx.beginPath(); S.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
      ctx.strokeStyle = color; ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.lineWidth = 8; ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // the rubber band from the last corner to the cursor, with its length
    const last = placed[placed.length - 1], L0 = Q(last), C = Q(cur), len = Math.hypot(cur[0] - last[0], cur[1] - last[1]);
    if (L0 && C) {
      ctx.setLineDash([18, 12]); ctx.strokeStyle = color; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(L0[0], L0[1]); ctx.lineTo(C[0], C[1]); ctx.stroke(); ctx.setLineDash([]);
      if (len > 6) label(ctx, (L0[0] + C[0]) / 2, (L0[1] + C[1]) / 2, `${Math.round(len)} m`, color, clamp01(len / 12), 34);
    }
  }
  // the corners: a white dot each, popping in as it's clicked
  pts.forEach((p, i) => {
    const k = clamp01((s - clickAt(i)) / 0.25);
    if (k <= 0) return;
    const q = Q(p);
    if (!q) return;
    const r = 11 * (0.6 + 0.4 * ease.back(k));
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
    ctx.fillStyle = PAPER; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = color; ctx.stroke();
    // the click: a ring spreading out
    if (k < 1) { ctx.globalAlpha = a * (1 - k); ctx.beginPath(); ctx.arc(q[0], q[1], 14 + 36 * ease.out(k), 0, Math.PI * 2); ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = a; }
  });
  // the cursor, gone soon after the shape closes
  const ca = closed ? 1 - clamp01((s - clickAt(n) - 0.3) / 0.4) : clamp01(s / 0.3);
  const C = Q(cur);
  const press = [...pts.keys(), n].some((i) => Math.abs(s - clickAt(i)) < 0.08);
  if (C && ca > 0) { ctx.globalAlpha = a * ca; cursor(ctx, C[0], C[1], 'Plot', color, press); }
  ctx.restore();
}

/** The pointer with its tool's chip beside it (pressed: a touch smaller). */
function cursor(ctx: CanvasRenderingContext2D, x: number, y: number, tool: string, color: string, press = false) {
  ctx.save();
  ctx.translate(x, y); const k = (press ? 0.88 : 1) * 1.5; ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 26); ctx.lineTo(6.5, 20); ctx.lineTo(11, 30); ctx.lineTo(15, 28); ctx.lineTo(10.5, 18.5); ctx.lineTo(19, 18.5); ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.fillStyle = PAPER; ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.font = font(15, 700);
  const tw = ctx.measureText(tool).width;
  ctx.fillStyle = color; pill(ctx, 22, 26, tw + 22, 26, 13); ctx.fill();
  ctx.fillStyle = PAPER; ctx.textBaseline = 'middle'; ctx.fillText(tool, 33, 39.5);
  ctx.restore();
}

/**
 * Placing a thing on the plot (Site Studio's shelf): the cursor comes in with the tool. `drag`: pressed at the
 * ring's first corner and dragged to its third, a dashed box growing behind it (a garden, a lot); otherwise it
 * carries the ring as a ghost and clicks it down at its place (a building). `s` seconds since t0: it arrives at 0.7,
 * lets go at 1.5 (drag) or clicks at 0.8; the outline fades out over the half second after.
 */
export function placeTool(ctx: CanvasRenderingContext2D, P: Project, ring: V2[], s: number, a: number, tool: string, drag: boolean, color = COBALT) {
  if (a <= 0 || s < 0 || ring.length < 3) return;
  const n = ring.length, cx = ring.reduce((q, p) => q + p[0], 0) / n, cz = ring.reduce((q, p) => q + p[1], 0) / n;
  const anchor: V2 = drag ? ring[0] : [cx, cz];
  const from: V2 = [anchor[0] + 34, anchor[1] - 26];
  const g = ease.inOut(clamp01(s / 0.7));
  let cur: V2 = [from[0] + (anchor[0] - from[0]) * g, from[1] + (anchor[1] - from[1]) * g];
  const done = drag ? 1.5 : 0.8;
  let box: V2[] | null = null;
  if (drag) {
    const B = ring[2], d = ease.inOut(clamp01((s - 0.75) / 0.7));
    const e: V2 = [anchor[0] + (B[0] - anchor[0]) * d, anchor[1] + (B[1] - anchor[1]) * d];
    if (s > 0.75) { cur = e; box = [anchor, [e[0], anchor[1]], e, [anchor[0], e[1]]]; }
  } else {
    // the ghost rides with the cursor
    box = ring.map(([x, z]) => [x - cx + cur[0], z - cz + cur[1]] as V2);
  }
  const fadeOut = 1 - clamp01((s - done - 0.1) / 0.5);
  const Q = (p: V2) => P(p[0], p[1], 0.8);
  ctx.save();
  ctx.globalAlpha = a * fadeOut;
  if (box) {
    const S = box.map(Q);
    if (S.every(Boolean)) {
      ctx.beginPath(); S.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1]))); ctx.closePath();
      ctx.fillStyle = color; ctx.globalAlpha = a * fadeOut * (s >= done ? 0.3 : 0.18); ctx.fill();
      ctx.globalAlpha = a * fadeOut;
      ctx.setLineDash(s >= done ? [] : [16, 10]); ctx.lineWidth = 6; ctx.strokeStyle = color; ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8; ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0;
    }
  }
  // the click / the let-go: a ring spreading out under the pointer
  const k = clamp01((s - done) / 0.35), C = Q(cur);
  if (C && k > 0 && k < 1) { ctx.globalAlpha = a * (1 - k); ctx.beginPath(); ctx.arc(C[0], C[1], 12 + 40 * ease.out(k), 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = PAPER; ctx.stroke(); }
  const ca = clamp01(s / 0.3) * (1 - clamp01((s - done - 0.3) / 0.4));
  const press = drag ? s > 0.7 && s < done : Math.abs(s - done) < 0.08;
  if (C && ca > 0) { ctx.globalAlpha = a * ca; cursor(ctx, C[0], C[1], tool, color, press); }
  ctx.restore();
}
