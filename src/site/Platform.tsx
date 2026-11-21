// The platform's own pages, round Pro rather than a city: the templates gallery and a page per template, the rule
// books Pro works to (coverage), the sample report, about and contact. The words for templates are in
// src/site/templates/data.ts; the rule books are here.
import { CONTACT_EMAIL, SITE_NAME } from './brand';
import { WireSpin, WireStill } from './FormMorph';
import { GROUPS, OPEN, template, TEMPLATES, type Template } from './templates/data';
import { RULE_BOOKS } from './coverage';
import { href, Icon, Page, StartLink } from './ui';

const REPORT = href('site/sample-report.html');

function Trail({ trail }: { trail: [string, string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{trail.map(([label, to]) => <li key={label}>{to !== null ? <a href={href(to)}>{label}</a> : <span aria-current="page">{label}</span>}</li>)}</ol>
    </nav>
  );
}

// ---------------- templates ----------------

function TemplateCard({ t }: { t: Template }) {
  return (
    <a class="tpl-card" href={href(`templates/${t.id}/`)}>
      <WireStill id={t.id} class="tpl-wire" />
      <b>{t.name}</b><span>{t.blurb}</span>
    </a>
  );
}

export function TemplatesHub() {
  return (
    <Page current="templates/">
      <section class="wrap guide">
        <article class="wide">
          <Trail trail={[['Home', ''], ['Templates', null]]} />
          <h1>Building templates</h1>
          <p class="answer">Start from a form and make it yours. Drop a template on a plot and {SITE_NAME} Pro sizes it to the room the rules leave, lays out every floor, places the cores and flats, and checks it, clause by clause.</p>
          {GROUPS.map((g) => (
            <section key={g.id} class="tpl-group" aria-labelledby={`g-${g.id}`}>
              <div class="tpl-group-head"><h2 id={`g-${g.id}`}>{g.label}</h2><p>{g.intro}</p></div>
              <div class="tpl-grid">{TEMPLATES.filter((t) => t.group === g.id).map((t) => <TemplateCard key={t.id} t={t} />)}</div>
            </section>
          ))}
          <p class="muted small">Or draw your own: any outline, then taper, twist, curve and carve it floor by floor.</p>
        </article>
      </section>
    </Page>
  );
}

export function TemplatePage({ id }: { id: string }) {
  const t = template(id)!;
  const group = GROUPS.find((g) => g.id === t.group)!;
  const more = TEMPLATES.filter((x) => x.group === t.group && x.id !== t.id);
  return (
    <Page current="templates/">
      <section class="wrap guide">
        <article class="wide">
          <Trail trail={[['Home', ''], ['Templates', 'templates/'], [t.name, null]]} />
          <div class="tpl-hero">
            <div class="tpl-text">
              <span class="eyebrow">{group.label}</span>
              <h1>{t.name}</h1>
              <p class="answer">{t.body}</p>
              <ul class="tpl-suits">{t.suits.map((s) => <li key={s}><Icon.check />{s}</li>)}</ul>
              <div class="cta-row start">
                <a class="btn btn-primary btn-lg" href={href(OPEN(t.id))}>Open in Pro <Icon.arrow /></a>
                <a class="btn btn-lg" href={href('templates/')}>All templates</a>
              </div>
            </div>
            <WireSpin id={t.id} class="tpl-view" label={`${t.name}, drawn as a wireframe: ${t.blurb}`} />
          </div>
          <h2>What Pro does with it</h2>
          <ul>
            <li>Sizes it to the plot: the room the margins, the road and the rules leave.</li>
            <li>Lays out every floor: cores, stairs and lifts for its height, flats or rooms to your mix.</li>
            <li>Checks it as you change it: floor area, height, margins, fire, parking and more, each with its clause.</li>
            <li>Works out what it’s worth, and draws the set for the authority.</li>
          </ul>
          {more.length > 0 && <>
            <h2>More {group.label.toLowerCase()}</h2>
            <div class="tpl-grid">{more.map((x) => <TemplateCard key={x.id} t={x} />)}</div>
          </>}
        </article>
      </section>
    </Page>
  );
}

// ---------------- coverage: the rule books ----------------

/** What Pro checks under every rule book, as the scrutiny lists it. */
const CHECKS: [string, string][] = [
  ['Plot and road', 'Access road, DP road widening, shops and commercial floors by road width'],
  ['Floor area', 'Basic, premium and TDR FSI, ancillary or fungible area, ground coverage'],
  ['Shape and height', 'Height by road width, margins round every building, the form as laid out'],
  ['Amenity and open space', 'Amenity space, recreational open space, inclusive housing (EWS / LIG)'],
  ['Fire and escape', 'Fire NOC, refuge areas, lifts, staircase widths, travel distance to a stair'],
  ['Homes', 'Room sizes, light and ventilation, carpet area (RERA)'],
  ['Parking and services', 'Parking by use and size, environment clearance by built-up area'],
  ['Structure', 'Transfers and cantilevers flagged for the structural engineer'],
];

export function CoverageHub() {
  return (
    <Page current="coverage/">
      <section class="wrap guide">
        <article class="wide">
          <Trail trail={[['Home', ''], ['Coverage', null]]} />
          <h1>The rules Pro works to</h1>
          <p class="answer">{SITE_NAME} Pro isn’t tied to a city: it works to a rule book. Draw or find a plot, and the rules that apply there are checked as you design, clause by clause. They flag, they never block.</p>
          <div class="rb-list">
            {RULE_BOOKS.map((r) => (
              <a key={r.slug} href={href(`coverage/${r.slug}/`)} class="rb-card">
                <span class={`rb-status ${r.status}`}>{r.status === 'live' ? 'Live' : 'Used with both'}</span>
                <h2 class="h3">{r.name}</h2>
                <p>{r.full}</p>
                <small>{r.where}</small>
              </a>
            ))}
            <a href={href('contact/')} class="rb-card rb-next">
              <span class="rb-status next">Next</span>
              <h2 class="h3">Your rules</h2>
              <p>Other Indian states and cities, and codes abroad. Tell us where you work and which code you design to.</p>
              <small>Get in touch <Icon.arrow /></small>
            </a>
          </div>
          <h2>What’s checked</h2>
          <dl class="rb-checks">{CHECKS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <p class="muted small">{SITE_NAME} is a planning aid. Its figures follow the regulations as written; check them with the planning authority and a licensed architect before you buy, design or apply.</p>
        </article>
      </section>
    </Page>
  );
}

export function RuleBookPage({ slug }: { slug: string }) {
  const r = RULE_BOOKS.find((x) => x.slug === slug)!;
  return (
    <Page current="coverage/">
      <section class="wrap guide">
        <article>
          <Trail trail={[['Home', ''], ['Coverage', 'coverage/'], [r.name, null]]} />
          <span class="eyebrow">{r.status === 'live' ? 'Live in Pro' : 'Used with the local rules'}</span>
          <h1>{r.name}</h1>
          <p class="answer">{r.intro}</p>
          <h2>The rule book</h2>
          <p>{r.full}.</p>
          <h2>Where it applies</h2>
          <p>{r.where}</p>
          <h2>What Pro checks</h2>
          <dl class="rb-checks">{CHECKS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {r.tools.length > 0 && <>
            <h2>Free tools</h2>
            <p>Made on {r.name}, free and without an account:</p>
            <ul>{r.tools.map(([label, to]) => <li key={to}><a href={href(to)}>{label}</a></li>)}</ul>
          </>}
          <div class="cta-row start"><StartLink class="btn btn-primary btn-lg">Start a project <Icon.arrow /></StartLink></div>
        </article>
      </section>
    </Page>
  );
}

// ---------------- the sample report ----------------

const REPORT_HAS: [string, string, string][] = [
  ['report-cover.webp', 'The scheme at a glance', 'The buildings in 3D on their plot, with the figures that matter: floor area, homes, height, profit.'],
  ['report-plans.webp', 'Plans to scale', 'Site plan, floor plans and parking, drawn from the scheme as it stands.'],
  ['report-money.webp', 'The money', 'Revenue, cost, profit and IRR, the land deal and the cash month by month.'],
  ['report.webp', 'Every rule, with its clause', 'Each check met or not, and by how much, with the clause it comes from.'],
];

export function SampleReport() {
  return (
    <Page current="sample-report/">
      <section class="wrap guide">
        <article class="wide">
          <Trail trail={[['Home', ''], ['Sample report', null]]} />
          <h1>The report Pro makes</h1>
          <p class="answer">One click turns a scheme into a report you can take to a meeting, a landowner or a bank: what the plot can hold, what it’s worth, and how it stands against the rules.</p>
          <div class="cta-row start">
            <a class="btn btn-primary btn-lg" href={REPORT} target="_blank" rel="noopener">Open the sample report <Icon.arrow /></a>
            <StartLink class="btn btn-lg">Make your own</StartLink>
          </div>
          <div class="rep-grid">
            {REPORT_HAS.map(([img, title, body]) => (
              <figure key={img} class="rep-item">
                <img src={href(`site/${img}`)} width={1440} height={900} alt={`${title}: a page of the ${SITE_NAME} sample report`} loading="lazy" />
                <figcaption><b>{title}</b><span>{body}</span></figcaption>
              </figure>
            ))}
          </div>
        </article>
      </section>
    </Page>
  );
}

// ---------------- about and contact ----------------

export function About() {
  return (
    <Page current="about/">
      <section class="wrap guide">
        <article>
          <Trail trail={[['Home', ''], ['About', null]]} />
          <h1>About {SITE_NAME}</h1>
          <p class="answer">{SITE_NAME} works out what a plot can become: what the rules allow on it, what it’s worth, and what the authority will ask for. In the browser, as you change it.</p>
          <h2>Why</h2>
          <p>Before anyone draws, a plot raises the same questions: how much can be built, in what shape, for what return, and will it pass. Answering them today takes weeks of spreadsheets, rule books and back-and-forth. {SITE_NAME} answers them in minutes, and keeps answering as the design changes.</p>
          <h2>How we build it</h2>
          <ul>
            <li><b>The rules flag, never block.</b> Every check says what it found and which clause it’s from; what to do about it is yours.</li>
            <li><b>Any building.</b> A tower, a court of homes, a library or a public toilet: the same tool, the same checks.</li>
            <li><b>Not tied to a place.</b> Pro works to a rule book, so a new city or country is a new rule book, not a new product.</li>
            <li><b>Open where it can be.</b> Roads and buildings from OpenStreetMap, terrain from Copernicus, and our road networks back as <a href={href('data/')}>open data</a>.</li>
          </ul>
          <h2>Where it stands</h2>
          <p>{SITE_NAME} is in beta and free while it is. It covers <a href={href('coverage/')}>UDCPR 2020 and DCPR 2034</a> today, with more rule books to come.</p>
          <p class="muted small">{SITE_NAME} is a planning aid, not engineering advice, a DP remark or a zone certificate.</p>
          <div class="cta-row start"><StartLink class="btn btn-primary btn-lg">Start a project <Icon.arrow /></StartLink><a class="btn btn-lg" href={href('contact/')}>Contact us</a></div>
        </article>
      </section>
    </Page>
  );
}

export function Contact() {
  return (
    <Page current="contact/">
      <section class="wrap guide">
        <article>
          <Trail trail={[['Home', ''], ['Contact', null]]} />
          <h1>Contact</h1>
          <p class="answer">Questions, a rule book you’d like covered, a bug, or a team that wants to try Pro: we read everything.</p>
          {CONTACT_EMAIL
            ? <p><a class="btn btn-primary btn-lg" href={`mailto:${CONTACT_EMAIL}`}>Email {CONTACT_EMAIL}</a></p>
            : <p>Our contact address is on its way. Until then, <a href={href('signup/')}>create a free account</a> and we’ll be in touch.</p>}
          <h2>Good to include</h2>
          <ul>
            <li>Where your plots are, and which rules they come under.</li>
            <li>What you do: develop, design, own land, advise.</li>
            <li>For a bug: what you did, what you saw, and a share link to the project if you can.</li>
          </ul>
        </article>
      </section>
    </Page>
  );
}
