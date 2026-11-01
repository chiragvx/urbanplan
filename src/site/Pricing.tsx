// Pricing: free during the beta; Pro and Firm are announced, not sold yet (no prices until they ship).
import { APP, href, Icon, Page } from './ui';

const PLANS = [
  {
    name: 'Free', price: '₹0', per: 'during the beta', cta: 'Open the editor', to: APP, feature: false,
    items: ['Pune and Mumbai, 2D and 3D', 'Every road and terrain tool', 'DP sheets and zones', 'Publish, fork, GeoJSON'],
  },
  {
    name: 'Pro', price: 'Soon', per: 'for professionals', cta: 'Get early access', to: href('signup/?plan=pro'), feature: true,
    items: ['Everything in Free', 'Maps saved to your account', 'Plot sandbox: FSI and height', 'Exports: glTF, OBJ, DXF, STL', 'Satellite imagery', 'Analysis credits'],
  },
  {
    name: 'Firm', price: 'Soon', per: 'for teams', cta: 'Join the list', to: href('signup/?plan=firm'), feature: false,
    items: ['Everything in Pro', 'Shared workspace', 'Branded site reports', 'Screen many plots', 'API access'],
  },
];

const FAQ: [string, string][] = [
  ['Is it really free?', 'Yes. Everything in the editor today is free during the beta, and it keeps working without an account. Paid plans will add things that cost us money to run: storage, exports, imagery and analysis.'],
  ['Which cities does it cover?', 'Pune and Pimpri-Chinchwad (PMC and PCMC), and Mumbai (MCGM, Colaba to Dahisar and Mulund). The Development Plan layer covers Pune’s sanctioned DP for the old city limits.'],
  ['Can I rely on it for a purchase or an approval?', 'No. UrbanPlan is a survey aid and a design tool. The DP layer is traced from scanned sheets and lined up to within a few metres; it is not a DP remark, a zone certificate or legal boundary. Always check with the planning authority and a licensed architect.'],
  ['Where does the data come from?', 'Roads and buildings from OpenStreetMap, terrain from the Copernicus GLO-30 elevation model, and the Development Plan from Pune Municipal Corporation’s published sheets. Every layer says where it came from in the editor.'],
  ['Do my maps leave my browser?', 'Not unless you publish or export them. Today maps are saved in your browser. An account stores your email and profile; saving maps to your account comes with Pro.'],
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
                <a class="btn btn-ink btn-block" href={p.to}>{p.cta}</a>
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
