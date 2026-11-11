// The guides (/guides/ and /guides/<slug>/): a direct answer, a worked example, how to do it in UrbanPlan, questions,
// related guides. The words and rule figures are in src/site/guides/data.ts; the worked examples here are worked out
// with the same rule tables the plot sandbox uses.
import type { ComponentChildren, FunctionComponent } from 'preact';
import { sideMargin, type PlotCode } from '../doc/plot';
import { envelope, f2, FIRE_H, FIRE_W, fsiAt, guide, GUIDES, m2, MARGIN_STEPS, pct, RG_FROM, RG_SHARE, rulesAt, STEPS, type Guide, type Source } from './guides/data';
import { PLACES, type City } from './places/data';
import { APP, href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';
import { DP_CLASSES } from './dpreport/classes';

export const CITY_NAME: Record<City, string> = { pune: 'Pune', mumbai: 'Mumbai' };
const appIn = (city?: City) => (city ? `${APP}?region=${city}` : APP);

const SOURCES: Record<Source, ComponentChildren> = {
  pmc: <><a href="https://www.pmc.gov.in/" rel="noopener">Pune Municipal Corporation</a> (DP remarks, zone certificates and building permission in Pune)</>,
  mcgm: <><a href="https://portal.mcgm.gov.in/" rel="noopener">Municipal Corporation of Greater Mumbai</a> (DP 2034 remarks and building proposals in Mumbai)</>,
  udd: <>the Urban Development Department, Government of Maharashtra, which publishes UDCPR 2020 and DCPR 2034</>,
};

export function Crumbs({ trail }: { trail: [string, string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{trail.map(([label, to]) => <li key={label}>{to !== null ? <a href={href(to)}>{label}</a> : <span aria-current="page">{label}</span>}</li>)}</ol>
    </nav>
  );
}

/** A table of FSI by road width, straight from the rule tables. */
function FsiTable({ code, congested, caption }: { code: PlotCode; congested?: boolean; caption: string }) {
  const steps = STEPS[code === 'udcpr' && congested ? 'udcpr-congested' : code];
  const extra = rulesAt(12, code).ancillary;
  return (
    <div class="table-wrap">
      <table class="rules">
        <caption>{caption}</caption>
        <thead><tr><th>Road width</th><th class="n">Basic</th><th class="n">Premium</th><th class="n">TDR</th><th class="n">Total</th><th class="n">With {code === 'udcpr' ? 'ancillary' : 'fungible'} ({pct(extra)})</th></tr></thead>
        <tbody>
          {steps.map((w, i) => {
            const r = rulesAt(w, code, congested), t = fsiAt(w, code, congested);
            const label = i === steps.length - 1 ? `${w} m and wider` : w === 0 ? `under ${steps[1]} m` : `${w} to ${steps[i + 1]} m`;
            return <tr key={w}><td>{label}</td><td class="n">{f2(r.basic)}</td><td class="n">{f2(r.premium)}</td><td class="n">{f2(r.tdr)}</td><td class="n"><b>{f2(t)}</b></td><td class="n">{f2(t * (1 + r.ancillary))}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

function MarginTable() {
  return (
    <div class="table-wrap">
      <table class="rules">
        <caption>Margins by road width, in {SITE_NAME}’s rule tables (based on UDCPR 2020 Table 6-D)</caption>
        <thead><tr><th>Road width</th><th class="n">Front</th><th class="n">Sides and rear</th><th class="n">… up to a height of</th><th>Above that height</th></tr></thead>
        <tbody>
          {MARGIN_STEPS.map((w, i) => {
            const r = rulesAt(w);
            const label = i === MARGIN_STEPS.length - 1 ? `${w} m and wider` : w === 0 ? `under ${MARGIN_STEPS[1]} m` : `${w} to ${MARGIN_STEPS[i + 1]} m`;
            return <tr key={w}><td>{label}</td><td class="n">{r.front} m</td><td class="n">{r.side} m</td><td class="n">{r.sideTo} m</td><td>a fifth of the height, at most 12 m</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

const Example = ({ children }: { children: ComponentChildren }) => <section class="calc" aria-label="Worked example"><h2>Worked example</h2>{children}</section>;
const Row = ({ k, v, b }: { k: string; v: string; b?: boolean }) => <div><dt>{k}</dt><dd>{b ? <b>{v}</b> : v}</dd></div>;

/** The plot sandbox, step by step (most guides do it this way). */
function SandboxSteps({ city, dp }: { city?: City; dp?: boolean }) {
  return (
    <ol>
      <li><a href={appIn(city)}>Open the editor</a>{city ? ` on ${CITY_NAME[city]}` : ''} and search for your street or area.</li>
      {dp && <li>Turn on <b>DP sheets</b> (the info views at the top left, or <kbd>D</kbd>) to see the Development Plan over today’s map.</li>}
      <li>Press <kbd>F</kbd> for the plot sandbox and click your plot’s corners; they snap to building corners. Press <kbd>Enter</kbd> to finish.</li>
      <li>The panel shows the road the plot fronts, the strip the DP road takes (red), the area left, the FSI for that road width (basic, premium, TDR and ancillary), the footprint inside the margins, and the floors and height that fit, as a glass block in 3D.</li>
      <li>Every rule can be changed for the plot, and the rules can go by the DP width or today’s.</li>
    </ol>
  );
}

const StudioSteps = () => (
  <ol>
    <li>Double-click the plot (or <b>Open in Site Studio</b>). It opens on the most the plot can build: buildings, the internal drive, parking and open space, with the rule checks across the top.</li>
    <li>Try other road widths in the <b>Roads</b> list, or other settings (slabs or towers, floors, flat mix, parking), and it plans again.</li>
    <li>Make the report: eight pages to print or save as PDF.</li>
  </ol>
);

// ---------- each guide's example and how-to ----------

const EX = envelope(40, 25, 12);

const BODY: Record<string, FunctionComponent> = {
  'fsi-calculator-pune': () => (
    <>
      <FsiTable code="udcpr" caption={`FSI by road width outside congested areas, in ${SITE_NAME}’s rule tables (based on UDCPR 2020 Table 6-G, municipal corporations)`} />
      <p>Basic FSI counts on the plot left after the DP road; premium FSI and TDR count on the whole plot. Ancillary FSI ({pct(EX.r.ancillary)} for homes, more for other uses) is worked out on the three together. The old city’s congested areas have their own table:</p>
      <FsiTable code="udcpr" congested caption="FSI by road width in congested areas (based on UDCPR 2020 Table 6-A)" />
      <Example>
        <p>A 1,000 m² plot on a 12 m road, outside the congested area, no DP widening, for homes:</p>
        <dl class="calc-rows">
          <Row k={`Basic, ${f2(EX.r.basic)} × 1,000 m²`} v={m2(EX.r.basic * 1000)} />
          <Row k={`Premium, ${f2(EX.r.premium)} × 1,000 m²`} v={m2(EX.r.premium * 1000)} />
          <Row k={`TDR, ${f2(EX.r.tdr)} × 1,000 m²`} v={m2(EX.r.tdr * 1000)} />
          <Row k={`Ancillary, ${pct(EX.r.ancillary)} of ${m2(EX.consumed)}`} v={m2(EX.consumed * EX.r.ancillary)} />
          <Row k="Built-up area allowed" v={m2(EX.bua)} b />
        </dl>
        <p>That is an FSI of {f2(EX.consumed / 1000)} before ancillary and {f2(EX.bua / 1000)} with it. Whether it all fits is a question of margins and height: see <a href={href('guides/how-much-can-i-build/')}>how much can I build</a>.</p>
      </Example>
      <h2>Do it in {SITE_NAME}</h2>
      <SandboxSteps city="pune" dp />
    </>
  ),

  'fsi-calculator-mumbai': () => {
    const isl = envelope(40, 25, 12, 'dcpr-island'), sub = envelope(40, 25, 12, 'dcpr-suburbs');
    return (
      <>
        <FsiTable code="dcpr-island" caption={`Residential FSI by road width, island city, in ${SITE_NAME}’s rule tables (based on published summaries of DCPR 2034 Table 12)`} />
        <FsiTable code="dcpr-suburbs" caption="Residential FSI by road width, suburbs (same source)" />
        <Example>
          <p>A 1,000 m² residential plot on a 12 m road:</p>
          <dl class="calc-rows">
            <Row k={`Island city: ${f2(isl.r.basic)} + ${f2(isl.r.premium)} + ${f2(isl.r.tdr)} = ${f2(fsiAt(12, 'dcpr-island'))}`} v={m2(isl.consumed)} />
            <Row k={`… with fungible FSI, ${pct(isl.r.ancillary)}`} v={m2(isl.bua)} b />
            <Row k={`Suburbs: ${f2(sub.r.basic)} + ${f2(sub.r.premium)} + ${f2(sub.r.tdr)} = ${f2(fsiAt(12, 'dcpr-suburbs'))}`} v={m2(sub.consumed)} />
            <Row k={`… with fungible FSI, ${pct(sub.r.ancillary)}`} v={m2(sub.bua)} b />
          </dl>
          <p>The same plot builds about {m2(isl.bua - sub.bua)} more in the island city. {SITE_NAME} uses UDCPR’s margins for Mumbai plots as a placeholder, so check how it fits with your architect.</p>
        </Example>
        <h2>Do it in {SITE_NAME}</h2>
        <SandboxSteps city="mumbai" />
        <p>Mumbai’s DP road lines aren’t in {SITE_NAME} yet: if the DP widens your road, type its DP width in Site Studio’s <b>Roads</b> list and the plot and its FSI follow.</p>
      </>
    );
  },

  'how-much-can-i-build': () => (
    <>
      <p>There are three steps, and the plot sandbox does them on the map:</p>
      <ol>
        <li><b>Floor area.</b> Plot area × FSI for the road width, plus ancillary FSI. See the <a href={href('guides/fsi-calculator-pune/')}>Pune</a> and <a href={href('guides/fsi-calculator-mumbai/')}>Mumbai</a> tables.</li>
        <li><b>Footprint.</b> The plot minus the strip the DP road takes, minus the front margin and the side and rear margins. See <a href={href('guides/udcpr-setbacks/')}>setbacks</a>.</li>
        <li><b>Floors.</b> Floor area ÷ footprint, rounded up; but the taller it goes, the wider the side margins and the smaller the footprint, so it’s the lowest number of floors that fits it all.</li>
      </ol>
      <Example>
        <p>A plot 40 m along a 12 m road and 25 m deep (1,000 m²) in Pune, no DP widening, homes on {EX.r.floorH} m floors:</p>
        <dl class="calc-rows">
          <Row k="Built-up area allowed (FSI and ancillary)" v={m2(EX.bua)} />
          <Row k="Front margin" v={`${EX.r.front} m`} />
          <Row k={`Side and rear margins up to ${EX.r.sideTo} m tall`} v={`${EX.r.side} m`} />
          <Row k={`… at ${EX.height} m tall (a fifth of the height)`} v={`${EX.side} m`} />
          <Row k="Footprint at that height" v={`${f2(40 - 2 * EX.side)} × ${f2(25 - EX.r.front - EX.side)} m = ${m2(EX.plate)}`} />
          <Row k="Floors" v={`${EX.floors} floors, ${EX.height} m`} b />
        </dl>
        <p>Kept under {EX.r.sideTo} m, the {m2((40 - 2 * EX.r.side) * (25 - EX.r.front - EX.r.side))} footprint takes {Math.floor(EX.r.sideTo / EX.r.floorH)} floors and uses only {m2(Math.floor(EX.r.sideTo / EX.r.floorH) * (40 - 2 * EX.r.side) * (25 - EX.r.front - EX.r.side))}.
          {EX.height > FIRE_H && EX.side < FIRE_W && ` At ${EX.height} m the building is over ${FIRE_H} m, so Site Studio will also look for a ${FIRE_W} m way round it for a fire tender, which ${EX.side} m margins don’t give. That is the kind of thing the 3D massing shows straight away.`}</p>
      </Example>
      <h2>Do it in {SITE_NAME}</h2>
      <SandboxSteps city="pune" dp />
      <p>Then open it in Site Studio to lay out the actual buildings and parking:</p>
      <StudioSteps />
    </>
  ),

  'dp-road-affects-property': () => (
    <>
      <h2>What to look for</h2>
      <ul>
        <li><b>A wider road line</b> along your frontage: the road is to be widened, and the strip inside the line is reserved.</li>
        <li><b>A new road</b> drawn across or along the plot where there is none today.</li>
        <li><b>A reservation</b> (a code like PG, G or PS with a number) over part of the plot: land kept for a public use.</li>
        <li><b>The zone</b> the plot is coloured in, which decides what it may be used for.</li>
      </ul>
      <Example>
        <p>A plot 40 m along a 9 m road that the DP marks as 15 m, the widening taken equally from both sides:</p>
        <dl class="calc-rows">
          <Row k="Widening on your side, (15 − 9) ÷ 2" v="3 m" />
          <Row k="Strip reserved, 40 m × 3 m" v="120 m²" />
          <Row k="Plot left, of 1,000 m²" v="880 m²" b />
        </dl>
        <p>The front margin is then measured from the new road line, not the old one. What that does to the FSI is worked through in <a href={href('guides/dp-road-widening/')}>what is DP road widening</a>.</p>
      </Example>
      <h2>Do it in {SITE_NAME}</h2>
      <SandboxSteps city="pune" dp />
      <p>The DP layer is traced from the scanned sheets and lined up to within a few metres. If the line is close to your plot, get the DP remark.</p>
    </>
  ),

  'dp-road-widening': () => {
    const today = envelope(40, 25, 9), dp = envelope(40, 25, 15, 'udcpr', 3);
    const credit = dp.r.basic * 120;
    return (
      <>
        <Example>
          <p>A plot 40 m along a 9 m road and 25 m deep (1,000 m²) in Pune. The DP widens the road to 15 m, taking 3 m off the front. In {SITE_NAME}’s rule tables (based on UDCPR 2020):</p>
          <div class="table-wrap">
            <table class="rules">
              <thead><tr><th /><th class="n">Road as it is (9 m)</th><th class="n">As the DP widens it (15 m)</th></tr></thead>
              <tbody>
                <tr><td>Plot area for basic FSI</td><td class="n">1,000 m²</td><td class="n">880 m²</td></tr>
                <tr><td>FSI (basic + premium + TDR)</td><td class="n">{f2(fsiAt(9))}</td><td class="n">{f2(fsiAt(15))}</td></tr>
                <tr><td>Basic</td><td class="n">{m2(today.r.basic * 1000)}</td><td class="n">{m2(dp.r.basic * 880)}</td></tr>
                <tr><td>Premium and TDR, on the whole plot</td><td class="n">{m2((today.r.premium + today.r.tdr) * 1000)}</td><td class="n">{m2((dp.r.premium + dp.r.tdr) * 1000)}</td></tr>
                <tr><td>With ancillary FSI ({pct(dp.r.ancillary)})</td><td class="n"><b>{m2(today.bua)}</b></td><td class="n"><b>{m2(dp.bua)}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p>Here the plot loses 120 m² of land and still gains about {m2(dp.bua - today.bua)} of floor area, because the wider road allows more premium FSI and TDR. If the strip is handed over and its basic FSI counted on the rest of the plot (the sandbox has a switch for it), add {m2(credit)} plus ancillary, {m2(credit * (1 + dp.r.ancillary))} in all. On a deeper or smaller plot, or where the margins bind, the answer can go the other way: work it out for your plot.</p>
        </Example>
        <h2>Do it in {SITE_NAME}</h2>
        <SandboxSteps city="pune" dp />
        <p>In Site Studio, the <b>Roads</b> list lets you try any width for each road, today’s or the DP’s, and see the plot, its FSI and its buildings follow.</p>
      </>
    );
  },

  'udcpr-setbacks': () => {
    const r = rulesAt(12);
    return (
      <>
        <MarginTable />
        <Example>
          <p>A plot on a 12 m road: {r.front} m in front, and at the sides and rear:</p>
          <div class="table-wrap">
            <table class="rules">
              <thead><tr><th>Building height</th>{[r.sideTo, 15, 30, 45, 70].map((h) => <th class="n" key={h}>{h} m</th>)}</tr></thead>
              <tbody><tr><td>Side and rear margin</td>{[r.sideTo, 15, 30, 45, 70].map((h) => <td class="n" key={h}>{f2(sideMargin(r, h))} m</td>)}</tr></tbody>
            </table>
          </div>
          <p>So a 30 m building on a 40 m wide plot keeps {f2(40 - 2 * sideMargin(r, 30))} m of width for itself; at {r.sideTo} m it would keep {f2(40 - 2 * r.side)} m.</p>
        </Example>
        <h2>Do it in {SITE_NAME}</h2>
        <SandboxSteps dp />
        <p>In Site Studio, a building that pushes past the margins at its height turns red, and the report lists the margins with the clause they come from.</p>
      </>
    );
  },

  'tdr-premium-fsi': () => {
    const a = rulesAt(9), b = rulesAt(24);
    return (
      <>
        <h2>How they fit together</h2>
        <ul>
          <li><b>Basic FSI</b> comes with the plot.</li>
          <li><b>Premium FSI</b> is paid for to the authority, up to a cap by road width.</li>
          <li><b>TDR</b> is bought from whoever holds it and loaded, up to a cap by road width.</li>
          <li><b>Ancillary FSI</b> (UDCPR) or <b>fungible FSI</b> (DCPR) is added on top of the three.</li>
        </ul>
        <Example>
          <p>The same 1,000 m² plot in Pune on a 9 m road and on a 24 m road ({SITE_NAME}’s rule tables, based on UDCPR 2020):</p>
          <div class="table-wrap">
            <table class="rules">
              <thead><tr><th /><th class="n">9 m road</th><th class="n">24 m road</th></tr></thead>
              <tbody>
                <tr><td>Basic</td><td class="n">{m2(a.basic * 1000)}</td><td class="n">{m2(b.basic * 1000)}</td></tr>
                <tr><td>Premium (paid to the authority)</td><td class="n">{m2(a.premium * 1000)}</td><td class="n">{m2(b.premium * 1000)}</td></tr>
                <tr><td>TDR (bought and loaded)</td><td class="n">{m2(a.tdr * 1000)}</td><td class="n">{m2(b.tdr * 1000)}</td></tr>
                <tr><td>With ancillary FSI ({pct(a.ancillary)})</td><td class="n"><b>{m2(fsiAt(9) * 1000 * (1 + a.ancillary))}</b></td><td class="n"><b>{m2(fsiAt(24) * 1000 * (1 + b.ancillary))}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p>The difference is all TDR: {m2((b.tdr - a.tdr) * 1000)} more can be loaded on the wider road. Whether it pays depends on the TDR price against what the extra flats sell for, which Site Studio works out.</p>
        </Example>
        <h2>Do it in {SITE_NAME}</h2>
        <SandboxSteps />
        <p>Site Studio has the premium and TDR rates as costs you can change, and the cash flow follows.</p>
      </>
    );
  },

  'road-width-building-height': () => {
    const rows = [9, 12, 15, 24, 30].map((w) => ({ w, e: envelope(40, 25, w) }));
    const short = rows.filter((x) => x.e.bua - x.e.built > 1).map((x) => `${x.w} m`);
    const tall = rows.filter((x) => x.e.height > FIRE_H).map((x) => `${x.w} m`);
    const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
    return (
    <>
      <Example>
        <p>The same plot, 40 m along the road and 25 m deep, in Pune, on roads of different widths (no DP widening, homes on {rows[0].e.r.floorH} m floors). Worked out as the plot sandbox does:</p>
        <div class="table-wrap">
          <table class="rules">
            <thead><tr><th>Road width</th><th class="n">FSI with ancillary</th><th class="n">Floor area allowed</th><th class="n">Floor area that fits</th><th class="n">Floors</th><th class="n">Height</th></tr></thead>
            <tbody>
              {rows.map(({ w, e }) => <tr key={w}><td>{w} m</td><td class="n">{f2(e.bua / 1000)}</td><td class="n">{m2(e.bua)}</td><td class="n">{m2(e.built)}</td><td class="n">{e.floors}</td><td class="n">{e.height} m</td></tr>)}
            </tbody>
          </table>
        </div>
        <p>The road width doesn’t set the height here; the floor area it allows does, together with side margins that widen as the building rises.{short.length > 0 && ` On the ${list(short)} roads they widen faster than the floors add area, so this plot can’t use all it is allowed: a deeper or wider plot could.`}{tall.length > 0 && ` On the ${list(tall)} roads the building is over ${FIRE_H} m and needs a ${FIRE_W} m way round it for a fire tender as well.`}</p>
      </Example>
      <h2>Do it in {SITE_NAME}</h2>
      <SandboxSteps dp />
      <p>The height limit is in the plot’s rules: set it to what applies to your plot (an airport clearance, say) and the envelope follows.</p>
    </>
    );
  },

  '3d-site-context-architecture-students': () => (
    <>
      <Example>
        <p>Say the brief is a library on a site you’ve been given in Pune:</p>
        <ol>
          <li><a href={appIn('pune')}>Open the editor</a>, search for the site and press <kbd>Tab</kbd> for 3D. Fly with <kbd>W A S D</kbd>; right-drag to orbit.</li>
          <li>Switch on <b>satellite</b> or <b>DP sheets</b> under the 3D, and <b>terrain</b> to see the slope.</li>
          <li>Press <kbd>F</kbd> and click the site’s corners. The panel shows its area, the road it fronts and the margins.</li>
          <li>Open it in <b>Site Studio</b> and export the site and its surroundings as DXF, OBJ or glTF.</li>
        </ol>
      </Example>
      <h2>What you get</h2>
      <ul>
        <li>Every building around the site in 3D, roads with their real widths, trees, and the ground’s shape.</li>
        <li>The Pune Development Plan draped over the terrain: zones, reservations and road lines.</li>
        <li>Sections through roads, flyovers and the ground, if the site sits by one.</li>
      </ul>
    </>
  ),

  'plot-feasibility-report': () => (
    <>
      <Example>
        <p>The <a href={href('site/sample-report.html')} target="_blank" rel="noopener">sample report</a> is a real plot on Mangaldas Road, Pune. Open it to see the eight pages: the scheme in 3D, the plans, the rule checks, the area statement, the money and the cash flow.</p>
      </Example>
      <h2>Do it in {SITE_NAME}</h2>
      <SandboxSteps dp />
      <StudioSteps />
      <h2>What it checks</h2>
      <ul>
        <li>FSI, by road width, as the road is or as the DP widens it.</li>
        <li>Height and margins at that height.</li>
        <li>A {FIRE_W} m way round every building over {FIRE_H} m for a fire tender (NBC 2016 Part 4).</li>
        <li>Recreational open space: {pct(RG_SHARE)} of plots of {RG_FROM.toLocaleString('en-IN')} m² and more (UDCPR 2020).</li>
        <li>Parking, bay by bay (UDCPR 2020 Table 8-B).</li>
      </ul>
      <p>Rules flag, never block: a scheme past a rule is shown in amber with what it would take to meet it.</p>
    </>
  ),

  'what-is-development-plan': () => (
    <>
      <h2>What a DP shows</h2>
      <ul>
        <li><b>Zones</b>: what each area may be used for.</li>
        <li><b>Reservations</b>: land kept for schools, gardens, markets, hospitals and so on, each with a code and a number.</li>
        <li><b>Roads</b>: the planned network, with the width each road is to have, including roads to be widened and new ones.</li>
      </ul>
      <Example>
        <p>A street 12 m wide today, drawn 18 m wide on the DP, past a plot partly marked “G” with a number:</p>
        <ul>
          <li>The road is to be widened by 6 m, so the plots along it give up a strip (3 m each if taken equally).</li>
          <li>The part marked G is reserved for a garden: it can’t be built on as the rest of the plot can.</li>
          <li>What the rest may hold comes from the zone and the rules (UDCPR 2020 in Pune), by the road width.</li>
        </ul>
      </Example>
      <h2>See it in {SITE_NAME}</h2>
      <ol>
        <li><a href={appIn('pune')}>Open the editor on Pune</a> and turn on <b>DP sheets</b> (<kbd>D</kbd>) or <b>DP regions</b> in the info views at the top left.</li>
        <li>Switch between 2D and 3D with <kbd>Tab</kbd>: the sheet drapes over the ground.</li>
        <li>Draw a plot (<kbd>F</kbd>) to see what the DP road takes from it and what can be built.</li>
      </ol>
    </>
  ),
  'dp-remark-zone-certificate-pune': () => (
    <>
      <h2>What a DP remark says</h2>
      <ul>
        <li><b>The zone</b> the land is in: residential, commercial, public / semi-public, green and so on.</li>
        <li><b>Any reservation</b> on it, with its code (a garden, school, market, parking…).</li>
        <li><b>Any road line</b>: a planned road, or a widening that takes a strip of the plot.</li>
        <li>Sometimes more: the plan it comes from, the sanction date, notes on modifications.</li>
      </ul>
      <h2>Who to ask in and around Pune</h2>
      <div class="table-wrap">
        <table class="rules">
          <caption>The planning authority depends on where the land is. Each lists its documents and fee at its office or on its portal.</caption>
          <thead><tr><th>Where the land is</th><th>Plan</th><th>Ask</th></tr></thead>
          <tbody>
            <tr><td>Pune, old municipal limits</td><td>PMC Development Plan 2007–2027 (sanctioned 2017)</td><td>Pune Municipal Corporation</td></tr>
            <tr><td>Villages merged into Pune</td><td>Their own DP (in preparation or draft)</td><td>Pune Municipal Corporation</td></tr>
            <tr><td>Pimpri-Chinchwad</td><td>PCMC Development Plan</td><td>Pimpri Chinchwad Municipal Corporation</td></tr>
            <tr><td>Cantonments</td><td>Cantonment land-use plan</td><td>The Cantonment Board</td></tr>
            <tr><td>Rest of the Pune region</td><td>PMRDA Regional / Development Plan</td><td>PMRDA</td></tr>
          </tbody>
        </table>
      </div>
      <Example>
        <p>A buyer is looking at a 1,000 m² plot off Karve Road:</p>
        <ul>
          <li>On the <a href={href('pune/dp-report/karve-road/')}>Karve Road DP plan</a> they click the plot: residential zone, no reservation on it, a site reserved for a public use about 120 m away.</li>
          <li>They switch to the DP sheet layer and see the road in front drawn wider than it is today.</li>
          <li>They apply to the PMC for the DP remark with the CTS number and property card, and ask the architect what the widening takes from the plot and what FSI it brings.</li>
        </ul>
      </Example>
      <h2>Check it yourself first</h2>
      <ol>
        <li>Open the <a href={href('pune/dp-report/')}>Pune DP plan on satellite</a> and search for the road or society.</li>
        <li>Click the plot: its zone, reservations within 250 m and DP roads nearby.</li>
        <li>Download the PDF (free with an account) to take along when you apply.</li>
      </ol>
    </>
  ),

  'check-dp-reservation-pune': () => (
    <>
      <h2>Three ways a plot can be affected</h2>
      <ul>
        <li><b>It is a reserved site</b>: outlined in red on the sheet with a code (PG playground, G garden, H hospital, PS primary school…).</li>
        <li><b>Part of it is reserved</b>: the red outline cuts across the plot.</li>
        <li><b>A DP road crosses it</b>: a new road, or a widening of the road in front. That is a road line, not a reservation, but it also takes land.</li>
      </ul>
      <Example>
        <p>On the <a href={href('pune/dp-report/aundh/')}>Aundh DP plan</a>, 25 sites within 500 m of the centre are reserved, most of them for public and semi-public use. Click any of them in the table on that page and the map flies to it; the DP sheet layer shows the code printed on it.</p>
      </Example>
      <h2>Check yours</h2>
      <ol>
        <li>Open the <a href={href('pune/dp-report/')}>Pune DP plan on satellite</a> and find the plot.</li>
        <li>Click it. A red notice means the plot is in a reserved site; the report also lists reserved sites within 250 m.</li>
        <li>Switch to <b>DP sheet</b> and zoom in to read the reservation’s code and number.</li>
        <li>Confirm with a <a href={href('guides/dp-remark-zone-certificate-pune/')}>DP remark from the PMC</a>.</li>
      </ol>
    </>
  ),

  'pune-dp-colour-code': () => (
    <>
      <h2>Every colour on the Pune DP</h2>
      <div class="table-wrap">
        <table class="rules">
          <caption>The land-use colours of the PMC Development Plan 2007–2027, as calibrated on the scanned sheets (screen colours; printed sheets vary).</caption>
          <thead><tr><th>Colour</th><th>Means</th></tr></thead>
          <tbody>
            {Object.entries(DP_CLASSES).map(([k, c]) => (
              <tr key={k}><td><i class="legend-swatch" style={`display:inline-block;width:28px;height:16px;vertical-align:-3px;background:${c.color};border:1px solid rgba(0,0,0,.25)`} /> <code>{c.color}</code></td><td>{c.label}</td></tr>
            ))}
            <tr><td><i class="legend-swatch" style="display:inline-block;width:28px;height:16px;vertical-align:-3px;border:2px dashed #e5484d" /> red outline</td><td>A site reserved for a public purpose, with its code and number</td></tr>
            <tr><td><i class="legend-swatch" style="display:inline-block;width:28px;height:4px;vertical-align:3px;background:#e5484d" /> red parallel lines</td><td>A planned road or road widening, with its width in metres</td></tr>
          </tbody>
        </table>
      </div>
      <h2>See the colours on your plot</h2>
      <p>The <a href={href('pune/dp-report/')}>Pune DP plan on satellite</a> draws these zones over satellite imagery for the whole of the old PMC limits. Click a plot to see its zone, or switch to the DP sheet layer to see the original colours.</p>
    </>
  ),
};

/** The places of a city, for "see it on the map" links (filled in from src/site/places/data.ts). */
function CityLinks({ city }: { city: City }) {
  const list = PLACES.filter((p) => p.city === city).slice(0, 6);
  return (
    <p class="small">
      More on {CITY_NAME[city]}: <a href={href(`${city}/`)}>{CITY_NAME[city]} on {SITE_NAME}</a>
      {list.map((p) => <span key={p.slug}> · <a href={href(`${city}/${p.slug}/`)}>{p.name}</a></span>)}
    </p>
  );
}

/** The city map pages a guide leads on to. */
const DPR: [string, string] = ['pune/dp-report/', 'Pune DP plan on satellite: check any plot'];
const MAP_LINKS: Record<string, [string, string][]> = {
  'dp-remark-zone-certificate-pune': [DPR, ['pune/dp-map/', 'Pune DP map']],
  'check-dp-reservation-pune': [DPR, ['pune/dp-map/', 'Pune DP map']],
  'pune-dp-colour-code': [DPR, ['mr/pune/dp-map/', 'पुणे विकास आराखडा नकाशा (मराठी)']],
  'dp-road-affects-property': [DPR, ['pune/dp-map/', 'Pune DP map: where the Development Plan is in ' + SITE_NAME], ['mr/pune/dp-map/', 'पुणे विकास आराखडा नकाशा (मराठी)']],
  'dp-road-widening': [['pune/dp-map/', 'Pune DP map: where the DP road widths are traced'], ['pune/road-width-map/', 'Pune road width map']],
  'what-is-development-plan': [DPR, ['pune/dp-map/', 'Pune DP map: the sheets and traced road widths'], ['mr/pune/dp-map/', 'पुणे विकास आराखडा नकाशा (मराठी)']],
  'road-width-building-height': [['pune/road-width-map/', 'Pune road width map'], ['mumbai/road-width-map/', 'Mumbai road width map']],
  'fsi-calculator-pune': [['pune/road-width-map/', 'Pune road width map: how wide the main roads are'], ['pune/dp-map/', 'Pune DP map']],
  'fsi-calculator-mumbai': [['mumbai/road-width-map/', 'Mumbai road width map: how wide the main roads are']],
  'udcpr-setbacks': [['pune/road-width-map/', 'Pune road width map']],
  '3d-site-context-architecture-students': [['pune/map/', 'Pune 3D map'], ['mumbai/map/', 'Mumbai 3D map'], ['data/', 'Open data: the main road networks as GeoJSON']],
  'how-much-can-i-build': [['pune/road-width-map/', 'Pune road width map'], ['mumbai/road-width-map/', 'Mumbai road width map']],
};

/** A guide page by its slug (the view in src/site/views.ts). */
export function GuideBySlug({ slug }: { slug: string }) {
  return <GuidePage guide={guide(slug)!} />;
}

export function GuidePage({ guide: g }: { guide: Guide }) {
  const Body = BODY[g.slug];
  const related = g.related.map(guide).filter((x): x is Guide => !!x);
  return (
    <Page current="guides/">
      <section class="wrap guide">
        <article>
          <Crumbs trail={[['Home', ''], ['Guides', 'guides/'], [g.h1, null]]} />
          <h1>{g.h1}</h1>
          <p class="answer">{g.answer}</p>
          {Body && <Body />}
          <div class="cta-row start">
            <a class="btn btn-primary btn-lg" href={appIn(g.city)}>Try it on your plot <Icon.arrow /></a>
            {g.city && <a class="btn btn-lg" href={href(`${g.city}/`)}>{CITY_NAME[g.city]} on {SITE_NAME}</a>}
          </div>
          {g.city && <CityLinks city={g.city} />}
          {MAP_LINKS[g.slug] && (
            <p class="small">
              On the map: {MAP_LINKS[g.slug].map(([to, label], i) => <span key={to}>{i ? ' · ' : ''}<a href={href(to)} {...(to.startsWith('mr/') ? { lang: 'mr', hrefLang: 'mr' } : {})}>{label}</a></span>)}
            </p>
          )}
          <div class="notice info" role="note">
            <Icon.info />
            <div style="display:grid;gap:6px">
              <p><b>{SITE_NAME} is a survey aid, not an official DP remark or zoning certificate.</b> Its rule tables are starting points; amendments and special schemes change them.</p>
              <p>For the official answer: {g.sources.map((s, i) => <span key={s}>{i ? '; ' : ''}{SOURCES[s]}</span>)}. Check with a licensed architect before you buy, sell or build.</p>
            </div>
          </div>
          <h2>Questions</h2>
          <div class="faq">
            {g.faq.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
          <h2>Related guides</h2>
          <div class="guide-list">
            {related.map((r) => <a key={r.slug} href={href(`guides/${r.slug}/`)}><h3>{r.h1}</h3><p>{r.description}</p></a>)}
          </div>
          <p class="muted small">Updated {new Date(g.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.</p>
        </article>
      </section>
    </Page>
  );
}

export function GuidesIndex() {
  return (
    <Page current="guides/">
      <section class="wrap guide">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Guides', null]]} />
          <h1>Guides</h1>
          <p class="answer">Plain answers on FSI, setbacks, TDR and the Development Plan in Pune and Mumbai, each with a worked example and how to try it on your own plot in {SITE_NAME}.</p>
          <div class="guide-list">
            {GUIDES.map((g) => <a key={g.slug} href={href(`guides/${g.slug}/`)}><span class="eyebrow">{g.city ? CITY_NAME[g.city] : 'Pune and Mumbai'}</span><h2 class="h3">{g.h1}</h2><p>{g.description}</p></a>)}
          </div>
          <p class="muted small">{SITE_NAME} is a survey aid, not an official DP remark or zoning certificate. The rule figures come from {SITE_NAME}’s rule tables, based on UDCPR 2020 and DCPR 2034; check them with the planning authority and a licensed architect.</p>
        </article>
      </section>
    </Page>
  );
}
