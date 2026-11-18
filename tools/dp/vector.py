"""Vector DP zones: the sheets' drawn lines → a line network → faces → coloured → dissolved, with real roads cut in.

The traced plan (plan.py's merge of trace.py) reads colours well but its outlines are pixel outlines: ragged, short of
the real roads in places, over them in others. This rebuilds the zone geometry from the sheets' own linework:

  1. lines: strokes (anything clearly darker than around it), red lines, and where the fill colour changes
     (Sector I: only near-black strokes; its grey building hatch would chop every plot into stripes)
  2. skeleton → each loose end reaches along its own direction to the next line (closes dashed plot lines)
  3. trace the skeleton into polylines, simplify, node, polygonize → faces
  4. each face takes its majority colour (strokes don't vote): the sheet's palette on Sector II, the trace on Sector I
     (which reads S1 hatch right); a face that still mixes two zones is split along its colours; paper faces are road;
     unclear faces join the neighbour they share the longest edge with; specks (< 400 m²) likewise
  5. dissolve faces of one zone (they share exact edges); the part of a DP road strip that isn't real road (OSM)
     joins the zone beside it; OSM road corridors are cut out; coverage-simplified (shared edges stay shared)

Run per 600 m tile (plus a 60 m margin for context, cut back to the tile), in parallel; each pixel reads the sheet
plan.py would take it from (Sector I first, then the frame it sits deepest in). Tiles meet on exact lines, so the
city-wide dissolve has no seams. Called by plan.py (run(...)); `python vector.py x,z` runs one tile and draws it.
"""
import os, sys, json, re, math, time
import numpy as np, cv2
import shapely
from shapely.geometry import LineString, Polygon, box as sbox
sys.path.insert(0, os.path.dirname(__file__))
import align
import regions as RG
import palette

KEYS = RG.KEYS; K = len(KEYS); NONE = 255; PAPER = palette.PAPER
RES = 0.5            # metres per pixel
TILE = 600.0         # tile core, metres
MARGIN = 60.0        # context round each tile
SPECK = 400.0        # m²: zone patches smaller than this join their neighbour
ROAD_W = {'motorway': 24, 'trunk': 22, 'primary': 20, 'secondary': 16, 'tertiary': 12, 'unclassified': 8, 'residential': 7,
          'living_street': 6, 'primary_link': 10, 'secondary_link': 9, 'tertiary_link': 8, 'trunk_link': 10}


# ---------------------------------------------------------------- inputs shared by every tile
def osm_roads(lat0, lon0, kx, kz):
    """OSM roads (the ones with a carriageway) as [(city-metre polyline, width m)]."""
    p = os.path.join(align.ROOT, 'data', 'raw', 'cities', align.CITY, 'osm.xml')
    s = open(p, encoding='utf-8').read()
    nodes = {m.group(1): ((float(m.group(3)) - lon0) * kx, -(float(m.group(2)) - lat0) * kz)
             for m in re.finditer(r'<node id="(\d+)" lat="([-\d.]+)" lon="([-\d.]+)"', s)}
    out = []
    for m in re.finditer(r'<way id="\d+">(.*?)</way>', s, re.S):
        b = m.group(1)
        hw = re.search(r'k="highway" v="([^"]+)"', b)
        if not hw or hw.group(1) not in ROAD_W: continue
        pts = [nodes[r] for r in re.findall(r'nd ref="(\d+)"', b) if r in nodes]
        if len(pts) < 2: continue
        w = ROAD_W[hw.group(1)]
        lanes = re.search(r'k="lanes" v="(\d+)"', b)
        if lanes: w = max(w, min(8, int(lanes.group(1))) * 3.3)
        out.append((pts, w))
    return out


G = {}   # per-worker globals: plots, frames, roads (+ trees), sheet / palette caches


def init(plots, frames, roads):
    G['plots'] = [(KEYS.index(p['cls']), shapely.from_wkb(p['wkb']), p['sheet']) for p in plots if p['cls'] in KEYS]
    G['ptree'] = shapely.STRtree([g for _, g, _ in G['plots']])
    G['frames'] = {s: Polygon(f) for s, f in frames.items()}
    G['roads'] = roads
    G['rtree'] = shapely.STRtree([LineString(p) for p, _ in roads])
    G['img'] = {}; G['pal'] = {}


def sheet(name):
    """Sheet image (cached, at most two per worker) and its palette."""
    if name not in G['img']:
        if len(G['img']) >= 2: G['img'].pop(next(iter(G['img'])))
        import truth
        G['img'][name] = truth.Sheet(name, 150 if name.startswith('S1') else 200)
        G['img'][name].img
    if name not in G['pal']: G['pal'][name] = palette.sheet_palette(name)
    return G['img'][name], G['pal'][name]


# ---------------------------------------------------------------- small raster tools
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def mode_filter(L, k):
    best = np.zeros(L.shape, np.float32); out = L.copy()
    for v in np.unique(L):
        c = cv2.boxFilter((L == v).astype(np.float32), -1, (k, k), normalize=False)
        upd = c > best; best[upd] = c[upd]; out[upd] = v
    return out


def nb_count(img):
    c = cv2.filter2D(img.astype(np.uint8), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT)
    return c.astype(np.int32) - img


def clean(g):
    """Valid, snapped to 1 cm (GEOS overlay can trip on near-coincident edges otherwise)."""
    try: g = shapely.make_valid(g)
    except Exception: g = g.buffer(0)
    try: return shapely.make_valid(shapely.set_precision(g, 0.01))
    except Exception:
        try: return shapely.make_valid(g.buffer(0))
        except Exception: return g


def tile_safe(job):
    """tile(), and if it fails, the trace for that tile (logged) so one bad tile can't stop the city."""
    try:
        return tile(job)
    except Exception as e:
        cx0, cz0 = job
        core = sbox(cx0, cz0, cx0 + TILE, cz0 + TILE)
        print(f'  tile {cx0:.0f},{cz0:.0f} fell back to the trace: {type(e).__name__}: {e}', file=sys.stderr, flush=True)
        out = []
        for j in G['ptree'].query(core):
            c, g, sname = G['plots'][j]
            for q in shapely.get_parts(clean(g).intersection(core)):
                if q.geom_type == 'Polygon' and q.area >= 20: out.append((c, shapely.to_wkb(q), 0.5, sname))
        return out


# ---------------------------------------------------------------- one tile
def tile(job):
    """Zone polygons for one tile core: [(class index, polygon in city metres, conf, sheet)]."""
    cx0, cz0 = job
    x0, z0 = cx0 - MARGIN, cz0 - MARGIN
    SIZE = TILE + 2 * MARGIN; N = int(round(SIZE / RES))
    core = sbox(cx0, cz0, cx0 + TILE, cz0 + TILE)
    ext = sbox(x0, z0, x0 + SIZE, z0 + SIZE)
    frames = {s: f for s, f in G['frames'].items() if f.intersects(ext)}
    if not frames: return []
    cover = shapely.union_all(list(frames.values()))
    if not cover.intersects(core): return []
    gx = x0 + (np.arange(N) + 0.5) * RES; gz = z0 + (np.arange(N) + 0.5) * RES

    # ---- which sheet each pixel reads (plan.py's rule): Sector I wins inside its frame, then the deepest frame
    st = 8; cgx, cgz = gx[::st], gz[::st]
    CX, CZ = np.meshgrid(cgx, cgz); pts = shapely.points(CX.ravel(), CZ.ravel())
    names = sorted(frames)
    depth = np.full((len(names), CX.size), -1e9)
    for i, s in enumerate(names):
        f = frames[s]
        inside = shapely.contains(f, pts)
        d = shapely.distance(f.exterior, pts)
        depth[i] = np.where(inside, d + (1e6 if s.startswith('S1') else 0), -1e9)
    own_c = np.where(depth.max(0) > -1e8, depth.argmax(0), -1).reshape(CX.shape).astype(np.int16)
    OWN = np.repeat(np.repeat(own_c, st, 0), st, 1)[:N, :N]
    if (OWN < 0).all(): return []
    GX, GZ = np.meshgrid(gx, gz)
    SHT = np.full((N, N, 3), 255, np.uint8); CLS = np.full((N, N), PAPER, np.uint8)
    S1px = np.zeros((N, N), bool)
    for i, s in enumerate(names):
        m = OWN == i
        if not m.any(): continue
        sh, pal = sheet(s)
        # sheet position of every pixel: computed on a coarse grid (the mapping is smooth) and interpolated
        c = 8; cn = N // c + 1
        cx_, cz_ = x0 + np.arange(cn) * c * RES, z0 + np.arange(cn) * c * RES
        CXg, CZg = np.meshgrid(cx_, cz_)
        P = sh.to_px(np.column_stack([CXg.ravel(), CZg.ravel()])).astype(np.float32)
        # pixel centre (i + 0.5) * RES ↔ coarse node k * c * RES: sample the coarse field at (i + 0.5) / c
        u = ((np.arange(N) + 0.5) / c).astype(np.float32)
        UX, UY = np.meshgrid(u, u)
        mx = cv2.remap(P[:, 0].reshape(cn, cn), UX, UY, cv2.INTER_LINEAR)
        my = cv2.remap(P[:, 1].reshape(cn, cn), UX, UY, cv2.INTER_LINEAR)
        img = cv2.remap(sh.img, mx, my, cv2.INTER_LINEAR, borderValue=(255, 255, 255))
        cls, _ = palette.classify(img, pal)
        SHT[m] = img[m]; CLS[m] = cls[m]
        if s.startswith('S1'): S1px |= m

    def topx(c): return ((np.asarray(c)[:, :2] - [x0, z0]) / RES).round().astype(np.int32)

    # ---- the trace (colour on Sector I) and real roads
    BASE = np.full((N, N), NONE, np.uint8)
    for j in sorted(G['ptree'].query(ext), key=lambda j: -G['plots'][j][1].area):
        c, g, _ = G['plots'][j]
        for part in shapely.get_parts(g):
            mm = np.zeros((N, N), np.uint8); cv2.fillPoly(mm, [topx(part.exterior.coords)], 1)
            for h in part.interiors: cv2.fillPoly(mm, [topx(h.coords)], 0)
            BASE[mm > 0] = c
    ROADS = np.zeros((N, N), np.uint8); rl = []
    for j in G['rtree'].query(ext):
        pts_, w = G['roads'][j]
        cv2.polylines(ROADS, [topx(pts_)], False, 1, max(1, int(round(w / RES))))
        rl.append(LineString(pts_).buffer(w / 2, cap_style='flat'))
    roadbuf = shapely.union_all(rl).intersection(ext) if rl else Polygon()

    # ---- 1. lines
    zone = np.where(CLS < K, CLS, NONE).astype(np.uint8)
    smooth = mode_filter(np.where(CLS == PAPER, 254, zone).astype(np.uint8), 11)
    cedge = np.zeros((N, N), bool)
    cedge[1:, :] |= smooth[1:, :] != smooth[:-1, :]; cedge[:, 1:] |= smooth[:, 1:] != smooth[:, :-1]
    cedge &= OWN[:, :] >= 0
    gray = cv2.cvtColor(SHT, cv2.COLOR_RGB2GRAY)
    bh = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    hsv = cv2.cvtColor(SHT, cv2.COLOR_RGB2HSV)
    red = (((hsv[..., 0] <= 8) | (hsv[..., 0] >= 160)) & (hsv[..., 1] > 90) & (hsv[..., 2] > 110))
    red &= ~cv2.morphologyEx(red.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)).astype(bool)
    dens = cv2.boxFilter(((bh > 28) & ~red).astype(np.float32), -1, (15, 15))
    strokes = np.where(S1px, (bh > 28) & ((gray < 105) | (dens < 0.18)), bh > 28) | red
    mask = (strokes | cedge).astype(np.uint8)
    n_, comp, stt, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    mask[(stt[:, cv2.CC_STAT_AREA] < 8)[comp]] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    from skimage.morphology import skeletonize
    sk = skeletonize(mask > 0)

    # ---- 2. bridge gaps
    def nbrs(img, y, x):
        return [(y + dy, x + dx) for dy, dx in OFF if 0 <= y + dy < N and 0 <= x + dx < N and img[y + dy, x + dx]]
    REACH, JOIN = 7.0 / RES, 3.0 / RES
    ends = np.argwhere(sk & (nb_count(sk) == 1))
    bridged = sk.copy().view(np.uint8); tails = {}
    for (y, x) in ends:
        path = [(y, x)]; prev = None; cur = (y, x)
        for _ in range(10):
            nx = [p for p in nbrs(sk, *cur) if p != prev and p not in path]
            if len(nx) != 1: break
            prev, cur = cur, nx[0]; path.append(cur)
        tails[(y, x)] = set(path)
        if len(path) < 4: continue
        dy, dx = path[0][0] - path[-1][0], path[0][1] - path[-1][1]
        L = math.hypot(dy, dx); dy, dx = dy / L, dx / L
        for s in np.arange(1.5, REACH, 0.7):
            py, px = int(round(y + dy * s)), int(round(x + dx * s))
            if not (0 <= py < N and 0 <= px < N): break
            if sk[py, px] and (py, px) not in tails[(y, x)]:
                cv2.line(bridged, (int(x), int(y)), (px, py), 1, 1); break
    if len(ends):
        E = ends.astype(np.float32)
        for i, (y, x) in enumerate(ends):
            y0_, x0_ = max(0, y - 1), max(0, x - 1)
            if nb_count(bridged[y0_:y + 2, x0_:x + 2].astype(bool))[y - y0_, x - x0_] > 1: continue
            d = np.hypot(E[:, 0] - y, E[:, 1] - x); d[i] = 1e9
            for j in np.argsort(d)[:3]:
                if d[j] > JOIN: break
                if tuple(ends[j]) in tails[(y, x)]: continue
                cv2.line(bridged, (int(x), int(y)), (int(ends[j][1]), int(ends[j][0])), 1, 1); break
    sk = skeletonize(bridged > 0)

    # ---- 3. trace → polylines → faces
    node = sk & (nb_count(sk) != 2)
    seen = np.zeros_like(sk)
    paths = []
    def walk(start, first):
        path = [start, first]; prev, cur = start, first
        while not node[cur] and cur != start:
            seen[cur] = True
            nx = [p for p in nbrs(sk, *cur) if p != prev and not (seen[p] and not node[p])]
            if not nx: break
            nx.sort(key=lambda p: abs(p[0] - cur[0]) + abs(p[1] - cur[1]))
            prev, cur = cur, nx[0]; path.append(cur)
        return path
    for (y, x) in np.argwhere(node):
        for p in nbrs(sk, y, x):
            if node[p]:
                if p > (y, x): paths.append([(y, x), p])
                continue
            if not seen[p]: paths.append(walk((y, x), p))
    for (y, x) in np.argwhere(sk & ~seen & ~node):
        if seen[y, x]: continue
        p = nbrs(sk, y, x)
        if p: paths.append(walk((y, x), p[0]))
    frame = sbox(0, 0, SIZE, SIZE)                       # local metres from (x0, z0)
    geoms = [frame.exterior]
    for pth in paths:
        if len(pth) < 2: continue
        g = LineString([((px + 0.5) * RES, (py + 0.5) * RES) for py, px in pth]).simplify(0.6)
        if g.length > 0: geoms.append(g)
    faces = [f for f in shapely.get_parts(shapely.polygonize(shapely.get_parts(shapely.union_all(geoms)))) if f.area > 0.05]

    # ---- 4. colour
    FC = np.where(S1px, np.where(BASE < K, BASE, PAPER), CLS).astype(np.uint8)
    FC[OWN < 0] = PAPER
    lab_all = np.where(FC < K, FC, np.where(FC == PAPER, K, K + 1)).astype(np.int64)
    lab = lab_all.copy(); lab[cv2.dilate(strokes.astype(np.uint8), None) > 0] = K + 1
    def ltopx(c): return (np.asarray(c)[:, :2] / RES).round().astype(np.int32)
    ID = np.full((N, N), -1, np.int32)
    def raster(faces):
        ID[:] = -1
        for i in np.argsort([-f.area for f in faces]): cv2.fillPoly(ID, [ltopx(faces[i].exterior.coords)], int(i))
        ok = ID >= 0; nf = len(faces)
        cnt = np.bincount(ID[ok].astype(np.int64) * (K + 2) + lab[ok], minlength=nf * (K + 2)).reshape(nf, K + 2)
        ca = np.bincount(ID[ok].astype(np.int64) * (K + 2) + lab_all[ok], minlength=nf * (K + 2)).reshape(nf, K + 2)
        few = cnt[:, :K + 1].sum(1) < 0.3 * np.maximum(ca.sum(1), 1)
        cnt[few] = ca[few]
        return cnt
    cnt = raster(faces); nf = len(faces)
    zc, paper = cnt[:, :K], cnt[:, K]
    sh2 = np.sort(zc, 1)[:, -2]; tot = cnt.sum(1)
    mixed = np.nonzero(((sh2 > 0.15 * np.maximum(zc.sum(1) + paper, 1)) | (sh2 * RES * RES > 300)) & (tot * RES * RES > 300))[0]
    if len(mixed):
        sm = mode_filter(np.where(FC == PAPER, 254, np.where(FC < K, FC, NONE)).astype(np.uint8), 9)
        newf = []
        for i in mixed:
            fm = ID == i
            for v in np.unique(sm[fm]):
                mm = (fm & (sm == v)).astype(np.uint8)
                cs, hier = cv2.findContours(mm, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
                for k, c in enumerate(cs):
                    if hier[0][k][3] != -1 or len(c) < 3: continue
                    hs = [cs[j][:, 0] * RES for j in range(len(cs)) if hier[0][j][3] == k and len(cs[j]) >= 3]
                    P = Polygon(c[:, 0] * RES, hs).buffer(0).simplify(0.6).intersection(faces[i])
                    newf += [q for q in shapely.get_parts(P) if q.geom_type == 'Polygon' and q.area > 1]
        keep = np.ones(nf, bool); keep[mixed] = False
        faces = [f for f, k in zip(faces, keep) if k] + newf
        faces = [f for f in shapely.get_parts(shapely.polygonize(shapely.get_parts(shapely.union_all([f.boundary for f in faces] + [frame.exterior])))) if f.area > 0.05]
        cnt = raster(faces); nf = len(faces)
        zc, paper = cnt[:, :K], cnt[:, K]
    cleanpx = zc.sum(1) + paper
    flab = np.full(nf, NONE, np.int32)
    thin = np.array([f.area / max(f.length, 1e-6) < 0.9 for f in faces])
    good = (zc.max(1) >= 0.5 * np.maximum(cleanpx, 1)) & (zc.max(1) > 1.5 * paper) & (cleanpx > 0) & ~thin
    flab[good] = zc.argmax(1)[good]
    is_road = (flab == NONE) & (paper > zc.sum(1)) & (cnt.sum(1) * RES * RES > 60)
    # adjacency by shared edge length (face raster)
    pairs = []
    for a, b in ((ID[1:, :], ID[:-1, :]), (ID[:, 1:], ID[:, :-1])):
        d = (a != b) & (a >= 0) & (b >= 0); pairs.append(np.stack([a[d], b[d]], 1))
    P = np.sort(np.concatenate(pairs), 1)
    u, c = np.unique(P[:, 0].astype(np.int64) * nf + P[:, 1], return_counts=True)
    adj = [dict() for _ in range(nf)]
    for kk, w in zip(u, c):
        a, b = int(kk // nf), int(kk % nf); adj[a][b] = adj[a].get(b, 0) + w; adj[b][a] = adj[b].get(a, 0) + w
    unclear = [i for i in range(nf) if flab[i] == NONE and not is_road[i]]
    for _ in range(8):
        changed = 0
        for i in unclear:
            if flab[i] != NONE: continue
            best = {}
            for j, w in adj[i].items():
                if flab[j] != NONE: best[flab[j]] = best.get(flab[j], 0) + w
            if best: flab[i] = max(best, key=best.get); changed += 1
        if not changed: break
    parent = list(range(nf))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for i in range(nf):
        for j in adj[i]:
            if flab[i] == flab[j] and flab[i] != NONE: parent[find(i)] = find(j)
    garea = {}
    for i in range(nf):
        if flab[i] != NONE: garea[find(i)] = garea.get(find(i), 0) + faces[i].area
    for i in range(nf):
        if flab[i] == NONE or garea[find(i)] >= SPECK: continue
        best = {}
        for j, w in adj[i].items():
            if flab[j] != NONE and find(j) != find(i): best[flab[j]] = best.get(flab[j], 0) + w
        if best: flab[i] = max(best, key=best.get)

    # ---- 5. dissolve, real roads, simplify
    to_city = lambda g: shapely.transform(g, lambda P: P + [x0, z0])
    zones = {int(v): clean(to_city(shapely.union_all([faces[i] for i in range(nf) if flab[i] == v]))) for v in set(flab.tolist()) - {NONE}}
    roadbuf = clean(roadbuf)
    dp_road = [faces[i] for i in range(nf) if flab[i] == NONE]
    if dp_road and zones:
        spare = clean(clean(to_city(shapely.union_all(dp_road))).difference(roadbuf))
        for piece in shapely.get_parts(spare):
            if piece.area < 2: continue
            touch = {v: piece.buffer(0.6).intersection(g).area for v, g in zones.items()}
            v = max(touch, key=touch.get)
            if touch[v] > 0: zones[v] = clean(zones[v].union(clean(piece)))
    clip = core.intersection(cover)
    parts = []
    for v, g in zones.items():
        g = g.difference(roadbuf).intersection(clip) if not roadbuf.is_empty else g.intersection(clip)
        for p in shapely.get_parts(g):
            if p.geom_type == 'Polygon' and p.area >= 20:
                parts.append((v, Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= 60])))
    parts.sort(key=lambda q: -q[1].area)
    acc, cov = [], None
    for v, p in parts:                                   # a filled pinhole may cover another zone's bit: first wins
        if cov is not None: p = p.difference(cov)
        acc += [(v, q) for q in shapely.get_parts(p) if q.geom_type == 'Polygon' and q.area >= 20]
        cov = p if cov is None else cov.union(p)
    parts = acc
    if parts:
        try:
            sp = shapely.coverage_simplify(np.array([p for _, p in parts], dtype=object), 0.8, simplify_boundary=False)
            parts = [(v, r) for (v, _), q in zip(parts, sp) for r in shapely.get_parts(q.difference(roadbuf) if not roadbuf.is_empty else q)
                     if r.geom_type == 'Polygon' and r.area >= 20]
        except Exception:
            pass
    # conf (how much of its sheet colour agrees) and sheet, per part
    out = []
    for v, p in parts:
        mm = np.zeros((N, N), np.uint8); cv2.fillPoly(mm, [topx(p.exterior.coords)], 1)
        sel = (mm > 0) & (FC < K)
        conf = float((FC[sel] == v).mean()) if sel.any() else 0.5
        ow = OWN[mm > 0]; ow = ow[ow >= 0]
        sname = names[np.bincount(ow).argmax()] if len(ow) else names[0]
        out.append((v, shapely.to_wkb(p), round(conf, 2), sname))
    return out


# ---------------------------------------------------------------- the city
def run(plots, frames, workers=8, only=None):
    """plots: plan.py's merged trace plots (with shapely geoms). → new plots (zones from the linework, reserved from the trace)."""
    from multiprocessing import Pool
    city = json.load(open(os.path.join(align.ROOT, 'cities', align.CITY, 'city.json'), encoding='utf-8'))['frame']
    lat0, lon0 = city['lat'], city['lon']
    kx, kz = 111320 * math.cos(math.radians(lat0)), 110540.0
    t0 = time.time()
    roads = osm_roads(lat0, lon0, kx, kz)
    cover = shapely.union_all([Polygon(f) for f in frames.values()])
    b = cover.bounds
    jobs = [(b[0] + i * TILE, b[1] + j * TILE) for i in range(math.ceil((b[2] - b[0]) / TILE)) for j in range(math.ceil((b[3] - b[1]) / TILE))]
    jobs = [j for j in jobs if cover.intersects(sbox(j[0], j[1], j[0] + TILE, j[1] + TILE))]
    if only: jobs = [j for j in jobs if sbox(j[0], j[1], j[0] + TILE, j[1] + TILE).intersects(only)]
    # group jobs by sheet so each worker keeps reading the same one or two
    ff = {s: Polygon(f) for s, f in frames.items()}
    def main_sheet(j):
        c = shapely.Point(j[0] + TILE / 2, j[1] + TILE / 2)
        inside = [s for s, f in ff.items() if f.contains(c)]
        return (sorted(inside, key=lambda s: (not s.startswith('S1'), -ff[s].exterior.distance(c)))[0] if inside else 'z', j[1], j[0])
    jobs.sort(key=main_sheet)
    lite = [{'cls': p['cls'], 'wkb': shapely.to_wkb(p['geom']), 'sheet': p['sheet']} for p in plots]
    print(f'vector: {len(jobs)} tiles of {TILE:.0f} m, {len(roads)} OSM roads, {workers} workers')
    res = []
    with Pool(workers, initializer=init, initargs=(lite, frames, roads)) as pool:
        for i, r in enumerate(pool.imap(tile_safe, jobs, chunksize=2)):
            res += r
            if (i + 1) % 50 == 0 or i + 1 == len(jobs):
                print(f'  {i + 1}/{len(jobs)} tiles, {len(res)} parts ({time.time() - t0:.0f}s)', flush=True)
    # dissolve across tiles, per zone
    by = {}
    for v, w, conf, s in res: by.setdefault(v, []).append((shapely.from_wkb(w), conf, s))
    zones = []
    for v, items in by.items():
        geoms = [g for g, _, _ in items]
        tree = shapely.STRtree(geoms)
        merged = shapely.union_all(np.array([clean(g) for g in geoms], dtype=object))
        for g in shapely.get_parts(merged):
            if g.geom_type != 'Polygon' or g.area < 20: continue
            idx = tree.query(g, predicate='intersects')
            wsum = sum(geoms[i].area for i in idx) or 1
            conf = sum(items[i][1] * geoms[i].area for i in idx) / wsum
            sh = {}
            for i in idx: sh[items[i][2]] = sh.get(items[i][2], 0) + geoms[i].area
            zones.append({'cls': KEYS[v], 'reserved': False, 'area': round(g.area), 'conf': round(conf, 2),
                          'sheet': max(sh, key=sh.get) if sh else '', 'geom': g})
    # reserved sites stay as traced (they're drawn with their own red verges and code markers): laid on top
    rsv = [p for p in plots if p['reserved']]
    if rsv:
        R = shapely.union_all([p['geom'] for p in rsv])
        tree = shapely.STRtree([z['geom'] for z in zones])
        for i in set(tree.query(R, predicate='intersects').tolist()):
            z = zones[i]; z['geom'] = z['geom'].difference(R)
        kept = []
        for z in zones:
            for g in shapely.get_parts(z['geom']):
                if g.geom_type == 'Polygon' and g.area >= 20: kept.append({**z, 'area': round(g.area), 'geom': g})
        zones = kept + [{**p} for p in rsv]
    print(f'vector: {len(zones)} plots ({len(rsv)} reserved, from the trace) in {time.time() - t0:.0f}s')
    return zones


if __name__ == '__main__':
    # one tile, drawn over the sheet: python vector.py x,z
    os.environ.setdefault('DP_CITY', 'pune')
    import glob
    from shapely.geometry import shape
    x, z = map(float, sys.argv[1].split(','))
    plan = json.load(open(os.path.join(align.ROOT, 'data', 'raw', 'cities', align.CITY, 'plan.trace.json'), encoding='utf-8'))
    frames = {json.load(open(p, encoding='utf-8'))['sheet']: json.load(open(p, encoding='utf-8'))['frame'] for p in glob.glob(os.path.join(align.DP, 'trace', '*.json'))}
    city = json.load(open(os.path.join(align.ROOT, 'cities', align.CITY, 'city.json'), encoding='utf-8'))['frame']
    kx = 111320 * math.cos(math.radians(city['lat']))
    init([{'cls': p['cls'], 'wkb': shapely.to_wkb(shape(p['geom'])), 'sheet': p['sheet']} for p in plan['plots']], frames, osm_roads(city['lat'], city['lon'], kx, 110540.0))
    t0 = time.time(); r = tile((x, z)); print(len(r), 'parts', f'{time.time() - t0:.1f}s')
