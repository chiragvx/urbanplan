// Place pages: a page per neighbourhood or road, under /<city>/<slug>/ (src/site/routes.ts lists them). The numbers
// are measured from the baked city by tools/places/bake-places.ts (generated/places.json; the places themselves are
// in tools/places/places.config.ts); here they're only put into words for the page's head.
import type { PlaceData } from './facts';
import RAW from './generated/places.json';

export type City = 'pune' | 'mumbai';

export interface Place {
  city: City;
  slug: string;
  name: string;
  /** the page's <title> (60 characters or fewer, with the site name if it fits), its heading, and description */
  title: string;
  h1: string;
  description: string;
  /** last changed (ISO date), for the sitemap: when the city's base map was baked */
  updated: string;
  /** a picture for social cards, a path under public/ (e.g. site/og-city.jpg) */
  image?: string;
  /** what was measured */
  data: PlaceData;
}

export const CITY_LABEL: Record<City, string> = { pune: 'Pune', mumbai: 'Mumbai' };

/** A road as people call it, with its map name when that differs. */
export const roadName = (f: { name: string; label?: string }) => f.label ?? f.name;

function describe(d: PlaceData): string {
  const main = d.roads[0];
  const width = !main ? '' : main.dp && d.dp === 'traced'
    ? `${roadName(main) === d.name ? '' : roadName(main) + ' '}${main.w} m wide in the map, ${main.dp} m in the Development Plan. `
    : `${roadName(main) === d.name ? '' : roadName(main) + ' '}about ${main.w} m wide${main.oneway === 'pair' ? ' each way' : main.oneway ? ', one-way' : ''}. `;
  return `${d.name}, ${CITY_LABEL[d.city]}: ${width}${d.area.roadKm} km of road, ${d.area.mainJunctions} main-road junctions and ${d.area.buildings.toLocaleString('en-IN')} buildings within ${d.r} m. Widths, ${d.dp === 'traced' ? 'the DP plan' : 'junctions'} and what-ifs, from open data.`;
}

/** The <title>: the longest of these that fits in 60 characters once " · " and the site name (about 12) are added, else the shortest. */
function shortTitle(d: PlaceData): string {
  const c = CITY_LABEL[d.city], w = d.dp === 'traced' ? 'road and DP widths' : 'road widths';
  const tries = [`${d.name}, ${c}: ${w} and junctions`, `${d.name}, ${c}: ${w}`, `${d.name}: ${w}`, `${d.name.replace(/ \(.*\)$/, '')}: ${w}`];
  return tries.find((t) => t.length <= 46) ?? tries[tries.length - 1];
}

/** A shorter description, for places whose long one runs past what search results show. */
function describeShort(d: PlaceData, road = true): string {
  const main = road ? d.roads[0] : undefined;
  const width = !main ? '' : main.dp && d.dp === 'traced' ? `${roadName(main)}: ${main.w} m today, ${main.dp} m in the DP. ` : `${roadName(main)}: about ${main.w} m${main.oneway === 'pair' ? ' each way' : ''}. `;
  return `${d.name}, ${CITY_LABEL[d.city]}: ${width}${d.area.roadKm} km of road and ${d.area.mainJunctions} main-road junctions within ${d.r} m, from open data.`;
}
const fit = (...tries: string[]) => tries.find((t) => t.length <= 155) ?? tries[tries.length - 1];

export const PLACES: Place[] = (RAW as PlaceData[]).map((d) => ({
  city: d.city, slug: d.slug, name: d.name,
  title: shortTitle(d),
  h1: `${d.name}, ${CITY_LABEL[d.city]}: road widths, ${d.dp === 'traced' ? 'DP plan' : 'junctions'} and what-ifs`,
  description: fit(describe(d), describeShort(d), describeShort(d, false)),
  updated: d.baked, image: d.image, data: d,
}));

export const placeOf = (city: City, slug: string) => PLACES.find((p) => p.city === city && p.slug === slug);
