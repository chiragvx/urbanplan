// The four places on the rail, each a question: Brief (what's given, what do I want?), Design (what's the scheme?),
// Numbers (is it worth it?), Approval (will it pass, what do I file?). They're made from the old steps' sections:
// the Site and Scheme sections split between Brief and Design (their `part`), Explore under Brief, the design
// system behind Design › Look, the area statement ahead of the money. See docs/plans/pro-global-ux.md §A.4.
import type { ComponentChildren } from 'preact';
import { SchemeStep, SiteStep2 } from './sitePanels';
import { ExploreStep, MoneyStep, type StepProps } from './steps';
import { Elevation } from './designStep';
import { AreaStatementBody } from './numbersUi';
import { Btn, Section } from './ui';

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

export function NumbersPlace(props: StepProps) {
  const { e, show, openDrawings } = props;
  return (
    <>
      <Section title="Area statement" sub="Permissible against proposed, building by building: the same rows the drawing set prints.">
        <AreaStatementBody e={e} show={(bi) => { const id = e.d.buildings[bi]?.b.id; if (id) show(id); }} print={openDrawings} />
      </Section>
      <MoneyStep {...props} />
    </>
  );
}
