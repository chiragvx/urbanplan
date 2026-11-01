// Inspector for a sandbox plot: what the DP road takes, what the rules allow, a summary of the site on it, and the
// way into Site Studio, where the buildings are designed. Every rule can be changed for this plot.
import { mode, readOnly, select, docVersion } from '../editor/state';
import { ui } from './ctx';
import { Icon, NumberField, Section, Seg, Toggle } from './components';
import type { PlotObj } from '../doc/types';
import { CODE_LABEL, CODE_NOTE, USE_NOTE, type PlotReport, type PlotRules } from '../doc/plot';
import { siteDefaults } from '../doc/optimise';
import { UNIT_COLOR, UNIT_LABEL, type SiteReport } from '../doc/site';
import { exportPlot } from '../editor/plotexport';

const m2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const fx = (v: number) => (Math.round(v * 100) / 100).toString();
const cr = (v: number) => `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1e9 ? 0 : 1 })} Cr`;
const pc = (v: number) => `${Math.round(v * 100)} %`;

const RULES: { k: keyof PlotRules; label: string; unit?: string; step: number; max: number; pct?: boolean; digits?: number; title: string }[] = [
  { k: 'basic', digits: 2, label: 'Basic FSI', step: 0.05, max: 5, title: 'Floor space index allowed as of right' },
  { k: 'premium', digits: 2, label: 'Premium FSI', step: 0.05, max: 5, title: 'Extra FSI bought from the authority' },
  { k: 'tdr', digits: 2, label: 'TDR', step: 0.05, max: 5, title: 'Transferable development rights that can be loaded (depends on the road width)' },
  { k: 'ancillary', digits: 0, label: 'Ancillary', unit: '%', step: 5, max: 100, pct: true, title: 'Ancillary (UDCPR) or fungible (DCPR) FSI as a share of the above: staircases, lifts, balconies' },
  { k: 'front', label: 'Front margin', unit: 'm', step: 0.5, max: 30, title: 'From the road boundary (after DP widening)' },
  { k: 'side', label: 'Side / rear', unit: 'm', step: 0.5, max: 30, title: 'Side and rear margins up to the height below; above it H/5, at most 12 m' },
  { k: 'sideTo', digits: 0, label: 'Up to', unit: 'm', step: 1, max: 100, title: 'Height up to which the side / rear margin above applies' },
  { k: 'floorH', label: 'Floor height', unit: 'm', step: 0.1, max: 6, title: 'Floor to floor' },
  { k: 'maxH', digits: 0, label: 'Height limit', unit: 'm', step: 1, max: 300, title: 'The most the building may rise (fire access, airport, local rules)' },
];

export function PlotPanel(p: { id: string }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const o = ui.doc.get<'plot'>(p.id);
  const ro = readOnly.value;
  if (!o) return null;
  const r = ui.E.plot.report(o.id), d = ui.E.plot.layout(o.id);
  const set = (patch: Partial<PlotObj>, merge?: string) => ui.E.edit('Plot', () => ui.doc.update(o.id, patch as Record<string, unknown>), merge);
  const setRule = (k: keyof PlotRules, v: number, merge?: string) => set({ rules: { ...o.rules, [k]: v } }, merge);
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.plot /> Plot sandbox{r ? ` · ${CODE_LABEL[r.code]}` : ''}</div>
      <input class="title-input" value={o.name} disabled={ro} aria-label="Plot name" onChange={(e) => set({ name: (e.currentTarget as HTMLInputElement).value.trim() || 'Plot' })} />
      {r && <PlotDiagram o={o} r={r} d={d} />}
      {r && d && (
        <dl class="plot-stats">
          <div><dt>Flats</dt><dd>{d.flats.toLocaleString('en-IN')}</dd><small>{d.buildings.length} building{d.buildings.length === 1 ? '' : 's'} · {fx(d.height)} m</small></div>
          <div class={d.over.fsi ? 'bad' : ''} title="Built-up area over plot area, ancillary included"><dt>FSI used</dt><dd>{fx(d.fsi)}</dd><small>of {fx(r.bua / r.area)} · {m2(d.bua)}</small></div>
          <div class={r.lost > 0.5 ? 'bad' : ''}><dt>After DP road</dt><dd>{m2(r.netArea)}</dd><small>{r.lost > 0.5 ? `−${m2(r.lost)} of ${m2(r.area)}` : `of ${m2(r.area)}`}</small></div>
          <div class={d.money.profit < 0 ? 'bad' : ''}><dt>Profit</dt><dd>{cr(d.money.profit)}</dd><small>{pc(d.money.margin)} margin</small></div>
        </dl>
      )}
      {r?.onRoad && <p class="note">{r.road?.name} runs over this plot. Draw the plot from the edge of the road for the right numbers.</p>}
      {r && r.floors === 0 && <p class="note">Nothing fits inside the margins. Check the margins, or draw a bigger plot.</p>}
      {d && (d.over.margins || d.over.overlap || d.over.fsi || d.over.height) && <p class="note">The site breaks the rules here and there: open it in Site Studio to see where.</p>}
      {r && <button class="primary wide" onClick={() => ui.E.openStudio(o.id)}><Icon.cube size={14} /> Open in Site Studio</button>}
      {!o.site && r && <p class="small muted">A bar along the road to start with: shape the buildings, the flat mix, parking and rates in the studio (or double-click the plot).</p>}

      <Section title="Road">
        {r?.road ? (
          <p class="small">Fronts <b>{r.road.name}</b>: {fx(r.road.today)} m today{r.road.dp ? <>, <span style="color:var(--danger)">{r.road.dp} m in the DP</span></> : ', no DP width on record'}.</p>
        ) : <p class="small muted">No road found next to this plot. The rules use a 0 m road.</p>}
        <div class="grid2">
          <Seg small value={o.basis ?? (r?.road?.dp ? 'dp' : 'today')} onChange={(v) => !ro && set({ basis: v })} options={[
            { value: 'today', label: 'Today’s width', title: 'Rules by the road as built' },
            { value: 'dp', label: 'DP width', title: 'Rules by the Development Plan width (when the DP strip is handed over)' },
          ]} />
        </div>
        <Seg small value={o.use} onChange={(v) => !ro && set({ use: v, site: o.site?.manual ? o.site : { ...siteDefaults(v), design: o.site?.design } })} options={[
          { value: 'residential', label: 'Residential', title: USE_NOTE.residential }, { value: 'commercial', label: 'Commercial', title: USE_NOTE.commercial },
          { value: 'industrial', label: 'Industrial', title: USE_NOTE.industrial },
        ]} />
        {o.use !== 'residential' && <p class="small muted">{USE_NOTE[o.use]}</p>}
        {r?.road?.dp && r.road.dp > r.road.today && (
          <Toggle checked={!!o.credit} disabled={ro} onChange={(v) => set({ credit: v || undefined })} label="Count FSI for the DP strip handed over"
            title="The authority may allow the basic FSI of the land given up for the DP road on the rest of the plot (or give TDR for it instead)" />
        )}
        {r?.code === 'udcpr' && (
          <Toggle checked={!!o.congested} disabled={ro} onChange={(v) => set({ congested: v || undefined })} label="Congested area (gaothan, old core)"
            title="UDCPR Table 6-A instead of 6-G" />
        )}
      </Section>

      {r && (
        <Section title="Rules" open={false} right={o.rules && Object.keys(o.rules).length ? <button class="link small" disabled={ro} onClick={() => set({ rules: undefined })}>Reset</button> : undefined}>
          <div class="grid2">
            {RULES.map((x) => {
              const v = r.rules[x.k], own = o.rules?.[x.k] !== undefined;
              return (
                <NumberField key={x.k} label={x.label} unit={x.unit} digits={x.digits} title={x.title} step={x.step} min={0} max={x.max} disabled={ro}
                  value={x.pct ? Math.round(v * 100) : v} state={own ? 'own' : 'base'}
                  onChange={(n, m) => setRule(x.k, x.pct ? n / 100 : n, m)} />
              );
            })}
          </div>
          <dl class="kv plot-calc">
            <dt>Basic {fx(r.rules.basic)} × {m2(r.netArea)} after the DP road</dt><dd>{m2(r.parts.basic)}</dd>
            <dt>Premium {fx(r.rules.premium)} × {m2(r.area)} whole plot</dt><dd>{m2(r.parts.premium)}</dd>
            <dt>TDR {fx(r.rules.tdr)} × {m2(r.area)}</dt><dd>{m2(r.parts.tdr)}</dd>
            {r.parts.credit > 0 && <><dt>DP strip {fx(r.rules.basic)} × {m2(r.lost)}</dt><dd>{m2(r.parts.credit)}</dd></>}
            <dt>{r.code === 'udcpr' ? 'Ancillary' : 'Fungible'} {Math.round(r.rules.ancillary * 100)} %</dt><dd>{m2(r.parts.ancillary)}</dd>
            <dt><b>Built-up area</b> · FSI {fx(r.fsi)} on a {fx(r.roadW)} m road</dt><dd><b>{m2(r.bua)}</b></dd>
          </dl>
          <p class="small muted">The biggest envelope: {r.floors} floors, {fx(r.height)} m, {m2(r.footprintArea)} a floor{r.side > r.rules.side + 0.01 ? `, side and rear margins grown to ${fx(r.side)} m (H/5)` : ''}.
            {r.limit === 'height' && ` The height limit leaves ${m2(r.bua - r.buildable)} of FSI unused.`}
            {r.limit === 'margins' && ` Going higher widens the margins faster than it adds floors: ${m2(r.bua - r.buildable)} of FSI doesn't fit.`}</p>
          <p class="small muted">{CODE_NOTE[r.code]}</p>
        </Section>
      )}

      {r && (
        <Section title="Export">
          <p class="small muted">The plot, the building and the site around it (ground, roads, buildings), in metres from the plot's centre.</p>
          <div class="btns">
            <button onClick={() => exportPlot(ui.E, o.id, 'dxf')} title="AutoCAD, BricsCAD: plan layers, and the massing as 3D faces">DXF</button>
            <button onClick={() => exportPlot(ui.E, o.id, 'obj')} title="Rhino, SketchUp, Blender, Revit">OBJ</button>
            <button onClick={() => exportPlot(ui.E, o.id, 'glb')} title="glTF binary: Blender, three.js, Unreal, Unity">glTF</button>
          </div>
        </Section>
      )}

      <div class="btns">
        <button onClick={() => ui.E.zoomToSelection()}>Zoom to it</button>
        {mode.value === '2d' && <button onClick={() => ui.E.setMode('3d')}><Icon.cube size={14} /> See it in 3D</button>}
        <button class="danger" disabled={ro} onClick={() => { ui.E.edit('Delete plot', () => ui.doc.remove(o.id)); select([]); }}><Icon.trash size={14} /> Delete</button>
      </div>
    </div>
  );
}

/** The plot from above: the DP strip, the envelope and the buildings' typical floors. */
function PlotDiagram({ o, r, d }: { o: PlotObj; r: PlotReport; d: SiteReport | null }) {
  const R = o.ring;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < R.length; i += 2) { x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, R[i + 1]); z1 = Math.max(z1, R[i + 1]); }
  const W = 320, H = 170, pad = 10;
  const k = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, z1 - z0));
  const ox = (W - (x1 - x0) * k) / 2, oz = (H - (z1 - z0) * k) / 2;
  const p = (ring: number[]) => ring.length < 6 ? '' : ring.reduce((s, v, i) => s + (i % 2 ? `,${((v - z0) * k + oz).toFixed(1)}` : `${i ? 'L' : 'M'}${((v - x0) * k + ox).toFixed(1)}`), '') + 'Z';
  const env = d?.envelope.length ? d.envelope : r.footprint;
  const B = d?.buildings ?? [];
  return (
    <>
      <svg class="plot-diagram clickable" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Plot outline: ${Math.round(r.lost)} m² in the DP road, ${d?.flats ?? 0} flats. Opens Site Studio.`} onClick={() => ui.E.openStudio(o.id)}>
        <path d={p(R)} fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="5 4" />
        {r.lostRings.map((L, i) => <path key={`dp${i}`} d={p(L)} fill="color-mix(in srgb, var(--danger) 28%, transparent)" stroke="var(--danger)" stroke-width="1.5" />)}
        {env.length >= 6 && <path d={p(env)} fill={B.length ? 'none' : 'color-mix(in srgb, var(--accent) 35%, transparent)'} stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3" />}
        {B.map((b) => b.units.map((u, i) => <path key={`${b.b.id}u${i}`} d={p(u.ring)} fill={UNIT_COLOR[u.t]} stroke="#fff" stroke-width="0.5" />))}
        {B.map((b) => b.corridors.map((c, i) => <path key={`${b.b.id}h${i}`} d={p(c)} fill="#d9dce3" />))}
        {B.map((b) => b.cores.map((c, i) => <path key={`${b.b.id}c${i}`} d={p(c)} fill="#6b7280" />))}
        {B.map((b) => b.quads.map((q, i) => <path key={`${b.b.id}q${i}`} d={p(q)} fill="none" stroke={b.clash ? 'var(--danger)' : '#1c2333'} stroke-width={b.clash ? 1.5 : 0.8} />))}
      </svg>
      {d && d.flats > 0 && <div class="plot-legend">{UNIT_LABEL.map((l, t) => d.count[t] > 0 && <span key={t}><i style={`background:${UNIT_COLOR[t]}`} />{l} × {d.count[t]}</span>)}</div>}
    </>
  );
}
