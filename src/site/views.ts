// What each page of the website renders, by its path: the one thing the browser needs to hydrate a page
// (src/site/main.tsx). It holds no data: each page's module looks its place, guide or city up itself, so a page
// loads its own words and numbers only. src/site/routes.ts lists the pages and their <head>; the build renders each
// through here too (src/site/prerender.ts).
import { h, type FunctionComponent, type VNode } from 'preact';

type View = () => Promise<VNode<any>>;
const el = <P extends object>(C: FunctionComponent<P>, props: P) => h(C as FunctionComponent<any>, props) as VNode<any>;
const DPR = /^pune\/dp-report\/([a-z0-9-]+)\/$/;
const CITY = /^(pune|mumbai)\/$/, PLACE = /^(pune|mumbai)\/([a-z0-9-]+)\/$/, GUIDE = /^guides\/([a-z0-9-]+)\/$/;
const TEMPLATE = /^templates\/([a-z0-9-]+)\/$/, RULES = /^coverage\/([a-z0-9-]+)\/$/;

/** The view for a site path ('' is the landing page, '404' the not-found page); null for paths without one (the editor). */
export function viewOf(path: string): View | null {
  switch (path) {
    case '': return () => import('./Landing').then((m) => el(m.Landing, {}));
    case 'app/': return null;
    case '404': return () => import('./NotFound').then((m) => el(m.NotFound, {}));
    case 'pricing/': return () => import('./Pricing').then((m) => el(m.Pricing, {}));
    case 'guides/': return () => import('./Guide').then((m) => el(m.GuidesIndex, {}));
    case 'terms/': return () => import('./Legal').then((m) => el(m.Terms, {}));
    case 'privacy/': return () => import('./Legal').then((m) => el(m.Privacy, {}));
    case 'login/': return () => import('./AuthPages').then((m) => el(m.Login, {}));
    case 'signup/': return () => import('./AuthPages').then((m) => el(m.Signup, {}));
    case 'forgot/': return () => import('./AuthPages').then((m) => el(m.Forgot, {}));
    case 'reset/': return () => import('./AuthPages').then((m) => el(m.Reset, {}));
    case 'account/': return () => import('./Account').then((m) => el(m.Account, {}));
    case 'data/': return () => import('./CityMap').then((m) => el(m.DataPage, {}));
    case 'pune/map/': case 'mumbai/map/': return () => import('./CityMap').then((m) => el(m.MapPage, { city: path.split('/')[0] as 'pune' | 'mumbai' }));
    case 'pune/road-width-map/': case 'mumbai/road-width-map/': return () => import('./CityMap').then((m) => el(m.WidthMapPage, { city: path.split('/')[0] as 'pune' | 'mumbai' }));
    case 'pune/dp-report/': return () => import('./DpReport').then((m) => el(m.DpHubPage, {}));
    case 'pune/dp-report/report/': return () => import('./DpReportPage').then((m) => el(m.DpReportPage, {}));
    case 'pune/fsi-calculator/': case 'mumbai/fsi-calculator/': return () => import('./FsiPages').then((m) => el(m.FsiCalculatorPage, { city: path.split('/')[0] as 'pune' | 'mumbai' }));
    case 'pune/fsi-map/': case 'mumbai/fsi-map/': return () => import('./FsiPages').then((m) => el(m.FsiMapPage, { city: path.split('/')[0] as 'pune' | 'mumbai' }));
    case 'pune/dp-map/': return () => import('./CityMap').then((m) => el(m.DpMapPage, {}));
    case 'mr/pune/map/': return () => import('./CityMapMr').then((m) => el(m.MapPageMr, {}));
    case 'mr/pune/dp-map/': return () => import('./CityMapMr').then((m) => el(m.DpMapPageMr, {}));
    case 'templates/': return () => import('./Platform').then((m) => el(m.TemplatesHub, {}));
    case 'coverage/': return () => import('./Platform').then((m) => el(m.CoverageHub, {}));
    case 'sample-report/': return () => import('./Platform').then((m) => el(m.SampleReport, {}));
    case 'about/': return () => import('./Platform').then((m) => el(m.About, {}));
    case 'contact/': return () => import('./Platform').then((m) => el(m.Contact, {}));
  }
  let m: RegExpMatchArray | null;
  if ((m = path.match(DPR))) { const slug = m[1]; return () => import('./DpReport').then((x) => el(x.DpAreaBySlug, { slug })); }
  if ((m = path.match(CITY))) { const city = m[1] as 'pune' | 'mumbai'; return () => import('./Place').then((x) => el(x.CityPage, { city })); }
  if ((m = path.match(PLACE))) { const [, city, slug] = m; return () => import('./Place').then((x) => el(x.PlaceBySlug, { city: city as 'pune' | 'mumbai', slug })); }
  if ((m = path.match(GUIDE))) { const slug = m[1]; return () => import('./Guide').then((x) => el(x.GuideBySlug, { slug })); }
  if ((m = path.match(TEMPLATE))) { const id = m[1]; return () => import('./Platform').then((x) => el(x.TemplatePage, { id })); }
  if ((m = path.match(RULES))) { const slug = m[1]; return () => import('./Platform').then((x) => el(x.RuleBookPage, { slug })); }
  return null;
}
