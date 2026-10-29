// Canvas overlay: everything interactive drawn crisply on top of the rendered city — hover / selection outlines,
// width handles, Bézier anchors, pen and line previews, vector utility lines (2D), measure, snaps, issue markers.
import type { Editor } from './editor';
import { accuracyView, anchorSel, hover, mode, penClass, penLift, readOnly, selection, settings, tool } from './state';
import { anchorsOf, FLYOVER_DECK } from '../doc/ops';
import { LINE_COLOR } from '../doc/base';
import { template, totalWidth } from '../doc/xsection';
import { bearing, MODE_LABEL, type SnapResult } from './roadtool';
import type { Id, LineKind } from '../doc/types';

export interface Handle {
  kind: 'width' | 'anchor' | 'in' | 'out';
  sx: number; sy: number;
  owner?: Id; k?: number;
  section?: Id; road?: Id; side?: 'L' | 'R';
  cx?: number; cz?: number; nx?: number; nz?: number;
}

const ACCENT = '#2f7cf6', HOVER = '#5aa0ff', WARN = '#e5484d';

export function drawOverlay(E: Editor) {
  const ctx = E.ctx, w = E.view.w, h = E.view.h;
  ctx.clearRect(0, 0, w, h);
  E.handles = [];
  const is2d = mode.value === '2d';
  const P = (x: number, z: number) => E.project(x, z);

  if (is2d) {
    drawLines(E);
    if (accuracyView.value) drawAccuracy(E);
    bridgeEdges(E);
  }

  // hover
  const hv = hover.value;
  if (hv && tool.value === 'bulldoze') outline(E, hv.id, WARN, 2.5, 0.25);
  else if (hv && !selection.value.some((s) => s.id === hv.id)) outline(E, hv.id, HOVER, 1.5, 0);
  // selection
  for (const s of selection.value) outline(E, s.id, ACCENT, 2, 0.12);

  if (is2d && !readOnly.value) {
    if (tool.value === 'select') widthHandles(E);
    if (tool.value === 'direct') anchors(E);
  }
  if (tool.value === 'pen' && is2d && settings.value.roadMode !== 'freeform' && settings.value.roadMode !== 'replace') roadTool(E);
  // pen preview
  if (tool.value === 'pen' && is2d && settings.value.roadMode === 'freeform') {
    const pts = E.pen.pts.map((p) => P(p.x, p.z)!);
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
  if (tool.value === 'line' && is2d) {
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
  if (sn && is2d) {
    const p = P(...sn.p)!;
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2;
    if (sn.kind === 'junction') { ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.stroke(); }
    else if (sn.kind === 'section') { ctx.beginPath(); ctx.moveTo(p[0] - 6, p[1] - 6); ctx.lineTo(p[0] + 6, p[1] + 6); ctx.moveTo(p[0] + 6, p[1] - 6); ctx.lineTo(p[0] - 6, p[1] + 6); ctx.stroke(); }
    if (sn.label) label(ctx, p, sn.label, 12, 18);
  }
  // marquee
  const d = E.drag;
  if (d?.kind === 'marquee') {
    const a = P(...d.a)!, b = P(...d.b)!;
    ctx.fillStyle = 'rgba(47,124,246,0.08)'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 1;
    ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
  // measure
  if (E.measure && is2d) {
    const a = P(...E.measure.a)!, b = P(...E.measure.b)!;
    ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    dot(ctx, a, 3, '#ff8a3d', '#ff8a3d'); dot(ctx, b, 3, '#ff8a3d', '#ff8a3d');
    const L = Math.hypot(E.measure.b[0] - E.measure.a[0], E.measure.b[1] - E.measure.a[1]);
    label(ctx, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], `${L.toFixed(1)} m`, 12, -12);
  }
  if (tool.value === 'measure' && !E.drag && is2d) roadWidthReadout(E);
  // issue markers
  for (const m of E.markers) {
    const p = P(m.x, m.z);
    if (!p) continue;
    dot(ctx, p, 6, m.sev === 'error' ? WARN : '#f5a524', '#fff');
  }
  if (is2d) scaleBar(E);
}

// ---------------- road tool ----------------

const LEVEL = (lift: number) => (lift > 0.25 ? '#8b5cf6' : ACCENT);

function heightText(l0: number, l1: number, len: number): string {
  if (l0 < 0.25 && l1 < 0.25) return '';
  const g = len > 0.5 ? ((l1 - l0) / len) * 100 : 0;
  return `height ${l1.toFixed(1)} m${Math.abs(g) > 0.05 ? ` · ${g > 0 ? '+' : ''}${g.toFixed(1)} %` : ''}${Math.abs(g) > 8 ? ' steep' : ''}`;
}

/** Ghost of the stretch at its real width, crossings (junction or bridge), guide lines and the readout. */
function roadTool(E: Editor) {
  const ctx = E.ctx, T = E.road, sc = E.view.scale;
  const P = (x: number, z: number) => E.view.toScreen(x, z);
  const pv = T.preview, c = T.cursor;
  if (pv && T.start) {
    const w = Math.max(3, totalWidth(template(penClass.value)) * sc);
    const lift = Math.max(pv.lift0, pv.lift1);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = lift > 0.25 ? 'rgba(139,92,246,0.28)' : 'rgba(47,124,246,0.25)';
    ctx.lineWidth = w; ctx.setLineDash([]);
    ctx.beginPath(); pv.pts.forEach((p, i) => { const q = P(p[0], p[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
    ctx.strokeStyle = LEVEL(lift); ctx.lineWidth = 2;
    if (lift > 0.25) ctx.setLineDash([8, 5]);
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
      const q = P(x.p[0], x.p[1]);
      if (x.join) dot(ctx, q, 6, '#fff', '#16a34a');
      else {
        const clear = Math.abs(x.lift - x.otherLift);
        const low = clear < FLYOVER_DECK - 1;
        ctx.fillStyle = low ? WARN : '#8b5cf6';
        ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10);
        label(ctx, q, `${x.lift > x.otherLift ? 'over' : 'under'} · ${clear.toFixed(1)} m${low ? ' low' : ''}`, 11, -14);
      }
    }
    dot(ctx, P(T.start.pt.x, T.start.pt.z), 5, '#fff', LEVEL(pv.lift0));
  }
  if (!c) return;
  guidesAndSnap(E, c);
  dot(ctx, P(c.p[0], c.p[1]), 4, LEVEL(c.lift), '#fff');
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
    readout(E, c.p, [`${MODE_LABEL[T.mode]}${penLift.value ? ` · ${penLift.value} m up` : ''}`, c.over ? 'over a road at another level' : '']);
  }
}

function guidesAndSnap(E: Editor, c: SnapResult) {
  const ctx = E.ctx;
  const P = (x: number, z: number) => E.view.toScreen(x, z);
  for (const g of c.guides ?? []) {
    const a = P(g.o[0], g.o[1]), far = 4000;
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
  const ctx = E.ctx, p = E.view.toScreen(at[0], at[1]);
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
    const L = E.doc.get<'layer'>(o.layer);
    poly(E, o.pts, false, color, Math.max(width + 2, o.size * E.view.scale + 3), 0, -o.depth * 0);
    void L;
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
    if (o?.kind !== 'line' || !vis.has(o.layer)) continue;
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
  for (let i = 0; i < g.pts.length / 2; i++) { const d = Math.hypot(g.pts[i * 2] - E.view.cx, g.pts[i * 2 + 1] - E.view.cz); if (d < bd) { bd = d; mi = i; } }
  const cx = g.pts[mi * 2], cz = g.pts[mi * 2 + 1], nx = g.nrm[mi * 2], nz = g.nrm[mi * 2 + 1];
  const Lp = E.view.toScreen(cx + nx * g.t.hwL, cz + nz * g.t.hwL), Rp = E.view.toScreen(cx - nx * g.t.hwR, cz - nz * g.t.hwR);
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
        const p = E.view.toScreen(o.pts[k * 2], o.pts[k * 2 + 1]);
        const on = as?.owner === id && as.k === k;
        square(ctx, p, on ? ACCENT : '#fff', ACCENT);
        E.handles.push({ kind: 'anchor', sx: p[0], sy: p[1], owner: id, k });
      }
      continue;
    }
    if (o?.kind !== 'section') continue;
    const P = anchorsOf(E.doc, o);
    P.forEach((a, k) => {
      const p = E.view.toScreen(a.x, a.z);
      for (const [hk, hx, hz] of [['in', a.ix, a.iz], ['out', a.ox, a.oz]] as const) {
        if ((hk === 'in' && k === 0) || (hk === 'out' && k === P.length - 1) || (!hx && !hz)) continue;
        const q = E.view.toScreen(a.x + hx, a.z + hz);
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
  const c = E.view.toWorld(...E.mouse);
  const p = E.hit.pick(c[0], c[1], 2 / E.view.scale, E.canPick);
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
