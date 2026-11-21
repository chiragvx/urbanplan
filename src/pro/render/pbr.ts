// The shaded view's materials, made once and kept: a surface from the material library (its colour the design
// system's token, its roughness and sheen from its finish, its detail from ./textures.ts), glass as a dielectric that
// reflects the sky, and plain colours for the site's odds and ends, all cached by what they are, so a rebuild reuses
// them instead of leaking new ones. Instanced boxes take their texture coordinates from the world (each face projected
// in metres), so brick courses run on across a building's piers and bands.
import * as THREE from 'three';
import { materialOf } from '../materials';
import { detailOf } from './textures';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** the chamfer on instanced members' edges (m; 0 off: the high tier and stills turn it on), and the unit box it bends:
 *  the shader keeps it this many metres whatever a member's size, so a long band and a short pier bevel alike */
export const BEVEL = { value: 0 };
const R0 = 0.1;
export const CHAMFER_BOX = new RoundedBoxGeometry(1, 1, 1, 1, R0);

/** a colour clamped to what a real surface reflects (3 … 85 %), so white walls don't burn out in the sun */
export function albedo(hex: string): THREE.Color {
  const c = new THREE.Color(hex), mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  if (mx > 0.85) c.multiplyScalar(0.85 / mx);
  if (mn < 0.03) { c.r = Math.max(0.03, c.r); c.g = Math.max(0.03, c.g); c.b = Math.max(0.03, c.b); }
  return c;
}

/** world-projected UVs for instanced boxes: vertical faces along their run and up, flat ones in plan (metres) */
function boxUV(m: THREE.Material) {
  m.onBeforeCompile = (s) => {
    s.uniforms.uBevel = BEVEL;
    s.vertexShader = 'uniform float uBevel;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  if ( uBevel > 0.0 ) {
    vec3 sc = vec3( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ), length( instanceMatrix[2].xyz ) );
    vec3 sg = sign( transformed );
    vec3 dir = ( transformed - sg * ( 0.5 - ${R0.toFixed(3)} ) ) / ${R0.toFixed(3)};
    vec3 bv = min( vec3( uBevel ), sc * 0.3 );
    transformed = sg * 0.5 + ( dir - sg ) * bv / sc;
  }
#endif`).replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
  {
    vec4 bw = modelMatrix * instanceMatrix * vec4( position, 1.0 );
    vec3 bn = normalize( mat3( modelMatrix * instanceMatrix ) * normal );
    vec2 buv = abs( bn.y ) > 0.5 ? bw.xz : vec2( dot( bw.xz, vec2( -bn.z, bn.x ) ), bw.y );
    #ifdef USE_MAP
      vMapUv = ( mapTransform * vec3( buv, 1.0 ) ).xy;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv = ( normalMapTransform * vec3( buv, 1.0 ) ).xy;
    #endif
  }
#endif`);
  };
  m.customProgramCacheKey = () => 'boxuv';
}

export class Materials {
  private cache = new Map<string, THREE.Material>();
  /** texture resolution (0: none) */
  tex = 512;
  private keep<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) { m = make(); this.cache.set(key, m); }
    return m;
  }

  /** a plain colour (site things, trees, roads), with options */
  plain(colour: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    return this.keep(`p|${colour}|${JSON.stringify(o)}`, () => new THREE.MeshStandardMaterial({ color: albedo(colour), roughness: 0.85, ...o }));
  }

  /** a surface from the material library, in a token colour */
  surface(id: string | undefined, colour: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const mat = id ? materialOf(id) : null;
    return this.keep(`s|${id}|${colour}|${this.tex}|${JSON.stringify(o)}`, () => {
      const f = mat?.finish ?? 'matt', cat = mat?.category ?? 'paint';
      const metal = cat === 'metal' || (cat === 'cladding' && (mat?.id.startsWith('acp') || mat?.id.includes('fins')));
      const rough = f === 'gloss' ? 0.28 : f === 'satin' ? 0.5 : f === 'textured' ? 0.95 : cat === 'wood' ? 0.7 : 0.88;
      const p: THREE.MeshPhysicalMaterialParameters = { color: albedo(colour), roughness: rough, metalness: metal ? 0.75 : 0, ...o };
      const d = mat ? detailOf(mat, this.tex) : null;
      if (d) { p.map = d.map; p.normalMap = d.normal; p.normalScale = new THREE.Vector2(0.8, 0.8); }
      const m = metal && f === 'gloss' ? new THREE.MeshPhysicalMaterial({ ...p, clearcoat: 0.5, clearcoatRoughness: 0.2 }) : new THREE.MeshStandardMaterial(p);
      boxUV(m);
      return m;
    });
  }

  /** glass: a dielectric (no metal), its tint the token, reflecting the sky by Fresnel */
  glass(colour: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial {
    return this.keep(`g|${colour}|${JSON.stringify(o)}`, () => new THREE.MeshPhysicalMaterial({
      color: albedo(colour), metalness: 0, roughness: 0.05, ior: 1.52, specularIntensity: 1, envMapIntensity: 1.15, ...o,
    }));
  }

  /** a material that isn't standard (basic glows, the jaali): made by `make`, cached by `key` */
  other<T extends THREE.Material>(key: string, make: () => T): T { return this.keep(`o|${key}`, make); }

  /** after a texture tier change: everything made again on next use */
  reset() { for (const m of this.cache.values()) m.dispose(); this.cache.clear(); }
  dispose() { this.reset(); }
  get size() { return this.cache.size; }
}
