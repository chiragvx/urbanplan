// The FSI map's zoomable view (/<city>/fsi-map/): the roads by the FSI their plots get, or a pixel heat map of the
// highest FSI a plot can get in each square, drawn on a canvas from the baked road data (tools/maps/bake-maps.ts,
// fsiData). The main roads load with the page; the local streets when the map is zoomed in. The heat map's squares
// get finer as it zooms (400 m to 25 m), each level worked out once and kept. The prerendered page shows the static
// SVG map until the data is in, and keeps it for search engines and pages without scripts.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FsiView } from './model';

type Mode = 'roads' | 'heat';
interface Lines { cls: Uint8Array; start: Uint32Array; xy: Int32Array }
interface Grid { cell: number; gw: number; gh: number; g: Uint8Array; img: HTMLCanvasElement }

/** The road stream: varints, per line its class, its point count, then zigzag deltas from the point before. */
function decode(buf: ArrayBuffer): Lines {
  const b = new Uint8Array(buf);
  let i = 0;
  const v = () => { let n = 0, s = 0, c: number; do { c = b[i++]; n += (c & 127) * 2 ** s; s += 7; } while (c & 128); return n; };
  const zz = () => { const n = v(); return n % 2 ? -(n + 1) / 2 : n / 2; };
  const n = v(), cls = new Uint8Array(n), start = new Uint32Array(n + 1);
  let xy = new Int32Array(1 << 16), p = 0, x = 0, z = 0;
  for (let l = 0; l < n; l++) {
    cls[l] = v();
    const m = v();
    start[l] = p / 2;
    if (p + m * 2 > xy.length) { const bigger = new Int32Array(Math.max(xy.length * 2, p + m * 2)); bigger.set(xy); xy = bigger; }
    for (let k = 0; k < m; k++) { x += zz(); z += zz(); xy[p++] = x; xy[p++] = z; }
  }
  start[n] = p / 2;
  return { cls, start, xy: xy.subarray(0, p) };
}

/** One Path2D per road class. */
const paths = (L: Lines, classes: number) => {
  const out = Array.from({ length: classes }, () => new Path2D());
  for (let l = 0; l < L.cls.length; l++) {
    const P = out[L.cls[l]], a = L.start[l], b = L.start[l + 1];
    P.moveTo(L.xy[a * 2], L.xy[a * 2 + 1]);
    for (let k = a + 1; k < b; k++) P.lineTo(L.xy[k * 2], L.xy[k * 2 + 1]);
  }
  return out;
};

const LEVELS = [25, 50, 100, 200, 400];
const BG = '#f2efe9';
const rgb = (c: string) => [1, 3, 5].map((s) => parseInt(c.slice(s, s + 2), 16));

/** The heat map at `cell` m: each square takes the highest FSI of any road through it (at 25 m, within a square of it). */
function grid(V: FsiView, tiers: Lines[], cell: number): Grid {
  const u = cell / V.unit, gw = Math.ceil(V.w / u), gh = Math.ceil(V.h / u);
  const g = new Uint8Array(gw * gh), rank = V.classes.map((c) => c.fsi);
  const r = cell <= 25 ? 1 : 0, step = u / 2;
  const stamp = (gx: number, gz: number, k: number) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = gx + dx, z = gz + dz;
      if (x < 0 || z < 0 || x >= gw || z >= gh) continue;
      const i = z * gw + x, cur = g[i];
      if (!cur || rank[cur - 1] < rank[k]) g[i] = k + 1;
    }
  };
  for (const L of tiers) for (let l = 0; l < L.cls.length; l++) {
    const k = L.cls[l];
    for (let p = L.start[l]; p < L.start[l + 1] - 1; p++) {
      const x0 = L.xy[p * 2], z0 = L.xy[p * 2 + 1], x1 = L.xy[p * 2 + 2], z1 = L.xy[p * 2 + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let t = 0; t <= n; t++) stamp(Math.floor((x0 + ((x1 - x0) * t) / n) / u), Math.floor((z0 + ((z1 - z0) * t) / n) / u), k);
    }
  }
  const img = document.createElement('canvas');
  img.width = gw; img.height = gh;
  const ctx = img.getContext('2d')!, data = ctx.createImageData(gw, gh), cols = V.classes.map((c) => rgb(c.color));
  for (let i = 0; i < g.length; i++) {
    if (!g[i]) continue;
    const c = cols[g[i] - 1];
    data.data[i * 4] = c[0]; data.data[i * 4 + 1] = c[1]; data.data[i * 4 + 2] = c[2]; data.data[i * 4 + 3] = 235;
  }
  ctx.putImageData(data, 0, 0);
  return { cell, gw, gh, g, img };
}

const niceM = (m: number) => [50, 100, 200, 500, 1000, 2000, 5000, 10000].reduce((p, q) => (Math.abs(Math.log(q / m)) < Math.abs(Math.log(p / m)) ? q : p));
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const range = (c: FsiView['classes'][number]) => (c.hi === null ? `${c.lo} m and wider` : c.lo === 0 ? `under ${c.hi} m` : `${c.lo} to ${c.hi} m`);

export function FsiMap({ view: V, base, svg, svgW, svgH, alt, calc }: { view: FsiView; base: string; svg: string; svgW: number; svgH: number; alt: string; calc: string }) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('roads');
  const [ready, setReady] = useState(false);
  const [here, setHere] = useState<{ k: number; x: number; y: number } | null>(null);
  const [cellM, setCellM] = useState(0);
  // everything the drawing needs, outside Preact's state (it changes on every frame of a drag)
  const S = useRef({
    mode: 'roads' as Mode, cx: V.w / 2, cz: V.h / 2, s: 0, fit: 0, W: 0, H: 0, dpr: 1, raf: 0,
    main: null as Lines | null, local: null as Lines | null, localAsked: false,
    mainPaths: null as Path2D[] | null, localPaths: null as Path2D[] | null, grids: new Map<string, Grid>(),
  }).current;

  const draw = () => {
    S.raf = 0;
    const c = cv.current;
    if (!c || !S.main || !S.s) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, S.W, S.H);
    const tx = S.W / 2 - S.cx * S.s, tz = S.H / 2 - S.cz * S.s;
    const world = () => ctx.setTransform(S.dpr * S.s, 0, 0, S.dpr * S.s, S.dpr * tx, S.dpr * tz);
    const zoom = S.s / S.fit, showLocal = zoom >= 4;
    if (showLocal && !S.localAsked) loadLocal();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (S.mode === 'heat') {
      const want = (7 / S.s) * V.unit;
      const cell = LEVELS.reduce((p, q) => (Math.abs(Math.log(q / want)) < Math.abs(Math.log(p / want)) ? q : p));
      const tiers = cell <= 50 && S.local ? [S.main, S.local] : [S.main];
      const key = `${cell}|${tiers.length}`;
      let G = S.grids.get(key);
      if (!G) { G = grid(V, tiers, cell); S.grids.set(key, G); }
      if (cell !== cellM) setCellM(cell);
      world();
      ctx.imageSmoothingEnabled = false;
      const u = cell / V.unit;
      ctx.drawImage(G.img, 0, 0, G.gw * u, G.gh * u);
      // the main roads, faint, to find your way
      ctx.strokeStyle = 'rgba(40,30,25,0.28)'; ctx.lineWidth = 0.8 / S.s;
      for (const P of S.mainPaths!) ctx.stroke(P);
    } else {
      world();
      const px = (k: number, local: boolean) => (local ? 0.9 : 1.2 + (V.classes[k].fsi - 1) * 1.1) * Math.min(3.2, Math.max(1, Math.sqrt(zoom) * 0.9));
      if (showLocal && S.localPaths) S.localPaths.forEach((P, k) => { ctx.strokeStyle = V.classes[k].color; ctx.lineWidth = px(k, true) / S.s; ctx.stroke(P); });
      // lowest FSI first, so the highest is on top
      const order = V.classes.map((_, k) => k).sort((a, b) => V.classes[a].fsi - V.classes[b].fsi);
      for (const k of order) { ctx.strokeStyle = V.classes[k].color; ctx.lineWidth = px(k, false) / S.s; ctx.stroke(S.mainPaths![k]); }
    }
    // place pages, labelled where there's room
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.font = '600 12px Inter, "Segoe UI", Arial, sans-serif';
    const placed: [number, number, number][] = [];
    for (const p of V.places) {
      const x = p.x * S.s + tx, y = p.z * S.s + tz;
      if (x < -50 || y < -20 || x > S.W + 50 || y > S.H + 20) continue;
      ctx.fillStyle = '#1d1a17'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const w = ctx.measureText(p.name).width;
      if (placed.some(([ox, oy, ow]) => Math.abs(ox - x) < (ow + w) / 2 + 12 && Math.abs(oy - y) < 16)) continue;
      placed.push([x + 8 + w / 2, y, w]);
      ctx.lineWidth = 3; ctx.strokeText(p.name, x + 7, y + 4); ctx.fillText(p.name, x + 7, y + 4);
    }
    // scale bar
    const m = niceM((S.W / 5) * (V.unit / S.s)), bw = (m / V.unit) * S.s, by = S.H - 18;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(10, by - 18, bw + 64, 28);
    ctx.strokeStyle = '#2b2723'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(18, by - 6); ctx.lineTo(18, by); ctx.lineTo(18 + bw, by); ctx.lineTo(18 + bw, by - 6); ctx.stroke();
    ctx.fillStyle = '#2b2723'; ctx.font = '500 12px Inter, "Segoe UI", Arial, sans-serif';
    ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, 24 + bw, by + 1);
  };
  const redraw = () => { if (!S.raf) S.raf = requestAnimationFrame(draw); };

  const loadLocal = () => {
    S.localAsked = true;
    fetch(base + V.local).then((r) => r.arrayBuffer()).then((b) => {
      S.local = decode(b); S.localPaths = paths(S.local, V.classes.length); redraw();
    }).catch(() => { /* the main roads are enough */ });
  };

  // size the canvas to its box
  const size = () => {
    const c = cv.current, w = wrap.current;
    if (!c || !w) return;
    const r = w.getBoundingClientRect();
    S.dpr = Math.min(2, window.devicePixelRatio || 1); S.W = r.width; S.H = r.height;
    c.width = Math.round(r.width * S.dpr); c.height = Math.round(r.height * S.dpr);
    const fit = Math.min(S.W / V.w, S.H / V.h) * 0.98;
    if (!S.s) { S.s = fit; S.cx = V.w / 2; S.cz = V.h / 2; } else S.s *= fit / S.fit;
    S.fit = fit;
    redraw();
  };

  useEffect(() => {
    let live = true;
    fetch(base + V.main).then((r) => r.arrayBuffer()).then((b) => {
      if (!live) return;
      S.main = decode(b); S.mainPaths = paths(S.main, V.classes.length);
      setReady(true);
    }).catch(() => { /* keep the static map */ });
    return () => { live = false; if (S.raf) cancelAnimationFrame(S.raf); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, [ready]);

  useEffect(() => { S.mode = mode; redraw(); }, [mode]);

  // ---- zoom and pan: wheel, drag, pinch, double-click, the buttons ----
  const zoomAt = (f: number, x = S.W / 2, y = S.H / 2) => {
    const s = Math.min(S.fit * 80, Math.max(S.fit * 0.8, S.s * f));
    const wx = S.cx + (x - S.W / 2) / S.s, wz = S.cz + (y - S.H / 2) / S.s;
    S.cx = wx - (x - S.W / 2) / s; S.cz = wz - (y - S.H / 2) / s; S.s = s;
    redraw();
  };
  const reset = () => { S.s = S.fit; S.cx = V.w / 2; S.cz = V.h / 2; redraw(); };
  useEffect(() => {
    const c = cv.current;
    if (!ready || !c) return;
    const ptr = new Map<number, { x: number; y: number }>();
    let pinch = 0, moved = 0, mid: { x: number; y: number } | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.04 : 0.0012)), p.x, p.y); };
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); ptr.set(e.pointerId, local(e)); moved = 0; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (!ptr.has(e.pointerId)) { probe(p.x, p.y); return; }
      const o = ptr.get(e.pointerId)!;
      ptr.set(e.pointerId, p);
      if (ptr.size === 1) { S.cx -= (p.x - o.x) / S.s; S.cz -= (p.y - o.y) / S.s; moved += Math.abs(p.x - o.x) + Math.abs(p.y - o.y); redraw(); }
      else if (ptr.size === 2) {
        // two fingers: move with their midpoint and zoom with their spread
        const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (mid) { S.cx -= (m.x - mid.x) / S.s; S.cz -= (m.y - mid.y) / S.s; }
        if (pinch) zoomAt(d / pinch, m.x, m.y); else redraw();
        pinch = d; mid = m; moved = 99;
      }
    };
    const up = (e: PointerEvent) => { ptr.delete(e.pointerId); pinch = 0; mid = null; if (moved < 6) { const p = local(e); probe(p.x, p.y); } };
    const cancel = (e: PointerEvent) => { ptr.delete(e.pointerId); pinch = 0; mid = null; };
    const dbl = (e: MouseEvent) => { const p = local(e); zoomAt(2, p.x, p.y); };
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', cancel);
    c.addEventListener('dblclick', dbl);
    return () => {
      c.removeEventListener('wheel', wheel); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', cancel); c.removeEventListener('dblclick', dbl);
    };
  }, [ready]);

  /** What's under the pointer: the highest FSI within about 50 m (the 50 m grid, worked out once). */
  const probe = (x: number, y: number) => {
    if (!S.main) return;
    const key = `50|${S.local ? 2 : 1}`;
    let G = S.grids.get(key);
    if (!G) { G = grid(V, S.local ? [S.main, S.local] : [S.main], 50); S.grids.set(key, G); }
    const u = 50 / V.unit, wx = S.cx + (x - S.W / 2) / S.s, wz = S.cz + (y - S.H / 2) / S.s;
    const gx = Math.floor(wx / u), gz = Math.floor(wz / u);
    const k = gx >= 0 && gz >= 0 && gx < G.gw && gz < G.gh ? G.g[gz * G.gw + gx] : 0;
    setHere(k ? { k: k - 1, x, y } : null);
  };

  const c = here ? V.classes[here.k] : null;
  return (
    <div class="fsi-map">
      <div class="fsi-map-bar">
        <div class="seg" role="group" aria-label="Map view">
          <button type="button" aria-pressed={mode === 'roads'} onClick={() => setMode('roads')}>Roads</button>
          <button type="button" aria-pressed={mode === 'heat'} onClick={() => setMode('heat')}>Heat map</button>
        </div>
        <span class="muted small">{mode === 'heat' ? `Highest FSI in each ${cellM || 400} m square` : 'Each road by the FSI its plots get'}</span>
      </div>
      <div class="fsi-map-box" ref={wrap} style={`aspect-ratio:${V.w} / ${V.h}`}>
        <img src={svg} width={svgW} height={svgH} alt={alt} fetchpriority="high" hidden={ready} />
        <canvas ref={cv} hidden={!ready} aria-label={`${alt}. Drag to move, scroll or pinch to zoom.`} role="img" />
        {ready && (
          <div class="fsi-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.8)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.8)}>−</button>
            <button type="button" aria-label="Show the whole city" onClick={reset}>⤢</button>
          </div>
        )}
        {ready && c && here && (
          <a class="fsi-here" href={`${calc}?road=${c.lo || 6}${c.zone === 'island' ? '&zone=island' : ''}`} style={`left:${Math.min(here.x + 12, (S.W || 300) - 210)}px;top:${Math.max(8, here.y - 64)}px`}>
            <b>FSI {f2(c.fsi)}</b>
            <span>roads {range(c)}{c.zone === 'island' ? ', island city' : c.zone === 'suburbs' ? ', suburbs' : ''}</span>
            <span class="go">Calculate a plot here →</span>
          </a>
        )}
      </div>
    </div>
  );
}
