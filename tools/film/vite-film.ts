// Dev-server endpoints for film mode (/app/?film=<scene>): the page renders each frame and sends it here.
//   POST /__film/start?scene=           empty film/out/<scene>/ for a fresh render
//   POST /__film/frame?scene=&f=[&layer=]  write film/out/<scene>/[<layer>/]<f>.png (the request body)
//   GET  /__film/frame?scene=&f=[&layer=]  read one back (the split screen's BEFORE half)
//   POST /__film/done?scene=            write film/out/<scene>/done.json (the body: frame count, fps, measurements)
//   POST /__film/log                    print a line in the dev server's terminal (progress)
// A full render streams instead (no PNGs: compressing them was two thirds of a frame's time):
//   POST /__film/open?scene=&w=&h=&fps=   start ffmpeg on film/out/<scene>/video.mp4 (H.264, silent)
//   POST /__film/raw?scene=&f=           one frame's RGBA pixels into it, in frame order (held until their turn)
//   POST /__film/raw?scene=&f=&layer=    …or kept as a file (the split's BEFORE halves); GET reads one back
//   POST /__film/close?scene=            finish the video
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function filmPlugin(): Plugin {
  const root = path.resolve('film', 'out');
  const word = (s: string | null) => (s && /^[a-z0-9][a-z0-9_-]*$/i.test(s) ? s : null);
  const body = (req: import('node:http').IncomingMessage) => new Promise<Buffer>((res, rej) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => res(Buffer.concat(parts)));
    req.on('error', rej);
  });
  /** the video being encoded per scene: ffmpeg, the frames it still expects in order, early arrivals */
  const streams = new Map<string, { ff: ChildProcessWithoutNullStreams; order: number[]; at: number; early: Map<number, Buffer>; done: Promise<number>; err: string }>();
  const write = (ff: ChildProcessWithoutNullStreams, b: Buffer) => new Promise<void>((res) => { if (ff.stdin.write(b)) res(); else ff.stdin.once('drain', () => res()); });
  return {
    name: 'urbanplan-film',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__film', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const q = url.searchParams;
        const send = (code: number, data: string | Buffer = '', type = 'text/plain') => { res.statusCode = code; res.setHeader('content-type', type); res.end(data); };
        try {
          if (url.pathname === '/log') { console.log(`[film] ${(await body(req)).toString()}`); return send(200); }
          const scene = word(q.get('scene'));
          if (!scene) return send(400, 'bad scene');
          const dir = path.join(root, scene);
          if (url.pathname === '/start' && req.method === 'POST') {
            fs.rmSync(dir, { recursive: true, force: true });
            fs.mkdirSync(dir, { recursive: true });
            return send(200);
          }
          if (url.pathname === '/done' && req.method === 'POST') {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'done.json'), await body(req));
            return send(200);
          }
          if (url.pathname === '/open' && req.method === 'POST') {
            const w = Number(q.get('w')), h = Number(q.get('h')), fps = Number(q.get('fps')), order = JSON.parse((await body(req)).toString() || '[]') as number[];
            if (!(w > 0 && h > 0 && fps > 0)) return send(400, 'bad size');
            fs.mkdirSync(dir, { recursive: true });
            // x264 "medium" at CRF 18 keeps well ahead of the frames (45 fps at this size on this laptop)
            const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
              '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'video.mp4')]);
            const st = { ff, order, at: 0, early: new Map<number, Buffer>(), err: '', done: new Promise<number>((r) => ff.on('close', (c) => r(c ?? 1))) };
            ff.stderr.on('data', (d) => { st.err += String(d); });
            ff.stdin.on('error', () => {});
            streams.set(scene, st);
            return send(200);
          }
          if (url.pathname === '/close' && req.method === 'POST') {
            const st = streams.get(scene);
            if (!st) return send(404, 'no stream');
            streams.delete(scene);
            if (st.early.size) { st.ff.kill(); return send(500, `frames never sent: ${st.order.slice(st.at, st.at + 5).join(', ')}…`); }
            st.ff.stdin.end();
            const code = await st.done;
            return code === 0 ? send(200) : send(500, `ffmpeg ${code}: ${st.err.slice(-300)}`);
          }
          if (url.pathname === '/raw') {
            const f = q.get('f'), layer = q.get('layer');
            if (!f || !/^\d{1,6}$/.test(f) || (layer && !word(layer))) return send(400, 'bad frame');
            if (layer) {
              const sub = path.join(dir, layer), file = path.join(sub, `${f.padStart(6, '0')}.rgba`);
              if (req.method === 'GET') return fs.existsSync(file) ? send(200, fs.readFileSync(file), 'application/octet-stream') : send(404, 'no frame');
              fs.mkdirSync(sub, { recursive: true });
              fs.writeFileSync(file, await body(req));
              return send(200);
            }
            const st = streams.get(scene);
            if (!st) return send(409, 'no stream open');
            st.early.set(Number(f), await body(req));
            // write every frame whose turn has come; answer once ffmpeg has taken them (the page waits: no pile-up)
            while (st.at < st.order.length && st.early.has(st.order[st.at])) {
              const b = st.early.get(st.order[st.at])!;
              st.early.delete(st.order[st.at++]);
              await write(st.ff, b);
            }
            return send(200);
          }
          if (url.pathname === '/frame') {
            const f = q.get('f'), layer = q.get('layer');
            if (!f || !/^\d{1,6}$/.test(f) || (layer && !word(layer))) return send(400, 'bad frame');
            const sub = layer ? path.join(dir, layer) : dir;
            const file = path.join(sub, `${f.padStart(6, '0')}.png`);
            if (req.method === 'GET') return fs.existsSync(file) ? send(200, fs.readFileSync(file), 'image/png') : send(404, 'no frame');
            fs.mkdirSync(sub, { recursive: true });
            fs.writeFileSync(file, await body(req));
            return send(200);
          }
          send(404, 'unknown');
        } catch (e) { send(500, (e as Error).message); }
      });
    },
  };
}
