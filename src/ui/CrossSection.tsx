// Cross-section strip (Streetmix-style): parts left → right as you'd see them looking along the road.
// Drag a boundary to resize, click a part to change kind / width / direction, + to add, presets for classes.
import { useState } from 'preact/hooks';
import type { Part, PartKind } from '../net/model';
import { PART_DEFAULT_W, PART_LABEL, totalWidth, template, DP_WIDTHS, setTotalWidth } from '../doc/xsection';
import { CLASS_LABEL } from '../doc/types';
import { NumberField, Icon, Menu } from './components';

const COLOR: Record<PartKind, string> = {
  lane: '#55595f', bus: '#8a4c45', cycle: '#4f7f57', parking: '#6a6e74', shoulder: '#62666b', median: '#a49c8c', sidewalk: '#cfc6b4', planter: '#7ea05a',
};
const KINDS: PartKind[] = ['lane', 'bus', 'cycle', 'parking', 'shoulder', 'median', 'sidewalk', 'planter'];
let dragSeq = 0;

export function CrossSection(p: { parts: Part[]; onChange: (parts: Part[], merge?: string) => void; reserve?: number; disabled?: boolean; state?: 'base' | 'own' | 'road' | 'new' }) {
  const [sel, setSel] = useState<number | null>(null);
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
  const resize = (i: number, e: PointerEvent) => {
    if (p.disabled) return;
    e.preventDefault(); e.stopPropagation();
    const strip = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
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
  return (
    <div class={`xs ${p.disabled ? 'disabled' : ''}`}>
      <div class="xs-head">
        <span class="xs-total">{p.state && p.state !== 'base' && <i class={`dot ${p.state}`} />}{W.toFixed(1)} m</span>
        {p.reserve ? <span class={`xs-dp ${Math.abs(W - p.reserve) < 0.6 ? 'ok' : ''}`} title="Development Plan road reserve">DP {p.reserve} m</span> : null}
        <span class="spacer" />
        {!p.disabled && (
          <Menu label="Presets" class="small" items={[
            ...['trunk', 'primary', 'secondary', 'tertiary', 'busway', 'residential', 'living_street', 'service'].map((c) => ({ label: CLASS_LABEL[c], run: () => p.onChange(template(c)) })),
            'sep',
            ...DP_WIDTHS.filter((w) => w >= 6 && w <= 45).map((w) => ({ label: `Scale to ${w} m`, run: () => p.onChange(setTotalWidth(parts, w)) })),
          ]} />
        )}
      </div>
      <div class="xs-strip">
        {p.reserve ? <div class="xs-reserve" style={{ width: pct(p.reserve) }} title={`DP reserve ${p.reserve} m`} /> : null}
        {parts.map((q, i) => (
          <div key={i} class={`xs-part k-${q.kind} ${sel === i ? 'sel' : ''}`} style={{ width: pct(q.width), background: COLOR[q.kind] }} onClick={() => setSel(sel === i ? null : i)} title={`${PART_LABEL[q.kind]} · ${q.width.toFixed(2)} m`}>
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
      {!p.disabled && (
        <div class="xs-add">
          <AddMenu label="+ Left" onPick={(k) => insert(0, k)} />
          {s && <AddMenu label="+ Beside" onPick={(k) => insert((sel ?? 0) + 1, k)} />}
          <span class="spacer" />
          <AddMenu label="+ Right" onPick={(k) => insert(parts.length, k)} />
        </div>
      )}
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
          <button class="icon-btn" title="Move left" disabled={sel === 0} onClick={() => { const n = [...parts]; [n[sel! - 1], n[sel!]] = [n[sel!], n[sel! - 1]]; p.onChange(n); setSel(sel! - 1); }}>‹</button>
          <button class="icon-btn" title="Move right" disabled={sel === parts.length - 1} onClick={() => { const n = [...parts]; [n[sel! + 1], n[sel!]] = [n[sel!], n[sel! + 1]]; p.onChange(n); setSel(sel! + 1); }}>›</button>
          <button class="icon-btn danger" title="Remove" disabled={parts.length <= 1} onClick={() => { p.onChange(parts.filter((_, k) => k !== sel)); setSel(null); }}><Icon.trash size={14} /></button>
        </div>
      )}
    </div>
  );
}

function AddMenu(p: { label: string; onPick: (k: PartKind) => void }) {
  return <Menu label={p.label} class="small" items={KINDS.map((k) => ({ label: PART_LABEL[k], run: () => p.onPick(k) }))} />;
}
