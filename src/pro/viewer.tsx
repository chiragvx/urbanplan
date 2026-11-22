// Pro on a phone: a viewer (docs/plans/mobile-view-only.md). Four sheets in place of the six editing steps:
// - Overview: the plot, what's built on it, the design system;
// - Money: what it sells for, costs and makes;
// - Rules: the scrutiny, each check about one building with a Show;
// - Share (./shareSheet.tsx);
// and a tapped building's card. Nothing here changes the project.
import { useState } from 'preact/hooks';
import type { Evaluated } from './evaluate';
import type { DealResult } from './deal';
import { USE_LABEL } from './deal';
import type { ProProject } from './project';
import { CITIES } from './project';
import type { Check, CheckStatus } from './scrutiny';
import { scrutinySummary } from './scrutiny';
import { UNIT_LABEL, UNIT_COLOR } from '../doc/site';
import { cr, Icon, Lines, nf, pct, Section, Seg, sqft } from './ui';

export type ViewStep = 'overview' | 'money' | 'rules' | 'share';
export const VIEW_STEPS: { key: ViewStep; label: string; icon: string; title: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'building', title: 'Overview' },
  { key: 'money', label: 'Money', icon: 'money', title: 'Money' },
  { key: 'rules', label: 'Rules', icon: 'shield', title: 'Rules' },
  { key: 'share', label: 'Share', icon: 'share', title: 'Share' },
];
/** where an editing step's link lands on a phone (a result bar figure, a check) */
export const VIEW_OF: Record<string, ViewStep> = { site: 'overview', design: 'overview', build: 'overview', explore: 'overview', money: 'money', approve: 'rules' };

const STATUS_ICON: Record<CheckStatus, string> = { pass: 'check', fail: 'x', warn: 'warn', info: 'info' };
const m = (v: number) => `${nf(v, v < 10 ? 1 : 0)} m`;
const letter = (i: number) => String.fromCharCode(65 + i);

/** a building's name: its own, else A, B, C… in order */
export const buildingName = (p: ProProject, e: Evaluated, i: number) =>
  (p.scheme?.buildings.find((b) => b.id === e.d.buildings[i]?.b.id) as { name?: string } | undefined)?.name ?? `Building ${letter(i)}`;

/** the building a check is about, from its key (height:2, margins:0 …), or null for the whole scheme's */
export const checkBuilding = (key: string): number | null => { const x = /^(height|margins|transfers|cantilever|mixed|fire-access):(\d+)$/.exec(key); return x ? +x[2] : null; };

export function Overview({ p, e }: { p: ProProject; e: Evaluated }) {
  const { r, d } = e, city = CITIES.find((c) => c.value === p.city);
  const homes = [0, 1, 2].map((t) => d.buildings.reduce((s, b) => s + b.perFloor[t] * b.floors, 0));
  const ds = e.ds as unknown as { name?: string; facade?: { wall?: string; wallName?: string; accent?: string; accentName?: string; base?: string } };
  return (
    <>
      <Section title="The plot">
        <Lines rows={[
          ['Area', `${nf(r.area)} m² · ${sqft(r.area)}`],
          ['Road in front', r.road ? m(r.roadW) : 'none'],
          ['Authority', city?.label ?? p.city],
          ['Allowed', `${sqft(r.bua)} · FSI ${nf(r.fsi, 2)}`],
        ]} />
      </Section>
      <Section title="What's built">
        <Lines rows={[
          ['Built-up', `${sqft(d.bua)} · ${pct(r.bua > 0 ? d.bua / r.bua : 0, 0)} of what's allowed`],
          ['Buildings', `${d.buildings.length} · ${d.buildings.map((b) => b.floors).join(' + ') || 0} floors`],
          ['Tallest', m(d.height)],
          ['Homes', `${d.flats}${e.shops ? ` and ${e.shops.count} shops` : ''}`],
        ]} />
        {d.flats > 0 && <div class="vmix" role="img" aria-label={homes.map((n, t) => `${n} ${UNIT_LABEL[t]}`).join(', ')}>
          {homes.map((n, t) => n > 0 && <span style={`flex:${n};background:${UNIT_COLOR[t]}`}><b>{n}</b> {UNIT_LABEL[t]}</span>)}
        </div>}
      </Section>
      {ds?.name && <Section title="Design system">
        <p class="vds">{ds.facade && <span class="sw">{[ds.facade.wall, ds.facade.accent, ds.facade.base].filter(Boolean).map((c) => <i style={`background:${c}`} />)}</span>}<b>{ds.name}</b></p>
        {ds.facade?.wallName && <p class="hint-line">{ds.facade.wallName}{ds.facade.accentName ? ` · ${ds.facade.accentName}` : ''}</p>}
      </Section>}
    </>
  );
}

export function MoneyView({ e, deal }: { e: Evaluated; deal: DealResult }) {
  if (!deal.earns) return <Section title="Cost"><Lines rows={[['To build', cr(e.d.money.cost)], ['Per m² built-up', e.d.bua > 0 ? `₹${nf((e.d.money.build + e.d.money.parking + e.d.money.soft) / e.d.bua)}` : '—']]} /><p class="hint-line">A public scheme: nothing is sold.</p></Section>;
  return (
    <>
      <Section title="Result">
        <Lines rows={[
          ['Profit', <b class={deal.profit < 0 ? 'bad' : ''}>{cr(deal.profit)}</b>],
          ['Margin', pct(deal.margin)],
          ['IRR', pct(deal.irr)],
          ['Peak cash needed', cr(deal.peak)],
          ['Sales', cr(deal.revenue)],
          ['Costs', cr(deal.cost)],
        ]} />
      </Section>
      {deal.uses.length > 1 && <Section title="By use"><Lines rows={deal.uses.map((u) => [u.label, `${u.kind === 'out' ? '−' : ''}${cr(Math.abs(u.amount))}`] as [string, string])} /></Section>}
      <Section title="In and out"><Lines rows={deal.lines.map((l) => [l.label, `${l.kind === 'out' ? '−' : ''}${cr(Math.abs(l.amount))}`] as [string, string])} /></Section>
      {deal.owner.value !== 0 && <Section title={deal.owner.label}><Lines rows={[['Value', cr(deal.owner.value)]]} /><p class="hint-line">{deal.owner.note}</p></Section>}
    </>
  );
}

export function RulesView({ e, checks, show }: { e: Evaluated; checks: Check[]; show: (id: string) => void }) {
  const sum = scrutinySummary(checks);
  const [only, setOnly] = useState<'issues' | 'all'>(sum.fail + sum.warn ? 'issues' : 'all');
  const shown = checks.filter((c) => only === 'all' || c.status === 'fail' || c.status === 'warn');
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <Section title="Scrutiny" sub="Advisory: the authority's check is the one that counts.">
      <div class="score">
        <span class="s-pass"><Icon n="check" size={14} />{sum.pass} pass</span>
        {sum.fail > 0 && <span class="s-fail on"><Icon n="x" size={14} />{sum.fail} fail</span>}
        {sum.warn > 0 && <span class="s-warn on"><Icon n="warn" size={14} />{sum.warn} to check</span>}
      </div>
      <Seg<'all' | 'issues'> small value={only} set={setOnly} options={[{ value: 'issues', label: 'Issues' }, { value: 'all', label: 'Everything' }]} />
      {groups.map((g) => <div class="cgroup"><h4>{g}</h4>{shown.filter((c) => c.group === g).map((c) => {
        const b = e.d.buildings[checkBuilding(c.key) ?? -1];
        return <details class={`chk ${c.status}`}>
          <summary><Icon n={STATUS_ICON[c.status]} size={15} /><span>{c.rule}</span><em>{c.proposed}</em></summary>
          <Lines rows={[['Required', c.required], ['Proposed', c.proposed], ['Clause', c.clause]]} />
          {c.note && <p class="note">{c.note}</p>}
          {b && <button type="button" class="linkbtn show" onClick={() => show(b.b.id)}><Icon n="fit" size={14} />Show {e.d.buildings.length > 1 ? `building ${letter(e.d.buildings.indexOf(b))}` : 'the building'}</button>}
        </details>;
      })}</div>)}
      {!shown.length && <p class="hint-line"><Icon n="check" size={14} />All {sum.pass} checks pass.</p>}
    </Section>
  );
}

/** a tapped building: what it is, its homes and uses, its rules; X-ray it */
export function BuildingInfo({ p, e, id, checks, xray }: { p: ProProject; e: Evaluated; id: string; checks: Check[]; xray: (floor: number) => void }) {
  const i = e.d.buildings.findIndex((b) => b.b.id === id), br = e.d.buildings[i];
  if (!br) return null;
  const homes = [0, 1, 2].map((t) => br.perFloor[t] * br.floors);
  const bua = br.laid ? br.laid.floors.reduce((s, f) => s + f.area, 0) : br.plate * br.floors;
  // (a formed building's floors by use, in runs from the ground up)
  const runs: { use: string; from: number; to: number }[] = [];
  br.laid?.floors.forEach((f, k) => { const u = f.kind ?? 'residential', last = runs[runs.length - 1]; if (last && last.use === u) last.to = k + 1; else runs.push({ use: u, from: k + 1, to: k + 1 }); });
  const mine = checks.filter((c) => checkBuilding(c.key) === i && c.status !== 'pass' && c.status !== 'info');
  return (
    <>
      <Lines rows={[
        ['Floors', `${br.floors} · ${m(br.height)}`],
        ['Built-up', sqft(bua)],
        ['Homes', `${homes.reduce((a, b) => a + b, 0)}${homes.some(Boolean) ? ` (${homes.map((n, t) => (n ? `${n} ${UNIT_LABEL[t]}` : '')).filter(Boolean).join(', ')})` : ''}`],
      ]} />
      {runs.length > 1 && <Section title="Floors by use">
        <ul class="vruns">{runs.slice().reverse().map((r) => <li><button type="button" class="linkbtn" onClick={() => xray(r.from)}>{USE_LABEL[r.use as keyof typeof USE_LABEL] ?? r.use}</button><span>{r.from === r.to ? `floor ${r.from}` : `floors ${r.from}–${r.to}`}</span></li>)}</ul>
      </Section>}
      <Section title="Rules">
        {mine.length ? mine.map((c) => <p class={`vchk ${c.status}`}><Icon n={STATUS_ICON[c.status]} size={14} /><span><b>{c.rule}</b> {c.proposed}</span></p>)
          : <p class="hint-line"><Icon n="check" size={14} />Nothing flagged for {buildingName(p, e, i)}.</p>}
      </Section>
      <button type="button" class="btn" onClick={() => xray(Math.max(1, Math.round(br.floors / 2)))}><Icon n="layers" size={16} />X-ray it</button>
    </>
  );
}
