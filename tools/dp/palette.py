"""Per-sheet palette: the land-use colours as each sheet actually prints them.

The legend sheet's swatches are the reference, but the sheets print paler / shifted (agriculture is (153,222,203) on
the legend and ~(188,229,225) on S2-03), so a fixed table misreads them. Per sheet:

  1. clean fill pixels: flat neighbourhoods (low local spread) that aren't paper white or ink
  2. colour modes: peaks of a coarse CIELAB histogram of those pixels, refined by mean shift
  3. each mode → the legend class it is nearest to in hue / chroma / lightness (weighted ΔE, hue counts most since
     the sheets wash colours out but keep their hue), if close enough; several modes may share a class (e.g. a
     colour with and without a hatch)

Usage: DP_CITY=pune python tools/dp/palette.py [sheet ...]   (prints the modes and their classes)
"""
import sys, os, json, glob
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
import regions as RG

LEG = RG.to_lab(np.array([RG.CLASSES[k][1] for k in RG.KEYS], np.uint8))


def clean_pixels(img, rad=2, spread=6.0):
    """Lab of pixels in flat, coloured neighbourhoods (fill, not ink / hatch / text / paper)."""
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
    k = 2 * rad + 1
    m = cv2.blur(lab, (k, k)); m2 = cv2.blur(lab * lab, (k, k))
    sd = np.sqrt(np.maximum(0, m2 - m * m)).mean(2)
    a, b = lab[..., 1] - 128, lab[..., 2] - 128
    C = np.hypot(a, b)
    # coloured fills, plus flat mid greys (transport: rail, bus depots, metro) — paper and ink are neither
    ok = (sd < spread) & (((lab[..., 0] > 120) & (C > 6)) | ((lab[..., 0] > 150) & (lab[..., 0] < 215)))
    return lab[ok], ok


def modes(px, bin=4.0, min_share=0.0004):
    """Colour modes of Lab pixels: histogram peaks, mean-shifted."""
    q = np.floor(px / bin).astype(np.int32)
    keys, inv, cnt = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    order = np.argsort(-cnt)
    centres = []
    n = len(px)
    for i in order:
        if cnt[i] < min_share * n * 0.25: break
        c = (keys[i] + 0.5) * bin
        if any(np.linalg.norm(c - d) < 8 for d, _ in centres): continue
        for _ in range(6):   # mean shift, radius 7
            sel = px[np.linalg.norm(px - c, axis=1) < 7] if n < 400000 else px[np.abs(px - c).max(1) < 7]
            if len(sel) == 0: break
            c = sel.mean(0)
        if any(np.linalg.norm(c - d) < 8 for d, _ in centres): continue
        share = (np.linalg.norm(px - c, axis=1) < 8).mean()
        if share >= min_share: centres.append((c, share))
        if len(centres) > 40: break
    return centres


def hue_dist(c, ref):
    """Weighted distance between Lab colours: hue counts most, lightness least (sheets print paler)."""
    a1, b1, a2, b2 = c[..., 1] - 128, c[..., 2] - 128, ref[..., 1] - 128, ref[..., 2] - 128
    C1, C2 = np.hypot(a1, b1), np.hypot(a2, b2)
    dh = np.sqrt(np.maximum(0, (a1 - a2) ** 2 + (b1 - b2) ** 2 - (C1 - C2) ** 2))   # ΔH
    return np.sqrt((0.5 * (c[..., 0] - ref[..., 0])) ** 2 + (0.6 * (C1 - C2)) ** 2 + (1.6 * dh) ** 2)


LEG_RGB = np.array([RG.CLASSES[k][1] for k in RG.KEYS], np.float32)
# legend colours that aren't land uses of their own but stand for one: the congested area (gaothan) is residential
EXTRA = [((255, 235, 36), 'residential')]
# what a fill gets mixed with on a sheet: paper (printed paler), building hatch (grey) and ink
MIX = {'paper': np.array([255, 255, 255], np.float32), 'hatch': np.array([150, 150, 150], np.float32), 'ink': np.array([70, 70, 70], np.float32)}
PENALTY = {'paper': 10.0, 'hatch': 10.0, 'ink': 14.0}   # per unit of (1 − α): a pure legend colour is preferred
# classes a sheet series doesn't use (its hatched colours look like them): Sector I has no business hub
SKIP = {'S1': {'business_hub'}, 'S2': set()}


def to_lab3(rgb):
    return cv2.cvtColor(np.clip(np.asarray(rgb, np.float32), 0, 255).astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)


def assign(lab, sheet=''):
    """A colour mode (Lab) → (class index, distance, how): the legend colour it's an unmixed version of."""
    m = cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8).reshape(1, 1, 3), cv2.COLOR_LAB2RGB).reshape(3).astype(np.float32)
    skip = SKIP.get(sheet[:2], set())
    best = (None, 1e9, '')
    for i, c in [(i, LEG_RGB[i]) for i, k in enumerate(RG.KEYS) if k not in skip] + [(RG.KEYS.index(k), np.array(c, np.float32)) for c, k in EXTRA]:
        for how, g in MIX.items():
            v = c - g
            al = float(np.clip(np.dot(m - g, v) / max(1e-6, np.dot(v, v)), 0.3 if how != 'paper' else 0.55, 1.0))
            rec = g + al * v
            d = float(hue_dist(to_lab3(m), to_lab3(rec))[0]) + PENALTY[how] * (1 - al)
            if d < best[1]: best = (i, d, f'{how} {al:.2f}')
    return best


def palette(img, sheet, max_d=14.0):
    """→ [(Lab centre, class index, share)] for a sheet image (map frame). Big modes may be mixed versions of a legend
    colour; small ones (a few plots' worth) must match a legend colour closely."""
    px, _ = clean_pixels(img)
    out = []
    for c, s in modes(px):
        i, d, how = assign(c, sheet)
        # near-white tints and greys (paper with a cast, hatch on paper) aren't land uses — except transport's grey
        chroma = float(np.hypot(c[1] - 128, c[2] - 128))
        if i is not None and chroma < 10 and RG.KEYS[i] != 'transport': continue
        if i is not None and d <= (max_d if s >= 0.003 else 5.0): out.append((c, i, s, d, how))
    return out


PAPER = 254


def classify(img, pal, max_de=float(os.environ.get("DP_MAXDE", 24))):
    """Pixels → class index by the nearest palette mode (PAPER = paper, 255 = ink / no colour), and the distance to it."""
    H, W = img.shape[:2]
    # paper and ink compete as colours of their own (class 255): a pale fill only counts where it's nearer its zone
    # colour than the paper — one threshold can't separate water / C-1 / defence from white
    lab0 = cv2.cvtColor(img[::8, ::8], cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    ch = np.hypot(lab0[:, 1] - 128, lab0[:, 2] - 128)
    white = lab0[(lab0[:, 0] > 225) & (ch < 5)]
    paper = np.median(white, 0) if len(white) > 100 else np.array([255, 128, 128], np.float32)
    C = np.array([c for c, *_ in pal] + [paper, [60, 128, 128], [120, 128, 128]], np.float32)
    K = np.array([i for _, i, *_ in pal] + [PAPER, 255, 255], np.uint8)
    cls = np.full((H, W), 255, np.uint8)
    dist = np.full((H, W), 99, np.float32)
    cc = (C * C).sum(1)
    for j0 in range(0, H, 200):
        lab = cv2.cvtColor(img[j0:j0 + 200], cv2.COLOR_RGB2LAB).astype(np.float32).reshape(-1, 3)
        d2 = (lab * lab).sum(1)[:, None] - 2 * lab @ C.T + cc[None]     # squared distance to every mode
        k = d2.argmin(1); dk = np.sqrt(np.maximum(0, d2[np.arange(len(k)), k]))
        h = len(k) // W
        cls[j0:j0 + h] = np.where(dk <= max_de, K[k], 255).reshape(h, W)
        dist[j0:j0 + h] = dk.reshape(h, W)
    return cls, dist


def sheet_palette(name, frame=0.755):
    img = align.sheet_image(align.sheet_pdf(name), 50)
    return palette(img[:, :int(img.shape[1] * frame)], name)


if __name__ == '__main__':
    names = sys.argv[1:] or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(align.DP, '*.reg.json')))
    for n in names:
        img = align.sheet_image(align.sheet_pdf(n), 50)
        img = img[:, :int(img.shape[1] * 0.755)]
        px, _ = clean_pixels(img)
        ms = modes(px)
        print(f'== {n}: {len(px)} clean px')
        for c, s in sorted(ms, key=lambda t: -t[1]):
            j, d, how = assign(c, n)
            rgb = cv2.cvtColor(np.clip(c, 0, 255).astype(np.uint8).reshape(1, 1, 3), cv2.COLOR_LAB2RGB).ravel().tolist()
            print(f'   {s * 100:5.1f}%  rgb{rgb}  → {RG.KEYS[j]:16} d={d:5.1f}  {how}' + ('' if d <= 14 else '   (dropped)'))
