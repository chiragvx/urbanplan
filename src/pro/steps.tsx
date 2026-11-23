// The six steps of a Pro project, one panel each, in the order a developer works: the site and its rules, the
// design system, the scheme (the buildings), the money, the approval, then exploring (options, a brief, screening,
// layouts). The Site and Scheme panels are in ./sitePanels.tsx, the Design system in ./designStep.tsx. Each panel
// opens on what most people change; the rest folds away. Every figure here comes from the one evaluation in
// main.tsx (./evaluate.ts), so a panel never shows a number another disagrees with.
import { Dither } from '../theme/Dither';
import { LandWorthBox } from './numbersUi';
import { useMemo, useState } from 'preact/hooks';
import { UNIT_LABEL } from '../doc/site';
import type { ProProject } from './project';
import { fromMetres, importPlot } from './importPlot';
import { utmToLatLon } from './terrain';
import { useEffect } from 'preact/hooks';
import type { Evaluated } from './evaluate';
import { DEAL_LABEL, DEFAULT_DEAL, type Deal, type DealKind, type DealResult } from './deal';
import { scrutinySummary, type Check, type CheckStatus } from './scrutiny';
import { documents, fees, nocs, permissionOf, stages, PERMISSION_LABEL, PERMISSION_HINT, type PermissionKind } from './approvals';
import { predcrDxf } from './dxf';
import { downloadSet, sheetDefs } from './drawings';
import { ROOM_COLOR, type FlatRooms } from './rooms';
import { Btn, cr, download, Icon, Lines, Note, nf, Num, pct, Row, Section, Seg, Select, sqft, Toggle } from './ui';
import { checkBuilding } from './viewer';

export type Step = 'brief' | 'design' | 'numbers' | 'approve';
export const STEPS: { key: Step; label: string; icon: string; title: string; sub: string }[] = [
  { key: 'design', label: 'Project', icon: 'building', title: 'The project', sub: 'The site, what you’re building, the look, options from a brief: on the view’s right with nothing picked.' },
  { key: 'numbers', label: 'Numbers', icon: 'money', title: 'Numbers', sub: 'The area statement, then the money: price, cost, the deal on the land, the cash.' },
  { key: 'approve', label: 'Approval', icon: 'shield', title: 'Approval', sub: 'Our own scrutiny, the NOCs and fees, and the drawings and files to submit.' },
];
/** the six steps before (stored, or in old links) and the place each one's settings went to */
export const OLD_STEP: Record<string, Step> = { site: 'design', build: 'design', money: 'numbers', approve: 'approve', explore: 'design', brief: 'design' };
export const isStep = (s: unknown): s is Step => STEPS.some((x) => x.key === s);

export interface StepProps {
  p: ProProject; e: Evaluated; up: (o: Partial<ProProject>) => void;
  rooms: FlatRooms[][]; checks: Check[]; deal: DealResult;
  go: (s: Step) => void; openDrawings: () => void;
  /** the part of a step's sections a place shows (the Site and Scheme sections are split between Brief and Design) */
  part?: 'brief' | 'design' | 'project';
  /** open the design system's builder (Design › Look) */
  openLook?: () => void;
  /** the area statement, over the view */
  openStatement: () => void; toast: (s: string, o?: { undo?: boolean }) => void;
  /** pick a building and bring it into the middle of the view (by its id) */
  show: (id: string) => void;
  /** the tool on the map, and what's picked on it (./edit.ts) */
  tool: import('./edit').Tool; setTool: (t: import('./edit').Tool) => void;
  picked: import('./edit').Picked; pick: (x: import('./edit').Picked) => void;
}

/** A plot by its survey or CTS number, from Maharashtra's land records map (through /api/plot, which passes back the
 *  outline and nothing about the owners). District, taluka, village, then the number. */
const API = `${import.meta.env.BASE_URL}api/plot`;
async function api<T>(q: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}?${new URLSearchParams(q)}`);
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error('The land records lookup only runs on the live site.');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'Lookup failed');
  return j as T;
}
type Opt = { code: string; name: string };
export function FindPlot({ done, start = false, cancel }: { done: (ring: number[], src: string, at?: [number, number] | null) => void; start?: boolean; cancel?: () => void }) {
  const [open, setOpenS] = useState(start);
  const setOpen = (o: boolean) => { setOpenS(o); if (!o) cancel?.(); };
  const [cat, setCat] = useState<'U' | 'R'>('U');
  const [lists, setLists] = useState<{ d?: Opt[]; t?: Opt[]; v?: Opt[]; n?: string[] }>({});
  const [sel, setSel] = useState<{ d?: string; t?: string; v?: string }>({});
  const [no, setNo] = useState(''), [busy, setBusy] = useState(''), [err, setErr] = useState('');
  const run = async <T,>(what: string, f: () => Promise<T>) => { setBusy(what); setErr(''); try { return await f(); } catch (x) { setErr((x as Error).message); return undefined; } finally { setBusy(''); } };
  useEffect(() => { if (!open) return; setLists({}); setSel({}); void run('districts', () => api<Opt[]>({ op: 'list', level: '1', codes: `${cat},` })).then((d) => d && setLists({ d })); }, [open, cat]);
  const g = sel.d && sel.t && sel.v ? `${cat}${cat === 'U' ? 'CM' : 'VM'}${sel.d}${sel.t}${sel.v}` : '';
  const pickD = (d: string) => { setSel({ d }); setLists((l) => ({ d: l.d })); void run('talukas', () => api<Opt[]>({ op: 'list', level: '2', codes: `${cat},${d},` })).then((t) => t && setLists((l) => ({ ...l, t }))); };
  const pickT = (t: string) => { setSel((x) => ({ d: x.d, t })); setLists((l) => ({ d: l.d, t: l.t })); void run('villages', () => api<Opt[]>({ op: 'list', level: '3', codes: `${cat},${sel.d},${t},` })).then((v) => v && setLists((l) => ({ ...l, v }))); };
  const pickV = (v: string) => { setSel((x) => ({ ...x, v })); const gg = `${cat}${cat === 'U' ? 'CM' : 'VM'}${sel.d}${sel.t}${v}`; void run('plot numbers', () => api<string[]>({ op: 'plots', g: gg })).then((n) => n && setLists((l) => ({ ...l, n }))); };
  const find = () => run('the outline', () => api<{ ring: number[]; plotno: string; area: number | null }>({ op: 'plot', g, n: no.trim() })).then((x) => {
    if (!x) return;
    const vName = lists.v?.find((o) => o.code === sel.v)?.name ?? '';
    // (the land records map is in UTM zone 43: its middle, as a place)
    let ex = 0, ny = 0; const m = x.ring.length / 2; for (let i = 0; i < x.ring.length; i += 2) { ex += x.ring[i] / m; ny += x.ring[i + 1] / m; }
    done(fromMetres(x.ring, '').ring, `${cat === 'U' ? 'CTS' : 'Survey'} ${x.plotno}, ${vName} · from the land records map`, ex > 1e5 && ny > 1e6 ? utmToLatLon(ex, ny) : null);
    setOpen(false);
  });
  const S = ({ label, list, value, set }: { label: string; list?: Opt[]; value?: string; set: (v: string) => void }) => (
    <Select<string> label={label} value={value ?? ''} disabled={!list?.length} onChange={set}
      options={[{ value: '', label: list ? 'Choose…' : '…' }, ...(list ?? []).map((o) => ({ value: o.code, label: o.name }))]} />
  );
  if (!open) return <button type="button" class="linkbtn" onClick={() => setOpen(true)}><Icon n="site" size={14} /> Find the plot by survey or CTS number</button>;
  return (
    <div class="card">
      <Seg<'U' | 'R'> small value={cat} set={setCat} options={[{ value: 'U', label: 'City survey (CTS)' }, { value: 'R', label: 'Survey / gat (rural)' }]} />
      <Row><S label="District" list={lists.d} value={sel.d} set={pickD} /><S label="Taluka / office" list={lists.t} value={sel.t} set={pickT} /></Row>
      <S label="Village" list={lists.v} value={sel.v} set={pickV} />
      <label class="f"><span class="f-l">{cat === 'U' ? 'CTS' : 'Survey / gat'} number{lists.n ? ` (${nf(lists.n.length)} in this village)` : ''}</span>
        <input class="txt" list="plotnos" value={no} disabled={!g} placeholder={g ? 'e.g. 1000' : 'Choose the village first'} onInput={(ev) => setNo((ev.target as HTMLInputElement).value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && no.trim()) void find(); }} />
        <datalist id="plotnos">{lists.n?.slice(0, 3000).map((x) => <option value={x} />)}</datalist>
      </label>
      {busy && <p class="note loading" role="status"><Dither class="dz" cell={2} />Loading {busy}…</p>}
      {err && <Note tone="bad">{err}</Note>}
      <Row><Btn kind="primary" disabled={!g || !no.trim() || !!busy} onClick={() => void find()}>Use this plot</Btn><Btn kind="quiet" onClick={() => setOpen(false)}>Cancel</Btn></Row>
      <Note>From MahaBhunakasha, Maharashtra's land records map. Only the outline comes through: owner details are dropped on our server, never stored or shown. Check it against the survey before relying on it.</Note>
    </div>
  );
}

export function ImportBox({ done }: { done: (ring: number[], src: string, at?: [number, number] | null) => void }) {
  const [text, setText] = useState(''), [err, setErr] = useState('');
  const use = (t: string, name?: string) => { try { const x = importPlot(t, name); done(x.ring, x.source, x.latlon); } catch (e) { setErr((e as Error).message); } };
  return (
    <div class="card">
      <label class="drop">
        <Icon n="upload" /> <span><b>Choose a GeoJSON or KML file</b><small>From a survey, Google Earth, a GIS or a cadastre map. Only the outline is read.</small></span>
        <input type="file" accept=".geojson,.json,.kml" onChange={async (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) use(await f.text(), f.name); }} />
      </label>
      <label class="f"><span class="f-l">Or paste corners, one a line</span>
        <textarea rows={5} value={text} placeholder={'18.5204, 73.8567\n18.5206, 73.8571\n…  (latitude, longitude)\nor x, y in metres (UTM or a survey)'} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)} />
      </label>
      {err && <Note tone="bad">{err}</Note>}
      <Btn kind="primary" onClick={() => use(text)} disabled={!text.trim()}>Use these corners</Btn>
    </div>
  );
}

// ================================================================ scheme
// ================================================================ design
/** A flat's plan as a small drawing: its rooms tinted, their names and areas. */
export function FlatPlan({ t, fr }: { t: number; fr: FlatRooms }) {
  const all = fr.rooms.flatMap((r) => r.ring);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < all.length; i += 2) { x0 = Math.min(x0, all[i]); x1 = Math.max(x1, all[i]); z0 = Math.min(z0, all[i + 1]); z1 = Math.max(z1, all[i + 1]); }
  const w = x1 - x0, h = z1 - z0, pad = 0.4;
  const area = fr.rooms.reduce((s, r) => s + (r.kind === 'balcony' ? 0 : r.area), 0);
  return (
    <figure class={`flat${fr.ok ? '' : ' bad'}`}>
      <svg viewBox={`${x0 - pad} ${z0 - pad} ${w + 2 * pad} ${h + 2 * pad}`} role="img" aria-label={`${UNIT_LABEL[t]} plan`}>
        {fr.rooms.map((r) => {
          const pts = []; for (let i = 0; i < r.ring.length; i += 2) pts.push(`${r.ring[i]},${r.ring[i + 1]}`);
          let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
          for (let i = 0; i < r.ring.length; i += 2) { bx0 = Math.min(bx0, r.ring[i]); bx1 = Math.max(bx1, r.ring[i]); bz0 = Math.min(bz0, r.ring[i + 1]); bz1 = Math.max(bz1, r.ring[i + 1]); }
          const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, bw = bx1 - bx0, bh = bz1 - bz0;
          // the label fits its room: along the long side of a narrow one, small enough for the name, or left off
          const name = shortRoom(r.name), up = bh > bw * 1.4, along = up ? bh : bw, across = up ? bw : bh;
          const fs = Math.min(0.6, (along * 0.85) / (name.length * 0.56), across / 2.6);
          return <g>
            <polygon points={pts.join(' ')} fill={ROOM_COLOR[r.kind]} stroke={r.ok ? '#3f3f46' : '#e5484d'} stroke-width={r.ok ? 0.06 : 0.14} />
            {r.area >= 2 && fs >= 0.24 && <text x={cx} y={cz - fs * 0.45} font-size={fs} text-anchor="middle" dominant-baseline="middle" transform={up ? `rotate(-90 ${cx} ${cz})` : undefined}>{name}<tspan x={cx} dy={fs * 1.1} font-size={fs * 0.85} opacity="0.7">{nf(r.area, 1)}</tspan></text>}
          </g>;
        })}
      </svg>
      <figcaption><b>{UNIT_LABEL[t]}</b> {nf(area, 1)} m² rooms{fr.ok ? '' : <em> · {fr.rooms.filter((r) => !r.ok).map((r) => r.name).join(', ')} under size</em>}</figcaption>
    </figure>
  );
}
const shortRoom = (n: string) => n.replace('Master bedroom', 'Master bed').replace('Bedroom', 'Bed').replace('Living / dining', 'Living').replace('Toilet', 'WC').replace('Foyer & passage', 'Foyer');
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

// ================================================================ money
export function MoneyStep({ p, e, up, deal, go }: StepProps) {
  const c = e.d.money.costs;
  const D = p.deal ?? DEFAULT_DEAL;
  const setD = (o: Partial<Deal>) => up({ deal: { ...D, ...o } });
  const ins = deal.lines.filter((l) => l.kind === 'in'), outs = deal.lines.filter((l) => l.kind === 'out');
  const total = Math.max(1, deal.revenue, deal.cost);
  // (what the formed buildings hold: offices and a hotel are let or run, so their rents and yields show)
  const has = new Set(e.d.money.uses.map((x) => x.use));
  const setR = (o: Partial<NonNullable<ProProject['rents']>>) => up({ rents: { ...(p.rents ?? {}), ...o } });
  return (
    <>
      {deal.earns && <LandWorthBox p={p} e={e} up={up} />}
      {deal.earns ? <Section title="Result">
        <Lines rows={[['IRR', pct(deal.irr)], ['Margin', pct(deal.margin)], ['Peak funding', cr(deal.peak)], [deal.owner.label, cr(deal.owner.value)]]} />
        <CashChart flow={deal.flow} cum={deal.cum} months={c.months} />
      </Section> : <Section title="Cost" sub="Public buildings only: nothing sold or let, so what it costs to build.">
        <Lines rows={[...outs.filter((l) => l.amount > 0).map((l) => [l.label, cr(l.amount)] as [string, string]), ['Total', cr(deal.cost), 'tot'], ['A m² of built-up', e.d.bua > 0 ? `₹${nf(deal.cost / e.d.bua)}` : '—']]} />
        <CashChart flow={deal.flow} cum={deal.cum} months={c.months} />
      </Section>}

      {deal.uses.length > 0 && <Section title="By use">
        <Lines rows={deal.uses.map((x) => [<span>{x.label}<small>{x.note}</small></span>, x.kind === 'in' ? cr(x.amount) : `${cr(x.amount)} cost`])} />
      </Section>}

      <Section title="Prices">
        <Row>
          {deal.earns && <Num label="Sale price" value={p.sale || c.sale} set={(v) => up({ sale: v })} step={250} min={1000} max={300000} unit="₹/ft²" hint="on carpet" />}
          <Num label="Land price" value={p.land || c.land} set={(v) => up({ land: v })} step={250} min={0} max={1000000} unit="₹/ft²" hint={D.kind === 'outright' ? 'of plot' : 'not paid in this deal'} />
        </Row>
        {has.has('office') && <Row>
          <Num label="Office rent" value={c.officeRent} set={(v) => setR({ officeRent: v })} step={5} min={10} max={2000} unit="₹/ft²" hint="carpet, a month" />
          <Num label="Office yield" value={c.officeYield} set={(v) => setR({ officeYield: v })} step={0.25} min={3} max={20} unit="%" />
        </Row>}
        {has.has('hotel') && <Row>
          <Num label="Hotel operating profit" value={c.hotelNoi} set={(v) => setR({ hotelNoi: v })} step={50} min={100} max={20000} unit="₹/ft²" hint="carpet, a year" />
          <Num label="Hotel yield" value={c.hotelYield} set={(v) => setR({ hotelYield: v })} step={0.25} min={3} max={20} unit="%" />
        </Row>}
        <Lines rows={[['Construction', `₹${nf(c.build)}/ft²`], ['of which finishes and spec', `${e.rate >= 0 ? '+' : '−'}₹${nf(Math.abs(e.rate))}/ft²`], ['Building systems', `${cr(e.sys.cost)} · ₹${nf(e.sys.costPerSqft)}/ft²`]]} />
        <Num label="Build time" value={p.costs?.months ?? c.months} set={(v) => up({ costs: { ...(p.costs ?? {}), months: v } })} min={6} max={96} unit="months" />
        <Row>
          <Num label="Booked by completion" value={p.costs?.presold ?? c.presold} set={(v) => up({ costs: { ...(p.costs ?? {}), presold: v } })} max={100} step={5} unit="%" />
          <Num label="Soft costs" value={p.costs?.soft ?? c.soft} set={(v) => up({ costs: { ...(p.costs ?? {}), soft: v } })} max={60} unit="% of build" />
        </Row>
      </Section>

      <Section title="The deal on the land">
        <Select<DealKind> label="Deal" value={D.kind} onChange={(v) => setD({ kind: v })} options={(Object.keys(DEAL_LABEL) as DealKind[]).map((k) => ({ value: k, label: DEAL_LABEL[k] }))} />
        {(D.kind === 'jda-revenue' || D.kind === 'jda-area') && <Row>
          <Num label={D.kind === 'jda-revenue' ? 'Owner’s share of revenue' : 'Owner’s share of the flats'} value={D.ownerShare} set={(v) => setD({ ownerShare: v })} max={80} unit="%" />
          <Num label="Refundable deposit" value={D.deposit} set={(v) => setD({ deposit: v })} step={0.25} max={500} unit="₹ cr" />
        </Row>}
        {D.kind === 'redevelopment' && <>
          <Row><Num label="Members (existing flats)" value={D.members} set={(v) => setD({ members: v })} min={1} max={2000} /><Num label="Their carpet each" value={D.existingCarpet} set={(v) => setD({ existingCarpet: v })} min={10} max={500} unit="m²" /></Row>
          <Row><Num label="Extra carpet for them" value={D.extraPct} set={(v) => setD({ extraPct: v })} max={200} unit="%" /><Num label="Corpus each" value={D.corpus} set={(v) => setD({ corpus: v })} max={500} unit="₹ lakh" /></Row>
          <Num label="Rent each, a month while it’s built" value={D.rent} set={(v) => setD({ rent: v })} step={1000} max={500000} unit="₹" />
        </>}
        <Row><Num label="GST on sales" value={D.gstPct} set={(v) => setD({ gstPct: v })} max={18} step={1} unit="%" /><Num label="Stamp duty" value={D.stampPct} set={(v) => setD({ stampPct: v })} max={10} step={0.5} unit="%" /></Row>
        {deal.notes.map((n) => <Note>{n}</Note>)}
      </Section>

      <Section title="Statement" fold open={false}>
        <div class="bars">{[...ins, ...outs].filter((l) => l.amount > 0).map((l) => <div class={`bar ${l.kind}`}><span>{l.label}</span><i style={`width:${Math.max(1, (l.amount / total) * 100)}%`} /><b>{cr(l.amount)}</b></div>)}</div>
        <Lines rows={deal.earns ? [['Revenue', cr(deal.revenue), 'tot'], ['Cost', cr(deal.cost), 'tot'], ['Profit', cr(deal.profit), `tot ${deal.profit < 0 ? 'bad' : ''}`], ['GST collected from buyers', cr(deal.gstCollected)], ['Carpet sold', sqft(deal.saleCarpet)], ...(deal.ownerCarpet ? [['Carpet handed over', sqft(deal.ownerCarpet)] as [string, string]] : [])] : [['Cost', cr(deal.cost), 'tot']]} />
      </Section>
    </>
  );
}

/** Monthly net cash as bars, the running total as a line. */
function CashChart({ flow, cum, months }: { flow: number[]; cum: number[]; months: number }) {
  if (!flow.length) return null;
  const W = 300, H = 120, n = flow.length;
  const lo = Math.min(0, ...cum, ...flow), hi = Math.max(0, ...cum, ...flow), y = (v: number) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 24);
  const x = (i: number) => 4 + (i / Math.max(1, n - 1)) * (W - 8), bw = Math.max(1, (W - 8) / n - 1);
  const minAt = cum.indexOf(Math.min(...cum));
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash month by month">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} class="ax" />
        {flow.map((f, i) => <rect x={x(i) - bw / 2} width={bw} y={Math.min(y(0), y(f))} height={Math.abs(y(f) - y(0)) || 0.5} class={f >= 0 ? 'pos' : 'neg'} />)}
        <polyline points={cum.map((v, i) => `${x(i)},${y(v)}`).join(' ')} class="cum" />
        <circle cx={x(minAt)} cy={y(cum[minAt])} r="2.6" class="cum-pt" />
        <line x1={x(months)} x2={x(months)} y1="4" y2={H - 12} class="done" />
        <text x={x(months) - 3} y={H - 16} class="lbl" text-anchor="end">Built</text>
        <text x="4" y={H - 2} class="lbl">Month 0</text><text x={W - 4} y={H - 2} class="lbl" text-anchor="end">{n - 1}</text>
      </svg>
      <figcaption><i class="k-bar" />net cash a month <i class="k-line" />running total</figcaption>
    </figure>
  );
}

// ================================================================ approval
const STATUS_ICON: Record<CheckStatus, string> = { pass: 'check', fail: 'x', warn: 'warn', info: 'info', unchecked: 'minus' };
/** The drawing set and report as a PDF: drawn off screen and saved, with how many sheets it holds. */
export function PdfButton({ p, e, checks, rooms, toast, big }: { p: ProProject; e: Evaluated; checks: Check[]; rooms: FlatRooms[][]; toast: (s: string) => void; big?: boolean }) {
  const [busy, setBusy] = useState(false);
  const n = useMemo(() => sheetDefs({ e, checks, rooms }).length, [e, checks, rooms]);
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try { await downloadSet({ e, checks, rooms }, `${slug(p.name)}-drawings`); toast(`PDF saved: ${n} A3 sheets.`); }
    catch (err) { console.error(err); toast('Could not make the PDF. Try Print instead.'); }
    finally { setBusy(false); }
  };
  if (!big) return <Btn kind="primary" icon="down" onClick={() => void go()} disabled={busy}>{busy ? 'Making the PDF…' : 'Download PDF'}</Btn>;
  return (
    <button type="button" class="export main" onClick={() => void go()} disabled={busy} aria-busy={busy}>
      {busy ? <Dither class="dz" cell={2} /> : <Icon n="down" />}
      <b>{busy ? 'Making the PDF…' : 'Download PDF'}</b>
      <small>{n} A3 sheets: plans, area statement, schedules, scrutiny, NOCs and fees</small>
    </button>
  );
}


export function ApproveStep({ p, e, up, checks, rooms, openDrawings, toast, show }: StepProps) {
  const sum = scrutinySummary(checks);
  const [only, setOnly] = useState<'all' | 'issues'>('issues');
  const ex = p.approval ?? {};
  const kind = permissionOf(e, ex.kind);
  const list = nocs(e, ex), docs = documents(e, kind), fs = fees(e), steps = stages(e, kind);
  const groups = [...new Set(checks.map((c) => c.group))];
  const shown = (c: Check) => only === 'all' || c.status === 'fail' || c.status === 'warn' || c.status === 'unchecked';
  const unchecked = checks.filter((c) => c.status === 'unchecked');
  return (
    <>

      <Section title="Scrutiny" sub="Advisory: the authority's check is the one that counts.">
        {sum.fail + sum.warn + sum.unchecked > 0 && <div class="score">
          <span class="s-pass"><Icon n="check" size={14} />{sum.pass} pass</span>
          {sum.fail > 0 && <span class="s-fail on"><Icon n="x" size={14} />{sum.fail} fail</span>}
          {sum.warn > 0 && <span class="s-warn on"><Icon n="warn" size={14} />{sum.warn} to check</span>}
          {sum.unchecked > 0 && <span class="s-unchecked on"><Icon n="minus" size={14} />{sum.unchecked} not checked</span>}
        </div>}
        {unchecked.length > 0 && <div class="cgroup"><h4>Not checked for its use</h4>{unchecked.map((c) => (
          <details class="chk unchecked">
            <summary><Icon n="minus" size={15} /><span>{c.rule}</span><em>{c.proposed}</em></summary>
            <Lines rows={[...(c.applies ? [['Applies to', c.applies] as [string, string]] : []), ['Required', c.required], ['Clause', c.clause]]} />
            {c.note && <Note>{c.note}</Note>}
          </details>
        ))}</div>}
        {(sum.fail + sum.warn + sum.unchecked > 0 || only === 'all') && <Seg<'all' | 'issues'> small value={only} set={setOnly} options={[{ value: 'issues', label: 'Issues' }, { value: 'all', label: 'Everything' }]} />}
        {groups.map((g) => {
          const cs = checks.filter((c) => c.group === g && shown(c) && c.status !== 'unchecked');
          if (!cs.length) return null;
          return <div class="cgroup"><h4>{g}</h4>{cs.map((c) => (
            <details class={`chk ${c.status}`}>
              <summary><Icon n={STATUS_ICON[c.status]} size={15} /><span>{c.rule}</span><em>{c.proposed}</em></summary>
              <Lines rows={[...(c.applies ? [['Applies to', c.applies] as [string, string]] : []), ['Required', c.required], ['Proposed', c.proposed], ['Clause', c.clause]]} />
              {c.note && <Note>{c.note}</Note>}
              {(() => { const b = e.d.buildings[checkBuilding(c.key) ?? -1]; return b && <button type="button" class="linkbtn show" onClick={() => show(b.b.id)}><Icon n="fit" size={14} />Show {e.d.buildings.length > 1 ? `building ${String.fromCharCode(65 + e.d.buildings.indexOf(b))}` : 'the building'}</button>; })()}
            </details>
          ))}</div>;
        })}
        {only === 'issues' && !sum.fail && !sum.warn && !sum.unchecked && <p class="hint-line"><Icon n="check" size={14} />All {sum.pass} checks pass. <button type="button" class="linkbtn" onClick={() => setOnly('all')}>Show them</button></p>}
      </Section>

      <Section title="Permission" fold open={false} aside={<span class="sec-meta">{PERMISSION_LABEL[kind]}</span>} sub={PERMISSION_HINT[kind]}>
        <Select<PermissionKind> label="Applying for" value={kind} onChange={(v) => up({ approval: { ...ex, kind: v } })} options={(Object.keys(PERMISSION_LABEL) as PermissionKind[]).map((k) => ({ value: k, label: PERMISSION_LABEL[k] }))} />
        <ol class="stages">{steps.map((x) => <li><b>{x.title}</b><small>{x.note}</small></li>)}</ol>
      </Section>

      <Section title="Drawings and report" sub="For an architect to check, sign and submit.">
        <div class="exports">
          <PdfButton p={p} e={e} checks={checks} rooms={rooms} toast={toast} big />
          <div class="export-side">
            <button type="button" class="linkbtn" onClick={openDrawings}><Icon n="print" size={15} />Preview sheets</button>
            <button type="button" class="linkbtn" data-tip="Site plan, floor plans and section on PreDCR’s layers. Opens in AutoCAD and PreDCR." onClick={() => { download(`${slug(p.name)}-predcr.dxf`, predcrDxf(e), 'application/dxf'); toast('DXF saved on PreDCR layers. Open it in PreDCR or AutoCAD, mark stairs, lifts and FSI, then run Verify.'); }}><Icon n="down" size={15} />CAD file (DXF)</button>
          </div>
        </div>
      </Section>

      <Section title="NOCs" fold open={false} aside={<span class="sec-meta">{list.filter((n) => n.needed).length} needed</span>}>
        <Toggle label="Near an airport" hint="Inside the AAI's colour-coded zone" value={!!ex.nearAirport} set={(v) => up({ approval: { ...ex, nearAirport: v } })} />
        <Toggle label="Trees on the plot" value={!!ex.trees} set={(v) => up({ approval: { ...ex, trees: v } })} />
        <Toggle label="Heritage precinct" value={!!ex.heritage} set={(v) => up({ approval: { ...ex, heritage: v } })} />
        <ul class="nocs">{[...list].sort((a, b) => +b.needed - +a.needed).map((n) => (
          <li class={n.needed ? 'on' : ''}><Icon n={n.needed ? 'check' : 'minus'} size={14} /><span><b>{n.title}</b><small>{n.authority} · {n.why}</small></span></li>
        ))}</ul>
      </Section>

      <Section title="Fees and charges" fold open={false} aside={<span class="sec-meta">{cr(fs.reduce((s, f) => s + f.amount, 0))}</span>} sub="Rough figures to plan cash with, not a demand note.">
        <Lines rows={fs.map((f) => [<span>{f.label}<small>{f.basis}</small></span>, cr(f.amount)])} />
      </Section>

      <Section title="Documents to file" fold open={false}>
        <ul class="docs">{docs.map((d) => <li><span class={`who ${d.from}`}>{d.from === 'us' ? 'UrbanPlan' : d.from}</span><span><b>{d.title}</b><small>{d.note}</small></span></li>)}</ul>
      </Section>
    </>
  );
}
