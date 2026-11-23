// Every setting Pro has, by name, for search (Ctrl+K): the step it's in, its section's title, and the field's own
// label where it's a field. Choosing one opens the step, unfolds the section, and focuses the field. Kept by hand;
// tools/dev/test-findable.ts checks every section title in the steps is here, so a new section can't be missed.
import type { Step } from './steps';

export interface Findable {
  /** what it's called in the search list */
  label: string;
  /** its place, or 'look': the design system's builder (Design › Look, a sheet of its own) */
  step: Step | 'look';
  /** the section's title, exactly as its <Section title> */
  sec: string;
  /** the field's label inside it, exactly as shown (unset: the section itself) */
  field?: string;
  /** other words people search for it by */
  words?: string;
}

const S = (step: Step | 'look', sec: string, words?: string, fields: (string | [string, string])[] = []): Findable[] => [
  { label: sec, step, sec, words },
  ...fields.map((f) => (typeof f === 'string' ? { label: f, step, sec, field: f } : { label: f[0], step, sec, field: f[0], words: f[1] })),
];

export const FINDABLE: Findable[] = [
  // the site (Brief and Design)
  ...S('brief', 'What it’s for', 'use purpose homes offices shops clinic hospital school public client own sell sale residential commercial mixed'),
  ...S('brief', 'Rules', 'authority city code udcpr dcpr', [['Planning authority', 'city rules code']]),
  ...S('design', 'Plot', 'size frontage depth outline corners survey import'),
  ...S('brief', 'What the plot permits', 'fsi ladder premium tdr ancillary fungible basic allowed permissible built-up'),
  ...S('brief', 'Constraints', 'height cap airport tod metro transit', [['Height cap (0: none)', 'airport aai fire heritage'], ['Transit-oriented zone', 'tod metro'], 'Total FSI in the zone']),
  // the design system (Design › Look)
  ...S('look', 'Start from', 'preset design system style'),
  ...S('look', 'Language', 'skin glass roof corners', ['Skin', 'Glass', 'Roof', 'Round corners']),
  ...S('look', 'Composition', 'base top crown windows bay entrance', ['Base floors', 'Top floors', 'Crown', 'Bay width', 'Entrance']),
  ...S('look', 'Heritage controls', 'precinct', ['Precinct']),
  ...S('look', 'Signs and lighting', 'signage facade lighting dark sky'),
  ...S('look', 'Landscape', 'trees hedge planters'),
  ...S('look', 'Review', 'check design review'),
  ...S('look', 'Walls, gates and roads', 'compound wall gate security cabin internal road footpath', [['Vehicle gate, clear', 'gate width'], ['Road width', 'internal road']]),
  ...S('look', 'Climate', 'chhajja jaali shade sun'),
  ...S('look', 'Palette', 'colours colors tones'),
  ...S('look', 'Facade', 'fins floor bands floor to floor height', [['Floor to floor', 'floor height storey']]),
  ...S('look', 'Windows and balconies', 'balcony glass frames', ['Balconies']),
  ...S('look', 'Flooring', 'tiles marble vitrified'),
  ...S('look', 'Roof', 'terrace roof finish'),
  ...S('look', 'Specification', 'spec finishes quality cost'),
  // the scheme (Brief and Design)
  ...S('design', 'Look', 'design system style facade materials builder look'),
  ...S('brief', 'Layout', 'layout typology type floors buildings fill fsi amount regenerate'),
  ...S('design', 'Living', 'green play spacing parking basements', ['Green', 'Play area', 'Roads inside', 'Parking', 'Basements']),
  ...S('brief', 'Flat mix', 'bhk 1bhk 2bhk 3bhk units'),
  ...S('brief', 'Flat sizes', 'carpet area size sq ft 1bhk 2bhk 3bhk flat size unit size'),
  ...S('design', 'Shops at the front', 'retail commercial ground floor', ['Depth from the front']),
  ...S('design', 'Parking', 'bays cars stilt basement podium'),
  // numbers
  ...S('numbers', 'Inventory', 'flats units list sales stock carpet value'),
  ...S('numbers', 'Area statement', 'permissible proposed fsi built-up carpet statement'),
  ...S('numbers', 'What the land is worth', 'residual land value offer price jda share target margin irr', [['Target margin', 'target'], ['Target IRR', 'target']]),
  ...S('numbers', 'Result', 'irr margin profit peak funding'),
  ...S('numbers', 'Cost', 'construction cost'),
  ...S('numbers', 'By use', 'homes offices hotel'),
  ...S('numbers', 'Prices', 'sale rate rent yield', [['Sale price', 'rate per sq ft'], ['Land price', 'land rate'], 'Office rent', 'Office yield', ['Build time', 'months construction'], 'Booked by completion', 'Soft costs']),
  ...S('numbers', 'The deal on the land', 'jda joint development redevelopment society outright', ['Deal', 'Refundable deposit', 'Members (existing flats)', 'Corpus each', ['GST on sales', 'gst tax'], 'Stamp duty']),
  ...S('numbers', 'Statement', 'cash flow month by month'),
  // approval
  ...S('approve', 'Scrutiny', 'checks rules compliance fail'),
  ...S('approve', 'Permission', 'commencement certificate building permission', ['Applying for']),
  ...S('approve', 'Drawings and report', 'drawing set pdf print sheets'),
  ...S('approve', 'NOCs', 'no objection airport trees heritage fire', ['Near an airport', 'Trees on the plot', 'Heritage precinct']),
  ...S('approve', 'Fees and charges', 'fees scrutiny fee development charges'),
  ...S('approve', 'Documents to file', 'documents 7/12 title'),
];
