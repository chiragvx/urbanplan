// The DP report for a point, as a page of its own (/pune/dp-report/report/?at=lat,lon): what the traced Development
// Plan says about a plot, read the way a buyer would want it (after AskRera's project reports: a status strip, the
// facts in tiles, the red flags, then the detail). The summary is free for anyone; the rest (the DP sheet, what each
// flag means and what to do, the checklist, the PDF) is free with an account or a link with the share key. The page
// prints as the PDF. Not indexed: a point is whatever someone clicked.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { authReady, logReport, session, startAuth } from '../auth/auth';
import { AREAS, DPR_PATH, RESERVED_MEANS, SUMMARY, areaPath, clsColor, clsLabel, clsShort, type DprArea } from './dpreport/data';
import type { Report } from './dpreport/geo';
import { Crumbs } from './CityMap';
import { Swatch, sqm, shareUnlocked, appAt, CopyLink, Provenance } from './DpReport';
import { href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';
import './place.css';
import './dpreport/dpreport.css';

// ---------------- the flags ----------------

type Sev = 'high' | 'medium' | 'low' | 'info';
interface Flag { sev: Sev; title: string; why: string; todo: string }
const SEV: Record<Sev, string> = { high: 'Check first', medium: 'Worth a look', low: 'Note', info: 'Info' };

/** What on the traced plan a buyer should look into, most serious first. */
export function flagsOf(r: Report): Flag[] {
  const F: Flag[] = [], p = r.parcel;
  if (!r.covered) {
    F.push({ sev: 'info', title: 'Outside the traced plan', why: `This spot isn't on the PMC Development Plan sheets ${SITE_NAME} has traced (the old PMC limits), or that part isn't traced yet.`, todo: 'Ask the planning authority for the area (PMC for merged villages, PCMC, PMRDA) which plan applies, and for a DP remark.' });
    return F;
  }
  if (p?.reserved) {
    F.push({ sev: 'high', title: `Reserved for ${RESERVED_MEANS[p.cls] ?? 'a public use'}`, why: 'The DP keeps this land for a public purpose. It can’t be built on like the zone around it until the reservation is acquired (often for TDR or FSI), developed as the rules allow, or lapses.', todo: 'Read the site code on the DP sheet, ask the PMC for a DP remark, and take a lawyer’s advice on the reservation’s status before you pay anything.' });
  }
  if (!p) {
    F.push({ sev: 'medium', title: 'On a road or open strip in the plan', why: 'The point isn’t inside a zoned parcel. On the sheet it is most likely a road (existing or proposed), a nala, or a gap in the tracing.', todo: 'Pick a point well inside the plot, or read the DP sheet picture to see what the line is.' });
  }
  if (p?.cls === 'hill_slope') F.push({ sev: 'high', title: 'Hill top / hill slope zone', why: 'Building on hill-top and hill-slope land is heavily restricted in Pune: a small fraction of the plot, if any.', todo: 'Check the current hill-top / hill-slope rules with the PMC and an architect before relying on any FSI.' });
  if (p && !p.reserved && (p.cls === 'psp' || p.cls === 'recreational' || p.cls === 'services' || p.cls === 'transport')) {
    F.push({ sev: 'medium', title: `Zoned ${clsShort(p.cls).toLowerCase()}`, why: 'The zone is for public use rather than housing or business. What a private owner may build here is limited.', todo: 'Ask for a DP remark: it says exactly what the zone allows on this land.' });
  }
  for (const d of r.roads) {
    const gap = Math.round((d.dp - d.w) * 10) / 10;
    if (gap < 2 || d.m > 40) continue;
    F.push({
      sev: d.m <= 15 ? 'high' : 'medium', title: `${d.name} may widen from ${d.w} m to ${d.dp} m`,
      why: `The DP width is ${gap} m more than the road today. Widening takes a strip from the plots along it, often about half the increase on each side (~${Math.round(gap * 5) / 10} m), and the road is ${d.m} m from this point.`,
      todo: 'Have a surveyor mark the DP road line on the plot, and ask what FSI or TDR handing the strip over earns.',
    });
  }
  const near = r.reserved.filter((x) => x.p !== p);
  near.filter((x) => x.m <= 100).slice(0, 2).forEach((x) => F.push({
    sev: 'medium', title: `A ${clsShort(x.p.cls).toLowerCase()} reservation ${x.m} m ${x.dir}`,
    why: `The DP keeps ${sqm(x.p.area)} next door for ${RESERVED_MEANS[x.p.cls] ?? 'a public use'}. It doesn’t change this plot’s zone, but it shapes the neighbourhood when it’s built.`,
    todo: 'Read its site code on the DP sheet to see what exactly is planned.',
  }));
  const far = near.filter((x) => x.m > 100).length;
  if (far) F.push({ sev: 'low', title: `${far} more reserved site${far > 1 ? 's' : ''} within 250 m`, why: 'Public uses the plan keeps land for around this plot.', todo: 'See the table below; open each on the map.' });
  const order: Sev[] = ['high', 'medium', 'low', 'info'];
  return F.sort((a, b) => order.indexOf(a.sev) - order.indexOf(b.sev));
}

// ---------------- the page ----------------

interface PlaceName { title: string; sub: string }

/** "Off DP Road, Aundh": a name for the point (OpenStreetMap Nominatim, once per page). */
async function nameOf(lat: number, lon: number): Promise<PlaceName | null> {
  try {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`;
    const j = await (await fetch(u, { headers: { 'Accept-Language': 'en' } })).json();
    const a = j.address ?? {};
    const road = a.road ?? a.pedestrian ?? a.residential;
    const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
    if (!road && !area) return null;
    return { title: road ? `${road}${area ? `, ${area}` : ''}` : area, sub: [a.suburb, a.city ?? 'Pune', a.postcode].filter(Boolean).join(', ') };
  } catch { return null; }
}

const nearestArea = (lat: number, lon: number): DprArea | undefined => {
  let best: DprArea | undefined, d = Infinity;
  for (const a of AREAS) { const x = Math.hypot((a.lat - lat) * 110.5, (a.lon - lon) * 105.6); if (x < d) { d = x; best = a; } }
  return d <= 2.5 ? best : undefined;
};

function useMay() {
  // may this visitor see the whole report: signed in, opened with the share key, or no accounts on this build
  const [may, setMay] = useState<boolean | null>(null);
  useEffect(() => {
    void (async () => {
      if (!authReady || (await shareUnlocked())) return true;
      const c = await startAuth();
      return !!(c && (await c.auth.getSession()).data.session);
    })().then(setMay);
  }, [session.value]);
  return may;
}

/** A locked section: its contents for those who may, a card saying what's in it (and how to get it) for the rest. */
function Locked({ may, has, children }: { may: boolean | null; has: string[]; children: ComponentChildren }) {
  if (may) return <>{children}</>;
  const back = typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '';
  return (
    <div class="rpt-lock">
      <p class="rpt-lock-h"><Icon.user /><span><b>In the full report</b>, free with an account:</span></p>
      <ul>{has.map((x) => <li key={x}><Icon.check />{x}</li>)}</ul>
      <div class="rpt-lock-cta">
        <a class="btn btn-primary" href={href(`login/?next=${encodeURIComponent(back)}`)}>Sign in to see it</a>
        <a class="btn" href={href(`signup/?next=${encodeURIComponent(back)}`)}>Create a free account</a>
      </div>
    </div>
  );
}

const today = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function DpReportPage() {
  const [at, setAt] = useState<[number, number] | null | undefined>(undefined);
  const [r, setR] = useState<Report | null>(null);
  const [name, setName] = useState<PlaceName | null>(null);
  const [pics, setPics] = useState<[string, string] | null>(null);
  const may = useMay();

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('at')?.split(',').map(Number);
    const ok = q && q.length >= 2 && q.every(Number.isFinite) && Math.abs(q[0] - 18.52) < 1 && Math.abs(q[1] - 73.86) < 1;
    setAt(ok ? [q![0], q![1]] : null);
    if (!ok) return;
    const [la, lo] = q!;
    void import('./dpreport/geo').then(({ reportAt }) => reportAt(la, lo)).then((x) => {
      setR(x);
      void import('./dpreport/print').then(({ reportPictures }) => reportPictures(la, lo, x.parcel, 960, 640)).then(setPics).catch(() => {});
    });
    void nameOf(la, lo).then(setName);
  }, []);
  useEffect(() => { if (may && r) void logReport({ lat: r.lat, lon: r.lon, area: nearestArea(r.lat, r.lon)?.slug, cls: r.parcel?.cls }); }, [may, !!r]);

  if (at === null) {
    return (
      <Page>
        <section class="wrap guide place dpr"><article class="wide">
          <Crumbs trail={[['Home', ''], ['Pune', 'pune/'], ['Pune DP plan', DPR_PATH], ['DP report', null]]} />
          <h1>DP report</h1>
          <p class="answer">This link doesn’t say which plot. Open the <a href={href(DPR_PATH)}>Pune DP plan</a>, click a plot and press <b>Full report</b>.</p>
        </article></section>
      </Page>
    );
  }

  const area = at ? nearestArea(at[0], at[1]) : undefined;
  const p = r?.parcel ?? null, flags = r ? flagsOf(r) : [];
  const road = r?.roads[0];
  const mapHref = area ? `${href(areaPath(area))}?at=${at![0].toFixed(5)},${at![1].toFixed(5)}#viewer` : `${href(DPR_PATH)}?at=${at?.[0].toFixed(5)},${at?.[1].toFixed(5)}#viewer`;
  const red = flags.filter((f) => f.sev === 'high' || f.sev === 'medium').length;

  return (
    <Page>
      <section class="wrap guide place dpr rpt">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Pune', 'pune/'], ['Pune DP plan', DPR_PATH], ...(area ? [[area.name, areaPath(area)] as [string, string]] : []), ['DP report', null]]} />

          <div class="rpt-strip" aria-label="At a glance">
            {p ? <span class="rpt-chip"><Swatch cls={p.cls} /> {clsShort(p.cls)}</span> : r && <span class="rpt-chip">{r.covered ? 'Road / open strip' : 'Not traced'}</span>}
            {p && <span class={`rpt-chip ${p.reserved ? 'bad' : 'good'}`}>{p.reserved ? 'Reserved' : 'Not reserved'}</span>}
            {road && <span class="rpt-chip">{road.name}: {road.w} → <b>{road.dp} m</b></span>}
            {r && <a class={`rpt-chip ${red ? 'warn' : 'good'}`} href="#flags">{red ? `${red} red flag${red > 1 ? 's' : ''}` : 'No red flags'} →</a>}
          </div>

          <h1>{name?.title ?? (area ? `A plot near ${area.name}` : 'A plot in Pune')}<span class="rpt-h1-sub">DP report</span></h1>
          <p class="rpt-lede">{name?.sub ? `${name.sub} · ` : ''}{at ? `${at[0].toFixed(5)}, ${at[1].toFixed(5)}` : ''}</p>
          <p class="rpt-stamp"><Icon.info /> Plan: PMC Development Plan 2007–2027, sanctioned 5 Jan 2017 · traced {SUMMARY.baked} · report made {today()} · <a href={mapHref}>See it on the map</a></p>

          {!r ? <p class="rpt-loading">Reading the plan…</p> : (
            <>
              <div class="rpt-tiles">
                <div><span>DP zone</span><b>{p ? <><Swatch cls={p.cls} /> {clsLabel(p.cls)}</> : r.covered ? 'Road / open strip' : 'Not traced'}</b></div>
                <div class={p?.reserved ? 'bad' : ''}><span>Reservation</span><b>{p?.reserved ? `Reserved: ${RESERVED_MEANS[p.cls] ?? 'public use'}` : p ? 'None on this parcel' : '—'}</b></div>
                <div><span>Parcel on the sheet</span><b>{p ? sqm(p.area) : '—'}</b><small>{p ? `sheet ${p.sheet}` : ''}</small></div>
                <div class={road && road.dp - road.w >= 2 && road.m <= 40 ? 'warn' : ''}><span>Nearest DP road</span><b>{road ? `${road.dp} m` : 'None traced'}</b><small>{road ? `${road.name}, ${road.m} m away, ${road.w} m today` : 'within 150 m'}</small></div>
              </div>

              <div class="rpt-pics">
                <figure>
                  {pics ? <img src={pics[0]} alt="Satellite image with the traced DP zones: reserved sites dashed red, this parcel in blue." /> : <div class="rpt-pic-wait" />}
                  <figcaption>Satellite with the traced DP zones: reserved sites dashed red, the parcel in blue.</figcaption>
                </figure>
                <figure>
                  <Locked may={may} has={['The PMC’s DP sheet over this plot, registered to the satellite image']}>
                    {pics ? <img src={pics[1]} alt="The PMC DP sheet over the satellite image, centred on this point." /> : <div class="rpt-pic-wait" />}
                  </Locked>
                  <figcaption>The PMC DP sheet, registered over the satellite image.</figcaption>
                </figure>
              </div>

              <h2 id="flags">Red flags {flags.length ? <span class="rpt-count">{flags.length}</span> : null}</h2>
              {flags.length ? (
                <ol class="rpt-flags">
                  {flags.map((f) => (
                    <li key={f.title} class={`sev-${f.sev}`}>
                      <span class="rpt-sev">{SEV[f.sev]}</span>
                      <h3>{f.title}</h3>
                      {may ? <><p>{f.why}</p><p class="rpt-todo"><b>What to do:</b> {f.todo}</p></> : <p class="rpt-blur" aria-hidden="true">{f.why}</p>}
                    </li>
                  ))}
                </ol>
              ) : <p class="notice ok"><Icon.check /><span><b>Nothing flagged on the traced plan.</b> No reservation on this parcel, no DP widening within 40 m, no reserved site within 100 m. Still get a DP remark before you buy.</span></p>}
              {!may && flags.length > 0 && <Locked may={may} has={['What each flag means for this plot', 'What to do about it, step by step']}>{null}</Locked>}

              <h2>DP roads within 150 m</h2>
              {r.roads.length ? (
                <div class="table-wrap"><table class="rules">
                  <thead><tr><th>Road</th><th class="n">Away</th><th class="n">Today</th><th class="n">In the DP</th><th class="n">Change</th></tr></thead>
                  <tbody>{r.roads.map((d) => { const g = Math.round((d.dp - d.w) * 10) / 10; return <tr key={d.name}><td>{d.name}</td><td class="n">{d.m} m</td><td class="n">{d.w} m</td><td class="n"><b>{d.dp} m</b></td><td class={`n ${g >= 2 ? 'dpr-warn' : ''}`}>{g > 0 ? `+${g} m` : '—'}</td></tr>; })}</tbody>
                </table></div>
              ) : <p class="muted">No DP road width traced within 150 m yet. The DP sheet shows the road widths.</p>}

              <h2>Reserved sites within 250 m</h2>
              {r.reserved.length ? (
                <div class="table-wrap"><table class="rules">
                  <thead><tr><th>Reserved for</th><th class="n">Area</th><th>Where</th></tr></thead>
                  <tbody>{r.reserved.map((x) => <tr key={x.p.id}><td><Swatch cls={x.p.cls} /> {RESERVED_MEANS[x.p.cls] ?? clsShort(x.p.cls)}</td><td class="n">{sqm(x.p.area)}</td><td>{x.m ? `${x.m} m ${x.dir}` : <b>This plot</b>}</td></tr>)}</tbody>
                </table></div>
              ) : <p class="muted">None traced within 250 m.</p>}

              <h2>Land use within 100 m</h2>
              {r.mix.length ? (
                <>
                  <div class="dpr-bar big" role="img" aria-label={r.mix.map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(', ')}>{r.mix.map((m) => <span key={m.cls} style={`width:${m.pct}%;background:${clsColor(m.cls)}`} />)}</div>
                  <p class="small muted">{r.mix.map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(' · ')}{r.unmarked ? ` · roads / untraced ${r.unmarked}%` : ''}</p>
                </>
              ) : <p class="muted">Not traced here.</p>}

              <h2>What to verify before you buy</h2>
              <Locked may={may} has={['A checklist for this plot: the DP remark, the land records, the road line, the reservation’s status', 'Links to how each is done in Pune']}>
                <ol class="rpt-check">
                  <li><b>A DP remark (zone certificate) from the PMC</b> for the survey or CTS number: the official word on the zone, any reservation and the road lines. <a href={href('guides/dp-remark-zone-certificate-pune/')}>How to get one</a></li>
                  <li><b>The land records</b>: the 7/12 extract or property card, and that the survey / CTS number on them is this plot.</li>
                  {flags.some((f) => /widen/.test(f.title)) && <li><b>The DP road line on the ground</b>: a licensed surveyor marks how much of the frontage the widening takes. <a href={href('guides/dp-road-affects-property/')}>What a DP road means for a property</a></li>}
                  {(p?.reserved || r.reserved.some((x) => x.m <= 100)) && <li><b>The reservation’s status</b>: acquired, handed over for TDR, being developed or lapsed. <a href={href('guides/check-dp-reservation-pune/')}>How to check</a></li>}
                  <li><b>Changes since 2017</b>: the PMC modifies the DP from time to time; ask whether any modification touches this land.</li>
                  <li><b>A title search</b> by a lawyer before you sign: the DP says what may be built, not who owns it.</li>
                </ol>
              </Locked>

              <div class="rpt-actions no-print">
                {may ? <button class="btn btn-primary" onClick={() => window.print()}><Icon.sheet /> Download PDF</button>
                  : <a class="btn btn-primary" href={href(`login/?next=${encodeURIComponent(`${location.pathname}${location.search}`)}`)}><Icon.sheet /> Sign in to download the PDF</a>}
                <CopyLink hash="" />
                <a class="btn" href={mapHref}><Icon.pin /> Back to the map</a>
                <a class="btn" href={appAt(r.lat, r.lon)}><Icon.cube /> Open in 3D</a>
              </div>
            </>
          )}

          <p class="rpt-disclaimer"><b>Not an official DP remark.</b> Traced by {SITE_NAME} from the Pune Municipal Corporation’s Development Plan for the old limits (2007–2027, sanctioned 5 January 2017), registered to within a few metres. Modifications after the sheets were published aren’t shown. For the legal position, apply to the PMC for a DP remark or zone certificate. Imagery © Esri, Maxar, Earthstar Geographics · DP sheets © PMC · Roads and names © OpenStreetMap contributors (ODbL).</p>
          <div class="no-print"><Provenance /></div>
        </article>
      </section>
    </Page>
  );
}
