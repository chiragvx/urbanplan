// The long-section: terrain against the road's level along it, coloured by what each stretch is (ground, bridge,
// cutting, tunnel), steep stretches flagged amber with their grade. While the road tool draws it floats above the
// drawing strip (LiveLongSection); for a built road the inspector can show it (RoadLongSection), and each stretch's
// icon pins it to a kind; a rail / metro line's too, read-only (TrackLongSection).
import { useState } from 'preact/hooks';
import { buildOpen, docVersion, tool } from '../editor/state';
import { liveSection, pinSection, roadLevels, trackLevels, type LongSectionData } from '../editor/heights';
import { gradeGuide, STRUCT_HINT, STRUCT_KINDS, STRUCT_LABEL, type StructKind } from '../doc/structure';
import type { Id } from '../doc/types';
import { ui } from './ctx';
import './LongSection.css';

const PATH: Record<StructKind | 'lock' | 'unlock', string> = {
  ground: 'M1 10.5h14M3 13.5l2-3M13 13.5l-2-3M5 10.5l1.5-2h3l1.5 2',
  bridge: 'M1 5.5h14M3 5.5v8M8 5.5v8M13 5.5v8M3 9.5q2.5-2.5 5 0q2.5-2.5 5 0',
  cutting: 'M1 4l4.5 7.5h5L15 4M5.5 11.5h5',
  tunnel: 'M2 14V8.5a6 6 0 0 1 12 0V14M5 14V9.5a3 3 0 0 1 6 0V14M1 14h14',
  lock: 'M5 7.5V5.5a3 3 0 0 1 6 0v2M4 7.5h8v6H4z',
  unlock: 'M5 7.5V5.5a3 3 0 0 1 5.8-1M4 7.5h8v6H4z',
};
const Ico = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const pct = (g: number) => `${(Math.abs(g) * 100).toFixed(1)} %`;

/** The chart itself. `onPin(i, kind)` pins stretch i (kind undefined: back to auto); without it the icons are read-only. */
export function LongSection({ data, onPin, width = 380, height = 104 }: { data: LongSectionData; onPin?: (i: number, kind: StructKind | undefined) => void; width?: number; height?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const P = data.samples;
  if (P.length < 2) return null;
  const W = width, H = height, padT = 6, padB = 14;
  let lo = Infinity, hi = -Infinity;
  for (const q of P) { lo = Math.min(lo, q.road, q.ground, q.water ?? Infinity); hi = Math.max(hi, q.road, q.ground); }
  for (const m of data.marks ?? []) { lo = Math.min(lo, m.z); hi = Math.max(hi, m.z); }
  const span = Math.max(12, hi - lo);
  lo -= span * 0.12; hi += span * 0.12;
  const L = data.len || 1;
  const X = (s: number) => (s / L) * W;
  const Y = (z: number) => padT + (1 - (z - lo) / (hi - lo)) * (H - padT - padB);
  const ground = `M0 ${H} ` + P.map((q) => `L${X(q.s).toFixed(1)} ${Y(q.ground).toFixed(1)}`).join(' ') + ` L${W} ${H} Z`;
  // water: from the ground up to its surface, per run of wet samples
  const wet: string[] = [];
  for (let i = 0; i < P.length; i++) {
    if (P[i].water == null) continue;
    let j = i;
    while (j + 1 < P.length && P[j + 1].water != null) j++;
    const a = X(P[Math.max(0, i - 1)].s + (i ? (P[i].s - P[i - 1].s) / 2 : 0)), b = X(j + 1 < P.length ? (P[j].s + P[j + 1].s) / 2 : P[j].s);
    const lvl = Y(Math.max(...P.slice(i, j + 1).map((q) => q.water ?? -Infinity)));
    wet.push(`M${a} ${lvl} ` + P.slice(i, j + 1).map((q) => `L${X(q.s)} ${Y(q.ground)}`).join(' ') + ` L${b} ${lvl} Z`);
    i = j;
  }
  const z0 = P[0].road, z1 = P[P.length - 1].road;
  const hv = hover !== null ? P[Math.max(0, Math.min(P.length - 1, hover))] : null;
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const s = ((e.clientX - r.left) / r.width) * L;
    let best = 0;
    P.forEach((q, i) => { if (Math.abs(q.s - s) < Math.abs(P[best].s - s)) best = i; });
    setHover(best);
  };
  return (
    <div class="ls" onPointerDown={(e) => e.stopPropagation()}>
      <div class="ls-chips" style={{ width: '100%' }}>
        {data.stretches.map((st, i) => {
          const mid = ((st.s0 + st.s1) / 2 / L) * 100, narrow = (st.s1 - st.s0) / L < 0.07;
          const tip = `${STRUCT_LABEL[st.kind]} · ${fmtLen(st.s1 - st.s0)}${st.steep ? ` · ${pct(st.grade)} (steeper than the ${pct(gradeGuide(data.cls))} guide)` : ''}${st.pinned ? ' · pinned' : ''}${st.pinned && st.auto !== st.kind ? ` (would be ${STRUCT_LABEL[st.auto].toLowerCase()})` : ''}${onPin ? ' — click to pin' : ''}`;
          return (
            <span key={i} class="ls-chip-wrap" style={{ left: `${mid}%` }}>
              <button class={`ls-chip k-${st.kind} ${st.steep ? 'steep' : ''} ${st.pinned ? 'pinned' : ''} ${narrow ? 'narrow' : ''}`} title={tip} aria-label={tip} disabled={!onPin}
                onClick={() => setOpen(open === i ? null : i)}>
                <Ico d={PATH[st.kind]} size={narrow ? 12 : 15} />
                {st.pinned && <i class="ls-lock"><Ico d={PATH.lock} size={10} /></i>}
                {st.steep && !narrow && <b class="ls-pct">{pct(st.grade)}</b>}
              </button>
              {open === i && onPin && (
                <span class="ls-pop" role="menu">
                  {STRUCT_KINDS.map((k) => (
                    <button key={k} class={`ls-chip k-${k} ${st.pinned && st.kind === k ? 'on' : ''}`} title={`Pin: ${STRUCT_HINT[k]}`} aria-label={`Pin as ${STRUCT_LABEL[k]}`} onClick={() => { onPin(i, k); setOpen(null); }}><Ico d={PATH[k]} /></button>
                  ))}
                  <button class={`ls-chip ${!st.pinned ? 'on' : ''}`} title="Unpin: worked out from the ground" aria-label="Unpin" onClick={() => { onPin(i, undefined); setOpen(null); }}><Ico d={PATH.unlock} /></button>
                </span>
              )}
            </span>
          );
        })}
      </div>
      <svg class="ls-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Long-section: ${data.stretches.map((s) => STRUCT_LABEL[s.kind]).join(', ')}`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <path d={ground} class="ls-ground" />
        {wet.map((d, i) => <path key={i} d={d} class="ls-water" />)}
        {data.stretches.map((st, i) => {
          const q = P.filter((p) => p.s >= st.s0 - 1e-6 && p.s <= st.s1 + 1e-6);
          if (q.length < 2) return null;
          const d = q.map((p, k) => `${k ? 'L' : 'M'}${X(p.s).toFixed(1)} ${Y(p.road).toFixed(1)}`).join(' ');
          const piers: preact.JSX.Element[] = [];
          if (st.kind === 'bridge') for (let s = st.s0 + 15; s < st.s1 - 5; s += 30) {
            const p = q.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a));
            if (p.road - p.ground > 2.5) piers.push(<line key={s} x1={X(p.s)} x2={X(p.s)} y1={Y(p.road)} y2={Y(Math.max(p.ground, p.water ?? -Infinity))} class="ls-pier" />);
          }
          return <g key={i}>{piers}<path d={d} class={`ls-road k-${st.kind} ${st.steep ? 'steep' : ''}`} /></g>;
        })}
        {(data.marks ?? []).map((m, i) => <circle key={i} cx={X(m.s)} cy={Y(m.z)} r={2.6} class={`ls-mark ${m.join ? 'join' : ''}`} />)}
        {hv && <line x1={X(hv.s)} x2={X(hv.s)} y1={0} y2={H} class="ls-cross" />}
      </svg>
      <div class="ls-foot">
        {hv
          ? <span>{fmtLen(hv.s)} · {data.cls === 'rail' || data.cls === 'metro' ? 'track' : 'road'} {hv.road.toFixed(1)} m · ground {hv.ground.toFixed(1)} m · {hv.road >= hv.ground ? '+' : '−'}{Math.abs(hv.road - hv.ground).toFixed(1)} m{hv.water != null ? ` · water ${hv.water.toFixed(1)} m` : ''}</span>
          : <span>A {z0.toFixed(0)} m → B {z1.toFixed(0)} m · {pct((z1 - z0) / L)} · {fmtLen(L)}</span>}
      </div>
    </div>
  );
}

/** While the road tool draws: the long-section of the stretch under the cursor, floating above the drawing strip. */
export function LiveLongSection() {
  const d = liveSection.value;
  if (!d || tool.value !== 'pen' || buildOpen.value) return null;
  return (
    <div class="ls-live" onPointerDown={(e) => e.stopPropagation()}>
      <LongSection data={d} onPin={(i, k) => { const st = d.stretches[i]; if (st) ui.E.road.pinAt((st.s0 + st.s1) / 2, k); }} />
    </div>
  );
}

/** A built road's long-section (for the road inspector): `ids` = the road's sections (or a selection of them). */
export function RoadLongSection({ ids }: { ids: Id[] }) {
  void docVersion.value;
  const d = ids.length ? roadLevels(ui.E, ids) : null;
  if (!d) return null;
  return <LongSection data={d} width={340} onPin={(i, k) => { const id = d.ids?.[i]; if (id) pinSection(ui.E, id, k); }} />;
}

/** A rail / metro line's long-section (for the line inspector): read-only, its stretches are worked out from the ground. */
export function TrackLongSection({ id }: { id: Id }) {
  void docVersion.value;
  const d = trackLevels(ui.E, id);
  return d ? <LongSection data={d} width={340} /> : null;
}
