// Pricing: free during the beta; Pro and Firm are announced, not sold yet (no prices until they ship).
import { href, Icon, Page, StartLink } from './ui';
import { SITE_NAME } from './brand';

const PLANS = [
  {
    name: 'Beta', price: '₹0', per: 'while in beta', cta: 'Start a project', to: '', feature: true,
    items: ['Pro: plot to scheme in 3D, any building shape', 'UDCPR and DCPR 2034, checked live', 'Money: cost, profit, IRR, cash flow', 'Drawings, report, IFC and PreDCR DXF', 'Projects saved to your account, shared with your team'],
  },
  {
    name: 'Pro', price: 'Soon', per: 'for professionals', cta: 'Get early access', to: href('signup/?plan=pro'), feature: false,
    items: ['Everything in the beta', 'Plots by survey number across Maharashtra', 'Unlimited options and screening', 'Branded reports'],
  },
  {
    name: 'Firm', price: 'Soon', per: 'for teams', cta: 'Join the list', to: href('signup/?plan=firm'), feature: false,
    items: ['Everything in Pro', 'A shared workspace and roles', 'Your own design systems for every project', 'API access'],
  },
];

const FAQ: [string, string][] = [
  ['Is it really free?', `Yes, during the beta. ${SITE_NAME} Pro works without an account too: your projects are kept in your browser. Paid plans will add what costs us to run at scale: storage, plot lookups, screening and exports.`],
  ['Which cities does it cover?', 'The rules of Pune (UDCPR 2020, including the old city) and Mumbai (DCPR 2034, suburbs and island city). Plot lookup by survey or CTS number works across Maharashtra. Anywhere else, draw the plot and pick the closest rules.'],
  ['Can I rely on it for a purchase or an approval?', `No. ${SITE_NAME} is a planning aid. Its figures follow the regulations as written, but plots, roads and the DP are traced from public sources. Always check with the planning authority and a licensed architect before you buy, design or apply.`],
  ['Where does the data come from?', 'Plots from the state’s land records map, roads and buildings from OpenStreetMap, terrain from the Copernicus GLO-30 elevation model, and the Development Plan from Pune Municipal Corporation’s published sheets.'],
  ['Who sees my projects?', 'Only you, until you share one. Projects saved to your account are private to you and the people you invite.'],
];

export function Pricing() {
  return (
    <Page current="pricing/">
      <section class="section">
        <div class="wrap" style="display:grid;gap:var(--up-space-8)">
          <div class="section-head center" style="margin-bottom:0">
            <h1 style="font-size:var(--up-text-3xl)">Free while in beta.</h1>
            <p>Prices before anyone pays.</p>
          </div>
          <div class="plans">
            {PLANS.map((p) => (
              <article class={`plan ${p.feature ? 'feature' : ''}`} key={p.name}>
                <h2>{p.name}</h2>
                <div class="price">{p.price}<small>{p.per}</small></div>
                <ul>{p.items.map((i) => <li key={i}><Icon.check />{i}</li>)}</ul>
                {p.to ? <a class="btn btn-ink btn-block" href={p.to}>{p.cta}</a> : <StartLink class="btn btn-ink btn-block">{p.cta}</StartLink>}
              </article>
            ))}
          </div>
          <div style="display:grid;gap:var(--up-space-5)">
            <h2 style="text-align:center;font-size:var(--up-text-2xl)">Questions</h2>
            <div class="faq">
              {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
            </div>
          </div>
        </div>
      </section>
    </Page>
  );
}
