// The four places on the rail, each a question: Brief (what's given, what do I want?), Design (what's the scheme?),
// Numbers (is it worth it?), Approval (will it pass, what do I file?). They're made from the old steps' sections:
// the Site and Scheme sections split between Brief and Design (their `part`), Explore under Brief, the design
// system behind Design › Look, the area statement ahead of the money. See docs/plans/pro-global-ux.md §A.4.
import type { ComponentChildren } from 'preact';
import { SchemeStep, SiteStep2 } from './sitePanels';
import { ExploreStep, MoneyStep, type StepProps } from './steps';
import { Elevation } from './designStep';
import { AreaStatementBody } from './numbersUi';
import { Btn, cr, nf, Section } from './ui';
import { inventory, sizesOf } from './floor';
import { findIn } from './search';
import { SQFT, UNIT_LABEL } from '../doc/site';

/** a heading over a run of sections: what part of the question they answer */
const Part = ({ children }: { children: ComponentChildren }) => <h3 class="place-h">{children}</h3>;

export function BriefPlace(props: StepProps) {
  return (
    <>
      <Part>The site gives</Part>
      <SiteStep2 {...props} part="brief" />
      <Part>You want</Part>
      <SchemeStep {...props} part="brief" />
      <Part>Make options from it</Part>
      <ExploreStep {...props} />
    </>
  );
}

export function DesignPlace(props: StepProps) {
  const { e, openLook } = props;
  return (
    <>
      <SiteStep2 {...props} part="design" />
      <SchemeStep {...props} part="design" />
      <Section title="Look" aside={<span class="sec-meta">{e.ds.name}</span>} sub="The design system: facade, windows, floors, finishes, the site’s walls and landscape.">
        <figure class="dss-prev look"><Elevation ds={e.ds} /></figure>
        {openLook && <Btn icon="palette" onClick={openLook}>Open the design system</Btn>}
      </Section>
    </>
  );
}

/** Every flat, by building and type: how many, their carpet, and what they sell for at the sale price. The sizes are
 *  set in Brief (or a building's own, in the inspector). */
function Inventory({ p, e, go, show }: StepProps) {
  const rows = inventory(e), sizes = sizesOf(p);
  const name = (i: number) => p.scheme?.buildings.find((b) => b.id === e.d.buildings[i].b.id)?.name ?? `Building ${String.fromCharCode(65 + i)}`;
  const tot = rows.reduce((a, x) => ({ n: a.n + x.n, carpet: a.carpet + x.carpet, value: a.value + x.value }), { n: 0, carpet: 0, value: 0 });
  return (
    <Section title="Inventory" fold open={false} aside={<span class="sec-meta">{tot.n} flats · {cr(tot.value)}</span>} sub="Every flat by building and type, at the sale price.">
      {rows.length ? <table class="astmt inv">
        <thead><tr><th>Building</th><th>Type</th><th>Flats</th><th>Carpet each</th><th>Value</th></tr></thead>
        <tbody>
          {rows.map((x, k) => (
            <tr>
              <td>{k === 0 || rows[k - 1].building !== x.building ? <button type="button" class="linkbtn" onClick={() => show(e.d.buildings[x.building].b.id)}>{name(x.building)}</button> : ''}</td>
              <td>{UNIT_LABEL[x.t]}</td><td>{x.n}</td>
              <td>{nf((x.carpet / x.n) * SQFT, 0)} sq ft</td>
              <td>{cr(x.value)}</td>
            </tr>
          ))}
          <tr class="tot"><td>All</td><td /><td>{tot.n}</td><td>{nf(tot.n ? (tot.carpet / tot.n) * SQFT : 0, 0)} sq ft</td><td>{cr(tot.value)}</td></tr>
        </tbody>
      </table> : <p class="note">No flats laid out.</p>}
      <p class="hint-line">Sizes asked: {[0, 1, 2].map((t) => `${UNIT_LABEL[t]} ${nf(sizes[t] * SQFT, 0)}`).join(' · ')} sq ft carpet. <button type="button" class="linkbtn" onClick={() => { go('brief'); findIn('Flat sizes'); }}>Change them</button></p>
    </Section>
  );
}

export function NumbersPlace(props: StepProps) {
  const { e, show, openDrawings } = props;
  return (
    <>
      <Section title="Area statement" sub="Permissible against proposed, building by building: the same rows the drawing set prints.">
        <AreaStatementBody e={e} show={(bi) => { const id = e.d.buildings[bi]?.b.id; if (id) show(id); }} print={openDrawings} />
      </Section>
      <Inventory {...props} />
      <MoneyStep {...props} />
    </>
  );
}
