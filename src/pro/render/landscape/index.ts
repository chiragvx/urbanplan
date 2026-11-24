// The landscape kit: surfaces (roads, paving, lawn, beds, bare ground; ./surfaces.ts) as materials (./material.ts),
// and trees grown in code (./trees.ts). Everything a scene asks for by name; add a surface or a species in its
// registry and it's there.
export { SURFACES, SURFACE_IDS, paintSurface, surfaceOfCover, surfaceOfRoad, type Surface, type SurfaceId } from './surfaces';
export { surfaceMaterial, surfaceMaps, landscapeRes } from './material';
export { SPECIES, VARIANTS, growTree, treeMeshes, type Species, type Placed } from './trees';
