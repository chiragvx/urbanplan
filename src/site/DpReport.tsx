// The DP report (/pune/dp-report/ and a page per locality, /pune/dp-report/<slug>/): Pune's Development Plan on
// satellite imagery. The map and the on-screen report are free for anyone (and the pages are prerendered, so search
// engines index them); the PDF download asks for an email sign-in once, then is free too.
// Data: src/site/dpreport/ (baked by tools/dpreport/bake-dpreport.ts; the viewer loads public/dpr/<city>/).
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { authReady, emailLink, explain, logReport, startAuth } from '../auth/auth';
import { AREAS, SUMMARY, DPR_FAQ, DPR_PATH, RESERVED_MEANS, areaOf, areaPath, clsColor, clsLower, clsLabel, clsShort, type DprArea } from './dpreport/data';
import type { Report } from './dpreport/geo';
import type { DpMap, Overlay } from './dpreport/map';
import { Crumbs } from './CityMap';
import { NotFoundBody } from './NotFound';
import { APP, href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';
import './place.css';
import './dpreport/dpreport.css';

const n = (v: number) => v.toLocaleString('en-IN');
const areaText = (ha: number) => (ha >= 1 ? `${ha.toFixed(ha >= 10 ? 0 : 1)} ha` : `${n(Math.round(ha * 1e4 / 10) * 10)} m²`);
const sqm = (m2: number) => (m2 >= 1e4 ? `${(m2 / 1e4).toFixed(1)} ha` : `${n(Math.round(m2 / 10) * 10)} m²`);
const Swatch = ({ cls }: { cls: string }) => <i class="legend-swatch" style={`background:${clsColor(cls)};border:1px solid rgba(0,0,0,.25)`} />;
const appAt = (lat: number, lon: number) => `${APP}?region=pune&at=${lat.toFixed(5)},${lon.toFixed(5)},18`;

/** a reserved site or a table row asks the viewer to show a point (the links still work without JS: ?at=…#viewer) */
const pickRequest = signal<{ lat: number; lon: number; t: number } | null>(null);
const showAt = (lat: number, lon: number) => (e: Event) => {
  e.preventDefault();
  pickRequest.value = { lat, lon, t: Date.now() };
  document.getElementById('viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
const atHref = (lat: number, lon: number) => `?at=${lat.toFixed(5)},${lon.toFixed(5)}#viewer`;

// ---------------- the viewer ----------------

const OVERLAYS: [Overlay, string, string][] = [
  ['zones', 'DP zones', 'The traced land use of the Development Plan, coloured; reserved sites outlined in red'],
  ['sheet', 'DP sheet', 'The scanned DP sheet itself, laid over the satellite image'],
  ['none', 'Satellite', 'The satellite image alone'],
];

function Viewer({ lat, lon, zoom, ring, area }: { lat: number; lon: number; zoom: number; ring?: number; area?: DprArea }) {
  const el = useRef<HTMLDivElement>(null);
  const M = useRef<DpMap | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('zones');
  const [opacity, setOpacity] = useState(0.6);
  const [labels, setLabels] = useState(true);
  const [z, setZ] = useState(zoom);
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [wantDl, setWantDl] = useState(false);

  const pick = async (la: number, lo: number, fly = false) => {
    M.current?.pick(la, lo, fly);
    setBusy(true);
    const { reportAt } = await import('./dpreport/geo');
    const r = await reportAt(la, lo);
    setRep(r); setBusy(false);
    M.current?.highlight(r.parcel);
    const q = new URLSearchParams(location.search); q.set('at', `${la.toFixed(5)},${lo.toFixed(5)}`); q.delete('dl');
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  };

  useEffect(() => {
    let dead = false;
    const q = new URLSearchParams(location.search), at = q.get('at')?.split(',').map(Number);
    const start = at && at.length >= 2 && at.every(Number.isFinite) ? { lat: at[0], lon: at[1] } : null;
    if (q.get('dl') === '1') setWantDl(true);
    import('./dpreport/map').then(({ createMap }) => createMap(el.current!, {
      lat: start?.lat ?? lat, lon: start?.lon ?? lon, zoom: start ? 18 : zoom, overlay: 'zones', opacity: 0.6,
      ring: ring ? { lat, lon, r: ring } : undefined,
      onPick: (a, b) => void pick(a, b), onZoom: setZ,
    })).then((m) => {
      if (dead) { m.destroy(); return; }
      M.current = m;
      if (start) void pick(start.lat, start.lon);
    }).catch((e) => { console.error(e); setFailed(true); });
    return () => { dead = true; M.current?.destroy(); M.current = null; };
  }, []);

  useEffect(() => { const p = pickRequest.value; if (p && M.current) void pick(p.lat, p.lon, true); }, [pickRequest.value]);

  const search = async (text: string) => {
    if (!text.trim()) return null;
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&bounded=1&viewbox=73.73,18.645,73.995,18.40&q=${encodeURIComponent(text + ', Pune')}`;
    const r = await fetch(u, { headers: { Accept: 'application/json' } }).then((x) => x.json()).catch(() => []);
    if (!r[0]) return `Couldn't find “${text}” in Pune. Try a road, society or landmark, or zoom the map.`;
    const la = +r[0].lat, lo = +r[0].lon;
    M.current?.flyTo(la, lo, 17);
    void pick(la, lo);
    return null;
  };

  return (
    <section class="dpr-viewer" id="viewer" aria-label="Pune DP map on satellite imagery">
      <div class="dpr-stage">
        <div class="dpr-map" ref={el} role="application" aria-label="Map: click a plot to see what the Development Plan says there">
          <noscript><p class="dpr-noscript">The map needs JavaScript. The numbers for this area are below.</p></noscript>
        </div>
        <div class="dpr-tools">
          <Search onSearch={search} />
          <div class="dpr-seg" role="radiogroup" aria-label="Layer over the satellite image">
            {OVERLAYS.map(([k, label, tip]) => (
              <button key={k} role="radio" aria-checked={overlay === k} title={tip} class={overlay === k ? 'on' : ''}
                onClick={() => { setOverlay(k); M.current?.setOverlay(k); }}>{label}</button>
            ))}
          </div>
          {overlay !== 'none' && (
            <label class="dpr-opacity" title="How strongly the plan shows over the satellite image">
              <span class="sr-only">Plan opacity</span>
              <input type="range" min={0.15} max={1} step={0.05} value={opacity} onInput={(e) => { const v = +(e.target as HTMLInputElement).value; setOpacity(v); M.current?.setOpacity(v); }} />
            </label>
          )}
          <button class={`dpr-chip ${labels ? 'on' : ''}`} aria-pressed={labels} title="Road and place names" onClick={() => { setLabels(!labels); M.current?.setLabels(!labels); }}>Names</button>
        </div>
        {z < 14 && !failed && <div class="dpr-hint">Zoom in to see the plan, or click a locality below</div>}
        {failed && <div class="dpr-hint">The map couldn't load. Check your connection and reload the page.</div>}
      </div>
      <aside class="dpr-panel" aria-live="polite">
        {rep ? <ReportCard r={rep} area={area} busy={busy} wantDl={wantDl} /> : (
          <div class="dpr-empty">
            <Icon.pin />
            <h2 class="h3">Click any plot on the map</h2>
            <p>See its Development Plan zone, any site reserved for public use nearby and the DP roads around it, on the satellite image. Free, no sign-in.</p>
            <OverlayLegend />
          </div>
        )}
      </aside>
    </section>
  );
}

function Search({ onSearch }: { onSearch: (t: string) => Promise<string | null> }) {
  const [t, setT] = useState(''), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  return (
    <form class="dpr-search" role="search" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setMsg(await onSearch(t)); setBusy(false); }}>
      <label class="sr-only" for="dpr-q">Find a place in Pune</label>
      <input id="dpr-q" class="input" type="search" placeholder="Find a road, society or landmark" value={t} onInput={(e) => setT((e.target as HTMLInputElement).value)} />
      <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? '…' : 'Go'}</button>
      {msg && <p class="dpr-search-msg" role="status">{msg}</p>}
    </form>
  );
}

function OverlayLegend() {
  const main = ['residential', 'commercial', 'psp', 'recreational', 'ews', 'industrial', 'hill_slope', 'defence'];
  return (
    <ul class="dpr-legend">
      {main.map((c) => <li key={c}><Swatch cls={c} /> {clsShort(c)}</li>)}
      <li><i class="legend-swatch dpr-res" /> Reserved site</li>
      <li><i class="legend-swatch dpr-road" /> DP road width traced</li>
    </ul>
  );
}

// ---------------- the report for a point ----------------

function ReportCard({ r, area, busy, wantDl }: { r: Report; area?: DprArea; busy: boolean; wantDl: boolean }) {
  const p = r.parcel;
  return (
    <div class={`dpr-report ${busy ? 'busy' : ''}`}>
      <p class="eyebrow">DP report · {r.lat.toFixed(5)}, {r.lon.toFixed(5)}</p>
      {!r.covered ? (
        <>
          <h2 class="h3">Outside the traced plan</h2>
          <p>This spot isn't on the 21 sheets of the PMC Development Plan that {SITE_NAME} has (the old PMC limits), or that part of the sheet isn't traced yet. Switch to <b>DP sheet</b> to check the scan itself.</p>
        </>
      ) : p ? (
        <>
          <h2 class="h3 dpr-zone"><Swatch cls={p.cls} /> {clsLabel(p.cls)}</h2>
          {p.reserved
            ? <p class="notice error dpr-flag"><Icon.info /><span><b>Reserved for a public purpose.</b> This plot is a site the DP keeps for {RESERVED_MEANS[p.cls] ?? 'a public use'}. Read the site code on the DP sheet layer.</span></p>
            : <p class="small muted">Zone in the sanctioned DP. The parcel measures about {sqm(p.area)} on the sheet.</p>}
        </>
      ) : (
        <>
          <h2 class="h3">A road or open strip on the plan</h2>
          <p class="small muted">This point isn't inside a zoned parcel: on the DP sheet it is most likely a road (existing or proposed), a nala or a gap in the tracing. Check the <b>DP sheet</b> layer.</p>
        </>
      )}

      {r.roads.length > 0 && (
        <>
          <h3>DP roads nearby</h3>
          <ul class="dpr-list">
            {r.roads.map((d) => {
              const gap = Math.round((d.dp - d.w) * 10) / 10;
              return <li key={d.name}><b>{d.name}</b> · {d.m} m away<br /><span class="small">{d.w} m today → <b>{d.dp} m</b> in the DP{gap >= 2 ? <span class="dpr-warn"> · may widen by ~{gap} m</span> : ''}</span></li>;
            })}
          </ul>
        </>
      )}

      {r.reserved.filter((x) => x.p !== p).length > 0 && (
        <>
          <h3>Reserved sites within 250 m</h3>
          <ul class="dpr-list">
            {r.reserved.filter((x) => x.p !== p).map((x) => <li key={x.p.id}><Swatch cls={x.p.cls} /> {clsShort(x.p.cls)} · {sqm(x.p.area)} · {x.m} m {x.dir}</li>)}
          </ul>
        </>
      )}

      {r.mix.length > 0 && (
        <>
          <h3>Within 100 m</h3>
          <div class="dpr-bar" role="img" aria-label={r.mix.map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(', ')}>
            {r.mix.map((m) => <span key={m.cls} style={`width:${m.pct}%;background:${clsColor(m.cls)}`} title={`${clsShort(m.cls)} ${m.pct}%`} />)}
          </div>
          <p class="small muted">{r.mix.slice(0, 3).map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(' · ')}{r.unmarked ? ` · roads / untraced ${r.unmarked}%` : ''}</p>
        </>
      )}

      <Download r={r} area={area} auto={wantDl} />
      <div class="dpr-actions">
        <button class="btn" onClick={() => { void navigator.clipboard?.writeText(location.href); }} title="Copy a link to this report"><Icon.share /> Copy link</button>
        <a class="btn" href={appAt(r.lat, r.lon)}><Icon.cube /> Open in 3D</a>
      </div>
      <p class="tiny muted">Traced from the PMC's sanctioned DP sheets, accurate to a few metres. A survey aid, not an official DP remark or zone certificate.</p>
    </div>
  );
}

// ---------------- the download (email sign-in, then free) ----------------

type Dl = 'idle' | 'ask' | 'sending' | 'sent' | 'making' | 'ready';

function Download({ r, area, auto }: { r: Report; area?: DprArea; auto: boolean }) {
  const [st, setSt] = useState<Dl>('idle');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [pics, setPics] = useState<[string, string] | null>(null);

  const signedIn = async () => {
    if (!authReady) return true; // accounts not set up on this build: nothing to ask
    const c = await startAuth();
    return !!(c && (await c.auth.getSession()).data.session);
  };
  const make = async () => {
    setSt('making'); setErr('');
    try {
      const { reportPictures } = await import('./dpreport/print');
      setPics(await reportPictures(r.lat, r.lon, r.parcel));
      setSt('ready');
      void logReport({ lat: r.lat, lon: r.lon, area: area?.slug, cls: r.parcel?.cls });
      requestAnimationFrame(() => setTimeout(() => window.print(), 150));
    } catch (e) { setErr(explain(e)); setSt('idle'); }
  };
  const start = async () => { setErr(''); if (await signedIn()) await make(); else setSt('ask'); };
  useEffect(() => { if (auto) void signedIn().then((ok) => ok && setSt('idle')); }, []);

  const send = async (e: Event) => {
    e.preventDefault(); setSt('sending'); setErr('');
    try {
      const u = new URL(location.href); u.searchParams.set('at', `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`); u.searchParams.set('dl', '1'); u.hash = 'viewer';
      await emailLink(email.trim(), u.toString());
      setSt('sent');
    } catch (x) { setErr(explain(x)); setSt('ask'); }
  };

  return (
    <div class="dpr-dl">
      {(st === 'idle' || st === 'making' || st === 'ready') && (
        <button class={`btn btn-primary btn-block ${auto ? 'pulse' : ''}`} onClick={() => void (st === 'ready' ? window.print() : start())} disabled={st === 'making'}>
          <Icon.sheet /> {st === 'making' ? 'Making the PDF…' : auto ? 'Download your report (PDF)' : 'Download the report (PDF)'}
        </button>
      )}
      {(st === 'ask' || st === 'sending') && (
        <form class="dpr-gate" onSubmit={send}>
          <label for="dpr-email"><b>Free PDF.</b> Enter your email: we'll send a sign-in link that brings you back here to download.</label>
          <div class="dpr-gate-row">
            <input id="dpr-email" class="input" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <button class="btn btn-primary" type="submit" disabled={st === 'sending'}>{st === 'sending' ? 'Sending…' : 'Send link'}</button>
          </div>
          <p class="tiny muted">By continuing you agree to the <a href={href('terms/')}>terms</a> and <a href={href('privacy/')}>privacy notice</a>. No password, no spam.</p>
        </form>
      )}
      {st === 'sent' && <p class="notice ok"><Icon.check /><span>Check <b>{email}</b> for the link. Open it on this device and your report downloads from this spot.</span></p>}
      {err && <p class="notice error" role="alert"><Icon.info /><span>{err}</span></p>}
      {pics && <PrintSheet r={r} area={area} pics={pics} />}
    </div>
  );
}

function PrintSheet({ r, area, pics }: { r: Report; area?: DprArea; pics: [string, string] }) {
  const [host] = useState(() => { const d = document.createElement('div'); d.className = 'dpr-print'; return d; });
  useEffect(() => { document.body.appendChild(host); return () => host.remove(); }, []);
  const p = r.parcel, date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  return createPortal(
    <article>
      <header>
        <div><b>{SITE_NAME}</b> · DP report</div>
        <div>{date}</div>
      </header>
      <h1>Development Plan report{area ? `: ${area.name}, Pune` : ', Pune'}</h1>
      <p class="meta">Point {r.lat.toFixed(5)}, {r.lon.toFixed(5)} · <a href={location.href}>{location.href.replace(/[?#].*$/, '')}?at={r.lat.toFixed(5)},{r.lon.toFixed(5)}</a></p>
      <section class="summary">
        <div><span>DP zone</span><b>{p ? clsLabel(p.cls) : r.covered ? 'Road / open strip on the plan' : 'Not on the traced sheets'}</b></div>
        <div><span>Reserved</span><b>{p?.reserved ? `Yes: ${RESERVED_MEANS[p.cls] ?? 'a public use'}` : 'No (this parcel)'}</b></div>
        <div><span>Parcel on the sheet</span><b>{p ? `${sqm(p.area)} · sheet ${p.sheet}` : '—'}</b></div>
      </section>
      <div class="pics">
        <figure><img src={pics[0]} alt="" /><figcaption>Satellite with the traced DP zones (reserved sites dashed red, the parcel in blue)</figcaption></figure>
        <figure><img src={pics[1]} alt="" /><figcaption>The PMC DP sheet, registered over the satellite image</figcaption></figure>
      </div>
      <section class="cols">
        <div>
          <h2>DP roads within 150 m</h2>
          {r.roads.length ? <table><thead><tr><th>Road</th><th>Away</th><th>Today</th><th>DP</th></tr></thead><tbody>{r.roads.map((d) => <tr key={d.name}><td>{d.name}</td><td>{d.m} m</td><td>{d.w} m</td><td><b>{d.dp} m</b></td></tr>)}</tbody></table> : <p>No DP road width traced near this point yet. Read the road widths on the sheet.</p>}
        </div>
        <div>
          <h2>Reserved sites within 250 m</h2>
          {r.reserved.length ? <table><thead><tr><th>For</th><th>Area</th><th>Where</th></tr></thead><tbody>{r.reserved.map((x) => <tr key={x.p.id}><td>{clsShort(x.p.cls)}</td><td>{sqm(x.p.area)}</td><td>{x.m ? `${x.m} m ${x.dir}` : 'this plot'}</td></tr>)}</tbody></table> : <p>None traced within 250 m.</p>}
          <h2>Land use within 100 m</h2>
          <p>{r.mix.map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(' · ') || '—'}{r.unmarked ? ` · roads / untraced ${r.unmarked}%` : ''}</p>
        </div>
      </section>
      <footer>
        <p><b>Not an official DP remark.</b> Traced by {SITE_NAME} from the Pune Municipal Corporation's Development Plan for the old limits (2007–2027, sanctioned 5 Jan 2017), registered to within a few metres. Modifications after the sheets were published are not shown. For the legal position, apply to the PMC for a DP remark / zone certificate.</p>
        <p>Imagery © Esri, Maxar, Earthstar Geographics · DP sheets © Pune Municipal Corporation · Roads © OpenStreetMap contributors (ODbL).</p>
      </footer>
    </article>,
    host,
  );
}

// ---------------- the pages ----------------

function Provenance() {
  return (
    <aside class="calc place-prov" aria-label="Where this comes from">
      <h2>Where this comes from</h2>
      <ul class="small">
        <li>The plan: the Pune Municipal Corporation's <b>Development Plan for the old limits (2007–2027)</b>, sanctioned 5 January 2017: {SUMMARY.sheets} scanned sheets, registered by {SITE_NAME} to the city to about 2–4 m and traced into {n(SUMMARY.parcels)} zoned parcels. Site codes printed on the sheets aren't read yet: zoom in on the DP sheet layer to read them.</li>
        <li>DP road widths: measured by {SITE_NAME} on the sheets for {SUMMARY.dpRoadKm} km of road so far; today's widths are {SITE_NAME}'s model from OpenStreetMap.</li>
        <li>Satellite imagery: Esri World Imagery (Maxar, Earthstar Geographics); its date varies by place.</li>
        <li>Place search: OpenStreetMap Nominatim. Roads and names © OpenStreetMap contributors (ODbL).</li>
        <li><b>A survey aid, not an official DP remark</b>, zone certificate or legal boundary. Later modifications and sanctioned changes aren't shown. For the legal position, ask the PMC.</li>
      </ul>
    </aside>
  );
}

function Faq() {
  return <div class="faq">{DPR_FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>;
}

function Steps() {
  const S: [() => any, string, string][] = [
    [Icon.pin, 'Find the plot', 'Search a road or society, or zoom in on the satellite image.'],
    [Icon.sheet, 'Click it', 'See its DP zone, reserved sites around it and the DP roads that may widen.'],
    [Icon.check, 'Download the PDF', 'Two maps and the facts on one page. Free with your email.'],
  ];
  return <ol class="dpr-steps">{S.map(([I, t, d]) => <li key={t}><I /><b>{t}</b><span>{d}</span></li>)}</ol>;
}

export function DpHubPage() {
  const S = SUMMARY;
  return (
    <Page>
      <section class="wrap guide place dpr">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Pune', 'pune/'], ['Pune DP report', null]]} />
          <h1>Pune DP report: the Development Plan on satellite, plot by plot</h1>
          <p class="answer">
            Check what Pune's sanctioned <b>Development Plan</b> says about any plot in the old PMC limits: its <b>zone</b>, whether it or a
            neighbour is <b>reserved</b> for a garden, school or other public use, and the <b>DP roads</b> that may widen past it, drawn over
            a satellite image. {n(S.parcels)} parcels traced from {S.sheets} DP sheets, {n(S.reserved)} reserved sites. Free; the PDF too.
          </p>
          <Viewer lat={18.52} lon={73.855} zoom={13} />
          <Steps />

          <h2>Check a locality</h2>
          <p>Each locality page has the plan's land-use mix within 500 m, the reserved sites and the DP roads, and opens the map there.</p>
          <div class="guide-list dpr-areas">
            {AREAS.map((a) => (
              <a key={a.slug} href={href(areaPath(a))}>
                <h3>{a.name}</h3>
                <p>{a.mix[0] ? `${clsShort(a.mix[0].cls)} ${Math.round(a.mix[0].pct)}%` : ''}{a.reserved.length ? ` · ${a.reserved.length} reserved site${a.reserved.length > 1 ? 's' : ''}` : ''}{a.dpRoads.length ? ` · ${a.dpRoads.length} DP road${a.dpRoads.length > 1 ? 's' : ''}` : ''}</p>
              </a>
            ))}
          </div>

          <h2>What the plan zones in Pune's old limits</h2>
          <div class="table-wrap">
            <table class="rules">
              <caption>Area of each land use in the traced parcels of the sanctioned DP ({n(S.parcels)} parcels; roads are not counted).</caption>
              <thead><tr><th>Land use</th><th class="n">Area</th></tr></thead>
              <tbody>{S.byClass.filter((c) => c.ha > 0).map((c) => <tr key={c.cls}><td><Swatch cls={c.cls} /> {clsLabel(c.cls)}</td><td class="n">{n(c.ha)} ha</td></tr>)}</tbody>
            </table>
          </div>

          <h2>Questions</h2>
          <Faq />
          <Links />
          <Provenance />
        </article>
      </section>
    </Page>
  );
}

function Links() {
  return (
    <div class="map-links">
      <a href={href('pune/dp-map/')}><Icon.sheet /><span><b>Pune DP map</b><small>Where the DP sheets are and what's traced</small></span></a>
      <a href={href('guides/dp-road-affects-property/')}><Icon.road /><span><b>Does a DP road affect my property?</b><small>The guide</small></span></a>
      <a href={href('guides/what-is-development-plan/')}><Icon.info /><span><b>What is a Development Plan?</b><small>Zones, reservations, DP remarks</small></span></a>
      <a href={href('guides/how-much-can-i-build/')}><Icon.building /><span><b>How much can I build?</b><small>FSI on your plot, in Site Studio</small></span></a>
    </div>
  );
}

export function DpAreaBySlug({ slug }: { slug: string }) {
  const a = areaOf(slug);
  return a ? <DpAreaPage a={a} /> : <Page><NotFoundBody /></Page>;
}

function lead(a: DprArea): ComponentChildren {
  const top = a.mix.slice(0, 3);
  const res = a.reserved, byCls = new Map<string, number>();
  for (const r of res) byCls.set(r.cls, (byCls.get(r.cls) ?? 0) + 1);
  const resText = [...byCls].sort((p, q) => q[1] - p[1]).map(([c, k]) => `${k} ${clsLower(c)}`).join(', ');
  return (
    <>
      Within {a.r} m of {a.name}, Pune's sanctioned Development Plan zones{' '}
      {top.map((m, i) => <span key={m.cls}>{i ? (i === top.length - 1 ? ' and ' : ', ') : ''}<b>{Math.round(m.pct)}% {clsLower(m.cls)}</b></span>)}
      {' '}of the ground ({Math.round(a.roadPct)}% is roads or not traced).{' '}
      {res.length ? <>It keeps <b>{res.length} site{res.length > 1 ? 's' : ''} reserved</b> for public use here ({resText}).</> : <>No reserved sites are traced within {a.r} m.</>}
      {a.dpRoads.length ? <> {a.dpRoads.length} road{a.dpRoads.length > 1 ? 's have' : ' has'} a traced DP width, {a.dpRoads[0].name} {a.dpRoads[0].dp} m against about {a.dpRoads[0].w} m today.</> : null}
    </>
  );
}

export function DpAreaPage({ a }: { a: DprArea }) {
  const near = a.nearby.map(areaOf).filter((x): x is DprArea => !!x);
  return (
    <Page>
      <section class="wrap guide place dpr">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Pune', 'pune/'], ['Pune DP report', DPR_PATH], [a.name, null]]} />
          <h1>{a.name} DP report: Development Plan zones and reservations on satellite</h1>
          <p class="answer">{lead(a)}</p>
          {a.aka?.length ? <p class="small muted">Also known as {a.aka.join(', ')}.</p> : null}
          <Viewer lat={a.lat} lon={a.lon} zoom={16} ring={a.r} area={a} />

          <h2>Land use in the plan within {a.r} m</h2>
          <div class="dpr-bar big" role="img" aria-label={a.mix.map((m) => `${clsShort(m.cls)} ${m.pct}%`).join(', ')}>
            {a.mix.map((m) => <span key={m.cls} style={`width:${m.pct}%;background:${clsColor(m.cls)}`} />)}
          </div>
          <div class="table-wrap">
            <table class="rules">
              <caption>Share of the circle of {a.r} m round {a.name} ({a.lat.toFixed(4)}, {a.lon.toFixed(4)}) in each zone of the traced DP; {Math.round(a.roadPct)}% is roads, nalas or parts not traced.</caption>
              <thead><tr><th>Zone</th><th class="n">Share</th><th class="n">Area</th></tr></thead>
              <tbody>{a.mix.map((m) => <tr key={m.cls}><td><Swatch cls={m.cls} /> {clsLabel(m.cls)}</td><td class="n">{m.pct}%</td><td class="n">{areaText(m.ha)}</td></tr>)}</tbody>
            </table>
          </div>

          <h2>Reserved sites near {a.name}</h2>
          {a.reserved.length ? (
            <div class="table-wrap">
              <table class="rules">
                <caption>Sites the DP keeps for a public purpose within {a.r} m, nearest first. The site code on the sheet says exactly what for: open the DP sheet layer on the map to read it.</caption>
                <thead><tr><th>Reserved for</th><th class="n">Area</th><th>Where</th><th /></tr></thead>
                <tbody>{a.reserved.map((r) => (
                  <tr key={r.id}>
                    <td><Swatch cls={r.cls} /> {clsShort(r.cls)}</td>
                    <td class="n">{areaText(r.ha)}</td>
                    <td>{r.m} m {r.dir}</td>
                    <td><a href={atHref(r.lat, r.lon)} onClick={showAt(r.lat, r.lon)}>Show</a></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>No sites reserved for public use are traced within {a.r} m of {a.name}. Some may still be on the sheet: switch the map to the DP sheet layer to check.</p>}
          {a.reserved.length > 0 && <p class="small muted">What a reservation means: the owner usually can't build what the zone around allows; the site is meant to be acquired by the PMC or handed over for TDR. {[...new Set(a.reserved.map((r) => r.cls))].filter((c) => RESERVED_MEANS[c]).slice(0, 2).map((c) => `${clsShort(c)}: ${RESERVED_MEANS[c]}.`).join(' ')}</p>}

          <h2>DP roads</h2>
          {a.dpRoads.length ? (
            <div class="table-wrap">
              <table class="rules">
                <caption>Roads within {a.r} m whose DP width {SITE_NAME} has measured on the sheets, against today's width in its model. Where the DP is wider, the road may be widened into the plots along it.</caption>
                <thead><tr><th>Road</th><th class="n">Today</th><th class="n">DP width</th><th class="n">Difference</th></tr></thead>
                <tbody>{a.dpRoads.map((d) => <tr key={d.name}><td><b>{d.name}</b></td><td class="n">{d.w} m</td><td class="n"><b>{d.dp} m</b></td><td class="n">{d.dp - d.w >= 0.5 ? `+${(d.dp - d.w).toFixed(1)} m` : '—'}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p>{SITE_NAME} hasn't measured the DP road widths round {a.name} yet. The planned road edges are on the sheet itself: switch the map to <b>DP sheet</b> and zoom in.</p>}

          <div class="cta-panel place-cta">
            <h2>Get the DP report for your plot</h2>
            <p>Click your plot on the map above for its zone, the reservations and DP roads around it, and download the PDF with the satellite and DP sheet maps. Free.</p>
            <div class="cta-row"><a class="btn btn-primary btn-lg" href="#viewer">Pick my plot</a><a class="btn btn-lg" href={appAt(a.lat, a.lon)}>Open {a.name} in 3D</a></div>
          </div>

          {near.length > 0 && (
            <>
              <h2>Nearby</h2>
              <div class="guide-list">
                {near.map((b) => (
                  <a key={b.slug} href={href(areaPath(b))}>
                    <h3>{b.name} DP report</h3>
                    <p>{b.mix[0] ? `${clsShort(b.mix[0].cls)} ${Math.round(b.mix[0].pct)}%` : ''}{b.reserved.length ? ` · ${b.reserved.length} reserved` : ''}</p>
                  </a>
                ))}
              </div>
            </>
          )}

          <h2>Questions</h2>
          <Faq />
          <Links />
          <p class="small muted">DP sheets used here: {a.sheets.join(', ')} · {n(a.parcels)} parcels within reach · baked {SUMMARY.baked}.</p>
          <Provenance />
        </article>
      </section>
    </Page>
  );
}
