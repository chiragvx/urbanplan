// The not-found page (dist/404.html, noindex): what the site has, so a broken link still leads somewhere.
import { href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';

const WAYS: [string, string, string][] = [
  ['pune/', 'Pune', 'Places, road widths and the Development Plan'],
  ['mumbai/', 'Mumbai', 'Places and road widths'],
  ['pune/map/', 'Pune 3D map', 'Roads, buildings and terrain'],
  ['pune/dp-map/', 'Pune DP map', 'Where the Development Plan is in ' + SITE_NAME],
  ['mumbai/map/', 'Mumbai 3D map', 'Roads, buildings and terrain'],
  ['guides/', 'Guides', 'FSI, setbacks, TDR and DP roads'],
  ['data/', 'Open data', 'The main road networks as GeoJSON'],
  ['app/', 'The editor', 'Pune and Mumbai in 2D and 3D'],
];

export function NotFoundBody() {
  return (
    <section class="wrap guide">
      <article class="wide">
        <h1>This page isn’t here</h1>
        <p class="answer">The link may be old, or mistyped. Here is what {SITE_NAME} has:</p>
        <div class="guide-list">
          {WAYS.map(([to, title, sub]) => <a key={to} href={href(to)}><h2 class="h3">{title}</h2><p>{sub}</p></a>)}
        </div>
        <p><a href={href('')}>Go to the home page <Icon.arrow /></a></p>
      </article>
    </section>
  );
}

export function NotFound() {
  return <Page><NotFoundBody /></Page>;
}
