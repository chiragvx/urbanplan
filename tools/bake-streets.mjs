// Runs osm2streets once at bake time and ships compact binary street geometry.
// Usage: node tools/bake-streets.mjs [tileId]
import fs from 'node:fs';
import path from 'node:path';
import { initSync, JsStreetNetwork } from '../node_modules/osm2streets-js/osm2streets_js.js';
import { extractNetwork, packStreets, clipPolygonGeojson, O2S_OPTIONS } from '../src/geo/streetsCore.ts';

const id = process.argv[2] ?? 'kp';
const dir = path.join('public', 'tiles', id);
const hdr = JSON.parse(fs.readFileSync(path.join(dir, 'tile.json'), 'utf8'));
const osm = fs.readFileSync(path.join(dir, 'roads.osm'), 'utf8');
initSync(fs.readFileSync('node_modules/osm2streets-js/osm2streets_js_bg.wasm'));
const quiet = [console.log, console.warn, console.error];
console.log = console.warn = console.error = () => {}; // osm2streets is chatty
const t0 = Date.now();
let net;
try { net = new JsStreetNetwork(osm, clipPolygonGeojson(hdr.bbox), O2S_OPTIONS); } catch { net = new JsStreetNetwork(osm, '', O2S_OPTIONS); }
const raw = extractNetwork(net, hdr.center, hdr.proj);
[console.log, console.warn, console.error] = quiet;
const { json, bin } = packStreets(raw);
fs.writeFileSync(path.join(dir, 'streets.json'), json);
fs.writeFileSync(path.join(dir, 'streets.bin'), bin);
console.log(`streets ${id}: ${raw.roads.length} roads, ${raw.intersections.length} junctions, ${raw.lanes.length} lanes, ${raw.markings.length} markings, ${raw.corners.length} kerb corners in ${Date.now() - t0} ms → json ${(json.length / 1e6).toFixed(2)} MB, bin ${(bin.length / 1e6).toFixed(2)} MB`);
