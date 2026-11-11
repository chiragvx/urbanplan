// The name, address and colours the videos carry. One place, so a rename is one edit.
const NAME = 'UrbanPlan';
export const BRAND = {
  /**
   * Off until the name is chosen: no episode chip or brand bug, and no end card. The film holds on the last shot
   * with the closing question (Scene.end.headline) and the small print. On: the chip, the bug and the end card.
   */
  branded: false,
  name: NAME,
  url: 'urbanplan.app',
  /** the end card's small print */
  credit: `Illustrative concept, made in ${NAME}`,
  /** the small print when unbranded */
  plain: 'Illustrative concept',
};

export const INK = '#0c0c0d', PAPER = '#fafaf9', ORANGE = '#ff6a2b', COBALT = '#2f5bff', RED = '#e5484d', GREEN = '#30a46c';
export const FONT = 'Geist, system-ui, sans-serif';
