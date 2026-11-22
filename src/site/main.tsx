// The website's pages, all rendered from here: <div id="site" data-page="…"> names the page (src/site/views.ts).
// The build prerenders every page, so its HTML is already there and is hydrated; in development it's rendered afresh.
import { hydrate, render } from 'preact';
import { inject } from '@vercel/analytics';
import './site.css';
import { viewOf } from './views';
import { isPhone } from '../device';

const root = document.getElementById('site')!;
const view = viewOf(root.dataset.page ?? '') ?? viewOf('404')!;
void view().then((v) => (root.firstElementChild ? hydrate(v, root) : render(v, root)));

// Vercel Web Analytics (page views; a no-op off Vercel)
inject();

// On a phone a link that starts a project (Try it, a template's Use it) goes to the dashboard: projects are made on a
// computer and only opened and shared on a phone (docs/plans/mobile-view-only.md). Pro would send it there anyway;
// this saves loading the editor first.
addEventListener('click', (ev: MouseEvent) => {
  const a = (ev.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !/\/pro\/$/.test(u.pathname) || !u.searchParams.has('new')) return;
  if (!isPhone()) return;
  ev.preventDefault();
  location.assign(`${import.meta.env.BASE_URL}dashboard/`);
});
