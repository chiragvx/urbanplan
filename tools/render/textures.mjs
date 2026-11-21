// Scanned surface textures for Pro's 3D: CC0 sets from ambientCG (https://ambientcg.com, CC0 1.0: free to use and
// redistribute), at 1K, unpacked into public/assets/render/tex/<key>/ with a manifest the app reads
// (src/pro/render/textures.ts loadScans). Normal and roughness maps go to KTX2 when `toktx` (KTX-Software) is installed;
// colour maps stay JPG because the app turns them into detail maps (their luminance about 1, so the design system's
// colour still holds) on a canvas. Without the scans the app draws its procedural textures.
//
//   npm run render:textures              download what's missing, then write the manifest and LICENSES.md
//   npm run render:textures -- --force   download again
// Downloads about 40 MB of zips into a temp folder; keeps about 12 MB.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** key: what it stands for in the app; id: the ambientCG asset; size: the metres one tile covers */
const SETS = [
  { key: 'plaster', id: 'Plaster003', size: [2, 2] },
  { key: 'concrete', id: 'Concrete034', size: [2, 2] },
  { key: 'brick', id: 'Bricks076C', size: [1.2, 1.2] },
  { key: 'stone', id: 'Rock030', size: [2, 2] },
  { key: 'asphalt', id: 'Asphalt012', size: [4, 4] },
  { key: 'grass', id: 'Grass004', size: [3, 3] },
  { key: 'ground', id: 'Ground037', size: [3, 3] },
  { key: 'pavers', id: 'PavingStones070', size: [2, 2] },
  { key: 'wood', id: 'Wood066', size: [1.5, 1.5] },
  { key: 'tile', id: 'Tiles074', size: [1.2, 1.2] },
];
const force = process.argv.includes('--force');
const out = path.resolve('public', 'assets', 'render', 'tex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'urbanplan-tex-'));
fs.mkdirSync(out, { recursive: true });
const hasToktx = spawnSync('toktx', ['--version'], { shell: true }).status === 0;
const manifest = {};

for (const s of SETS) {
  const dir = path.join(out, s.key);
  const have = fs.existsSync(path.join(dir, 'color.jpg'));
  if (!have || force) {
    const url = `https://ambientcg.com/get?file=${s.id}_1K-JPG.zip`;
    process.stdout.write(`${s.key}: ${url} … `);
    const res = await fetch(url);
    if (!res.ok) { console.log(`failed (${res.status}): skipped`); continue; }
    const zip = path.join(tmp, `${s.id}.zip`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const x = path.join(tmp, s.id);
    fs.mkdirSync(x, { recursive: true });
    // (Windows 10+ and macOS ship bsdtar as tar, which unpacks zips)
    const un = spawnSync('tar', ['-xf', zip, '-C', x], { stdio: 'ignore' });
    if (un.status !== 0) { console.log('could not unpack: skipped'); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(x);
    const pick = (re) => files.find((f) => re.test(f));
    const copy = (re, name) => { const f = pick(re); if (f) fs.copyFileSync(path.join(x, f), path.join(dir, name)); return !!f; };
    copy(/_Color\.jpg$/i, 'color.jpg'); copy(/_NormalGL\.jpg$/i, 'normal.jpg'); copy(/_Roughness\.jpg$/i, 'rough.jpg');
    console.log('ok');
  }
  if (!fs.existsSync(path.join(dir, 'color.jpg'))) continue;
  const entry = { size: s.size, color: `${s.key}/color.jpg` };
  for (const [name, field] of [['normal', 'normal'], ['rough', 'rough']]) {
    const jpg = path.join(dir, `${name}.jpg`);
    if (!fs.existsSync(jpg)) continue;
    const ktx = path.join(dir, `${name}.ktx2`);
    if (hasToktx && (!fs.existsSync(ktx) || force)) spawnSync('toktx', ['--t2', '--encode', 'uastc', '--genmipmap', '--assign_oetf', 'linear', ktx, jpg], { shell: true, stdio: 'ignore' });
    entry[field] = fs.existsSync(ktx) ? `${s.key}/${name}.ktx2` : `${s.key}/${name}.jpg`;
  }
  manifest[s.key] = { ...entry, source: `https://ambientcg.com/view?id=${s.id}`, licence: 'CC0 1.0' };
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(out, 'LICENSES.md'), ['# Scanned textures', '', 'All from ambientCG, CC0 1.0 (public domain): free to use, change and redistribute.', '',
  ...Object.entries(manifest).map(([k, v]) => `- ${k}: ${v.source}`), ''].join('\n'));
// (the KTX2 transcoder, for the loader)
const basis = path.resolve('node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'), pub = path.resolve('public', 'basis');
if (fs.existsSync(basis)) { fs.mkdirSync(pub, { recursive: true }); for (const f of fs.readdirSync(basis)) fs.copyFileSync(path.join(basis, f), path.join(pub, f)); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${Object.keys(manifest).length} sets in ${out}${hasToktx ? '' : ' (no toktx: normal and roughness maps kept as JPG)'}`);
