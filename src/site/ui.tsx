// Shared pieces of the website: the logo, header (nav, theme, account), footer, icons, theme switch.
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { authReady, BASE, session, shortName } from '../auth/auth';

export const href = (p: string) => `${BASE}${p}`;
export const APP = href('app/');

/** The mark: a road running into the distance, its centre line dashed — the favicon, drawn larger. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="#0c0c0d" stroke="#fff" stroke-opacity="0.14" />
      <path d="M9 26L14 6M23 26L18 6" stroke="#ff6a2b" stroke-width="3" stroke-linecap="round" />
      <path d="M16 8v3M16 15v3M16 22v3" stroke="#fff" stroke-width="2" />
    </svg>
  );
}

export const Logo = () => <a class="brand" href={href('')} aria-label="UrbanPlan home"><Mark /><span>Urban<b>Plan</b></span></a>;

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
  google: () => (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8a4.1 4.1 0 01-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z" /><path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.3 0-4.3-1.6-5-3.7H1v2.3A9 9 0 009 18z" /><path fill="#FBBC05" d="M4 10.8a5.4 5.4 0 010-3.5V5H1a9 9 0 000 8.1l3-2.3z" /><path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3L15 2.4A9 9 0 001 5l3 2.3c.7-2.1 2.7-3.7 5-3.7z" /></svg>
  ),
};

// ---------- theme (the same setting as the editor's) ----------
const KEY = 'pune-remix:settings';
const readSettings = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export const isDark = () => document.documentElement.dataset.theme === 'dark';
export function setTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem(KEY, JSON.stringify({ ...readSettings(), theme: dark ? 'dark' : 'light' })); } catch { /* private mode */ }
}

function ThemeToggle() {
  const [d, setD] = useState(isDark());
  return (
    <button class="icon-btn" aria-label={d ? 'Use the light theme' : 'Use the dark theme'} title={d ? 'Light theme' : 'Dark theme'} onClick={() => { setTheme(!d); setD(!d); }}>
      {d ? <Icon.sun /> : <Icon.moon />}
    </button>
  );
}

/** "Sign in" or the signed-in account (avatar + first name). */
export function AccountLink() {
  const s = session.value;
  if (!authReady || s === null) return <a class="btn btn-ghost hide-sm" href={href('login/')}>Sign in</a>;
  if (s === undefined) return <span class="btn btn-ghost hide-sm" aria-hidden="true" style="visibility:hidden">Sign in</span>;
  const name = shortName(s.user);
  return <a class="chip-account" href={href('account/')} title={s.user.email ?? ''}><span class="avatar">{name[0]?.toUpperCase()}</span><span class="hide-sm">{name}</span></a>;
}

const NAV: [string, string][] = [['#features', 'Product'], ['#plan', 'Today vs. plan'], ['pricing/', 'Pricing']];

export function Header({ current }: { current?: string }) {
  const [open, setOpen] = useState(false);
  const onHome = current === 'landing';
  return (
    <header class="site-head">
      <div class="wrap">
        <Logo />
        <nav class={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
          {NAV.map(([to, label]) => {
            const url = to.startsWith('#') ? (onHome ? to : href('') + to) : href(to);
            return <a key={to} href={url} aria-current={current === to ? 'page' : undefined} onClick={() => setOpen(false)}>{label}</a>;
          })}
          <a class="show-xs" href={APP}>Open the editor</a>
          {authReady && !session.value && <a class="show-xs" href={href('login/')}>Sign in</a>}
        </nav>
        <div class="head-actions">
          <ThemeToggle />
          <AccountLink />
          <a class="btn btn-ink hide-xs" href={APP}>Open editor</a>
          <button class="icon-btn menu-btn" aria-label={open ? 'Close the menu' : 'Open the menu'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <Icon.close /> : <Icon.menu />}</button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer class="site-foot">
      <div class="wrap">
        <div class="foot-row">
          <Logo />
          <nav aria-label="Footer">
            <a href={APP}>Editor</a>
            <a href={href('pricing/')}>Pricing</a>
            <a href={href('signup/')}>Create an account</a>
            <a href={href('login/')}>Sign in</a>
            <a href={href('terms/')}>Terms</a>
            <a href={href('privacy/')}>Privacy</a>
          </nav>
        </div>
        <div class="foot-legal">
          <span>© OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus · DP sheets © Pune Municipal Corporation.</span>
          <span>A survey aid and concept tool. Not engineering advice, a DP remark or a zone certificate.</span>
        </div>
      </div>
    </footer>
  );
}

export function Page({ current, children }: { current?: string; children: ComponentChildren }) {
  return (
    <>
      <a class="skip" href="#main">Skip to content</a>
      <Header current={current} />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}

/** A same-site path to go to after signing in (?next=/app/…); anything else falls back to the account page. */
export function nextUrl(): string {
  const n = new URLSearchParams(location.search).get('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : href('account/');
}
