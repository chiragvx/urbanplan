/// <reference lib="webworker" />
// Runs osm2streets (Rust → WASM) off the main thread — used for re-generating streets after edits.
import init, { JsStreetNetwork } from 'osm2streets-js';
import wasmUrl from 'osm2streets-js/osm2streets_js_bg.wasm?url';
import type { StreetsRequest } from './streets';
import { extractNetwork, clipPolygonGeojson, O2S_OPTIONS } from './streetsCore';

self.onmessage = async (e: MessageEvent<StreetsRequest>) => {
  try {
    const req = e.data;
    await init(wasmUrl);
    const t0 = performance.now();
    let net: JsStreetNetwork;
    try { net = new JsStreetNetwork(req.osm, clipPolygonGeojson(req.bbox), O2S_OPTIONS); }
    catch { net = new JsStreetNetwork(req.osm, '', O2S_OPTIONS); }
    if (req.overrides) for (const [id, tags] of Object.entries(req.overrides)) net.overwriteOsmTagsForWay(BigInt(id), JSON.stringify(tags));
    const buildMs = performance.now() - t0;
    const raw = extractNetwork(net, req.center, req.proj);
    net.free();
    (self as unknown as Worker).postMessage({ ...raw, buildMs });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String((err as Error)?.message ?? err) });
  }
};
