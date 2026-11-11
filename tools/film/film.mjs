// Render a "What If" episode to video: opens film mode in Chrome (your installed one, a throwaway profile), waits
// while the page renders every frame into film/out/<scene>/, then has ffmpeg make film/out/<scene>.mp4 (1080 × 1920,
// 30 fps, H.264, with the scene's synthesised soundtrack from sound.ts) plus square and landscape cuts.
//
//   npm run film -- wi-01                       render + assemble (uses a dev server on --port, or starts one)
//   npm run film -- wi-01 --every=30            a contact sheet's worth of frames (no video)
//   npm run film -- wi-01 --frames=0-30,600     just these frames (no video)
//   npm run film -- wi-01 --assemble            frames already rendered: video only
//   npm run film -- wi-01 --sound               just the soundtrack: film/out/wi-01.wav
//   npm run film -- wi-01 --assemble --voice=bf_emma   another narrator: re-voice and re-mux (~1 min, no re-render)
//   options: --port=5294  --ss=1.5 (render scale)  --no-cuts  --no-sound (silent video)  --no-vo (no voice-over)  --voice=<kokoro voice>  --chrome=<path to chrome.exe>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const scene = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : d; };
if (!scene || !/^[a-z0-9][a-z0-9_-]*$/i.test(scene)) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 10).join('\n')); process.exit(1); }

const port = Number(opt('port', 5294));
const out = path.resolve('film', 'out', scene);
const partial = opt('frames') || opt('every');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function up() { try { return (await fetch(`http://localhost:${port}/app/`)).ok; } catch { return false; } }

function chromePath() {
  const c = opt('chrome') || process.env.CHROME;
  const list = [c, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  return list.find((p) => p && fs.existsSync(p));
}

const kill = (p) => { if (!p || p.exitCode !== null) return; if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill(); };

async function render() {
  let server = null;
  if (!(await up())) {
    console.log(`starting a dev server on port ${port}…`);
    server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FILM: '1' } });
    server.stdout.on('data', (d) => { for (const l of String(d).split('\n')) if (l.includes('[film]')) console.log(l.trim()); });
    server.stderr.on('data', (d) => process.stderr.write(d));
    for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
    if (!(await up())) { kill(server); throw new Error('dev server did not start'); }
  }
  const exe = chromePath();
  if (!exe) throw new Error('Chrome not found: pass --chrome=<path>');
  const q = new URLSearchParams({ film: scene, capture: '' });
  for (const k of ['frames', 'every', 'ss', 'profile']) if (opt(k)) q.set(k, String(opt(k)));
  const url = `http://localhost:${port}/app/?${q}`.replace('capture=', 'capture');
  fs.rmSync(path.join(out, 'done.json'), { force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanplan-film-'));
  console.log(`rendering ${url}`);
  const chrome = spawn(exe, [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    // keep rendering at full speed when the window isn't in front
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // the discrete GPU on a laptop with two: Chrome on Windows ignores WebGPU's powerPreference and picks the integrated
    // one, several times slower and drawing on system RAM
    '--force_high_performance_gpu',
    '--window-size=600,1040', `--app=${url}`,
  ], { stdio: 'ignore' });
  const t0 = Date.now();
  let done = null;
  try {
    while (!done) {
      await sleep(1000);
      if (fs.existsSync(path.join(out, 'done.json'))) done = JSON.parse(fs.readFileSync(path.join(out, 'done.json'), 'utf8'));
      else if (chrome.exitCode !== null) throw new Error('Chrome closed before the film finished');
      else if (Date.now() - t0 > 3600e3) throw new Error('gave up after an hour');
    }
  } finally {
    kill(chrome);
    if (server) kill(server);
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  if (done.error) throw new Error(done.error);
  console.log(`rendered in ${done.seconds} s (${done.backend}${done.gpuErrors ? `, ${done.gpuErrors} GPU errors: check the frames` : ''})`);
  console.log('measured', JSON.stringify(done.values));
}

function ffmpeg(list) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...list], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

/** film/out/<scene>.wav, from the scene's timings (tools/film/sound.ts) */
function sound() {
  const js = path.resolve('tools', 'dev', 'film-sound.mjs');
  const b = spawnSync('npx', ['esbuild', 'tools/film/sound.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${js}`, '--log-level=warning'], { shell: true, stdio: 'inherit' });
  if (b.status !== 0) throw new Error('could not build the soundtrack');
  const r = spawnSync(process.execPath, [js, scene, ...(opt('no-vo') ? ['--no-vo'] : []), ...(opt('voice') ? [`--voice=${opt('voice')}`] : [])], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('soundtrack failed');
  return path.resolve('film', 'out', `${scene}.wav`);
}

/** ffmpeg in the background (the cuts run side by side) */
function ffmpegAsync(list) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...list], { stdio: 'inherit' });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg failed (${c})`))));
  });
}

async function assemble() {
  const fps = (() => { try { return JSON.parse(fs.readFileSync(path.join(out, 'done.json'), 'utf8')).fps ?? 30; } catch { return 30; } })();
  const wav = opt('no-sound') ? null : sound();
  const file = (s) => path.resolve('film', 'out', `${scene}${s}.mp4`);
  // the soundtrack as AAC (sound.ts has already levelled it to -14 LUFS)
  const audio = wav ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest'] : [];
  const streamed = path.join(out, 'video.mp4');
  if (fs.existsSync(streamed)) {
    // a streamed render: the picture is already encoded (as it rendered); add the sound without touching it
    ffmpeg(['-i', streamed, ...(wav ? ['-i', wav] : []), '-map', '0:v', '-c:v', 'copy', ...audio, '-movflags', '+faststart', file('')]);
  } else {
    const enc = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map', '0:v'];
    ffmpeg(['-framerate', String(fps), '-i', path.join(out, '%06d.png'), ...(wav ? ['-i', wav] : []), ...enc, ...audio, file('')]);
  }
  console.log(`→ ${file('')}`);
  if (opt('no-cuts')) return;
  // square and landscape, from the finished vertical film, both at once on the GPU's encoder (NVENC; x264 without
  // one): the film centred on a blurred, darkened copy of itself (nothing cropped away), its sound copied across
  const gpu = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-']).status === 0;
  const venc = gpu ? ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
  await Promise.all([[1080, 1080, '-1x1'], [1920, 1080, '-16x9']].map(([w, h, s]) =>
    ffmpegAsync(['-i', file(''), '-filter_complex', `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:3,eq=brightness=-0.12[bg];[b]scale=-2:${h}[fg];[bg][fg]overlay=(W-w)/2:0[v]`,
      '-map', '[v]', ...venc, '-pix_fmt', 'yuv420p', ...(wav ? ['-map', '0:a', '-c:a', 'copy'] : []), '-movflags', '+faststart', file(s)]).then(() => console.log(`→ ${file(s)}`))));
}

/** A contact sheet of the frames rendered (partial renders): film/out/<scene>-sheet.png, frame numbers burnt in. */
function sheet() {
  const files = fs.readdirSync(out).filter((f) => /^\d{6}\.png$/.test(f)).sort();
  if (!files.length) return;
  const cols = Math.min(6, files.length), rows = Math.ceil(files.length / cols);
  const list = path.join(out, 'sheet.txt');
  fs.writeFileSync(list, files.map((f) => `file '${path.join(out, f).replace(/\\/g, '/')}'`).join('\n'));
  const file = path.resolve('film', 'out', `${scene}-sheet.png`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=320:568,tile=${cols}x${rows}:padding=4`, '-frames:v', '1', file]);
  fs.rmSync(list);
  console.log(`→ ${file} (${files.join(' ').replace(/\.png/g, '')})`);
}

try {
  if (opt('sound')) { sound(); process.exit(0); }
  if (!opt('assemble')) await render();
  if (!partial) await assemble(); else sheet();
} catch (e) { console.error(`film: ${e.message}`); process.exit(1); }
