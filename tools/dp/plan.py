"""City plan layer: merge the per-sheet traces (trace.py) into one coverage for the city, and export it per tile.

Overlaps between neighbouring sheets: a plot is kept from the sheet whose frame it sits deepest inside.
Then vector.py rebuilds the zone geometry from the sheets' linework (straight shared edges, cut to the real roads);
reserved sites stay as traced. --no-vector keeps the traced outlines.
Outputs
  data/raw/cities/<city>/plan.trace.json  the merged traces (before vector.py)
  data/raw/cities/<city>/plan.json        all plots in the city frame (metres) + provenance
  data/raw/cities/<city>/plan.geojson     the same in WGS84 (for QGIS / sharing)
  public/tiles/<tile>/dp/regions.json     each tile's plots in its own frame (what the editor's DP regions read)

Usage: DP_CITY=pune python tools/dp/plan.py [--tiles kp,baner]
"""
import json, sys, os, glob, math, hashlib, argparse
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import align
import regions as RG
import shapely
from shapely.geometry import shape, mapping, Polygon

ROOT = align.ROOT
CITY = align.CITY
city = json.load(open(os.path.join(ROOT, 'cities', CITY, 'city.json'), encoding='utf-8'))
LAT0, LON0 = city['frame']['lat'], city['frame']['lon']
KX, KZ = 111320 * math.cos(math.radians(LAT0)), 110540.0


def detail(sheet):
    """Map detail of a sheet series (bigger = more detailed)."""
    return 5 if sheet.startswith('S1') else 1


def edge_depth(frame, x, z):
    """Distance from a point to the frame's edge (negative outside)."""
    P = Polygon(frame)
    d = P.exterior.distance(shapely.Point(x, z))
    return d if P.contains(shapely.Point(x, z)) else -d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', default='kp')
    ap.add_argument('--no-vector', action='store_true')
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--reuse', action='store_true', help='reuse plan.vector.json instead of re-running vector.py')
    a = ap.parse_args()
    traces = [json.load(open(p, encoding='utf-8')) for p in sorted(glob.glob(os.path.join(align.DP, 'trace', '*.json')))]
    frames = {t['sheet']: t['frame'] for t in traces}
    plots = []
    for t in traces:
        for f in t['features']:
            g = shape(f['geom'])
            c = g.representative_point()
            # the more detailed sheet wins inside its frame (Sector I is 1:2,000, the rest 1:10,000); then the one
            # whose frame the plot sits deepest in
            mine = edge_depth(t['frame'], c.x, c.y)
            fine = detail(t['sheet'])
            if any(edge_depth(fr, c.x, c.y) > 0 and detail(s) > fine for s, fr in frames.items() if s != t['sheet']): continue
            if any(edge_depth(fr, c.x, c.y) > mine + 1 and detail(s) == fine for s, fr in frames.items() if s != t['sheet']): continue
            key = f"{t['sheet']}:{f['cls']}:{round(c.x)}:{round(c.y)}:{f['area']}"
            plots.append({**f, 'id': 'dp-' + hashlib.sha1(key.encode()).hexdigest()[:10], 'geom': g})
    water_rule(plots)
    base = os.path.join(ROOT, 'data', 'raw', 'cities', CITY)
    markers = [m for t in traces for m in t.get('markers', [])]
    dump = lambda plots, name: json.dump({'city': CITY, 'frame': city['frame'], 'sheets': list(frames), 'markers': markers,
                                          'plots': [{**{k: v for k, v in p.items() if k != 'geom'}, 'geom': mapping(p['geom'])} for p in plots]},
                                         open(os.path.join(base, name), 'w', encoding='utf-8'), separators=(',', ':'))
    if not a.no_vector:
        dump(plots, 'plan.trace.json')
        import vector
        cache = os.path.join(base, 'plan.vector.json')
        if a.reuse and os.path.exists(cache):
            plots = [{**p, 'geom': shape(p['geom'])} for p in json.load(open(cache, encoding='utf-8'))['plots']]
        else:
            plots = vector.run(plots, frames, workers=a.workers)
            dump(plots, 'plan.vector.json')        # saved before anything else can fail
        water_rule(plots)
        for p in plots:
            if 'id' not in p:
                c = p['geom'].representative_point()
                p['id'] = 'dp-' + hashlib.sha1(f"v:{p['cls']}:{round(c.x)}:{round(c.y)}:{p['area']}".encode()).hexdigest()[:10]
    export(plots, frames, markers, a.tiles, dump)


def water_rule(plots):
    # pale blue is the river or C-1 commercial: OSM water decides
    water = shapely.union_all([Polygon(np.array(poly[0]).reshape(-1, 2), [np.array(h).reshape(-1, 2) for h in poly[1:] if len(h) >= 6]).buffer(0)
                               for poly in align.ref['water'] if poly and len(poly[0]) >= 6])
    # (OSM misses most nalas, so shape decides too: C-1 is a block or two — compact and small; rivers and nalas are long)
    for p in plots:
        if p['cls'] in ('water', 'local_commercial'):
            g = p['geom']
            inter = g.intersection(water).area if g.intersects(water) else 0.0
            compact = 4 * math.pi * g.area / max(1.0, g.length) ** 2
            p['cls'] = 'water' if inter > 0.3 * g.area or compact < 0.3 or g.area > 30000 else 'local_commercial'
            if p['cls'] == 'water': p['reserved'] = False


def export(plots, frames, markers, tiles, dump):
    by = {}
    for p in plots: by[p['cls']] = by.get(p['cls'], 0) + 1
    print(f'{len(plots)} plots from {len(frames)} sheets ({sum(p["reserved"] for p in plots)} reserved) · ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items(), key=lambda kv: -kv[1])))
    print(f'{len(plots)} plots ({sum(p["reserved"] for p in plots)} reserved)')
    base = os.path.join(ROOT, 'data', 'raw', 'cities', CITY)
    dump(plots, 'plan.json')
    to_ll = lambda P: np.column_stack([LON0 + P[:, 0] / KX, LAT0 - P[:, 1] / KZ])
    fc = {'type': 'FeatureCollection', 'features': [
        {'type': 'Feature', 'id': p['id'], 'geometry': mapping(shapely.set_precision(shapely.transform(p['geom'], to_ll), 1e-7)),
         'properties': {k: p[k] for k in ('cls', 'reserved', 'area', 'conf', 'sheet')}} for p in plots]}
    json.dump(fc, open(os.path.join(base, 'plan.geojson'), 'w', encoding='utf-8'), separators=(',', ':'))
    # ---- per tile, in the tile's frame (an exact per-axis scale + offset of the city frame)
    for tid in [s for s in tiles.split(',') if s]:
        hdr = json.load(open(os.path.join(ROOT, 'public', 'tiles', tid, 'tile.json'), encoding='utf-8'))
        latt, lont = hdr['center']; kxt, kzt = hdr['proj']['kx'], hdr['proj']['kz']; half = hdr['half']
        sx, ox = kxt / KX, (LON0 - lont) * kxt
        sz, oz = kzt / KZ, (latt - LAT0) * kzt
        to_tile = lambda P: np.column_stack([P[:, 0] * sx + ox, P[:, 1] * sz + oz])
        box = shapely.box(-half, -half, half, half)
        regs = []
        for p in plots:
            g = shapely.transform(p['geom'], to_tile)
            if not g.intersects(box): continue
            for part in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
                if part.area < 40: continue
                ring = [round(v, 1) for xy in list(part.exterior.coords)[:-1] for v in xy]
                holes = [[round(v, 1) for xy in list(h.coords)[:-1] for v in xy] for h in part.interiors if Polygon(h).area >= 40]
                regs.append({'id': p['id'] if part is g or len(getattr(g, 'geoms', [])) <= 1 else p['id'] + '-' + str(len(regs)), 'cls': p['cls'], 'area': round(part.area), 'ring': ring,
                             **({'holes': holes} if holes else {}), 'reserved': p['reserved'], 'conf': p['conf'], 'sheet': p['sheet']})
        mk = []
        for m in markers:
            q = to_tile(np.array([[m[0], m[1]]]))[0]
            if abs(q[0]) <= half and abs(q[1]) <= half: mk.append((float(q[0]), float(q[1])))
        # each code marker → the smallest reserved plot it sits on
        for x, z in mk:
            pt = shapely.Point(x, z)
            hit = [r for r in regs if r['reserved'] and Polygon(np.array(r['ring']).reshape(-1, 2)).buffer(15).contains(pt)]
            if hit:
                r = min(hit, key=lambda r: r['area'])
                r.setdefault('marker', [round(x, 1), round(z, 1)])
        out = {'res': 1.0, 'sheets': list(frames), 'source': 'Pune Municipal Corporation — Development Plan (sanctioned), scanned sheets',
               'note': 'Traced from the scanned DP sheets (line-based, registered to the city to about 2-3 m). Survey aid, not legal boundaries.',
               'classes': {k: {'label': RG.CLASSES[k][0], 'color': '#%02x%02x%02x' % RG.CLASSES[k][1]} for k in RG.KEYS}, 'regions': regs}
        dst = os.path.join(ROOT, 'public', 'tiles', tid, 'dp', 'regions.json')
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        json.dump(out, open(dst, 'w', encoding='utf-8'), separators=(',', ':'))
        print(f'  {tid}: {len(regs)} regions ({sum(r["reserved"] for r in regs)} reserved, {sum("marker" in r for r in regs)} with a code marker) -> {dst} ({os.path.getsize(dst) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
