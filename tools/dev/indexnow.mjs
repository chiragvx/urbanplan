// Tells Bing, Yandex, Seznam and the other IndexNow engines about every page in the live sitemap, so new and changed
// pages are crawled within hours instead of weeks. Run after a deploy:   npm run indexnow   (SITE_URL to override)
// The key is public by design: it must be served at <site>/<key>.txt (public/f40ab0b126a47d3bb408e0661f489cd6.txt).
const KEY = 'f40ab0b126a47d3bb408e0661f489cd6';
const site = (process.env.SITE_URL || 'https://urbanplan-seven.vercel.app').replace(/\/+$/, '');
const xml = await (await fetch(`${site}/sitemap.xml`)).text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urls.length) throw new Error('no URLs in the sitemap');
const check = await fetch(`${site}/${KEY}.txt`);
if (!check.ok) throw new Error(`the key file isn't live at ${site}/${KEY}.txt (deploy first)`);
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key: KEY, keyLocation: `${site}/${KEY}.txt`, urlList: urls }),
});
console.log(`indexnow: ${urls.length} URLs → ${res.status} ${res.statusText}`);
if (res.status >= 400) console.log(await res.text());
