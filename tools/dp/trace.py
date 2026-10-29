"""Line-based tracing of DP sheets into a clean polygon coverage (plots with land use), in the city frame.

The colour-blob tracer (regions.py) breaks plots apart and leaves gaps. This one follows how the sheet is drawn:

  1. lines: black plot / building lines, red verges, blue modification lines, plus edges where the fill colour
     changes — together they cut the sheet into faces (4-connected areas between lines)
  2. every line pixel goes to its nearest face, so neighbouring faces share their edge exactly (no gaps, no overlaps)
  3. faces get the land use most of their pixels are coloured with (legend colours calibrated on the sheet);
     specks (letter holes, symbols) merge into their neighbour; a building outline (a face surrounded by one plot of
     the same land use) merges into its plot
  4. a red verge around a face (or a circled code on it) marks a site reserved for a public purpose
  5. polygons come out of the label map with shared edges (rasterio), go through the sheet's registration into the
     city frame, and are simplified as one coverage (shapely), so edges stay shared

Usage: DP_CITY=pune python tools/dp/trace.py [sheet ...] [--dpi N]
  → data/raw/cities/<city>/dp/trace/<sheet>.json (polygons in city metres + properties)
"""
import json, sys, os, glob, time, argparse
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
import regions as RG
from measure import load_reg, correction

import rasterio.features
import shapely
from shapely.geometry import shape, mapping

FRAME = 0.755        # map frame = the left 75.5 % of the page; the legend is on the right
OUT = os.path.join(align.DP, 'trace')
os.makedirs(OUT, exist_ok=True)
KEYS = RG.KEYS


def masks(img):
    """Line pixels: dark ink, red verges / labels, blue modification lines."""
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0].astype(np.int16), hsv[:, :, 1].astype(np.int16), hsv[:, :, 2].astype(np.int16)
    ink = (v < 115) | ((s < 45) & (v < 165))
    red = ((h <= 8) | (h >= 165)) & (s > 70) & (v > 120)
    blue = (h >= 100) & (h <= 128) & (s > 90) & (v > 60) & (v < 235)
    return ink, red, blue


def classify_hue(img, who, cen):
    """Sector I (1:2,000) colours by hue family: the sheets shade every building grey over the plot colour, which
    dulls the colour (lower chroma, darker) but keeps its hue. Measured on the sheets: residential 96–102°,
    commercial blue −94…−110°, public / semi-public pink ~17°, recreational green ~132°, EWS orange ~89° (high chroma)."""
    H, W = img.shape[:2]
    cls = np.full((H, W), 255, np.uint8)
    dist = np.full((H, W), RG.MAX_DE * 0.3, np.float32)
    K = {k: i for i, k in enumerate(KEYS)}
    for j0 in range(0, H, 400):
        sl = slice(j0, j0 + 400)
        lab = cv2.cvtColor(img[sl], cv2.COLOR_RGB2LAB).astype(np.float32)
        a, b = lab[:, :, 1] - 128, lab[:, :, 2] - 128
        C = np.hypot(a, b)
        h = np.degrees(np.arctan2(b, a))
        out = np.full(C.shape, 255, np.uint8)
        rules = [
            ((h >= 80) & (h <= 115) & (C >= 18), K['residential']),
            ((h >= 80) & (h < 95) & (C >= 58), K['ews']),
            ((h >= -132) & (h <= -80) & (C >= 6), K['commercial']),
            ((h >= -2) & (h <= 32) & (C >= 8), K['psp']),
            ((h >= 115) & (h <= 155) & (C >= 25), K['recreational']),
            ((h >= 50) & (h < 80) & (C >= 10) & (C <= 40), K['services']),
            ((h >= -75) & (h <= -25) & (C >= 22), K['industrial']),
        ]
        for m, k in rules: out[m] = k
        cls[sl] = out
    return cls, dist


def trace_sheet(name, dpi):
    t0 = time.time()
    Ainv, cps, reg = load_reg(name)
    A = np.linalg.inv(Ainv)[:2]
    img = align.sheet_image(align.sheet_pdf(name), dpi)
    H, W = img.shape[:2]
    fw = int(W * FRAME)
    img = img[:, :fw].copy()
    px_m = reg['m_per_px300'] * 300 / dpi          # metres per pixel at this dpi
    px_area = px_m * px_m
    # ---- colours: calibrate the legend on this sheet, classify every pixel
    who = np.zeros(img.shape[:2], np.uint8)
    # Sector I (1:2,000) hatches buildings in grey over the plot colour and writes everywhere: classify the colours
    # through a median filter (it washes the hatch out) and don't cut at black ink — plots of one land use merge anyway
    detailed = name.startswith('S1')
    cen = RG.calibrate(img, who)
    cls, dist = (classify_hue if detailed else RG.classify)(img, who, cen)
    ink, red, blue = masks(img)
    if detailed:
        # hatch / text / lines are ink; the fill shows between them: give each ink pixel its nearest clean pixel's class
        dirty = (ink | red | blue).astype(np.uint8)
        _, lab = cv2.distanceTransformWithLabels(dirty, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
        lut = np.concatenate([[255], cls[dirty == 0]]).astype(np.uint8)
        cls = np.where(dirty == 1, lut[np.minimum(lab, len(lut) - 1)], cls)
        del lab, lut
    # ---- lines: drawn lines + edges where the (classified) fill changes
    lines = (red | blue) if detailed else (ink | red | blue)
    c = cls.astype(np.int16)
    edge = np.zeros_like(lines)
    # every change of fill — including coloured ↔ white, so plots and the (white) roads between them part ways
    edge[:, 1:] |= c[:, 1:] != c[:, :-1]
    edge[1:, :] |= c[1:, :] != c[:-1, :]
    lines |= edge
    # join line ends that almost meet (≤ 1 px)
    lines = cv2.morphologyEx(lines.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8)).astype(bool)
    lines[0, :] = lines[-1, :] = True; lines[:, 0] = lines[:, -1] = True
    del edge, c
    # ---- faces: 4-connected areas between lines
    nf, faces = cv2.connectedComponents((~lines).astype(np.uint8), connectivity=4, ltype=cv2.CV_32S)
    # majority land use per face (bincount over (face, class))
    cl = np.where(cls == 255, len(KEYS), cls).astype(np.int64)
    counts = np.bincount((faces.astype(np.int64) * (len(KEYS) + 1) + cl).ravel(), minlength=nf * (len(KEYS) + 1)).reshape(nf, len(KEYS) + 1)
    size = counts.sum(1)
    coloured = counts[:, :len(KEYS)].sum(1)
    major = counts[:, :len(KEYS)].argmax(1)
    share = np.where(coloured > 0, counts[np.arange(nf), major] / np.maximum(1, coloured), 0)
    # a face is a land-use plot when most of it is coloured; otherwise it's road / unzoned (white)
    land = (coloured >= 0.5 * size) & (size * px_area >= 30)
    # specks: tiny faces (letters, symbols) are dissolved into the lines, so their pixels go to the neighbour
    small = size * px_area < 40
    faces[small[faces]] = 0
    # ---- every remaining pixel → nearest face (shared edges, no gaps)
    zero = (faces == 0).astype(np.uint8)
    _, lab = cv2.distanceTransformWithLabels(zero, cv2.DIST_L2, 3, labelType=cv2.DIST_LABEL_PIXEL)
    # DIST_LABEL_PIXEL numbers the zero-valued (non-line) source pixels in scan order; map label → face id
    src = faces[zero == 0]
    lut = np.concatenate([[0], src]).astype(np.int32)
    full = np.where(zero == 1, lut[np.minimum(lab, len(lut) - 1)], faces)
    del lab, zero, src
    # ---- building outlines: a face whose only neighbour is one face of the same land use merges into it
    nb = {}
    for a, b in ((full[:, 1:], full[:, :-1]), (full[1:, :], full[:-1, :])):
        m = a != b
        pa, pb = a[m].astype(np.int64), b[m].astype(np.int64)
        for x, y in ((pa, pb), (pb, pa)):
            key = np.unique(x * (nf + 1) + y)
            for k in key: nb.setdefault(int(k // (nf + 1)), set()).add(int(k % (nf + 1)))
    parent = np.arange(nf)
    def root(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    area_m = size * px_area
    for f, ns in nb.items():
        if len(ns) == 1 and land[f]:
            g = next(iter(ns))
            if land[g] and major[g] == major[f] and area_m[f] < 5000 and area_m[g] > area_m[f]: parent[f] = g
    roots = np.array([root(i) for i in range(nf)], np.int32)
    full = roots[full]
    # ---- reservations: red share of each face's outer edge (pixels just outside it)
    dil = cv2.dilate(full.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
    ero = cv2.erode(full.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
    border = (dil != full) | (ero != full)
    fb = full[border].astype(np.int64)
    red_b = np.bincount(fb, weights=red[border].astype(np.float64), minlength=nf)
    all_b = np.bincount(fb, minlength=nf).astype(np.float64)
    red_share = red_b / np.maximum(1, all_b)
    # recompute land use over merged faces
    counts2 = np.zeros_like(counts)
    np.add.at(counts2, roots, counts)
    major2 = counts2[:, :len(KEYS)].argmax(1)
    # ---- parcels: neighbouring faces of the same land use join up (plot and building lines inside one zone), except
    # reserved sites, which keep their own outline; river pieces join regardless (red flood lines run through them)
    wi = KEYS.index('water')
    resv = (red_share > 0.55) & (major2 != wi)
    pairs = set()
    for a2, b2 in ((full[:, 1:], full[:, :-1]), (full[1:, :], full[:-1, :])):
        m = a2 != b2
        pairs.update(np.unique(np.minimum(a2[m], b2[m]).astype(np.int64) * (nf + 1) + np.maximum(a2[m], b2[m])).tolist())
    parent2 = np.arange(nf)
    def root2(i):
        while parent2[i] != i: parent2[i] = parent2[parent2[i]]; i = parent2[i]
        return i
    for k in pairs:
        f, g = int(k // (nf + 1)), int(k % (nf + 1))
        if not (land[f] and land[g]) or major2[f] != major2[g]: continue
        if major2[f] != wi and (resv[f] or resv[g]): continue
        rf, rg = root2(f), root2(g)
        if rf != rg: parent2[max(rf, rg)] = min(rf, rg)
    r2 = np.array([root2(i) for i in range(nf)], np.int32)
    full = r2[full]
    counts3 = np.zeros_like(counts2)
    np.add.at(counts3, r2, counts2)
    major2 = counts3[:, :len(KEYS)].argmax(1)
    land = np.bincount(r2, weights=land.astype(np.float64), minlength=nf) > 0
    red_share = np.where(np.arange(nf) == r2, red_share, 0.0)
    roots = r2
    fit = np.bincount(full.ravel(), weights=np.minimum(dist, RG.MAX_DE).ravel(), minlength=nf) / np.maximum(1, np.bincount(full.ravel(), minlength=nf))
    # ---- polygons with shared edges (pixel space), into the city frame
    keep = np.zeros(nf, bool)
    for f in np.unique(full):
        if land[f] or land[roots[f]]: keep[f] = True
    k300 = 300 / dpi
    def to_city(coords):
        P = np.asarray(coords, float) * k300                     # 300-dpi sheet pixels (corner coordinates)
        M = P @ A[:, :2].T + A[:, 2]                             # affine → metres
        return M + correction(cps, M)                            # local correction field
    polys, props = [], []
    mask = keep[full]
    for geom, val in rasterio.features.shapes(full, mask=mask, connectivity=4):
        f = int(val)
        g = shape(geom)
        if g.is_empty: continue
        g = shapely.transform(g, to_city)
        if not g.is_valid: g = shapely.make_valid(g)
        polys.append(g)
        cls_i = int(major2[f])
        props.append({'face': f, 'cls': KEYS[cls_i], 'reserved': bool(red_share[f] > 0.55), 'fit': float(1 - fit[f] / RG.MAX_DE)})
    # merge pieces of the same face, then simplify the whole coverage together (edges stay shared)
    byface = {}
    for g, p in zip(polys, props): byface.setdefault(p['face'], ([], p))[0].append(g)
    geoms, attrs = [], []
    for f, (gs, p) in byface.items():
        u = shapely.union_all(gs)
        geoms.append(u); attrs.append(p)
    geoms = list(shapely.coverage_simplify(np.array(geoms, dtype=object), tolerance=0.6, simplify_boundary=False))
    feats = []
    for g, p in zip(geoms, attrs):
        if g.is_empty or g.area < 40: continue
        k = p['cls']
        if k in ('water', 'local_commercial'):
            k = 'water' if g.area > 5000 else 'local_commercial'
        feats.append({'cls': k, 'reserved': p['reserved'] and k != 'water', 'area': round(g.area), 'conf': round(0.6 * p['fit'] + 0.4 * min(1, g.area / 600), 2), 'sheet': name,
                      'geom': mapping(shapely.set_precision(g, 0.1))})
    # circled reservation codes: red rings (radius ~9-28 m on the sheet)
    markers = []
    blur = cv2.GaussianBlur(red.astype(np.uint8) * 255, (5, 5), 0)
    circ = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1, minDist=18 / px_m, param1=60, param2=22, minRadius=int(9 / px_m), maxRadius=int(28 / px_m))
    if circ is not None:
        redd = cv2.dilate(red.astype(np.uint8), np.ones((3, 3), np.uint8))
        ang = np.linspace(0, 2 * np.pi, 48, endpoint=False)
        for cx, cy, rad in circ[0]:
            xs = np.clip((cx + rad * np.cos(ang)).astype(int), 0, red.shape[1] - 1); ys = np.clip((cy + rad * np.sin(ang)).astype(int), 0, red.shape[0] - 1)
            if redd[ys, xs].mean() > 0.6:
                m = to_city(np.array([[cx + 0.5, cy + 0.5]]))[0]
                markers.append([round(float(m[0]), 1), round(float(m[1]), 1), round(float(rad * px_m), 1)])
    # sheet frame in the city (for choosing between overlapping sheets)
    fr = to_city(np.array([[0, 0], [fw, 0], [fw, H], [0, H]], float))
    out = {'sheet': name, 'dpi': dpi, 'frame': fr.round(1).tolist(), 'features': feats, 'markers': markers}
    with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as fh: json.dump(out, fh, separators=(',', ':'))
    by = {}
    for ft in feats: by[ft['cls']] = by.get(ft['cls'], 0) + 1
    print(f'{name}: {len(feats)} plots ({sum(f["reserved"] for f in feats)} reserved) in {time.time() - t0:.0f}s · ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('sheets', nargs='*')
    ap.add_argument('--dpi', type=int, default=0)
    a = ap.parse_args()
    names = a.sheets or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(align.DP, '*.reg.json')))
    for n in names:
        trace_sheet(n, a.dpi or (150 if n.startswith('S1') else 200))
