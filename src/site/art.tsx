// "Today vs. planned" — one street drawn as it exists and as the Development Plan reserves it, at 4 px per metre.
// An illustration of the idea (the editor's DP sheets, DP regions and "buildings in the DP road reserve" check),
// not a real plot.
import { useEffect, useRef, useState } from 'preact/hooks';

const S = 4;                       // px per metre
const MID = 180;                   // road centre line (y)
const TODAY = 9, DP = 24;          // road widths, m
const PLOT = { x: 360, y: 205, w: 30, d: 25 }; // m (x, y in px)

// buildings along the street: [x, y, w, h] in px; the ones the DP reserve reaches are drawn in the verge colour
const NORTH: [number, number, number, number][] = [[18, 70, 70, 82], [100, 70, 54, 56], [166, 60, 80, 96], [258, 70, 46, 56], [316, 74, 86, 72], [414, 72, 60, 54], [486, 66, 72, 88], [570, 64, 62, 60]];
const SOUTH: [number, number, number, number][] = [[18, 212, 76, 86], [106, 234, 58, 60], [176, 208, 70, 96], [258, 238, 84, 70], [500, 230, 60, 74], [572, 210, 60, 92]];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// cars along the street: [lane (−2 … 2, negative north of the centre), start x, speed px/s, colour]; the outer
// lanes only exist once the road is widened
const CARS: [number, number, number, string][] = [
  [-1, 40, 70, '#f5f5f4'], [-1, 330, 70, '#60a5fa'], [1, 120, 82, '#fbbf24'], [1, 470, 82, '#f5f5f4'],
  [-2, 200, 96, '#f87171'], [-2, 560, 96, '#f5f5f4'], [2, 20, 104, '#a3e635'], [2, 300, 104, '#f5f5f4'],
];

/** The street as it is and as the DP widens it: plays by itself while it's on screen (a click takes over). */
export function TodayPlanned() {
  const [planned, setPlanned] = useState(false);
  const [auto, setAuto] = useState(!reduced());
  const [t, setT] = useState(0);      // 0 today … 1 as planned
  const [clock, setClock] = useState(0);
  const ref = useRef<SVGSVGElement>(null);
  const state = useRef({ t: 0, from: 0, at: 0, visible: false, toggled: 0 });
  const plannedRef = useRef(planned);
  const autoRef = useRef(auto);
  const flip = (to: boolean, now = performance.now()) => { const s = state.current; s.from = s.t; s.at = now; plannedRef.current = to; setPlanned(to); };
  const choose = (to: boolean) => { setAuto(false); autoRef.current = false; flip(to); };
  const play = (on: boolean) => { setAuto(on); autoRef.current = on; state.current.toggled = performance.now(); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      const s = state.current;
      // the first look starts the clock afresh, so it doesn't flip the moment it's seen
      if (e.isIntersecting && !s.visible) s.toggled = performance.now() - 1200;
      s.visible = e.isIntersecting;
    }, { threshold: 0.35 });
    io.observe(el);
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = state.current;
      if (!s.visible) return;
      if (!reduced()) setClock(now / 1000);
      // the road eases to where it's asked over 1.1 s
      const k = Math.min(1, (now - s.at) / 1100), goal = plannedRef.current ? 1 : 0;
      const v = reduced() ? goal : lerp(s.from, goal, ease(k));
      if (v !== s.t) { s.t = v; setT(v); }
      if (autoRef.current && now - s.toggled > 3800) { s.toggled = now; flip(!plannedRef.current, now); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); io.disconnect(); };
  }, []);

  const w = lerp(TODAY, DP, t) * S, carW = w - 20 * t;
  const top = MID - w / 2, bot = MID + w / 2;
  const fTop = MID - (DP * S) / 2, fBot = MID + (DP * S) / 2;
  const willHit = (b: [number, number, number, number]) => b[1] < fBot && b[1] + b[3] > fTop;
  const lostFull = Math.max(0, fBot - PLOT.y) / S;
  const area = PLOT.w * PLOT.d, net = Math.round(PLOT.w * (PLOT.d - lostFull * t));
  const hitsAll = [...NORTH, ...SOUTH].filter(willHit).length;
  const hits = [...NORTH, ...SOUTH].filter((b) => willHit(b) && b[1] < bot && b[1] + b[3] > top).length;
  // lanes: one each way today, two each way (either side of a median) as planned
  const laneY = (lane: number) => {
    const side = Math.sign(lane);
    const f = Math.abs(lane) === 2 ? 0.375 : lerp(0.25, 0.125, t);
    return MID + side * (f * carW + 3 * t * (Math.abs(lane) === 2 ? 0 : 1));
  };
  const towerY = Math.max(PLOT.y + 16, lerp(PLOT.y + 16, fBot + 14, t));
  const width = Math.round(lerp(TODAY, DP, t));
  return (
    <figure class="tp-figure">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="seg" role="group" aria-label="Show the street">
          <button aria-pressed={!planned} onClick={() => choose(false)}>Today</button>
          <button aria-pressed={planned} onClick={() => choose(true)}>As planned (DP)</button>
        </div>
        <span class="muted small tp-note">
          <button class="tp-play" onClick={() => play(!auto)} aria-label={auto ? 'Pause the animation' : 'Play the animation'}>{auto ? '❚❚ Pause' : '▶ Play'}</button>
          Illustration · 1 square = 10 m
        </span>
      </div>
      <svg ref={ref} class="art-svg" viewBox="0 0 640 360" role="img" aria-label={`Today: a ${TODAY} m road with two lanes and a ${area} square metre plot. As planned: a ${DP} m DP road; ${hitsAll} buildings stand inside the reserve and the plot loses ${Math.round(lostFull * PLOT.w)} square metres.`}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--up-line)" stroke-width="1" /></pattern>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="color-mix(in srgb, var(--up-verge) 12%, transparent)" /><path d="M0 0V8" stroke="var(--up-verge)" stroke-width="2" opacity="0.55" /></pattern>
          <clipPath id="tp-road"><rect x="0" y={MID - carW / 2} width="640" height={carW} /></clipPath>
        </defs>
        <rect width="640" height="360" fill="var(--up-surface-2)" />
        <rect width="640" height="360" fill="url(#grid)" />
        {/* the DP road line, faint ahead of time; the reserve band filling as the road widens */}
        <rect x="0" y={fTop} width="640" height={fBot - fTop} fill="none" stroke="var(--up-verge)" stroke-width="1.5" stroke-dasharray="6 6" opacity={0.5 * (1 - t)} />
        <rect x="0" y={top} width="640" height={w} fill="url(#hatch)" opacity={t} />
        {/* carriageway */}
        <rect x="0" y={MID - carW / 2} width="640" height={carW} fill="var(--up-asphalt)" />
        <rect x="0" y={MID - 3} width="640" height="6" fill="var(--up-reserve)" opacity={0.85 * t} />
        <line x1="0" x2="640" y1={top} y2={top} stroke="var(--up-verge)" stroke-width="3" opacity={t} />
        <line x1="0" x2="640" y1={bot} y2={bot} stroke="var(--up-verge)" stroke-width="3" opacity={t} />
        {/* lane lines: the centre line today; a line between each pair of lanes as planned */}
        <line x1="0" x2="640" y1={MID} y2={MID} stroke="#fff" stroke-width="2" stroke-dasharray="16 14" opacity={0.85 * (1 - t)} />
        {[-1, 1].map((sd) => <line key={sd} x1="0" x2="640" y1={MID + sd * (0.25 * carW + 1.5)} y2={MID + sd * (0.25 * carW + 1.5)} stroke="#fff" stroke-width="2" stroke-dasharray="10 12" opacity={0.85 * t} />)}
        {/* the traffic: south of the centre eastbound, north westbound */}
        <g clip-path="url(#tp-road)">
          {CARS.map(([lane, x0, v, c], i) => {
            const dir = lane > 0 ? 1 : -1, span = 700, x = ((((x0 + dir * v * clock) % span) + span) % span) - 30;
            const op = Math.abs(lane) === 2 ? Math.max(0, t * 1.5 - 0.5) : 1;
            return op > 0 ? (
              <g key={i} opacity={op} transform={`translate(${x.toFixed(1)} ${laneY(lane).toFixed(1)})`}>
                <rect x="-11" y="-4.5" width="22" height="9" rx="2.5" fill={c} stroke="rgba(0,0,0,.35)" stroke-width="0.8" />
                <rect x={dir > 0 ? 3 : -8} y="-3.5" width="5" height="7" rx="1" fill="rgba(0,0,0,.35)" />
              </g>
            ) : null;
          })}
        </g>
        {/* buildings: the ones in the reserve turn as the road line reaches them */}
        {[...NORTH, ...SOUTH].map((b, i) => {
          const h = willHit(b) && b[1] < bot && b[1] + b[3] > top ? Math.min(1, t * 1.6) : 0;
          return <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="2" fill={`color-mix(in srgb, var(--up-verge) ${Math.round(30 * h)}%, var(--up-surface))`} stroke={h > 0.5 ? 'var(--up-verge)' : 'var(--up-line-strong)'} stroke-width={1 + h} />;
        })}
        {/* the plot, and the tower on it */}
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.w * S} height={PLOT.d * S} fill="color-mix(in srgb, var(--up-blue) 10%, transparent)" stroke="var(--up-blue)" stroke-width="2" stroke-dasharray="7 5" />
        {lostFull > 0 && t > 0.01 && <rect x={PLOT.x} y={PLOT.y} width={PLOT.w * S} height={lostFull * S * t} fill="url(#hatch)" stroke="var(--up-verge)" stroke-width="1.5" />}
        <rect x={PLOT.x + 22} y={towerY} width={PLOT.w * S - 44} height={PLOT.y + PLOT.d * S - 16 - towerY} rx="2" fill="var(--up-blue)" opacity="0.85" />
        <text x={PLOT.x + 6} y={PLOT.y + PLOT.d * S - 8} font-size="11" fill="var(--up-blue)">your plot</text>
        {/* width dimension */}
        <g stroke="var(--up-ink)" stroke-width="1.2">
          <line x1="612" x2="612" y1={top} y2={bot} />
          <line x1="604" x2="620" y1={top} y2={top} /><line x1="604" x2="620" y1={bot} y2={bot} />
        </g>
        <rect x="560" y={MID - 11} width="44" height="22" rx="4" fill="var(--up-surface)" stroke="var(--up-line-strong)" />
        <text x="582" y={MID + 4} font-size="12" text-anchor="middle" fill="var(--up-ink)">{width} m</text>
      </svg>
      <dl class="tp-stats">
        <div><dt>Road width</dt><dd>{width} m</dd></div>
        <div><dt>Buildings in the road line</dt><dd style={{ color: hits ? 'var(--up-verge)' : undefined }}>{hits}</dd></div>
        <div><dt>Plot area</dt><dd>{net.toLocaleString('en-IN')} m²{area - net > 0 ? <span class="muted small"> (−{area - net})</span> : null}</dd></div>
      </dl>
    </figure>
  );
}

// ---------- small product illustrations for the landing page tiles ----------

/** A street cut across: footpath, lanes, median, lanes, footpath — each part its own width. */
export function SectionArt() {
  const parts: [number, 'walk' | 'lane' | 'median', number][] = [[2, 'walk', 0], [3.5, 'lane', -1], [3.5, 'lane', -1], [1.2, 'median', 0], [3.5, 'lane', 1], [3.5, 'lane', 1], [2, 'walk', 0]];
  const total = parts.reduce((s, p) => s + p[0], 0), k = 340 / total;
  const fill = { walk: 'var(--up-today)', lane: 'var(--up-asphalt)', median: 'var(--up-reserve)' };
  let x = 30;
  return (
    <svg viewBox="0 0 400 260" aria-hidden="true">
      {parts.map(([w, kind, dir], i) => {
        const x0 = x, cx = x0 + (w * k) / 2; x += w * k;
        const kerb = kind !== 'lane';
        return (
          <g key={i}>
            <rect x={x0 + 1} y={kerb ? 128 : 136} width={w * k - 2} height={kerb ? 34 : 26} rx="3" fill={fill[kind]} opacity={kerb ? 0.75 : 0.92} />
            {dir !== 0 && <path d={`M${cx} 104v16M${cx - 5} ${dir < 0 ? 109 : 115}l5 ${dir < 0 ? -5 : 5}l5 ${dir < 0 ? 5 : -5}`} fill="none" stroke="var(--up-muted)" stroke-width="1.5" stroke-linecap="round" />}
            <text x={cx} y="186" font-size="10.5" text-anchor="middle" fill="var(--up-muted)">{w.toFixed(1)}</text>
          </g>
        );
      })}
      <path d="M30 214h340M30 208v12M370 208v12" stroke="var(--up-line-strong)" />
      <rect x="166" y="203" width="68" height="22" rx="11" fill="var(--up-surface)" stroke="var(--up-line-strong)" />
      <text x="200" y="218" font-size="11" text-anchor="middle" fill="var(--up-ink)">{total.toFixed(1)} m</text>
    </svg>
  );
}

/** Contours of a hill with a road pad cut into it, and the cut/fill readout. */
export function TerrainArt() {
  const rings = [0, 1, 2, 3, 4, 5, 6];
  return (
    <svg viewBox="0 0 400 260" aria-hidden="true">
      {rings.map((i) => <ellipse key={i} cx={230 - i * 4} cy={140 - i * 2} rx={190 - i * 26} ry={110 - i * 15} fill="none" stroke="var(--up-ink)" stroke-opacity={0.1 + i * 0.05} stroke-width="1.2" />)}
      <path d="M-10 196C80 180 150 150 230 140S360 110 420 70" fill="none" stroke="var(--up-asphalt)" stroke-width="18" stroke-linecap="round" opacity="0.92" />
      <path d="M-10 196C80 180 150 150 230 140S360 110 420 70" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="8 8" opacity="0.8" />
      <path d="M150 158C190 148 210 144 250 138" fill="none" stroke="var(--up-verge)" stroke-width="30" stroke-opacity="0.16" stroke-linecap="round" />
      <g transform="translate(24 24)">
        <rect width="132" height="52" rx="12" fill="var(--up-surface)" stroke="var(--up-line)" />
        <text x="14" y="22" font-size="10.5" fill="var(--up-muted)">cut · fill</text>
        <text x="14" y="40" font-size="14" font-weight="600" fill="var(--up-ink)">1,240 · 380 m³</text>
      </g>
    </svg>
  );
}

/** The issues list, as the editor shows it. */
export function ChecksArt() {
  const rows: [string, string, string][] = [['var(--up-danger)', 'Building in DP road line', '3'], ['var(--up-warn)', 'Low headroom · 4.1 m', '1'], ['var(--up-warn)', 'Inside nalla buffer', '2'], ['var(--up-ok)', 'Junctions connected', '✓']];
  return (
    <svg viewBox="0 0 400 260" aria-hidden="true">
      <rect x="50" y="34" width="300" height="196" rx="16" fill="var(--up-surface)" stroke="var(--up-line)" />
      <text x="70" y="64" font-size="12" font-weight="600" fill="var(--up-ink)" style="font-family:var(--up-font-body)">Issues</text>
      {rows.map(([c, t, n], i) => (
        <g key={t} transform={`translate(70 ${84 + i * 36})`}>
          <rect x="-8" y="-4" width="276" height="30" rx="8" fill={i === 0 ? 'var(--up-surface-2)' : 'transparent'} />
          <circle cx="6" cy="11" r="4.5" fill={c} />
          <text x="20" y="15" font-size="12" fill="var(--up-ink)" style="font-family:var(--up-font-body)">{t}</text>
          <text x="252" y="15" font-size="11" text-anchor="end" fill="var(--up-muted)">{n}</text>
        </g>
      ))}
    </svg>
  );
}
