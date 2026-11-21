// Reference shots of Pro's 3D, for checking the render quality and catching regressions. Opens the sample scheme in
// Chrome (your installed one, a throwaway profile) with ?shots, which renders each reference view as a still (the
// whole site, the street, from above; by day, a low winter sun, and night) and sends them to render-out/shots/<set>/,
// with the frame-time benchmark in done.json. Then, if there are reference images, compares each with pixelmatch.
//
//   npm run render:shots                         capture into render-out/shots/<tier>/ and compare with tools/render/ref/<tier>/
//   npm run render:shots -- --tier=high          another tier (draft, standard, high)
//   npm run render:shots -- --compare            compare only (shots already captured)
//   npm run render:shots -- --accept             make the captured shots the references (commit them deliberately)
//   options: --port=5296  --chrome=<path to chrome.exe>
// Fails when more than 0.5 % of a shot's pixels differ from its reference (threshold 0.1). References come from one
// machine: GPUs differ, so accept a new set on the machine that compares.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : d; };
const tier = String(opt('tier', 'standard'));
const port = Number(opt('port', 5296));
const out = path.resolve('render-out', 'shots', tier), ref = path.resolve('tools', 'render', 'ref', tier), diffs = path.resolve('render-out', 'diff', tier);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async () => { try { return (await fetch(`http://localhost:${port}/pro/`)).ok; } catch { return false; } };
const kill = (p) => { if (!p || p.exitCode !== null) return; if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill(); };
function chromePath() {
  const c = opt('chrome') || process.env.CHROME;
  return [c, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
}

async function capture() {
  let server = null;
  if (!(await up())) {
    console.log(`starting a dev server on port ${port}…`);
    server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { shell: true, stdio: 'ignore', env: { ...process.env, FILM: '1' } });
    for (let i = 0; i < 120 && !(await up()); i++) await sleep(500);
    if (!(await up())) { kill(server); throw new Error('dev server did not start'); }
  }
  const exe = chromePath();
  if (!exe) throw new Error('Chrome not found: pass --chrome=<path>');
  fs.rmSync(out, { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanplan-shots-'));
  const url = `http://localhost:${port}/pro/?new=sample&shots=${tier}`;
  console.log(`capturing ${url}`);
  const chrome = spawn(exe, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force_high_performance_gpu',
    '--window-size=1400,900', `--app=${url}`], { stdio: 'ignore' });
  const t0 = Date.now();
  try {
    while (!fs.existsSync(path.join(out, 'done.json'))) {
      await sleep(1000);
      if (chrome.exitCode !== null) throw new Error('Chrome closed before the shots finished');
      if (Date.now() - t0 > 600e3) throw new Error('gave up after ten minutes');
    }
  } finally { kill(chrome); if (server) kill(server); await sleep(500); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); }
  console.log('benchmark', fs.readFileSync(path.join(out, 'done.json'), 'utf8'));
}

function compare() {
  if (!fs.existsSync(ref)) { console.log(`no references in ${ref}: run with --accept to make these the references`); return true; }
  fs.mkdirSync(diffs, { recursive: true });
  let ok = true;
  for (const f of fs.readdirSync(ref).filter((x) => x.endsWith('.png'))) {
    const a = path.join(ref, f), b = path.join(out, f);
    if (!fs.existsSync(b)) { console.log(`MISSING ${f}`); ok = false; continue; }
    const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
    if (A.width !== B.width || A.height !== B.height) { console.log(`SIZE ${f}: ${A.width}×${A.height} vs ${B.width}×${B.height}`); ok = false; continue; }
    const D = new PNG({ width: A.width, height: A.height });
    const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.1 }), share = n / (A.width * A.height);
    fs.writeFileSync(path.join(diffs, f), PNG.sync.write(D));
    const bad = share > 0.005; if (bad) ok = false;
    console.log(`${bad ? 'DIFF' : 'ok  '} ${f}  ${(share * 100).toFixed(2)}%`);
  }
  return ok;
}

if (opt('accept')) {
  fs.mkdirSync(ref, { recursive: true });
  for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.png'))) fs.copyFileSync(path.join(out, f), path.join(ref, f));
  console.log(`accepted ${out} as the references in ${ref}`);
} else {
  if (!opt('compare')) await capture();
  process.exit(compare() ? 0 : 1);
}
