// The plot drawn corner by corner, in plan: drag a corner (half-metre steps), click the + on an edge for a new corner,
// select a corner to delete it, select an edge to set its exact length or put a road along it (today's width and
// the DP's). Or paste the corners as x, y lines in metres (from a survey, a sanctioned plan, a CAD file). A drag that
// would make the outline cross itself is refused. Changes go to the project when the drag ends, so the scheme is
// worked out once per move, not on every mouse step.
import { useRef, useState } from 'preact/hooks';
import { crosses, roadLines, type EdgeRoad } from './project';
import { Check } from './ui';

interface Props { ring: number[]; roads: (EdgeRoad | null)[]; set: (ring: number[], roads: (EdgeRoad | null)[]) => void }

const snap = (v: number) => Math.round(v * 2) / 2;
const area = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a / 2); };
const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

export function PlotEditor({ ring, roads, set }: Props) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const [sel, setSel] = useState<{ kind: 'corner' | 'edge'; k: number } | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const svg = useRef<SVGSVGElement>(null), drag = useRef<{ k: number; moved: boolean } | null>(null);
  const R = draft ?? ring, n = R.length / 2;

  // the frame: the plot and its roads, with room round it
  const lines = roadLines(R, roads);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < R.length; i += 2) { x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, R[i + 1]); z1 = Math.max(z1, R[i + 1]); }
  const pad = Math.max(14, Math.max(...roads.map((x) => (x ? Math.max(x.today, x.dp) : 0)), 0) + 4), size = Math.max(x1 - x0, z1 - z0) + 2 * pad;
  const vb = [(x0 + x1) / 2 - size / 2, (z0 + z1) / 2 - size / 2, size, size];
  const px = size / 290; // metres per screen pixel, roughly

  const toPlan = (e: PointerEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse(), p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [p.x, p.y];
  };
  const down = (k: number) => (e: PointerEvent) => { e.stopPropagation(); (e.target as Element).setPointerCapture(e.pointerId); drag.current = { k, moved: false }; setSel({ kind: 'corner', k }); setErr(''); };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, z] = toPlan(e), next = [...R];
    next[2 * d.k] = snap(x); next[2 * d.k + 1] = snap(z);
    if (crosses(next)) { setErr('That would make the outline cross itself.'); return; }
    d.moved = true; setErr(''); setDraft(next);
  };
  const up = () => { const d = drag.current; drag.current = null; if (d?.moved && draft) set(draft, roads); setDraft(null); };

  const insert = (k: number) => {
    const i = 2 * k, j = (i + 2) % R.length, next = [...R];
    next.splice(i + 2, 0, snap((R[i] + R[j]) / 2), snap((R[i + 1] + R[j + 1]) / 2));
    const rs = [...roads];
    rs.splice(k + 1, 0, roads[k] ? { ...roads[k]! } : null);
    set(next, rs); setSel({ kind: 'corner', k: k + 1 });
  };
  const remove = (k: number) => {
    if (n <= 3) return;
    const next = [...R]; next.splice(2 * k, 2);
    if (crosses(next)) { setErr('Taking that corner out would make the outline cross itself.'); return; }
    const rs = [...roads]; rs.splice(k, 1);
    set(next, rs); setSel(null);
  };
  const edgeLen = (k: number) => { const i = 2 * k, j = (i + 2) % R.length; return Math.hypot(R[j] - R[i], R[j + 1] - R[i + 1]); };
  const setLen = (k: number, L: number) => {
    // the edge's far corner moves along it; the rest stay
    const i = 2 * k, j = (i + 2) % R.length, cur = edgeLen(k);
    if (!(L > 0.5) || cur < 0.01) return;
    const next = [...R];
    next[j] = Math.round((R[i] + ((R[j] - R[i]) * L) / cur) * 100) / 100; next[j + 1] = Math.round((R[i + 1] + ((R[j + 1] - R[i + 1]) * L) / cur) * 100) / 100;
    if (crosses(next)) { setErr('That length would make the outline cross itself.'); return; }
    set(next, roads);
  };
  const setRoad = (k: number, v: EdgeRoad | null) => { const rs = [...roads]; rs[k] = v; set(R, rs); };

  const applyPaste = () => {
    const nums = (paste ?? '').split(/\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[\s,]+/).map(Number));
    const pts = nums.filter((p) => p.length >= 2 && p.every(Number.isFinite));
    if (pts.length < 3) { setErr('Give at least three corners, one "x, y" pair a line (metres).'); return; }
    // (a survey's y runs north, the plan's z runs away from the front: flip it)
    const next = pts.flatMap(([x, y]) => [x, -y]);
    if (crosses(next)) { setErr('Those corners make an outline that crosses itself. Check their order.'); return; }
    set(next, next.filter((_, i) => i % 2 === 0).map((_, k) => (k === 0 ? roads[0] ?? { today: 12, dp: 0 } : null)));
    setPaste(null); setErr(''); setSel(null);
  };

  const e = sel?.kind === 'edge' ? sel.k : -1, c = sel?.kind === 'corner' ? sel.k : -1;
  const pts = Array.from({ length: n }, (_, k) => [R[2 * k], R[2 * k + 1]]);
  // which way is out: the ring's winding (in plan, z down)
  let sa = 0;
  for (let i = 0; i < R.length; i += 2) { const j = (i + 2) % R.length; sa += R[i] * R[j + 1] - R[j] * R[i + 1]; }
  const cw = sa > 0 ? 1 : -1;
  return (
    <div class="ped">
      <svg ref={svg} viewBox={vb.join(' ')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => setSel(null)} role="img" aria-label="The plot's outline">
        {lines.map((l) => {
          const [ax, az, bx, bz] = l.pts;
          return <g>
            <line x1={ax} y1={az} x2={bx} y2={bz} stroke="#5b5e66" stroke-width={l.road.today} />
            {l.road.dp > l.road.today && [-1, 1].map((sg) => { const L = Math.hypot(bx - ax, bz - az), ox = (-(bz - az) / L) * (l.road.dp / 2) * sg, oz = ((bx - ax) / L) * (l.road.dp / 2) * sg; return <line x1={ax + ox} y1={az + oz} x2={bx + ox} y2={bz + oz} stroke="#e5484d" stroke-width={px * 1.5} stroke-dasharray={`${px * 6} ${px * 4}`} />; })}
          </g>;
        })}
        <polygon points={pts.map((p) => p.join(',')).join(' ')} class="ped-plot" stroke-width={px * 2} stroke-linejoin="round" />
        {pts.map((p, k) => {
          const q = pts[(k + 1) % n], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
          // the length reads outside the edge, clear of its + handle
          const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = ((q[1] - p[1]) / L) * cw, nz = (-(q[0] - p[0]) / L) * cw;
          return <g>
            <line class="ped-edge" x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={k === e ? '#ff6a2b' : 'transparent'} stroke-width={px * (k === e ? 4 : 14)} onPointerDown={(ev) => { ev.stopPropagation(); setSel({ kind: 'edge', k }); setErr(''); }} />
            <text x={mx + nx * px * 12} y={mz + nz * px * 12} font-size={px * 11} text-anchor={nx > 0.5 ? 'start' : nx < -0.5 ? 'end' : 'middle'} dominant-baseline="middle" class="ped-len">{f1(edgeLen(k))} m</text>
            <g class="ped-add" onPointerDown={(ev) => { ev.stopPropagation(); insert(k); }}>
              <circle cx={mx} cy={mz} r={px * 7} />
              <path d={`M${mx - px * 3.5} ${mz}h${px * 7}M${mx} ${mz - px * 3.5}v${px * 7}`} stroke-width={px * 1.5} />
            </g>
          </g>;
        })}
        {pts.map((p, k) => <circle class={`ped-pt${k === c ? ' on' : ''}`} cx={p[0]} cy={p[1]} r={px * 6} stroke-width={px * 2} onPointerDown={down(k)} />)}
      </svg>
      <p class="pro-note">{f1(area(R))} m² · {n} corners. Drag a corner, + adds one, click an edge for its length and road.</p>
      {err && <p class="ped-err">{err}</p>}
      {e >= 0 && (
        <div class="ped-box">
          <b>Edge {e + 1}</b>
          <label class="pf"><span>Length</span><span class="pf-in"><input type="number" step="0.1" value={f1(edgeLen(e))} onChange={(ev) => setLen(e, parseFloat((ev.target as HTMLInputElement).value))} /><i>m</i></span></label>
          <Check label="A road along this edge" value={!!roads[e]} set={(on) => setRoad(e, on ? { today: 9, dp: 0 } : null)} />
          {roads[e] && <div class="pf-row">
            <label class="pf"><span>Width today</span><span class="pf-in"><input type="number" min="3" max="80" value={roads[e]!.today} onChange={(ev) => { const v = parseFloat((ev.target as HTMLInputElement).value); if (v >= 3) setRoad(e, { ...roads[e]!, today: v }); }} /><i>m</i></span></label>
            <label class="pf"><span>In the DP</span><span class="pf-in"><input type="number" min="0" max="80" value={roads[e]!.dp} onChange={(ev) => { const v = parseFloat((ev.target as HTMLInputElement).value); if (v >= 0) setRoad(e, { ...roads[e]!, dp: v }); }} /><i>m</i></span></label>
          </div>}
        </div>
      )}
      {c >= 0 && (
        <div class="ped-box">
          <b>Corner {c + 1}</b>
          <span class="pro-note">x {f1(R[2 * c])} m, y {f1(-R[2 * c + 1])} m</span>
          <button class="pbtn" disabled={n <= 3} onClick={() => remove(c)}>Delete corner</button>
        </div>
      )}
      {paste === null
        ? <button class="linkbtn" onClick={() => setPaste(pts.map((p) => `${f1(p[0])}, ${f1(-p[1])}`).join('\n'))}>Paste corners (x, y in metres)…</button>
        : <div class="ped-box">
          <b>Corners, one "x, y" a line</b>
          <textarea rows={6} value={paste} onInput={(ev) => setPaste((ev.target as HTMLTextAreaElement).value)} />
          <span class="pro-note">In metres, y to the north. The first edge gets the front road.</span>
          <div class="pf-row"><button class="pbtn primary" onClick={applyPaste}>Use these</button><button class="pbtn" onClick={() => { setPaste(null); setErr(''); }}>Cancel</button></div>
        </div>}
    </div>
  );
}
