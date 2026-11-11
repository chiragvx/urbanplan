// The DP report's words and numbers for the pages: the localities baked by tools/dpreport/bake-dpreport.ts
// (generated/areas.json) and the classes of the Development Plan's legend. Pages read this; the viewer loads the
// parcels themselves from public/dpr/<city>/ in the browser (./geo.ts).
import RAW from './generated/areas.json';

export interface MixRow { cls: string; pct: number; ha: number }
export interface ReservedSite { id: string; cls: string; ha: number; m: number; dir: string; lat: number; lon: number; conf: number }
export interface DpRoadRow { name: string; w: number; dp: number; m: number }
export interface DprArea {
  slug: string; name: string; aka?: string[]; lat: number; lon: number; r: number;
  mix: MixRow[]; roadPct: number;
  centre: { cls: string; reserved: boolean } | null;
  reserved: ReservedSite[]; dpRoads: DpRoadRow[];
  sheets: string[]; parcels: number; nearby: string[];
}
export interface DprSummary {
  city: 'pune'; baked: string; sheets: number; parcels: number; reserved: number; reservedHa: number; dpRoadKm: number;
  byClass: { cls: string; ha: number }[];
  classes: Record<string, { label: string; color: string }>;
}

const D = RAW as unknown as { summary: DprSummary; areas: DprArea[] };
export const SUMMARY = D.summary;
export const AREAS = D.areas;
export const CLASSES = D.summary.classes;
export const areaOf = (slug: string) => AREAS.find((a) => a.slug === slug);
export const clsLabel = (c: string) => CLASSES[c]?.label ?? c;
/** Short labels for tables and chips. */
const SHORT: Record<string, string> = {
  ews: 'EWS / slum improvement', psp: 'Public / semi-public', recreational: 'Garden / playground', services: 'Public utilities',
  transport: 'Transport', local_commercial: 'Local commercial (C-1)', hill_slope: 'Hill top / slope',
};
export const clsShort = (c: string) => SHORT[c] ?? clsLabel(c);
/** In running text: lower case, acronyms kept (EWS, C-1). */
export const clsLower = (c: string) => clsShort(c).toLowerCase().replace(/^ews /, 'EWS ').replace('(c-1)', '(C-1)');
export const clsColor = (c: string) => CLASSES[c]?.color ?? '#ccc';

export const DPR_PATH = 'pune/dp-report/';
/** the locality's DP map picture (baked SVG) and share card (JPG), paths under public/ */
export const areaMap = (a: DprArea) => `dpr/pune/map/${a.slug}.svg`;
export const areaCard = (a: DprArea) => `dpr/pune/map/${a.slug}.jpg`;
export const areaPath = (a: DprArea) => `${DPR_PATH}${a.slug}/`;

/** What a reservation of each class usually means, in plain words. */
export const RESERVED_MEANS: Record<string, string> = {
  psp: 'a public or semi-public use: a school, hospital, dispensary, market, community hall, police station or the like',
  recreational: 'a garden, playground or park',
  services: 'a public utility: a water tank, sewage pumping station, fire station, burial ground and similar',
  transport: 'a bus depot, truck terminus, parking lot or other transport use',
  ews: 'housing for the economically weaker section',
  commercial: 'a commercial or market use',
};

export const DPR_FAQ: [string, string][] = [
  ['Is this an official DP remark?', 'No. It is the Pune Municipal Corporation’s sanctioned Development Plan sheets, traced and laid over satellite imagery by UrbanPlan to within a few metres, so you can see what the plan shows around a plot before you ask for the official DP remark (zone certificate) from the PMC. Boundaries can be off by a few metres, and modifications after the sheets were published are not shown.'],
  ['Which areas does it cover?', 'The old limits of the Pune Municipal Corporation: the 21 sheets of the Development Plan 2007–2027 (sanctioned 5 January 2017). Pimpri-Chinchwad, the cantonments, the merged villages and PMRDA areas are not covered yet.'],
  ['What does “reserved” mean?', 'A site the Development Plan keeps for a public purpose: a garden, school, hospital, parking, market and so on. A reservation limits what the owner can build and is usually acquired by the corporation or developed against TDR. The site code printed on the sheet (for example PG 61 for a playground) tells you exactly what for; zoom in on the DP sheet layer to read it.'],
  ['How do I check if a DP road affects my plot?', 'Click your plot on the map. The report lists the DP roads near it with today’s width and the planned width: where the plan is wider, the road may be widened into the plots along it. Switch to the DP sheet layer to see the planned road edges drawn on the sheet itself.'],
  ['Is the report free?', 'Yes. The map and the report on screen are free for anyone. The downloadable PDF is free too: sign in, or create a free account in a minute, and download as many as you like.'],
];
