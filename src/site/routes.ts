// Every page of the website, in one list: its path, its <head> (title, description, language and its other-language
// versions, social card, structured data) and its place in the sitemap. The build prerenders each one to
// <path>/index.html (src/site/prerender.ts, run from vite.config.ts) through its view (src/site/views.ts), and the
// browser hydrates it (src/site/main.tsx). To add a page, add a route here and its view there.
// (Build-time only: the browser never loads this file, so the data in it costs the pages nothing.)
import type { VNode } from 'preact';
import { GUIDES, type Guide } from './guides/data';
import { PLACES, type City, type Place } from './places/data';
import { viewOf } from './views';
import { SITE_NAME } from './brand';
import MAPS_RAW from './maps/generated/maps.json';
import type { CityMapData } from './maps/types';
import { DP_FAQ, DATA_FIELDS } from './CityMap';
import { DP_FAQ_MR } from './CityMapMr';
import { AREAS, SUMMARY, DPR_FAQ, DPR_PATH, areaPath, areaMap, areaCard, clsLower, type DprArea } from './dpreport/data';

export { SITE_NAME };
const MAPS = MAPS_RAW as unknown as Record<City, CityMapData>;

/** JSON-LD for a page; `url(p)` makes a site path absolute. */
type Ld = (url: (p: string) => string) => object[];
export type Lang = 'en' | 'mr';

export interface Head {
  /** the <title>; the site name is added after " · " when the whole fits in 60 characters (the landing page's is used as it is) */
  title: string;
  description: string;
  /** the social card picture, a path under public/ (1200 × 630 JPG), and what it shows */
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  /** keep it out of search engines and the sitemap (accounts, the not-found page) */
  noindex?: boolean;
  /** the page's language (default en); its versions in other languages, by language, as site paths (itself included) */
  lang?: Lang;
  alternates?: Partial<Record<Lang, string>>;
  /** the picture the page opens on (its LCP), to preload with high priority */
  preload?: string;
  /** a comment to put in the <head> (e.g. that a translation needs review) */
  note?: string;
  ld?: Ld;
}

export interface Route {
  /** '' for the landing page, otherwise 'pricing/', 'guides/fsi-calculator-pune/' … (relative to the site's base); '404' for the not-found page */
  path: string;
  head: Head;
  /** 0–1, for the sitemap */
  priority: number;
  /** last changed (ISO date), for the sitemap: for pages built from the data, when the data was baked */
  updated: string;
  /** pictures on the page for the sitemap (paths under public/), beside the social card */
  images?: string[];
  /** what the page renders; none for the editor (/app/), which only takes its head from here */
  view?: () => Promise<VNode<any>>;
}

const IMG = { city: 'site/og-city.jpg', studio: 'site/og-studio.jpg', dp: 'site/og-dp.jpg' };
const ALT = {
  city: `${SITE_NAME}: a city's roads, buildings and terrain in 3D`,
  studio: `${SITE_NAME} Site Studio: the most a plot can hold, with FSI, parking and returns`,
  dp: `${SITE_NAME}: the Development Plan laid over today's map`,
};
const SITE_UPDATED = '2026-11-03';
const LEGAL_UPDATED = '2026-11-01';
export const CITY_LABEL: Record<City, string> = { pune: 'Pune', mumbai: 'Mumbai' };
const MR_NOTE = 'Marathi text drafted without native review: have a native Marathi speaker check it (see README, "Website and accounts").';

// ---------- structured data ----------

type U = (p: string) => string;
const org = (url: U) => ({ '@type': 'Organization', '@id': url('#org'), name: SITE_NAME, url: url(''), logo: url('icon-512.png') });
const app = (url: U) => ({
  '@type': 'SoftwareApplication', name: SITE_NAME, url: url('app/'), applicationCategory: 'DesignApplication', operatingSystem: 'Web browser',
  description: 'A map editor for Indian cities: roads, flyovers, terrain and the Development Plan in 2D and 3D, and Site Studio for what a plot can hold.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
  publisher: { '@id': url('#org') },
});
/** Home › … › this page; `trail` is [name, path] from the top. */
const crumbs = (url: U, trail: [string, string][]) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, p], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url(p) })),
});
const faq = (qs: [string, string][]) => ({
  '@type': 'FAQPage',
  mainEntity: qs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
/** A city as a schema.org Place: its name, the box the map covers, the state. */
const cityPlace = (city: City) => {
  const [s, w, n, e] = MAPS[city].bbox;
  return {
    '@type': 'City', name: city === 'pune' ? 'Pune' : 'Mumbai',
    geo: { '@type': 'GeoShape', box: `${s} ${w} ${n} ${e}` },
    containedInPlace: { '@type': 'AdministrativeArea', name: 'Maharashtra, India' },
  };
};
/** A map page as a schema.org Map. */
const mapLd = (url: U, path: string, name: string, description: string, city: City, image: string, lang: Lang = 'en') => ({
  '@type': 'Map', name, description, url: url(path), image: url(image), inLanguage: lang === 'mr' ? 'mr-IN' : 'en-IN',
  spatialCoverage: cityPlace(city), isAccessibleForFree: true, dateModified: MAPS[city].baked,
  creator: { '@id': url('#org') }, publisher: { '@id': url('#org') },
  license: 'https://opendatacommons.org/licenses/odbl/1-0/', creditText: '© OpenStreetMap contributors',
});

// ---------- the pages ----------

const auth = (path: string, title: string, description: string): Route => ({ path, head: { title, description, noindex: true }, priority: 0, updated: SITE_UPDATED });

const STATIC: Route[] = [
  {
    path: '', priority: 1, updated: SITE_UPDATED,
    head: {
      title: `${SITE_NAME}: edit the real city, see what it becomes`,
      description: 'A map editor for Pune and Mumbai. Draw roads, flyovers and tunnels, lay the Development Plan over today’s city, and see what a plot can hold, in 2D and 3D.',
      image: IMG.studio, imageAlt: ALT.studio, preload: 'site/studio-video.webp',
      ld: (url) => [
        { '@type': 'WebSite', '@id': url('#site'), name: SITE_NAME, url: url(''), inLanguage: 'en-IN', publisher: { '@id': url('#org') } },
        org(url), app(url),
      ],
    },
    images: ['site/studio-video.webp', 'site/studio-towers.webp', 'site/dp-2d.webp', 'site/city-detail.webp'],
  },
  {
    path: 'app/', priority: 0.9, updated: SITE_UPDATED,
    head: {
      title: 'The editor: Pune and Mumbai in 2D and 3D',
      description: `Open the ${SITE_NAME} editor in your browser: the city’s roads, buildings and terrain, the Development Plan, the plot sandbox and Site Studio. Free in beta.`,
      image: IMG.city, imageAlt: ALT.city,
      ld: (url) => [app(url)],
    },
  },
  {
    path: 'pricing/', priority: 0.6, updated: SITE_UPDATED,
    head: { title: 'Pricing', description: `${SITE_NAME} is free during the beta. Pro and Firm will add maps saved to your account, exports and analysis.`, image: IMG.city, imageAlt: ALT.city, ld: (url) => [app(url)] },
  },
  {
    path: 'guides/', priority: 0.8, updated: SITE_UPDATED,
    head: {
      title: 'Guides: FSI, setbacks, TDR and the Development Plan',
      description: 'Plain answers on FSI, setbacks, TDR, DP roads and the Development Plan in Pune and Mumbai, each with a worked example and a free tool to try on your plot.',
      image: IMG.dp, imageAlt: ALT.dp,
      ld: (url) => [crumbs(url, [['Home', ''], ['Guides', 'guides/']])],
    },
  },
  {
    path: 'data/', priority: 0.6, updated: [MAPS.pune.baked, MAPS.mumbai.baked].sort()[1],
    head: {
      title: 'Open data: Pune and Mumbai road networks',
      description: `What ${SITE_NAME} is built on, and the main road networks of Pune and Mumbai to download as GeoJSON, with each road's width in the model. ODbL.`,
      image: MAPS.pune.og['road-widths'], imageAlt: 'Pune’s main roads coloured by width',
      ld: (url) => [
        ...(['pune', 'mumbai'] as City[]).map((c) => {
          const M = MAPS[c], d = M.download;
          return {
            '@type': 'Dataset', '@id': url(`data/#${c}`),
            name: `${c === 'pune' ? 'Pune and Pimpri-Chinchwad' : 'Mumbai'} main road network (${SITE_NAME} base map)`,
            description: `The main roads of ${M.area} (expressways to collectors) as GeoJSON centre lines, ${d.features.toLocaleString('en-IN')} road sections, each with its OpenStreetMap name and class and its width, carriageway and lanes in ${SITE_NAME}'s model. Derived from OpenStreetMap; baked ${M.baked}.`,
            url: url('data/'), license: 'https://opendatacommons.org/licenses/odbl/1-0/', isAccessibleForFree: true,
            creator: { '@id': url('#org') }, publisher: { '@id': url('#org') },
            creditText: '© OpenStreetMap contributors', copyrightNotice: '© OpenStreetMap contributors, ODbL 1.0',
            isBasedOn: 'https://www.openstreetmap.org/', dateModified: M.baked, inLanguage: 'en',
            keywords: [c === 'pune' ? 'Pune' : 'Mumbai', 'road network', 'road width', 'OpenStreetMap', 'GeoJSON', 'India'],
            variableMeasured: DATA_FIELDS.map(([k]) => k),
            spatialCoverage: cityPlace(c),
            distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/geo+json', contentUrl: url(d.file), contentSize: `${(d.bytes / 1e6).toFixed(1)} MB` }],
          };
        }),
        org(url),
        crumbs(url, [['Home', ''], ['Open data', 'data/']]),
      ],
    },
  },
  {
    path: 'terms/', priority: 0.2, updated: LEGAL_UPDATED,
    head: { title: 'Terms of use', description: `The terms of use for the ${SITE_NAME} beta: what it is, what it is not, your maps, data and attribution.`, image: IMG.city, imageAlt: ALT.city },
  },
  {
    path: 'privacy/', priority: 0.2, updated: LEGAL_UPDATED,
    head: { title: 'Privacy notice', description: `What ${SITE_NAME} keeps about you during the beta: nothing without an account; with one, your email, name and profile.`, image: IMG.city, imageAlt: ALT.city },
  },
  auth('login/', 'Sign in', `Sign in to your ${SITE_NAME} account.`),
  auth('signup/', 'Create an account', `Create a free ${SITE_NAME} account.`),
  auth('forgot/', 'Reset your password', `Get a link to reset your ${SITE_NAME} password.`),
  auth('reset/', 'Choose a new password', `Set a new password for your ${SITE_NAME} account.`),
  auth('account/', 'Your account', `Your ${SITE_NAME} account: profile, plan and sign-in.`),
  { path: '404', priority: 0, updated: SITE_UPDATED, head: { title: 'Page not found', description: `This page isn’t on ${SITE_NAME}. The city pages, maps and guides are a click away.`, noindex: true } },
];

const guideRoute = (g: Guide): Route => ({
  path: `guides/${g.slug}/`, priority: 0.7, updated: g.updated,
  head: {
    title: g.title, description: g.description, image: IMG.dp, imageAlt: ALT.dp, type: 'article',
    ld: (url) => [
      { '@type': 'Article', headline: g.h1, description: g.description, dateModified: g.updated, inLanguage: 'en-IN', mainEntityOfPage: url(`guides/${g.slug}/`), image: url(IMG.dp), author: org(url), publisher: { '@id': url('#org') } },
      crumbs(url, [['Home', ''], ['Guides', 'guides/'], [g.h1, `guides/${g.slug}/`]]),
      faq(g.faq),
    ],
  },
});

const latest = (dates: string[], fallback: string) => dates.reduce((a, b) => (b > a ? b : a), fallback);

const cityRoute = (city: City): Route => ({
  path: `${city}/`, priority: 0.8,
  updated: latest([...PLACES.filter((p) => p.city === city).map((p) => p.updated), MAPS[city].baked], '0'),
  head: {
    title: city === 'pune' ? 'Pune: road widths, the DP and what plots can hold' : 'Mumbai: road widths and what plots can hold',
    description: `${CITY_LABEL[city]} on ${SITE_NAME}: its roads, buildings and terrain in 2D and 3D, ${city === 'pune' ? 'the Development Plan, ' : ''}the rules for what a plot can hold, places, maps and guides.`,
    image: MAPS[city].og.map, imageAlt: `${CITY_LABEL[city]}'s main roads`,
    ld: (url) => [crumbs(url, [['Home', ''], [CITY_LABEL[city], `${city}/`]])],
  },
});

const placeRoute = (p: Place): Route => ({
  path: `${p.city}/${p.slug}/`, priority: 0.6, updated: p.updated,
  images: [p.data.map],
  head: {
    title: p.title, description: p.description, image: p.image ?? IMG.city, imageAlt: `Map of the roads and buildings round ${p.name}, ${CITY_LABEL[p.city]}`, type: 'article',
    ld: (url) => [
      {
        '@type': 'Place', '@id': url(`${p.city}/${p.slug}/#place`), name: `${p.name}, ${CITY_LABEL[p.city]}`, url: url(`${p.city}/${p.slug}/`),
        ...(p.data.aka?.length ? { alternateName: p.data.aka } : {}),
        geo: { '@type': 'GeoCoordinates', latitude: p.data.lat, longitude: p.data.lon },
        hasMap: url(p.data.map),
        containedInPlace: { '@type': 'City', name: CITY_LABEL[p.city], url: url(`${p.city}/`) },
      },
      crumbs(url, [['Home', ''], [CITY_LABEL[p.city], `${p.city}/`], [p.name, `${p.city}/${p.slug}/`]]),
    ],
  },
});

/** The city map pages, and the Marathi versions of Pune's. */
function mapRoutes(): Route[] {
  const out: Route[] = [];
  for (const city of ['pune', 'mumbai'] as City[]) {
    const M = MAPS[city], L = CITY_LABEL[city];
    const mapDesc = `${L} in 3D: ${M.counts.roads.toLocaleString('en-IN')} roads, ${Math.round(M.counts.buildings / 1000)}k buildings and the terrain over ${M.km2.toLocaleString('en-IN')} km², free in your browser. Every road can be edited.`;
    const mapAlt = city === 'pune' ? { en: `${city}/map/`, mr: `mr/${city}/map/` } : undefined;
    out.push({
      path: `${city}/map/`, priority: 0.8, updated: M.baked, images: [M.svg.map, ...(city === 'pune' ? ['site/city-3d.webp'] : [])],
      head: {
        title: `${L} 3D map: roads, buildings and terrain`, description: mapDesc,
        image: M.og.map, imageAlt: `${L}'s main road network`, preload: M.svg.map, alternates: mapAlt,
        ld: (url) => [
          mapLd(url, `${city}/map/`, `${L} 3D map: roads, buildings and terrain`, mapDesc, city, M.og.map),
          crumbs(url, [['Home', ''], [L, `${city}/`], [`${L} 3D map`, `${city}/map/`]]),
        ],
      },
    });
    const wDesc = `How wide ${L}'s ${Math.round(M.mainKm).toLocaleString('en-IN')} km of main roads are, from OpenStreetMap: a city map coloured by width, and the widest and narrowest named roads.`;
    out.push({
      path: `${city}/road-width-map/`, priority: 0.7, updated: M.baked, images: [M.svg.width],
      head: {
        title: `${L} road width map: main roads by width`, description: wDesc,
        image: M.og['road-widths'], imageAlt: `${L}'s main roads coloured by width`, preload: M.svg.width,
        ld: (url) => [
          mapLd(url, `${city}/road-width-map/`, `${L} road width map`, wDesc, city, M.og['road-widths']),
          crumbs(url, [['Home', ''], [L, `${city}/`], [`${L} road width map`, `${city}/road-width-map/`]]),
        ],
      },
    });
  }
  const P = MAPS.pune, D = P.dp!;
  const dpAlt = { en: 'pune/dp-map/', mr: 'mr/pune/dp-map/' };
  const dpDesc = `Pune's Development Plan on today's map: ${D.sheets} DP sheets for the old PMC limits, DP road widths traced in part of east-central Pune, and what it can't say.`;
  out.push({
    path: 'pune/dp-map/', priority: 0.8, updated: P.baked, images: [P.svg.dp!],
    head: {
      title: 'Pune DP map (Development Plan) online', description: dpDesc,
      image: P.og['dp-map'], imageAlt: 'Where the Pune Development Plan sheets are in the map, and where the DP road widths are traced',
      preload: P.svg.dp, alternates: dpAlt,
      ld: (url) => [
        mapLd(url, 'pune/dp-map/', 'Pune DP map (Development Plan)', dpDesc, 'pune', P.og['dp-map']),
        crumbs(url, [['Home', ''], ['Pune', 'pune/'], ['Pune DP map', 'pune/dp-map/']]),
        faq(DP_FAQ),
      ],
    },
  });
  const mrMapDesc = `पुण्याचा 3D नकाशा: ${P.counts.roads.toLocaleString('en-IN')} रस्ते, ${P.counts.buildings.toLocaleString('en-IN')} इमारती आणि ${P.km2.toLocaleString('en-IN')} चौ. किमी जमीन, ब्राउझरमध्ये मोफत. प्रत्येक रस्ता बदलून पाहता येतो.`;
  out.push({
    path: 'mr/pune/map/', priority: 0.6, updated: P.baked, images: [P.svg.map],
    head: {
      title: 'पुण्याचा 3D नकाशा: रस्ते, इमारती आणि जमीन', description: mrMapDesc, lang: 'mr', note: MR_NOTE,
      image: P.og.map, imageAlt: 'पुण्याच्या मुख्य रस्त्यांचा नकाशा', preload: P.svg.map, alternates: { en: 'pune/map/', mr: 'mr/pune/map/' },
      ld: (url) => [
        mapLd(url, 'mr/pune/map/', 'पुण्याचा 3D नकाशा', mrMapDesc, 'pune', P.og.map, 'mr'),
        crumbs(url, [['मुख्यपृष्ठ', ''], ['पुणे', 'pune/'], ['पुण्याचा 3D नकाशा', 'mr/pune/map/']]),
      ],
    },
  });
  const mrDpDesc = `पुणे विकास आराखडा (DP) आजच्या नकाशावर: जुन्या PMC हद्दीचे ${D.sheets} DP नकाशे, पूर्व-मध्य पुण्याच्या काही भागात रेखांकित DP रस्ता रुंदी, आणि तो काय दाखवत नाही.`;
  out.push({
    path: 'mr/pune/dp-map/', priority: 0.7, updated: P.baked, images: [P.svg.dp!],
    head: {
      title: 'पुणे विकास आराखडा नकाशा (DP map)', description: mrDpDesc, lang: 'mr', note: MR_NOTE,
      image: P.og['dp-map'], imageAlt: 'पुणे विकास आराखड्याचे नकाशे आणि रेखांकित DP रस्ता रुंदी', preload: P.svg.dp, alternates: dpAlt,
      ld: (url) => [
        mapLd(url, 'mr/pune/dp-map/', 'पुणे विकास आराखडा नकाशा (DP map)', mrDpDesc, 'pune', P.og['dp-map'], 'mr'),
        crumbs(url, [['मुख्यपृष्ठ', ''], ['पुणे', 'pune/'], ['पुणे विकास आराखडा नकाशा', 'mr/pune/dp-map/']]),
        faq(DP_FAQ_MR),
      ],
    },
  });
  return out;
}

/** The DP report: the hub (the whole of the plan) and a page per locality. */
function dpReportRoutes(): Route[] {
  const S = SUMMARY;
  const hubDesc = `Pune's Development Plan on satellite: click any plot in the old PMC limits for its DP zone, reserved sites and DP roads. ${S.parcels.toLocaleString('en-IN')} parcels traced. Free PDF.`;
  const hub: Route = {
    path: DPR_PATH, priority: 0.9, updated: S.baked,
    head: {
      title: 'Pune DP plan map on satellite: check any plot', description: hubDesc,
      image: IMG.dp, imageAlt: ALT.dp,
      ld: (url) => [
        mapLd(url, DPR_PATH, 'Pune DP plan on satellite: the Development Plan plot by plot', hubDesc, 'pune', IMG.dp),
        crumbs(url, [['Home', ''], ['Pune', 'pune/'], ['Pune DP plan', DPR_PATH]]),
        faq(DPR_FAQ),
      ],
    },
  };
  const page = (a: DprArea): Route => {
    const top = a.mix[0] ? `${Math.round(a.mix[0].pct)}% ${clsLower(a.mix[0].cls)}` : 'zones';
    const res = a.reserved.length ? `${a.reserved.length} reserved site${a.reserved.length > 1 ? 's' : ''}` : 'no traced reservations';
    const desc = `${a.name}, Pune: the Development Plan within ${a.r} m on satellite, ${top}, ${res}${a.dpRoads.length ? `, DP road widths` : ''}. Check your plot, free PDF.`;
    const title = [`${a.name} DP plan map: zones and reservations`, `${a.name} DP plan map (Pune)`, `${a.name} DP plan map`].find((t) => t.length <= 48) ?? `${a.name} DP plan`;
    return {
      path: areaPath(a), priority: 0.6, updated: S.baked, images: [areaMap(a)],
      head: {
        title, description: desc.length <= 155 ? desc : desc.replace(/, DP road widths/, '').slice(0, 155),
        image: areaCard(a), imageAlt: `The Development Plan round ${a.name}, Pune: zones, reserved sites and DP roads`, type: 'article',
        ld: (url) => [
          {
            '@type': 'Place', '@id': url(`${areaPath(a)}#place`), name: `${a.name}, Pune`, url: url(areaPath(a)),
            ...(a.aka?.length ? { alternateName: a.aka } : {}),
            geo: { '@type': 'GeoCoordinates', latitude: a.lat, longitude: a.lon },
            containedInPlace: { '@type': 'City', name: 'Pune', url: url('pune/') },
          },
          { '@type': 'Map', name: `${a.name} DP plan map`, url: url(areaPath(a)), image: url(areaMap(a)), spatialCoverage: { '@id': url(`${areaPath(a)}#place`) }, isAccessibleForFree: true, dateModified: S.baked, creator: { '@id': url('#org') } },
          crumbs(url, [['Home', ''], ['Pune', 'pune/'], ['Pune DP plan', DPR_PATH], [a.name, areaPath(a)]]),
          faq(DPR_FAQ),
        ],
      },
    };
  };
  return [hub, ...AREAS.map(page)];
}

export const ROUTES: Route[] = [
  ...STATIC,
  ...GUIDES.map(guideRoute),
  ...(['pune', 'mumbai'] as City[]).map(cityRoute),
  ...mapRoutes(),
  ...PLACES.map(placeRoute),
  ...dpReportRoutes(),
].map((r) => ({ ...r, view: viewOf(r.path) ?? undefined }));

export const route = (path: string) => ROUTES.find((r) => r.path === path);
