// Cross-section strip (Streetmix-style): parts left → right as you'd see them looking along the road.
// Drag a boundary to resize, click a part to change kind / width / direction, add parts from the chips, and pick a
// whole cross-section from the preset gallery (Cities: Skylines style tiles drawn from the catalogue).
import { useState } from 'preact/hooks';
import type { Part, PartKind } from '../net/model';
import { PART_DEFAULT_W, PART_LABEL, totalWidth, DP_WIDTHS, setTotalWidth } from '../doc/xsection';
import { allAssets, assetWidth, sizeLabel, tabsOf, type AssetDef } from '../assets';
import { thumb } from '../assets/thumb';
import { NumberField, Icon } from './components';

const COLOR: Record<PartKind, string> = {
  lane: '#55595f', bus: '#8a4c45', cycle: '#4f7f57', parking: '#6a6e74', shoulder: '#62666b', median: '#a49c8c', sidewalk: '#cfc6b4', planter: '#7ea05a',
};
const KINDS: PartKind[] = ['lane', 'bus', 'cycle', 'parking', 'shoulder', 'median', 'sidewalk', 'planter'];
let dragSeq = 0;

/** Street cross-sections from the catalogue, by tab; "Similar" = the ones closest to this width. */
function presetTabs(W: number): { tab: string; list: AssetDef[] }[] {
  const streets = allAssets().filter((a) => a.drawer === 'network' && a.profile.type === 'street' && a.category === 'roads');
  const similar = streets.filter((a) => !a.lift && Math.abs(assetWidth(a) - W) <= Math.max(2, W * 0.2)).sort((a, b) => Math.abs(assetWidth(a) - W) - Math.abs(assetWidth(b) - W)).slice(0, 12);
  return [{ tab: 'Similar', list: similar }, ...tabsOf('roads').map((tab) => ({ tab, list: streets.filter((a) => a.tab === tab) })).filter((t) => t.list.length)];
}

export function CrossSection(p: { parts: Part[]; onChange: (parts: Part[], merge?: string) => void; onPreset?: (a: AssetDef) => void; reserve?: number; disabled?: boolean; state?: 'base' | 'own' | 'road' | 'new' }) {
  const [sel, setSel] = useState<number | null>(null);
  const [gallery, setGallery] = useState(false);
  const [tab, setTab] = useState('Similar');
  const [where, setWhere] = useState<'L' | 'R'>('R');
  const parts = p.parts;
  const W = totalWidth(parts);
  const scaleW = Math.max(W, p.reserve ?? 0, 6);
  const pct = (w: number) => `${(w / scaleW) * 100}%`;
  const set = (i: number, q: Partial<Part>, merge?: string) => p.onChange(parts.map((x, k) => (k === i ? { ...x, ...q } : x)), merge);
  const insert = (i: number, kind: PartKind) => {
    const dir: Part['dir'] = kind === 'lane' || kind === 'bus' || kind === 'cycle' ? (i <= parts.length / 2 ? 1 : -1) : 0;
    const next = [...parts];
    next.splice(i, 0, { kind, width: PART_DEFAULT_W[kind], dir });
    p.onChange(next);
    setSel(i);
  };
  const add = (kind: PartKind) => insert(sel !== null ? (where === 'L' ? sel : sel + 1) : where === 'L' ? 0 : parts.length, kind);
  const resize = (i: number, e: PointerEvent) => {
    if (p.disabled) return;
    e.preventDefault(); e.stopPropagation();
    const strip = (e.currentTarget as HTMLElement).parentElement!.parentElement!.getBoundingClientRect();
    const mpp = scaleW / strip.width;
    const x0 = e.clientX, w0 = parts[i].width, key = 'xs' + ++dragSeq;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      const w = Math.max(0.3, Math.round((w0 + (m.clientX - x0) * mpp) * 10) / 10);
      set(i, { width: w }, key);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const s = sel !== null && sel < parts.length ? parts[sel] : null;
  const tabs = gallery ? presetTabs(W) : [];
  const cur = tabs.find((t) => t.tab === tab) ?? tabs[0];
  const scales = DP_WIDTHS.filter((w) => w >= 6 && w <= 45);
  return (
    <div class={`xs ${p.disabled ? 'disabled' : ''}`}>
      <div class="xs-head">
        <span class="xs-total">{p.state && p.state !== 'base' && <i class={`dot ${p.state}`} />}{W.toFixed(1)} m</span>
        {p.reserve ? <span class={`xs-dp ${Math.abs(W - p.reserve) < 0.6 ? 'ok' : ''}`} title="Development Plan road reserve">DP {p.reserve} m</span> : null}
        <span class="spacer" />
        {!p.disabled && <button class={`small ${gallery ? 'on' : ''}`} onClick={() => setGallery(!gallery)} title="Pick a whole cross-section from the catalogue">{gallery ? 'Close presets' : 'Presets'}</button>}
      </div>
      {gallery && cur && (
        <div class="xs-gallery">
          <nav class="xs-gtabs">
            {tabs.map((t) => <button key={t.tab} class={t === cur ? 'on' : ''} onClick={() => setTab(t.tab)}>{t.tab}</button>)}
          </nav>
          <div class="xs-tiles" key={cur.tab}>
            {cur.list.map((a) => (
              <button key={a.id} class="xs-tile" title={`${a.name} · ${sizeLabel(a)}\n${a.use ?? ''}`} onClick={() => { if (a.profile.type !== 'street') return; if (p.onPreset) p.onPreset(a); else p.onChange(a.profile.parts.map((q) => ({ ...q }))); }}>
                <img src={thumb(a)} width={96} height={62} alt="" draggable={false} />
                <span class="xs-tname">{a.name}</span>
                <span class="xs-tsize">{sizeLabel(a)}</span>
              </button>
            ))}
            {!cur.list.length && <p class="muted small">Nothing close to {W.toFixed(1)} m — try another tab.</p>}
          </div>
          <div class="xs-scales">
            <span class="muted small">Scale to</span>
            {scales.map((w) => <button key={w} class={`chip ${Math.abs(W - w) < 0.05 ? 'on' : ''}`} onClick={() => p.onChange(setTotalWidth(parts, w))}>{w}</button>)}
          </div>
        </div>
      )}
      <div class="xs-wrap">
        <div class="xs-strip">
          {p.reserve ? <div class="xs-reserve" style={{ width: pct(p.reserve) }} title={`DP reserve ${p.reserve} m`} /> : null}
          {parts.map((q, i) => (
            <div key={i} class={`xs-part k-${q.kind} ${sel === i ? 'sel' : ''}`} style={{ width: pct(q.width), background: COLOR[q.kind] }} onClick={() => setSel(sel === i ? null : i)} title={`${PART_LABEL[q.kind]} · ${q.width.toFixed(2)} m — click to edit`}>
              {(q.kind === 'lane' || q.kind === 'bus' || q.kind === 'cycle') && q.width / scaleW > 0.05 && (
                <span class="xs-arrow">{q.dir === 1 ? <Icon.arrowUp size={12} /> : q.dir === -1 ? <Icon.arrowDown size={12} /> : <Icon.both size={12} />}</span>
              )}
              {!p.disabled && <span class="xs-grip" onPointerDown={(e) => resize(i, e as unknown as PointerEvent)} />}
            </div>
          ))}
        </div>
        <div class="xs-scale">
          {parts.map((q, i) => <span key={i} style={{ width: pct(q.width) }}>{q.width / scaleW > 0.07 ? q.width.toFixed(1) : ''}</span>)}
        </div>
      </div>
      {s && !p.disabled && (
        <div class="xs-edit">
          <select class="select" value={s.kind} onChange={(e) => set(sel!, { kind: (e.currentTarget as HTMLSelectElement).value as PartKind })}>
            {KINDS.map((k) => <option key={k} value={k}>{PART_LABEL[k]}</option>)}
          </select>
          <NumberField value={s.width} unit="m" step={0.05} digits={2} min={0.2} max={20} onChange={(v, m) => set(sel!, { width: v }, m)} width={86} />
          {(s.kind === 'lane' || s.kind === 'bus' || s.kind === 'cycle') && (
            <div class="seg small">
              <button class={s.dir === 1 ? 'on' : ''} title="With the road direction (a → b)" onClick={() => set(sel!, { dir: 1 })}><Icon.arrowUp size={12} /></button>
              <button class={s.dir === 0 ? 'on' : ''} title="Both ways (shared)" onClick={() => set(sel!, { dir: 0 })}><Icon.both size={12} /></button>
              <button class={s.dir === -1 ? 'on' : ''} title="Against the road direction" onClick={() => set(sel!, { dir: -1 })}><Icon.arrowDown size={12} /></button>
            </div>
          )}
          <span class="spacer" />
          <button class="icon-btn" title="Move left" disabled={sel === 0} onClick={() => { const n = [...parts]; [n[sel! - 1], n[sel!]] = [n[sel!], n[sel! - 1]]; p.onChange(n); setSel(sel! - 1); }}>‹</button>
          <button class="icon-btn" title="Move right" disabled={sel === parts.length - 1} onClick={() => { const n = [...parts]; [n[sel! + 1], n[sel!]] = [n[sel!], n[sel! + 1]]; p.onChange(n); setSel(sel! + 1); }}>›</button>
          <button class="icon-btn danger" title="Remove" disabled={parts.length <= 1} onClick={() => { p.onChange(parts.filter((_, k) => k !== sel)); setSel(null); }}><Icon.trash size={14} /></button>
        </div>
      )}
      {!p.disabled && (
        <div class="xs-add">
          <div class="seg small" title={s ? 'Add next to the selected part' : 'Add at the road edge'}>
            <button class={where === 'L' ? 'on' : ''} onClick={() => setWhere('L')}>{s ? '◂ Before' : '◂ Left'}</button>
            <button class={where === 'R' ? 'on' : ''} onClick={() => setWhere('R')}>{s ? 'After ▸' : 'Right ▸'}</button>
          </div>
          {KINDS.map((k) => (
            <button key={k} class="xs-chip" title={`Add ${PART_LABEL[k].toLowerCase()} (${PART_DEFAULT_W[k]} m)`} onClick={() => add(k)}>
              <i style={{ background: COLOR[k] }} />{PART_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
