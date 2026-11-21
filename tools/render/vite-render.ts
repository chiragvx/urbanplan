// Dev-server endpoints for render shots (/pro/?new=sample&shots[&tier=]): the page renders each reference view as a
// still and sends it here.
//   POST /__render/shot?set=&name=   write render-out/shots/<set>/<name>.png (the request body)
//   POST /__render/done?set=         write render-out/shots/<set>/done.json (the body: timings, counts)
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function renderPlugin(): Plugin {
  const root = path.resolve('render-out', 'shots');
  const word = (s: string | null) => (s && /^[a-z0-9][a-z0-9_-]*$/i.test(s) ? s : null);
  const body = (req: import('node:http').IncomingMessage) => new Promise<Buffer>((res, rej) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => res(Buffer.concat(parts)));
    req.on('error', rej);
  });
  return {
    name: 'urbanplan-render',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__render', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x'), q = url.searchParams;
        const send = (code: number, data = '') => { res.statusCode = code; res.end(data); };
        const set = word(q.get('set'));
        if (req.method !== 'POST' || !set) return send(400, 'bad request');
        const dir = path.join(root, set);
        fs.mkdirSync(dir, { recursive: true });
        if (url.pathname === '/shot') {
          const name = word(q.get('name'));
          if (!name) return send(400, 'bad name');
          fs.writeFileSync(path.join(dir, `${name}.png`), await body(req));
          return send(200);
        }
        if (url.pathname === '/done') { fs.writeFileSync(path.join(dir, 'done.json'), await body(req)); return send(200); }
        send(404);
      });
    },
  };
}
