// "Today vs. planned" — one street drawn as it exists and as the Development Plan reserves it, at 4 px per metre.
// An illustration of the idea (the editor's DP sheets, DP regions and "buildings in the DP road reserve" check),
// not a real plot.
import { useState } from 'preact/hooks';

const S = 4;                       // px per metre
const MID = 180;                   // road centre line (y)
const TODAY = 9, DP = 24;          // road widths, m
const PLOT = { x: 360, y: 205, w: 30, d: 25 }; // m (x, y in px)

// buildings along the street: [x, y, w, h] in px; the ones the DP reserve reaches are drawn in the verge colour
const NORTH: [number, number, number, number][] = [[18, 70, 70, 82], [100, 70, 54, 56], [166, 60, 80, 96], [258, 70, 46, 56], [316, 74, 86, 72], [414, 72, 60, 54], [486, 66, 72, 88], [570, 64, 62, 60]];
const SOUTH: [number, number, number, number][] = [[18, 212, 76, 86], [106, 234, 58, 60], [176, 208, 70, 96], [258, 238, 84, 70], [500, 230, 60, 74], [572, 210, 60, 92]];

export function TodayPlanned() {
  const [planned, setPlanned] = useState(false);
  const w = (planned ? DP : TODAY) * S;
  const top = MID - w / 2, bot = MID + w / 2;
  const hit = (b: [number, number, number, number]) => planned && b[1] < bot && b[1] + b[3] > top;
  const lost = planned ? Math.max(0, bot - PLOT.y) / S : 0;
  const area = PLOT.w * PLOT.d, net = Math.round(PLOT.w * (PLOT.d - lost));
  const hits = [...NORTH, ...SOUTH].filter(hit).length;
  const lanes = planned ? [-1.5, -0.5, 0.5, 1.5] : [-0.5, 0.5];
  return (
    <figure class="tp-figure">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div class="seg" role="group" aria-label="Show the street">
          <button aria-pressed={!planned} onClick={() => setPlanned(false)}>Today</button>
          <button aria-pressed={planned} onClick={() => setPlanned(true)}>As planned (DP)</button>
        </div>
        <span class="muted small">Illustration · 1 square = 10 m</span>
      </div>
      <svg class="art-svg" viewBox="0 0 640 360" role="img" aria-label={planned ? `As planned: a ${DP} m DP road; ${hits} buildings stand inside the reserve and the plot loses ${Math.round(area - net)} square metres.` : `Today: a ${TODAY} m road with two lanes; the plot is ${area} square metres.`}>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--up-line)" stroke-width="1" /></pattern>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="color-mix(in srgb, var(--up-verge) 12%, transparent)" /><path d="M0 0V8" stroke="var(--up-verge)" stroke-width="2" opacity="0.55" /></pattern>
        </defs>
        <rect width="640" height="360" fill="var(--up-surface-2)" />
        <rect width="640" height="360" fill="url(#grid)" />
        {/* the DP reserve band */}
        {planned && <rect x="0" y={top} width="640" height={w} fill="url(#hatch)" />}
        {/* carriageway */}
        <rect x="0" y={planned ? top + 10 : top} width="640" height={planned ? w - 20 : w} fill="var(--up-asphalt)" style="transition:all .35s" />
        {planned && <>
          <rect x="0" y={MID - 3} width="640" height="6" fill="var(--up-reserve)" opacity="0.85" />
          <line x1="0" x2="640" y1={top} y2={top} stroke="var(--up-verge)" stroke-width="3" />
          <line x1="0" x2="640" y1={bot} y2={bot} stroke="var(--up-verge)" stroke-width="3" />
        </>}
        {/* lane lines */}
        {lanes.slice(0, -1).map((_, i) => {
          const y = MID + (lanes[i] + 0.5) * ((planned ? w - 20 : w) / lanes.length);
          return Math.abs(y - MID) < 4 && planned ? null : <line key={i} x1="0" x2="640" y1={y} y2={y} stroke="#fff" stroke-width="2" stroke-dasharray={Math.abs(y - MID) < 1 ? '16 14' : '10 12'} opacity="0.85" />;
        })}
        {/* buildings */}
        {[...NORTH, ...SOUTH].map((b, i) => (
          <rect key={i} x={b[0]} y={b[1]} width={b[2]} height={b[3]} rx="2" fill={hit(b) ? 'color-mix(in srgb, var(--up-verge) 30%, var(--up-surface))' : 'var(--up-surface)'} stroke={hit(b) ? 'var(--up-verge)' : 'var(--up-line-strong)'} stroke-width={hit(b) ? 2 : 1} style="transition:all .35s" />
        ))}
        {/* the plot, and the tower on it */}
        <rect x={PLOT.x} y={PLOT.y} width={PLOT.w * S} height={PLOT.d * S} fill="color-mix(in srgb, var(--up-blue) 10%, transparent)" stroke="var(--up-blue)" stroke-width="2" stroke-dasharray="7 5" />
        {planned && lost > 0 && <rect x={PLOT.x} y={PLOT.y} width={PLOT.w * S} height={lost * S} fill="url(#hatch)" stroke="var(--up-verge)" stroke-width="1.5" />}
        <rect x={PLOT.x + 22} y={Math.max(PLOT.y + 16, planned ? bot + 14 : 0)} width={PLOT.w * S - 44} height={PLOT.d * S - 16 - Math.max(16, planned ? bot + 14 - PLOT.y : 16)} rx="2" fill="var(--up-blue)" opacity="0.85" style="transition:all .35s" />
        <text x={PLOT.x + 6} y={PLOT.y + PLOT.d * S - 8} font-size="11" fill="var(--up-blue)">your plot</text>
        {/* width dimension */}
        <g stroke="var(--up-ink)" stroke-width="1.2">
          <line x1="612" x2="612" y1={top} y2={bot} style="transition:all .35s" />
          <line x1="604" x2="620" y1={top} y2={top} /><line x1="604" x2="620" y1={bot} y2={bot} />
        </g>
        <rect x="560" y={MID - 11} width="44" height="22" rx="4" fill="var(--up-surface)" stroke="var(--up-line-strong)" />
        <text x="582" y={MID + 4} font-size="12" text-anchor="middle" fill="var(--up-ink)">{planned ? DP : TODAY} m</text>
      </svg>
      <dl class="tp-stats">
        <div><dt>Road width</dt><dd>{planned ? `${DP} m` : `${TODAY} m`}</dd></div>
        <div><dt>Buildings in the road line</dt><dd style={{ color: planned ? 'var(--up-verge)' : undefined }}>{hits}</dd></div>
        <div><dt>Plot area</dt><dd>{net.toLocaleString('en-IN')} m²{planned ? <span class="muted small"> (−{Math.round(area - net)})</span> : null}</dd></div>
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
