// Compare: two to four of the project's options side by side on the figures every place shows (built-up, homes,
// profit, margin, IRR, peak cash, height, failing checks, departures), the best in each row marked. It ends in
// choosing one to take forward. Each option is worked out afresh (a fraction of a second each).
import { useEffect, useState } from 'preact/hooks';
import { evaluate } from './evaluate';
import { applyDeal, DEFAULT_DEAL } from './deal';
import { scrutiny, scrutinySummary } from './scrutiny';
import type { ProProject } from './project';
import { asOption, optionsOf, type ProOption } from './variants';
import { Btn, Check, cr, Dialog, nf, pct, sqft } from './ui';

interface Col { o: ProOption; bua: number; homes: number; profit: number; margin: number; irr: number | null; peak: number; height: number; fail: number; departures: number }
type Better = 'more' | 'less' | null;
const ROWS: { label: string; key: keyof Omit<Col, 'o'>; fmt: (v: number | null) => string; better: Better }[] = [
  { label: 'Built-up', key: 'bua', fmt: (v) => sqft(v ?? 0), better: 'more' },
  { label: 'Homes', key: 'homes', fmt: (v) => nf(v ?? 0), better: 'more' },
  { label: 'Profit', key: 'profit', fmt: (v) => cr(v ?? 0), better: 'more' },
  { label: 'Margin', key: 'margin', fmt: (v) => pct(v), better: 'more' },
  { label: 'IRR', key: 'irr', fmt: (v) => pct(v), better: 'more' },
  { label: 'Peak cash', key: 'peak', fmt: (v) => cr(v ?? 0), better: 'less' },
  { label: 'Height', key: 'height', fmt: (v) => `${nf(v ?? 0, 1)} m`, better: null },
  { label: 'Failing checks', key: 'fail', fmt: (v) => nf(v ?? 0), better: 'less' },
  { label: 'Departures', key: 'departures', fmt: (v) => nf(v ?? 0), better: 'less' },
];

function work(p: ProProject, o: ProOption): Col {
  const e = evaluate(asOption(p, o.id)), deal = applyDeal(e, e.p.deal ?? DEFAULT_DEAL), sum = scrutinySummary(scrutiny(e));
  return { o, bua: e.d.bua, homes: e.d.flats, profit: deal.profit, margin: deal.margin, irr: deal.irr, peak: deal.peak, height: e.d.height, fail: sum.fail, departures: e.d.departures.length };
}

export function Compare({ p, close, go, choose }: { p: ProProject; close: () => void; go: (id: string) => void; choose?: (id: string) => void }) {
  const all = optionsOf(p);
  const [ids, setIds] = useState<string[]>(() => all.slice(0, 4).map((o) => o.id));
  const [cols, setCols] = useState<Col[] | null>(null);
  useEffect(() => {
    setCols(null);
    const t = setTimeout(() => setCols(all.filter((o) => ids.includes(o.id)).map((o) => work(p, o))), 30);
    return () => clearTimeout(t);
  }, [ids.join(','), p]);
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 4 ? x : [...x, id]));
  const best = (key: keyof Omit<Col, 'o'>, b: Better) => {
    if (!cols || cols.length < 2 || !b) return null;
    const vs = cols.map((c) => c[key] as number | null).filter((v): v is number => v !== null);
    if (!vs.length || vs.every((v) => v === vs[0])) return null;
    return b === 'more' ? Math.max(...vs) : Math.min(...vs);
  };
  return (
    <Dialog title="Compare options" close={close} wide>
      <div class="cmp-pick" role="group" aria-label="Options to compare (up to four)">
        {all.map((o) => <Check label={o.name} value={ids.includes(o.id)} disabled={!ids.includes(o.id) && ids.length >= 4} set={() => toggle(o.id)} />)}
      </div>
      {ids.length < 2 && <p class="note">Pick two to four options.</p>}
      {!cols && ids.length >= 2 && <p class="note">Working out each option…</p>}
      {cols && cols.length >= 2 && (
        <div class="cmp-wrap">
          <table class="cmp">
            <thead><tr><th />{cols.map((c) => (
              <th>
                <b>{c.o.name}</b>
                <small>{c.o.made}{c.o.id === p.option ? ' · open' : ''}{c.o.id === p.chosen ? ' · chosen' : ''}</small>
              </th>
            ))}</tr></thead>
            <tbody>
              {ROWS.map((r) => { const b = best(r.key, r.better); return (
                <tr><th scope="row">{r.label}</th>{cols.map((c) => { const v = c[r.key] as number | null; return <td class={b !== null && v === b ? 'best' : ''}>{r.fmt(v)}</td>; })}</tr>
              ); })}
              <tr><th />{cols.map((c) => (
                <td class="cmp-act">
                  {c.o.id !== p.option && <Btn kind="quiet" onClick={() => { go(c.o.id); close(); }}>Open it</Btn>}
                  {choose && c.o.id !== p.chosen && <Btn kind="quiet" icon="check" title="Choose this option to take forward" onClick={() => choose(c.o.id)}>Choose</Btn>}
                </td>
              ))}</tr>
            </tbody>
          </table>
        </div>
      )}
      <p class="hint-line">Underlined: the best in its row. The plot, rules, prices and deal are the same for every option.</p>
    </Dialog>
  );
}
