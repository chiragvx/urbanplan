import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

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

export default defineConfig({
  plugins: [mapsPlugin()],
  // osm2streets is a wasm-bindgen package; keep it out of dependency pre-bundling so its .wasm resolves cleanly
  optimizeDeps: { exclude: ['osm2streets-js'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
