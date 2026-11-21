// The design system builder, and Pro's simple Design step. The full builder lives in the dashboard (Design systems):
// every section below, on a saved design system, checked on the sample scheme. Pro's step keeps the start, the preview,
// the facade's materials and the balconies, and the review, and opens the builder for the rest.
// Step 2, the design system: the builder's look, set once and kept. Start from a preset or one of your own, see it
// on a facade, then pick the materials of each surface (walls, accents, the base, floors room by room, the roof, the
// railings), the windows and balconies, and the specification. Everything here is a property of the design system
// (./design.ts), not of a building: the Scheme step decides what gets built with it.
// Pro's UI is black and white; the material swatches and the facade preview are the one place colour shows, because
// there the colour is the data.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import './designStep.css';
import {
  climateOf, clone, compositionOf, specRateNet, landscapeOf, lightingOf, signageOf, siteKitOf, finishOf, finishRate, FINISHED, FLOOR_ROOMS, languageOf, paletteOf, presetOf, PRESETS, ROOF_KINDS, setFinish, SKIN_PATTERNS, SPEC, STYLE_IDS, ZONED_FROM,
  type BalconyKind, type Climate, type Landscape, type Lighting, type Signage, type SiteKit, type Composition, type Corner, type Crown, type DesignSystem, type DoorType, type Entrance, type FinishSlot, type Language, type Rhythm, type Tone, type WindowType,
} from './design';
import type { RoofKind, SkinPattern } from './form/types';
import { byCategory, materialOf, SLOT_CATEGORIES, type Material } from './materials';
import * as library from './designLibrary';
import type { SavedDesign } from './designLibrary';
import type { StepProps } from './steps';
import { PALETTE_SLOTS, PALETTE_TOLERANCE, sharesOf, type PaletteSlot } from './palette';
import { lockedBy, precinctOf, PRECINCTS, type LockGroup } from './heritage';
import { review } from './review';
import type { Evaluated } from './evaluate';
import { Btn, Color, Icon, Note, nf, Num, Row, Section, Seg, Select, Slider, Toggle } from './ui';

// ---------------------------------------------------------------- colour helpers (for drawing materials only)
const rgb = (hex: string) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
/** toward white (k > 0) or black (k < 0) */
const shade = (hex: string, k: number) => {
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  return `#${rgb(hex).map((c) => Math.round(c + (t - c) * a).toString(16).padStart(2, '0')).join('')}`;
};
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');
const rateText = (m: Material) => `₹${nf(m.rate)}/m²`;

/** A material as an SVG <pattern> in metres (userSpaceOnUse), so a swatch and the elevation draw it the same way. */
function Pat({ id, m, colour = m.colour }: { id: string; m: Material; colour?: string }) {
  const line = shade(colour, lum(colour) > 0.55 ? -0.22 : 0.25), sw = 0.022;
  let w = 1, h = 1, body: JSX.Element | null = null;
  switch (m.pattern ?? 'plain') {
    case 'brick': w = 0.5; h = 0.16; body = <path d="M0 0H.5M0 .08H.5M0 0V.08M.25 .08V.16" />; break;
    case 'stone': w = 1.2; h = 0.6; body = <path d="M0 0H1.2M0 .3H1.2M0 0V.3M.7 .3V.6" />; break;
    case 'plank': w = 2.4; h = 0.3; body = <path d="M0 0H2.4M0 .15H2.4M.6 0V.15M1.8 .15V.3" />; break;
    case 'tile': {
      const [a, b] = m.category === 'cladding' ? [1.2, 0.6] : m.category === 'glass' ? [1.5, 1.5] : [0.6, 0.6];
      w = a; h = b; body = <path d={`M0 0H${a}M0 0V${b}`} stroke-width={m.category === 'glass' ? 0.06 : sw} />; break;
    }
    case 'stripe': w = 0.15; h = 1; body = <path d="M0 0V1" />; break;
    case 'louvre': w = 0.3; h = 1; body = <rect x=".18" width=".12" height="1" fill={shade(colour, -0.35)} stroke="none" />; break;
    default:
      if (m.finish === 'textured') { w = 0.3; h = 0.3; body = <g fill={line} stroke="none" opacity=".55"><circle cx=".05" cy=".07" r=".014" /><circle cx=".2" cy=".16" r=".012" /><circle cx=".12" cy=".26" r=".013" /></g>; }
  }
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
      <rect width={w} height={h} fill={colour} />
      {body && <g stroke={line} stroke-width={sw} fill="none">{body}</g>}
    </pattern>
  );
}

/** A material swatch: a 1.2 m square of it. */
function Chip({ m, colour, size = 28 }: { m: Material; colour?: string; size?: number }) {
  const id = `mp-${safeId(useId())}`;
  return (
    <svg class="dss-chip" width={size} height={size} viewBox="0 0 1.2 1.2" aria-hidden="true">
      <defs><Pat id={id} m={m} colour={colour} /></defs>
      <rect width="1.2" height="1.2" fill={`url(#${id})`} />
      {m.finish === 'gloss' && <path d="M0 0H.55L0 .55Z" fill="#fff" opacity=".22" />}
    </svg>
  );
}

// ---------------------------------------------------------------- keyboard: arrows move in a grid of radios
/** Arrow keys across a wrapped grid of [role=radio] (left/right along it, up/down to the nearest in the next row),
 *  Home and End. Moves focus and returns the new index, or -1 when the key isn't one of those. */
function gridKey(e: KeyboardEvent): number {
  const box = e.currentTarget as HTMLElement;
  const btns = [...box.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = btns.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !btns.length) return -1;
  let n: number;
  if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = btns.length - 1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const cur = btns[i], down = e.key === 'ArrowDown';
    const others = btns.filter((b) => (down ? b.offsetTop > cur.offsetTop + 2 : b.offsetTop < cur.offsetTop - 2));
    if (!others.length) n = i;
    else {
      const top = down ? Math.min(...others.map((b) => b.offsetTop)) : Math.max(...others.map((b) => b.offsetTop));
      const row = others.filter((b) => Math.abs(b.offsetTop - top) <= 2);
      const best = row.reduce((a, b) => (Math.abs(b.offsetLeft - cur.offsetLeft) < Math.abs(a.offsetLeft - cur.offsetLeft) ? b : a));
      n = btns.indexOf(best);
    }
  } else return -1;
  e.preventDefault(); e.stopPropagation();
  btns[n].focus();
  return n;
}

// ---------------------------------------------------------------- a material picker
/** A swatch grid (a radiogroup): name and rate show on hover or focus, the chosen one has an ink ring and a check. */
function MaterialGrid({ label, value, options, set }: { label: string; value: string; options: Material[]; set: (id: string) => void }) {
  const at = Math.max(0, options.findIndex((m) => m.id === value));
  return (
    <div class="dss-grid" role="radiogroup" aria-label={label} onKeyDown={(e) => { const n = gridKey(e); if (n >= 0) set(options[n].id); }}>
      {options.map((m, i) => {
        const on = m.id === value, tip = `${m.name} · ${rateText(m)}`;
        return (
          <button type="button" role="radio" aria-checked={on} tabIndex={i === at ? 0 : -1} class="dss-sw" aria-label={tip} data-tip={tip} onClick={() => set(m.id)}>
            <Chip m={m} size={30} />
            {on && <span class="dss-ck" aria-hidden="true"><Icon n="check" size={11} stroke={3} /></span>}
          </button>
        );
      })}
    </div>
  );
}

/** One surface: a row with its material (swatch, name, rate) that opens its swatch grid. */
function MaterialRow({ label, value, slot, open, toggle, set }: { label: string; value: string; slot: keyof typeof SLOT_CATEGORIES; open: boolean; toggle: () => void; set: (id: string) => void }) {
  const m = materialOf(value), id = `dss-${safeId(useId())}`;
  return (
    <div class={`dss-mat${open ? ' open' : ''}`}>
      <button type="button" class="dss-row" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <Chip m={m} size={26} />
        <span class="dss-row-t"><small>{label}</small><b>{m.name}</b></span>
        <span class="dss-rate">{rateText(m)}</span>
        <Icon n="chevron" size={14} />
      </button>
      {open && <div id={id}><MaterialGrid label={label} value={value} options={byCategory(SLOT_CATEGORIES[slot])} set={set} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- the facade preview
/** A few floors of a generic facade, drawn in metres: three bays (the main window, the balcony, the smaller window
 *  with the ventilator) over the stilt, with the parapet and the roof's edge. Colours from the design system's facade
 *  (what the 3D shows), surfaces from its materials. */
export function Elevation({ ds }: { ds: DesignSystem }) {
  const uid = safeId(useId());
  const f = finishOf(ds);
  const mWall = materialOf(f.wall), mAcc = materialOf(f.accent), mBase = materialOf(f.base), mRoof = materialOf(f.roof), mRail = materialOf(f.railing);
  const fh = ds.floorH, N = 3, parapet = 1.0;
  const { W1, W2, V1 } = ds.windows, SD = ds.doors.SD, bal = ds.balcony;
  const glass = ds.glazing.glass, frame = ds.glazing.frame;
  const bayA = Math.max(W1.w + 1.6, 3.2);
  const bayB = bal.kind === 'none' ? Math.max(W2.w + 1.6, 3) : Math.max(Math.min(SD.w, 3.6) + 1.2, 3.2);
  const bayC = Math.max(W2.w + V1.w + 1.9, 3.4);
  const Wd = bayA + bayB + bayC, H = fh + N * fh + parapet;
  const top = (k: number) => parapet + (N - k) * fh; // the top of typical floor k (1 … N)
  const bot = (k: number) => top(k) + fh;            // its floor level
  const P = { wall: `${uid}w`, acc: `${uid}a`, base: `${uid}b`, roof: `${uid}r`, jaali: `${uid}j` };
  const fill = (k: keyof typeof P) => `url(#${P[k]})`;
  // (the composition: the lowest typical floor, 1, stands for the base, the highest, N, for the top)
  const C = compositionOf(ds), tone = (t: Tone) => fill(t === 'accent' ? 'acc' : t), sky = C.top.crown === 'pergola' ? 2.6 : 0.5;

  const CL = climateOf(ds);
  const win = (x: number, yFloor: number, w: number, h0: number, sill: number, kind: WindowType['kind'] | DoorType['kind'], tag = '') => {
    const screened = tag === 'V1' ? CL.jaali !== 'none' : tag === 'W2' && CL.jaali === 'windows', shade_ = CL.chhajja > 0.05 && tag !== 'SD';
    const h = Math.max(0.3, Math.min(h0, fh - sill - 0.15)), y = yFloor - sill - h, rv = C.reveal > 0.01 && kind !== 'glass-sliding';
    const mull = kind === 'sliding' || kind === 'glass-sliding' ? [x + w / 2] : kind === 'casement' ? [x + w / 3, x + (2 * w) / 3] : kind === 'fixed' && w > 1.6 ? [x + w / 2] : [];
    return (
      <g>
        {rv && <rect x={x - 0.16} y={y - 0.16} width={w + 0.32} height={h + 0.32} fill={shade(ds.facade.wall, -0.16)} />}
        <rect x={x} y={y} width={w} height={h} fill={glass} stroke={frame} stroke-width=".07" />
        {kind === 'louvre'
          ? Array.from({ length: Math.max(2, Math.floor(h / 0.1)) }, (_, i) => <path d={`M${x} ${y + (i + 0.5) * (h / Math.max(2, Math.floor(h / 0.1)))}h${w}`} stroke={frame} stroke-width=".035" />)
          : <path d={`M${x + 0.08} ${y + h - 0.08}L${x + Math.min(w, h) * 0.55} ${y + 0.08}h${Math.min(w, h) * 0.2}L${x + 0.08 + Math.min(w, h) * 0.2} ${y + h - 0.08}Z`} fill="#fff" opacity=".13" />}
        {mull.map((mx) => <path d={`M${mx} ${y}v${h}`} stroke={frame} stroke-width=".06" />)}
        {kind === 'casement' && <path d={`M${x} ${y + 0.45}h${w}`} stroke={frame} stroke-width=".05" />}
        {screened && <rect x={x - 0.1} y={y - 0.1} width={w + 0.2} height={h + 0.2} fill={`url(#${P.jaali})`} />}
        {shade_ && <><rect x={x - 0.3} y={y - (rv ? 0.3 : 0.2)} width={w + 0.6} height=".12" fill={shade(ds.facade.wall, -0.25)} /><rect x={x - 0.3} y={y - (rv ? 0.18 : 0.08)} width={w + 0.6} height={Math.min(0.5, CL.chhajja * 0.4)} fill="#000" opacity=".12" /></>}
      </g>
    );
  };
  const railing = (x: number, w: number, yFloor: number) => {
    const rh = 1.1, y = yFloor - rh, steel = '#8d9399';
    if (bal.railing === 'glass') return <g><rect x={x} y={y} width={w} height={rh} fill={mRail.railKind === 'glass' ? mRail.colour : '#b9d0d6'} opacity=".55" /><rect x={x} y={y - 0.03} width={w} height=".06" fill={steel} /></g>;
    if (bal.railing === 'solid') return <g><rect x={x} y={y} width={w} height={rh} fill={mRail.id === 'rail-parapet' ? fill('wall') : mRail.colour} /><rect x={x - 0.03} y={y - 0.06} width={w + 0.06} height=".08" fill={shade(ds.facade.wall, -0.2)} /></g>;
    const c = mRail.railKind === 'ms' ? mRail.colour : '#262628', n = Math.max(2, Math.floor(w / 0.12));
    return <g><rect x={x} y={y} width={w} height=".05" fill={c} /><rect x={x} y={yFloor - 0.12} width={w} height=".04" fill={c} />{Array.from({ length: n + 1 }, (_, i) => <rect x={x + (i * (w - 0.025)) / n} y={y} width=".025" height={rh - 0.08} fill={c} />)}</g>;
  };

  const floors = Array.from({ length: N }, (_, i) => i + 1);
  const xB = bayA, xC = bayA + bayB;
  return (
    <svg class="dss-elev" viewBox={`-0.6 ${-sky} ${Wd + 1.2} ${H + sky + 0.25}`} role="img"
      aria-label={`Facade preview: ${mWall.name} walls, ${mAcc.name} accents, ${mBase.name} at the base, ${bal.kind === 'none' ? 'no balconies' : `${bal.kind} balconies`}`}>
      <defs>
        <Pat id={P.wall} m={mWall} colour={ds.facade.wall} />
        <Pat id={P.acc} m={mAcc} colour={ds.facade.accent} />
        <Pat id={P.base} m={mBase} colour={ds.facade.base} />
        <Pat id={P.roof} m={mRoof} />
        <pattern id={P.jaali} patternUnits="userSpaceOnUse" width=".16" height=".16"><rect width=".16" height=".16" fill={ds.facade.accent} /><circle cx=".08" cy=".08" r=".05" fill="#000" opacity=".55" /></pattern>
      </defs>
      {/* the roof's edge, the walls, the stilt */}
      <rect x=".3" y="-0.28" width={Wd - 0.6} height=".3" fill={fill('roof')} />
      <rect x="0" y="0" width={Wd} height={H - fh} fill={fill('wall')} />
      <rect x="-0.05" y="0" width={Wd + 0.1} height=".12" fill={shade(ds.facade.wall, -0.18)} />
      {C.base.floors > 0 && <rect x="0" y={top(1)} width={Wd} height={fh} fill={tone(C.base.tone)} />}
      {C.top.floors > 0 && <rect x="0" y="0" width={Wd} height={bot(N)} fill={tone(C.top.tone)} />}
      {C.base.floors > 0 && <rect x="-0.2" y={top(1) - 0.22} width={Wd + 0.4} height=".45" fill={fill('acc')} />}
      {C.top.floors > 0 && <rect x="-0.15" y={bot(N) - 0.15} width={Wd + 0.3} height=".3" fill={fill('acc')} />}
      {C.top.crown === 'cornice' && <rect x="-0.5" y="-0.3" width={Wd + 1} height=".5" fill={fill('acc')} />}
      {C.top.crown === 'pergola' && <g fill={fill('acc')}>{[0.6, Wd / 2, Wd - 0.6].map((x) => <rect x={x - 0.15} y="-2.3" width=".3" height="2.3" />)}<rect x="0.3" y="-2.45" width={Wd - 0.6} height=".3" /></g>}
      {C.piers && C.rhythm !== 'free' && [xB, xC].map((x) => <rect x={x - 0.14} y={C.top.floors > 0 ? bot(N) : 0} width=".28" height={(C.base.floors > 0 ? top(1) : H - fh) - (C.top.floors > 0 ? bot(N) : 0)} fill={fill('acc')} />)}
      {C.corner === 'accent' && [0, Wd - 0.5].map((x) => <rect x={x} y="0" width=".5" height={H - fh} fill={fill('acc')} />)}
      <rect x="0" y={H - fh} width={Wd} height={fh} fill={fill('base')} />
      {[[0.45, xB - 0.225], [xB + 0.225, xC - 0.225], [xC + 0.225, Wd - 0.45]].map(([a, b]) => <rect x={a} y={H - fh + 0.45} width={b - a} height={fh - 0.45} fill="#1b1b1d" opacity=".82" />)}
      {/* recessed balconies sit in a shadowed bay */}
      {bal.kind === 'recessed' && floors.map((k) => <rect x={xB + 0.3} y={top(k) + 0.1} width={bayB - 0.6} height={fh - 0.1} fill={shade(ds.facade.wall, -0.3)} />)}
      {/* floor bands */}
      {ds.facade.bands && floors.map((k) => <rect x="0" y={bot(k) - 0.1} width={Wd} height=".22" fill={fill('acc')} />)}
      {floors.map((k) => {
        const yf = bot(k);
        const xa = (bayA - W1.w) / 2;
        const dw = Math.min(SD.w, bayB - 1.0), dx = xB + (bayB - dw) / 2;
        const w2x = xC + 0.7, v1x = w2x + W2.w + 0.5;
        return (
          <g>
            {ds.facade.fins && <><rect x={xa - 0.32} y={top(k)} width=".18" height={fh} fill={fill('acc')} /><rect x={xa + W1.w + 0.14} y={top(k)} width=".18" height={fh} fill={fill('acc')} /></>}
            {win(xa, yf, W1.w, W1.h, W1.sill, W1.kind)}
            {bal.kind === 'none'
              ? win(xB + (bayB - W2.w) / 2, yf, W2.w, W2.h, W2.sill, W2.kind)
              : <>
                {win(dx, yf, dw, Math.min(SD.h, fh - 0.3), 0, SD.kind, 'SD')}
                {bal.kind === 'cantilever' && <><rect x={xB + 0.2} y={yf} width={bayB - 0.4} height=".16" fill={shade(ds.facade.wall, -0.12)} /><rect x={xB + 0.2} y={yf + 0.16} width={bayB - 0.4} height=".3" fill="#000" opacity=".12" /></>}
                {railing(bal.kind === 'french' ? dx - 0.1 : xB + 0.25, bal.kind === 'french' ? dw + 0.2 : bayB - 0.5, yf)}
              </>}
            {win(w2x, yf, W2.w, W2.h, W2.sill, W2.kind, 'W2')}
            {win(v1x, yf, V1.w, V1.h, Math.min(V1.sill, fh - V1.h - 0.2), V1.kind, 'V1')}
          </g>
        );
      })}
      <path d={`M-0.6 ${H}H${Wd + 0.6}`} stroke="currentColor" stroke-width=".05" />
    </svg>
  );
}

// ---------------------------------------------------------------- the design language
/** Each skin pattern and roof kind as a small drawing (24 × 24, in the ink): the pickers show these, not words. */
const PATTERN_ICON: Record<SkinPattern, JSX.Element> = {
  grid: <path d="M5 4v16M12 4v16M19 4v16M3 8h18M3 14h18" />,
  fins: <path d="M5 3v18M9 3v18M13 3v18M17 3v18M21 3v18" stroke-width="2.4" />,
  louvres: <path d="M3 5l18 2M3 10l18 2M3 15l18 2M3 20l18 2" />,
  bands: <path d="M3 6h18M3 12h18M3 18h18" stroke-width="3" />,
  diagrid: <path d="M3 21L12 3l9 18M3 3l9 18 9-18M3 12h18" />,
  screen: <g fill="currentColor" stroke="none">{[5, 10, 15, 20].flatMap((y) => [4, 9, 14, 19].map((x) => <circle cx={x + (y % 10 ? 0 : 1.5)} cy={y - 1} r="1.6" />))}</g>,
  curtain: <path d="M4 3v18M8 3v18M12 3v18M16 3v18M20 3v18M3 12h18" stroke-width="1" />,
  balconies: <path d="M4 3v18M20 3v18M2 8h20M2 14h20M2 20h20M2 8v-2M22 8v-2M2 14v-2M22 14v-2" />,
};
const ROOF_ICON: Record<RoofKind, JSX.Element> = {
  flat: <path d="M4 21V9h16v12M3 9h18M4 9V7M20 9V7" />,
  mono: <path d="M4 21v-9l16-5v14" />,
  gable: <path d="M4 21v-9l8-7 8 7v9" />,
  hip: <path d="M3 21v-8l6-6h6l6 6v8" />,
  barrel: <path d="M4 21v-8a8 7 0 0 1 16 0v8" />,
  tilted: <path d="M5 21V5l14 6v10" />,
  dome: <path d="M3 21v-7h18v7M4 14a8 8 0 0 1 16 0" />,
  crown: <path d="M4 21v-9h16v9M5 12V4M9 12V7M12 12V3M15 12V7M19 12V4" />,
};
const PATTERN_NAME: Record<SkinPattern, string> = { grid: 'Grid', fins: 'Fins', louvres: 'Louvres', bands: 'Bands', diagrid: 'Diagrid', screen: 'Screen', curtain: 'Curtain wall', balconies: 'Balcony rings' };
const ROOF_NAME: Record<RoofKind, string> = { flat: 'Flat', mono: 'Mono-pitch', gable: 'Gable', hip: 'Hip', barrel: 'Barrel', tilted: 'Tilted', dome: 'Dome', crown: 'Crown' };

/** A row of drawn choices (a radiogroup): the name shows on hover or focus. */
function IconRow<T extends string>({ label, value, options, icons, names, set }: { label: string; value: T; options: T[]; icons: Record<T, JSX.Element>; names: Record<T, string>; set: (v: T) => void }) {
  const at = Math.max(0, options.indexOf(value));
  return (
    <div class="dsl-icons" role="radiogroup" aria-label={label} onKeyDown={(e) => { const n = gridKey(e); if (n >= 0) set(options[n]); }}>
      {options.map((o, i) => (
        <button type="button" role="radio" aria-checked={o === value} tabIndex={i === at ? 0 : -1} class="dsl-ic" aria-label={names[o]} data-tip={names[o]} onClick={() => set(o)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{icons[o]}</svg>
        </button>
      ))}
    </div>
  );
}

/** The design language a formed building speaks: the pattern laid over every face, its rhythm, the roof it likes and
 *  how round it likes its corners. Every change shows at once on the model. */
function LanguageSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const lang = languageOf(ds), sk = lang.skin;
  const setL = (fn: (l: Language) => void) => setDs((d) => { const l: Language = JSON.parse(JSON.stringify(languageOf(d))); fn(l); d.language = l; });
  const m = (v: number) => `${nf(v, 2)} m`, pc = (v: number) => `${Math.round(v * 100)}%`;
  // (what each pattern's spacing and depth mean: a balcony's depth is how far it stands out, a louvre's spacing is
  // the gap between blades)
  const deep = sk.pattern === 'balconies' ? 3 : 1.5;
  return (
    <Section title="Language" sub="How formed buildings look, all over.">
      <IconRow<SkinPattern> label="Skin" value={sk.pattern} options={SKIN_PATTERNS} icons={PATTERN_ICON} names={PATTERN_NAME} set={(v) => setL((l) => { l.skin.pattern = v; })} />
      <div class="dsl-sliders">
        <Slider label="Spacing" value={sk.spacing} min={0.3} max={6} step={0.05} fmt={m} set={(v) => setL((l) => { l.skin.spacing = v; })} />
        <Slider label="Depth" value={sk.depth} min={0} max={deep} step={0.05} fmt={m} set={(v) => setL((l) => { l.skin.depth = v; })} />
        {(sk.pattern === 'fins' || sk.pattern === 'louvres') && <Slider label="Angle" value={sk.angle} min={-60} max={60} step={1} fmt={(v) => `${v}°`} set={(v) => setL((l) => { l.skin.angle = v; })} />}
        {(sk.pattern === 'fins' || sk.pattern === 'balconies') && <Slider label="Grade" value={sk.grade} min={0} max={1} step={0.05} fmt={pc} set={(v) => setL((l) => { l.skin.grade = v; })} />}
        <Slider label="Glass" value={sk.glass} min={0} max={1} step={0.05} fmt={pc} set={(v) => setL((l) => { l.skin.glass = v; })} />
      </div>
      <Toggle label="Slab edges" value={sk.slabEdge} set={(v) => setL((l) => { l.skin.slabEdge = v; })} />
      <IconRow<RoofKind> label="Roof" value={lang.roof} options={ROOF_KINDS} icons={ROOF_ICON} names={ROOF_NAME} set={(v) => setL((l) => { l.roof = v; })} />
      <Slider label="Round corners" value={lang.round} min={0} max={1} step={0.05} fmt={pc} set={(v) => setL((l) => { l.round = v; })} />
    </Section>
  );
}

// ---------------------------------------------------------------- composition
const TONES: { value: Tone; label: string }[] = [{ value: 'wall', label: 'Walls' }, { value: 'accent', label: 'Accent' }, { value: 'base', label: 'Base' }];

/** How the facade is composed: the base, middle and top, the bays the windows snap to, the reveals, the corners, the
 *  entrance and the crown. Shows on the slab buildings in the 3D view, the preview above and the elevation. */
function CompositionSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const c = compositionOf(ds);
  const setC = (fn: (c: Composition) => void) => setDs((d) => { const x: Composition = JSON.parse(JSON.stringify(compositionOf(d))); fn(x); d.composition = x; });
  const m = (v: number) => `${nf(v, 2)} m`;
  return (
    <Section title="Composition" sub={`A base, a middle and a top (from ${ZONED_FROM} storeys up), the windows set out on bays.`}>
      <Locked ds={ds} g="composition">
      <Row>
        <Num label="Base floors" value={c.base.floors} step={1} min={0} max={4} set={(v) => setC((x) => { x.base.floors = Math.round(v); })} />
        <Num label="Top floors" value={c.top.floors} step={1} min={0} max={4} set={(v) => setC((x) => { x.top.floors = Math.round(v); })} />
      </Row>
      {c.base.floors > 0 && <Seg<Tone> label="Base in" value={c.base.tone} set={(v) => setC((x) => { x.base.tone = v; })} options={TONES} />}
      {c.top.floors > 0 && <Seg<Tone> label="Top in" value={c.top.tone} set={(v) => setC((x) => { x.top.tone = v; })} options={TONES} />}
      <Seg<Crown> label="Crown" value={c.top.crown} set={(v) => setC((x) => { x.top.crown = v; })} options={[{ value: 'parapet', label: 'Parapet' }, { value: 'cornice', label: 'Cornice' }, { value: 'pergola', label: 'Pergola' }]} />
      <Seg<Rhythm> label="Windows" value={c.rhythm} set={(v) => setC((x) => { x.rhythm = v; })} options={[{ value: 'free', label: 'Flat by flat', title: 'Spread along each flat’s walls' }, { value: 'even', label: 'Even bays', title: 'One to a bay, lined up across the facade' }, { value: 'paired', label: 'Paired', title: 'On the bays, drawn together in twos' }]} />
      {c.rhythm !== 'free' && <>
        <Slider label="Bay width" value={c.bay} min={2.4} max={6} step={0.1} fmt={m} set={(v) => setC((x) => { x.bay = v; })} />
        <Toggle label="Piers on the bay lines" value={c.piers} set={(v) => setC((x) => { x.piers = v; })} />
      </>}
      <Slider label="Window reveal" value={c.reveal} min={0} max={0.5} step={0.05} fmt={(v) => (v ? m(v) : 'None')} set={(v) => setC((x) => { x.reveal = v; })} />
      <Seg<Corner> label="Corners" value={c.corner} set={(v) => setC((x) => { x.corner = v; })} options={[{ value: 'plain', label: 'Plain' }, { value: 'solid', label: 'Solid', title: 'No windows in the end bays' }, { value: 'glazed', label: 'Glazed', title: 'Glass round the corner (on bays)' }, { value: 'accent', label: 'Accent', title: 'A pier in the accent' }]} />
      <Seg<Entrance> label="Entrance" value={c.entrance} set={(v) => setC((x) => { x.entrance = v; })} options={[{ value: 'none', label: 'Plain' }, { value: 'canopy', label: 'Canopy' }, { value: 'portal', label: 'Portal' }]} />
      {(c.corner === 'glazed' || c.corner === 'solid') && c.rhythm === 'free' && <Note>Solid and glazed corners keep the end bays clear, so they need the windows on bays.</Note>}
      </Locked>
    </Section>
  );
}

// ---------------------------------------------------------------- locks, heritage, street, landscape, review
/** A part of the design system a heritage precinct controls: greyed out and said so. */
function Locked({ ds, g, children }: { ds: DesignSystem; g: LockGroup; children: ComponentChildren }) {
  const p = lockedBy(ds, g);
  return (
    <fieldset class="dss-lock" disabled={!!p}>
      {p && <p class="dss-locked"><Icon n="lock" size={12} />Set by the {p.name.toLowerCase()}</p>}
      {children}
    </fieldset>
  );
}

/** A heritage precinct's controls: pick one and the tokens it fixes are set and locked. */
function HeritageSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const pr = precinctOf(ds.precinct);
  return (
    <Section title="Heritage controls" fold open={!!pr} aside={pr ? <span class="sec-meta">{pr.name}</span> : undefined}>
      <Select<string> label="Precinct" value={ds.precinct ?? ''} onChange={(v) => setDs((d) => { if (!v) { delete d.precinct; return; } const x = precinctOf(v)!; x.apply(d); d.precinct = v; })}
        options={[{ value: '', label: 'None' }, ...PRECINCTS.map((x) => ({ value: x.id, label: `${x.name} · ${x.where}` }))]} />
      {pr ? <Note>{pr.blurb} Locked: {pr.locks.join(', ')}. The precinct’s rules are in the review.</Note>
        : <Note>For a site in a heritage precinct: its controls set and lock the parts of the design system they cover, as frame control does in Chandigarh.</Note>}
    </Section>
  );
}

const KELVINS = [2700, 3000, 4000, 5000];
/** The street: the building's sign and its facade lighting. */
function StreetSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const sg = signageOf(ds), li = lightingOf(ds);
  const setS = (fn: (x: Signage) => void) => setDs((d) => { const x = { ...signageOf(d) }; fn(x); d.signage = x; });
  const setL = (fn: (x: Lighting) => void) => setDs((d) => { const x = { ...lightingOf(d) }; fn(x); d.lighting = x; });
  return (
    <Section title="Signs and lighting" fold open={false} sub="Move the sun past sunset to see the lights on.">
      <Locked ds={ds} g="signage">
        <Seg<Signage['kind']> label="Sign" value={sg.kind} set={(v) => setS((x) => { x.kind = v; })} options={[{ value: 'none', label: 'None' }, { value: 'letters', label: 'Letters' }, { value: 'panel', label: 'Panel' }, { value: 'blade', label: 'Blade' }]} />
        {sg.kind !== 'none' && <Slider label="Letter height" value={sg.h} min={0.3} max={1.5} step={0.05} fmt={(v) => `${nf(v, 2)} m`} set={(v) => setS((x) => { x.h = v; })} />}
        <Slider label="Signs at most" value={sg.cap} min={0.05} max={0.3} step={0.01} fmt={(v) => `${Math.round(v * 100)}% of the front`} set={(v) => setS((x) => { x.cap = v; })} />
      </Locked>
      <Locked ds={ds} g="lighting">
        <Seg<Lighting['facade']> label="Facade lighting" value={li.facade} set={(v) => setL((x) => { x.facade = v; })} options={[{ value: 'none', label: 'None' }, { value: 'wash', label: 'Wash' }, { value: 'grazing', label: 'Grazing' }, { value: 'lines', label: 'Lines' }]} />
        <Seg<string> label="Colour" value={String(li.kelvin)} set={(v) => setL((x) => { x.kelvin = Number(v); })} options={KELVINS.map((k) => ({ value: String(k), label: `${k} K` }))} />
        <Toggle label="Dark sky: shielded, nothing aimed up" value={li.shielded} set={(v) => setL((x) => { x.shielded = v; })} />
      </Locked>
    </Section>
  );
}

/** The planting round the buildings. */
function LandscapeSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const l = landscapeOf(ds);
  const setX = (fn: (x: Landscape) => void) => setDs((d) => { const x = { ...landscapeOf(d) }; fn(x); d.landscape = x; });
  return (
    <Section title="Landscape" fold open={false}>
      <Seg<Landscape['trees']> label="Trees" value={l.trees} set={(v) => setX((x) => { x.trees = v; })} options={[{ value: 'few', label: 'The garden’s', title: 'Only what the garden has' }, { value: 'avenue', label: 'Avenue', title: 'A row along the road' }, { value: 'dense', label: 'Every edge', title: 'Rows along every edge of the plot' }]} />
      <Row>
        <Toggle label="Hedge on the boundary" value={l.hedge} set={(v) => setX((x) => { x.hedge = v; })} />
        <Toggle label="Balcony planters" value={l.planters} set={(v) => setX((x) => { x.planters = v; })} />
      </Row>
    </Section>
  );
}

/** The design review: the design system checked against the scheme, line by line. */
function ReviewSection({ e }: { e: StepProps['e'] }) {
  const rv = review(e);
  const groups = [...new Set(rv.lines.map((l) => l.group))];
  return (
    <Section title="Review" fold open={false} aside={<span class="sec-meta">{rv.pass} of {rv.total} pass</span>} sub="The design checked against the scheme as built: rules of thumb from design codes, for discussion.">
      {groups.map((g) => (
        <div class="dsr-g">
          <small>{g}</small>
          <ul>
            {rv.lines.filter((l) => l.group === g).map((l) => (
              <li class={l.ok ? '' : 'no'}>
                <Icon n={l.ok ? 'check' : 'x'} size={13} stroke={2.5} />
                <span><b>{l.label}</b><em>{l.ok ? 'Pass' : 'Fails'} · {l.detail}</em></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

// ---------------------------------------------------------------- site kit
/** The site kit: the compound wall, the gates (the rules for getting in and out) and the internal roads. */
function SiteKitSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const k = siteKitOf(ds);
  const setK = (fn: (x: SiteKit) => void) => setDs((d) => { const x: SiteKit = JSON.parse(JSON.stringify(siteKitOf(d))); fn(x); d.site = x; });
  const m = (v: number) => `${nf(v, 2)} m`, opt = (v: number) => (v > 0.04 ? m(v) : 'None');
  const [openM, setOpenM] = useState(false);
  return (
    <Section title="Walls, gates and roads" fold open={false} sub="The plot’s edge, the ways in and out, and the internal roads: the site engine lays them out at these sizes.">
      <small class="dsk-h">Compound wall</small>
      <Seg<SiteKit['wall']['kind']> label="Wall" value={k.wall.kind} set={(v) => setK((x) => { x.wall.kind = v; })} options={[{ value: 'solid', label: 'Solid' }, { value: 'railing', label: 'Railing' }, { value: 'hedge', label: 'Hedge' }, { value: 'none', label: 'None' }]} />
      {k.wall.kind !== 'none' && <Slider label="Height" value={k.wall.h} min={0.9} max={3} step={0.05} fmt={m} set={(v) => setK((x) => { x.wall.h = v; x.wall.plinth = Math.min(x.wall.plinth, v); })} />}
      {k.wall.kind === 'railing' && <Slider label="Solid plinth" value={k.wall.plinth} min={0.2} max={k.wall.h} step={0.05} fmt={m} set={(v) => setK((x) => { x.wall.plinth = v; })} />}
      {(k.wall.kind === 'solid' || k.wall.kind === 'railing') && <>
        <div class="dss-mats"><MaterialRow label="Faced with" value={k.wall.material} slot="wall" open={openM} toggle={() => setOpenM(!openM)} set={(id) => setK((x) => { x.wall.material = id; })} /></div>
        <Row>
          <Toggle label="Coping" value={k.wall.coping} set={(v) => setK((x) => { x.wall.coping = v; })} />
          <Slider label="Piers every" value={k.wall.piers} min={0} max={6} step={0.5} fmt={opt} set={(v) => setK((x) => { x.wall.piers = v; })} />
        </Row>
      </>}
      <small class="dsk-h">Gates: in and out</small>
      <Slider label="Vehicle gate, clear" value={k.gate.vehicle} min={3} max={12} step={0.25} fmt={m} set={(v) => setK((x) => { x.gate.vehicle = v; })} />
      <Slider label="Pedestrian gate" value={k.gate.pedestrian} min={0} max={2.4} step={0.1} fmt={opt} set={(v) => setK((x) => { x.gate.pedestrian = v; })} />
      <Slider label="Set back from the boundary" value={k.gate.setback} min={0} max={12} step={0.5} fmt={opt} set={(v) => setK((x) => { x.gate.setback = v; })} />
      <Seg<SiteKit['gate']['style']> label="Gate" value={k.gate.style} set={(v) => setK((x) => { x.gate.style = v; })} options={[{ value: 'sliding', label: 'Sliding' }, { value: 'swing', label: 'Swing' }, { value: 'boom', label: 'Boom barrier' }]} />
      <Row>
        <Toggle label="Separate in and out" value={k.gate.separate} set={(v) => setK((x) => { x.gate.separate = v; })} />
        <Toggle label="Security cabin" value={k.gate.cabin} set={(v) => setK((x) => { x.gate.cabin = v; })} />
      </Row>
      <small class="dsk-h">Internal roads</small>
      <Slider label="Road width" value={k.road.w} min={3.5} max={12} step={0.25} fmt={m} set={(v) => setK((x) => { x.road.w = v; })} />
      <Seg<SiteKit['road']['surface']> label="Surface" value={k.road.surface} set={(v) => setK((x) => { x.road.surface = v; })} options={[{ value: 'asphalt', label: 'Asphalt' }, { value: 'pavers', label: 'Pavers' }, { value: 'concrete', label: 'Concrete' }, { value: 'grass-pavers', label: 'Grass pavers' }]} />
      <Slider label="Footpath each side" value={k.road.footpath} min={0} max={3} step={0.25} fmt={opt} set={(v) => setK((x) => { x.road.footpath = v; })} />
      <Slider label="Light pole every" value={k.road.poles} min={0} max={50} step={1} fmt={(v) => (v > 1 ? `${v} m` : 'None')} set={(v) => setK((x) => { x.road.poles = v; })} />
      <Row>
        <Toggle label="Kerbs" value={k.road.kerb} set={(v) => setK((x) => { x.road.kerb = v; })} />
        <Toggle label="Trees along" value={k.road.trees} set={(v) => setK((x) => { x.road.trees = v; })} />
      </Row>
      <Note>The review checks the ways in and out: a gate wide enough for the fire tender, separate in and out from 100 bays, a 1.2 m pedestrian gate, room to wait off the road, gates clear of junctions, a road-side wall no higher than 1.5 m solid.</Note>
    </Section>
  );
}

// ---------------------------------------------------------------- climate
/** The climate's elements: a chhajja over each window, turned to the sun or not, and jaali screens. */
function ClimateSection({ ds, setDs }: { ds: DesignSystem; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const c = climateOf(ds);
  const setC = (fn: (c: Climate) => void) => setDs((d) => { const x: Climate = { ...climateOf(d) }; fn(x); d.climate = x; });
  return (
    <Section title="Climate" sub="Sunshades and screens, as Indian buildings have long been shaded.">
      <Locked ds={ds} g="climate">
      <Slider label="Chhajja over the windows" value={c.chhajja} min={0} max={1.5} step={0.05} fmt={(v) => (v > 0.04 ? `${nf(v, 2)} m` : 'None')} set={(v) => setC((x) => { x.chhajja = v; })} />
      {c.chhajja > 0.04 && <Toggle label="Deeper to the south and west" value={c.orient} set={(v) => setC((x) => { x.orient = v; })} hint="Full depth facing south, a little more facing west, about a third facing north." />}
      <Seg<Climate['jaali']> label="Jaali" value={c.jaali} set={(v) => setC((x) => { x.jaali = v; })} options={[{ value: 'none', label: 'None' }, { value: 'vents', label: 'Ventilators' }, { value: 'windows', label: 'Small windows too' }]} />
      </Locked>
    </Section>
  );
}

// ---------------------------------------------------------------- palette
/** The facade's palette as shares: what the model measures for each tone and the glass, against the design system's
 *  targets. The bar is drawn in the materials' colours (the colour is the data), every state also in words. */
function PaletteSection({ ds, e, setDs }: { ds: DesignSystem; e: StepProps['e']; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const t = paletteOf(ds), T = e.facade, now = sharesOf(T), measured = T.total > 0;
  const setT = (k: PaletteSlot, v: number) => setDs((d) => { d.palette = { ...paletteOf(d), [k]: v }; });
  const colour: Record<PaletteSlot, string> = { wall: ds.facade.wall, accent: ds.facade.accent, base: ds.facade.base, glass: ds.glazing.glass };
  const sum = t.wall + t.accent + t.base + t.glass, pc = (v: number) => `${Math.round(v * 100)}%`;
  const state = (k: PaletteSlot) => {
    const dlt = now[k] - t[k];
    return Math.abs(dlt) <= PALETTE_TOLERANCE ? 'On target' : `${dlt > 0 ? 'Over' : 'Under'} by ${Math.round(Math.abs(dlt) * 100)}`;
  };
  const off = measured ? PALETTE_SLOTS.filter((s) => Math.abs(now[s.key] - t[s.key]) > PALETTE_TOLERANCE).length : 0;
  const bar = (sh: Record<PaletteSlot, number>, label: string) => (
    <div class="dsp-bar" role="img" aria-label={`${label}: ${PALETTE_SLOTS.map((s) => `${s.label} ${pc(sh[s.key])}`).join(', ')}`}>
      {PALETTE_SLOTS.map((s) => sh[s.key] > 0.001 && <i style={`flex:${sh[s.key]};background:${colour[s.key]}`} title={`${s.label} ${pc(sh[s.key])}`} />)}
    </div>
  );
  return (
    <Section title="Palette" sub="How much of the facade each tone and the glass is, measured from the model." aside={measured ? <span class="sec-meta">{off ? `${off} off target` : 'On target'}</span> : undefined}>
      {measured ? <>
        <div class="dsp-bars"><small>Measured</small>{bar(now, 'Measured')}<small>Target</small>{bar(t, 'Target')}</div>
        <table class="dsp-t">
          <thead><tr><th>Slot</th><th>Now</th><th>Target</th><th /></tr></thead>
          <tbody>
            {PALETTE_SLOTS.map((s) => (
              <tr>
                <td><span class="dsp-sw" style={`background:${colour[s.key]}`} aria-hidden="true" />{s.label}</td>
                <td>{pc(now[s.key])}<small> · {nf(Math.round(T.area[s.key]))} m²</small></td>
                <td><input type="number" min={0} max={100} step={1} value={Math.round(t[s.key] * 100)} aria-label={`${s.label} target, %`}
                  onChange={(ev) => { const v = parseFloat((ev.target as HTMLInputElement).value); if (Number.isFinite(v) && v >= 0 && v <= 100) setT(s.key, v / 100); }} />%</td>
                <td class={Math.abs(now[s.key] - t[s.key]) > PALETTE_TOLERANCE ? 'dsp-off' : ''}>{state(s.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Math.abs(sum - 1) > 0.005 && <Note>The targets add to {pc(sum)}, not 100%.</Note>}
        {T.skipped > 0 && <Note>{T.skipped === 1 ? 'One formed building isn’t' : `${T.skipped} formed buildings aren’t`} measured yet; the shares are of the rest.</Note>}
        <Note>The walls, accent and base are priced by these areas now, not a rule of thumb.</Note>
      </> : <Note>Nothing to measure yet: the shares show once there’s a slab building in the scheme.</Note>}
    </Section>
  );
}

// ---------------------------------------------------------------- start from: presets and saved ones
/** Stable comparison of two design systems (key order doesn't matter). */
const stable = (v: unknown): string => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v as object).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`) : JSON.stringify(v));
const same = (a: DesignSystem, b: DesignSystem) => stable(a) === stable(b);

function Strip({ d }: { d: DesignSystem }) {
  const f = finishOf(d);
  return (
    <span class="dss-strip" aria-hidden="true">
      <Chip m={materialOf(f.wall)} colour={d.facade.wall} size={18} />
      <Chip m={materialOf(f.accent)} colour={d.facade.accent} size={18} />
      <Chip m={materialOf(f.base)} colour={d.facade.base} size={18} />
      <i style={`background:${d.glazing.glass}`} />
    </span>
  );
}

/** What tells one design system from another at a glance: what it sells for and adds to build, how much glass,
 *  the floor height, the balconies and the shading. */
function factsOf(d: DesignSystem): { k: string; v: string; title: string }[] {
  const pm = Math.round(d.premium * 100), build = specRateNet(d) + finishRate(d), b = d.balcony, cl = climateOf(d), glass = paletteOf(d).glass;
  const shade = cl.chhajja > 0.05 ? `${nf(cl.chhajja, 2)} m` : d.facade.fins ? 'Fins' : b.kind === 'recessed' ? 'Recessed' : '—';
  return [
    { k: 'Price', v: pm ? `${pm > 0 ? '+' : '−'}${Math.abs(pm)}%` : 'Base', title: 'What the flats sell for over the city’s starting price' },
    { k: 'Build', v: `${build >= 0 ? '+' : '−'}₹${nf(Math.abs(build))}`, title: 'What the specification and finishes add to construction, ₹ per sq ft of built-up' },
    { k: 'Glass', v: `${Math.round(glass * 100)}%`, title: 'The share of the facade it aims to glaze' },
    { k: 'Floors', v: `${nf(d.floorH, 2)} m`, title: 'Floor to floor' },
    { k: 'Balcony', v: b.kind === 'none' ? 'None' : b.kind === 'french' ? 'French' : `${nf(b.depth, 1)} m`, title: b.kind === 'none' ? 'No balconies' : `${b.kind[0].toUpperCase()}${b.kind.slice(1)} balconies` },
    { k: 'Shade', v: shade, title: cl.chhajja > 0.05 ? `A chhajja over each window${cl.orient ? ', deeper to the south and west' : ''}` : 'Shading over the windows' },
  ];
}

function StartFrom({ p, up, toast }: Pick<StepProps, 'p' | 'up' | 'toast'>) {
  const [mine, setMine] = useState<SavedDesign[]>([]);
  const [mode, setMode] = useState<null | 'save' | 'rename' | 'delete'>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => { void library.list().then((l) => { if (live) setMine(l); }); };
    load();
    const off = library.subscribe(load);
    return () => { live = false; off(); };
  }, []);

  const custom = p.custom;
  const src = custom?.origin ? mine.find((s) => s.id === custom.origin) ?? null : null;
  const activeSaved = custom && src && same(custom, src.ds) ? src : null;
  const changed = !!custom && !activeSaved;
  const preset = presetOf(custom?.id ?? p.style);
  const ds = custom ?? presetOf(p.style);

  const keep = precinctOf(custom?.precinct);
  const preset_ = (x: DesignSystem) => ({ key: x.id, d: x, on: !custom && p.style === x.id, pick: () => {
    // (a heritage precinct stays: its controls are laid on the new start)
    if (!keep) { up({ style: x.id, custom: null }); return; }
    const d = clone(x); keep.apply(d); d.precinct = keep.id; up({ style: x.id, custom: d });
  } });
  const cards: { key: string; d: DesignSystem; on: boolean; mine?: boolean; pick: () => void }[] = [
    ...PRESETS.filter((x) => !STYLE_IDS.includes(x.id)).map(preset_),
    ...PRESETS.filter((x) => STYLE_IDS.includes(x.id)).map(preset_),
    ...mine.map((s) => ({ key: s.id, d: s.ds, mine: true, on: activeSaved?.id === s.id, pick: () => up({ style: presetOf(s.ds.id).id, custom: clone(s.ds) }) })),
  ];
  const tab = Math.max(0, cards.findIndex((c) => c.on));
  const close = () => { setMode(null); setName(''); };
  const run = async (f: () => Promise<unknown>, done: string) => { try { await f(); toast(done); close(); } catch (e) { toast((e as Error).message); } };

  const submit = (ev: Event) => {
    ev.preventDefault();
    const n = name.trim(); if (!n) return;
    if (mode === 'save') void run(async () => { const s = await library.save(n, ds); up({ custom: clone(s.ds) }); }, `Saved as “${n}”. It’s under Start from in every project.`);
    else if (mode === 'rename' && src) void run(async () => { const s = await library.rename(src.id, n); if (s && custom && activeSaved) up({ custom: clone(s.ds) }); }, `Renamed to “${n}”.`);
  };

  return (
    <Section title="Start from" aside={changed ? <span class="sec-meta">Changed</span> : undefined}>
      <div class="dss-cards" role="radiogroup" aria-label="Start from" onKeyDown={(e) => { const n = gridKey(e); if (n >= 0) cards[n].pick(); }}>
        {cards.map((c, i) => (
          <>
          {i > 0 && STYLE_IDS.includes(c.key) !== STYLE_IDS.includes(cards[i - 1].key) && STYLE_IDS.includes(c.key) && <p class="dss-group">Indian styles</p>}
          {c.mine && !cards[i - 1]?.mine && <p class="dss-group">Yours</p>}
          <button type="button" role="radio" aria-checked={c.on} tabIndex={i === tab ? 0 : -1} class="dss-card" title={c.mine ? undefined : c.d.basedOn ? `${c.d.blurb} Built on ${presetOf(c.d.basedOn).name}.` : c.d.blurb} onClick={c.pick}>
            <span class="dss-card-h"><Strip d={c.d} /><b>{c.d.name}</b>{c.mine && <small>Mine</small>}</span>
            <span class="dss-facts">{factsOf(c.d).map((x) => <span title={x.title}><i>{x.k}</i>{x.v}</span>)}</span>
            {c.on && <span class="dss-ck" aria-hidden="true"><Icon n="check" size={11} stroke={3} /></span>}
          </button>
          </>
        ))}
      </div>

      {mode === 'save' || mode === 'rename'
        ? <form class="dss-name" onSubmit={submit}>
          <label class="f"><span class="f-l">{mode === 'save' ? 'Name it' : 'New name'}</span>
            <input class="txt" value={name} maxLength={60} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
          </label>
          <Btn kind="primary" submit disabled={!name.trim()}>{mode === 'save' ? 'Save' : 'Rename'}</Btn>
          <Btn kind="quiet" onClick={close}>Cancel</Btn>
        </form>
        : mode === 'delete' && src
          ? <div class="dss-acts" role="group" aria-label="Confirm delete">
            <span>Delete “{src.name}” for good?</span>
            <Btn kind="primary" onClick={() => void run(() => library.remove(src.id), `Deleted “${src.name}”.`)}>Delete</Btn>
            <Btn kind="quiet" onClick={close}>Keep it</Btn>
          </div>
          : <div class="dss-acts">
            {changed && <span class="dss-changed">Changed from {src?.name ?? preset.name}</span>}
            <button type="button" class="linkbtn" onClick={() => { setName(activeSaved ? `${activeSaved.name} 2` : changed && src ? src.name : `My ${ds.name}`); setMode('save'); }}><Icon n="plus" size={14} />Save as mine</button>
            {changed && src && <button type="button" class="linkbtn" onClick={() => void run(() => library.save(src.name, custom!, src.id).then((s) => up({ custom: clone(s.ds) })), `Updated “${src.name}”.`)}>Update “{src.name}”</button>}
            {changed && <button type="button" class="linkbtn" onClick={() => (src ? up({ style: presetOf(src.ds.id).id, custom: clone(src.ds) }) : up({ style: preset.id, custom: null }))}><Icon n="undo" size={14} />Back to {src?.name ?? preset.name}</button>}
            {src && !changed && <>
              <button type="button" class="linkbtn" onClick={() => { setName(src.name); setMode('rename'); }}><Icon n="edit" size={14} />Rename</button>
              <button type="button" class="linkbtn" onClick={() => setMode('delete')}><Icon n="x" size={14} />Delete</button>
            </>}
          </div>}
    </Section>
  );
}

// ---------------------------------------------------------------- the step
/** The full design system builder: every section, on `e.ds`, checked against `e`'s scheme. */
export function DesignSystemBuilder({ e, setDs }: { e: Evaluated; setDs: (fn: (d: DesignSystem) => void) => void }) {
  const ds = e.ds;
  const f = finishOf(ds);
  const pick = (slot: FinishSlot) => (id: string) => setDs((d) => setFinish(d, slot, id));
  // one surface's swatches open at a time
  const [open, setOpen] = useState<string | null>(null);
  const row = (key: string, label: string, value: string, slot: keyof typeof SLOT_CATEGORIES, fs: FinishSlot) => (
    <MaterialRow label={label} value={value} slot={slot} open={open === key} toggle={() => setOpen(open === key ? null : key)} set={pick(fs)} />
  );
  const fr = finishRate(ds, e.finishQty);
  return (
    <>
      <HeritageSection ds={ds} setDs={setDs} />

      <ReviewSection e={e} />

      <Section title="Facade">
        <Locked ds={ds} g="materials">
        <div class="dss-mats">
          {row('wall', 'Walls', f.wall, 'wall', 'wall')}
          {row('accent', 'Accents (bands, fins)', f.accent, 'accent', 'accent')}
          {row('base', 'Base (the stilt)', f.base, 'base', 'base')}
        </div>
        <Row>
          <Toggle label="Floor bands" value={ds.facade.bands} set={(v) => setDs((d) => { d.facade.bands = v; })} />
          <Toggle label="Fins" value={ds.facade.fins} set={(v) => setDs((d) => { d.facade.fins = v; })} />
        </Row>
        </Locked>
        <Locked ds={ds} g="windows">
        <Num label="Floor to floor" value={ds.floorH} step={0.05} min={2.8} max={4.5} unit="m" set={(v) => setDs((d) => { d.floorH = v; })} />
        </Locked>
      </Section>

      <CompositionSection ds={ds} setDs={setDs} />

      <PaletteSection ds={ds} e={e} setDs={setDs} />

      <ClimateSection ds={ds} setDs={setDs} />

      <LanguageSection ds={ds} setDs={setDs} />

      <Section title="Windows and balconies" fold open={false}>
        <Seg<BalconyKind> label="Balconies" value={ds.balcony.kind} set={(v) => setDs((d) => { d.balcony.kind = v; })} options={[{ value: 'cantilever', label: 'Cantilever' }, { value: 'recessed', label: 'Recessed' }, { value: 'french', label: 'French' }, { value: 'none', label: 'None' }]} />
        {ds.balcony.kind !== 'none' && <>
          <Num label="Depth" value={ds.balcony.depth} step={0.1} min={0.3} max={4} unit="m" set={(v) => setDs((d) => { d.balcony.depth = v; })} />
          <div class="dss-mats">{row('railing', 'Railing', f.railing, 'railing', 'railing')}</div>
        </>}
        <Row><Color label="Glass" value={ds.glazing.glass} set={(c) => setDs((d) => { d.glazing.glass = c; })} /><Color label="Frames" value={ds.glazing.frame} set={(c) => setDs((d) => { d.glazing.frame = c; })} /></Row>
        <Locked ds={ds} g="windows">
        <div class="tscroll">
          <table class="cat">
            <caption class="dss-cap">The catalog every opening comes from: change a size and every one follows.</caption>
            <thead><tr><th>Tag</th><th>W</th><th>H</th><th>Sill</th><th>Type</th></tr></thead>
            <tbody>
              {(['W1', 'W2', 'V1'] as const).map((t) => <CatRow t={t} x={ds.windows[t]} sill set={(fn) => setDs((d) => fn(d.windows[t]))} kinds={['sliding', 'casement', 'fixed', 'louvre']} />)}
              {(['D1', 'D2', 'D3', 'SD'] as const).map((t) => <CatRow t={t} x={ds.doors[t]} set={(fn) => setDs((d) => fn(d.doors[t]))} kinds={['flush', 'panel', 'veneer', 'glass-sliding', 'fire-rated']} />)}
            </tbody>
          </table>
        </div>
        </Locked>
      </Section>

      <StreetSection ds={ds} setDs={setDs} />

      <LandscapeSection ds={ds} setDs={setDs} />

      <SiteKitSection ds={ds} setDs={setDs} />

      <Section title="Flooring" fold open={false}>
        <div class="dss-mats">{FLOOR_ROOMS.map((r) => row(`floor-${r.key}`, r.label, f.flooring[r.key], 'floor', r.key))}</div>
      </Section>

      <Section title="Roof" fold open={false}>
        <div class="dss-mats">{row('roof', 'Terrace', f.roof, 'roof', 'roof')}</div>
      </Section>

      <Section title="Specification" fold open={false} sub="What the flats are sold with. Each choice adds to construction, ₹ per sq ft of built-up area (rough figures: put in your own)." aside={<span class="sec-meta">+₹{nf(e.rate)}/ft²</span>}>
        {SPEC.filter((c) => !FINISHED.includes(c.key)).map((c) => (
          <Select<number> label={c.label} value={ds.spec[c.key] ?? 0} onChange={(v) => setDs((d) => { d.spec[c.key] = v; })} options={c.options.map((o, i) => ({ value: i, label: `${o.label}${o.rate ? ` (+₹${o.rate})` : ''}` }))} />
        ))}
        <Note>The materials chosen above come to about {fr >= 0 ? '+' : '−'}₹{nf(Math.abs(fr))} per sq ft of built-up over plain ones (paint, 600 mm vitrified tiles, MS railings).</Note>
      </Section>
    </>
  );
}

/** Pro's Design step: the start, the preview, the facade's materials and the balconies, the review; the rest in the
 *  builder (the dashboard's Design systems), which opens on this design system (saved under yours first). */
export function DesignSystemStep({ p, e, up, toast }: StepProps) {
  const ds = e.ds, f = finishOf(ds);
  const setDs = (fn: (d: DesignSystem) => void) => { const d = clone(ds); fn(d); up({ custom: d }); };
  const [open, setOpen] = useState<string | null>(null);
  const row = (key: string, label: string, value: string, slot: keyof typeof SLOT_CATEGORIES, fs: FinishSlot) => (
    <MaterialRow label={label} value={value} slot={slot} open={open === key} toggle={() => setOpen(open === key ? null : key)} set={(id) => setDs((d) => setFinish(d, fs, id))} />
  );
  const builder = async () => {
    let id = p.custom?.origin;
    if (!id) { const s = await library.save(`My ${ds.name}`, ds); up({ custom: clone(s.ds) }); id = s.id; toast(`Saved as “${s.name}” under your design systems.`); }
    window.open(`${import.meta.env.BASE_URL}dashboard/#designs/${encodeURIComponent(id)}`, '_blank', 'noopener');
  };
  return (
    <>
      <StartFrom p={p} up={up} toast={toast} />

      <figure class="dss-prev">
        <Elevation ds={ds} />
        <figcaption>{ds.name}{ds.blurb && !p.custom ? <span> · {ds.blurb}</span> : null}</figcaption>
      </figure>

      <div class="dss-builder">
        <p>Composition, palette, climate, heritage, signs and lighting, landscape, and the site’s walls, gates and roads are set in the design system builder.</p>
        <Btn onClick={() => void builder()}><Icon n="palette" size={15} />Open in the builder</Btn>
        {!p.custom?.origin && <small>It’s saved under your design systems first.</small>}
      </div>

      <Section title="Facade">
        <Locked ds={ds} g="materials">
          <div class="dss-mats">
            {row('wall', 'Walls', f.wall, 'wall', 'wall')}
            {row('accent', 'Accents (bands, fins)', f.accent, 'accent', 'accent')}
            {row('base', 'Base (the stilt)', f.base, 'base', 'base')}
          </div>
        </Locked>
        <Seg<BalconyKind> label="Balconies" value={ds.balcony.kind} set={(v) => setDs((d) => { d.balcony.kind = v; })} options={[{ value: 'cantilever', label: 'Cantilever' }, { value: 'recessed', label: 'Recessed' }, { value: 'french', label: 'French' }, { value: 'none', label: 'None' }]} />
      </Section>

      <ReviewSection e={e} />
    </>
  );
}

/** A row of the window and door catalog (as in the old Design step). */
function CatRow<T extends WindowType | DoorType>({ t, x, set, kinds, sill }: { t: string; x: T; set: (f: (x: T) => void) => void; kinds: string[]; sill?: boolean }) {
  const n = (k: 'w' | 'h' | 'sill', v: string) => { const f = parseFloat(v); if (Number.isFinite(f) && f >= 0 && f < 10) set((y) => { (y as unknown as Record<string, number>)[k] = f; }); };
  return (
    <tr>
      <td><b>{t}</b></td>
      <td><input type="number" step="0.05" value={x.w} onChange={(ev) => n('w', (ev.target as HTMLInputElement).value)} aria-label={`${t} width`} /></td>
      <td><input type="number" step="0.05" value={x.h} onChange={(ev) => n('h', (ev.target as HTMLInputElement).value)} aria-label={`${t} height`} /></td>
      <td>{sill ? <input type="number" step="0.05" value={(x as WindowType).sill} onChange={(ev) => n('sill', (ev.target as HTMLInputElement).value)} aria-label={`${t} sill`} /> : null}</td>
      <td><Select<string> size="sm" aria-label={`${t} kind`} value={x.kind} onChange={(v) => set((y) => { (y as { kind: string }).kind = v; })} options={kinds.map((k) => ({ value: k, label: k.replace('-', ' ') }))} /></td>
    </tr>
  );
}
