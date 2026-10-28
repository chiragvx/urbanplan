"""Register a scanned DP sheet onto the tile's local metre grid.

Model: for a sheet pixel (u, v) at 300 dpi,  [x, z] = s * Rot(rot) * [u, v] + [tx, tz]   (metres, z south)

Coarse-to-fine search. At each level and for each (scale, rotation) candidate, the sheet's features are
warped into a reference raster and the translation is found with normalised cross-correlation
(cv2.matchTemplate) inside a window around the previous estimate.

Features:
  river  = pale-blue fill on the sheet  vs  our water polygons
  roads  = white corridors *between* coloured zones (so unzoned white land doesn't count)  vs  our roads
Writes data/raw/dp/<sheet>.align.json
"""
import json, sys, os, math
import numpy as np, cv2, pymupdf

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DP = os.path.join(ROOT, 'data', 'raw', 'dp')
ref = json.load(open(os.path.join(DP, 'ref.json'), encoding='utf-8'))
EXT = 7000.0
_cache = {}

def ref_feature(R):
    if R in _cache: return _cache[R]
    n = int(2 * EXT / R)
    water = np.zeros((n, n), np.uint8)
    for poly in ref['water']:
        rings = [np.array([[(r[i] + EXT) / R, (r[i + 1] + EXT) / R] for i in range(0, len(r), 2)], np.int32) for r in poly]
        cv2.fillPoly(water, [rings[0]], 255)
        for h in rings[1:]: cv2.fillPoly(water, [h], 0)
    roads = np.zeros((n, n), np.uint8)
    for r in ref['roads']:
        if r['cls'] in ('service', 'track'): continue
        p = ((np.array(r['pts'], np.float32).reshape(-1, 2) + EXT) / R).astype(np.int32)
        cv2.polylines(roads, [p], False, 255, max(1, int(round(2 * r['hw'] / R))))
    f = combine(water, roads, R)
    _cache[R] = f
    return f

def combine(water, roads, R):
    blur = max(1.0, 6.0 / R)
    w = cv2.GaussianBlur(water, (0, 0), blur).astype(np.float32)
    r = cv2.GaussianBlur(roads, (0, 0), blur).astype(np.float32)
    return w * 1.0 + r * 0.8

def sheet_image(path, dpi):
    page = pymupdf.open(path)[0]
    pm = page.get_pixmap(dpi=dpi)
    return np.frombuffer(pm.samples, np.uint8).reshape(pm.h, pm.w, pm.n)[:, :, :3].copy()

def sheet_masks(img, dpi, s300):
    """river + road-corridor masks in sheet pixels at `dpi`."""
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    W = img.shape[1]
    water = ((h >= 95) & (h <= 115) & (s >= 15) & (s <= 75) & (v >= 215)).astype(np.uint8) * 255
    water = cv2.morphologyEx(water, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    white = ((s < 20) & (v > 232)).astype(np.uint8)
    coloured = ((s >= 45) & (v > 120) & ~((h >= 95) & (h <= 115) & (s <= 75))).astype(np.uint8)
    # corridor: white pixels with coloured zone within ~14 m
    m_per_px = s300 * 300 / dpi
    rad = max(1, int(14 / m_per_px))
    near = cv2.dilate(coloured, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rad + 1, 2 * rad + 1)))
    roads = (white & near).astype(np.uint8) * 255
    for m in (water, roads): m[:, int(W * 0.755):] = 0  # legend block
    return water, roads

def search(sheet_w, sheet_r, dpi, R, scales, rots, prev=None, window_m=None):
    """Returns best (score, s300, rot, A300(2x3 metres-from-300px))."""
    reff = ref_feature(R)
    best = None
    for s300 in scales:
        for rot in rots:
            k = s300 * (300 / dpi) / R  # sheet(dpi) px -> ref px
            c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            M0 = np.array([[k * c, -k * sn], [k * sn, k * c]])
            h, w = sheet_w.shape
            corners = M0 @ np.array([[0, w, w, 0], [0, 0, h, h]], float)
            T0 = -corners.min(axis=1)
            size = (int(corners[0].max() + T0[0]) + 2, int(corners[1].max() + T0[1]) + 2)
            Mw = np.hstack([M0, T0[:, None]])
            tw = cv2.warpAffine(sheet_w, Mw, size, flags=cv2.INTER_AREA)
            tr = cv2.warpAffine(sheet_r, Mw, size, flags=cv2.INTER_AREA)
            tmpl = combine(tw, tr, R)
            if tmpl.sum() < 1: continue
            if prev is not None:
                origin = (np.array(prev[:, 2]) + EXT) / R  # sheet origin in ref px
                pred = origin - T0
                win = window_m / R
                x0 = int(pred[0] - win); y0 = int(pred[1] - win)
                x1 = int(pred[0] + win + size[0]); y1 = int(pred[1] + win + size[1])
                # pad with empty space where the window leaves the reference raster
                cx0, cy0 = max(0, x0), max(0, y0)
                cx1, cy1 = min(reff.shape[1], x1), min(reff.shape[0], y1)
                if cx1 <= cx0 or cy1 <= cy0: continue
                region = cv2.copyMakeBorder(reff[cy0:cy1, cx0:cx1], cy0 - y0, y1 - cy1, cx0 - x0, x1 - cx1, cv2.BORDER_CONSTANT, value=0)
            else:
                x0 = y0 = 0
                region = reff
            if region.shape[0] <= tmpl.shape[0] or region.shape[1] <= tmpl.shape[1]: continue
            res = cv2.matchTemplate(region, tmpl, cv2.TM_CCORR_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(res)
            if best is None or mx > best[0]:
                # metres from dpi px: m = R*(M0 [u v] + T0 + loc + off) - EXT ; then 300px = dpi px * (dpi/300)
                A = R * M0 * (dpi / 300)
                b = R * (T0 + np.array([loc[0] + x0, loc[1] + y0])) - EXT
                best = (mx, s300, rot, np.hstack([A, b[:, None]]))
    return best

def align(name, fixed_scale=None):
    path = os.path.join(DP, name + '.pdf')
    # level 0: river+roads, wide search (scale fixed when the sheet series' scale is already known)
    img = sheet_image(path, 40)
    w, r = sheet_masks(img, 40, fixed_scale or 0.84)
    scales = [fixed_scale] if fixed_scale else np.arange(0.74, 1.00, 0.02)
    b = search(w, r, 40, 10.0, scales, [-1, -0.5, 0, 0.5, 1] if fixed_scale else [-2, -1, 0, 1, 2])
    print(f'  L0 score {b[0]:.3f} s={b[1]:.3f} rot={b[2]}')
    for dpi, R, ds, dr, win in ((60, 5.0, 0.008, 0.5, 120), (100, 3.0, 0.003, 0.2, 40), (150, 2.0, 0.0012, 0.1, 16)):
        img = sheet_image(path, dpi)
        w, r = sheet_masks(img, dpi, b[1])
        scales = b[1] + ds * np.arange(-4, 5) * (0.25 if fixed_scale else 1)
        rots = b[2] + dr * np.arange(-3, 4)
        nb = search(w, r, dpi, R, scales, rots, prev=b[3], window_m=win)
        if nb is not None: b = nb
        print(f'  R={R} score {b[0]:.3f} s={b[1]:.4f} rot={b[2]:.2f}')
    out = {'score': float(b[0]), 'm_per_px300': float(b[1]), 'rot': float(b[2]), 'affine': b[3].tolist()}
    json.dump(out, open(os.path.join(DP, name + '.align.json'), 'w'))
    return out

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--scale=')]
    fs = next((float(a.split('=')[1]) for a in sys.argv[1:] if a.startswith('--scale=')), None)
    for name in args:
        print(name)
        align(name, fs)
