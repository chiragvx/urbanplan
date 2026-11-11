// The Development Plan's land-use classes (label and the colour on the sheet's legend), as baked: small enough for any
// page to import (the guides' colour-code table) without the DP report's locality data.
import RAW from './generated/classes.json';

export const DP_CLASSES = RAW as Record<string, { label: string; color: string }>;
/** the place pages (/pune/<slug>/) and the DP page of the locality nearest each (tools/dpreport/bake-dpreport.ts) */
export { default as DP_LINKS } from './generated/links.json';
