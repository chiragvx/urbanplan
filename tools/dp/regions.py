"""DP regions: land-use plots (and public-purpose reservations) extracted from the registered DP sheets as polygons.

The sheets colour every plot by land use and bound sites reserved for public purposes with a red verge; black plot
lines and labels separate the fills. So:

  1. mosaic the registered sheets onto the tile's metre grid (the same transform as tiles.py / measure.py)
  2. calibrate the legend colours on the sheets themselves (scans drift), classify pixels by nearest colour (CIELAB)
  3. each connected patch of one class = a region; small holes (labels, symbols) are filled
  4. outline -> simplified polygon in tile metres; a red verge around it = a reservation
  5. confidence from colour fit, fill and size

Output: public/tiles/kp/dp/regions.json  { res, sheets, classes, regions: [{id, cls, area, ring, holes, reserved, conf, sheet}] }
Polygons are from scanned paper maps registered to ~2-3 m: survey aids, not legal plot boundaries.

Usage: python tools/dp/regions.py [sheet ...] [--res 1.0] [--debug out.png]
"""
import json, sys, os, glob, time, argparse, hashlib
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(__file__))
import align
import tiles

DP = align.DP
HALF = float(align.ref['half'])
OUT = os.path.join(align.ROOT, 'public', 'tiles', 'kp', 'dp', 'regions.json')

# legend colours (sampled from Legend.pdf) -> calibrated per run on the sheets
CLASSES = {
    'residential': ('Residential', (255, 250, 141)),
    'ews': ('Housing for the economically weaker section / slum improvement', (255, 222, 91)),
    'commercial': ('Commercial', (135, 201, 247)),
    'local_commercial': ('Local commercial district (C-1)', (207, 224, 251)),
    'business_hub': ('Business hub', (165, 200, 223)),
    'industrial': ('Industrial', (197, 159, 216)),
    'psp': ('Public / semi-public', (253, 200, 205)),
    'recreational': ('Recreational (gardens, playgrounds)', (125, 214, 91)),
    'services': ('Public utilities and services', (220, 185, 152)),
    'transport': ('Traffic and transportation', (174, 165, 164)),
    'defence': ('Defence', (253, 229, 201)),
    'agriculture': ('Agriculture', (152, 222, 203)),
    'forest': ('Forest', (87, 176, 149)),
    'hill_slope': ('Hill top / hill slope', (152, 165, 102)),
    'water': ('Water body', (222, 241, 254)),
}
KEYS = list(CLASSES)
MAX_DE = 17.0       # colour distance (CIELAB) for a pixel to count as a class
MIN_AREA = 150.0    # m², smaller patches are labels / symbols / noise
HOLE_FILL = 1000.0  # m², holes smaller than this (labels, codes, building outlines inside a plot) are filled
CLOSE = 3           # px: thin lines inside one land use (plot lines, building outlines) are bridged
# classes whose sheet colours are too close to tell apart pixel by pixel: one mask, decided per region
MERGED = {'water': ('water', 'local_commercial')}
SIMPLIFY = 0.8      # metres


def to_lab(rgb):
    return cv2.cvtColor(rgb.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)


def mosaic(names, res):
    sheets = [tiles.Sheet(n, 300) for n in names]
    n = int(round(2 * HALF / res))
    c = -HALF + (np.arange(n) + 0.5) * res
    out = np.zeros((n, n, 3), np.uint8)
    best = np.full((n, n), -1.0, np.float32)
    who = np.full((n, n), 255, np.uint8)
    B = 1000
    for j0 in range(0, n, B):
        for i0 in range(0, n, B):
            X, Z = np.meshgrid(c[i0:i0 + B], c[j0:j0 + B])
            sl = (slice(j0, j0 + B), slice(i0, i0 + B))
            for k, s in enumerate(sheets):
                rgb, dist = s.render(X, Z)
                if rgb is None: continue
                take = (dist >= 0) & (dist > best[sl])
                out[sl][take] = rgb[take]; best[sl][take] = dist[take]; who[sl][take] = k
    return out, who


def calibrate(img, who):
    """Legend seeds -> the mean sheet colour near each seed (scans and printing shift the colours)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    sel = (who < 255) & (hsv[:, :, 1] > 18) & (hsv[:, :, 2] > 110)
    px = img[sel]
    rng = np.random.default_rng(0)
    px = px[rng.choice(len(px), min(len(px), 400000), replace=False)]
    lab = to_lab(px)
    seeds = to_lab(np.array([CLASSES[k][1] for k in KEYS], np.uint8))
    cen = seeds.copy()
    for _ in range(4):
        d = ((lab[:, None, :] - cen[None, :, :]) ** 2).sum(2)
        near = d.argmin(1)
        for i in range(len(KEYS)):
            m = (near == i) & (d[np.arange(len(lab)), i] < 15 ** 2)
            if m.sum() > 200:
                # move toward the sheet's colour but not past it: keep half the seed so neighbours don't swap
                cen[i] = 0.5 * seeds[i] + 0.5 * lab[m].mean(0)
    return cen


def classify(img, who, cen):
    """-> class index per pixel (255 = none), colour distance."""
    H, W = img.shape[:2]
    cls = np.full((H, W), 255, np.uint8)
    dist = np.full((H, W), 99, np.float32)
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    for j0 in range(0, H, 500):
        sl = slice(j0, j0 + 500)
        lab = to_lab(img[sl]).reshape(-1, 1, 3)
        d = np.sqrt(((lab - cen[None, :, :]) ** 2).sum(2))
        k = d.argmin(1)
        dk = d[np.arange(len(k)), k]
        s, v = hsv[sl, :, 1].ravel(), hsv[sl, :, 2].ravel()
        ok = (dk < MAX_DE) & (s > 18) & (v > 110) & (who[sl].ravel() < 255)
        cls[sl] = np.where(ok, k, 255).reshape(-1, W)
        dist[sl] = dk.reshape(-1, W)
    return cls, dist


def red_mask(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    return (((h <= 8) | (h >= 165)) & (s > 70) & (v > 140)).astype(np.uint8)


def water_mask(n, res):
    m = np.zeros((n, n), np.uint8)
    for poly in align.ref['water']:
        rings = [np.array([[(r[i] + HALF) / res, (r[i + 1] + HALF) / res] for i in range(0, len(r), 2)], np.int32) for r in poly]
        cv2.fillPoly(m, [rings[0]], 1)
        for h in rings[1:]: cv2.fillPoly(m, [h], 0)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheets', nargs='*')
    ap.add_argument('--res', type=float, default=1.0)
    ap.add_argument('--debug', default='')
    a = ap.parse_args()
    names = a.sheets or sorted(os.path.basename(p)[:-9] for p in glob.glob(os.path.join(DP, '*.reg.json')))
    t0 = time.time()
    res = a.res
    img, who = mosaic(names, res)
    print(f'mosaic {img.shape[1]}x{img.shape[0]} @ {res} m  ({time.time() - t0:.1f}s)')
    cen = calibrate(img, who)
    cls, dist = classify(img, who, cen)
    print(f'classified ({time.time() - t0:.1f}s): ' + ', '.join(f'{k} {(cls == i).mean() * 100:.1f}%' for i, k in enumerate(KEYS) if (cls == i).any()))
    red = red_mask(img)
    wat = water_mask(img.shape[0], res)
    px_area = res * res
    regions = []
    markers = []  # circled reservation codes: (x, z, radius)
    debug = np.full_like(img, 255) if a.debug else None
    red_d = cv2.dilate(red, np.ones((2, 2), np.uint8))
    absorbed = {k for ks in MERGED.values() for k in ks[1:]}
    for ci, key in enumerate(KEYS):
        if key in absorbed: continue
        m = np.isin(cls, [KEYS.index(k) for k in MERGED.get(key, (key,))]).astype(np.uint8)
        if not m.any(): continue
        # a 1-px opening drops stray pixels on lines; a small closing bridges thin black lines inside the same
        # land use, but never across a red verge (that's where a reservation begins)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        m = m | (cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE, CLOSE))) & (1 - red_d))
        ncomp, lab, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
        for c in range(1, ncomp):
            area_px = stats[c, cv2.CC_STAT_AREA]
            if area_px * px_area < MIN_AREA: continue
            x, y, w, h = stats[c, :4]
            pad = 3
            x0, y0 = max(0, x - pad), max(0, y - pad)
            x1, y1 = min(m.shape[1], x + w + pad), min(m.shape[0], y + h + pad)
            sub = (lab[y0:y1, x0:x1] == c).astype(np.uint8)
            cs, hier = cv2.findContours(sub, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            if not cs: continue
            hier = hier[0]
            outer = max((i for i in range(len(cs)) if hier[i][3] < 0), key=lambda i: cv2.contourArea(cs[i]))
            holes = [i for i in range(len(cs)) if hier[i][3] == outer and cv2.contourArea(cs[i]) * px_area >= HOLE_FILL]
            filled = np.zeros_like(sub)
            cv2.drawContours(filled, cs, outer, 1, -1)
            for hi in holes: cv2.drawContours(filled, cs, hi, 0, -1)
            # smooth the staircase / anti-aliased edge a little, then trace again
            filled = (cv2.GaussianBlur(filled.astype(np.float32), (5, 5), 0) > 0.5).astype(np.uint8)
            cs2, hier2 = cv2.findContours(filled, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
            if not cs2: continue
            hier2 = hier2[0]
            o2 = max((i for i in range(len(cs2)) if hier2[i][3] < 0), key=lambda i: cv2.contourArea(cs2[i]))
            holes2 = [i for i in range(len(cs2)) if hier2[i][3] == o2 and cv2.contourArea(cs2[i]) * px_area >= HOLE_FILL]
            area = float(filled.sum()) * px_area
            if area < MIN_AREA: continue
            # how much of the outline is drawn in red (the reservation verge), just outside the fill
            ring = cv2.dilate(filled, np.ones((5, 5), np.uint8)) - filled
            rr = red[y0:y1, x0:x1][ring > 0]
            reserved = bool(rr.size and rr.mean() > 0.3) and key != 'water'
            # the circled code of a reservation (e.g. "SW 9") encloses a small round patch: a marker, not a region
            oa = cv2.contourArea(cs2[o2]) * px_area
            per = cv2.arcLength(cs2[o2], True) * res
            round_ = per > 0 and 4 * np.pi * oa / per ** 2 > 0.6
            if round_ and ((rr.size and rr.mean() > 0.3 and oa < 5000) or (key == 'water' and oa < 5000)):
                M = cv2.moments(cs2[o2])
                if M['m00']: markers.append(((M['m10'] / M['m00'] + x0 + 0.5) * res - HALF, (M['m01'] / M['m00'] + y0 + 0.5) * res - HALF, oa ** 0.5 / 1.77))
                continue
            # grey fragments outside the plan (cantonment building hatching) look like transport land
            if key == 'transport' and area < 600 and not reserved: continue
            k = key
            if key in ('water', 'local_commercial'):
                # pale blue is both the river and C-1 commercial: OSM water decides
                inw = wat[y0:y1, x0:x1][filled > 0].mean()
                k = 'water' if inw > 0.3 else 'local_commercial'
            # confidence: colour fit, how solid the patch is before filling labels, size
            fit = float(np.clip(1 - dist[y0:y1, x0:x1][sub > 0].mean() / MAX_DE, 0, 1))
            solid = float(area_px * px_area / area)
            conf = round(fit * 0.5 + min(1.0, solid) * 0.3 + min(1.0, area / 600) * 0.2, 2)
            def pts(cnt):
                ap_ = cv2.approxPolyDP(cnt, SIMPLIFY / res, True).reshape(-1, 2)
                if len(ap_) < 3: return None
                return [round(v, 1) for p in ap_ for v in ((p[0] + x0 + 0.5) * res - HALF, (p[1] + y0 + 0.5) * res - HALF)]
            P = pts(cs2[o2])
            if not P: continue
            H_ = [q for q in (pts(cs2[hi]) for hi in holes2) if q]
            sheet = names[int(np.bincount(who[y0:y1, x0:x1][filled > 0], minlength=256)[:len(names)].argmax())]
            cx, cz = round(sum(P[0::2]) / (len(P) // 2)), round(sum(P[1::2]) / (len(P) // 2))
            rid = 'dp-' + hashlib.sha1(f'{sheet}:{k}:{cx}:{cz}:{round(area, -1)}'.encode()).hexdigest()[:10]
            regions.append({'id': rid, 'box': [min(P[0::2]), min(P[1::2]), max(P[0::2]), max(P[1::2])], 'cls': k, 'area': round(area), 'ring': P, **({'holes': H_} if H_ else {}), 'reserved': reserved, 'conf': conf, 'sheet': sheet})
            if debug is not None:
                col = CLASSES[k][1]
                sub_dbg = debug[y0:y1, x0:x1]
                sub_dbg[filled > 0] = col
                if reserved: sub_dbg[ring > 0] = (220, 30, 30)
    # circled reservation codes, found directly as red circles (radius ~10-28 m on the 1:10,000 sheets)
    blur = cv2.GaussianBlur(red * 255, (5, 5), 0)
    circ = cv2.HoughCircles(blur, cv2.HOUGH_GRADIENT, dp=1, minDist=18 / res, param1=60, param2=22, minRadius=int(9 / res), maxRadius=int(28 / res))
    if circ is not None:
        for cx, cy, rad in circ[0]:
            # a real marker: red ink along most of the circle
            ang = np.linspace(0, 2 * np.pi, 48, endpoint=False)
            xs = np.clip((cx + rad * np.cos(ang)).astype(int), 0, red.shape[1] - 1); ys = np.clip((cy + rad * np.sin(ang)).astype(int), 0, red.shape[0] - 1)
            on = cv2.dilate(red, np.ones((3, 3), np.uint8))[ys, xs].mean()
            if on > 0.6: markers.append((float((cx + 0.5) * res - HALF), float((cy + 0.5) * res - HALF), float(rad * res)))
    # merge duplicates
    mk = []
    for m_ in markers:
        if all(np.hypot(m_[0] - q[0], m_[1] - q[1]) > 12 for q in mk): mk.append(m_)
    markers = mk
    # each code marker belongs to the site it sits on or next to (the code itself is read in the editor); a circled
    # code is a reservation even where the red verge wasn't picked up
    res_regions = [r for r in regions if r['reserved']]
    def gap(r, x, z):
        P = r['ring']
        return min(np.hypot(P[i] - x, P[i + 1] - z) for i in range(0, len(P), 2))
    def inside(r, x, z):
        P = np.array(r['ring'], np.float32).reshape(-1, 1, 2)
        return cv2.pointPolygonTest(P, (float(x), float(z)), False) >= 0
    for x, z, rad in markers:
        hit = [r for r in regions if r['cls'] != 'water' and r['box'][0] <= x <= r['box'][2] and r['box'][1] <= z <= r['box'][3] and inside(r, x, z)]
        if hit:
            r = min(hit, key=lambda r: r['area'])
            # a code drawn inside a big ordinary zone labels something nearby, not the whole zone
            if not r['reserved'] and r['area'] > 20000: continue
        elif res_regions:
            r = min(res_regions, key=lambda r: gap(r, x, z))
            if gap(r, x, z) > rad + 40: continue
        else: continue
        if 'marker' in r: continue
        r['marker'] = [round(x, 1), round(z, 1)]
        r['reserved'] = True
    for r in regions: r.pop('box', None)
    print(f'{len(markers)} code markers, {sum("marker" in r for r in regions)} placed on reserved sites')
    # unique ids (identical hashes are rare but possible)
    seen = {}
    for r in regions:
        n = seen.get(r['id'], 0); seen[r['id']] = n + 1
        if n: r['id'] += f'-{n}'
    doc = {
        'res': res, 'sheets': names, 'source': tiles.ATTRIBUTION,
        'note': 'Extracted automatically from scanned DP sheets registered to about 2-3 m. Survey aid, not legal boundaries.',
        'classes': {k: {'label': CLASSES[k][0], 'color': '#%02x%02x%02x' % CLASSES[k][1]} for k in KEYS},
        'regions': regions,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh: json.dump(doc, fh, separators=(',', ':'))
    by = {}
    for r in regions: by[r['cls']] = by.get(r['cls'], 0) + 1
    print(f'{len(regions)} regions ({sum(r["reserved"] for r in regions)} reserved), {os.path.getsize(OUT) / 1e6:.1f} MB, {time.time() - t0:.1f}s -> {OUT}')
    print('  ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items(), key=lambda kv: -kv[1])))
    if debug is not None:
        cv2.imwrite(a.debug, cv2.cvtColor(debug, cv2.COLOR_RGB2BGR))


if __name__ == '__main__':
    main()
