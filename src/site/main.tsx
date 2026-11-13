// The website's pages, all rendered from here: <div id="site" data-page="…"> names the page (src/site/views.ts).
// The build prerenders every page, so its HTML is already there and is hydrated; in development it's rendered afresh.
import { hydrate, render } from 'preact';
import { inject } from '@vercel/analytics';
import './site.css';
import { viewOf } from './views';

const root = document.getElementById('site')!;
const view = viewOf(root.dataset.page ?? '') ?? viewOf('404')!;
void view().then((v) => (root.firstElementChild ? hydrate(v, root) : render(v, root)));

// Vercel Web Analytics (page views; a no-op off Vercel)
inject();
