// Guides: plain answers to what people in Pune and Mumbai search for (FSI, DP roads, setbacks, TDR …), each with a
// worked example and how to do it in UrbanPlan. Every rule figure is taken from the editor's own rule tables
// (src/doc/plot.ts, through defaultRules) so a guide can't say something the plot sandbox doesn't do; the pages are
// src/site/Guide.tsx, the routes src/site/routes.ts.
import { defaultRules, sideMargin, type PlotCode } from '../../doc/plot';
import type { City } from '../places/data';
import { SITE_NAME } from '../brand';
import { DP_GUIDES } from './dp-guides';

/** where the official answer comes from */
export type Source = 'pmc' | 'mcgm' | 'udd';

export interface Guide {
  slug: string;
  /** the page's <title> (the site name is added) */
  title: string;
  h1: string;
  description: string;
  /** the direct answer: the page's first paragraph */
  answer: string;
  /** the city it's about, if one: links its city page and places */
  city?: City;
  /** last changed (ISO date) */
  updated: string;
  faq: [string, string][];
  related: string[];
  sources: Source[];
}

// ---------- the numbers, from the rule tables ----------

/** basic + premium + TDR on a road this wide (before ancillary / fungible FSI) */
export const fsiAt = (roadW: number, code: PlotCode = 'udcpr', congested = false) => {
  const r = defaultRules(roadW, 'residential', code, congested);
  return r.basic + r.premium + r.tdr;
};
export const rulesAt = (roadW: number, code: PlotCode = 'udcpr', congested = false) => defaultRules(roadW, 'residential', code, congested);
/** the road widths where the tables step (m) */
export const STEPS: Record<PlotCode | 'udcpr-congested', number[]> = {
  udcpr: [0, 9, 12, 15, 24, 30],
  'udcpr-congested': [0, 9, 18, 30],
  'dcpr-island': [0, 9, 12, 18, 27],
  'dcpr-suburbs': [0, 9, 12, 18, 27],
};
export const MARGIN_STEPS = [0, 18, 30];

export const f2 = (n: number) => (Math.round(n * 100) / 100).toString();
export const m2 = (n: number) => `${Math.round(n).toLocaleString('en-IN')} m²`;
export const pct = (n: number) => `${Math.round(n * 100)} %`;

/** A rectangular plot `w` m along one road and `d` m deep, as the plot sandbox works it out: the built-up area the
 *  rules allow (with ancillary / fungible FSI), then the lowest number of floors that fits it inside the margins (the
 *  side margins grow with the height). `lost`: m of depth the DP road takes off the front. */
export function envelope(w: number, d: number, roadW: number, code: PlotCode = 'udcpr', lost = 0) {
  const r = rulesAt(roadW, code);
  const area = w * d, net = w * (d - lost);
  const consumed = r.basic * net + r.premium * area + r.tdr * area;
  const bua = consumed * (1 + r.ancillary);
  const maxFloors = Math.floor(r.maxH / r.floorH + 1e-6);
  let floors = 0, side = r.side, plate = 0, built = 0;
  for (let n = 1; n <= maxFloors; n++) {
    const sd = Math.round(sideMargin(r, n * r.floorH) * 100) / 100;
    const fp = Math.max(0, w - 2 * sd) * Math.max(0, d - lost - r.front - sd);
    if (fp < 1) break;
    const b = Math.min(bua, n * fp);
    if (b > built + 0.5) { built = b; floors = n; side = sd; plate = fp; }
    if (b >= bua) break;
  }
  return { r, area, net, consumed, bua, floors, height: floors * r.floorH, side, plate, built };
}

// fire tender access and open space, as Site Studio checks them (src/doc/site.ts: FIRE_H, FIRE_W, RG_FROM, RG_SHARE;
// kept here as numbers so the website doesn't pull in the site planner)
export const FIRE_H = 15, FIRE_W = 6, RG_FROM = 4000, RG_SHARE = 0.1;

const UPDATED = '2026-11-03';
const P12 = rulesAt(12), P15 = rulesAt(15);
const EX = envelope(40, 25, 12);

export const GUIDES: Guide[] = [
  {
    slug: 'fsi-calculator-pune',
    title: 'FSI calculator for Pune (UDCPR 2020, by road width)',
    h1: 'FSI calculator for Pune',
    description: 'How much FSI a Pune plot gets under UDCPR 2020: basic, premium, TDR and ancillary FSI by road width, a worked example and a free calculator.',
    answer: `In Pune, FSI under UDCPR 2020 comes in layers: a basic FSI of ${f2(P12.basic)} on the plot, premium FSI you pay the corporation for, TDR you buy and load, and ancillary FSI on top of all three. How much premium and TDR a plot can take goes by the width of the road it fronts. In ${SITE_NAME}’s rule tables (based on UDCPR 2020 Table 6-G), that is ${f2(fsiAt(0))} in all on a road under 9 m, rising to ${f2(fsiAt(30))} on a road 30 m or wider, before ancillary FSI of ${pct(P12.ancillary)} for homes.`,
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['What is FSI?', 'Floor Space Index: the floor area you may build divided by the area of the plot. FSI 2 on a 1,000 m² plot allows 2,000 m² of floor area, spread over as many floors as the margins and the height limit allow.'],
      ['Does basic FSI count on the whole plot?', `In ${SITE_NAME}’s model of UDCPR 2020, basic FSI counts on the plot left after the land the Development Plan road takes; premium FSI and TDR count on the whole plot. Ancillary FSI (${pct(rulesAt(12).ancillary)} for homes, ${pct(defaultRules(12, 'commercial').ancillary)} for other uses) is then added on top.`],
      ['Is the old city (peths, gaothan) different?', `Yes. UDCPR has a separate table for congested areas, with a higher basic FSI: in ${SITE_NAME}’s tables ${f2(fsiAt(9, 'udcpr', true))} in all on a 9 m road against ${f2(fsiAt(9))} elsewhere. The plot sandbox has a “Congested area” switch for these plots.`],
      ['Is this the final FSI for my plot?', 'No. It’s a starting point for a feasibility. Amendments, TOD zones, special schemes, reservations and the corporation’s own decisions can change it. The DP remark and your architect’s reading of the current UDCPR text are what count.'],
    ],
    related: ['tdr-premium-fsi', 'how-much-can-i-build', 'udcpr-setbacks', 'fsi-calculator-mumbai'],
    sources: ['pmc', 'udd'],
  },
  {
    slug: 'fsi-calculator-mumbai',
    title: 'FSI calculator for Mumbai (DCPR 2034, by road width)',
    h1: 'FSI calculator for Mumbai',
    description: 'Residential FSI in Mumbai under DCPR 2034: basic, premium, TDR and fungible FSI by road width, island city against suburbs, with a worked example.',
    answer: `In Mumbai, residential FSI under DCPR 2034 is a basic FSI plus premium FSI and TDR that go up with the width of the road the plot fronts, with fungible FSI on top. In ${SITE_NAME}’s rule tables (based on published summaries of DCPR 2034 Table 12), the island city goes from ${f2(fsiAt(0, 'dcpr-island'))} on a road under 9 m to ${f2(fsiAt(27, 'dcpr-island'))} on a road 27 m or wider, and the suburbs from ${f2(fsiAt(0, 'dcpr-suburbs'))} to ${f2(fsiAt(27, 'dcpr-suburbs'))}; fungible FSI adds ${pct(rulesAt(12, 'dcpr-island').ancillary)} of that.`,
    city: 'mumbai',
    updated: UPDATED,
    faq: [
      ['What is fungible FSI?', `Extra floor area DCPR 2034 allows on payment of a premium, worked out as a share of the FSI used. ${SITE_NAME} adds ${pct(rulesAt(12, 'dcpr-island').ancillary)} of the basic, premium and TDR area.`],
      ['Why is the island city different from the suburbs?', `DCPR 2034 sets different basic FSI and different road-width steps for the island city and the suburbs. ${SITE_NAME} picks one or the other from where the plot is.`],
      [`Does ${SITE_NAME} show Mumbai’s DP roads?`, 'Not yet: the Development Plan layer covers Pune. In Mumbai you can type the DP width of each road in Site Studio’s Roads list, and the plot, its FSI and its buildings follow.'],
      ['Can I rely on these numbers?', 'Not on their own. The Mumbai tables come from published summaries, and redevelopment schemes, coastal zone, heritage and airport limits change what a plot can do. Check the current DCPR text and the MCGM’s remarks with your architect.'],
    ],
    related: ['tdr-premium-fsi', 'how-much-can-i-build', 'fsi-calculator-pune', 'plot-feasibility-report'],
    sources: ['mcgm', 'udd'],
  },
  {
    slug: 'how-much-can-i-build',
    title: 'How much can I build on my plot? A worked example',
    h1: 'How much can I build on my plot?',
    description: 'Plot area × FSI for the road gives the floor area; the margins give the footprint and floors. A worked example for a 1,000 m² Pune plot, and a free tool.',
    answer: `Multiply the plot’s area by the FSI for the road it fronts to get the floor area you may build, add ancillary FSI, then see how many floors that takes on the footprint left inside the margins. For a 40 × 25 m plot (1,000 m²) on a 12 m road in Pune, ${SITE_NAME}’s rule tables (based on UDCPR 2020) give ${m2(EX.bua)} of built-up area, which fits as about ${EX.floors} floors of ${m2(EX.plate)}, ${EX.height} m tall.`,
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['Why doesn’t it just stack the plot area up?', `Because the margins come off first: a front margin from the road and side and rear margins round the rest. Above ${P12.sideTo} m the side margins grow with the height (a fifth of it, at most 12 m), so a taller building gets a smaller footprint.`],
      ['Does the Development Plan road change the answer?', 'Often a lot. If the DP widens the road in front, the strip it takes comes off the plot, but the wider road can bring more premium FSI and TDR. See the guide on DP road widening.'],
      ['Is built-up area the same as carpet area?', 'No. Built-up area includes walls, and the ancillary share covers things like staircases and lift lobbies. Carpet area, what a flat is sold by under RERA, is less. Site Studio estimates carpet area per flat.'],
      ['What else can limit it?', `Parking, a fire tender’s way round buildings over ${FIRE_H} m, open space on large plots, height limits near the airport, reservations on the DP, and the plot’s own shape. Site Studio checks the first three as you draw.`],
    ],
    related: ['fsi-calculator-pune', 'udcpr-setbacks', 'road-width-building-height', 'plot-feasibility-report'],
    sources: ['pmc', 'udd'],
  },
  {
    slug: 'dp-road-affects-property',
    title: 'How to check if a DP road affects your property',
    h1: 'Does a DP road affect my property?',
    description: 'How to see if a DP road widening or new road crosses your plot in Pune: the DP sheets, what to look for, FSI, and confirming it with a DP remark.',
    answer: `Find your plot on the Development Plan sheet and see whether the road in front is drawn wider than it is today, or a new road is drawn across it. If the DP road line falls inside your plot, that strip is reserved for the road. ${SITE_NAME} lays the Pune DP sheets over today’s map so you can see it in a minute; the official answer is a DP remark or zone certificate from the Pune Municipal Corporation.`,
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['What is a DP remark?', 'A certificate from the planning authority saying what the Development Plan shows for a survey or CTS number: its zone, any reservation and any road line through it. Banks and buyers ask for it.'],
      [`How accurate is the DP layer in ${SITE_NAME}?`, 'It’s traced from the scanned DP sheets and lined up with the map to within a few metres. That’s enough to see whether a road line is near your plot, not to measure the strip to the centimetre.'],
      ['My building is already there. Does the DP road mean it will be demolished?', 'Not by itself. A DP road line reserves land for widening when the authority acquires it; it matters most when you redevelop or apply for permission. Ask the authority what stage the road is at.'],
      ['Is there anything good about a DP road?', 'Sometimes. A wider road can bring more FSI under the road-width tables, and land handed over for a DP road can earn FSI or TDR in return. Work out both sides before deciding what the plot is worth.'],
    ],
    related: ['dp-road-widening', 'what-is-development-plan', 'how-much-can-i-build', 'plot-feasibility-report'],
    sources: ['pmc'],
  },
  {
    slug: 'dp-road-widening',
    title: 'What is DP road widening, and what it does to a plot',
    h1: 'What is DP road widening?',
    description: 'DP road widening is the wider road a Development Plan reserves along a street: what it takes from a plot, what it gives back in FSI, with an example.',
    answer: 'DP road widening is the Development Plan reserving a street to be wider than it is today: a 9 m road marked to become 15 m, say. The extra width is taken equally or unequally from the plots on either side. On your plot it does two things at once: it takes away the strip inside the new road line, and it can raise the FSI, because premium FSI and TDR go by the width of the road.',
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['Is widening always taken equally from both sides?', 'No. The DP sheet shows where the new road line runs; on many streets more is taken from one side. Look at the line on the sheet, not just the width.'],
      ['Which road width does the FSI go by: today’s or the DP’s?', `${SITE_NAME} uses the DP width when the road has one, and you can switch any plot to today’s width to compare. Which one your authority applies depends on the rules and the stage of the road: ask your architect.`],
      ['Do I get anything for the land the road takes?', 'Land handed over for a DP road can earn FSI or TDR in return under UDCPR. The plot sandbox has a switch to count the strip’s FSI on the rest of the plot, so you can see the difference.'],
      ['Can I build in the widening strip until the road comes?', 'Generally no new permanent building is allowed inside a DP road line. Check what the authority allows for your case.'],
    ],
    related: ['dp-road-affects-property', 'road-width-building-height', 'tdr-premium-fsi', 'what-is-development-plan'],
    sources: ['pmc', 'udd'],
  },
  {
    slug: 'udcpr-setbacks',
    title: 'UDCPR setbacks (margins) explained, by road width',
    h1: 'UDCPR setbacks explained',
    description: 'Front, side and rear margins under UDCPR 2020: how they go by road width and building height, with the margin table and a worked example.',
    answer: `Setbacks, called margins in UDCPR, are the open strips a building must leave between itself and the plot’s edges. The front margin goes by the width of the road; the side and rear margins go by the road width up to a certain height, and above it by the height itself: a fifth of the height, at most 12 m. In ${SITE_NAME}’s rule tables (based on UDCPR 2020 Table 6-D), a plot on a 12 m road keeps ${P12.front} m in front and ${P12.side} m at the sides up to ${P12.sideTo} m of height.`,
    updated: UPDATED,
    faq: [
      ['Is the front margin from the road today or the DP road?', 'From the road’s boundary as the Development Plan sets it. If the DP widens the road, the margin starts at the new road line, so the strip and the margin both come off the plot.'],
      ['What happens on a corner plot?', `Each side that faces a road keeps a front margin. ${SITE_NAME} treats every road-facing edge as a front.`],
      ['Why does a taller building need bigger side margins?', 'For light, air and fire safety between buildings. Above the height in the table, UDCPR asks for a fifth of the building’s height at the sides and rear, up to 12 m.'],
      ['Are these the margins for Mumbai too?', `No. Mumbai follows DCPR 2034, which has its own margins. ${SITE_NAME} uses UDCPR’s margins for Mumbai plots as a placeholder and says so: check them with your architect.`],
    ],
    related: ['how-much-can-i-build', 'road-width-building-height', 'fsi-calculator-pune', 'plot-feasibility-report'],
    sources: ['pmc', 'udd'],
  },
  {
    slug: 'tdr-premium-fsi',
    title: 'TDR and premium FSI: the basics for Pune and Mumbai',
    h1: 'TDR and premium FSI, the basics',
    description: 'Premium FSI is floor area you pay the authority for; TDR is floor area bought from others and loaded on your plot. Both by road width, with an example.',
    answer: `Premium FSI is extra floor area you buy from the planning authority by paying a premium; TDR (Transferable Development Rights) is floor area earned elsewhere, usually by handing land over for a road or a reservation, that you buy and load on your plot. Under both UDCPR 2020 and DCPR 2034, how much of each a plot can take goes up with the width of the road it fronts. In ${SITE_NAME}’s Pune tables, a plot on a 12 m road can take premium FSI of ${f2(P12.premium)} and TDR of ${f2(P12.tdr)} on top of the basic ${f2(P12.basic)}.`,
    updated: UPDATED,
    faq: [
      ['Where does TDR come from?', 'Mostly from owners who hand over land for a DP road or a public reservation, or from slum and other redevelopment schemes. They get a certificate of floor area they can sell.'],
      ['Is TDR cheaper than premium FSI?', 'It depends on the market. TDR is traded at prices set by buyers and sellers; premium FSI is priced by the authority, usually as a share of the land rate. Site Studio has both as costs you can change.'],
      ['Can I load as much TDR as I can buy?', 'No. The road-width tables cap how much each plot can take, and some areas can’t receive TDR at all. Check the receiving rules for your plot.'],
      ['Does ancillary or fungible FSI count TDR too?', `In ${SITE_NAME}’s model, yes: ancillary FSI (UDCPR) and fungible FSI (DCPR) are worked out on the basic, premium and TDR area together.`],
    ],
    related: ['fsi-calculator-pune', 'fsi-calculator-mumbai', 'dp-road-widening', 'how-much-can-i-build'],
    sources: ['pmc', 'mcgm', 'udd'],
  },
  {
    slug: 'road-width-building-height',
    title: 'Road width and building height: how they’re linked',
    h1: 'Does road width limit building height?',
    description: 'How the road in front of a plot shapes how tall a building can go in Pune and Mumbai: FSI and margins by road width, fire access and height limits.',
    answer: `Mostly indirectly. In ${SITE_NAME}’s rule tables (based on UDCPR 2020 and DCPR 2034), the road width sets the FSI and the margins, not a height. The height comes out of them: the floor area the FSI allows, stacked on the footprint left inside the margins. A wider road raises the FSI, so the building goes taller; above ${P12.sideTo} m the side margins grow with the height, which shrinks the footprint and caps how tall it’s worth going. Fire access and airport limits come on top.`,
    updated: UPDATED,
    faq: [
      ['Is there a rule like “height can’t be more than 1.5 times the road width”?', `Rules of that kind have existed in some regulations. ${SITE_NAME} doesn’t apply one: it works height out from FSI and margins, with a height limit you set. Ask your architect what the current UDCPR or DCPR text says for your plot.`],
      [`Why does ${SITE_NAME} show a height limit then?`, `It’s a placeholder for fire and airport clearances: ${rulesAt(12).maxH} m by default in Pune and ${rulesAt(12, 'dcpr-island').maxH} m in Mumbai, and you can change it per plot.`],
      ['What changes above 15 m?', `In ${SITE_NAME}’s checks, a building over ${FIRE_H} m needs a ${FIRE_W} m clear way round it for a fire tender (NBC 2016 Part 4) and two staircases. Site Studio flags a building that doesn’t have the way round.`],
      ['Does a wider DP road mean I can build taller?', 'Usually it means more FSI, so more floor area to fit, which tends to go up. But the strip the road takes and the bigger side margins at height work against it. Try both widths in Site Studio.'],
    ],
    related: ['udcpr-setbacks', 'how-much-can-i-build', 'dp-road-widening', 'fsi-calculator-pune'],
    sources: ['pmc', 'mcgm', 'udd'],
  },
  {
    slug: '3d-site-context-architecture-students',
    title: 'Free 3D site context for architecture students',
    h1: '3D site context for architecture students',
    description: 'A free 3D site context model for a studio in Pune or Mumbai: buildings, roads and terrain round your site, the DP, and exports for SketchUp or Rhino.',
    answer: `Open ${SITE_NAME}, go to your site, and you have the buildings, roads, trees and terrain around it in 3D, with the Development Plan or satellite imagery underneath. Draw the site as a plot, open it in Site Studio, and export the site with its surroundings as DXF, OBJ or glTF for your CAD or 3D software. It runs in the browser and is free during the beta.`,
    updated: UPDATED,
    faq: [
      ['Where do the buildings come from?', 'From OpenStreetMap. Many buildings there have no recorded height, so heights are partly estimated: treat them as massing, not survey data.'],
      ['Is the terrain real?', 'Yes: the Copernicus GLO-30 elevation model, about 30 m resolution, resampled on an 8 m grid. Good for slopes and site sections at the scale of a neighbourhood.'],
      ['Which file format should I use?', 'DXF for plans in CAD, OBJ for most 3D modellers, glTF for Blender and the web. Check what your software imports.'],
      ['Can I cite it in my studio work?', 'Yes, with the attributions: © OpenStreetMap contributors (ODbL), Copernicus DEM GLO-30 © DLR/Airbus, and for Pune DP sheets © Pune Municipal Corporation.'],
    ],
    related: ['what-is-development-plan', 'plot-feasibility-report', 'udcpr-setbacks', 'how-much-can-i-build'],
    sources: ['pmc', 'mcgm'],
  },
  {
    slug: 'plot-feasibility-report',
    title: 'Free plot feasibility report: FSI, parking and returns',
    h1: 'A free plot feasibility report',
    description: 'Draw a plot on the map and get a feasibility report: the DP road strip, FSI by road width, the most it can hold in 3D, parking, checks, costs, cash flow.',
    answer: `Draw your plot in ${SITE_NAME} and open it in Site Studio: it plans the most the rules allow on it, with roads, parking and open space, and makes an eight-page report you can print or save as a PDF. The report has the scheme in 3D, plans to scale, every rule checked with its clause, the area statement, costs, profit and the cash flow. It’s free during the beta.`,
    updated: UPDATED,
    faq: [
      ['What does the report include?', 'The scheme in 3D with its headline figures; the site plan, floor plans and parking decks to scale; every rule with its clause, met or not; the unit mix and area statement; costs, profit, IRR and a month-by-month cash flow; and what a 10 % swing in price or cost does.'],
      ['Which rules does it check?', `FSI, height, margins, fire tender access above ${FIRE_H} m, recreational open space on plots of ${RG_FROM.toLocaleString('en-IN')} m² and more, parking, and road access, using ${SITE_NAME}’s rule tables based on UDCPR 2020 (and DCPR 2034 for Mumbai’s FSI).`],
      ['Are the costs and prices real?', 'They are starting figures for the city, there to be changed: land rate, sale rate, construction cost, premium and TDR rates. Put in your own before showing the numbers to anyone.'],
      ['Can I take it to the bank or the authority?', 'As a first look, yes; as a decision, no. It is a feasibility sketch, not a DP remark, a zone certificate or an architect’s drawing.'],
    ],
    related: ['how-much-can-i-build', 'fsi-calculator-pune', 'fsi-calculator-mumbai', 'dp-road-affects-property'],
    sources: ['pmc', 'mcgm'],
  },
  {
    slug: 'what-is-development-plan',
    title: 'What is a Development Plan (DP)? Zones and road lines',
    h1: 'What is a Development Plan (DP)?',
    description: 'A Development Plan is the city’s statutory land-use plan: zones, reservations and planned roads. What the DP shows, how to read it, and seeing it in Pune.',
    answer: 'A Development Plan (DP) is a city’s statutory plan for how its land is to be used over the next twenty years or so. It colours every part of the city by zone (residential, commercial, industrial, green and so on), marks land reserved for public uses like schools, gardens and markets, and draws the road network the city plans, including roads to be widened. Pune and Mumbai each have one, prepared under the Maharashtra Regional and Town Planning Act.',
    updated: UPDATED,
    faq: [
      ['What is the difference between the DP and the DCR / UDCPR?', 'The DP is the map: zones, reservations and roads. The development control regulations (UDCPR 2020 in Pune, DCPR 2034 in Mumbai) are the rules: FSI, margins, parking and so on. You need both to know what a plot can do.'],
      ['What does a code like “PG 61” on the DP mean?', `A reservation: here play ground number 61. On the ${SITE_NAME} Pune DP plan, switch to the DP sheet layer and zoom in to read the code printed on the sheet over the plot.`],
      ['Where can I see the DP for my area?', `The planning authority publishes the sanctioned DP sheets and issues DP remarks for a plot. For Pune, the ${SITE_NAME} Pune DP plan lays the sheets and the traced zones over satellite imagery: click any plot in the old PMC limits.`],
      ['How often does the DP change?', 'A DP is revised roughly every twenty years, with modifications in between. Always check you are looking at the sanctioned, current version.'],
    ],
    related: ['dp-road-affects-property', 'dp-road-widening', 'fsi-calculator-pune', '3d-site-context-architecture-students'],
    sources: ['pmc', 'mcgm'],
  },
  ...DP_GUIDES,
];

export const guide = (slug: string) => GUIDES.find((g) => g.slug === slug);
