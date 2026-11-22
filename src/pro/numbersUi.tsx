// The numbers the land team, the architect and the liaison share: the FSI ladder (what the plot permits, part by
// part, and whether each paid part is worth it), what the land is worth, and the area statement.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { defaultCosts, SQFT } from '../doc/site';
import { areaStatement } from './areaStatement';
import { DEFAULT_DEAL, landWorth } from './deal';
import type { Evaluated } from './evaluate';
import { ladder, ladderGains } from './ladder';
import { loadOf, targetOf, type Load, type ProProject } from './project';
import { Btn, Check, cr, Icon, nf, Note, Num, Row, Section, Seg } from './ui';

type Up = (o: Partial<ProProject>) => void;

/** The FSI ladder: basic, premium, TDR, ancillary; each paid part taken or left, with its area, cost and gain. */
export function LadderBox({ p, e, up, openStatement }: { p: ProProject; e: Evaluated; up: Up; openStatement?: () => void }) {
  const rungs = ladder(e), ld = loadOf(p);
  const [gains, setGains] = useState<Partial<Record<keyof Load, number>>>({});
  // (what each part adds is three more evaluations: worked out once the project settles, a part at a time)
  // (buildings placed by hand don't change with the ladder, so what a part adds isn't theirs to show)
  const own = !!p.scheme, key = own ? '' : JSON.stringify(p);
  useEffect(() => {
    setGains({});
    if (own) return;
    let stop: (() => void) | null = null;
    const t = setTimeout(() => { stop = ladderGains(p, (k, g) => setGains((x) => ({ ...x, [k]: g }))); }, 450);
    return () => { clearTimeout(t); stop?.(); };
  }, [key]);
  const set = (k: keyof Load, v: boolean) => up({ load: { ...ld, [k]: v } });
  return (
    <Section title="What the plot permits" sub={`On a ${nf(e.r.roadW)} m road${e.r.roadW !== (e.r.road?.today ?? e.r.roadW) ? ' (the DP width)' : ''}. Take each paid part, or leave it.`}>
      <ol class="ladder">{rungs.map((x) => {
        const g = x.fixed ? undefined : gains[x.key as keyof Load];
        const name = <b>{x.label}{x.fsi ? ` ${x.fsi}` : ''}</b>;
        return (
          <li class={x.taken ? '' : 'off'}>
            <div class="rung-t">
              {x.fixed ? <span class="rung-fixed"><Icon n="check" size={14} />{name}</span> : <Check value={x.taken} set={(v) => set(x.key as keyof Load, v)} label={name} />}
              <span class="n">{nf(x.area * SQFT)} sq ft</span>
            </div>
            <small class="rung-s">{x.sub}</small>
            <div class="rung-m">
              <span>{x.rate ? `${cr(x.cost)} · ₹${nf(x.rate)}/sq ft` : 'free'}</span>
              {!x.fixed && !own && <span class="n">{g === undefined ? <span class="muted">working out…</span> : <>{x.taken ? 'adds' : 'would add'} <b class={g < 0 ? 'bad' : ''}>{g < 0 ? '−' : '+'}{cr(Math.abs(g))}</b></>}</span>}
            </div>
          </li>
        );
      })}
        <li class="rung-tot">
          <div class="rung-t"><b>Permissible, as taken</b><span class="n"><b>{nf(e.r.bua * SQFT)} sq ft</b></span></div>
          <div class="rung-m"><span>FSI {nf(e.r.area ? e.r.bua / e.r.area : 0, 2)} of {nf(e.full.area ? e.full.bua / e.full.area : 0, 2)} · paid parts {cr(rungs.reduce((s, x) => s + (x.taken ? x.cost : 0), 0))} if all used</span></div>
        </li>
      </ol>
      {own && <Note>Your buildings are placed by hand, so the ladder doesn’t change them: it sets what’s permissible, and a part left out shows as over the FSI if they need it. What each part adds is worked out when Fill the plot lays the scheme out.</Note>}
      <Row>
        <span class="muted small">Height limit {nf(e.r.rules.maxH)} m{e.r.limit === 'height' ? ' (what stops it)' : ''} · margins {nf(e.r.rules.front, 1)} m front, {nf(e.r.side, 1)} m sides{e.r.lost > 0.5 ? ` · ${nf(e.r.lost)} m² lost to DP roads` : ''}</span>
        {openStatement && <Btn kind="quiet" icon="book" onClick={openStatement}>Area statement</Btn>}
      </Row>
    </Section>
  );
}

/** What the land is worth: the most to pay for it outright, and the largest revenue share a landowner can be given,
 *  for a target margin or IRR. */
export function LandWorthBox({ p, e, up }: { p: ProProject; e: Evaluated; up: Up }) {
  const T = targetOf(p), deal = p.deal ?? DEFAULT_DEAL;
  const w = useMemo(() => landWorth(e, deal, T), [e, JSON.stringify(deal), T.by, T.v]);
  const plotSqft = e.r.area * SQFT, put = p.land || defaultCosts(e.r.code, 'residential').land;
  return (
    <Section title="What the land is worth" sub="The most you can pay and still make your target, with this scheme, its prices and its costs.">
      <Row>
        <Seg<'margin' | 'irr'> small value={T.by} set={(by) => up({ target: { by, v: by === T.by ? T.v : by === 'irr' ? 0.18 : 0.2 } })} options={[{ value: 'margin', label: 'Margin' }, { value: 'irr', label: 'IRR' }]} ariaLabel="Target by" />
        <Num label={T.by === 'margin' ? 'Target margin' : 'Target IRR'} value={Math.round(T.v * 100)} set={(v) => up({ target: { by: T.by, v: v / 100 } })} min={0} max={80} unit="%" />
      </Row>
      <div class="worth">
        <div><span>Bought outright</span>{w.outright === null ? <b class="bad">Not at any price</b> : <b>up to {cr(w.outright)}</b>}
          <small>{w.outright === null ? `Even free land doesn’t make ${nf(T.v * 100)}%.` : `₹${nf(w.outright / Math.max(1, plotSqft))} per sq ft of plot · you’ve put in ₹${nf(put)}${p.land ? '' : ' (the city’s starting figure)'}`}</small></div>
        <div><span>Joint development</span>{w.share === null ? <b class="bad">No share works</b> : <b>up to {nf(w.share, 1)}% of revenue</b>}
          <small>{w.share === null ? 'Not even with nothing to the owner.' : 'to the landowner, as the sales come in'}</small></div>
      </div>
    </Section>
  );
}

/** The area statement, live: the rows the drawing set prints, with each limit checked. */
export function AreaStatementBody({ e, show, print }: { e: Evaluated; show?: (bi: number) => void; print?: () => void }) {
  const rows = areaStatement(e);
  return (
    <div class="astmt">
      <table>
        <tbody>{rows.map((x) => x.k === 'h'
          ? <tr class="h"><th colSpan={3}>{x.label}</th></tr>
          : <tr class={`${x.k === 't' ? 't' : ''}${x.tone === 'off' ? ' off' : ''}`}>
            <td>{x.building !== undefined && show ? <button type="button" class="linkbtn" onClick={() => show(x.building!)}>{x.label}</button> : x.label}</td>
            <td class="n">{x.value}</td>
            <td class="s">{x.tone === 'ok' ? <span class="ok" title="Within the limit"><Icon n="check" size={14} /></span> : x.tone === 'bad' ? <span class="bad" title="Over the limit"><Icon n="x" size={14} /></span> : null}</td>
          </tr>)}</tbody>
      </table>
      {print && <Row><span class="muted small">The drawing set prints these same rows.</span><Btn icon="print" onClick={print}>Drawing set</Btn></Row>}
    </div>
  );
}
