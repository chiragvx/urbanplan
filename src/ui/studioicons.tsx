// Site Studio's pictures: the shelf's things to place (each a little massing or plan symbol), the uses, and the
// spark of "Fill for me". 16 px, stroked like the app's own icons; names live in the hover cards.
import type { PlotUse } from '../doc/plot';
import type { ShelfTool } from '../doc/site';

const I = (d: string, fill?: string) => (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {fill && <path d={fill} fill="currentColor" stroke="none" opacity="0.22" />}
    <path d={d} />
  </svg>
);

export const SI = {
  // buildings: a slab, a tower, an L, a spine drawn freehand
  slab: I('M1.5 11l4-2.5 9 2.5-4 2.5zM1.5 11V7l4-2.5 9 2.5v4M5.5 4.5V8.5M10.5 13.5v-4l4-2.5M1.5 7l9 2.5', 'M1.5 7l4-2.5 9 2.5-4 2.5z'),
  tower: I('M4.5 14.5v-11l3-2 4 1.5v11l-3 1.5zM8.5 15V4M4.5 3.5l4 .5 3-1M6.5 6.5h.01M6.5 9h.01M6.5 11.5h.01', 'M4.5 3.5l3-2 4 1.5-3 1z'),
  lblock: I('M1.5 10.5v-3h8V2h5v8.5zM1.5 10.5l2 2h11l-2-2M9.5 7.5h5', 'M1.5 7.5h8V2h5v8.5h-13z'),
  spine: I('M2 13l5-5h7M2 13h.01M7 8h.01M14 8h.01M3 9.5l2.5 2.5M8.5 5.5v5M12.5 5.5v5'),
  // the site
  parking: I('M2 13.5h12M2 10h12M2 6.5h12M3 13.5V6.5M13 13.5V6.5M6.5 3h3a1.5 1.5 0 0 1 0 3h-3V2', 'M2 6.5h12v7H2z'),
  lot: I('M1.5 2.5h13v11h-13zM5 2.5v4M8 2.5v4M11 2.5v4M5 13.5v-4M8 13.5v-4M11 13.5v-4'),
  garden: I('M5 8a3 3 0 1 1 0-.01M5 11v3M11.5 9.5a2 2 0 1 1 0-.01M11.5 11.5V14M1.5 14h13', 'M5 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'),
  play: I('M2 14l3-11h6l3 11M5 3h6M8 3v5M6.5 8h3v1.5h-3z'),
  trees: I('M4.5 9.5a3 3 0 1 1 .01 0M4.5 9.5V14M11 8a2.5 2.5 0 1 1 .01 0M11 8v6M7.5 6a2 2 0 1 1 .01 0V9', 'M4.5 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'),
  road: I('M5 1.5L3 14.5M11 1.5l2 13M8 2v2M8 7v2M8 12v2'),
  roundabout: I('M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1.5V5M8 11v3.5M1.5 8H5M11 8h3.5'),
  gate: I('M1.5 13V5M14.5 13V5M1.5 8h3M11.5 8h3M4.5 5v8M11.5 5v8M4.5 6l7 6M11.5 6l-7 6'),
  wall: I('M1.5 5.5h13v7h-13zM1.5 9h13M5.5 5.5V9M10.5 5.5V9M3.5 9v3.5M8 9v3.5M12.5 9v3.5'),
  tank: I('M3.5 4.5a4.5 1.5 0 1 0 9 0 4.5 1.5 0 1 0-9 0v5c0 .8 2 1.5 4.5 1.5s4.5-.7 4.5-1.5v-5M5 11l-1 3.5M11 11l1 3.5', 'M3.5 4.5h9v5H3.5z'),
  // tools
  spark: I('M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3zM13 1.5v2M12 2.5h2', 'M8 1.5l1.6 4.2 4.4.3-3.4 2.8 1.1 4.3L8 10.7l-3.7 2.4 1.1-4.3L2 6l4.4-.3z'),
  minus: I('M3.5 8h9'),
  plus: I('M8 3.5v9M3.5 8h9'),
  note: I('M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8.5h5M5.5 11h3'),
  // uses
  residential: I('M2 7.5L8 2.5l6 5M3.5 6.5v7h9v-7M6.5 13.5v-4h3v4'),
  commercial: I('M3 14.5V2.5h10v12M1.5 14.5h13M5.5 5h1.5M9 5h1.5M5.5 8h1.5M9 8h1.5M5.5 11h1.5M9 11h1.5'),
  shops: I('M2 6l1-3.5h10L14 6M2 6c0 1 .9 1.5 2 1.5S6 7 6 6c0 1 .9 1.5 2 1.5S10 7 10 6c0 1 .9 1.5 2 1.5S14 7 14 6M3 7.5v6h10v-6M6.5 13.5v-3h3v3'),
  industrial: I('M1.5 14V8l4-2.5V8l4-2.5V8l4-2.5V14zM11.5 5.5V2h2v3M4 11h1.5M7.5 11H9M11 11h1.5'),
  carpark: I('M2.5 2.5h11v11h-11zM6.5 11V5h2.5a2 2 0 0 1 0 4H6.5'),
  government: I('M1.5 5.5L8 2l6.5 3.5zM2.5 13.5h11M3 7.5v5M6 7.5v5M10 7.5v5M13 7.5v5M1.5 14.5h13'),
  school: I('M1.5 6L8 3l6.5 3L8 9zM4 7.3v3.5c1 1 2.5 1.7 4 1.7s3-.7 4-1.7V7.3M14.5 6v4'),
  hospital: I('M2.5 2.5h11v11h-11zM8 5v6M5 8h6'),
  worship: I('M8 1.5v3M6.5 3h3M3.5 14.5V8.5L8 5l4.5 3.5v6M1.5 14.5h13M6.5 14.5v-3a1.5 1.5 0 0 1 3 0v3'),
  custom: I('M8 1.5l1.5 3 3.3.5-2.4 2.3.6 3.2L8 9l-3 1.5.6-3.2-2.4-2.3 3.3-.5zM3 14.5h10'),
  none: I('M2.5 2.5h11v11h-11z M5 8h6', ''),
};

export const shelfIcon = (k: ShelfTool | 'draw') => (k === 'draw' ? SI.spine : SI[k as keyof typeof SI] ?? SI.slab);
export const useIcon = (u: PlotUse) => (u === 'garden' ? SI.garden : SI[u as keyof typeof SI] ?? SI.none);
