// The sky and the light it gives. What you see behind the buildings is a Preetham sky from the same sun the shadows
// come from. What lights the materials is a measured stand-in for it: a dome graded from the zenith to the horizon
// (warmer toward the sun when it's low), a ground of the site's colour below, and the sun as a small bright disc for
// glints, rendered into a small environment map. (The Preetham sky's own radiance is far too strong and blue to light
// with directly; the dome keeps sunlit to shaded walls at about 4 to 1.) After dark the dome goes a faint blue.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class SkyLight {
  sky = new Sky();
  private envScene = new THREE.Scene();
  private dome: THREE.Mesh;
  private sunDisc: THREE.Mesh;
  private ground: THREE.Mesh;
  private pm: THREE.PMREMGenerator;
  env: THREE.Texture | null = null;
  private lastDir = new THREE.Vector3(0, -1, 0);
  private pending = 0;
  /** the horizon's colour now: the fog takes it */
  horizon = new THREE.Color('#dfe4ea');

  constructor(renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6.5; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.82;
    const g = new THREE.SphereGeometry(900, 48, 24);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    this.dome = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(40, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), fog: false }));
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(880, 48), new THREE.MeshBasicMaterial({ color: '#8f8a7e', fog: false }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -2;
    this.envScene.add(this.dome, this.sunDisc, this.ground);
    this.pm = new THREE.PMREMGenerator(renderer);
  }

  /** the sun toward `dir` (x east, y up, z south), the site's ground colour; the light regenerated when it moved */
  set(dir: THREE.Vector3, groundColour: string, onDone: () => void) {
    this.sky.material.uniforms.sunPosition.value.copy(dir).multiplyScalar(100);
    const e = dir.y, day = THREE.MathUtils.smoothstep(e, -0.05, 0.2), low = 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.35);
    // the dome's colours (linear): a soft blue overhead, a pale horizon warming toward a low sun; night a faint blue
    const zen = new THREE.Color('#6f8fb8').multiplyScalar(0.55).lerp(new THREE.Color('#0b1020').multiplyScalar(0.05), 1 - day);
    const hor = new THREE.Color('#cfd6dc').multiplyScalar(0.75).lerp(new THREE.Color('#e9b98a').multiplyScalar(0.8), low * day * 0.6).lerp(new THREE.Color('#121826').multiplyScalar(0.06), 1 - day);
    const sunward = new THREE.Color('#ffd2a0').multiplyScalar(0.9 * low * day);
    this.horizon.copy(hor).convertLinearToSRGB();
    const p = this.dome.geometry.attributes.position as THREE.BufferAttribute, c = this.dome.geometry.attributes.color as THREE.BufferAttribute, v = new THREE.Vector3(), col = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const t = Math.pow(Math.max(0, v.y), 0.6);
      col.copy(hor).lerp(zen, t);
      const k = Math.max(0, v.dot(dir));
      col.add(sunward.clone().multiplyScalar(Math.pow(k, 6) * (1 - t)));
      c.setXYZ(i, col.r, col.g, col.b);
    }
    c.needsUpdate = true;
    // (the sun's disc: a hot spot for highlights on glass and metal)
    this.sunDisc.visible = e > -0.02;
    this.sunDisc.position.copy(dir).multiplyScalar(800);
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.setRGB(30 * day, 27 * day, 23 * day);
    (this.ground.material as THREE.MeshBasicMaterial).color.set(groundColour).multiplyScalar(0.02 + 0.5 * day);
    if (dir.angleTo(this.lastDir) < 0.017 && this.env) return;
    this.lastDir.copy(dir);
    cancelAnimationFrame(this.pending);
    // (at most one regeneration a frame while the sun is dragged)
    this.pending = requestAnimationFrame(() => {
      const t = this.pm.fromScene(this.envScene, 0, 1, 2000);
      this.env?.dispose(); this.env = t.texture;
      onDone();
    });
  }
  dispose() { cancelAnimationFrame(this.pending); this.env?.dispose(); this.pm.dispose(); }
}

/** the sun's colour at an elevation (sin of it): about 5800 K high, 2600 K at the horizon */
export function sunColour(y: number): THREE.Color {
  const t = Math.max(0, Math.min(1, y / 0.35));
  return new THREE.Color('#ffb06a').lerp(new THREE.Color('#fff4e6'), t);
}
