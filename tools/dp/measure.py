"""Measure DP road-reserve widths for every road, from registered DP sheets.

For each road (network segment sampled every ~4 m) and each sheet covering it:
  map the sample into the sheet, cast a perpendicular profile both ways, and walk until the first
  reserve boundary (plot line / coloured zone). Width = left + right. Median per OSM way.
Output: data/raw/dp/widths.json  { wayId: {w, n, iqr, sheets} }
"""
import json, sys, os, glob
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align

DP = align.DP
ref = align.ref
DPI = 300
MAXSIDE = 32.0  # metres each way
STEP = 0.4

def load_reg(name):
    r = json.load(open(os.path.join(DP, name + '.reg.json')))
    A = np.vstack([np.array(r['affine']), [0, 0, 1]])
    return np.linalg.inv(A), np.array(r.get('cps', [])), r

def correction(cps, p):
    if len(cps) == 0: return np.zeros_like(p)
    d2 = ((p[:, None, :] - cps[None, :, :2]) ** 2).sum(2) + 150.0 ** 2
    w = 1 / d2
    return (w @ cps[:, 2:4]) / w.sum(1, keepdims=True)

def classify(img):
    """1 = part of a road reserve, 0 = zone fill / water.

    At 1:10,000 the DP draws carriageway edges, medians and road names *inside* the reserve as dark lines,
    so lines and text are walkable; the reserve ends where a coloured zone fill (or water) begins.
    """
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    zone = (s >= 38) & (v > 110)
    road = (~zone).astype(np.uint8)
    # reject isolated coloured specks (stamps, small symbols) by requiring a 2x2 block of zone colour
    zone_solid = cv2.erode(zone.astype(np.uint8), np.ones((2, 2), np.uint8))
    road = (zone_solid == 0).astype(np.uint8)
    W = img.shape[1]
    road[:, int(W * 0.755):] = 0
    return road

EDGE_LINE = 1.0  # metres of boundary line counted inside the reserve on each side, removed again

def measure_sheet(name, samples_by_way):
    Ainv, cps, reg = load_reg(name)
    page_img = align.sheet_image(os.path.join(DP, name + '.pdf'), DPI)
    road = classify(page_img)
    del page_img
    H, W = road.shape
    mpp = reg['m_per_px300'] * 300 / DPI
    steps = np.arange(STEP, MAXSIDE, STEP)
    got = 0
    for r in ref['roads']:
        if r['cls'] in ('service', 'track', 'living_street'): continue
        p = np.array(r['pts'], float).reshape(-1, 2)
        if len(p) < 2: continue
        # samples every ~4 m (points are ~2 m apart)
        idx = np.arange(1, len(p) - 1, 2) if len(p) > 3 else np.array([len(p) // 2])
        for i in idx:
            a, b = p[max(0, i - 1)], p[min(len(p) - 1, i + 1)]
            t = b - a
            L = np.hypot(*t)
            if L < 1e-6: continue
            t /= L
            nrm = np.array([t[1], -t[0]])
            P = p[i]
            def to_px(Q):
                Q = Q - correction(cps, Q)
                u = (Ainv[0, 0] * Q[:, 0] + Ainv[0, 1] * Q[:, 1] + Ainv[0, 2]) * DPI / 300
                v = (Ainv[1, 0] * Q[:, 0] + Ainv[1, 1] * Q[:, 1] + Ainv[1, 2]) * DPI / 300
                return u, v
            # find a start inside the reserve near P (registration is ~3 m accurate)
            offs = np.array([0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4, 3.2, -3.2])
            u, v = to_px(P[None, :] + offs[:, None] * nrm[None, :])
            ui, vi = np.round(u).astype(int), np.round(v).astype(int)
            ok = (ui >= 0) & (vi >= 0) & (ui < W) & (vi < H)
            if not ok.all(): continue
            inside = road[vi, ui] == 1
            if not inside.any(): continue
            start = P + offs[np.argmax(inside)] * nrm
            sides = []
            for sg in (1, -1):
                Q = start[None, :] + (sg * steps)[:, None] * nrm[None, :]
                u, v = to_px(Q)
                ui, vi = np.round(u).astype(int), np.round(v).astype(int)
                valid = (ui >= 0) & (vi >= 0) & (ui < W) & (vi < H)
                if not valid.all(): sides.append(None); continue
                col = road[vi, ui]
                hit = np.argmax(col == 0) if (col == 0).any() else -1
                sides.append(None if hit < 0 else steps[hit])
            if sides[0] is None and sides[1] is None: continue
            # one side open (unzoned land) or wildly overshooting → mirror the shorter side
            a = sides[0] if sides[0] is not None else 1e9
            b = sides[1] if sides[1] is not None else 1e9
            lo, hi = min(a, b), max(a, b)
            w = 2 * lo if hi > 1.8 * lo + 3 else a + b
            w -= 2 * EDGE_LINE
            if 3.5 <= w <= 60:
                for wid in set(r.get('wayIds', [])) or [f"seg{r['id']}"]:
                    samples_by_way.setdefault(str(wid), []).append((w, name))
                got += 1
    print(f'  {name}: {got} width samples')

if __name__ == '__main__':
    sheets = sys.argv[1:] or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(DP, '*.reg.json')))
    samples = {}
    for s in sheets:
        measure_sheet(s, samples)
    out = {}
    for wid, ss in samples.items():
        ws = np.array([x[0] for x in ss])
        if len(ws) < 3: continue
        q1, med, q3 = np.percentile(ws, [25, 50, 75])
        out[wid] = {'w': round(float(med), 1), 'n': int(len(ws)), 'iqr': round(float(q3 - q1), 1), 'sheets': sorted(set(x[1] for x in ss))}
    json.dump(out, open(os.path.join(DP, 'widths.json'), 'w'))
    print(f'widths for {len(out)} OSM ways')
