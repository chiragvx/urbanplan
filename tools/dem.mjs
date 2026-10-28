// Copernicus GLO-30 (a surface model: includes buildings/trees) → smooth ground heightfield for a tile.
// Urban DSM → approximate terrain: min-filter (removes buildings) then Gaussian blur.
import { fromFile } from 'geotiff';

export async function loadTerrain(tifPath, tile, half, cell = 10) {
  const tif = await fromFile(tifPath);
  const img = await tif.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const kx = 111320 * Math.cos((tile.lat * Math.PI) / 180), kz = 110540;
  const margin = 300; // metres, so filters have context at the edges
  const H = half + margin;
  const px0 = Math.floor((tile.lon - H / kx - ox) / rx) - 2, px1 = Math.ceil((tile.lon + H / kx - ox) / rx) + 2;
  const py0 = Math.floor((tile.lat + H / kz - oy) / ry) - 2, py1 = Math.ceil((tile.lat - H / kz - oy) / ry) + 2;
  const [raw] = await img.readRasters({ window: [px0, py0, px1, py1] });
  const W = px1 - px0, Hh = py1 - py0;

  // 1) min filter (radius 2 px ≈ 60 m) strips building/tree tops from the DSM
  const minF = new Float32Array(W * Hh);
  const R = 2;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let m = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(Hh - 1, Math.max(0, y + dy));
      m = Math.min(m, raw[yy * W + xx]);
    }
    minF[y * W + x] = m;
  }
  // 2) separable Gaussian blur (sigma ≈ 2 px ≈ 60 m)
  const blur = (src, sigma) => {
    const r = Math.ceil(sigma * 3), k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(W * Hh), out = new Float32Array(W * Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += src[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * W + x] = a;
    }
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += tmp[Math.min(Hh - 1, Math.max(0, y + i)) * W + x] * k[i + r];
      out[y * W + x] = a;
    }
    return out;
  };
  const ground = blur(minF, 2);

  // 3) resample to the local metre grid (bilinear)
  const n = Math.round((half * 2) / cell) + 1;
  const h = new Float32Array(n * n);
  let min = Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -half + i * cell, z = -half + j * cell;
    const lon = tile.lon + x / kx, lat = tile.lat - z / kz;
    const fx = (lon - ox) / rx - px0 - 0.5, fy = (lat - oy) / ry - py0 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = (xx, yy) => ground[Math.min(Hh - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
    const v = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
    h[j * n + i] = v;
    if (v < min) min = v;
  }
  return { n, cell, half, heights: h, base: min };
}

if (process.argv[1]?.endsWith('dem.mjs')) {
  const { TILES, tileBBox } = await import('./tile-config.mjs');
  const tile = TILES[process.argv[2] ?? 'kp'];
  const t = await loadTerrain('data/raw/dem/cop30_N18_E073.tif', tile, tileBBox(tile).half);
  const v = Array.from(t.heights).sort((a, b) => a - b);
  console.log(`grid ${t.n}x${t.n} @ ${t.cell} m · min ${v[0].toFixed(1)} · p50 ${v[v.length >> 1].toFixed(1)} · max ${v[v.length - 1].toFixed(1)} m`);
}
