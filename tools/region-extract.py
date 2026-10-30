# Cuts a region's cells out of a Geofabrik .osm.pbf extract — the same features, and the same "whole ways and
# relations touching the cell, with all their nodes" output, as the Overpass query in tools/fetch-region.mjs. Use it
# when the public Overpass servers are too busy for a city-sized download.
#   node tools/fetch-region.mjs pune --plan                 (writes data/raw/region/pune/cells.json)
#   python tools/region-extract.py <extract.osm.pbf> pune   (writes data/raw/region/pune/c_<i>_<j>.osm)
# Needs pyosmium (pip install osmium).
import json, os, sys, time
from xml.sax.saxutils import quoteattr
import osmium

pbf, region = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'pune'
out = os.path.join('data', 'raw', 'region', region)
cells = json.load(open(os.path.join(out, 'cells.json')))
S = min(c['s'] for c in cells); W = min(c['w'] for c in cells); N = max(c['n'] for c in cells); E = max(c['e'] for c in cells)
t0 = time.time()
log = lambda m: print(f'[{time.time() - t0:5.0f} s] {m}', flush=True)

RAIL = {'rail', 'light_rail', 'subway', 'narrow_gauge', 'platform'}
AMENITY = {'school', 'college', 'university', 'hospital', 'parking', 'place_of_worship'}
def way_wanted(t):
    return ('highway' in t or t.get('railway') in RAIL or 'building' in t or 'landuse' in t or 'leisure' in t or 'natural' in t
            or 'waterway' in t or 'water' in t or t.get('amenity') in AMENITY or t.get('man_made') in ('bridge', 'pier'))
def rel_wanted(t):
    return 'building' in t or 'landuse' in t or 'leisure' in t or t.get('natural') in ('water', 'wood') or 'water' in t
def node_wanted(t):
    return t.get('natural') == 'tree' or t.get('highway') in ('bus_stop', 'traffic_signals')
inside = lambda lat, lon: S <= lat <= N and W <= lon <= E

# 1. nodes in the region (coordinates; tags of the ones that matter)
nodes = {}
class Nodes(osmium.SimpleHandler):
    def node(self, n):
        if not n.location.valid(): return
        lat, lon = n.location.lat, n.location.lon
        if not inside(lat, lon): return
        tags = {t.k: t.v for t in n.tags} if len(n.tags) else None
        nodes[n.id] = (lat, lon, tags)
Nodes().apply_file(pbf)
log(f'{len(nodes):,} nodes in the region')

# 2. ways touching the region; relations with matching tags (members resolved below)
ways, rels, member_ways = {}, {}, set()
class WaysRels(osmium.SimpleHandler):
    def way(self, w):
        t = {x.k: x.v for x in w.tags}
        if not way_wanted(t): return
        nds = [n.ref for n in w.nodes]
        if any(r in nodes for r in nds): ways[w.id] = (nds, t)
    def relation(self, r):
        t = {x.k: x.v for x in r.tags}
        if t.get('type') != 'multipolygon' or not rel_wanted(t): return
        mem = [(m.type, m.ref, m.role) for m in r.members]
        rels[r.id] = (mem, t)
WaysRels().apply_file(pbf)
for rid, (mem, t) in list(rels.items()):
    ws = [ref for (ty, ref, role) in mem if ty == 'w']
    for ref in ws: member_ways.add(ref)
log(f'{len(ways):,} ways, {len(rels):,} candidate multipolygons')

# 3. member ways of the relations (untagged outer / inner rings)
class Members(osmium.SimpleHandler):
    def way(self, w):
        if w.id in member_ways and w.id not in ways: ways[w.id] = ([n.ref for n in w.nodes], {x.k: x.v for x in w.tags}, True)
Members().apply_file(pbf)
# keep relations that touch the region
rels = {rid: v for rid, v in rels.items() if any(ty == 'w' and ref in ways and any(n in nodes for n in ways[ref][0]) for (ty, ref, role) in v[0])}
# 4. nodes outside the region that kept ways need (ways crossing the edge are kept whole)
need = set()
for v in ways.values():
    for r in v[0]:
        if r not in nodes: need.add(r)
class Missing(osmium.SimpleHandler):
    def node(self, n):
        if n.id in need and n.location.valid(): nodes[n.id] = (n.location.lat, n.location.lon, None)
Missing().apply_file(pbf)
log(f'{len(rels):,} multipolygons in the region; {len(need):,} nodes outside it fetched for whole ways')

# 5. one OSM XML file per cell: ways with a node in the cell, relations with such a member, recursed down
def cell_of(lat, lon, c): return c['s'] <= lat <= c['n'] and c['w'] <= lon <= c['e']
by_cell = {c['file']: set() for c in cells}
rel_cell = {c['file']: set() for c in cells}
for wid, v in ways.items():
    if len(v) > 2: continue  # relation member only
    lats = [nodes[r][0] for r in v[0] if r in nodes]; lons = [nodes[r][1] for r in v[0] if r in nodes]
    if not lats: continue
    for c in cells:
        if max(lats) < c['s'] or min(lats) > c['n'] or max(lons) < c['w'] or min(lons) > c['e']: continue
        if any(cell_of(nodes[r][0], nodes[r][1], c) for r in v[0] if r in nodes): by_cell[c['file']].add(wid)
for rid, (mem, t) in rels.items():
    for c in cells:
        if any(ty == 'w' and ref in ways and any(r in nodes and cell_of(nodes[r][0], nodes[r][1], c) for r in ways[ref][0]) for (ty, ref, role) in mem):
            rel_cell[c['file']].add(rid)
points = [(nid, lat, lon) for nid, (lat, lon, t) in nodes.items() if t and node_wanted(t)]
q = lambda s: quoteattr(str(s))
def tags_xml(t): return ''.join(f'<tag k={q(k)} v={q(v)}/>' for k, v in t.items()) if t else ''
for c in cells:
    ws, rs = set(by_cell[c['file']]), rel_cell[c['file']]
    for rid in rs:
        for (ty, ref, role) in rels[rid][0]:
            if ty == 'w' and ref in ways: ws.add(ref)
    nd = set()
    for wid in ws: nd.update(r for r in ways[wid][0] if r in nodes)
    for nid, lat, lon in points:
        if cell_of(lat, lon, c): nd.add(nid)
    parts = ['<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="UrbanPlan region-extract">\n']
    for nid in sorted(nd):
        lat, lon, t = nodes[nid]
        tx = tags_xml(t)
        parts.append(f'  <node id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}">{tx}</node>\n' if tx else f'  <node id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}"/>\n')
    for wid in sorted(ws):
        v = ways[wid]
        parts.append(f'  <way id="{wid}">' + ''.join(f'<nd ref="{r}"/>' for r in v[0]) + tags_xml(v[1]) + '</way>\n')
    for rid in sorted(rs):
        mem, t = rels[rid]
        typ = {'n': 'node', 'w': 'way', 'r': 'relation'}
        parts.append(f'  <relation id="{rid}">' + ''.join(f'<member type="{typ[ty]}" ref="{ref}" role={q(role)}/>' for (ty, ref, role) in mem) + tags_xml(t) + '</relation>\n')
    parts.append('</osm>\n')
    with open(os.path.join(out, c['file']), 'w', encoding='utf-8') as fh: fh.write(''.join(parts))
log(f'{len(cells)} cells written to {out}')
