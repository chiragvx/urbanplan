import { createServer, defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_URL_FALLBACK } from './src/site/brand';
import { filmPlugin } from './tools/film/vite-film';

/**
 * Dev-server endpoints so the editor can keep maps as files in the project:
 *   GET  /__maps/list            maps/*.urbanplan.json (name, author, edits)
 *   GET  /__maps/file?name=      one map file
 *   POST /__maps/save?name=      write maps/<name>
 *   POST /__maps/publish?name=   copy into public/maps/ and list it in public/maps/index.json (the site gallery)
 */
function mapsPlugin(): Plugin {
  const dir = path.resolve('maps'), pub = path.resolve('public', 'maps');
  const ok = (n: string | null): n is string => !!n && /^[a-z0-9][a-z0-9._-]*\.(urbanplan|punemap)\.json$/i.test(n);
  const body = (req: import('node:http').IncomingMessage) => new Promise<string>((res, rej) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 50e6) rej(new Error('too large')); });
    req.on('end', () => res(s));
    req.on('error', rej);
  });
  const summary = (text: string) => {
    const f = JSON.parse(text);
    if (f.format !== 'urbanplan/map' && f.format !== 'pune-remix/map') throw new Error('not a map file');
    return { name: f.meta?.name ?? '', author: f.meta?.author ?? '', description: f.meta?.description ?? '', updated: f.meta?.updated ?? '', edits: Object.keys(f.objects ?? {}).length };
  };
  return {
    name: 'urbanplan-maps',
    configureServer(server) {
      server.middlewares.use('/__maps', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const name = url.searchParams.get('name');
        const send = (code: number, data: string, type = 'text/plain') => { res.statusCode = code; res.setHeader('content-type', type); res.end(data); };
        try {
          if (url.pathname === '/list') {
            fs.mkdirSync(dir, { recursive: true });
            const list = fs.readdirSync(dir).filter((f) => f.endsWith('.urbanplan.json') || f.endsWith('.punemap.json')).map((file) => {
              try { return { file, ...summary(fs.readFileSync(path.join(dir, file), 'utf8')) }; } catch { return null; }
            }).filter(Boolean);
            return send(200, JSON.stringify(list), 'application/json');
          }
          if (!ok(name)) return send(400, 'bad file name');
          if (url.pathname === '/file' && req.method === 'GET') return send(200, fs.readFileSync(path.join(dir, name), 'utf8'), 'application/json');
          if (req.method !== 'POST') return send(405, 'POST only');
          const text = await body(req);
          const meta = summary(text);
          if (url.pathname === '/save') {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, name), text);
            return send(200, `maps/${name}`);
          }
          if (url.pathname === '/publish') {
            fs.mkdirSync(pub, { recursive: true });
            fs.writeFileSync(path.join(pub, name), text);
            const idxPath = path.join(pub, 'index.json');
            const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { maps: [] };
            idx.maps = [{ file: name, ...meta }, ...idx.maps.filter((m: { file: string }) => m.file !== name)];
            fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
            return send(200, `maps/${name}`);
          }
          send(404, 'unknown');
        } catch (e) { send(500, (e as Error).message); }
      });
    },
  };
}

/** The site's address, for canonical links, social cards and the sitemap: SITE_URL (or VITE_SITE_URL) on the host
 *  that builds it, with the base path if there is one, no trailing slash. */
// (SITE_URL_FALLBACK is in src/site/brand.ts, with the site's name)

/** The HTML entries: the landing page, the editor at /app/, and the template every other page of the website is
 *  built from (src/site/routes.ts lists them). */
const ENTRIES: Record<string, string> = { index: 'index.html', app: 'app/index.html', page: 'src/site/page.html' };
/** routes with an HTML entry of their own */
const OWN: Record<string, string> = { '': 'index.html', 'app/': 'app/index.html' };
const TEMPLATE = 'src/site/page.html';

type Prerender = typeof import('./src/site/prerender');

/** Fill a page's HTML: its <head> tags in place of <title>; the prerendered page (if given) in <div id="site">. */
function fill(html: string, r: Prerender['ROUTES'][number], m: Prerender, site: string, page: string | null, base = '/') {
  const out = html.replace(/<!-- The website's page template[\s\S]*?-->\s*/, '').replace(/<title>[\s\S]*?<\/title>/, () => m.head(r, site, base))
    .replace(/<html lang="[^"]*">/, `<html lang="${m.langOf(r)}">`);
  return page === null ? out : out.replace(/<div id="site" data-page="[^"]*"><\/div>/, () => `<div id="site" data-page="${r.path}">${page}</div>`);
}

/**
 * The website, prerendered: after the build, every route in src/site/routes.ts is rendered to HTML (Preact, in Node,
 * through a Vite SSR loader) and written to dist/<path>/index.html with its head tags, so search engines and link
 * previews see the page; the browser then hydrates it. Writes 404.html, sitemap.xml, robots.txt, llms.txt and
 * site.webmanifest too, and warns about titles and descriptions that are too long or shared. In development the
 * template pages are served with their head and rendered in the browser.
 */
function sitePlugin(): Plugin {
  let config: ResolvedConfig;
  const siteUrl = () => (process.env.SITE_URL || process.env.VITE_SITE_URL || config.env.VITE_SITE_URL || SITE_URL_FALLBACK).replace(/\/+$/, '');
  return {
    name: 'urbanplan-site',
    configResolved(c) { config = c; },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || !req.url) return next();
        const url = new URL(req.url, 'http://x');
        if (!url.pathname.startsWith(config.base)) return next();
        const p = decodeURIComponent(url.pathname.slice(config.base.length));
        // (the files the build writes from the routes, made afresh)
        if (p === 'site.webmanifest' || p === 'llms.txt' || p === 'robots.txt' || p === 'sitemap.xml') {
          const m = (await server.ssrLoadModule('/src/site/prerender.ts')) as Prerender;
          const text = p === 'site.webmanifest' ? m.manifest(config.base) : p === 'llms.txt' ? m.llms(siteUrl()) : p === 'robots.txt' ? m.robots(siteUrl()) : m.sitemap(siteUrl());
          res.setHeader('content-type', p.endsWith('.xml') ? 'application/xml' : p.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/plain; charset=utf-8');
          return res.end(text);
        }
        // (files, Vite's own requests and the pages with their own HTML go on as usual)
        if (p in OWN || /\.[a-z0-9]+$/i.test(p) || /^(@|src\/|node_modules\/|__)/.test(p)) return next();
        try {
          const m = (await server.ssrLoadModule('/src/site/prerender.ts')) as Prerender;
          const want = p.endsWith('/') ? p : `${p}/`;
          const r = m.ROUTES.find((x) => x.path === want);
          if (!r) return next();
          if (want !== p) { res.statusCode = 301; res.setHeader('location', `${config.base}${want}${url.search}`); return res.end(); }
          const html = fill(fs.readFileSync(path.resolve(config.root, TEMPLATE), 'utf8'), r, m, siteUrl(), '', config.base);
          res.setHeader('content-type', 'text/html');
          res.end(await server.transformIndexHtml(req.url, html));
        } catch (e) { next(e); }
      });
    },
    async closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return;
      const out = path.resolve(config.root, config.build.outDir), site = siteUrl();
      if (site === SITE_URL_FALLBACK) config.logger.warn(`site: SITE_URL isn't set; canonical links and the sitemap use ${SITE_URL_FALLBACK}`);
      // a throwaway Vite server just to load the pages in Node (same root, base and env as the build)
      const server = await createServer({
        configFile: false, root: config.root, base: config.base, mode: config.mode, logLevel: 'error', appType: 'custom',
        server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
      });
      try {
        const m = (await server.ssrLoadModule('/src/site/prerender.ts')) as Prerender;
        const template = fs.readFileSync(path.join(out, TEMPLATE), 'utf8');
        for (const r of m.ROUTES) {
          const own = OWN[r.path];
          // (the not-found page goes to 404.html, which static hosts serve for any missing path)
          const file = path.join(out, own ?? (r.path === '404' ? '404.html' : `${r.path}index.html`));
          const html = fill(own ? fs.readFileSync(file, 'utf8') : template, r, m, site, r.view ? await m.body(r) : null, config.base);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, html);
        }
        fs.writeFileSync(path.join(out, 'sitemap.xml'), m.sitemap(site));
        fs.writeFileSync(path.join(out, 'robots.txt'), m.robots(site));
        fs.writeFileSync(path.join(out, 'llms.txt'), m.llms(site));
        fs.writeFileSync(path.join(out, 'site.webmanifest'), m.manifest(config.base));
        // titles, descriptions and hreflang pairs: warn, don't fail (tools/dev/check-site.mjs checks the output in full)
        for (const w of m.checkHeads()) config.logger.warn(`site: ${w}`);
        fs.rmSync(path.join(out, 'src'), { recursive: true, force: true });
        config.logger.info(`site: prerendered ${m.ROUTES.length} pages for ${site}`);
      } finally {
        await server.close();
      }
    },
  };
}

export default defineConfig({
  plugins: [mapsPlugin(), sitePlugin(), filmPlugin()],
  // osm2streets is a wasm-bindgen package; keep it out of dependency pre-bundling so its .wasm resolves cleanly
  optimizeDeps: { exclude: ['osm2streets-js'] },
  worker: { format: 'es' },
  // film renders (tools/film/film.mjs) start their own server with FILM=1: no file watching or hot reload, so an edit
  // made while a film renders can't reload the page halfway through it
  ...(process.env.FILM ? { server: { hmr: false, watch: { ignored: ['**/*'] } } } : {}),
  build: {
    target: 'es2022', chunkSizeWarningLimit: 4000,
    rollupOptions: { input: Object.fromEntries(Object.entries(ENTRIES).map(([k, f]) => [k, path.resolve(f)])) },
  },
});
