"""Render registered DP sheets into a georeferenced image underlay for the map editor.

Output: public/tiles/kp/dp/index.json + t_<i>_<j>.webp, one image per 500 m x 500 m block of the tile
(tile-local metres: x east, z south, origin = tile centre). Image row 0 = north edge (smallest z),
column 0 = west edge (smallest x). RGBA; alpha 0 where no registered sheet covers the pixel.

Transform per pixel is exactly measure.py's to_px():  Q -= correction(cps, Q);  [u, v] = Ainv[:2] @ [x, z, 1] * DPI/300

Usage: python tools/dp/tiles.py [sheet ...] [--res 0.5]
       DP_CITY=pune python tools/dp/tiles.py --out public/regions/pune/dp --res 1 --dpi 150
         (a whole city: sheet by sheet, only the blocks each covers, so one sheet is in memory at a time)
"""
import json, sys, os, glob, time, argparse
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
from measure import load_reg

DP = align.DP
HALF = float(align.ref['half'])
OUT = os.path.join(align.ROOT, 'public', 'tiles', 'kp', 'dp')
BLOCK = 500  # metres
DPI = 300
FRAME = 0.755  # map frame = left 75.5 % of the page; the legend lives to the right
QUALITY = 80
ATTRIBUTION = 'Pune Municipal Corporation — Development Plan (sanctioned), scanned sheets'


def correction_exact(cps, X, Z):
    """measure.correction() evaluated on full grids without the (N, ncps, 2) intermediate."""
    if len(cps) == 0: return np.zeros_like(X), np.zeros_like(Z)
    ws = np.zeros_like(X); cx = np.zeros_like(X); cz = np.zeros_like(X)
    for c in cps:
        w = 1.0 / ((X - c[0]) ** 2 + (Z - c[1]) ** 2 + 150.0 ** 2)
        ws += w; cx += w * c[2]; cz += w * c[3]
    return cx / ws, cz / ws


def correction_grid(cps, X, Z, n=101):
    """Same field on a regular (meshgrid) block: exact at n x n nodes, bilinear in between.

    The IDW field is smooth on a ~150 m scale, so at 5 m node spacing the interpolation error is far below 1 mm.
    """
    if len(cps) == 0: return np.zeros_like(X), np.zeros_like(Z)
    xs, zs = X[0], Z[:, 0]
    gx, gz = np.meshgrid(np.linspace(xs[0], xs[-1], n), np.linspace(zs[0], zs[-1], n))
    cx, cz = correction_exact(cps, gx, gz)
    mx = np.broadcast_to(((xs - xs[0]) / (xs[-1] - xs[0]) * (n - 1)).astype(np.float32)[None, :], X.shape)
    mz = np.broadcast_to(((zs - zs[0]) / (zs[-1] - zs[0]) * (n - 1)).astype(np.float32)[:, None], X.shape)
    mx, mz = np.ascontiguousarray(mx), np.ascontiguousarray(mz)
    f = lambda a: cv2.remap(a.astype(np.float32), mx, mz, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
    return f(cx), f(cz)


class Sheet:
    def __init__(self, name, dpi):
        self.name = name
        self.Ainv, self.cps, _ = load_reg(name)
        self.k = dpi / 300
        self.img = align.sheet_image(align.sheet_pdf(name), dpi)  # RGB
        self.H, self.W = self.img.shape[:2]
        self.fw = FRAME * self.W  # frame right edge in pixels

    def to_px(self, X, Z):
        dx, dz = correction_grid(self.cps, X, Z)
        Qx, Qz = X - dx, Z - dz
        A = self.Ainv
        u = (A[0, 0] * Qx + A[0, 1] * Qz + A[0, 2]) * self.k
        v = (A[1, 0] * Qx + A[1, 1] * Qz + A[1, 2]) * self.k
        return u, v

    def render(self, X, Z):
        """-> (rgb uint8 HxWx3, edge distance float32 in sheet px; <0 where not covered)."""
        u, v = self.to_px(X, Z)
        dist = np.minimum(np.minimum(u, self.fw - 1 - u), np.minimum(v, self.H - 1 - v)).astype(np.float32)
        if dist.max() < 0: return None, dist
        rgb = cv2.remap(self.img, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        return rgb, dist


def num(v):
    return int(v) if float(v).is_integer() else round(float(v), 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheets', nargs='*')
    ap.add_argument('--res', type=float, default=0.5, help='metres per pixel (default 0.5)')
    ap.add_argument('--dpi', type=int, default=DPI, help='sheet render DPI (default 300)')
    a = ap.parse_args()
    names = a.sheets or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(DP, '*.reg.json')))
    t0 = time.time()
    sheets = []
    for n in names:
        sheets.append(Sheet(n, a.dpi))
        print(f'  loaded {n} {sheets[-1].W}x{sheets[-1].H} @ {a.dpi} dpi  ({time.time() - t0:.1f}s)')
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, 't_*.webp')): os.remove(f)
    px = int(round(BLOCK / a.res))
    nb = int(round(2 * HALF / BLOCK))
    c = (np.arange(px) + 0.5) * a.res  # pixel centres within a block
    tiles, total = [], 0
    for j in range(nb):
        for i in range(nb):
            x0, z0 = -HALF + i * BLOCK, -HALF + j * BLOCK
            X, Z = np.meshgrid(x0 + c, z0 + c)  # row = z (north at row 0), col = x
            out = np.zeros((px, px, 4), np.uint8)
            best = np.full((px, px), -1.0, np.float32)
            for s in sheets:
                rgb, dist = s.render(X, Z)
                if rgb is None: continue
                take = (dist >= 0) & (dist > best)
                out[take, :3] = rgb[take]
                out[take, 3] = 255
                best[take] = dist[take]
            if not out[:, :, 3].any(): continue
            f = f't_{i}_{j}.webp'
            p = os.path.join(OUT, f)
            cv2.imwrite(p, cv2.cvtColor(out, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_WEBP_QUALITY, QUALITY])
            total += os.path.getsize(p)
            tiles.append({'file': f, 'x0': num(x0), 'z0': num(z0), 'size': BLOCK})
    idx = {'res': a.res, 'size': BLOCK, 'sheets': names, 'tiles': tiles, 'attribution': ATTRIBUTION}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(f'{len(tiles)} blocks, {total / 1e6:.1f} MB, {time.time() - t0:.1f}s -> {OUT}')


def sheet_box(name):
    """The world box (x0, z0, x1, z1) a sheet's map frame covers, from its affine (px at 300 dpi -> metres)."""
    _, _, r = load_reg(name)
    A = np.array(r['affine'])
    img = align.sheet_image(align.sheet_pdf(name), 20)  # a thumbnail, for the page size
    H, W = img.shape[0] * 15, img.shape[1] * 15
    pts = [A @ np.array([u, v, 1.0]) for u in (0, FRAME * W) for v in (0, H)]
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs) - 200, min(zs) - 200, max(xs) + 200, max(zs) + 200


def city_main(a, names):
    """Sheet-major: blocks are filled one sheet at a time (the deepest-inside sheet wins where they overlap)."""
    t0 = time.time()
    out_dir = os.path.join(align.ROOT, a.out)
    os.makedirs(out_dir, exist_ok=True)
    for f in glob.glob(os.path.join(out_dir, 't_*.webp')): os.remove(f)
    px = int(round(BLOCK / a.res))
    c = (np.arange(px) + 0.5) * a.res
    blocks = {}  # (i, j) -> [rgba, best]
    for n in names:
        x0, z0, x1, z1 = sheet_box(n)
        s = Sheet(n, a.dpi)
        i0, i1 = int(np.floor(x0 / BLOCK)), int(np.floor(x1 / BLOCK))
        j0, j1 = int(np.floor(z0 / BLOCK)), int(np.floor(z1 / BLOCK))
        k = 0
        for j in range(j0, j1 + 1):
            for i in range(i0, i1 + 1):
                X, Z = np.meshgrid(i * BLOCK + c, j * BLOCK + c)
                rgb, dist = s.render(X, Z)
                if rgb is None: continue
                b = blocks.get((i, j))
                if b is None:
                    b = blocks[(i, j)] = [np.zeros((px, px, 4), np.uint8), np.full((px, px), -1.0, np.float32)]
                take = (dist >= 0) & (dist > b[1])
                if not take.any(): continue
                b[0][take, :3] = rgb[take]; b[0][take, 3] = 255; b[1][take] = dist[take]
                k += 1
        print(f'  {n}: {k} blocks  ({time.time() - t0:.0f}s)', flush=True)
        del s
    tiles, total = [], 0
    for (i, j), (rgba, _) in sorted(blocks.items()):
        # paper white (the page margins, unzoned land) shows the map through
        rgba[(rgba[:, :, :3].min(axis=2) > 235), 3] = 0
        if not rgba[:, :, 3].any(): continue
        f = f't_{i}_{j}.webp'
        p = os.path.join(out_dir, f)
        cv2.imwrite(p, cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA), [cv2.IMWRITE_WEBP_QUALITY, QUALITY])
        total += os.path.getsize(p)
        tiles.append({'file': f, 'x0': num(i * BLOCK), 'z0': num(j * BLOCK), 'size': BLOCK})
    idx = {'res': a.res, 'size': BLOCK, 'sheets': names, 'tiles': tiles, 'attribution': ATTRIBUTION}
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as fh:
        json.dump(idx, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(tiles)} blocks, {total / 1e6:.1f} MB, {time.time() - t0:.0f}s -> {out_dir}')


if __name__ == '__main__':
    if '--out' in sys.argv:
        ap = argparse.ArgumentParser()
        ap.add_argument('sheets', nargs='*')
        ap.add_argument('--out', required=True)
        ap.add_argument('--res', type=float, default=1.0)
        ap.add_argument('--dpi', type=int, default=150)
        a = ap.parse_args()
        city_main(a, a.sheets or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(DP, '*.reg.json'))))
    else:
        main()
