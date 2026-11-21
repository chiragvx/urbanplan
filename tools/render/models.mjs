// CC0 entourage models for Pro's 3D: Kenney's motorcycle, trucks and character, from his starter kits on GitHub (the
// kits' code is MIT; their 3D models are CC0, as each README says). Fetched into public/assets/render/models/ with a
// manifest the app reads (src/pro/render/entourage.ts loadModels) and LICENSES.md. Without them the app draws its
// own simple cars and people.
//
//   npm run render:models            fetch what's missing
//   npm run render:models -- --force fetch again
import fs from 'node:fs';
import path from 'node:path';

const RAW = 'https://raw.githubusercontent.com/KenneyNL';
const MODELS = [
  { key: 'motorcycle', repo: 'Starter-Kit-Racing', file: 'models/vehicle-motorcycle.glb', length: 2.0 },
  { key: 'truck-red', repo: 'Starter-Kit-Racing', file: 'models/vehicle-truck-red.glb', length: 5.5 },
  { key: 'truck-yellow', repo: 'Starter-Kit-Racing', file: 'models/vehicle-truck-yellow.glb', length: 5.5 },
  { key: 'truck-green', repo: 'Starter-Kit-Racing', file: 'models/vehicle-truck-green.glb', length: 5.5 },
  { key: 'person', repo: 'Starter-Kit-3D-Platformer', file: 'models/character.glb', height: 1.7 },
];
const force = process.argv.includes('--force');
const out = path.resolve('public', 'assets', 'render', 'models');
fs.mkdirSync(out, { recursive: true });
const manifest = {};
for (const m of MODELS) {
  const dest = path.join(out, `${m.key}.glb`);
  if (!fs.existsSync(dest) || force) {
    const url = `${RAW}/${m.repo}/main/${m.file}`;
    process.stdout.write(`${m.key}: ${url} … `);
    const res = await fetch(url);
    if (!res.ok) { console.log(`failed (${res.status})`); continue; }
    const b = Buffer.from(await res.arrayBuffer());
    if (b.subarray(0, 4).toString() !== 'glTF') { console.log('not a GLB: skipped'); continue; }
    fs.writeFileSync(dest, b);
    console.log(`${Math.round(b.length / 1024)} kB`);
  }
  if (fs.existsSync(dest)) manifest[m.key] = { file: `${m.key}.glb`, ...(m.length ? { length: m.length } : {}), ...(m.height ? { height: m.height } : {}), source: `https://github.com/KenneyNL/${m.repo}`, licence: 'CC0 1.0 (Kenney)' };
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(out, 'LICENSES.md'), ['# Entourage models', '', 'By Kenney (kenney.nl), CC0 1.0: free to use, change and redistribute.', '',
  ...Object.entries(manifest).map(([k, v]) => `- ${k}: ${v.source}`), ''].join('\n'));
console.log(`${Object.keys(manifest).length} models in ${out}`);
