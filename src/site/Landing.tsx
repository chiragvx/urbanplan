// The landing page, about Pro: what it does for a plot, its six steps with a picture of each, what it covers, the
// report it makes, and one call to start. The free tools (the DP check, the city editor) get a line, not a section.
// Black and white; the animated dither only in the brand (the mark, the closing band). Sections ease in as they
// scroll into view (not when motion is reduced, and never hidden without JavaScript).
import { useEffect, useState } from 'preact/hooks';
import { APP, href, Icon, Page } from './ui';
import { authReady, session } from '../auth/auth';
import { Dither } from '../theme/Dither';

const img = (name: string) => href(`site/${name}`);
const PRO = href('pro/');
const DP = href('pune/dp-report/');
const REPORT = href('site/sample-report.html');

const STEPS = [
  { key: 'site', label: 'Site', title: 'Find the plot', body: 'By survey or CTS number, or draw it. Its roads, the DP widening and the rules it falls under.' },
  { key: 'scheme', label: 'Scheme', title: 'The most it can hold', body: 'Towers or slabs, the flat mix, shops at the front, parking. Checked against the rules as you go.' },
  { key: 'design', label: 'Design', title: 'Flats, room by room', body: 'Every flat planned and checked for room sizes and light. Facades, windows and the specification.' },
  { key: 'money', label: 'Money', title: 'Is it worth it', body: 'Price, cost and the land deal. Profit, IRR and the cash, month by month.' },
  { key: 'approval', label: 'Approval', title: 'Ready for the authority', body: 'The scrutiny, NOCs, fees and documents. Drawings, IFC and a PreDCR DXF.' },
  { key: 'explore', label: 'Explore', title: 'Every option', body: 'Many schemes at once, a written brief, plots screened side by side.' },
];

const FEATURES: { icon: keyof typeof Icon; title: string; body: string }[] = [
  { icon: 'check', title: 'The rules, live', body: 'UDCPR and Mumbai’s DCPR 2034, checked clause by clause every time you change something.' },
  { icon: 'building', title: 'The most it can hold', body: 'Built-up, height, margins and parking worked out for the plot and its roads, DP widening included.' },
  { icon: 'cube', title: 'In 3D as you go', body: 'The scheme as a wireframe that updates with every change, or shaded with the sun on any date.' },
  { icon: 'sheet', title: 'Numbers you can take to a meeting', body: 'Revenue, cost, profit and IRR, the land deal and the cash month by month.' },
  { icon: 'section', title: 'Drawings for the authority', body: 'Plans, sections and the area statement; IFC, and a DXF on PreDCR’s layers.' },
  { icon: 'people', title: 'Work on it together', body: 'Share a link, invite the team, leave comments on any step.' },
];

const REPORT_HAS = [
  'The scheme in 3D, with the figures that matter',
  'Site plan, floor plans and parking to scale',
  'Every rule with its clause: met or not',
  'Costs, profit, IRR and the cash flow',
];

/** Sections ease in once, as they come into view. Whatever is already on screen shows at once. */
function useReveal() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>('.reveal')];
    for (const el of els) if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
    document.documentElement.classList.add('rv');
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => !el.classList.contains('in') && io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Steps() {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const pick = (k: number) => { setI(k); document.getElementById(`st-${STEPS[k].key}`)?.focus(); };
  return (
    <div class="steps reveal">
      <div class="steps-tabs" role="tablist" aria-label="Pro, step by step" onKeyDown={(ev) => {
        const k = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: STEPS.length - 1 }[ev.key];
        if (k === undefined) return; ev.preventDefault(); pick((k + STEPS.length) % STEPS.length);
      }}>
        {STEPS.map((x, k) => (
          <button key={x.key} type="button" role="tab" id={`st-${x.key}`} aria-selected={k === i} tabIndex={k === i ? 0 : -1} aria-controls="st-panel" class={k === i ? 'on' : ''} onClick={() => setI(k)}>
            <span class="n">{k + 1}</span>
            <span class="t"><b>{x.label}</b><small>{x.title}</small></span>
          </button>
        ))}
      </div>
      <div class="steps-view" id="st-panel" role="tabpanel" aria-labelledby={`st-${s.key}`}>
        <div class="steps-shot">
          {STEPS.map((x, k) => <img key={x.key} class={k === i ? 'on' : ''} width={1440} height={900} src={img(`pro-${x.key}.webp`)} alt={k === i ? `UrbanPlan Pro, the ${x.label} step: ${x.body}` : ''} loading={k === 0 ? 'eager' : 'lazy'} />)}
        </div>
        <p class="steps-cap"><b>{s.title}.</b> {s.body}</p>
      </div>
    </div>
  );
}

export function Landing() {
  useReveal();
  const signedIn = !!session.value;
  return (
    <Page current="landing">
      <section class="hero">
        <div class="wrap">
          <a class="pill" href={PRO}><i />UrbanPlan Pro · Beta · Pune and Mumbai</a>
          <h1>From a plot to a project.</h1>
          <p class="lede">What a plot can hold under the rules, what it’s worth, and what the authority will ask for. Worked out in your browser, as you change it.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={PRO}>Start a project <Icon.arrow /></a>
            <a class="btn btn-lg" href={REPORT} target="_blank" rel="noopener">See a sample report</a>
          </div>
          <a class="frame hero-shot" href={PRO} aria-label="Open UrbanPlan Pro">
            <img width={1440} height={900} src={img('pro-scheme.webp')} alt="UrbanPlan Pro: a ten-storey building on its plot in Baner, Pune, drawn as a wireframe, with the scheme panel and the results bar." fetchpriority="high" />
          </a>
        </div>
      </section>

      <section class="section" id="pro">
        <div class="wrap">
          <div class="section-head center reveal">
            <h2>Six steps, plot to approval.</h2>
            <p>One project, every number live. Change the flat mix and the profit, the parking and the fees follow.</p>
          </div>
          <Steps />
        </div>
      </section>

      <section class="section" id="features">
        <div class="wrap">
          <ul class="feats reveal">
            {FEATURES.map((f) => { const I = Icon[f.icon]; return <li key={f.title}><span class="feat-ic"><I /></span><b>{f.title}</b><span>{f.body}</span></li>; })}
          </ul>
        </div>
      </section>

      <section class="section" id="report">
        <div class="wrap report reveal">
          <div class="report-copy">
            <span class="tag">Sample</span>
            <h2>A report for the meeting.</h2>
            <p>Eight pages to print or save as PDF. This one is a real plot on Mangaldas Road, Pune.</p>
            <ul>{REPORT_HAS.map((x) => <li key={x}><Icon.check />{x}</li>)}</ul>
            <a class="btn btn-lg" href={REPORT} target="_blank" rel="noopener">Open the sample report <Icon.arrow /></a>
          </div>
          <a class="report-stack" href={REPORT} target="_blank" rel="noopener" aria-label="Open the sample report in a new tab">
            <img width={1000} height={1294} class="rp rp-c" src={img('report-money.webp')} alt="The report's money page: costs, profit and the cash flow." loading="lazy" />
            <img width={1000} height={1063} class="rp rp-b" src={img('report-plans.webp')} alt="The report's site plan, drawn to scale: buildings, parking, gardens and trees." loading="lazy" />
            <img width={1000} height={1243} class="rp rp-a" src={img('report-cover.webp')} alt="The report's cover: the scheme in 3D and its headline figures." loading="lazy" />
            <span class="report-open">Open the report ↗</span>
          </a>
        </div>
      </section>

      <section class="wrap">
        <div class="end reveal">
          <Dither field="band" cell={4} inverse class="end-art" />
          <h2>Start with your plot.</h2>
          <p>Free in beta. Nothing to install.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={PRO}>Start a project <Icon.arrow /></a>
            {authReady && !signedIn && <a class="btn btn-lg" href={href('signup/')}>Create an account</a>}
          </div>
        </div>
        <p class="also">Also free: <a href={DP}>check a plot on the Development Plan</a> · <a href={APP}>explore Pune and Mumbai in 3D</a></p>
        <p class="beta-line">Beta: a planning aid, not a legal document. Check every figure with the authority.</p>
      </section>
    </Page>
  );
}
