// Shared pieces of the website: the logo, header (nav, theme, account), footer, icons, theme switch.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { authReady, BASE, peekSession, session, shortName } from '../auth/auth';
import { LOGO_PARTS, SITE_NAME } from './brand';
import { Dither } from '../theme/Dither';

export const href = (p: string) => `${BASE}${p}`;
/** Pro (the planning tool), the signed-in dashboard, and a new Pro project: a blank plot sized in three numbers, the
 *  sample, or a plot found by its survey number; under a city's rules when one is given. (The city editor at /app/
 *  is kept off the website for now: nothing links to it.) */
export const PRO = href('pro/');
export const DASH = href('dashboard/');
export type SiteCity = 'pune' | 'mumbai';
export const proStart = (how: 'blank' | 'sample' | 'survey' = 'blank', city?: SiteCity) => href(`pro/?new=${how}${city ? `&city=${city}` : ''}`);

/** Something loading or being worked out: the brand's dither, as Pro shows it, with a word. `block` covers its
 *  (positioned) parent, for a map or a picture still on its way. */
export function Loading({ label = 'Loading…', block = false }: { label?: string; block?: boolean }) {
  return <p class={`loading${block ? ' block' : ''}`} role="status"><Dither class="dz" cell={2} />{label}</p>;
}

/** The mark: a road running into the distance, its centre line dashed — the favicon, drawn larger. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="#0c0c0d" stroke="#fff" stroke-opacity="0.14" />
      <path d="M9 26L14 6M23 26L18 6" stroke="#fff" stroke-width="3" stroke-linecap="round" />
      <path d="M16 8v3M16 15v3M16 22v3" stroke="#fff" stroke-width="2" />
    </svg>
  );
}

export const Logo = () => <a class="brand" href={href('')} aria-label={`${SITE_NAME} home`}><Dither field="mark" cell={2} class="brand-mark" /><span>{LOGO_PARTS[0]}{LOGO_PARTS[1] && <b>{LOGO_PARTS[1]}</b>}</span></a>;

const I = (d: string, size = 18) => () => (
  <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const Icon = {
  road: I('M6 18L8.5 2M14 18L11.5 2M10 4v2M10 9v2M10 14v2'),
  flyover: I('M1 15h4c2 0 3-6 5-6s3 6 5 6h4M6 15v3M14 15v3M2 18h16'),
  terrain: I('M1 16l5-7 3 4 3-5 7 8H1z'),
  section: I('M2 15h16M4 15V9M16 15V9M7 15v-4h6v4M2 9h16'),
  check: I('M4 10.5l4 4 8-9'),
  share: I('M7 11l6-4M7 9l6 4M5 12a2 2 0 100-4 2 2 0 000 4zM15 8a2 2 0 100-4 2 2 0 000 4zM15 16a2 2 0 100-4 2 2 0 000 4z'),
  sheet: I('M4 2h9l3 3v13H4zM13 2v3h3M7 9h6M7 12h6M7 15h4'),
  cube: I('M10 2l7 4v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8'),
  sun: I('M10 14a4 4 0 100-8 4 4 0 000 8zM10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6l1.4 1.4M15 15l1.4 1.4M3.6 16.4L5 15M15 5l1.4-1.4'),
  moon: I('M16 12.5A7 7 0 017.5 4a7 7 0 108.5 8.5z'),
  menu: I('M3 6h14M3 10h14M3 14h14'),
  close: I('M5 5l10 10M15 5L5 15'),
  user: I('M10 10a4 4 0 100-8 4 4 0 000 8zM3 18c1-3.5 4-5 7-5s6 1.5 7 5'),
  building: I('M4 18V4l7-2v16M11 8h5v10M2 18h16M7 7v1M7 10v1M7 13v1M14 11v1M14 14v1'),
  people: I('M7 9a3 3 0 100-6 3 3 0 000 6zM14 9a2.5 2.5 0 100-5M1.5 17c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5M14 12.5c2 0 3.8 1.2 4.5 4'),
  pin: I('M10 18s6-5.5 6-10a6 6 0 10-12 0c0 4.5 6 10 6 10zM10 10a2 2 0 100-4 2 2 0 000 4z'),
  info: I('M10 18a8 8 0 100-16 8 8 0 000 16zM10 9v5M10 6v.5'),
  arrow: I('M4 10h12M11 5l5 5-5 5'),
  down: I('M6 8l4 4 4-4', 14),
};

// ---------- theme (the same setting as the editor's) ----------
const KEY = 'pune-remix:settings';
const readSettings = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export const isDark = () => document.documentElement.dataset.theme === 'dark';
export function setTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem(KEY, JSON.stringify({ ...readSettings(), theme: dark ? 'dark' : 'light' })); } catch { /* private mode */ }
}

// Both icons are drawn and the stylesheet shows the one for the theme the page opened in: prerendered pages don't
// know the theme, and the first render has to match their HTML.
function ThemeToggle() {
  const [d, setD] = useState(false);
  useEffect(() => setD(isDark()), []);
  return (
    <button class="icon-btn theme-btn" aria-label={d ? 'Use the light theme' : 'Use the dark theme'} title={d ? 'Light theme' : 'Dark theme'} onClick={() => { const to = !isDark(); setTheme(to); setD(to); }}>
      <span class="if-dark"><Icon.sun /></span><span class="if-light"><Icon.moon /></span>
    </button>
  );
}

/** "Sign in" or the signed-in account (avatar + first name). */
export function AccountLink() {
  // (who's signed in, from what Supabase stored, after the page is up: the library itself loads only where it's needed)
  useEffect(() => peekSession(), []);
  const s = session.value;
  if (!authReady || s === null) return <a class="btn btn-ghost hide-sm" href={href('login/')}>Sign in</a>;
  if (s === undefined) return <span class="btn btn-ghost hide-sm" aria-hidden="true" style="visibility:hidden">Sign in</span>;
  const name = shortName(s.user);
  return <a class="chip-account" href={DASH} title={`Your dashboard (${s.user.email ?? name})`}><span class="avatar">{name[0]?.toUpperCase()}</span><span class="hide-sm">Dashboard</span></a>;
}

/** "Start a project": into Pro on a blank plot for someone without an account (Pro works without one, and asks to
 *  sign in when they want their projects kept); the dashboard for someone signed in. Prerendered as the first. */
export function StartLink({ class: cls, children, onClick }: { class?: string; children: ComponentChildren; onClick?: () => void }) {
  useEffect(() => peekSession(), []);
  return <a class={cls} href={authReady && session.value ? DASH : proStart('blank')} onClick={onClick}>{children}</a>;
}

type NavItem = [to: string, label: string, note: string];
/** The header: menus (a label and its links) and plain links. A `#` link is a part of the landing page. */
const NAV: ({ menu: string; items: NavItem[] } | { to: string; label: string })[] = [
  { menu: 'Product', items: [
    ['#pro', 'How it works', 'Plot to approval in six steps'],
    ['#features', 'Features', 'Live rules, any shape, numbers, drawings'],
    ['templates/', 'Templates', 'Towers, homes, public buildings'],
    ['coverage/', 'Coverage', 'The rule books Pro checks'],
    ['sample-report/', 'Sample report', 'What Pro hands you at the end'],
  ] },
  { to: 'pricing/', label: 'Pricing' },
  { menu: 'Resources', items: [
    ['guides/', 'Guides', 'FSI, setbacks, TDR and the DP, explained'],
    ['data/', 'Open data', 'Road networks to download'],
    ['about/', 'About', `Why ${SITE_NAME}, and how we build it`],
    ['contact/', 'Contact', 'Questions, bugs, a rule book to add'],
  ] },
];

export function Header({ current, lang }: { current?: string; lang?: string }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const onHome = current === 'landing';
  const url = (to: string) => (to.startsWith('#') ? (onHome ? to : href('') + to) : href(to));
  const done = () => { setOpen(false); setMenu(null); };
  // (an open menu closes on a click elsewhere, or Escape)
  useEffect(() => {
    if (!menu) return;
    const click = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.nav-menu')) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    addEventListener('click', click); addEventListener('keydown', key);
    return () => { removeEventListener('click', click); removeEventListener('keydown', key); };
  }, [menu]);
  return (
    <header class="site-head" lang={lang}>
      <div class="wrap">
        <Logo />
        <nav class={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
          {NAV.map((n) => 'menu' in n ? (
            <div key={n.menu} class={`nav-menu ${menu === n.menu ? 'on' : ''}`}>
              <button type="button" aria-expanded={menu === n.menu} aria-controls={`m-${n.menu}`} onClick={() => setMenu(menu === n.menu ? null : n.menu)}>{n.menu}<Icon.down /></button>
              <div class="nav-pop" id={`m-${n.menu}`}>
                {n.items.map(([to, label, note]) => (
                  <a key={to} href={url(to)} aria-current={current === to ? 'page' : undefined} onClick={done}><b>{label}</b><small>{note}</small></a>
                ))}
              </div>
            </div>
          ) : (
            <a key={n.to} class="nav-link" href={url(n.to)} aria-current={current === n.to ? 'page' : undefined} onClick={done}>{n.label}</a>
          ))}
          <StartLink class="show-xs nav-link" onClick={done}>Start a project</StartLink>
          {authReady && !!session.value && <a class="show-xs nav-link" href={DASH}>Dashboard</a>}
          {authReady && !session.value && <a class="show-xs nav-link" href={href('login/')}>Sign in</a>}
        </nav>
        <div class="head-actions">
          <ThemeToggle />
          <AccountLink />
          <StartLink class="btn btn-ink hide-xs">Start a project</StartLink>
          <button class="icon-btn menu-btn" aria-label={open ? 'Close the menu' : 'Open the menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <Icon.close /> : <Icon.menu />}</button>
        </div>
      </div>
    </header>
  );
}

/** The footer's columns: [heading, [path, label]…]. */
const FOOT: [string, [string, string][]][] = [
  ['Product', [['#pro', 'How it works'], ['templates/', 'Templates'], ['coverage/', 'Coverage'], ['sample-report/', 'Sample report'], ['pricing/', 'Pricing']]],
  ['Resources', [['guides/', 'Guides'], ['data/', 'Open data'], ['coverage/udcpr-2020/', 'UDCPR 2020'], ['coverage/dcpr-2034/', 'DCPR 2034']]],
  ['Company', [['about/', 'About'], ['contact/', 'Contact'], ['terms/', 'Terms'], ['privacy/', 'Privacy']]],
  ['Account', [['login/', 'Sign in'], ['signup/', 'Create an account'], ['dashboard/', 'Dashboard']]],
];

export function Footer({ lang }: { lang?: string }) {
  return (
    <footer class="site-foot" lang={lang}>
      <div class="wrap">
        <div class="foot-cols">
          <div class="foot-brand"><Logo /><p>From a plot to a project.</p></div>
          {FOOT.map(([head, links]) => (
            <nav key={head} aria-label={head}>
              <b>{head}</b>
              {links.map(([to, label]) => <a key={to} href={to.startsWith('#') ? href('') + to : href(to)}>{label}</a>)}
            </nav>
          ))}
        </div>
        <nav class="foot-maps" aria-label="Free tools">
          <b>Free tools</b>
          <a href={href('pune/dp-report/')}>Pune DP plan on satellite</a>
          <a href={href('pune/fsi-calculator/')}>Pune FSI calculator</a>
          <a href={href('pune/fsi-map/')}>Pune FSI map</a>
          <a href={href('pune/dp-map/')}>Pune DP map</a>
          <a href={href('pune/road-width-map/')}>Pune road width map</a>
          <a href={href('pune/map/')}>Pune 3D map</a>
          <a href={href('mr/pune/dp-map/')} lang="mr" hrefLang="mr">पुणे विकास आराखडा नकाशा</a>
          <a href={href('mumbai/fsi-calculator/')}>Mumbai FSI calculator</a>
          <a href={href('mumbai/fsi-map/')}>Mumbai FSI map</a>
          <a href={href('mumbai/road-width-map/')}>Mumbai road width map</a>
          <a href={href('mumbai/map/')}>Mumbai 3D map</a>
          <a href={href('pune/')}>Pune</a>
          <a href={href('mumbai/')}>Mumbai</a>
        </nav>
        <div class="foot-legal">
          <span>© OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus · DP sheets © Pune Municipal Corporation.</span>
          <span>A survey aid and concept tool. Not engineering advice, a DP remark or a zone certificate.</span>
        </div>
      </div>
    </footer>
  );
}

/** A page of the website. `chrome`: the language of the header and footer when the page's own differs (they're in English). */
export function Page({ current, chrome, children }: { current?: string; chrome?: string; children: ComponentChildren }) {
  return (
    <>
      <a class="skip" href="#main" lang={chrome}>Skip to content</a>
      <Header current={current} lang={chrome} />
      <main id="main">{children}</main>
      <Footer lang={chrome} />
    </>
  );
}

/** `location.search`, once the page is up: prerendered pages render first without it, so the HTML matches. */
export function useSearch(): string {
  const [s, setS] = useState('');
  useEffect(() => setS(location.search), []);
  return s;
}

/** A same-site path to go to after signing in (?next=/pro/…); anything else falls back to the dashboard. */
export function nextUrl(): string {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : DASH;
}
