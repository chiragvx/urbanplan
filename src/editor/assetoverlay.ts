// Plan drawing of catalogue assets (2D): routes at their real width (track beds, canals with banks, corridors,
// pipes), placed structures as footprints, areas filled, things placed along lines (manholes, hydrants, towers, piers),
// TOD rings around stations, and the build tool's preview with its limits.
import type { Editor } from './editor';
import type { Id, LineObj } from '../doc/types';
import { buildAsset, hover, mode, penLift, placeRot, selection, tool } from './state';
import { assetOf, getAsset, lineShape, channelTop, type AssetDef } from '../assets';
import { bearing } from './roadtool';
import { label } from './overlay';

type V2 = [number, number];
const OFF: V2 = [NaN, NaN];

/** Lines drawn by this module (asset lines); the generic line drawing skips them. */
export const isAssetLine = (l: LineObj) => typeof l.props.asset === 'string' && !!getAsset(l.props.asset as string);

export function drawAssetLayers(E: Editor) {
  const ctx = E.ctx, s = E.view.scale;
  const [x0, z0, x1, z1] = E.view.rect;
  const pad = 600;
  const vis = new Map<Id, { color: string; opacity: number }>();
  for (const L of E.doc.all('layer')) if (L.type === 'lines' && L.visible) vis.set(L.id, { color: L.color ?? '#888', opacity: L.opacity });
  const P = (x: number, z: number): V2 => [(x - E.view.cx) * s + E.view.w / 2, (z - E.view.cz) * s + E.view.h / 2];
  const lines: LineObj[] = [];
  for (const id of E.hit.query(x0 - pad, z0 - pad, x1 + pad, z1 + pad)) {
    const o = E.doc.get(id);
    if (o?.kind === 'line' && vis.has(o.layer) && isAssetLine(o)) lines.push(o);
  }
  // areas first, then routes, then structures on top
  const order = { area: 0, route: 1, point: 2 } as const;
  lines.sort((a, b) => order[lineShape(a)] - order[lineShape(b)]);
  for (const l of lines) {
    const a = assetOf(l)!, v = vis.get(l.layer)!;
    ctx.globalAlpha = v.opacity;
    const shape = lineShape(l);
    if (shape === 'area') area(ctx, l.pts, a, P, s);
    else if (shape === 'point') footprint(ctx, l.pts[0], l.pts[1], Number(l.props.rot ?? 0), a, P, s, v.color, true);
    else route(ctx, l.pts, a, P, s, v.color, -l.depth);
    ctx.globalAlpha = 1;
  }
  // along: manholes, hydrants, towers, poles, piers (when close enough to read)
  if (s >= 0.45) for (const l of lines) {
    const a = assetOf(l)!;
    if (lineShape(l) !== 'route' || !a.along) continue;
    for (const r of a.along) alongMarks(ctx, l.pts, r.every, r.item, P, s);
  }
  // TOD rings around stations
  for (const l of lines) {
    const a = assetOf(l)!;
    const ring = a.rules?.find((r) => r.kind === 'ring');
    if (!ring || ring.kind !== 'ring' || lineShape(l) !== 'point') continue;
    const c = P(l.pts[0], l.pts[1]), R = ring.dist * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(c[0], c[1], R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(139,92,246,0.05)'; ctx.fill();
    ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(139,92,246,0.7)'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.restore();
    if (R > 40) label(ctx, [c[0], c[1] - R], `TOD ${ring.dist} m`, 10.5, -4);
  }
  // buffers of the selected / hovered asset line
  const ids = new Set([...selection.value.map((x) => x.id), ...(hover.value ? [hover.value.id] : [])]);
  for (const id of ids) {
    const l = E.doc.get<'line'>(id);
    if (l?.kind === 'line' && isAssetLine(l)) buffers(ctx, l, assetOf(l)!, P, s);
  }
}

function strokePts(ctx: CanvasRenderingContext2D, pts: number[], P: (x: number, z: number) => V2, closed = false) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) { const p = P(pts[i], pts[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
  if (closed) ctx.closePath();
}

/** A route at its real width. */
export function route(ctx: CanvasRenderingContext2D, pts: number[], a: AssetDef, P: (x: number, z: number) => V2, s: number, color: string, lift: number) {
  const p = a.profile;
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
  const band = (w: number, c: string, alpha = 1, dash: number[] = []) => {
    ctx.save(); ctx.globalAlpha *= alpha; strokePts(ctx, pts, P); ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, w * s); ctx.setLineDash(dash); ctx.stroke(); ctx.restore();
  };
  switch (p.type) {
    case 'track': {
      const viaduct = p.structure === 'viaduct', tunnel = p.structure === 'tunnel';
      if (tunnel) { band(p.formation, color, 0.18); band(0.6, color, 0.9, [10, 6]); return; }
      band(p.formation, viaduct ? '#bdb7ab' : p.metro ? '#c9c3b8' : '#a8977f', viaduct ? 0.85 : 0.75);
      if (viaduct) { band(p.formation, color, 0.25); }
      const n = p.tracks;
      if (s > 1.2) {
        // each track as a pair of rails, offset across the line
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * (n > 1 ? p.tc : 0);
          for (const r of [-p.gauge / 2, p.gauge / 2]) offsetStroke(ctx, pts, off + r, P, s, '#4b4f55', Math.max(0.8, 0.12 * s));
        }
      } else band(0.8, p.metro ? color : '#5b5f66', 0.9, p.metro ? [] : [6, 4]);
      if (lift > 0.5 && s > 0.3) band(p.formation, color, 0.9, [2, 10]);
      return;
    }
    case 'channel': {
      const top = channelTop(p), outer = top + p.banks[0] + p.banks[1];
      if (outer > top + 0.1) band(outer, p.road ? '#cfc6b4' : '#b9c7a2', 0.85);
      band(top, p.lined ? '#a9b4bd' : '#8a9a6a', 0.9);
      band(Math.max(0.6, top - 2 * p.slope * p.freeboard - 0.4), '#4f9bd1', 0.95);
      return;
    }
    case 'conduit': band(p.box ? p.box[0] : p.dia, color, 0.9, s < 2 ? [] : [8, 4]); if ((p.box ? p.box[0] : p.dia) * s < 2) band(0, color, 0.9, [8, 4]); return;
    case 'corridor': band(p.width, color, 0.12); band(0.4, color, 0.95, p.poles ? [] : [14, 4, 2, 4]); return;
    case 'path': band(p.width, a.id.includes('cycle') ? '#7fb79a' : '#d8ccb0', 0.95); return;
    default: band(1, color);
  }
}

function offsetStroke(ctx: CanvasRenderingContext2D, pts: number[], off: number, P: (x: number, z: number) => V2, s: number, color: string, w: number) {
  ctx.beginPath();
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const q = P(pts[i * 2] + dz * off, pts[i * 2 + 1] - dx * off);
    if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
  void s;
}

/** A placed structure's footprint (w across, l along `rot`). */
export function footprint(ctx: CanvasRenderingContext2D, x: number, z: number, rot: number, a: AssetDef, P: (x: number, z: number) => V2, s: number, color: string, named: boolean) {
  const p = a.profile;
  if (p.type !== 'point') return;
  const r = (rot * Math.PI) / 180, ux = Math.cos(r), uz = Math.sin(r);
  const hl = p.l / 2, hw = p.w / 2;
  const c = (al: number, ac: number): V2 => P(x + ux * al - uz * ac, z + uz * al + ux * ac);
  const minPx = 6;
  ctx.save();
  if (p.shape === 'tank' || Math.max(p.w, p.l) * s < minPx) {
    const q = P(x, z);
    ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(minPx / 2, hw * s), 0, Math.PI * 2);
  } else {
    ctx.beginPath();
    const q = [c(-hl, -hw), c(hl, -hw), c(hl, hw), c(-hl, hw)];
    ctx.moveTo(...q[0]); for (const k of q.slice(1)) ctx.lineTo(...k); ctx.closePath();
  }
  ctx.fillStyle = p.shape === 'platform' ? '#d9d2c3' : p.shape === 'yard' ? '#cfc6a8' : color;
  ctx.globalAlpha *= p.shape === 'platform' ? 0.95 : 0.8;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = shade(color); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.restore();
  if (named && s > 0.35) { const q = P(x, z); label(ctx, q, a.name, 10.5, -Math.max(8, hw * s + 6)); }
}

export function area(ctx: CanvasRenderingContext2D, pts: number[], a: AssetDef, P: (x: number, z: number) => V2, s: number) {
  const p = a.profile;
  if (p.type !== 'area') return;
  ctx.save();
  strokePts(ctx, pts, P, true);
  ctx.fillStyle = p.fill; ctx.globalAlpha *= p.hatch ? 0.16 : 0.35; ctx.fill();
  ctx.globalAlpha = 1;
  if (p.hatch) {
    ctx.save(); ctx.clip();
    const b = bbox(pts, P);
    ctx.strokeStyle = p.fill; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    for (let x = b[0] - (b[3] - b[1]); x < b[2]; x += 9) { ctx.beginPath(); ctx.moveTo(x, b[3]); ctx.lineTo(x + (b[3] - b[1]), b[1]); ctx.stroke(); }
    ctx.restore();
  }
  strokePts(ctx, pts, P, true);
  ctx.strokeStyle = p.fill; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.95; ctx.stroke();
  ctx.restore();
  if (s > 0.25) { const b = bbox(pts, P); label(ctx, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], a.name, 10.5); }
}

function bbox(pts: number[], P: (x: number, z: number) => V2): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { const p = P(pts[i], pts[i + 1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}

/** Positions every `every` metres along a polyline (first at half a step). */
export function alongPoints(pts: number[], every: number): { x: number; z: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  let next = every / 2, acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    while (next <= acc + L) { const t = (next - acc) / L; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L }); next += every; }
    acc += L;
  }
  return out;
}

function alongMarks(ctx: CanvasRenderingContext2D, pts: number[], every: number, item: string, P: (x: number, z: number) => V2, s: number) {
  if (every * s < 10) return;
  for (const q of alongPoints(pts, every)) {
    const p = P(q.x, q.z);
    ctx.beginPath();
    switch (item) {
      case 'manhole': ctx.arc(p[0], p[1], Math.max(2.5, 0.6 * s), 0, Math.PI * 2); ctx.fillStyle = '#f2f2f2'; ctx.fill(); ctx.strokeStyle = '#4b4f55'; ctx.lineWidth = 1; ctx.stroke(); break;
      case 'hydrant': ctx.arc(p[0], p[1], 3, 0, Math.PI * 2); ctx.fillStyle = '#e5484d'; ctx.fill(); break;
      case 'tower': { const r = Math.max(3, 4 * s); ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2); ctx.strokeStyle = '#6b6f75'; ctx.lineWidth = 1.3; ctx.stroke(); ctx.beginPath(); ctx.moveTo(p[0] - r, p[1] - r); ctx.lineTo(p[0] + r, p[1] + r); ctx.moveTo(p[0] + r, p[1] - r); ctx.lineTo(p[0] - r, p[1] + r); ctx.stroke(); break; }
      case 'pole': ctx.arc(p[0], p[1], 2, 0, Math.PI * 2); ctx.fillStyle = '#6b5a45'; ctx.fill(); break;
      case 'pier': { const r = Math.max(1.5, 1 * s); ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2); ctx.fillStyle = '#8e8a82'; ctx.fill(); break; }
      default: ctx.arc(p[0], p[1], 2, 0, Math.PI * 2); ctx.fillStyle = '#f5c518'; ctx.fill();
    }
  }
}

function buffers(ctx: CanvasRenderingContext2D, l: LineObj, a: AssetDef, P: (x: number, z: number) => V2, s: number) {
  for (const r of a.rules ?? []) {
    if (r.kind !== 'buffer' || lineShape(l) !== 'route') continue;
    const w = l.size + 2 * r.dist;
    ctx.save();
    strokePts(ctx, l.pts, P);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = r.sev === 'error' ? '#e5484d' : r.sev === 'warn' ? '#f5a524' : '#8e5cf7';
    ctx.globalAlpha = 0.14; ctx.lineWidth = Math.max(4, w * s); ctx.stroke();
    ctx.restore();
  }
}

function shade(hex: string) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (k: number) => Math.max(0, ((n >> k) & 255) - 50);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

// ---------------- the build tool's preview (2D and 3D) ----------------

export function drawAssetTool(E: Editor) {
  const T = E.at, a = getAsset(buildAsset.value), ctx = E.ctx;
  if (!a || !['route', 'place', 'area'].includes(tool.value)) return;
  const is2d = mode.value === '2d', s = E.view.scale;
  const lift = penLift.value;
  const P = (x: number, z: number): V2 => E.project(x, z, Math.max(0, lift)) ?? OFF;
  const color = a.layer?.color ?? '#2f7cf6';
  const c = T.cursor;
  if (tool.value === 'route') {
    const pv = T.preview;
    if (pv && pv.pts.length > 1) {
      const flat = pv.pts.flat();
      if (is2d) { ctx.save(); ctx.globalAlpha = 0.7; route(ctx, flat, a, P, s, pv.bad ? '#e5484d' : color, lift); ctx.restore(); }
      strokePts(ctx, flat, P);
      ctx.strokeStyle = pv.bad ? '#e5484d' : '#ff8a3d'; ctx.lineWidth = 2; ctx.setLineDash(pv.bad ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]);
      for (const q of T.ctrl) { const p = P(q[0], q[1]); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ff8a3d'; ctx.stroke(); }
      const end = pv.pts[pv.pts.length - 1], prev = pv.pts[pv.pts.length - 2];
      const d = [end[0] - prev[0], end[1] - prev[1]], L = Math.hypot(d[0], d[1]) || 1;
      const lines = [`${pv.len.toFixed(1)} m · ${bearing([d[0] / L, d[1] / L])}°`];
      if (Number.isFinite(pv.R) && pv.R < 5000) lines.push(`radius ${pv.R.toFixed(0)} m`);
      if (Math.abs(lift) > 0.2) lines.push(lift > 0 ? `${lift} m up` : `${-lift} m deep`);
      if (pv.bad) lines.push(`✕ ${pv.bad}`);
      const q = P(end[0], end[1]);
      label(ctx, [q[0], q[1]], lines.join(' · '), 11.5, 22);
    }
  }
  if (tool.value === 'area' && T.ring.length) {
    const flat = [...T.ring.flat(), ...(c ? c.p : [])];
    strokePts(ctx, flat, P, T.ring.length >= 2);
    ctx.fillStyle = a.profile.type === 'area' ? a.profile.fill : color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.stroke();
    for (const q of T.ring) { const p = P(q[0], q[1]); ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ff8a3d'; ctx.stroke(); }
  }
  if (tool.value === 'place' && c && is2d) {
    const rot = c.dir ? (Math.atan2(c.dir[1], c.dir[0]) * 180) / Math.PI : placeRot.value;
    ctx.save(); ctx.globalAlpha = 0.65; footprint(ctx, c.p[0], c.p[1], rot, a, P, s, color, false); ctx.restore();
    const ring = a.rules?.find((r) => r.kind === 'ring');
    if (ring?.kind === 'ring') { const q = P(c.p[0], c.p[1]); ctx.beginPath(); ctx.arc(q[0], q[1], ring.dist * s, 0, Math.PI * 2); ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(139,92,246,0.8)'; ctx.stroke(); ctx.setLineDash([]); }
  }
  // snap marker and guide
  if (c) {
    const p = P(c.p[0], c.p[1]);
    if (c.guide) {
      const g0 = P(c.guide.o[0], c.guide.o[1]), g1 = P(c.guide.o[0] + c.guide.d[0] * 2000, c.guide.o[1] + c.guide.d[1] * 2000);
      ctx.beginPath(); ctx.moveTo(...g0); ctx.lineTo(...g1); ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,138,61,0.8)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.beginPath(); ctx.arc(p[0], p[1], c.kind ? 6 : 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.stroke();
    if (c.label) label(ctx, p, c.label, 11, -14);
  }
}
