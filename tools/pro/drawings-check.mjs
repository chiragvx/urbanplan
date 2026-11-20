// node tools/pro/drawings-check.mjs <outdir> <port> [setJson|-] [template name] [city]
// Opens Pro (dev server on localhost:4402) in headless Chrome, goes to the approval step, shoots every sheet as PNG
// and downloads the PDF into <outdir>/gov (or gov-<port>). Chrome path below is Windows; change it on another machine.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [, , out, port = '9461', setJson, tpl, city] = process.argv;
const G = out + '/gov' + (tpl || city ? '-' + port : '');
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${out}/prof-gov-${port}`, 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(); const logs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') logs.push(JSON.stringify(m.params).slice(0, 400)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(JSON.stringify(m.params.args).slice(0, 300)); });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('urbanplan:pro:seen','true')}catch{}` });
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cmd('Page.navigate', { url: 'http://localhost:4402/pro/?new=sample' + (city ? '&city=' + city : '') }); await sleep(4000);
if (setJson && setJson !== '-') { await ev(`window.urbanplan.set(${setJson})`); await sleep(1200); }
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' }); };
if (tpl) {
  await ev(`(() => { const s = document.querySelectorAll('.rail .step')[2]; if (s.getAttribute('aria-current') !== 'step') s.click(); })()`); await sleep(800);
  console.log('tpl', await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(tpl)})); if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`)); await sleep(600);
  const r = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0].getBoundingClientRect())`));
  await click(r.x + r.width * 0.5, r.y + r.height * 0.55); await sleep(700); await click(r.x + r.width * 0.5, r.y + r.height * 0.55); await sleep(1500);
  console.log('buildings', await ev('window.urbanplan.get().scheme?.buildings?.length'));
}
const step = await ev(`(() => { const s = [...document.querySelectorAll('.rail .step')].find(b => /approv/i.test(b.textContent + (b.getAttribute('aria-label')||'') + (b.title||''))); if (!s) return [...document.querySelectorAll('.rail .step')].map(b => b.textContent + '/' + b.getAttribute('aria-label')).join('|'); if (s.getAttribute('aria-current') !== 'step') s.click(); return true; })()`);
console.log('step', step); await sleep(1000);
fs.mkdirSync(`${G}`, { recursive: true });
const panel = await cmd('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${G}/panel.png`, Buffer.from(panel.result.data, 'base64'));
const ok = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /Preview sheets/.test(b.textContent)); if (!b) return false; b.click(); return true; })()`);
console.log('opened', ok); await sleep(1500);
const n = await ev(`document.querySelectorAll('.sheet').length`);
console.log('sheets', n);
for (let i = 0; i < n; i++) {
  const r = JSON.parse(await ev(`(() => { const s = document.querySelectorAll('.sheet')[${i}]; s.scrollIntoView(); const b = s.getBoundingClientRect(); return JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height }); })()`));
  await sleep(250);
  const s = await cmd('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1.4 } });
  fs.writeFileSync(`${G}/sheet${i + 1}.png`, Buffer.from(s.result.data, 'base64'));
}
await cmd('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: `${G}`.replace(/\//g, '\\') });
for (const f of fs.readdirSync(`${G}`)) if (f.endsWith('.pdf')) fs.unlinkSync(`${G}/${f}`);
const t0 = Date.now();
console.log('pdf click', await ev(`(() => { const b = [...document.querySelectorAll('.sheets-bar button')].find(b => /Download PDF/.test(b.textContent)); if (!b) return false; b.click(); return true; })()`));
let pdf = null;
for (let i = 0; i < 120 && !pdf; i++) { await sleep(500); pdf = fs.readdirSync(`${G}`).find((f) => f.endsWith('.pdf')); }
console.log('pdf', pdf, pdf ? fs.statSync(`${G}/${pdf}`).size : 0, 'bytes in', Date.now() - t0, 'ms');
console.log('errors', logs.length ? logs.join('\n').slice(0, 1500) : 'none');
ws.close(); chrome.kill(); process.exit(0);
