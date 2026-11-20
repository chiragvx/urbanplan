---
name: bhunaksha-cadastre
description: MahaBhunakasha (Maharashtra land-records map) serves real plot polygons per village via REST; user approved scanning it; plan to harvest Pune plots before returning to DP vectorization
metadata:
  node_type: memory
  type: project
  modified: 2026-11-20T03:40:37.694Z
---

User (2026-11-12) wants MahaBhunakasha cadastral vectors used throughout, then back to DP maps ([[dp-vector-rollout]]). User says the site terms don't forbid use and the data is current.

API (POST, form-encoded, Referer https://mahabhunakasha.mahabhumi.gov.in/27/index.html, cookie jar):
- rest/VillageMapService/ListsAfterLevelGeoref state=27&level=N&codes=U,25,16,&hasmap=true → villages
- rest/VillageMapService/kidelistFromGisCodeMH state=27&logedLevels=<giscode> → all plot numbers
- rest/MapInfo/getPlotInfo state=27&giscode=&plotno=&srs=4326 → the_geom WKT MULTIPOLYGON in EPSG:32643 (UTM 43N), area, plotid; ALSO owner names/khata in `info` — never store those
- giscode = Category+MapType+district+taluka+village: urban UCM2516000000000000000004 (Mundhawa), rural RVM2507272500070312310000 (Hadapsar)
Pune: urban (city survey) 32 villages / 51,745 plots (CTSO 1 Pune 15, CTSO 2 Pune 16, PCMC 19, Haweli 07 Vadgaon Sheri); rural Haweli 158 villages / 65,835 survey plots. Old-city peths absent. ~2.4 s per getPlotInfo.
Scratch probes were in the session scratchpad (villages.json); not in repo.

Research 2026-11-20: there is no bulk vector source (no WFS, GeoServer or vector tiles). There is also no lon/lat point lookup: getPlotInfo with x/y returns 204. The options:
- **One plot at a time (the only reliable route):** getPlotInfo takes about 0.2 s. At 1 request per second, Pune urban (51.7k plots) is about 14.5 h and Haweli rural (65.8k) about 18.5 h.
- **`/WMS?LAYERS=VILLAGE_MAP` raster tiles:** these return PNG images, so the outlines would have to be traced. Too fragile to rely on.
- **Village bbox:** rest/MapInfo/getVVVVExtentGeoref returns it.

Fields to drop: info, ownerplots, infoLinks.

**How to apply:** the harvest is cleared by the user (2026-11-20); don't raise the source's terms again. Keep it polite (≈1 req/s), keep geometry-only fields, show the source in the product, and never offer the raw plot data as a download or for sale.

Harvester (825b548): `npm run cadastre -- --village <giscode> | --taluka U,25,16,` runs tools/cadastre/harvest.mjs. Output goes to data/raw/cadastre (gitignored): <giscode>.ndjson to resume from, .geojson in WGS84, and index.json. The village list gives only an 18-digit code; giscode = cat + CM/VM + district + taluka + code.
Mundhawa test (2026-11-20): 1508/1508 outlines in 26 min, and every drawn area matched the stated one.
- 515 plot numbers carry a garbled suffix ("1101 iS-"). The raw plotno is kept, plus `num` for its leading digits.
- 184 plots have holes where small structure plots sit, and 820 plots are under 50 m².
- Next step, not yet done: merge the villages into PMTiles for the map.
