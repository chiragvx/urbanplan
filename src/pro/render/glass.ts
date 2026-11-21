// Glass that reads as glass: a dielectric reflecting the sky (../render/pbr.ts), and behind it a room. Each pane of a
// straight building (an instance) looks into a box the size of the window bay, a floor high and 4.5 m deep (interior
// mapping: the ray from the eye crosses the pane and finds the back wall, the side walls, the floor or the ceiling),
// shaded by depth and dim by day, so you see in when looking straight on and get the sky's reflection at a slant
// (Fresnel). After dark a share of the rooms are lit, each its own warmth, by a hash of the pane: a building that's
// lived in, not a lantern. A formed building's glass (merged strips) gets the lit rooms by floor and bay, no box.
import type * as THREE from 'three';

/** shared by every glass material: how dark it is, the share of rooms lit, whether to draw the interiors */
export const GLASS = {
  uNight: { value: 0 },
  uLit: { value: 0 },
  uInterior: { value: 1 },
  uFloorH: { value: 3 },
};

const VERT_HEAD = `
attribute float aLit;
varying vec3 vRoomP; varying vec3 vRoomV; varying vec2 vRoomS; varying float vLitSeed; varying vec3 vGlassW;
`;
const VERT_BODY = `
#ifdef USE_INSTANCING
  {
    vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
    vec3 sc = vec3( length( c0 ), length( c1 ), length( c2 ) );
    mat3 R = mat3( c0 / sc.x, c1 / sc.y, c2 / sc.z );
    vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );
    vRoomP = position * sc;
    vRoomS = sc.xy;
    vRoomV = transpose( R ) * ( wp.xyz - cameraPosition );
    vLitSeed = aLit;
    vGlassW = wp.xyz;
  }
#else
  vRoomP = vec3( 0.0 ); vRoomS = vec2( 0.0 ); vRoomV = vec3( 0.0, 0.0, 1.0 ); vLitSeed = -1.0;
  vGlassW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
#endif
`;
const FRAG_HEAD = `
uniform float uNight; uniform float uLit; uniform float uInterior; uniform float uFloorH;
varying vec3 vRoomP; varying vec3 vRoomV; varying vec2 vRoomS; varying float vLitSeed; varying vec3 vGlassW;
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec3 roomWarm( float h ) { return mix( vec3( 1.0, 0.72, 0.45 ), vec3( 1.0, 0.9, 0.78 ), h ); }
`;
const FRAG_BODY = `
{
  float seed = vLitSeed >= 0.0 ? vLitSeed : gHash( vec2( floor( vGlassW.y / uFloorH ), floor( ( vGlassW.x + vGlassW.z ) / 3.6 ) ) );
  float lit = step( 1.0 - uLit, seed );
  vec3 roomCol = vec3( 0.0 );
  vec3 warm = roomWarm( fract( seed * 7.13 ) );
  if ( vLitSeed >= 0.0 && uInterior > 0.5 && abs( vRoomV.z ) > 1e-4 ) {
    // the room behind the pane: as wide as the bay, a floor high (the pane a little above the floor), 4.5 m deep
    vec3 d = normalize( vRoomV );
    vec3 o = vec3( vRoomP.xy, 0.0 );
    float hw = vRoomS.x * 0.5 + 0.3, fl = -vRoomS.y * 0.5 - 0.85, ce = vRoomS.y * 0.5 + 0.35, D = 4.5;
    float tz = D / abs( d.z );
    float tx = ( ( d.x > 0.0 ? hw : -hw ) - o.x ) / ( abs( d.x ) > 1e-4 ? d.x : 1e-4 );
    float ty = ( ( d.y > 0.0 ? ce : fl ) - o.y ) / ( abs( d.y ) > 1e-4 ? d.y : 1e-4 );
    float t = min( tz, min( tx, ty ) );
    vec3 hp = o + d * t;
    float v = fract( seed * 13.7 );
    vec3 wallC = mix( vec3( 0.78, 0.74, 0.68 ), vec3( 0.62, 0.66, 0.70 ), v );
    vec3 c = t == tz ? wallC : t == tx ? wallC * 0.82 : ( d.y > 0.0 ? vec3( 0.9 ) : vec3( 0.42, 0.33, 0.25 ) );
    // a curtain at one side, a piece of furniture against the back wall
    if ( t == tz && abs( hp.x - ( v > 0.5 ? -hw : hw ) * 0.75 ) < hw * 0.22 ) c = mix( c, vec3( 0.85, 0.8, 0.7 ), 0.7 );
    if ( t == tz && hp.y < fl + 0.8 && abs( hp.x ) < hw * 0.5 ) c *= 0.55;
    float depth = t * abs( d.z ) / D;
    c *= mix( 1.0, 0.45, depth );
    // a ceiling light pool when lit
    float pool = lit * smoothstep( 1.6, 0.0, length( hp.xz - vec2( 0.0, sign( d.z ) * D * 0.5 ) ) );
    roomCol = c * ( mix( 0.05, 0.02, uNight ) + lit * uNight * 1.1 * warm ) + pool * uNight * warm * 0.6;
  } else {
    roomCol = lit * uNight * warm * 0.9 + vec3( 0.015 );
  }
  vec3 V = normalize( vViewPosition );
  float F = 0.04 + 0.96 * pow( 1.0 - clamp( abs( dot( normal, V ) ), 0.0, 1.0 ), 5.0 );
  outgoingLight += roomCol * ( 1.0 - F );
}
`;

/** give a glass material the rooms behind it (call once per material) */
export function withRooms(m: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, GLASS);
    s.vertexShader = VERT_HEAD + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    s.fragmentShader = FRAG_HEAD + s.fragmentShader.replace('#include <opaque_fragment>', `${FRAG_BODY}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'glass-rooms';
}

/** the share of rooms lit at a darkness (0 day … 1 night): about half in the evening */
export const litShare = (night: number) => 0.55 * night;
