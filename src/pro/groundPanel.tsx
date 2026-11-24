// The plot's ground in the Plot inspector (docs/plans/plot-ground.md §5): what its surface is, what's under it (a
// preset for the city, the quick fields "top layer, rock at, water at", or a soil report pasted in), the layers as a
// borehole log drawn to scale (drag a boundary to change a thickness), boreholes at points, spot heights, and what
// the ground makes of the scheme (./foundation.ts). And a building's foundation, for its inspector.
import { useRef, useState } from 'preact/hooks';
import type { Evaluated } from './evaluate';
import type { ProProject } from './project';
import { COVERS, coverOf, GROUND_PRESETS, groundAtPoint, groundFor, logText, parseLog, quickLayers, rockTop, runsOf, SOIL_KINDS, SOILS, type Cover, type Hole, type Layer, type PlotGround, type SoilKind } from './ground';
import type { GroundCut } from './scene';
import { FOUNDATION_LABEL, type Found } from './foundation';
import { Btn, cr, Icon, Lines, Note, nf, Num, Select } from './ui';

const m = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString('en-IN')} m`;
const KIND_OPTS = SOIL_KINDS.map((k) => ({ value: k, label: SOILS[k].short }));

/** the plot's middle (plot metres), where a new borehole or spot goes */
const middle = (e: Evaluated): [number, number] => { const n = e.r.net; let x = 0, z = 0; for (let i = 0; i < n.length; i += 2) { x += n[i]; z += n[i + 1]; } const k = Math.max(1, n.length / 2); return [Math.round(x / k), Math.round(z / k)]; };

export function GroundBody({ p, e, up }: { p: ProProject; e: Evaluated; up: (o: Partial<ProProject>) => void }) {
  const g = p.ground;
  const [edit, setEdit] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  if (!g) return <>
    <p class="hint-line"><Icon n="info" size={14} />Not said: ordinary ground is assumed (firm soil, no rock in reach, no water), as the build rate assumes. Say what this plot is made of, and its basements and foundations are worked out from it.</p>
    <Btn icon="strata" onClick={() => up({ ground: groundFor(p.city) })}>Say what it's made of</Btn>
  </>;
  const set = (x: Partial<PlotGround>) => up({ ground: { ...g, src: 'user', preset: undefined, ...x } });
  // (the log being edited: a borehole's, or the plot's own)
  const hole = edit ? g.holes?.find((h) => h.id === edit) ?? null : null;
  const layers = hole ? hole.layers : g.layers, water = hole ? hole.water : g.water;
  const setLog = (L: Layer[], w: number | null = water, src: PlotGround['src'] = 'user') => {
    if (hole) up({ ground: { ...g, src, holes: g.holes!.map((h) => (h.id === hole.id ? { ...h, layers: L, water: w } : h)) } });
    else up({ ground: { ...g, src, preset: undefined, layers: L, water: w } });
  };
  const runs = runsOf(layers), rt = rockTop(runs);
  const preset = g.src === 'preset' && g.preset ? g.preset : g.src === 'report' ? 'report' : 'own';
  const G = e.ground;
  return <>
    <div class="insp-row fitrow">
      <Select<string> label="What's under it" value={preset} onChange={(v) => { const P = GROUND_PRESETS.find((x) => x.id === v); if (P) { setEdit(null); up({ ground: { ...structuredClone(P.g), spots: g.spots, src: 'preset', preset: P.id } }); } }}
        options={[...GROUND_PRESETS.map((x) => ({ value: x.id, label: x.label })), { value: 'own', label: 'My own' }, { value: 'report', label: 'From a soil report' }]}
        hint={GROUND_PRESETS.find((x) => x.id === preset)?.note ?? (preset === 'report' ? 'Read from a pasted borehole log.' : 'Set by hand.')} />
      <Btn kind="quiet" icon="x" title="Back to ordinary ground (not said)" onClick={() => { setEdit(null); up({ ground: undefined }); }} />
    </div>

    <div class="gl-h">Its surface</div>
    <div class="gl-cover" role="group" aria-label="What the surface is">
      {COVERS.map((c) => <button type="button" aria-pressed={g.cover === c.value} data-tip={c.value in SOILS ? SOILS[c.value as SoilKind].label : c.label} onClick={() => up({ ground: { ...g, cover: c.value } })}><i style={`background:${c.colour}`} class={`pat-${c.pattern}`} />{c.label}</button>)}
    </div>

    <div class="gl-h">Quick: top layer, rock, water{hole ? ` · ${holeName(g, hole)}` : ''}</div>
    <div class="gl-quick">
      <Select<SoilKind> label="Top layer" value={layers[0]?.kind ?? 'stiff-clay'} onChange={(v) => setLog(quickLayers(v, rt, runs.find((r) => SOILS[r.kind].rock)?.kind ?? 'hard-rock'))} options={KIND_OPTS} />
      <Num label="Rock at" value={rt ?? 0} zero="none" set={(v) => setLog(quickLayers(layers[0]?.kind ?? 'stiff-clay', v > 0 ? v : null))} min={0} max={80} step={0.5} unit="m" hint="Bedrock's depth" />
      <Num label="Water at" value={water ?? 0} zero="none" set={(v) => setLog(layers, v > 0 ? v : null)} min={0} max={60} step={0.5} unit="m" hint="At its highest" />
    </div>

    <div class="gl-h">The log{hole ? ` · ${holeName(g, hole)}` : g.holes?.length ? ' · the plot\'s middle' : ''}<small>{logText(layers)}</small></div>
    <div class="gl-log">
      <LogColumn layers={layers} water={water} dig={G?.dig?.depth ?? null} pile={G ? Math.max(0, ...G.buildings.map((f) => (f.piles ? f.depth + f.piles.length : f.depth))) : 0} set={(L) => setLog(L)} />
      <div class="gl-layers">{layers.map((l, i) => { const last = i === layers.length - 1; return <div class="gl-layer">
        <div class="gl-layer-h">
          <i class="gl-sw" style={`background:${SOILS[l.kind].colour}`} />
          <Select<SoilKind> size="sm" aria-label={`Layer ${i + 1}`} value={l.kind} onChange={(v) => setLog(layers.map((x, k) => (k === i ? { ...x, kind: v } : x)))} options={KIND_OPTS} />
          {layers.length > 1 ? <Btn kind="quiet" icon="trash" title="Remove the layer" onClick={() => setLog(layers.filter((_, k) => k !== i))} /> : <span />}
        </div>
        <div class="gl-layer-f">
          {last ? <div class="f"><span class="f-l">Thick</span><span class="gl-below">to depth</span></div> : <Num label="Thick" value={l.thick} set={(v) => setLog(layers.map((x, k) => (k === i ? { ...x, thick: Math.max(0.1, v) } : x)))} min={0.1} max={80} step={0.5} unit="m" />}
          <Num label="Bears, kN/m²" value={l.sbc ?? 0} zero={String(SOILS[l.kind].sbc)} set={(v) => setLog(layers.map((x, k) => (k === i ? { ...x, sbc: v > 0 ? v : undefined } : x)))} min={0} max={5000} step={25} />
        </div>
      </div>; })}</div>
    </div>
    <div class="hrow">
      <Btn kind="quiet" icon="plus" onClick={() => setLog([...layers.slice(0, -1), { kind: 'murum', thick: 2 }, layers[layers.length - 1]])}>A layer</Btn>
      <Btn kind="quiet" icon="upload" onClick={() => setPaste(paste === null ? '' : null)}>Paste a borehole log</Btn>
    </div>
    {paste !== null && <div class="gl-paste">
      <textarea class="txt" rows={6} placeholder={'0 – 1.5 m  Black cotton soil\n1.5 – 4.5 m  Murum, N = 38\n4.5 – 6 m  Weathered basalt\n6 – 12 m  Hard basalt\nWater table at 3.2 m'} value={paste} onInput={(ev) => setPaste((ev.target as HTMLTextAreaElement).value)} />
      <Btn icon="check" disabled={!paste.trim()} onClick={() => { const r = parseLog(paste); setSkipped(r.skipped); if (r.layers.length) { setLog(r.layers, r.water, 'report'); setPaste(null); } }}>Read it</Btn>
      {skipped.length > 0 && <Note tone="warn">Couldn't read {skipped.length} line{skipped.length > 1 ? 's' : ''}: {skipped.slice(0, 3).join(' · ')}{skipped.length > 3 ? ' …' : ''}</Note>}
    </div>}

    <div class="gl-h">Boreholes<small>{g.holes?.length ? 'The ground between them is blended; each building reads the ground under it.' : 'One log for the whole plot. Add boreholes where the ground differs.'}</small></div>
    {(g.holes ?? []).map((h) => <div class="insp-row gl-hole">
      <button type="button" class="hlink" aria-pressed={edit === h.id} onClick={() => setEdit(edit === h.id ? null : h.id)}>{holeName(g, h)}</button>
      <Num label="x" value={h.at[0]} set={(v) => set({ holes: g.holes!.map((x) => (x.id === h.id ? { ...x, at: [v, x.at[1]] } : x)) })} min={-500} max={500} step={0.5} unit="m" />
      <Num label="z" value={h.at[1]} set={(v) => set({ holes: g.holes!.map((x) => (x.id === h.id ? { ...x, at: [x.at[0], v] } : x)) })} min={-500} max={500} step={0.5} unit="m" />
      <Btn kind="quiet" icon="trash" title="Remove the borehole" onClick={() => { if (edit === h.id) setEdit(null); set({ holes: g.holes!.filter((x) => x.id !== h.id) }); }} />
    </div>)}
    <Btn kind="quiet" icon="plus" onClick={() => { const id = `bh${Date.now().toString(36)}`; const [x, z] = middle(e), k = (g.holes?.length ?? 0); set({ holes: [...(g.holes ?? []), { id, at: [x + k * 8, z], layers: structuredClone(layers), water }] }); setEdit(id); }}>A borehole</Btn>

    <div class="gl-h">Spot heights<small>Levels across the plot over the road; the slope's plane bends through them.</small></div>
    {(g.spots ?? []).map((s, i) => <div class="insp-row gl-hole">
      <Num label="x" value={s[0]} set={(v) => set({ spots: g.spots!.map((q, k) => (k === i ? [v, q[1], q[2]] : q)) })} min={-500} max={500} step={0.5} unit="m" />
      <Num label="z" value={s[1]} set={(v) => set({ spots: g.spots!.map((q, k) => (k === i ? [q[0], v, q[2]] : q)) })} min={-500} max={500} step={0.5} unit="m" />
      <Num label="Level" value={s[2]} set={(v) => set({ spots: g.spots!.map((q, k) => (k === i ? [q[0], q[1], v] : q)) })} min={-30} max={60} step={0.1} unit="m" />
      <Btn kind="quiet" icon="trash" title="Remove the spot" onClick={() => set({ spots: g.spots!.filter((_, k) => k !== i) })} />
    </div>)}
    <Btn kind="quiet" icon="plus" onClick={() => { const [x, z] = middle(e); set({ spots: [...(g.spots ?? []), [x, z, p.levels?.plot ?? 0.3]] }); }}>A spot height</Btn>

    {G && <>
      <div class="gl-h">What it makes of the scheme</div>
      <Lines rows={[
        ['Basements', `${e.d.site.basements}${G.cap.max < 4 ? ` · the ground makes ${G.cap.max} worth it` : ''}`],
        ...(G.dig ? [
          ['Dug', `${m(G.dig.depth)} deep · ${nf(G.dig.byLayer.reduce((s, x) => s + x.vol, 0))} m³`],
          ['Through', G.dig.byLayer.map((x) => `${SOILS[x.kind].short} ${nf(x.vol)} m³`).join(' · ')],
          ['Sides', [G.dig.shore?.label, G.dig.rockFace ? 'rock face bolted' : ''].filter(Boolean).join('; ') || '—'],
          ['Water', G.dig.water.below ? `${m(G.dig.water.head)} below it: dewatered, tanked${G.dig.water.uplift ? ', anchored down' : ''}` : 'above the water'],
        ] as [string, string][] : []),
        ...(G.cutFill.cut + G.cutFill.fill > 1 ? [['Levelling', `${nf(G.cutFill.cut)} m³ cut, ${nf(G.cutFill.fill)} m³ fill`] as [string, string]] : []),
        ...G.buildings.map((f) => [f.name, `${f.label}${f.piles ? `, ${f.piles.n} × ${f.piles.dia} m` : ''} at ${m(f.depth)}`] as [string, string]),
        ['Over an ordinary site', `${cr(G.lines.net)}${G.months ? ` · ${G.months} months more` : ''}`],
      ]} />
      {G.cap.max < 4 && <p class="hint-line">{G.cap.why}</p>}
      <p class="hint-line"><Icon n="info" size={14} />A feasibility estimate: a soil investigation and a structural engineer confirm the layers, the foundations and the dig.</p>
    </>}
  </>;
}

const holeName = (g: PlotGround, h: Hole) => `BH-${(g.holes ?? []).indexOf(h) + 1}`;

/** the log drawn to scale, a boundary dragged to change the thickness above it; the water and the dig marked */
function LogColumn({ layers, water, dig, pile, set }: { layers: Layer[]; water: number | null; dig: number | null; pile: number; set: (L: Layer[]) => void }) {
  const [drag, setDrag] = useState<{ i: number; L: Layer[] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const L = drag?.L ?? layers, runs = runsOf(L);
  const finite = runs.slice(0, -1).reduce((s, r) => Math.max(s, r.bottom), 0);
  const D = Math.max(12, Math.ceil((Math.max(finite, water ?? 0, dig ?? 0, pile) + 4) / 5) * 5), H = 280, W = 60, y = (d: number) => 14 + (Math.min(d, D) / D) * (H - 20);
  const depthOf = (ev: PointerEvent) => { const b = svg.current!.getBoundingClientRect(); return ((ev.clientY - b.top) * (H / b.height) - 14) / (H - 20) * D; };
  const move = (ev: PointerEvent) => { if (!drag) return; const top = runs[drag.i].top, t = Math.max(0.1, Math.round((depthOf(ev) - top) * 10) / 10); setDrag({ ...drag, L: drag.L.map((x, k) => (k === drag.i ? { ...x, thick: t } : x)) }); };
  return <svg ref={svg} class="gl-col" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The log, to ${D} m`} onPointerMove={move} onPointerUp={() => { if (drag) { set(drag.L); setDrag(null); } }} onPointerCancel={() => setDrag(null)}>
    {runs.map((r) => <rect x={18} y={y(r.top)} width={W - 22} height={Math.max(0.5, y(r.bottom) - y(r.top))} fill={SOILS[r.kind].colour}><title>{`${SOILS[r.kind].label}: ${m(r.top)} to ${Number.isFinite(r.bottom) ? m(r.bottom) : 'below'}`}</title></rect>)}
    {Array.from({ length: D / 5 + 1 }, (_, k) => <g><line x1={12} x2={18} y1={y(k * 5)} y2={y(k * 5)} stroke="currentColor" stroke-width="0.6" /><text x={10} y={y(k * 5) + 3} font-size="7" text-anchor="end" fill="currentColor">{k * 5}</text></g>)}
    {water !== null && <line x1={18} x2={W - 4} y1={y(water)} y2={y(water)} stroke="#3b82c4" stroke-width="1.6" stroke-dasharray="4 2"><title>{`Water at ${m(water)}`}</title></line>}
    {dig !== null && dig > 0 && <rect x={30} y={y(0)} width={W - 46} height={y(dig) - y(0)} fill="none" stroke="#e5484d" stroke-width="1.2" stroke-dasharray="3 2"><title>{`The basements' dig, ${m(dig)}`}</title></rect>}
    {runs.slice(0, -1).map((r, i) => <line class="gl-edge" x1={18} x2={W - 4} y1={y(r.bottom)} y2={y(r.bottom)} stroke="transparent" stroke-width="8" style="cursor:ns-resize"
      onPointerDown={(ev) => { svg.current?.setPointerCapture(ev.pointerId); setDrag({ i, L: layers }); }}><title>Drag to change the layer's thickness</title></line>)}
  </svg>;
}

/** a building's foundation, in its inspector */
export function FoundationBody({ f, basements }: { f: Found | undefined; basements: number }) {
  if (!f) return <p class="hint-line"><Icon n="info" size={14} />Say what the plot is made of (the plot's Ground) to work out this building's foundation.</p>;
  return <>
    <Lines rows={[
      ['Foundation', FOUNDATION_LABEL[f.kind]],
      ['Founded at', `${m(f.depth)} on ${SOILS[f.on].short.toLowerCase()}`],
      ['Pressure / bearing', `${f.q} / ${f.sbc} kN/m²`],
      ...(f.piles ? [['Piles', `${f.piles.n} × ${f.piles.dia} m, ${m(f.piles.length)} long${f.piles.socket ? `, ${m(f.piles.socket)} into ${SOILS[f.piles.into!].short.toLowerCase()}` : ''}`] as [string, string]] : []),
      ...(f.raft ? [['Raft', `${m(f.raft)} thick`] as [string, string]] : []),
      ...(basements ? [['Under the basements', `${basements} level${basements > 1 ? 's' : ''}`] as [string, string]] : []),
      ['Cost', `${cr(f.cost)} (ordinary ground: ${cr(f.ordinary)})`],
    ]} />
    {f.why.map((w) => <p class="hint-line">{w}</p>)}
    {f.flags.map((x) => <Note tone="warn">{x.text}</Note>)}
  </>;
}

/** the surface's look for the 3D: its colour and texture */
export const coverLook = (c: Cover) => { const x = coverOf(c); return { id: x.value, colour: x.colour, pattern: x.pattern }; };

/** the cut-away for the 3D: the plot's middle log, the water, the dig and each building's foundation, the holes */
export function groundCutOf(e: Evaluated): GroundCut | null {
  const g = e.p.ground, G = e.ground; if (!g) return null;
  const [cx, cz] = middle(e), mid = groundAtPoint(g, cx, cz), runs = runsOf(mid.layers);
  const deepest = Math.max(G?.dig?.depth ?? 0, ...(G?.buildings ?? []).map((f) => f.depth + (f.piles?.length ?? 0) + (f.raft ?? 0)), mid.water ?? 0, ...runs.slice(0, -1).map((r) => r.bottom));
  const floor = Math.max(12, Math.ceil((deepest + 4) / 2) * 2);
  const col = (rs: ReturnType<typeof runsOf>) => rs.map((r) => ({ colour: SOILS[r.kind].colour, top: r.top, bottom: r.bottom, pattern: SOILS[r.kind].pattern }));
  return {
    runs: col(runs), water: mid.water, floor,
    dig: G?.dig ? { depth: G.dig.depth, levels: G.dig.n, bh: (G.dig.depth - 0.6) / G.dig.n } : null,
    found: (G?.buildings ?? []).map((f) => ({ id: f.id, kind: f.kind, depth: f.depth, raft: f.raft, piles: f.piles ? { n: f.piles.n, dia: f.piles.dia, length: f.piles.length } : undefined })),
    holes: (g.holes ?? []).map((h) => ({ at: h.at, runs: col(runsOf(h.layers)) })),
  };
}
