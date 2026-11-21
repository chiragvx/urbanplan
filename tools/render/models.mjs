// CC0 entourage models for Pro's 3D, all by Kenney (kenney.nl), CC0 1.0:
//   cars (sedan, SUV, hatchback, taxi, delivery van) from his Car Kit, through its OpenGameArt mirror (CC0);
//   a motorcycle and trucks from his Racing starter kit, and a character from his 3D Platformer kit, on GitHub (the
//   kits' code is MIT; their models are CC0, as each README says).
// Each kit keeps its own folder, because every Kenney model reads its colours from a Textures/colormap.png beside it
// and each kit's atlas is different. Fetched into public/assets/render/models/<kit>/ with a manifest the app reads
// (src/pro/render/entourage.ts loadModels) and LICENSES.md. Without them the app draws its own simple cars and people.
//
//   npm run render:models            fetch what's missing
//   npm run render:models -- --force fetch again
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RAW = 'https://raw.githubusercontent.com/KenneyNL';
const KITS = [
  { kit: 'racing', source: 'https://github.com/KenneyNL/Starter-Kit-Racing', raw: `${RAW}/Starter-Kit-Racing/main/models`, models: [
    { key: 'motorcycle', file: 'vehicle-motorcycle.glb', length: 2.0 },
    { key: 'truck-red', file: 'vehicle-truck-red.glb', length: 5.5 },
    { key: 'truck-yellow', file: 'vehicle-truck-yellow.glb', length: 5.5 },
    { key: 'truck-green', file: 'vehicle-truck-green.glb', length: 5.5 },
  ] },
  { kit: 'platformer', source: 'https://github.com/KenneyNL/Starter-Kit-3D-Platformer', raw: `${RAW}/Starter-Kit-3D-Platformer/main/models`, models: [
    { key: 'person', file: 'character.glb', height: 1.7 },
  ] },
  { kit: 'cars', source: 'https://opengameart.org/content/car-kit', zip: 'https://opengameart.org/sites/default/files/kenney_car-kit_3.1.zip', inZip: 'Models/GLB format', models: [
    { key: 'car-sedan', file: 'sedan.glb', length: 4.5 },
    { key: 'car-suv', file: 'suv.glb', length: 4.7 },
    { key: 'car-hatchback', file: 'hatchback-sports.glb', length: 4.0 },
    { key: 'car-taxi', file: 'taxi.glb', length: 4.5 },
    { key: 'car-van', file: 'delivery.glb', length: 5.2 },
  ] },
];
const force = process.argv.includes('--force');
const out = path.resolve('public', 'assets', 'render', 'models');
fs.mkdirSync(out, { recursive: true });
const sysTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
const tar = fs.existsSync(sysTar) ? sysTar : 'tar';
const isGlb = (b) => b.subarray(0, 4).toString() === 'glTF';
const manifest = {};

for (const K of KITS) {
  const dir = path.join(out, K.kit), tex = path.join(dir, 'Textures');
  fs.mkdirSync(tex, { recursive: true });
  const missing = K.models.some((m) => !fs.existsSync(path.join(dir, m.file))) || !fs.existsSync(path.join(tex, 'colormap.png'));
  if (missing || force) {
    if (K.zip) {
      process.stdout.write(`${K.kit}: ${K.zip} … `);
      const res = await fetch(K.zip);
      if (!res.ok) { console.log(`failed (${res.status})`); continue; }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanplan-models-')), zip = path.join(tmp, 'kit.zip');
      fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
      const want = [...K.models.map((m) => `${K.inZip}/${m.file}`), `${K.inZip}/Textures/colormap.png`, 'License.txt'];
      const un = spawnSync(tar, ['-xf', zip, '-C', tmp, ...want], { stdio: 'ignore' });
      if (un.status !== 0) { console.log('could not unpack'); continue; }
      for (const m of K.models) { const f = path.join(tmp, K.inZip, m.file); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dir, m.file)); }
      fs.copyFileSync(path.join(tmp, K.inZip, 'Textures', 'colormap.png'), path.join(tex, 'colormap.png'));
      if (fs.existsSync(path.join(tmp, 'License.txt'))) fs.copyFileSync(path.join(tmp, 'License.txt'), path.join(dir, 'License.txt'));
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log('ok');
    } else {
      for (const f of [...K.models.map((m) => m.file), 'Textures/colormap.png']) {
        const res = await fetch(`${K.raw}/${f}`);
        if (!res.ok) { console.log(`${K.kit}/${f}: failed (${res.status})`); continue; }
        const b = Buffer.from(await res.arrayBuffer());
        if (f.endsWith('.glb') && !isGlb(b)) { console.log(`${K.kit}/${f}: not a GLB`); continue; }
        fs.writeFileSync(path.join(dir, f), b);
      }
      console.log(`${K.kit}: ok`);
    }
  }
  for (const m of K.models) if (fs.existsSync(path.join(dir, m.file))) manifest[m.key] = { file: `${K.kit}/${m.file}`, ...(m.length ? { length: m.length } : {}), ...(m.height ? { height: m.height } : {}), source: K.source, licence: 'CC0 1.0 (Kenney)' };
}
// (files from the old flat layout)
for (const f of fs.readdirSync(out)) if (f.endsWith('.glb')) fs.rmSync(path.join(out, f));
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(out, 'LICENSES.md'), ['# Entourage models', '', 'By Kenney (kenney.nl), CC0 1.0: free to use, change and redistribute.', '',
  ...KITS.map((K) => `- ${K.kit}: ${K.models.map((m) => m.key).join(', ')} (${K.source})`), ''].join('\n'));
console.log(`${Object.keys(manifest).length} models in ${out}`);
