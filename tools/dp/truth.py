"""A truth set for the traced DP: points labelled by eye from the sheets, and a score of plan.json against them.

  sample   pick points (uniform over the sheets' frames, plus a few per colour family so rare classes show up)
           → tools/dp/truth/<city>.json  (labels empty)
  sheets   contact sheets for labelling: a crop of the sheet round each point, numbered, with the legend
           → data/raw/cities/<city>/dp/truth/*.png
  label    set labels:  truth.py label 12=residential 13=road …   (road = white / unzoned land between plots)
  eval     score data/raw/cities/<city>/plan.json: overall accuracy (uniform points), per-class recall / precision,
           the confusions that matter. --trace scores the per-sheet traces instead (the sheet each point was cut from)
  edges    boundary quality of the traces, no labels needed: how far traced edges sit from lines drawn on the sheet
           (median metres, share within 1 m / beyond 3 m) and slivers (< 100 m²). --dir trace.v0 scores a backup
  show     sheet crop | plan over it, round truth points (ids) or x,z,sheet; --trace draws that sheet's trace

Labels are by eye from the contact sheets ('?' where a point sits on a line or can't be told); the score ignores them.

Each point is cut from the sheet plan.py would take it from (Sector I wins where it covers; else the frame the point
sits deepest in), so the truth and the plan read the same paper.

Usage: DP_CITY=pune python tools/dp/truth.py sample|sheets|label|eval
"""
import json, sys, os, glob, argparse
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
import regions as RG
from measure import load_reg, correction
import shapely
from shapely.geometry import shape, Polygon, Point

CITY = align.CITY
TRUTH = os.path.join(os.path.dirname(__file__), 'truth', f'{CITY}.json')
SHEETS_OUT = os.path.join(align.DP, 'truth')
LABELS = RG.KEYS + ['road']
FRAME = 0.755


def frames():
    """sheet → frame polygon in the city (from the traces)."""
    out = {}
    for p in sorted(glob.glob(os.path.join(align.DP, 'trace', '*.json'))):
        t = json.load(open(p, encoding='utf-8'))
        out[t['sheet']] = Polygon(t['frame'])
    return out


def pick_sheet(fr, x, z):
    """The sheet plan.py would read a point from: Sector I first, then the deepest frame."""
    pt = Point(x, z)
    inside = [(s, P.exterior.distance(pt)) for s, P in fr.items() if P.contains(pt)]
    if not inside: return None
    s1 = [c for c in inside if c[0].startswith('S1')]
    return max(s1 or inside, key=lambda c: c[1])[0]


class Sheet:
    """A registered sheet: city metres ↔ sheet pixels at a dpi."""
    def __init__(self, name, dpi):
        self.name, self.dpi = name, dpi
        Ainv, self.cps, reg = load_reg(name)
        self.A = np.linalg.inv(Ainv)[:2]
        self.Ai = np.linalg.inv(np.vstack([self.A, [0, 0, 1]]))[:2]
        self.k = 300 / dpi
        self._img = None

    @property
    def img(self):
        if self._img is None: self._img = align.sheet_image(align.sheet_pdf(self.name), self.dpi)
        return self._img

    def to_city(self, P):
        M = (np.asarray(P, float) * self.k) @ self.A[:, :2].T + self.A[:, 2]
        return M + correction(self.cps, M)

    def to_px(self, M):
        """Inverse of to_city (the correction field is smooth: a few fixed-point steps)."""
        M = np.atleast_2d(np.asarray(M, float))
        Q = M.copy()
        for _ in range(4):
            Q = M - correction(self.cps, Q)                 # metres before the correction
        return (Q @ self.Ai[:, :2].T + self.Ai[:, 2]) / self.k


def dpi_of(name): return 150 if name.startswith('S1') else 200


def sample(a):
    fr = frames()
    rng = np.random.default_rng(7)
    # the planned area: the traced plots with the roads between them closed up (closing by 40 m), inside the frames
    plan = json.load(open(os.path.join(align.ROOT, 'data', 'raw', 'cities', CITY, 'plan.json'), encoding='utf-8'))
    allp = shapely.union_all([shape(p['geom']).buffer(40, quad_segs=2) for p in plan['plots'] if p['area'] > 400]).buffer(-40, quad_segs=2)
    allp = allp.intersection(shapely.union_all(list(fr.values())))
    shapely.prepare(allp)
    x0, z0, x1, z1 = allp.bounds
    pts = []
    # uniform over the area the sheets cover (map frames only: the legend side is cut off at FRAME)
    while len(pts) < a.uniform:
        x, z = rng.uniform(x0, x1), rng.uniform(z0, z1)
        s = pick_sheet(fr, x, z) if shapely.contains_xy(allp, x, z) else None
        if s: pts.append({'x': round(x, 1), 'z': round(z, 1), 'sheet': s, 'kind': 'uniform'})
    # per colour family: points whose sheet pixel is nearest a legend colour (seeds, generous) — only to find
    # places worth labelling; the label itself is still read by eye
    seeds = RG.to_lab(np.array([RG.CLASSES[k][1] for k in RG.KEYS], np.uint8))
    want = {k: a.per_class for k in RG.KEYS}
    order = list(fr)
    rng.shuffle(order)
    for name in order:
        sh = Sheet(name, 50)
        img = sh.img[:, :int(sh.img.shape[1] * FRAME)]
        lab = RG.to_lab(img.reshape(-1, 3)).reshape(img.shape)
        d = np.sqrt(((lab[:, :, None, :] - seeds[None, None]) ** 2).sum(3))
        near, dk = d.argmin(2), d.min(2)
        for i, k in enumerate(RG.KEYS):
            if want[k] <= 0: continue
            ys, xs = np.nonzero((near == i) & (dk < 12))
            if len(ys) < 50: continue
            take = rng.choice(len(ys), min(len(ys), want[k], 3), replace=False)   # ≤ 3 per sheet: spread them
            for j in take:
                M = sh.to_city([[xs[j] + 0.5, ys[j] + 0.5]])[0]
                if pick_sheet(fr, *M) != name: continue
                pts.append({'x': round(float(M[0]), 1), 'z': round(float(M[1]), 1), 'sheet': name, 'kind': 'class:' + k})
                want[k] -= 1
    for i, p in enumerate(pts): p['id'] = i; p['label'] = ''
    os.makedirs(os.path.dirname(TRUTH), exist_ok=True)
    save(pts)
    print(f'{len(pts)} points ({a.uniform} uniform) → {TRUTH}')


def save(pts):
    with open(TRUTH, 'w', encoding='utf-8') as f:
        f.write('[\n' + ',\n'.join(json.dumps(p, separators=(',', ':')) for p in pts) + '\n]\n')


def load(): return json.load(open(TRUTH, encoding='utf-8'))


def contact(a):
    pts = load()
    if a.only == 'unlabelled': pts = [p for p in pts if not p['label']]
    os.makedirs(SHEETS_OUT, exist_ok=True)
    for f in glob.glob(os.path.join(SHEETS_OUT, '*.png')): os.remove(f)
    C, N = a.size, a.cols * a.rows
    by = {}
    for p in pts: by.setdefault(p['sheet'], []).append(p)
    tiles = []
    for name, ps in sorted(by.items()):
        sh = Sheet(name, dpi_of(name))
        img = sh.img
        pad = np.pad(img, ((C, C), (C, C), (0, 0)), constant_values=255)
        for p in ps:
            u, v = sh.to_px([[p['x'], p['z']]])[0]
            u, v = int(round(u)) + C, int(round(v)) + C
            t = pad[v - C // 2:v + C // 2, u - C // 2:u + C // 2].copy()
            c = C // 2
            for r, col in ((7, (0, 0, 0)), (8, (255, 255, 255))):
                cv2.circle(t, (c, c), r, col, 1, cv2.LINE_AA)
            cv2.line(t, (c - 16, c), (c - 9, c), (0, 0, 0), 2); cv2.line(t, (c + 9, c), (c + 16, c), (0, 0, 0), 2)
            cv2.line(t, (c, c - 16), (c, c - 9), (0, 0, 0), 2); cv2.line(t, (c, c + 9), (c, c + 16), (0, 0, 0), 2)
            cv2.rectangle(t, (0, 0), (C - 1, 22), (0, 0, 0), -1)
            cv2.putText(t, f"#{p['id']} {name}", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            tiles.append((p['id'], t))
        sh._img = None
    tiles.sort(key=lambda t: t[0])
    # a legend strip under each page
    sw = np.full((60, a.cols * C, 3), 255, np.uint8)
    w = a.cols * C // 8
    for i, k in enumerate(RG.KEYS):
        x, y = (i % 8) * w, (i // 8) * 30
        cv2.rectangle(sw, (x + 2, y + 4), (x + 24, y + 26), tuple(int(c) for c in RG.CLASSES[k][1]), -1)
        cv2.rectangle(sw, (x + 2, y + 4), (x + 24, y + 26), (0, 0, 0), 1)
        cv2.putText(sw, k, (x + 28, y + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, cv2.LINE_AA)
    for pg in range(0, len(tiles), N):
        grid = np.full((a.rows * C, a.cols * C, 3), 255, np.uint8)
        for i, (_, t) in enumerate(tiles[pg:pg + N]):
            r, c = divmod(i, a.cols)
            grid[r * C:(r + 1) * C, c * C:(c + 1) * C] = t
            cv2.rectangle(grid, (c * C, r * C), ((c + 1) * C - 1, (r + 1) * C - 1), (90, 90, 90), 1)
        out = np.vstack([grid, sw])
        cv2.imwrite(os.path.join(SHEETS_OUT, f'{pg // N:02d}.png'), cv2.cvtColor(out, cv2.COLOR_RGB2BGR))
    print(f'{len(tiles)} crops on {(len(tiles) + N - 1) // N} pages → {SHEETS_OUT}')


def label(a):
    pts = load()
    byid = {p['id']: p for p in pts}
    for kv in a.pairs:
        i, k = kv.split('=')
        if k not in LABELS and k != '?': sys.exit(f'unknown label {k} (one of {", ".join(LABELS)}, or ?)')
        byid[int(i)]['label'] = k
    save(pts)
    print(f'{sum(1 for p in pts if p["label"])} of {len(pts)} labelled')


def predict_plan(pts, path=None):
    plan = json.load(open(path or os.path.join(align.ROOT, 'data', 'raw', 'cities', CITY, 'plan.json'), encoding='utf-8'))
    geoms = [shape(p['geom']) for p in plan['plots']]
    tree = shapely.STRtree(geoms)
    out = []
    for p in pts:
        pt = Point(p['x'], p['z'])
        hit = [i for i in tree.query(pt) if geoms[i].contains(pt)]
        out.append(plan['plots'][min(hit, key=lambda i: geoms[i].area)]['cls'] if hit else 'road')
    return out


def predict_trace(pts):
    cache, out = {}, []
    for p in pts:
        if p['sheet'] not in cache:
            t = json.load(open(os.path.join(align.DP, 'trace', p['sheet'] + '.json'), encoding='utf-8'))
            gs = [shape(f['geom']) for f in t['features']]
            cache[p['sheet']] = (gs, [f['cls'] for f in t['features']], shapely.STRtree(gs))
        gs, cl, tree = cache[p['sheet']]
        pt = Point(p['x'], p['z'])
        hit = [i for i in tree.query(pt) if gs[i].contains(pt)]
        out.append(cl[hit[0]] if hit else 'road')
    return out


def score(pts, pred, quiet=False):
    """→ dict of numbers (and prints a table)."""
    lab = [(p, q) for p, q in zip(pts, pred) if p['label'] and p['label'] != '?']
    uni = [(p, q) for p, q in lab if p['kind'] == 'uniform']
    acc = lambda L: sum(p['label'] == q for p, q in L) / max(1, len(L))
    # zoned-only accuracy: what a plot lookup sees (points on plots, ignoring road/plot edge calls)
    zon = [(p, q) for p, q in lab if p['label'] != 'road']
    res = {'n': len(lab), 'uniform': round(acc(uni), 3), 'all': round(acc(lab), 3), 'zoned': round(acc(zon), 3)}
    if quiet: return res
    print(f"labelled {len(lab)} · accuracy: uniform {res['uniform'] * 100:.1f}% (n={len(uni)}) · all {res['all'] * 100:.1f}% · on zoned land {res['zoned'] * 100:.1f}% (n={len(zon)})")
    print(f"{'class':18}{'truth':>6}{'recall':>8}{'pred':>6}{'prec':>7}")
    for k in LABELS:
        t = [(p, q) for p, q in lab if p['label'] == k]
        pr = [(p, q) for p, q in lab if q == k]
        if not t and not pr: continue
        rc = sum(p['label'] == q for p, q in t) / max(1, len(t))
        pc = sum(p['label'] == q for p, q in pr) / max(1, len(pr))
        print(f"{k:18}{len(t):6}{rc * 100:7.0f}%{len(pr):6}{pc * 100:6.0f}%")
    conf = {}
    for p, q in lab:
        if p['label'] != q: conf[(p['label'], q)] = conf.get((p['label'], q), 0) + 1
    print('confusions (truth → predicted): ' + ', '.join(f'{a}→{b} {n}' for (a, b), n in sorted(conf.items(), key=lambda kv: -kv[1])[:14]))
    return res


def evaluate(a):
    pts = load()
    pred = predict_trace(pts) if a.trace else predict_plan(pts, a.plan)
    score(pts, pred)
    if a.misses:
        for p, q in zip(pts, pred):
            if p['label'] and p['label'] != '?' and p['label'] != q: print(f"  #{p['id']} {p['sheet']} {p['label']} → {q}")


def drawn_lines(img):
    """Thin drawn lines on a sheet image: dark ink, red, blue, purple — strokes, not fills."""
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h, sat, v = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    ink = (v < 120) | ((sat < 40) & (v < 150))
    red = ((h <= 8) | (h >= 160)) & (sat > 80) & (v > 110)
    blue = (h >= 100) & (h <= 130) & (sat > 110) & (v > 60) & (v < 230)
    purple = (h >= 130) & (h < 160) & (sat > 50) & (v > 60) & (v < 200)
    m = (ink | red | blue | purple).astype(np.uint8)
    thick = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))     # fills / blobs, not strokes
    return (m & (1 - thick)).astype(bool)


def edges(a):
    """Edge quality of the traces: how far traced boundaries sit from lines drawn on the sheet (metres), and slivers."""
    names = a.sheets or sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(align.DP, a.dir, '*.json')))
    tot = []
    rows = []
    for name in names:
        t = json.load(open(os.path.join(align.DP, a.dir, name + '.json'), encoding='utf-8'))
        sh = Sheet(name, dpi_of(name))
        img = sh.img
        ln = drawn_lines(img)
        dt = cv2.distanceTransform((~ln).astype(np.uint8), cv2.DIST_L2, 3)
        mpp = float(np.linalg.norm(sh.A[:, 0])) * sh.k
        fr = Polygon(t['frame']).buffer(-15)
        ds = []
        sl, n = 0, 0
        for f in t['features']:
            g = shape(f['geom']); n += 1
            if g.area < 100: sl += 1
            for part in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
                for ring in [part.exterior, *part.interiors]:
                    L = ring.length
                    if L < 4: continue
                    P = np.array([ring.interpolate(x).coords[0] for x in np.arange(0, L, 2.0)])
                    P = P[shapely.contains_xy(fr, P[:, 0], P[:, 1])]
                    if not len(P): continue
                    q = np.round(sh.to_px(P)).astype(int)
                    ok = (q[:, 0] >= 0) & (q[:, 1] >= 0) & (q[:, 0] < dt.shape[1]) & (q[:, 1] < dt.shape[0])
                    ds.append(dt[q[ok, 1], q[ok, 0]] * mpp)
        d = np.concatenate(ds) if ds else np.zeros(1)
        tot.append(d)
        rows.append((name, np.median(d), (d <= 1.0).mean(), (d > 3.0).mean(), n, sl))
        sh._img = None
    print(f"{'sheet':8}{'median m':>9}{'<=1 m':>7}{'>3 m':>7}{'plots':>7}{'<100m2':>8}")
    for r in rows: print(f'{r[0]:8}{r[1]:9.2f}{r[2] * 100:6.0f}%{r[3] * 100:6.0f}%{r[4]:7}{r[5]:8}')
    d = np.concatenate(tot)
    print(f"{'all':8}{np.median(d):9.2f}{(d <= 1.0).mean() * 100:6.0f}%{(d > 3.0).mean() * 100:6.0f}%{sum(r[4] for r in rows):7}{sum(r[5] for r in rows):8}")


COL = {'residential': (255, 225, 0), 'ews': (255, 140, 0), 'commercial': (0, 90, 255), 'local_commercial': (120, 150, 255), 'business_hub': (60, 120, 160),
       'industrial': (150, 0, 200), 'psp': (255, 0, 140), 'recreational': (0, 170, 0), 'services': (140, 80, 40), 'transport': (80, 80, 80),
       'defence': (190, 110, 40), 'agriculture': (0, 200, 160), 'forest': (0, 90, 60), 'hill_slope': (90, 110, 30), 'water': (0, 200, 255)}


def show(a):
    """Sheet crop | plan (or a trace) over it, round truth points or a city x,z."""
    pts = {p['id']: p for p in load()}
    plan = json.load(open(os.path.join(align.ROOT, 'data', 'raw', 'cities', CITY, 'plan.json'), encoding='utf-8'))['plots']
    out = []
    for w in a.what:
        if ',' in w:
            x, z, name = w.split(',')
            p = {'x': float(x), 'z': float(z), 'sheet': name, 'id': w, 'label': ''}
        else: p = pts[int(w)]
        sh = Sheet(p['sheet'], dpi_of(p['sheet']))
        if a.trace: plan = json.load(open(os.path.join(align.DP, 'trace', p['sheet'] + '.json'), encoding='utf-8'))['features']
        C = a.size
        u, v = sh.to_px([[p['x'], p['z']]])[0]
        x0, y0 = int(u) - C // 2, int(v) - C // 2
        img = np.pad(sh.img, ((C, C), (C, C), (0, 0)), constant_values=255)[y0 + C:y0 + 2 * C, x0 + C:x0 + 2 * C].copy()
        ov = img.copy(); edge = img.copy()
        box = shapely.box(*(sh.to_city([[x0, y0]])[0]), *(sh.to_city([[x0 + C, y0 + C]])[0]))
        for f in plan:
            g = shape(f['geom'])
            if not g.intersects(box.buffer(50)): continue
            for part in (g.geoms if g.geom_type == 'MultiPolygon' else [g]):
                rings = [np.asarray(part.exterior.coords)] + [np.asarray(h.coords) for h in part.interiors]
                rr = [(sh.to_px(r) - [x0, y0]).round().astype(np.int32) for r in rings]
                m = np.zeros(img.shape[:2], np.uint8); cv2.fillPoly(m, rr, 1)
                ov[m > 0] = COL.get(f['cls'], (0, 0, 0))
                cv2.polylines(edge, rr, True, (255, 0, 0) if f['reserved'] else (0, 0, 0), 1)
        both = cv2.addWeighted(ov, 0.5, edge, 0.5, 0)
        c = C // 2; cv2.circle(img, (c, c), 8, (0, 0, 0), 2); cv2.circle(both, (c, c), 8, (0, 0, 0), 2)
        tile = np.hstack([img, both])
        cv2.putText(tile, f"#{p['id']} {p['sheet']} {p['label']}", (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2, cv2.LINE_AA)
        out.append(tile)
    cv2.imwrite(a.out, cv2.cvtColor(np.vstack(out), cv2.COLOR_RGB2BGR))
    print('->', a.out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('sample'); s.add_argument('--uniform', type=int, default=220); s.add_argument('--per-class', type=int, default=9)
    s = sp.add_parser('sheets'); s.add_argument('--size', type=int, default=240); s.add_argument('--cols', type=int, default=5); s.add_argument('--rows', type=int, default=4)
    s.add_argument('--only', default='all')
    s = sp.add_parser('label'); s.add_argument('pairs', nargs='+')
    s = sp.add_parser('eval'); s.add_argument('--trace', action='store_true'); s.add_argument('--misses', action='store_true'); s.add_argument('--plan', default=None)
    s = sp.add_parser('edges'); s.add_argument('sheets', nargs='*'); s.add_argument('--dir', default='trace')
    s = sp.add_parser('show'); s.add_argument('what', nargs='+'); s.add_argument('--size', type=int, default=400); s.add_argument('--trace', action='store_true'); s.add_argument('--out', default=os.path.join(SHEETS_OUT, 'show.png'))
    a = ap.parse_args()
    {'edges': edges, 'show': show, 'sample': sample, 'sheets': contact, 'label': label, 'eval': evaluate}[a.cmd](a)
