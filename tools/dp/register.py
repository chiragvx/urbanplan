"""Local registration of a DP sheet: block-wise shifts on road corridors -> affine + smooth correction field.

Input : <sheet>.align.json (global affine 300px -> metres)
Output: <sheet>.reg.json  { affine, cps: [[x, z, dx, dz, score], ...] }
  true_metres(p) = affine(p) + idw_correction(affine(p))
"""
import json, sys, os
import numpy as np, cv2, pymupdf
sys.path.insert(0, os.path.dirname(__file__))
import align

DP = align.DP
RES = 1.5          # metres per pixel for local matching
BLOCK = 420.0      # template size (m)
SEARCH = 60.0      # +/- search (m)
STEP = 380.0       # block spacing (m)

def metre_raster(img_dpi, dpi, A300, x0, z0, size_m, res):
    """Resample the sheet image onto a metre grid [x0, x0+size) x [z0, z0+size) via the 300px->m affine."""
    n = int(size_m / res)
    xs = x0 + (np.arange(n) + 0.5) * res
    zs = z0 + (np.arange(n) + 0.5) * res
    X, Z = np.meshgrid(xs, zs)
    A = np.vstack([A300, [0, 0, 1]])
    Ai = np.linalg.inv(A)
    u = (Ai[0, 0] * X + Ai[0, 1] * Z + Ai[0, 2]) * dpi / 300
    v = (Ai[1, 0] * X + Ai[1, 1] * Z + Ai[1, 2]) * dpi / 300
    return cv2.remap(img_dpi, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderValue=0)

def ref_window(x0, z0, size_m, res):
    n = int(size_m / res)
    return align.ref_window_feature(res, x0, z0, x0 + n * res, z0 + n * res)

def register(name, iters=3):
    al = json.load(open(os.path.join(DP, name + '.align.json')))
    A = np.array(al['affine'])
    out = None
    for it in range(iters):
        out = register_once(name, al, A, it)
        A = np.array(out['affine'])
    json.dump(out, open(os.path.join(DP, name + '.reg.json'), 'w'))
    return out

def register_once(name, al, A, it):
    dpi = 150
    img = align.sheet_image(align.sheet_pdf(name), dpi)
    w, r = align.sheet_masks(img, dpi, al['m_per_px300'])
    feat = align.combine(w, r, 1.7)  # sheet px ≈ 1.7 m at 150 dpi
    # sheet coverage in metres (map frame only)
    H, W = w.shape
    frame = np.array([[0, 0], [W * 0.755, 0], [W * 0.755, H], [0, H]]) * 300 / dpi
    fm = (A[:, :2] @ frame.T).T + A[:, 2]
    xmin, zmin = np.maximum(fm.min(0), -ref_half()); xmax, zmax = np.minimum(fm.max(0), ref_half())
    cps = []
    for cz in np.arange(zmin + BLOCK / 2, zmax - BLOCK / 2 + 1, STEP):
        for cx in np.arange(xmin + BLOCK / 2, xmax - BLOCK / 2 + 1, STEP):
            x0, z0 = cx - BLOCK / 2, cz - BLOCK / 2
            tmpl = metre_raster(feat, dpi, A, x0, z0, BLOCK, RES)
            if tmpl.sum() < 1e5: continue
            region = ref_window(x0 - SEARCH, z0 - SEARCH, BLOCK + 2 * SEARCH, RES)
            if region.shape[0] <= tmpl.shape[0] or region.shape[1] <= tmpl.shape[1] or region.sum() < 1e5: continue
            res = cv2.matchTemplate(region.astype(np.float32), tmpl.astype(np.float32), cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(res)
            # peak sharpness: best vs best outside a 12 m radius
            rr = int(12 / RES)
            res2 = res.copy()
            cv2.circle(res2, loc, rr, -1, -1)
            second = res2.max()
            dx = loc[0] * RES - SEARCH
            dz = loc[1] * RES - SEARCH
            cps.append([float(cx), float(cz), float(dx), float(dz), float(mx), float(mx - second)])
    good = [c for c in cps if c[4] > 0.25 and c[5] > 0.03]
    # robust: drop shifts far from the median shift (bad matches)
    if len(good) >= 5:
        d = np.array([[c[2], c[3]] for c in good])
        med = np.median(d, axis=0)
        dev = np.sqrt(((d - med) ** 2).sum(1))
        lim = max(10.0, 2.5 * np.median(dev))
        good = [c for c, e in zip(good, dev) if e <= lim]
    print(f'  iter {it}: {len(cps)} blocks, {len(good)} confident control points')
    if len(good) >= 3:
        # least-squares affine correction:  true = M @ [x, z, 1]
        P = np.array([[c[0], c[1], 1] for c in good]); Q = np.array([[c[0] + c[2], c[1] + c[3]] for c in good])
        Wt = np.array([c[4] for c in good])
        M, *_ = np.linalg.lstsq(P * Wt[:, None], Q * Wt[:, None], rcond=None)
        M = M.T  # 2x3
        A2 = M[:, :2] @ A[:, :2]
        b2 = M[:, :2] @ A[:, 2] + M[:, 2]
        newA = np.hstack([A2, b2[:, None]])
        # residuals after affine -> local correction field
        res_cps = []
        for c in good:
            pred = M @ np.array([c[0], c[1], 1])
            res_cps.append([float(pred[0]), float(pred[1]), float(c[0] + c[2] - pred[0]), float(c[1] + c[3] - pred[1]), c[4]])
        resid = np.array([[c[2], c[3]] for c in res_cps])
        print(f'  affine correction applied; residual rms {np.sqrt((resid ** 2).sum(1).mean()):.1f} m, max {np.sqrt((resid ** 2).sum(1)).max():.1f} m')
    else:
        newA, res_cps = A, []
    return {'affine': newA.tolist(), 'cps': res_cps, 'm_per_px300': al['m_per_px300']}

def ref_half():
    return align.ref['half']

if __name__ == '__main__':
    for n in sys.argv[1:]:
        print(n)
        register(n)
