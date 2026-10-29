// Canvas overlay: everything interactive drawn crisply on top of the rendered city — hover / selection outlines,
// width handles, Bézier anchors, pen and line previews, vector utility lines (2D), measure, snaps, issue markers.
import type { Editor } from './editor';
import { accuracyView, anchorSel, dpRegionsOn, hover, mode, terrainShow, terrainView, penClass, penLift, readOnly, selection, settings, tool } from './state';
import { anchorsOf, FLYOVER_DECK } from '../doc/ops';
import { LINE_COLOR } from '../doc/base';
import { template, totalWidth } from '../doc/xsection';
import { bearing, MODE_LABEL, type SnapResult } from './roadtool';
import { SURVEY_COLOR, SURVEY_LABEL, type Id, type LineKind, type SurveyStatus } from '../doc/types';
import { parseCode } from '../doc/dpcodes';
import { drawAssetLayers, drawAssetTool, isAssetLine } from './assetoverlay';
import { lineShape } from '../assets';

export interface Handle {
  kind: 'width' | 'anchor' | 'in' | 'out';
  sx: number; sy: number;
  owner?: Id; k?: number;
  section?: Id; road?: Id; side?: 'L' | 'R';
  cx?: number; cz?: number; nx?: number; nz?: number;
}

const ACCENT = '#2f7cf6', HOVER = '#5aa0ff', WARN = '#e5484d';
const OFF: [number, number] = [NaN, NaN]; // canvas ignores NaN points: things behind the 3D camera aren't drawn

/** World → overlay pixels in either view (lift = metres above the ground). */
const at = (E: Editor, x: number, z: number, lift = 0): [number, number] => E.project(x, z, lift) ?? OFF;

export function drawOverlay(E: Editor) {
  const ctx = E.ctx, w = E.view.w, h = E.view.h;
  ctx.clearRect(0, 0, w, h);
  E.handles = [];
  const is2d = mode.value === '2d';
  const P = (x: number, z: number, lift = 0) => at(E, x, z, lift);

  if (is2d) {
    if (terrainView.value) E.tview.draw(terrainShow.value);
    if (dpRegionsOn.value) drawDPRegions(E);
    drawLines(E);
    drawAssetLayers(E);
    if (accuracyView.value) drawAccuracy(E);
    bridgeEdges(E);
  }

  // hover
  const hv = hover.value;
  if (hv && tool.value === 'bulldoze') outline(E, hv.id, WARN, 2.5, 0.25);
  else if (hv && !selection.value.some((s) => s.id === hv.id)) outline(E, hv.id, HOVER, 1.5, 0);
  // selection
  for (const s of selection.value) outline(E, s.id, ACCENT, 2, 0.12);

  if (!readOnly.value) {
    if (tool.value === 'select') widthHandles(E);
    if (tool.value === 'direct') anchors(E);
  }
  if (tool.value === 'pen' && settings.value.roadMode !== 'freeform' && settings.value.roadMode !== 'replace') roadTool(E);
  drawAssetTool(E);
  // pen preview
  if (tool.value === 'pen' && settings.value.roadMode === 'freeform') {
    const pts = E.pen.pts.map((p) => P(p.x, p.z, p.lift ?? 0));
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (E.pen.cursor && pts.length) { const c = P(...E.pen.cursor)!; ctx.setLineDash([6, 4]); ctx.lineTo(c[0], c[1]); }
    ctx.stroke(); ctx.setLineDash([]);
    for (const p of pts) dot(ctx, p, 4, '#fff', ACCENT);
    if (E.pen.cursor) dot(ctx, P(...E.pen.cursor)!, 3, ACCENT, ACCENT);
    if (E.road.cursor) guidesAndSnap(E, E.road.cursor);
    if (E.pen.cursor && pts.length) {
      const a = E.pen.pts[E.pen.pts.length - 1], c = E.pen.cursor;
      const L = Math.hypot(c[0] - a.x, c[1] - a.z);
      const lift = E.road.cursor?.lift ?? 0;
      readout(E, c, [`${L.toFixed(1)} m · ${bearing([(c[0] - a.x) / (L || 1), (c[1] - a.z) / (L || 1)])}°`, heightText(a.lift ?? 0, lift, L)]);
    }
  }
  if (tool.value === 'line') {
    const L = E.linePts;
    ctx.strokeStyle = '#7a5cd6'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < L.length; i += 2) { const p = P(L[i], L[i + 1])!; if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    if (E.pen.cursor && L.length) { const c = P(...E.pen.cursor)!; ctx.lineTo(c[0], c[1]); }
    ctx.stroke();
    for (let i = 0; i < L.length; i += 2) dot(ctx, P(L[i], L[i + 1])!, 3.5, '#fff', '#7a5cd6');
  }
  // snap indicator
  const sn = E.snap ?? (tool.value === 'pen' ? E.pen.snap : null);
  if (sn) {
    const p = P(...sn.p)!;
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2;
    if (sn.kind === 'junction') { ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.stroke(); }
    else if (sn.kind === 'section') { ctx.beginPath(); ctx.moveTo(p[0] - 6, p[1] - 6); ctx.lineTo(p[0] + 6, p[1] + 6); ctx.moveTo(p[0] + 6, p[1] - 6); ctx.lineTo(p[0] - 6, p[1] + 6); ctx.stroke(); }
    if (sn.label) label(ctx, p, sn.label, 12, 18);
  }
  if (terrainView.value) earthworks(E);
  if (tool.value === 'terrain') terrainTool(E);
  else if (terrainView.value && is2d && !E.drag && tool.value === 'select') terrainReadout(E);
  // marquee
  const d = E.drag;
  if (d?.kind === 'marquee') {
    const a = P(...d.a)!, b = P(...d.b)!;
    ctx.fillStyle = 'rgba(47,124,246,0.08)'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
  // measure
  if (E.measure) {
    const a = P(...E.measure.a)!, b = P(...E.measure.b)!;
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    dot(ctx, a, 3, '#ff8a3d', '#ff8a3d'); dot(ctx, b, 3, '#ff8a3d', '#ff8a3d');
    const L = Math.hypot(E.measure.b[0] - E.measure.a[0], E.measure.b[1] - E.measure.a[1]);
    label(ctx, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], `${L.toFixed(1)} m`, 12, -12);
  }
  if (tool.value === 'measure' && !E.drag) roadWidthReadout(E);
  // issue markers
  for (const m of E.markers) {
    const p = P(m.x, m.z);
    if (!p) continue;
    dot(ctx, p, 6, m.sev === 'error' ? WARN : '#f5a524', '#fff');
  }
  if (is2d) scaleBar(E);
}

// ---------------- terrain ----------------

/** Earthwork footprints in the terrain view (dashed), the selected one highlighted. */
function earthworks(E: Editor) {
  const ctx = E.ctx, sel = new Set(selection.value.map((s) => s.id));
  for (const o of E.doc.all('earthwork')) {
    const on = sel.has(o.id) || hover.value?.id === o.id;
    const P = o.pts;
    ctx.strokeStyle = on ? ACCENT : 'rgba(120,72,30,0.8)'; ctx.lineWidth = on ? 2.5 : 1.25; ctx.setLineDash(on ? [] : [5, 4]);
    ctx.beginPath();
    if (o.op === 'pad' || o.op === 'pond') { for (let i = 0; i < P.length; i += 2) { const p = at(E, P[i], P[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } ctx.closePath(); }
    else if (o.op === 'slope') { const a = at(E, P[0], P[1]), b = at(E, P[2], P[3]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    else for (let i = 0; i + 1 < P.length; i += 3) { const p = at(E, P[i], P[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke(); ctx.setLineDash([]);
  }
}

/** Height (and cut / fill) under the cursor. */
function heightLines(E: Editor, w: [number, number]) {
  const hf = E.hf;
  const s = hf.sampleSurface(w[0], w[1]), g = hf.sample(w[0], w[1], hf.ground);
  const d = s - g;
  return [`${(s + hf.base).toFixed(1)} m above sea level`, Math.abs(d) >= 0.05 ? `${d > 0 ? 'fill' : 'cut'} ${Math.abs(d).toFixed(1)} m vs the original ground` : ''];
}

function terrainReadout(E: Editor) {
  const w = E.toWorld(...E.mouse);
  readout(E, w, heightLines(E, w));
}

function terrainTool(E: Editor) {
  const T = E.terra, ctx = E.ctx, c = T.cursor;
  const st = settings.value, op = st.terrainOp;
  // shape being clicked
  if (T.pts.length) {
    ctx.strokeStyle = '#b45309'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < T.pts.length; i += 2) { const p = at(E, T.pts[i], T.pts[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    if (c) { const p = at(E, c[0], c[1]); ctx.lineTo(p[0], p[1]); }
    if (op !== 'embank') ctx.closePath();
    ctx.stroke(); ctx.setLineDash([]);
    for (let i = 0; i < T.pts.length; i += 2) dot(ctx, at(E, T.pts[i], T.pts[i + 1]), 3.5, '#fff', '#b45309');
  }
  if (!c) return;
  // brush circle (a ring of points so it follows the ground in 3D)
  const r = op === 'embank' ? st.embankWidth / 2 : st.brushRadius;
  if (op !== 'pad' && op !== 'pond') {
    ctx.strokeStyle = 'rgba(180,83,9,0.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2, p = at(E, c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
  }
  // slope preview
  const s = T.stroke;
  if (s?.op === 'slope') {
    const a = at(E, s.start[0], s.start[1]), b = at(E, c[0], c[1]);
    ctx.strokeStyle = '#b45309'; ctx.lineWidth = Math.max(2, r * 2 * E.ppm); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.stroke();
    const hA = st.levelHeight ?? T.heightAt(s.start[0], s.start[1]), hB = T.heightAt(c[0], c[1]), L = Math.hypot(c[0] - s.start[0], c[1] - s.start[1]);
    readout(E, c, [`Slope ${L.toFixed(0)} m`, `${hA.toFixed(1)} → ${hB.toFixed(1)} m · ${L > 1 ? (((hB - hA) / L) * 100).toFixed(1) : '0'} %`]);
    return;
  }
  const lines = heightLines(E, c);
  if (op === 'level') lines.unshift(st.levelBalanced ? 'Level: balanced (cut = fill)' : `Level to ${st.levelHeight ?? 'the height where you start'}${st.levelHeight !== null ? ' m' : ''}`);
  readout(E, c, lines);
}

// ---------------- road tool ----------------

const UNDER = '#0e9f6e';
const LEVEL = (lift: number) => (lift > 0.25 ? '#8b5cf6' : lift < -0.25 ? UNDER : ACCENT);

function heightText(l0: number, l1: number, len: number): string {
  if (Math.abs(l0) < 0.25 && Math.abs(l1) < 0.25) return '';
  const g = len > 0.5 ? ((l1 - l0) / len) * 100 : 0;
  return `${l1 >= 0 ? `height ${l1.toFixed(1)} m` : `${(-l1).toFixed(1)} m deep${-l1 >= 6.5 ? ' (tunnel)' : ' (open cut)'}`}${Math.abs(g) > 0.05 ? ` · ${g > 0 ? '+' : ''}${g.toFixed(1)} %` : ''}${Math.abs(g) > 8 ? ' steep' : ''}`;
}

/** Ghost of the stretch at its real width, crossings (junction or bridge), guide lines and the readout. */
function roadTool(E: Editor) {
  const ctx = E.ctx, T = E.road, sc = E.ppm;
  const P = (x: number, z: number, lift = 0) => at(E, x, z, lift);
  const pv = T.preview, c = T.cursor;
  if (pv && T.start) {
    const w = Math.max(3, totalWidth(template(penClass.value)) * sc);
    const lift = Math.abs(pv.lift0) > Math.abs(pv.lift1) ? pv.lift0 : pv.lift1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = lift > 0.25 ? 'rgba(139,92,246,0.28)' : lift < -0.25 ? 'rgba(14,159,110,0.25)' : 'rgba(47,124,246,0.25)';
    ctx.lineWidth = w; ctx.setLineDash([]);
    const liftAt = (i: number) => pv.lift0 + ((pv.lift1 - pv.lift0) * i) / Math.max(1, pv.pts.length - 1);
    ctx.beginPath(); pv.pts.forEach((p, i) => { const q = P(p[0], p[1], liftAt(i)); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
    ctx.strokeStyle = LEVEL(lift); ctx.lineWidth = 2;
    if (Math.abs(lift) > 0.25) ctx.setLineDash(lift > 0 ? [8, 5] : [3, 4]);
    ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'butt';
    // control polygon for the curve modes
    if (T.ctrl.length) {
      ctx.strokeStyle = 'rgba(47,124,246,0.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const pts = [[T.start.pt.x, T.start.pt.z], ...T.ctrl, c ? c.p : null].filter(Boolean) as [number, number][];
      pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      ctx.stroke(); ctx.setLineDash([]);
      for (const p of T.ctrl) square(ctx, P(p[0], p[1]), '#fff', ACCENT);
    }
    // crossings: a junction will be made (same level) or it passes over / under
    for (const x of pv.crossings) {
      const q = P(x.p[0], x.p[1], x.lift);
      if (x.join) dot(ctx, q, 6, '#fff', '#16a34a');
      else {
        const clear = Math.abs(x.lift - x.otherLift);
        const low = clear < FLYOVER_DECK - 1;
        ctx.fillStyle = low ? WARN : '#8b5cf6';
        ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10);
        label(ctx, q, `${x.lift > x.otherLift ? 'over' : 'under'} · ${clear.toFixed(1)} m${low ? ' low' : ''}`, 11, -14);
      }
    }
    dot(ctx, P(T.start.pt.x, T.start.pt.z, pv.lift0), 5, '#fff', LEVEL(pv.lift0));
  }
  if (!c) return;
  guidesAndSnap(E, c);
  dot(ctx, P(c.p[0], c.p[1], c.lift), 4, LEVEL(c.lift), '#fff');
  if (pv && T.start) {
    const ch = [c.p[0] - T.start.pt.x, c.p[1] - T.start.pt.z], L = Math.hypot(ch[0], ch[1]) || 1;
    const lines = [`${pv.len.toFixed(1)} m · ${bearing([ch[0] / L, ch[1] / L])}°${pv.R < 1e5 ? ` · R ${pv.R.toFixed(0)} m` : ''}`];
    if (T.start.dir && !T.ctrl.length) {
      const a = Math.round((Math.acos(Math.max(-1, Math.min(1, (T.start.dir[0] * ch[0] + T.start.dir[1] * ch[1]) / L))) * 180) / Math.PI);
      if (T.mode === 'straight' && a > 0) lines[0] += ` · turn ${a}°`;
    }
    lines.push(heightText(pv.lift0, pv.lift1, pv.len));
    const joins = pv.crossings.filter((x) => x.join).length, over = pv.crossings.length - joins;
    if (joins || over) lines.push([joins ? `${joins} junction${joins > 1 ? 's' : ''}` : '', over ? `${over} bridge crossing${over > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '));
    readout(E, c.p, lines);
  } else {
    readout(E, c.p, [`${MODE_LABEL[T.mode]}${penLift.value > 0 ? ` · ${penLift.value} m up` : penLift.value < 0 ? ` · ${-penLift.value} m deep` : ''}`, c.over ? 'over a road at another level' : '']);
  }
}

function guidesAndSnap(E: Editor, c: SnapResult) {
  const ctx = E.ctx;
  const P = (x: number, z: number) => at(E, x, z, c.lift);
  for (const g of c.guides ?? []) {
    const a = P(g.o[0], g.o[1]), far = mode.value === '2d' ? 4000 : 250;
    const b = P(g.o[0] + g.d[0] * far, g.o[1] + g.d[1] * far), b0 = g.ray ? a : P(g.o[0] - g.d[0] * far, g.o[1] - g.d[1] * far);
    ctx.strokeStyle = 'rgba(255,138,61,0.85)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (!c.kind) return;
  const p = P(c.p[0], c.p[1]);
  ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2;
  if (c.kind === 'junction') { ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.stroke(); }
  else if (c.kind === 'section') { ctx.beginPath(); ctx.moveTo(p[0] - 6, p[1] - 6); ctx.lineTo(p[0] + 6, p[1] + 6); ctx.moveTo(p[0] + 6, p[1] - 6); ctx.lineTo(p[0] - 6, p[1] + 6); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(p[0] - 7, p[1]); ctx.lineTo(p[0] + 7, p[1]); ctx.moveTo(p[0], p[1] - 7); ctx.lineTo(p[0], p[1] + 7); ctx.stroke(); }
  if (c.label) label(ctx, p, c.label, 11, 20);
}

/** Multi-line measurement box next to the cursor (Precision Engineering style). */
function readout(E: Editor, at: [number, number], lines: string[]) {
  const L = lines.filter(Boolean);
  if (!L.length) return;
  const ctx = E.ctx, p = E.project(at[0], at[1]) ?? OFF;
  if (Number.isNaN(p[0])) return;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  const w = Math.max(...L.map((t) => ctx.measureText(t).width)) + 14, h = L.length * 16 + 8;
  let x = p[0] + 16, y = p[1] - h - 12;
  if (x + w > E.view.w - 4) x = p[0] - w - 16;
  if (y < 4) y = p[1] + 16;
  ctx.fillStyle = 'rgba(20,24,30,0.86)';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  L.forEach((t, i) => ctx.fillText(t, x + 7, y + 5 + i * 16));
  ctx.textBaseline = 'alphabetic';
}

// ---------------- outlines ----------------

function outline(E: Editor, id: Id, color: string, width: number, fill: number) {
  const o = E.doc.get(id);
  if (!o) return;
  const ctx = E.ctx;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([]);
  if (o.kind === 'road') { for (const s of E.doc.sectionsOf(id)) sectionOutline(E, s.id, color, width, fill); return; }
  if (o.kind === 'section') { sectionOutline(E, id, color, width, fill); return; }
  if (o.kind === 'junction') {
    const ring = E.C.junctionRing(id);
    if (ring) poly(E, ring.flat(), true, color, width, fill);
    const p = E.project(o.x, o.z, o.lift);
    if (p) dot(ctx, p, 4, color, '#fff');
    return;
  }
  if (o.kind === 'line') {
    const shape = lineShape(o);
    if (shape === 'point') {
      const p = E.project(o.pts[0], o.pts[1], 0);
      if (p) { ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(9, (o.size * E.view.scale) / 2 + 4), 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
      return;
    }
    if (shape === 'area') { poly(E, o.pts, true, color, width, fill); return; }
    poly(E, o.pts, false, color, Math.max(width + 2, o.size * E.view.scale + 3), 0, -o.depth * 0);
    return;
  }
  if (o.kind === 'building') poly(E, o.outer, true, color, width, fill);
}

/** In the plan, bridges and flyovers get a purple edge so they read as above the roads they cross. */
function bridgeEdges(E: Editor) {
  if (E.view.scale < 0.6) return;
  const [x0, z0, x1, z1] = E.view.rect;
  for (const id of E.hit.inRect(x0, z0, x1, z1, ['section'], E.canPick)) {
    const s = E.doc.get<'section'>(id);
    if (s && (s.elevated || s.bridge !== 'none')) sectionOutline(E, id, 'rgba(139,92,246,0.75)', 1.5, 0);
    else if (s?.tunnel) { E.ctx.setLineDash([5, 4]); sectionOutline(E, id, 'rgba(14,159,110,0.9)', 1.5, 0.14); E.ctx.setLineDash([]); }
  }
}

function sectionOutline(E: Editor, id: Id, color: string, width: number, fill: number) {
  const g = E.C.geo(id);
  if (!g) return;
  const n = g.pts.length / 2;
  const L: number[] = [], R: number[] = [];
  const step = Math.max(1, Math.floor(n / 200));
  for (let i = 0; i < n; i += step) push(i);
  if ((n - 1) % step) push(n - 1);
  function push(i: number) {
    const x = g!.pts[i * 2], z = g!.pts[i * 2 + 1], nx = g!.nrm[i * 2], nz = g!.nrm[i * 2 + 1];
    L.push(x + nx * g!.t.hwL, z + nz * g!.t.hwL);
    R.push(x - nx * g!.t.hwR, z - nz * g!.t.hwR);
  }
  const ring = [...L];
  for (let i = R.length - 2; i >= 0; i -= 2) ring.push(R[i], R[i + 1]);
  const s = E.doc.get<'section'>(id);
  poly(E, ring, true, color, width, fill, s?.elevated ? 6 : 0);
}

function poly(E: Editor, pts: number[], closed: boolean, color: string, width: number, fill: number, lift = 0) {
  const ctx = E.ctx;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < pts.length; i += 2) {
    const p = E.project(pts[i], pts[i + 1], lift);
    if (!p) { started = false; continue; }
    if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
  }
  if (closed) ctx.closePath();
  if (fill > 0) { ctx.globalAlpha = fill; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.stroke();
}

// ---------------- vector layers (2D) ----------------

function drawLines(E: Editor) {
  const ctx = E.ctx;
  const vis = new Map<Id, { color: string; kind: LineKind; opacity: number; under: boolean }>();
  for (const L of E.doc.all('layer')) if (L.type === 'lines' && L.visible && L.id !== 'paths')
    vis.set(L.id, { color: L.color ?? LINE_COLOR[L.lineKind ?? 'other'], kind: L.lineKind ?? 'other', opacity: L.opacity, under: L.group === 'underground' });
  if (!vis.size) return;
  const [x0, z0, x1, z1] = E.view.rect;
  const s = E.view.scale;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // batch by layer for speed
  const byLayer = new Map<Id, number[][]>();
  for (const id of E.hit.query(x0, z0, x1, z1)) {
    const o = E.doc.get(id);
    if (o?.kind !== 'line' || !vis.has(o.layer) || isAssetLine(o)) continue;
    (byLayer.get(o.layer) ?? byLayer.set(o.layer, []).get(o.layer)!).push(o.pts);
  }
  for (const [layer, lines] of byLayer) {
    const v = vis.get(layer)!;
    const size = v.kind === 'metro' ? 9 : v.kind === 'rail' ? 3 : 0;
    ctx.globalAlpha = v.opacity * (v.kind === 'metro' ? 0.28 : v.kind === 'rail' ? 0.6 : 0.9);
    ctx.strokeStyle = v.color;
    ctx.lineWidth = Math.max(v.under ? 1.6 : 2, size * s);
    ctx.setLineDash(v.under && s < 2 ? [] : v.under ? [8, 4] : []);
    ctx.beginPath();
    for (const pts of lines) {
      for (let i = 0; i < pts.length; i += 2) {
        const sx = (pts[i] - E.view.cx) * s + E.view.w / 2, sy = (pts[i + 1] - E.view.cz) * s + E.view.h / 2;
        if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
    }
    ctx.stroke();
    if (v.kind === 'rail' && s > 1.5) { ctx.globalAlpha = v.opacity; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.stroke(); }
    if (v.kind === 'metro') { ctx.globalAlpha = v.opacity * 0.9; ctx.strokeStyle = v.color; ctx.lineWidth = 1.5; ctx.setLineDash([10, 6]); ctx.stroke(); }
  }
  ctx.globalAlpha = 1; ctx.setLineDash([]);
}

/**
 * DP regions: land-use fill, reserved sites in a red verge, survey status as a coloured edge (green matches, amber
 * differs, red built over), the selected one highlighted and the hovered one read out.
 */
function drawDPRegions(E: Editor) {
  const D = E.dpr;
  D.load();
  if (!D.ready) return;
  const ctx = E.ctx, s = E.view.scale;
  const [x0, z0, x1, z1] = E.view.rect;
  const path = (r: number[]) => { for (let i = 0; i < r.length; i += 2) { const p = E.view.toScreen(r[i], r[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } ctx.closePath(); };
  const sel = new Set(selection.value.filter((x) => x.kind === 'region').map((x) => x.id));
  // what to draw: each traced region, or its survey object once it has one; plus hand-made regions
  type R = { id: string; cls: string; ring: number[]; holes?: number[][]; reserved: boolean; marker?: [number, number]; status: SurveyStatus; box: number[] };
  const list: R[] = [];
  for (const r of D.inRect(x0, z0, x1, z1)) {
    const o = E.doc.get<'region'>(r.id);
    list.push(o ? { ...o, box: r.box! } : { ...r, status: 'unsurveyed', box: r.box! });
  }
  for (const o of E.doc.all('region')) {
    if (D.get(o.id)) continue;
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (let i = 0; i < o.ring.length; i += 2) { bx0 = Math.min(bx0, o.ring[i]); bx1 = Math.max(bx1, o.ring[i]); bz0 = Math.min(bz0, o.ring[i + 1]); bz1 = Math.max(bz1, o.ring[i + 1]); }
    if (bx1 >= x0 && bx0 <= x1 && bz1 >= z0 && bz0 <= z1) list.push({ ...o, box: [bx0, bz0, bx1, bz1] });
  }
  for (const r of list) {
    const b = r.box;
    if ((b[2] - b[0]) * s < 1.5 && (b[3] - b[1]) * s < 1.5) continue;
    ctx.beginPath(); path(r.ring); for (const h of r.holes ?? []) path(h);
    ctx.globalAlpha = sel.has(r.id) ? 0.6 : 0.42; ctx.fillStyle = D.classColor(r.cls); ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    if (r.status !== 'unsurveyed') { ctx.strokeStyle = SURVEY_COLOR[r.status]; ctx.lineWidth = s > 1 ? 4 : 3; ctx.stroke(); }
    if (r.reserved) { ctx.strokeStyle = 'rgba(214,40,40,0.9)'; ctx.lineWidth = s > 1 ? 2 : 1.25; ctx.stroke(); }
    else if (s > 0.8 && r.status === 'unsurveyed') { ctx.strokeStyle = 'rgba(60,60,60,0.25)'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  // circled reservation codes: a small ring where the code sits on the sheet
  if (s > 0.35) for (const r of list) if (r.marker) {
    const p = E.view.toScreen(r.marker[0], r.marker[1]);
    ctx.strokeStyle = 'rgba(214,40,40,0.95)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(4, 12 * s), 0, Math.PI * 2); ctx.stroke();
  }
  for (const r of list) if (sel.has(r.id)) {
    ctx.beginPath(); path(r.ring);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2.5; ctx.setLineDash([7, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  const h = E.dpHover;
  if (h && !sel.has(h.id)) {
    const o = E.doc.get<'region'>(h.id);
    const r = o ?? h;
    ctx.beginPath(); path(r.ring); for (const q of r.holes ?? []) path(q);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.setLineDash([]); ctx.stroke();
    const code = parseCode(o?.code);
    readout(E, E.toWorld(...E.mouse), [
      `${D.classLabel(r.cls)}${r.reserved ? ` · reserved site${code ? ` ${o!.code}${code.purpose ? ` (${code.purpose})` : ''}` : h.marker ? ' (code on the sheet)' : ''}` : ''}`,
      `${r.area >= 10000 ? `${(r.area / 10000).toFixed(2)} ha` : `${r.area.toLocaleString()} m²`} · DP sheet ${h.sheet} · confidence ${Math.round(h.conf * 100)} %`,
      o && o.status !== 'unsurveyed' ? `Survey: ${SURVEY_LABEL[o.status]}${o.note ? ` — ${o.note.slice(0, 60)}` : ''}` : 'Click to survey it',
    ]);
  }
}

function drawAccuracy(E: Editor) {
  const ctx = E.ctx;
  const [x0, z0, x1, z1] = E.view.rect;
  ctx.lineCap = 'round';
  for (const id of E.hit.query(x0, z0, x1, z1)) {
    const s = E.doc.get(id);
    if (s?.kind !== 'section') continue;
    const g = E.C.geo(id);
    if (!g) continue;
    const edited = E.doc.patch.has(id) || E.doc.patch.has(s.road);
    const color = s.verified ? '#2fb344' : edited ? '#8e5cf7' : s.widthSrc === 'dp' ? '#2f7cf6' : s.widthSrc === 'osm' ? '#f5a524' : '#8a8f98';
    ctx.strokeStyle = color; ctx.globalAlpha = 0.65;
    ctx.lineWidth = Math.max(3, (g.t.hwL + g.t.hwR) * E.view.scale * 0.55);
    ctx.beginPath();
    for (let i = 0; i < g.pts.length; i += 2) { const p = E.view.toScreen(g.pts[i], g.pts[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------------- handles ----------------

function widthHandles(E: Editor) {
  const sel = selection.value;
  if (sel.length !== 1 || (sel[0].kind !== 'section' && sel[0].kind !== 'road')) return;
  let sid: Id | undefined, road: Id | undefined;
  if (sel[0].kind === 'section') sid = sel[0].id;
  else {
    road = sel[0].id;
    let best = 0;
    for (const s of E.doc.sectionsOf(road)) { const g = E.C.geo(s.id); if (g && g.len > best) { best = g.len; sid = s.id; } }
  }
  const g = sid ? E.C.geo(sid) : undefined;
  if (!g || !sid) return;
  // station: the part of the section closest to the view centre (so the handles are on screen)
  let mi = Math.floor(g.pts.length / 4), bd = Infinity;
  const [vx, vz] = E.centre;
  for (let i = 0; i < g.pts.length / 2; i++) { const d = Math.hypot(g.pts[i * 2] - vx, g.pts[i * 2 + 1] - vz); if (d < bd) { bd = d; mi = i; } }
  const cx = g.pts[mi * 2], cz = g.pts[mi * 2 + 1], nx = g.nrm[mi * 2], nz = g.nrm[mi * 2 + 1];
  const lift = E.doc.get<'section'>(sid)?.elevated ? 6 : 0;
  const Lp = E.project(cx + nx * g.t.hwL, cz + nz * g.t.hwL, lift), Rp = E.project(cx - nx * g.t.hwR, cz - nz * g.t.hwR, lift);
  if (!Lp || !Rp) return;
  const ctx = E.ctx;
  // dimension line
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(Lp[0], Lp[1]); ctx.lineTo(Rp[0], Rp[1]); ctx.stroke(); ctx.setLineDash([]);
  for (const [p, side] of [[Lp, 'L'], [Rp, 'R']] as const) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(p[0] - 5, p[1] - 5, 10, 10, 3); ctx.fill(); ctx.stroke();
    E.handles.push({ kind: 'width', sx: p[0], sy: p[1], section: sid, road, side, cx, cz, nx, nz });
  }
  const s = E.doc.get<'section'>(sid)!;
  const txt = `${totalWidth(s.parts).toFixed(1)} m${road ? ' · whole road' : ''}`;
  label(ctx, [(Lp[0] + Rp[0]) / 2, (Lp[1] + Rp[1]) / 2], txt, 12, -16);
}

function anchors(E: Editor) {
  const ctx = E.ctx;
  const owners = new Set<Id>();
  for (const s of selection.value) {
    if (s.kind === 'section' || s.kind === 'line') owners.add(s.id);
    if (s.kind === 'road') for (const x of E.doc.sectionsOf(s.id)) owners.add(x.id);
  }
  const hv = hover.value;
  if (hv && (hv.kind === 'section' || hv.kind === 'line')) owners.add(hv.id);
  const as = anchorSel.value;
  for (const id of owners) {
    const o = E.doc.get(id);
    if (o?.kind === 'line') {
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.5;
      for (let k = 0; k < o.pts.length / 2; k++) {
        const p = at(E, o.pts[k * 2], o.pts[k * 2 + 1]);
        const on = as?.owner === id && as.k === k;
        square(ctx, p, on ? ACCENT : '#fff', ACCENT);
        E.handles.push({ kind: 'anchor', sx: p[0], sy: p[1], owner: id, k });
      }
      continue;
    }
    if (o?.kind !== 'section') continue;
    const P = anchorsOf(E.doc, o);
    P.forEach((a, k) => {
      const p = at(E, a.x, a.z, a.lift);
      for (const [hk, hx, hz] of [['in', a.ix, a.iz], ['out', a.ox, a.oz]] as const) {
        if ((hk === 'in' && k === 0) || (hk === 'out' && k === P.length - 1) || (!hx && !hz)) continue;
        const q = at(E, a.x + hx, a.z + hz, a.lift);
        ctx.strokeStyle = 'rgba(47,124,246,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        dot(ctx, q, 3.5, as?.owner === id && as.k === k && as.handle === hk ? ACCENT : '#fff', ACCENT);
        E.handles.push({ kind: hk, sx: q[0], sy: q[1], owner: id, k });
      }
      const end = k === 0 || k === P.length - 1;
      const on = as?.owner === id && as.k === k && !as.handle;
      if (end) dot(ctx, p, 5, on ? ACCENT : '#fff', '#ff8a3d');
      else square(ctx, p, on ? ACCENT : '#fff', ACCENT);
      E.handles.push({ kind: 'anchor', sx: p[0], sy: p[1], owner: id, k });
    });
  }
}

function roadWidthReadout(E: Editor) {
  const c = E.toWorld(...E.mouse);
  const p = E.hit.pick(c[0], c[1], 2 / E.ppm, E.canPick);
  if (p?.kind !== 'section') return;
  const s = E.doc.get<'section'>(p.id)!;
  const sd = E.hit.sectionDist(p.id, c[0], c[1]);
  const g = E.C.geo(p.id);
  if (!sd || !g) return;
  // building-to-building clearance along the normal at this station
  let i = 0;
  while (i < g.cum.length - 1 && g.cum[i + 1] < sd.s) i++;
  const nx = g.nrm[i * 2], nz = g.nrm[i * 2 + 1];
  const reach = (sg: number) => { for (let o = 0; o < 60; o += 0.5) if (E.world.buildingAt(sd.p[0] + nx * o * sg, sd.p[1] + nz * o * sg)) return o; return Infinity; };
  const l = reach(1), r = reach(-1);
  const free = l < Infinity && r < Infinity ? ` · between buildings ${(l + r).toFixed(1)} m` : '';
  label(E.ctx, E.mouse, `${totalWidth(s.parts).toFixed(1)} m road${s.reserve ? ` · DP ${s.reserve} m` : ''}${free}`, 12, -18);
}

// ---------------- primitives ----------------

function dot(ctx: CanvasRenderingContext2D, p: [number, number], r: number, fill: string, stroke: string) {
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
function square(ctx: CanvasRenderingContext2D, p: [number, number], fill: string, stroke: string) {
  ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 1.5;
  ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8); ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8);
}
export function label(ctx: CanvasRenderingContext2D, p: [number, number], text: string, size = 12, dy = 0) {
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 12;
  const x = p[0] - w / 2, y = p[1] + dy - size / 2 - 4;
  ctx.fillStyle = 'rgba(20,24,30,0.88)';
  ctx.beginPath(); ctx.roundRect(x, y, w, size + 8, 5); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + (size + 8) / 2 + 0.5);
}

function scaleBar(E: Editor) {
  const ctx = E.ctx, s = E.view.scale;
  const target = 120 / s;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const m = steps.find((x) => x >= target * 0.6) ?? 2000;
  const px = m * s, x = 16, y = E.view.h - 54;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 6, y - 16, px + 12, 26);
  ctx.strokeStyle = '#1f2328'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 5); ctx.lineTo(x + px, y + 5); ctx.lineTo(x + px, y); ctx.stroke();
  ctx.fillStyle = '#1f2328'; ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, x + 2, y - 3);
}
