"""Render a DP sheet with our roads (red) + river outline (blue) projected through its alignment, for checking."""
import json, sys, os
import numpy as np, cv2, pymupdf
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
DP = os.path.join(ROOT, 'data', 'raw', 'dp')
ref = json.load(open(os.path.join(DP, 'ref.json'), encoding='utf-8'))
name, out = sys.argv[1], sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 60
crop = [float(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else None  # x0,z0,x1,z1 metres
regp = os.path.join(DP, name + '.reg.json')
al = json.load(open(regp if os.path.exists(regp) else os.path.join(DP, name + '.align.json')))
A = np.vstack([np.array(al['affine']), [0, 0, 1]])  # 300px -> m
Ainv = np.linalg.inv(A)
cps = np.array(al.get('cps', []))
def correction(p):  # IDW of residual shifts (metres)
    if len(cps) == 0: return np.zeros_like(p)
    d2 = ((p[:, None, :] - cps[None, :, :2]) ** 2).sum(2) + 150.0 ** 2
    w = 1 / d2
    return (w @ cps[:, 2:4]) / w.sum(1, keepdims=True)
k = dpi / 300
page = pymupdf.open(os.path.join(DP, name + '.pdf'))[0]
pm = page.get_pixmap(dpi=dpi)
img = cv2.cvtColor(np.frombuffer(pm.samples, np.uint8).reshape(pm.h, pm.w, pm.n)[:, :, :3].copy(), cv2.COLOR_RGB2BGR)
def px(pts):
    p = np.array(pts, float).reshape(-1, 2)
    p = p - correction(p)  # true metres -> affine metres
    q = (Ainv @ np.vstack([p.T, np.ones(len(p))]))[:2].T * k
    return q.astype(np.int32)
for r in ref['roads']:
    cv2.polylines(img, [px(r['pts'])], False, (0, 0, 255), 1)
for poly in ref['water']:
    cv2.polylines(img, [px(poly[0])], True, (255, 80, 0), 2)
# tile boundary
h = ref['half']
cv2.polylines(img, [px([-h, -h, h, -h, h, h, -h, h])], True, (0, 160, 0), 2)
if crop:
    a = px([crop[0], crop[1]])[0]; b = px([crop[2], crop[3]])[0]
    x0, x1 = sorted([a[0], b[0]]); y0, y1 = sorted([a[1], b[1]])
    img = img[max(0, y0):y1, max(0, x0):x1]
cv2.imwrite(out, img)
print('wrote', out, img.shape)
