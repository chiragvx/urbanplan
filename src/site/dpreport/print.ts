// The downloadable DP report: two map pictures drawn on canvases (satellite with the traced zones, and the DP sheet
// itself over faded satellite), centred on the picked point, for the print sheet the browser saves as a PDF.
import { around, loadIndex, loadTiles, tileUrl, toLatLon, type Parcel } from './geo';

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TILE = 256;

const img = (src: string) => new Promise<HTMLImageElement | null>((ok) => {
  const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async';
  i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src;
});

/** Web Mercator world pixels at zoom z */
const px = (lat: number, lon: number, z: number): [number, number] => {
  const s = TILE * 2 ** z, sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
};

interface Shot { W: number; H: number; z: number; ox: number; oy: number }

async function base(ctx: CanvasRenderingContext2D, S: Shot) {
  const tx0 = Math.floor(S.ox / TILE), ty0 = Math.floor(S.oy / TILE), tx1 = Math.floor((S.ox + S.W) / TILE), ty1 = Math.floor((S.oy + S.H) / TILE);
  const jobs: Promise<void>[] = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    jobs.push(img(IMAGERY.replace('{z}', String(S.z)).replace('{x}', String(x)).replace('{y}', String(y))).then((i) => { if (i) ctx.drawImage(i, x * TILE - S.ox, y * TILE - S.oy); }));
  }
  await Promise.all(jobs);
}

function path(ctx: CanvasRenderingContext2D, S: Shot, p: Parcel) {
  ctx.beginPath();
  for (const poly of p.polys) for (const ring of poly) ring.forEach(([la, lo], i) => { const [x, y] = px(la, lo, S.z); i ? ctx.lineTo(x - S.ox, y - S.oy) : ctx.moveTo(x - S.ox, y - S.oy); });
  ctx.closePath();
}

function pin(ctx: CanvasRenderingContext2D, S: Shot, lat: number, lon: number) {
  const [x, y] = px(lat, lon, S.z), X = x - S.ox, Y = y - S.oy;
  ctx.fillStyle = '#2f5bff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(X, Y - 18, 10, Math.PI * 0.85, Math.PI * 0.15); ctx.lineTo(X, Y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X, Y - 18, 3.5, 0, Math.PI * 2); ctx.fill();
}

function scaleBar(ctx: CanvasRenderingContext2D, S: Shot, lat: number) {
  const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** S.z, m = 50, w = m / mpp;
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(12, S.H - 34, w + 52, 22);
  ctx.fillStyle = '#fff'; ctx.fillRect(18, S.H - 20, w, 3); ctx.font = '12px system-ui, sans-serif'; ctx.fillText(`${m} m`, w + 24, S.H - 17);
}

/** The two pictures as data URLs: [satellite + zones, DP sheet]. */
export async function reportPictures(lat: number, lon: number, picked: Parcel | null, W = 900, H = 620): Promise<[string, string]> {
  const I = await loadIndex(), z = 18;
  const [cx, cy] = px(lat, lon, z), S: Shot = { W, H, z, ox: Math.round(cx - W / 2), oy: Math.round(cy - H / 2) };
  const { plots } = await around(lat, lon, 320);

  const a = Object.assign(document.createElement('canvas'), { width: W, height: H }), A = a.getContext('2d')!;
  await base(A, S);
  for (const p of plots) {
    path(A, S, p);
    A.globalAlpha = 0.45; A.fillStyle = I.classes[p.cls]?.color ?? '#ccc'; A.fill('evenodd'); A.globalAlpha = 1;
    A.setLineDash(p.reserved ? [6, 4] : []); A.lineWidth = p.reserved ? 2.5 : 1; A.strokeStyle = p.reserved ? '#e5484d' : 'rgba(30,30,30,.7)'; A.stroke();
  }
  A.setLineDash([]);
  if (picked) { path(A, S, picked); A.lineWidth = 4; A.strokeStyle = '#2f5bff'; A.stroke(); }
  pin(A, S, lat, lon); scaleBar(A, S, lat);

  const b = Object.assign(document.createElement('canvas'), { width: W, height: H }), B = b.getContext('2d')!;
  await base(B, S);
  B.fillStyle = 'rgba(255,255,255,.55)'; B.fillRect(0, 0, W, H);
  const T = await loadTiles(), F = I.frame;
  const jobs = T.tiles.map(async (t) => {
    const [n, w] = toLatLon(F, t.x0, t.z0), [s, e] = toLatLon(F, t.x0 + t.size, t.z0 + t.size);
    const [x0, y0] = px(n, w, z), [x1, y1] = px(s, e, z);
    if (x1 < S.ox || y1 < S.oy || x0 > S.ox + W || y0 > S.oy + H) return;
    const i = await img(await tileUrl(t));
    if (i) B.drawImage(i, x0 - S.ox, y0 - S.oy, x1 - x0, y1 - y0);
  });
  await Promise.all(jobs);
  if (picked) { path(B, S, picked); B.lineWidth = 3; B.strokeStyle = '#2f5bff'; B.stroke(); }
  pin(B, S, lat, lon); scaleBar(B, S, lat);

  return [a.toDataURL('image/jpeg', 0.86), b.toDataURL('image/jpeg', 0.86)];
}
