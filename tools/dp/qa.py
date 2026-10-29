"""Registration quality per DP sheet: how well OSM's roads land on the sheet's road corridors, plus an overlay image.

  agreement = share of OSM major-road samples (inside the sheet's map frame) that fall on a white road corridor of
              the sheet within `tol` metres, through the sheet's registration (reg.json, else align.json)
Writes data/raw/cities/<city>/dp/qa/<sheet>.png and qa/report.json; prints a table.

Usage: DP_CITY=pune python tools/dp/qa.py [sheet ...]
"""
import json, sys, os, glob
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
from measure import correction

QA = os.path.join(align.DP, 'qa')
os.makedirs(QA, exist_ok=True)
MAJOR = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary'}


def load(name):
    p = os.path.join(align.DP, name + '.reg.json')
    reg = os.path.exists(p)
    j = json.load(open(p if reg else os.path.join(align.DP, name + '.align.json')))
    A = np.vstack([np.array(j['affine']), [0, 0, 1]])
    return np.linalg.inv(A), np.array(j.get('cps', [])), j, reg


def check(name, dpi=60, tol=4.0):
    Ainv, cps, j, reg = load(name)
    img = align.sheet_image(align.sheet_pdf(name), dpi)
    H, W = img.shape[:2]
    fw = int(W * 0.755)
    w, r = align.sheet_masks(img, dpi, j['m_per_px300'])
    m_px = j['m_per_px300'] * 300 / dpi
    near = cv2.dilate(r, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(tol / m_px) + 1,) * 2)) > 0
    # only where the plan is drawn (zoned land within 40 m): the white land outside the limits has no corridors
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    coloured = ((hsv[:, :, 1] >= 45) & (hsv[:, :, 2] > 120)).astype(np.uint8)
    zoned = cv2.dilate(coloured, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * int(40 / m_px) + 1,) * 2)) > 0
    k = dpi / 300
    def px(P, shift=(0.0, 0.0)):
        P = P - correction(cps, P) + np.array(shift)
        return (np.column_stack([P, np.ones(len(P))]) @ Ainv[:2].T) * k
    def agreement(shift):
        hits = total = 0
        for rd in align.ref['roads']:
            if rd['cls'] not in MAJOR: continue
            q = px(np.array(rd['pts'], float).reshape(-1, 2), shift)
            for a, b in zip(q[:-1], q[1:]):
                n = max(1, int(np.hypot(*(b - a)) * m_px / 10))
                for t in np.linspace(0, 1, n, endpoint=False):
                    x, y = a + (b - a) * t
                    if 2 <= x < fw - 2 and 2 <= y < H - 2 and zoned[int(y), int(x)]:
                        total += 1; hits += near[int(y), int(x)]
        return hits / total if total else 0.0, total
    hits = total = 0
    over = img.copy()
    for rd in align.ref['roads']:
        if rd['cls'] not in MAJOR: continue
        P = np.array(rd['pts'], float).reshape(-1, 2)
        q = px(P)
        inside = (q[:, 0] >= 2) & (q[:, 0] < fw - 2) & (q[:, 1] >= 2) & (q[:, 1] < H - 2)
        if inside.sum() < 2: continue
        cv2.polylines(over, [q.astype(np.int32)], False, (220, 0, 0), 1)
        # sample every ~10 m along the line
        for a, b in zip(q[:-1], q[1:]):
            if not (inside.any()): continue
            n = max(1, int(np.hypot(*(b - a)) * m_px / 10))
            for t in np.linspace(0, 1, n, endpoint=False):
                x, y = a + (b - a) * t
                if 2 <= x < fw - 2 and 2 <= y < H - 2 and zoned[int(y), int(x)]:
                    total += 1
                    hits += near[int(y), int(x)]
    cv2.imwrite(os.path.join(QA, name + '.png'), cv2.cvtColor(over[:, :fw], cv2.COLOR_RGB2BGR))
    agree = hits / total if total else 0.0
    # baseline: the same with the sheet 20 m off in each direction; a good registration stands well above it
    base = np.mean([agreement(s)[0] for s in ((20, 0), (-20, 0), (0, 20), (0, -20))])
    lift = agree / base if base > 0 else 0.0
    rms = float(np.sqrt((np.array([[c[2], c[3]] for c in cps]) ** 2).sum(1).mean())) if len(cps) else None
    return {'sheet': name, 'registered': reg, 'scale': round(j['m_per_px300'], 4), 'agreement': round(agree, 3), 'baseline': round(float(base), 3), 'lift': round(float(lift), 2), 'samples': total, 'cps': len(cps), 'cp_rms': rms, 'score': j.get('score')}


if __name__ == '__main__':
    names = sys.argv[1:] or sorted(os.path.basename(p)[:-11] for p in glob.glob(os.path.join(align.DP, '*.align.json')))
    rows = []
    for n in names:
        r = check(n)
        rows.append(r)
        reg = f"registered, {r['cps']} control blocks" if r['registered'] else 'aligned only'
        res = '' if r['cp_rms'] is None else f", residual {r['cp_rms']:.1f} m"
        print(f"{n}: agreement {r['agreement'] * 100:5.1f} % (20 m off: {r['baseline'] * 100:4.1f} %, ×{r['lift']}) of {r['samples']} OSM samples · scale {r['scale']} · {reg}{res}", flush=True)
    json.dump(rows, open(os.path.join(QA, 'report.json'), 'w'), indent=1)
