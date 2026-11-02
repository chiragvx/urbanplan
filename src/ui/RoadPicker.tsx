// The road picker: a road is a width plus features. One panel, no tabs: the build palette's Roads (mode 'build'), the
// inspector of a selected road or section, and "Change type" for a selection (mode 'edit', one or many ids; values
// that differ show as Mixed). The map's standard turns width + features into the cross-section (src/assets/roadmodel.ts);
// the old preset names ("18B", "DP road 18 m", "30A") are found by search. Icons over text: names live in hover cards.
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { buildAsset, docVersion, penLift, readOnly, roadHeight, settings } from '../editor/state';
import { allAssets, customAssets, getAsset, sizeLabel, type AssetDef } from '../assets';
import * as rm from '../assets/roadmodel';
import type { Feature, Features, StandardId } from '../assets/roadmodel';
import { thumb } from '../assets/thumb';
import * as ops from '../doc/ops';
import { PART_LABEL, totalWidth } from '../doc/xsection';
import { CLASS_LABEL, ROAD_CLASSES, type Id, type SectionObj } from '../doc/types';
import type { Part } from '../net/model';
import { change as bulkChange } from '../editor/bulk';
import { pinSection } from '../editor/heights';
import { PART_COLOR } from './CrossSection';
import { registerTipArt } from './hovercard';
import { ui } from './ctx';
import './RoadPicker.css';

// ---------------- the map's standard ----------------

/** The street standard of the open map: set with the city, else from its region (Pune → USDG, Mumbai → SDG). */
export function mapStandard(): StandardId {
  const s = ui.doc?.meta.standard;
  return rm.isStandard(s) ? s : rm.standardFor(ui.app?.tile?.city);
}
export function setMapStandard(s: StandardId) { ui.app.setMeta({ standard: s }); }

// ---------------- icons ----------------

const P: Record<string, string> = {
  footpath: 'M13 4.5a1.5 1.5 0 1 0 0-.01M10.5 21l1.5-5.5 2.5 2.5V21M9 12.5l2.5-4 3 1.5 1.5 3M11.5 8.5L10.5 15M3 21h18',
  cycle: 'M6 17.5a3.5 3.5 0 1 0 0-.01M18 17.5a3.5 3.5 0 1 0 0-.01M6 17.5L9.5 10h6L18 17.5M9.5 10l3 7.5H6M14 6.5h2.5l-1 3.5',
  parking: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 17V7h3.5a3 3 0 0 1 0 6H10',
  median: 'M3 3v18M21 3v18M10.5 3v18M13.5 3v18M6.75 5v2M6.75 11v2M6.75 17v2M17.25 5v2M17.25 11v2M17.25 17v2',
  service: 'M2 3v18M22 3v18M6.5 3v18M17.5 3v18M12 4v3M12 10.5v3M12 17v3',
  brt: 'M6 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 11h16M8 21l-1.5-4M16 21l1.5-4M8 14h.01M16 14h.01',
  oneway: 'M12 21V4M6 10l6-6 6 6',
  auto: 'M2 19l6-7 4 4.5 3-3 7 5.5M2 8h2.5M7 8h2.5M12 8h2.5M17 8h2.5',
  bridge: 'M2 9h20M4 9v11M20 9v11M7 20a5 5 0 0 1 10 0M2 20h3M19 20h3',
  tunnel: 'M2 20h20M5 20v-7a7 7 0 0 1 14 0v7M9 20v-6a3 3 0 0 1 6 0v6',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  xs: 'M3 5v14M21 5v14M7 5v14M17 5v14M12 6v2.5M12 11v2.5M12 16v2.5',
};
function Ico(p: { d: string; size?: number }) {
  const s = p.size ?? 20;
  return <svg class="rp-ico" width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><path d={p.d} /></svg>;
}

// ---------------- hover-card art: the road with a feature ----------------

registerTipArt('rpxs', (id) => {
  const a = getAsset(id);
  return a && a.profile.type === 'street' ? <Strip parts={a.profile.parts} small /> : null;
});

/** The cross-section as a strip of coloured parts, left → right. */
function Strip(p: { parts: Part[]; small?: boolean }) {
  const W = totalWidth(p.parts) || 1;
  return (
    <div class={`rp-strip ${p.small ? 'small' : ''}`} role="img" aria-label={`Cross-section ${W} m`}>
      {p.parts.map((q, i) => (
        <div key={i} class={`k-${q.kind}`} style={{ flex: q.width, background: PART_COLOR[q.kind] }} title={p.small ? undefined : `${PART_LABEL[q.kind]}: ${fmt(q.width)} m`}>
          {!p.small && q.width / W > 0.06 && <span>{fmt(q.width)}{(q.kind === 'lane' || q.kind === 'bus') && q.dir !== 0 ? (q.dir === 1 ? ' ↑' : ' ↓') : ''}</span>}
        </div>
      ))}
    </div>
  );
}

const fmt = (w: number) => (Math.round(w * 10) / 10).toString();

// ---------------- what the picker shows / changes ----------------

/** The road being built (the palette): width, features, the variant picked among exact fits. */
const pick = signal<{ width: number; features: Features; variant?: string }>({ width: 12, features: { ...rm.NO_FEATURES, footpath: true } });

interface Target { id: Id; secs: SectionObj[]; parts: Part[]; cls: string; edited: boolean }

const secLen = (id: Id) => ui.C.geo(id)?.len ?? 0;

/** Roads and sections among the ids, each with the cross-section it shows (a road: its longest section's). */
function targetsOf(ids: Id[]): Target[] {
  const d = ui.doc, out: Target[] = [];
  for (const id of ids) {
    const o = d.get(id);
    if (o?.kind === 'road') {
      const secs = d.sectionsOf(id);
      if (!secs.length) continue;
      const lead = secs.reduce((a, b) => (secLen(b.id) > secLen(a.id) ? b : a));
      out.push({ id, secs, parts: lead.parts, cls: lead.cls, edited: d.editState(lead.id, 'parts') !== 'base' });
    } else if (o?.kind === 'section') out.push({ id, secs: [o], parts: o.parts, cls: o.cls, edited: d.editState(id, 'parts') !== 'base' });
  }
  return out;
}

/** width: set every road to it; step: widen / narrow each by it, keeping their differences */
type Change = { width?: number; step?: number; feature?: [Feature, boolean]; variant?: string; asset?: AssetDef };

/** What a change makes of one road: a template from the standard, or (hand-edited custom roads) the same parts adjusted. */
function apply(t: { parts: Part[]; cls: string; edited: boolean }, c: Change, std: StandardId): { parts: Part[]; cls: string; asset?: string } {
  if (c.asset && c.asset.profile.type === 'street') return { parts: c.asset.profile.parts.map((q) => ({ ...q })), cls: c.asset.profile.cls, asset: c.asset.id };
  const r = rm.read(t.parts, std, t.cls);
  const W = c.width ?? (c.step !== undefined ? Math.max(0.5, Math.round((r.width + c.step) * 100) / 100) : r.width);
  const F = { ...r.features, ...(c.feature ? { [c.feature[0]]: c.feature[1] } : {}) };
  if (r.custom && t.edited && c.variant === undefined) {
    // a hand-edited cross-section stays custom: resized / given the feature in place
    let parts = t.parts;
    if (c.feature) parts = rm.setFeature(parts, c.feature[0], c.feature[1], std);
    return { parts: rm.fitWidth(parts, W), cls: t.cls };
  }
  const m = rm.match(W, F, std, c.variant);
  return { parts: m.parts, cls: m.cls, asset: rm.pickId(std, W, F, c.variant) };
}

/** Write an edit-mode change: on 2+ roads through the preview bar (one undo); dragging (merge) and single roads at once. */
function write(label: string, run: () => void, targets: Target[], merge?: string) {
  if (merge || targets.length < 2) { ui.E.edit(label, run, merge); return; }
  bulkChange(ui.E, label, run, [...targets.map((t) => t.id), ...targets.flatMap((t) => t.secs.map((s) => s.id))]);
}

const HEIGHT_LIFT = { auto: 0, ground: 0, bridge: ops.FLYOVER_DECK, tunnel: ops.TUNNEL_DEPTH } as const;

/** Start (or keep) building the picked road. `remember` adds it to the recents (not while dragging the width). */
function buildPick(next: typeof pick.value, remember: boolean) {
  pick.value = next;
  const id = rm.pickId(mapStandard(), next.width, next.features, next.variant);
  ui.E.useAsset(id, remember);
  if (roadHeight.value !== 'auto') penLift.value = HEIGHT_LIFT[roadHeight.value];
}

// ---------------- the panel ----------------

export function RoadPicker(p: { mode: 'build' | 'edit'; ids?: Id[] }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  void settings.value.recentAssets;
  const std = mapStandard();
  const ro = readOnly.value;
  const edit = p.mode === 'edit';
  const targets = edit ? targetsOf(p.ids ?? []) : [];
  const rootRef = useRef<HTMLDivElement>(null);

  // the palette opens on the road being built, if it is one
  useEffect(() => {
    if (edit) return;
    const a = getAsset(buildAsset.value);
    if (a?.drawer === 'network' && a.profile.type === 'street') {
      const dec = rm.decode(a.id);
      pick.value = dec ? { width: dec.width, features: dec.features, variant: dec.variant } : { width: totalWidth(a.profile.parts), features: rm.featuresOf(a.profile.parts), variant: a.id };
    }
  }, []);

  if (edit && !targets.length) return null;

  // ---- current values (mixed across several roads) ----
  const readings = edit ? targets.map((t) => rm.read(t.parts, std, t.cls)) : [];
  const built = edit ? null : rm.match(pick.value.width, pick.value.features, std, pick.value.variant);
  const widths = edit ? readings.map((r) => r.width) : [pick.value.width];
  const wMin = Math.min(...widths), wMax = Math.max(...widths);
  const mixedW = wMax - wMin > 0.05;
  const W = widths[0];
  const featCount = (f: Feature) => (edit ? readings.filter((r) => r.features[f]).length : pick.value.features[f] ? 1 : 0);
  const n = edit ? readings.length : 1;
  const flags = new Map<Feature, string>();
  if (built) for (const f of built.flags) flags.set(f.feature, f.text);
  else readings.forEach((r, i) => { for (const f of rm.flagsOf(targets[i].parts, r.features, std)) flags.set(f.feature, f.text); });
  const tiers = new Set(edit ? readings.map((r) => r.tier) : [built!.tier]);
  const tier = tiers.size === 1 ? [...tiers][0] : null;
  const parts = edit ? targets[0].parts : built!.parts;
  const one = edit ? readings.length === 1 : true;
  const reading = edit ? readings[0] : null;
  const variants = edit ? (one && !reading!.custom ? rm.match(reading!.width, reading!.features, std).variants : []) : built!.variants;
  const curVariant = edit ? reading?.template?.id : built!.template.id;
  const subLabel = edit
    ? one ? (reading!.custom ? 'custom' : reading!.label) : `${n} roads`
    : built!.label;
  const tpl = edit ? (one && !reading!.custom ? reading!.template : undefined) : built!.template;

  // ---- changes ----
  const change = (c: Change, label: string, merge?: string, remember = true) => {
    if (ro) return;
    if (!edit) {
      const cur = pick.value;
      if (c.asset) { ui.E.useAsset(c.asset.id); if (c.asset.profile.type === 'street') pick.value = { width: totalWidth(c.asset.profile.parts), features: rm.featuresOf(c.asset.profile.parts), variant: c.asset.id }; return; }
      const features = c.feature ? { ...cur.features, [c.feature[0]]: c.feature[1] } : cur.features;
      buildPick({ width: c.width ?? cur.width, features, variant: c.variant ?? (c.width !== undefined || c.feature ? undefined : cur.variant) }, remember);
      return;
    }
    const ids = targets.map((t) => t.id);
    // re-read at run time: the preview runs it again on Apply, after any change it stacks onto
    const run = () => {
      const d = ui.doc;
      for (const t of targetsOf(ids)) {
        const out = apply(t, c, std);
        d.set(t.id, 'parts', out.parts);
        d.set(t.id, 'cls', out.cls);
        for (const s of t.secs) d.set(s.id, 'asset', out.asset);
      }
    };
    write(label, run, targets, merge);
  };
  const step = (dw: number) => (edit ? change({ step: dw }, dw > 0 ? 'Widen' : 'Narrow') : setWidth(W + dw));
  const setWidth = (w: number, merge?: string, remember = true) => change({ width: Math.max(0.5, Math.round(w * 100) / 100) }, 'Road width', merge, remember);
  const toggle = (f: Feature) => {
    const c = featCount(f);
    // mixed: the first click turns it on for all, the next off for all
    change({ feature: [f, c < n] }, `${rm.FEATURES.find((x) => x.id === f)!.label} ${c < n ? 'on' : 'off'}`);
  };

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '[' || e.key === ']') { e.preventDefault(); e.stopPropagation(); step(e.key === ']' ? 0.5 : -0.5); return; }
    const f = rm.FEATURES.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (f) { e.preventDefault(); e.stopPropagation(); toggle(f.id); }
  };

  const head = (
    <div class="rp-head">
      <div class="rp-name">
        <b>{mixedW ? `${fmt(wMin)}–${fmt(wMax)} m` : `${fmt(W)} m`} {tier ? rm.tierLabel(tier) : 'Mixed'}</b>
        <span class={`rp-sub ${subLabel === 'custom' ? 'custom' : ''}`} title={tpl ? `${tpl.name}: ${tpl.source}` : subLabel === 'custom' ? 'Custom: not one of the standard\'s templates. Pick a width or feature to snap to one.' : undefined}>
          {subLabel}{tpl?.use && !subLabel.startsWith('based') ? ` · ${tpl.use}` : ''}
        </span>
      </div>
      <StandardChip std={std} disabled={ro} />
    </div>
  );

  return (
    <div class={`rp rp-${p.mode}`} ref={rootRef} onKeyDown={onKey as unknown as JSX.KeyboardEventHandler<HTMLDivElement>}>
      <div class="rp-main">
        {head}
        <Ruler std={std} w={W} lo={wMin} hi={wMax} mixed={mixedW} tier={tier} disabled={ro} onWidth={setWidth} onStep={step} />
        <div class="rp-feats" role="toolbar" aria-label="Features">
          {rm.FEATURES.map((f) => {
            const c = featCount(f.id), on = c === n, mixed = c > 0 && c < n, flag = flags.get(f.id);
            const size = f.id === 'oneway' ? 'All traffic one way' : f.id === 'brt' ? `${rm.FEATURE_W[std].brt} m of bus lanes in the middle` : f.id === 'median' ? `${rm.FEATURE_W[std].median} m` : f.id === 'parking' ? `${rm.FEATURE_W[std].parking} m on one side` : f.id === 'service' ? `${rm.FEATURE_W[std].service} m each side, behind a planter` : `${rm.FEATURE_W[std][f.id]} m each side`;
            const preview = edit ? undefined : rm.encode(std, W, { ...pick.value.features, [f.id]: !on });
            return (
              <button key={f.id} class={`rp-ib ${on ? 'on' : mixed ? 'mixed' : ''} ${flag ? 'flagged' : ''}`} disabled={ro} aria-pressed={on} aria-label={f.label}
                title={`${f.label} (${f.key}): ${flag ?? `${size} in this standard`}${mixed ? ` · on ${c} of ${n}` : ''}`} data-tip-art={preview ? `rpxs:${preview}` : undefined}
                onClick={() => toggle(f.id)}>
                <Ico d={P[f.id]} />
                {mixed && <span class="rp-badge">{c}</span>}
              </button>
            );
          })}
          <span class="rp-sep" />
          <Height edit={edit} targets={targets} disabled={ro} />
        </div>
      </div>
      <div class="rp-side">
        <div class="rp-xs">
          <Strip parts={parts} />
          {!one && <span class="rp-note">Showing the first of {n}; each keeps its own until you change it</span>}
          {variants.length > 1 && (
            <div class="rp-dots" role="radiogroup" aria-label="Templates that fit">
              {variants.map((v) => (
                <button key={v.id} role="radio" aria-checked={v.id === curVariant} class={v.id === curVariant ? 'on' : ''} disabled={ro}
                  title={`${v.code}: ${v.use ?? v.name}`} aria-label={v.code} onClick={() => change({ variant: v.id }, `Make it ${v.code}`)} />
              ))}
            </div>
          )}
        </div>
        <Find std={std} disabled={ro} onPick={(a) => change({ asset: a }, `Make it ${a.name}`)} />
        {edit && <More targets={targets} disabled={ro} />}
      </div>
    </div>
  );
}

// ---------------- the standard chip ----------------

function StandardChip(p: { std: StandardId; disabled?: boolean }) {
  const s = rm.STANDARDS.find((x) => x.id === p.std)!;
  return (
    <label class="rp-std" title={`Street standard: ${s.source}. Set for the whole map, from its city`}>
      <select value={p.std} disabled={p.disabled} aria-label="Street standard" onChange={(e) => setMapStandard((e.currentTarget as HTMLSelectElement).value as StandardId)}>
        {rm.STANDARDS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </label>
  );
}

// ---------------- the width ruler ----------------

function Ruler(p: { std: StandardId; w: number; lo: number; hi: number; mixed: boolean; tier: rm.Tier | null; disabled?: boolean; onWidth: (w: number, merge?: string, remember?: boolean) => void; onStep: (dw: number) => void }) {
  const stops = rm.rulerStops(p.std);
  const N = stops.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<string | null>(null);
  // position (0..1) of a width on the ruler: evenly spaced stops, linear between them, a little room past the ends
  const pos = (w: number) => {
    if (w <= stops[0].w) return Math.max(0, (0.5 - (stops[0].w - w) / stops[0].w * 0.5) / N);
    for (let i = 0; i < N - 1; i++) if (w <= stops[i + 1].w) return (i + 0.5 + (w - stops[i].w) / (stops[i + 1].w - stops[i].w)) / N;
    return Math.min(1, (N - 0.5 + Math.min(1, (w - stops[N - 1].w) / stops[N - 1].w) * 0.5) / N);
  };
  const widthAt = (x: number) => {
    const s = x * N - 0.5;
    if (s <= 0) return stops[0].w * Math.max(0.1, 1 + s * 2 * 0.5);
    if (s >= N - 1) return stops[N - 1].w * (1 + Math.min(1, (s - (N - 1)) * 2));
    const i = Math.floor(s), f = s - i;
    // snap to a stop near it
    if (f < 0.18) return stops[i].w;
    if (f > 0.82) return stops[i + 1].w;
    return Math.round((stops[i].w + (stops[i + 1].w - stops[i].w) * f) * 2) / 2;
  };
  const drag = (e: PointerEvent) => {
    if (p.disabled || e.button !== 0) return;
    const el = trackRef.current!;
    const r = el.getBoundingClientRect();
    const key = `rpw${Date.now()}`;
    let last = -1;
    const at = (cx: number) => { const w = widthAt(Math.min(1, Math.max(0, (cx - r.left) / r.width))); if (w !== last) { last = w; p.onWidth(w, key, false); } };
    el.setPointerCapture(e.pointerId);
    at(e.clientX);
    const move = (m: PointerEvent) => at(m.clientX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); if (last > 0) p.onWidth(last, key, true); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const bands = rm.TIERS.map((t, i) => {
    const next = rm.TIERS[i + 1]?.from ?? Infinity;
    const k = stops.filter((s) => s.w >= t.from - 0.01 && s.w < next - 0.01).length;
    return { t, k };
  }).filter((b) => b.k > 0);
  const onStop = (w: number) => !p.mixed && Math.abs(p.w - w) < 0.05;
  const between = !p.mixed && !stops.some((s) => onStop(s.w));
  return (
    <div class="rp-ruler">
      <div class="rp-bands" style={{ gridTemplateColumns: bands.map((b) => `${b.k}fr`).join(' ') }}>
        {bands.map((b) => <span key={b.t.id} class={p.tier === b.t.id ? 'on' : ''} title={`${b.t.label}: from ${b.t.from} m`}>{b.t.short}</span>)}
      </div>
      <div class="rp-track" ref={trackRef} onPointerDown={(e) => drag(e as unknown as PointerEvent)} style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
        {stops.map((s) => (
          <button key={s.w} class={`rp-stop ${onStop(s.w) ? 'on' : ''} ${p.mixed && s.w >= p.lo - 0.05 && s.w <= p.hi + 0.05 ? 'range' : ''}`} disabled={p.disabled}
            title={`${s.label}${s.sub ? ` (${s.sub} m)` : ' m'}`} aria-label={`${s.label}${s.sub ? '' : ' m'}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => p.onWidth(s.w)}>
            {s.label.replace(' ft', '')}{s.sub && <small>{s.sub}</small>}
          </button>
        ))}
        {between && <i class="rp-mark" style={{ left: `${pos(p.w) * 100}%` }} title={`${fmt(p.w)} m`} />}
        {p.mixed && <i class="rp-range" style={{ left: `${pos(p.lo) * 100}%`, width: `${(pos(p.hi) - pos(p.lo)) * 100}%` }} />}
      </div>
      <div class="rp-wrow">
        <button class="rp-ib sm" disabled={p.disabled} title="Narrower by 0.5 m ([)" aria-label="Narrower" onClick={() => p.onStep(-0.5)}><Ico d={P.minus} size={16} /></button>
        <label class="rp-wfield" title="Width, footpath to footpath: any width, including 3 m or 200 m">
          <input type="text" inputMode="decimal" disabled={p.disabled} aria-label="Width in metres" placeholder={p.mixed ? 'Mixed' : undefined}
            value={typed ?? (p.mixed ? '' : fmt(p.w))}
            onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => setTyped(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const v = parseFloat((e.currentTarget as HTMLInputElement).value); if (v > 0) p.onWidth(v); setTyped(null); (e.currentTarget as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setTyped(null); (e.currentTarget as HTMLInputElement).blur(); }
              e.stopPropagation();
            }} />
          <em>m</em>
        </label>
        <button class="rp-ib sm" disabled={p.disabled} title="Wider by 0.5 m (])" aria-label="Wider" onClick={() => p.onStep(0.5)}><Ico d={P.plus} size={16} /></button>
      </div>
    </div>
  );
}

// ---------------- height ----------------

/** Auto (the road works out ground / bridge / tunnel per segment), or pinned on a bridge or in a tunnel. */
function Height(p: { edit: boolean; targets: Target[]; disabled?: boolean }) {
  const ids = p.targets.flatMap((t) => t.secs.map((s) => s.id));
  // lit from the stored pins (all on a bridge / all in a tunnel); old maps without pins fall back to the deck height
  const pins = new Set(ids.map((id) => ui.doc.get<'section'>(id)?.pin));
  const pin = pins.size === 1 ? [...pins][0] : 'mixed';
  // no pins: Bridge / Tunnel only when every section is up / down (a road that's partly a bridge was worked out: Auto)
  const decks = p.edit && pin === undefined ? ids.map((id) => ops.deckOf(ui.doc, [id])) : [];
  const unpinned = decks.length && decks.every((d) => d > 0.25) ? 'bridge' : decks.length && decks.every((d) => d < -0.25) ? 'tunnel' : 'auto';
  const cur = !p.edit ? (roadHeight.value === 'ground' ? 'auto' : roadHeight.value)
    : pin === 'bridge' || pin === 'tunnel' ? pin : pin === undefined ? unpinned : pin === 'mixed' ? '' : 'auto';
  const opts: { id: 'auto' | 'bridge' | 'tunnel'; label: string }[] = [
    { id: 'auto', label: 'Height: Auto: ground, bridge or tunnel worked out per segment from the terrain (Home)' },
    { id: 'bridge', label: 'Bridge: pinned up on a deck (Shift+PgUp)' },
    { id: 'tunnel', label: 'Tunnel: pinned below the ground (Shift+PgDn)' },
  ];
  const set = (v: 'auto' | 'bridge' | 'tunnel') => {
    if (p.disabled) return;
    if (p.edit) {
      // pin (or unpin: Auto) every section of the roads shown here, not whatever is selected
      const kind = v === 'auto' ? undefined : v;
      write(v === 'auto' ? 'Height: auto' : v === 'bridge' ? 'Pin bridge' : 'Pin tunnel', () => { for (const id of ids) pinSection(ui.E, id, kind); }, p.targets);
      return;
    }
    roadHeight.value = v;
    penLift.value = HEIGHT_LIFT[v];
  };
  return (
    <div class="rp-height" role="radiogroup" aria-label="Height">
      {opts.map((o) => (
        <button key={o.id} role="radio" aria-checked={cur === o.id} class={`rp-ib ${cur === o.id ? 'on' : ''}`} disabled={p.disabled} title={o.label} aria-label={o.label.split(':')[0]} onClick={() => set(o.id)}>
          <Ico d={P[o.id]} />
        </button>
      ))}
    </div>
  );
}

// ---------------- search, recents, saved ----------------

const isStreet = (a: AssetDef | undefined): a is AssetDef => !!a && a.drawer === 'network' && a.profile.type === 'street';

function search(q: string, std: StandardId): AssetDef[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hay = (a: AssetDef) => `${a.name} ${a.id.replace(/^\w+\./, '')} ${a.tab} ${sizeLabel(a)} ${a.use ?? ''}`.toLowerCase();
  const rank = (a: AssetDef) => (a.name.toLowerCase().startsWith(words[0]) || a.id.toLowerCase().endsWith(`.${words[0]}`) ? 0 : 1) + (a.pack === std ? 0 : a.pack === 'core' ? 0.5 : 1);
  return allAssets().filter(isStreet).filter((a) => { const h = hay(a); return words.every((w) => h.includes(w)); }).sort((a, b) => rank(a) - rank(b)).slice(0, 10);
}

function Find(p: { std: StandardId; disabled?: boolean; onPick: (a: AssetDef) => void }) {
  const [q, setQ] = useState('');
  const hits = search(q, p.std);
  const recents = (settings.value.recentAssets ?? []).map((id) => getAsset(id)).filter(isStreet).slice(0, 6);
  const saved = customAssets().filter(isStreet);
  const tile = (a: AssetDef) => (
    <button key={a.id} class="rp-tile" disabled={p.disabled} title={`${a.name} (${sizeLabel(a)}): ${a.use ?? a.source}`} aria-label={a.name} onClick={() => p.onPick(a)}>
      <img src={thumb(a)} width={48} height={31} alt="" draggable={false} />
      <span>{short(a)}</span>
    </button>
  );
  return (
    <div class="rp-find">
      <label class="rp-search" title="Find a road type: old names work too (18B, DP road 24, 30A, 80 ft)">
        <Ico d={P.search} size={16} />
        <input type="search" value={q} placeholder="18B, DP road 24…" aria-label="Find a road type" onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && hits[0]) { p.onPick(hits[0]); setQ(''); } }} />
      </label>
      <div class="rp-tiles">
        {q ? (hits.length ? hits.map(tile) : <span class="rp-note">Nothing called “{q}”. Any width works: type it on the ruler.</span>) : <>
          {recents.map(tile)}
          {saved.length > 0 && recents.length > 0 && <span class="rp-sep" />}
          {saved.map(tile)}
        </>}
      </div>
    </div>
  );
}

/** A short tile label: the template code, or the width. */
function short(a: AssetDef): string {
  if (a.id.startsWith('rm~')) return a.name.split(' · ')[0];
  if (a.pack === 'pune') return a.id.slice(5);
  if (a.id.startsWith('road.dp')) return `DP ${sizeLabel(a)}`;
  const ft = /\d+ ft/.exec(a.name);
  return ft ? ft[0] : sizeLabel(a);
}

// ---------------- more: the stored OSM class ----------------

function More(p: { targets: Target[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const cls = new Set(p.targets.map((t) => t.cls));
  const one = cls.size === 1 ? [...cls][0] : '';
  return (
    <div class="rp-more">
      <button class={`rp-ib sm ${open ? 'on' : ''}`} title="More: the class stored for routing and export" aria-label="More" aria-expanded={open} onClick={() => setOpen(!open)}><Ico d={P.more} size={16} /></button>
      {open && (
        <label class="rp-cls" title="OSM class: worked out from the width and standard; set it here to override">
          <span>Class</span>
          <select class="select" value={one} disabled={p.disabled} onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v) { const ids = p.targets.map((t) => t.id); write('Road class', () => { for (const id of ids) ui.doc.set(id, 'cls', v); }, p.targets); }
          }}>
            {!one && <option value="">Mixed</option>}
            {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
