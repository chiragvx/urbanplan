// The sun's shadow, fitted: its box sized to what's drawn (the plot, its buildings and planting) as seen from the sun,
// snapped to whole texels so it doesn't shimmer as the sun moves, and biased by the texel's size so thin chhajjas and
// frames neither speckle nor float. Re-rendered only when the scene or the sun changes.
import * as THREE from 'three';

const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
const m = new THREE.Matrix4();

export function fitShadow(sun: THREE.DirectionalLight, box: THREE.Box3, mapSize: number) {
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = sun.position.clone().sub(sun.target.position).normalize();
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(dir, r * 2 + 50);
  sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  // (the box's corners in the light's view)
  m.lookAt(sun.position, c, new THREE.Vector3(0, 1, 0)).invert();
  const v = m.clone().multiply(new THREE.Matrix4().makeTranslation(-sun.position.x, -sun.position.y, -sun.position.z));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = corners[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(v);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  const size = Math.max(x1 - x0, y1 - y0) + 2, texel = size / mapSize;
  const snap = (a: number) => Math.floor(a / texel) * texel;
  const cx = snap((x0 + x1) / 2), cy = snap((y0 + y1) / 2);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = cx - size / 2; cam.right = cx + size / 2; cam.bottom = cy - size / 2; cam.top = cy + size / 2;
  cam.near = Math.max(0.5, -z1 - 5); cam.far = -z0 + 5;
  cam.updateProjectionMatrix();
  if (sun.shadow.mapSize.x !== mapSize) { sun.shadow.mapSize.set(mapSize, mapSize); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  sun.shadow.normalBias = 1.2 * texel;
  sun.shadow.bias = -0.0001;
  sun.shadow.needsUpdate = true;
}
