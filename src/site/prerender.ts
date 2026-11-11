// The build's side of the website (loaded in Node by the plugin in vite.config.ts, never in the browser): each
// route's page rendered to HTML, its <head> tags, the sitemap, robots.txt, llms.txt, the web manifest, and a check
// of every page's head. `site` is the site's address with no trailing slash (SITE_URL), so canonical links and
// social cards are absolute.
import { renderToString } from 'preact-render-to-string';
import { ROUTES, SITE_NAME, type Lang, type Route } from './routes';
import { SHORT_NAME, TAGLINE, THEME_COLOR } from './brand';
import { MAPS } from './CityMap';

export { ROUTES };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const abs = (site: string) => (p: string) => (/^https?:/.test(p) ? p : `${site}/${p.replace(/^\/+/, '')}`);
const HREFLANG: Record<Lang, string> = { en: 'en-IN', mr: 'mr-IN' };
const OG_LOCALE: Record<Lang, string> = { en: 'en_IN', mr: 'mr_IN' };
/** the most a title should run to in search results */
export const TITLE_MAX = 60, DESC_MAX = 155;

/** The <title>: the site name is added when it fits. */
export function fullTitle(r: Route): string {
  const t = r.head.title, withName = `${t} · ${SITE_NAME}`;
  return r.path === '' || withName.length > TITLE_MAX ? t : withName;
}

/** The page's markup, to go inside <div id="site">. */
export async function body(r: Route): Promise<string> {
  return r.view ? renderToString(await r.view()) : '';
}

/** The page's language, for <html lang>. */
export const langOf = (r: Route): Lang => r.head.lang ?? 'en';

/** The tags that replace the template's <title>. */
export function head(r: Route, site: string, base = '/'): string {
  const url = abs(site), h = r.head, lang = langOf(r);
  const title = fullTitle(r);
  const tags = [
    ...(h.note ? [`<!-- ${h.note.replace(/--/g, '—')} -->`] : []),
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(h.description)}" />`,
    h.noindex ? '<meta name="robots" content="noindex, follow" />' : `<link rel="canonical" href="${esc(url(r.path))}" />`,
  ];
  if (h.alternates && !h.noindex) {
    for (const [l, p] of Object.entries(h.alternates) as [Lang, string][]) tags.push(`<link rel="alternate" hreflang="${HREFLANG[l]}" href="${esc(url(p))}" />`);
    tags.push(`<link rel="alternate" hreflang="x-default" href="${esc(url(h.alternates.en ?? r.path))}" />`);
  }
  if (h.preload) tags.push(`<link rel="preload" as="image" href="${esc(base + h.preload)}" fetchpriority="high" />`);
  tags.push(
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:type" content="${h.type ?? 'website'}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(h.description)}" />`,
    `<meta property="og:url" content="${esc(url(r.path))}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}" />`,
  );
  for (const l of Object.keys(h.alternates ?? {}) as Lang[]) if (l !== lang) tags.push(`<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`);
  if (h.image) {
    tags.push(`<meta property="og:image" content="${esc(url(h.image))}" />`, '<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />',
      '<meta property="og:image:type" content="image/jpeg" />');
    if (h.imageAlt) tags.push(`<meta property="og:image:alt" content="${esc(h.imageAlt)}" />`);
  }
  tags.push(
    `<meta name="twitter:card" content="${h.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(h.description)}" />`,
  );
  if (h.image) tags.push(`<meta name="twitter:image" content="${esc(url(h.image))}" />`);
  if (h.image && h.imageAlt) tags.push(`<meta name="twitter:image:alt" content="${esc(h.imageAlt)}" />`);
  const ld = h.ld?.(url);
  // (JSON in a script: only "<" needs escaping, so "</script>" can't close it)
  if (ld?.length) tags.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': ld }).replace(/</g, '\\u003c')}</script>`);
  return tags.join('\n    ');
}

const indexable = () => ROUTES.filter((r) => !r.head.noindex && r.path !== '404');

/** sitemap.xml: every indexable route, with its language versions and its pictures. */
export function sitemap(site: string): string {
  const url = abs(site);
  const rows = indexable().map((r) => {
    const alt = r.head.alternates
      ? [...(Object.entries(r.head.alternates) as [Lang, string][]).map(([l, p]) => `<xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${esc(url(p))}"/>`),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(url(r.head.alternates.en ?? r.path))}"/>`].join('')
      : '';
    const imgs = [...new Set([...(r.head.image ? [r.head.image] : []), ...(r.images ?? [])])].map((i) => `<image:image><image:loc>${esc(url(i))}</image:loc></image:image>`).join('');
    return `  <url><loc>${esc(url(r.path))}</loc><lastmod>${r.updated}</lastmod><priority>${r.priority.toFixed(1)}</priority>${alt}${imgs}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${rows.join('\n')}\n</urlset>\n`;
}

/** robots.txt: everything but the account pages and the dev endpoints, and where the sitemap is. */
export function robots(site: string): string {
  const root = new URL(`${site}/`).pathname;
  return [
    'User-agent: *', 'Allow: /',
    ...['account/', 'reset/', '__maps/'].map((p) => `Disallow: ${root}${p}`),
    '', `Sitemap: ${site}/sitemap.xml`, '',
  ].join('\n');
}

/** llms.txt (llmstxt.org): what the site is and its key pages, in plain text for language-model crawlers. */
export function llms(site: string): string {
  const url = abs(site), P = MAPS.pune, M = MAPS.mumbai;
  const line = (p: string) => { const r = ROUTES.find((x) => x.path === p); return r ? `- [${r.head.title}](${url(p)}): ${r.head.description}` : ''; };
  const group = (pre: RegExp) => indexable().filter((r) => pre.test(r.path)).map((r) => line(r.path));
  return [
    `# ${SITE_NAME}`, '',
    `> ${TAGLINE}. ${SITE_NAME} is a browser map editor for Pune and Mumbai: the real road network, buildings and terrain in 2D and 3D, the Pune Development Plan over today's city, a plot sandbox for FSI, setbacks and height by road width (UDCPR 2020, DCPR 2034), and Site Studio for the most a plot can hold. Free during the beta.`, '',
    'Data coverage and its limits:',
    `- Pune and Pimpri-Chinchwad: ${P.km2} km², ${P.counts.roads} roads, ${P.counts.buildings} buildings (OpenStreetMap, baked ${P.baked}).`,
    `- Pune Development Plan: ${P.dp!.sheets} sanctioned PMC DP sheets for the old PMC limits (about ${Math.round(P.dp!.km2)} km²), registered to about 2-3 m. DP road widths are traced for ${Math.round(P.dp!.tracedKm)} km of road in part of east-central Pune only. Pimpri-Chinchwad, Hinjewadi and the merged villages have no DP sheets.`,
    `- Mumbai: ${M.km2} km², ${M.counts.roads} roads, ${M.counts.buildings} buildings (OpenStreetMap, baked ${M.baked}). Mumbai's Development Plan (DP 2034) is not in ${SITE_NAME}.`,
    `- Road widths are ${SITE_NAME}'s model from OpenStreetMap lane counts and road classes, not a survey. ${SITE_NAME} is a survey aid, not an official DP remark, zone certificate or engineering advice.`,
    `- Licence: map data © OpenStreetMap contributors, ODbL 1.0. The road-network downloads are ODbL. Elevation: Copernicus DEM GLO-30. DP sheets © Pune Municipal Corporation (shown, not redistributed).`, '',
    '## Maps', ...group(/^(pune|mumbai)\/(map|dp-map|road-width-map)\/$/), ...group(/^mr\//), '',
    '## Cities and places', ...group(/^(pune|mumbai)\/$/), ...group(/^(pune|mumbai)\/(?!map\/|dp-map\/|road-width-map\/)[a-z0-9-]+\/$/), '',
    '## Guides', ...group(/^guides\//), '',
    '## Data', line('data/'), `- [Pune main roads, GeoJSON](${url(P.download.file)})`, `- [Mumbai main roads, GeoJSON](${url(M.download.file)})`, '',
    '## Optional', line('app/'), line('pricing/'), line('terms/'), line('privacy/'), '',
  ].join('\n');
}

/** site.webmanifest: the name and icons for a home screen. */
export function manifest(base: string): string {
  return JSON.stringify({
    name: SITE_NAME, short_name: SHORT_NAME, description: TAGLINE, start_url: base, scope: base, display: 'standalone',
    background_color: THEME_COLOR, theme_color: THEME_COLOR,
    icons: [
      { src: `${base}favicon.svg`, sizes: 'any', type: 'image/svg+xml' },
      { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
  }, null, 1);
}

/** Warnings about the pages' heads: titles and descriptions too long or shared by two pages, alternates that don't point back. */
export function checkHeads(): string[] {
  const out: string[] = [], seenT = new Map<string, string>(), seenD = new Map<string, string>();
  for (const r of ROUTES) {
    if (r.head.noindex) continue;
    const t = fullTitle(r), d = r.head.description, p = r.path || '/';
    if (t.length > TITLE_MAX) out.push(`title over ${TITLE_MAX} (${t.length}): ${p} “${t}”`);
    if (d.length > DESC_MAX) out.push(`description over ${DESC_MAX} (${d.length}): ${p}`);
    if (d.length < 70) out.push(`description under 70 (${d.length}): ${p}`);
    if (seenT.has(t)) out.push(`title shared by ${seenT.get(t)} and ${p}`); else seenT.set(t, p);
    if (seenD.has(d)) out.push(`description shared by ${seenD.get(d)} and ${p}`); else seenD.set(d, p);
    for (const [l, q] of Object.entries(r.head.alternates ?? {})) {
      const o = ROUTES.find((x) => x.path === q);
      if (!o) out.push(`${p}: hreflang ${l} → ${q}, no such page`);
      else if (o.head.alternates?.[langOf(r)] !== r.path) out.push(`${p}: hreflang ${l} → ${q} doesn't point back`);
    }
  }
  return out;
}
