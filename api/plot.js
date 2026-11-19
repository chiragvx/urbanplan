// A plot's outline by its survey or CTS number, from MahaBhunakasha (Maharashtra's land records map), for Pro's
// "find a plot". The browser can't ask MahaBhunakasha itself (it wants a session cookie and its own page as the
// referrer), so this Vercel function asks for it and passes back ONLY what a plan needs: the outline (UTM zone 43N
// metres), its map area and where it is. Owner names, khata numbers and links in the reply are dropped here and
// never leave this function; nothing is stored.
//
//   GET /api/plot?op=list&level=1&codes=U,        districts (level 1), talukas (2: codes=U,25,), villages (3: codes=U,25,16,)
//   GET /api/plot?op=plots&g=<giscode>            the plot numbers in a village
//   GET /api/plot?op=plot&g=<giscode>&n=<plot>    one plot's outline
// giscode = category (U urban CTS / R rural survey) + map type (CM / VM) + district + taluka + village code.

const BASE = 'https://mahabhunakasha.mahabhumi.gov.in';
const PAGE = `${BASE}/27/index.html`;
let cookie = '', cookieAt = 0;

async function session() {
  if (cookie && Date.now() - cookieAt < 10 * 60_000) return cookie;
  const r = await fetch(PAGE, { redirect: 'manual' });
  const set = r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? ''];
  cookie = set.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  cookieAt = Date.now();
  return cookie;
}

async function post(path, form) {
  const body = new URLSearchParams({ state: '27', ...form }).toString();
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${BASE}/rest/${path}`, {
      method: 'POST', body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: PAGE, cookie: await session() },
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch { cookie = ''; /* a stale session: once more with a new one */ }
  }
  throw new Error('MahaBhunakasha did not answer');
}

/** WKT MULTIPOLYGON / POLYGON: the biggest outer ring, as [x, y, …] */
function outer(wkt) {
  const rings = [...String(wkt).matchAll(/\(\(([^()]+)\)/g)].map((m) => m[1].split(',').map((p) => p.trim().split(/\s+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)));
  const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } return Math.abs(a / 2); };
  const best = rings.sort((a, b) => area(b) - area(a))[0] ?? [];
  return best.flat();
}

export default async function handler(req, res) {
  const q = req.query ?? Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  try {
    if (q.op === 'list') {
      const level = String(q.level ?? '1'), codes = String(q.codes ?? 'U,');
      if (!/^[1-3]$/.test(level) || !/^[UR],[0-9,]*$/.test(codes)) return res.status(400).json({ error: 'bad level or codes' });
      const x = await post('VillageMapService/ListsAfterLevelGeoref', { level, codes, hasmap: 'true' });
      return res.status(200).json((x?.[0] ?? []).map((o) => ({ code: o.code, name: o.value })));
    }
    const g = String(q.g ?? '');
    if (!/^[UR](CM|VM)[0-9]{22}$/.test(g)) return res.status(400).json({ error: 'bad giscode' });
    if (q.op === 'plots') {
      const x = await post('VillageMapService/kidelistFromGisCodeMH', { logedLevels: g });
      return res.status(200).json(Array.isArray(x) ? x : []);
    }
    if (q.op === 'plot') {
      const n = String(q.n ?? '').trim();
      if (!n || n.length > 40 || n.includes('..') || !/^\w[\w/.\-]*$/.test(n)) return res.status(400).json({ error: 'bad plot number' });
      const x = await post('MapInfo/getPlotInfo', { giscode: g, plotno: n, srs: '4326' });
      const ring = outer(x?.the_geom);
      if (ring.length < 6) return res.status(404).json({ error: `No outline for plot ${n} in this village` });
      // (only the outline, its area and the place: never x.info, x.ownerplots or x.infoLinks)
      return res.status(200).json({
        plotno: String(x.plotno ?? n), giscode: g, ring, crs: 'EPSG:32643',
        area: Number(x.map_area) || null, place: String(x.gisinfo ?? '').replace(/\s+/g, ' ').trim(),
        source: 'MahaBhunakasha (mahabhunakasha.mahabhumi.gov.in)',
      });
    }
    return res.status(400).json({ error: 'op is list, plots or plot' });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message ?? e) });
  }
}

