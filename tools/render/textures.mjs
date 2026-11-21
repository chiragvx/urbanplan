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
import jpeg from 'jpeg-js';

/** a JPEG halved (box filter) until it's at most `max` px, re-encoded: 1K scans become 512 px, about a tenth the size */
function shrink(file, max = 512, quality = 82) {
  let img = jpeg.decode(fs.readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 512 });
  while (img.width > max) {
    const w = img.width >> 1, h = img.height >> 1, d = new Uint8Array(w * h * 4), s = img.data, W = img.width;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) d[(y * w + x) * 4 + c] = (s[((2 * y) * W + 2 * x) * 4 + c] + s[((2 * y) * W + 2 * x + 1) * 4 + c] + s[((2 * y + 1) * W + 2 * x) * 4 + c] + s[((2 * y + 1) * W + 2 * x + 1) * 4 + c]) >> 2;
    img = { width: w, height: h, data: d };
  }
  fs.writeFileSync(file, jpeg.encode(img, quality).data);
}

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
    // (bsdtar unpacks zips: Windows ships it in System32; GNU tar, Git Bash's, doesn't read zips)
    const sysTar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
    const un = spawnSync(fs.existsSync(sysTar) ? sysTar : 'tar', ['-xf', zip, '-C', x], { stdio: 'ignore' });
    if (un.status !== 0) { console.log('could not unpack: skipped'); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(x);
    const pick = (re) => files.find((f) => re.test(f));
    const copy = (re, name) => { const f = pick(re); if (f) fs.copyFileSync(path.join(x, f), path.join(dir, name)); return !!f; };
    copy(/_Color\.jpg$/i, 'color.jpg'); copy(/_NormalGL\.jpg$/i, 'normal.jpg');
    // (512 px is plenty at a metre or two a tile; the app uses no roughness maps)
    for (const f of ['color.jpg', 'normal.jpg']) if (fs.existsSync(path.join(dir, f))) shrink(path.join(dir, f));
    console.log('ok');
  }
  if (!fs.existsSync(path.join(dir, 'color.jpg'))) continue;
  const entry = { size: s.size, color: `${s.key}/color.jpg` };
  for (const [name, field] of [['normal', 'normal']]) {
    const jpg = path.join(dir, `${name}.jpg`);
    if (!fs.existsSync(jpg) && !fs.existsSync(path.join(dir, `${name}.ktx2`))) continue;
    const ktx = path.join(dir, `${name}.ktx2`);
    if (!fs.existsSync(ktx) || force) {
      if (hasToktx) spawnSync('toktx', ['--t2', '--encode', 'uastc', '--genmipmap', '--assign_oetf', 'linear', ktx, jpg], { shell: true, stdio: 'ignore' });
      else {
        // (no toktx: Basis Universal compiled to wasm, from npm: UASTC with mipmaps, a normal map, linear)
        const { encodeToKTX2 } = await import('ktx2-encoder');
        const decode = async (b) => { const im = jpeg.decode(b, { useTArray: true }); return { data: new Uint8Array(im.data), width: im.width, height: im.height }; };
        try { fs.writeFileSync(ktx, await encodeToKTX2(new Uint8Array(fs.readFileSync(jpg)), { isUASTC: true, generateMipmap: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, imageDecoder: decode })); }
        catch (e) { console.log(`${s.key}: KTX2 failed (${e.message}): JPEG kept`); }
      }
    }
    entry[field] = fs.existsSync(ktx) ? `${s.key}/${name}.ktx2` : `${s.key}/${name}.jpg`;
    // (the KTX2 replaces the JPEG: only one ships)
    if (fs.existsSync(ktx) && fs.existsSync(jpg)) fs.rmSync(jpg);
  }
  manifest[s.key] = { ...entry, source: `https://ambientcg.com/view?id=${s.id}`, licence: 'CC0 1.0' };
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(out, 'LICENSES.md'), ['# Scanned textures', '', 'All from ambientCG, CC0 1.0 (public domain): free to use, change and redistribute.', '',
  ...Object.entries(manifest).map(([k, v]) => `- ${k}: ${v.source}`), ''].join('\n'));
// (the KTX2 transcoder, for the loader)
const basis = path.resolve('node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'), pub = path.resolve('public', 'basis');
if (fs.existsSync(basis) && Object.values(manifest).some((e) => String(e.normal ?? '').endsWith('.ktx2'))) { fs.mkdirSync(pub, { recursive: true }); for (const f of fs.readdirSync(basis)) fs.copyFileSync(path.join(basis, f), path.join(pub, f)); }
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${Object.keys(manifest).length} sets in ${out}, normal maps as ${Object.values(manifest).filter((e) => String(e.normal).endsWith('.ktx2')).length ? 'KTX2' : 'JPEG'}`);
