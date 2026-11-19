// The FSI map's zoomable view (/<city>/fsi-map/): the roads by the FSI their plots get, or a pixel heat map of the
// FSI spreading out from the roads into the blocks around them, drawn on a canvas from the baked road data (tools/maps/bake-maps.ts,
// fsiData). The main roads load with the page; the local streets when the map is zoomed in. The heat map's squares
// get finer as it zooms (400 m to 25 m), each level worked out once and kept. The prerendered page shows the static
// SVG map until the data is in, and keeps it for search engines and pages without scripts.
import { useEffect, useRef, useState } from 'preact/hooks';
import { fsiColor, type FsiView } from './model';
import { Loading } from '../ui';

type Mode = 'roads' | 'heat';
interface Lines { cls: Uint8Array; start: Uint32Array; xy: Int32Array }
interface Grid { cell: number; gw: number; gh: number; img: HTMLCanvasElement }

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
const rgb = (c: string) => [1, 3, 5].map((s) => parseInt(c.slice(s, s + 2), 16));
const BG = '#f2efe9';

/** Blur a gw × gh field in place with a box of radius r, along x then z (three of these make a Gaussian). */
function box(a: Float32Array, t: Float32Array, gw: number, gh: number, r: number) {
  if (r < 1) return;
  const n = 2 * r + 1;
  for (let z = 0; z < gh; z++) {
    const o = z * gw;
    let sum = 0;
    for (let x = 0; x < Math.min(r, gw); x++) sum += a[o + x];
    for (let x = 0; x < gw; x++) {
      if (x + r < gw) sum += a[o + x + r];
      t[o + x] = sum / n;
      if (x - r >= 0) sum -= a[o + x - r];
    }
  }
  for (let x = 0; x < gw; x++) {
    let sum = 0;
    for (let z = 0; z < Math.min(r, gh); z++) sum += t[z * gw + x];
    for (let z = 0; z < gh; z++) {
      if (z + r < gh) sum += t[(z + r) * gw + x];
      a[z * gw + x] = sum / n;
      if (z - r >= 0) sum -= t[(z - r) * gw + x];
    }
  }
}
/** the three box radii whose passes add up to a Gaussian of this sigma (in cells) */
const boxes = (sigma: number) => {
  const wi = Math.floor(Math.sqrt(4 * sigma * sigma + 1)), wl = wi % 2 ? wi : wi - 1, wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  return [0, 1, 2].map((k) => ((k < m ? wl : wu) - 1) / 2);
};

/**
 * The heat map at `cell` m. Each square a road runs through takes the highest FSI there; then every square spreads
 * its FSI out, in a tight core and a glow a few hundred metres wide, with a weight that grows with the FSI: a wide road's colour is strong
 * and reaches further, a lane's is faint. Where several reach, the colours blend by weight (the FSI a plot there
 * would most likely see), and the colour fades with the total weight, so the blocks between roads aren't empty.
 */
function grid(V: FsiView, tiers: Lines[], cell: number): Grid {
  const u = cell / V.unit, gw = Math.ceil(V.w / u), gh = Math.ceil(V.h / u), n = gw * gh;
  const g = new Uint8Array(n), rank = V.classes.map((c) => c.fsi), step = u / 2;
  for (const L of tiers) for (let l = 0; l < L.cls.length; l++) {
    const k = L.cls[l];
    for (let p = L.start[l]; p < L.start[l + 1] - 1; p++) {
      const x0 = L.xy[p * 2], z0 = L.xy[p * 2 + 1], x1 = L.xy[p * 2 + 2], z1 = L.xy[p * 2 + 3];
      const m = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let t = 0; t <= m; t++) {
        const x = Math.floor((x0 + ((x1 - x0) * t) / m) / u), z = Math.floor((z0 + ((z1 - z0) * t) / m) / u);
        if (x < 0 || z < 0 || x >= gw || z >= gh) continue;
        const i = z * gw + x, cur = g[i];
        if (!cur || rank[cur - 1] < rank[k]) g[i] = k + 1;
      }
    }
  }
  // weight by FSI: the lowest class 0.12, the highest 1
  const lo = Math.min(...rank), hi = Math.max(...rank);
  const wt = rank.map((f) => 0.12 + 0.88 * Math.pow(hi > lo ? (f - lo) / (hi - lo) : 1, 1.6));
  // two spreads: a tight core that keeps each road readable up close, and a wide glow over the blocks around it;
  // each scaled so a lone straight road of weight 1 comes out at about 1 (a Gaussian line peaks at 1 / (2.5 sigma))
  const spread = (sigmaM: number) => {
    const w = new Float32Array(n), wf = new Float32Array(n), tmp = new Float32Array(n), sigma = sigmaM / cell;
    for (let i = 0; i < n; i++) if (g[i]) { const k = g[i] - 1; w[i] = wt[k]; wf[i] = wt[k] * rank[k]; }
    if (sigma >= 0.5) for (const r of boxes(sigma)) { box(w, tmp, gw, gh, r); box(wf, tmp, gw, gh, r); }
    const K = Math.max(1, 2.5 * sigma);
    for (let i = 0; i < n; i++) { w[i] *= K; wf[i] *= K; }
    return { w, wf };
  };
  const core = spread(Math.max(30, cell * 0.6)), glow = spread(Math.max(220, cell * 1.2));
  const w = core.w, wf = core.wf;
  for (let i = 0; i < n; i++) { w[i] = 0.7 * w[i] + glow.w[i]; wf[i] = 0.7 * wf[i] + glow.wf[i]; }
  const K = 1.5;
  const lut = Array.from({ length: 256 }, (_, j) => rgb(fsiColor(lo + ((hi - lo) * j) / 255)));
  const img = document.createElement('canvas');
  img.width = gw; img.height = gh;
  const ctx = img.getContext('2d')!, data = ctx.createImageData(gw, gh), d = data.data;
  for (let i = 0; i < n; i++) {
    const s = w[i];
    if (s < 1e-4) continue;
    const a = 1 - Math.exp(-s * K);
    if (a < 0.03) continue;
    const f = wf[i] / s, c = lut[Math.max(0, Math.min(255, Math.round(((f - lo) / (hi - lo || 1)) * 255)))];
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = Math.round(Math.min(0.94, a) * 255);
  }
  ctx.putImageData(data, 0, 0);
  return { cell, gw, gh, img };
}

const niceM = (m: number) => [50, 100, 200, 500, 1000, 2000, 5000, 10000].reduce((p, q) => (Math.abs(Math.log(q / m)) < Math.abs(Math.log(p / m)) ? q : p));

export function FsiMap({ view: V, base, svg, svgW, svgH, alt }: { view: FsiView; base: string; svg: string; svgW: number; svgH: number; alt: string }) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('heat');
  const [ready, setReady] = useState(false);
  // 'loading' only once mounted, so the prerendered page (and a page without scripts) shows the plain map
  const [busy, setBusy] = useState(false);
  const [cellM, setCellM] = useState(0);
  // everything the drawing needs, outside Preact's state (it changes on every frame of a drag)
  const S = useRef({
    drawn: false, mode: 'heat' as Mode, cx: V.w / 2, cz: V.h / 2, s: 0, fit: 0, W: 0, H: 0, dpr: 1, raf: 0,
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
    if (!S.drawn) { S.drawn = true; setBusy(false); }
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
    setBusy(true);
    fetch(base + V.main).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then((b) => {
      if (!live) return;
      S.main = decode(b); S.mainPaths = paths(S.main, V.classes.length);
      setReady(true);
    }).catch(() => { if (live) setBusy(false); /* keep the static map */ });
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
    let pinch = 0, mid: { x: number; y: number } | null = null;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.04 : 0.0012)), p.x, p.y); };
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); ptr.set(e.pointerId, local(e)); if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } };
    const move = (e: PointerEvent) => {
      const p = local(e);
      if (!ptr.has(e.pointerId)) return;
      const o = ptr.get(e.pointerId)!;
      ptr.set(e.pointerId, p);
      if (ptr.size === 1) { S.cx -= (p.x - o.x) / S.s; S.cz -= (p.y - o.y) / S.s; redraw(); }
      else if (ptr.size === 2) {
        // two fingers: move with their midpoint and zoom with their spread
        const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (mid) { S.cx -= (m.x - mid.x) / S.s; S.cz -= (m.y - mid.y) / S.s; }
        if (pinch) zoomAt(d / pinch, m.x, m.y); else redraw();
        pinch = d; mid = m;
      }
    };
    const up = (e: PointerEvent) => { ptr.delete(e.pointerId); pinch = 0; mid = null; };
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

  return (
    <div class="fsi-map">
      <div class="fsi-map-bar">
        <div class="seg" role="group" aria-label="Map view">
          <button type="button" aria-pressed={mode === 'roads'} onClick={() => setMode('roads')}>Roads</button>
          <button type="button" aria-pressed={mode === 'heat'} onClick={() => setMode('heat')}>Heat map</button>
        </div>
        <span class="muted small">{mode === 'heat' ? `FSI spreading out from each road, blended where roads meet (${cellM || 400} m squares)` : 'Each road by the FSI its plots get'}</span>
      </div>
      <div class="fsi-map-box" ref={wrap} style={`aspect-ratio:${V.w} / ${V.h}`}>
        <img src={svg} width={svgW} height={svgH} alt={alt} fetchpriority="high" hidden={ready} />
        <canvas ref={cv} hidden={!ready} aria-label={`${alt}. Drag to move, scroll or pinch to zoom.`} role="img" />
        {busy && <Loading block label="Loading the map…" />}
        {ready && (
          <div class="fsi-zoom" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.8)}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.8)}>−</button>
            <button type="button" aria-label="Show the whole city" onClick={reset}>⤢</button>
          </div>
        )}
      </div>
    </div>
  );
}
