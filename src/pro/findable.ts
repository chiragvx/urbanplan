// Every setting Pro has, by name, for search (Ctrl+K): the step it's in, its section's title, and the field's own
// label where it's a field. Choosing one opens the step, unfolds the section, and focuses the field. Kept by hand;
// tools/dev/test-findable.ts checks every section title in the steps is here, so a new section can't be missed.
import type { Step } from './steps';

export interface Findable {
  /** what it's called in the search list */
  label: string;
  step: Step;
  /** the section's title, exactly as its <Section title> */
  sec: string;
  /** the field's label inside it, exactly as shown (unset: the section itself) */
  field?: string;
  /** other words people search for it by */
  words?: string;
}

const S = (step: Step, sec: string, words?: string, fields: (string | [string, string])[] = []): Findable[] => [
  { label: sec, step, sec, words },
  ...fields.map((f) => (typeof f === 'string' ? { label: f, step, sec, field: f } : { label: f[0], step, sec, field: f[0], words: f[1] })),
];

export const FINDABLE: Findable[] = [
  // site
  ...S('site', 'Rules', 'authority city code udcpr dcpr', [['Planning authority', 'city rules code']]),
  ...S('site', 'Plot', 'size frontage depth outline corners survey import'),
  ...S('site', 'What the plot permits', 'fsi ladder premium tdr ancillary fungible basic allowed permissible built-up'),
  ...S('site', 'On the site', 'trees features obstructions power line well no-build'),
  ...S('site', 'Constraints', 'height cap airport tod metro transit', [['Height cap (0: none)', 'airport aai fire heritage'], ['Transit-oriented zone', 'tod metro'], 'Total FSI in the zone']),
  // design
  ...S('design', 'Start from', 'preset design system style'),
  ...S('design', 'Language', 'skin glass roof corners', ['Skin', 'Glass', 'Roof', 'Round corners']),
  ...S('design', 'Composition', 'base top crown windows bay entrance', ['Base floors', 'Top floors', 'Crown', 'Bay width', 'Entrance']),
  ...S('design', 'Heritage controls', 'precinct', ['Precinct']),
  ...S('design', 'Signs and lighting', 'signage facade lighting dark sky'),
  ...S('design', 'Landscape', 'trees hedge planters'),
  ...S('design', 'Review', 'check design review'),
  ...S('design', 'Walls, gates and roads', 'compound wall gate security cabin internal road footpath', [['Vehicle gate, clear', 'gate width'], ['Road width', 'internal road']]),
  ...S('design', 'Climate', 'chhajja jaali shade sun'),
  ...S('design', 'Palette', 'colours colors tones'),
  ...S('design', 'Facade', 'fins floor bands floor to floor height', [['Floor to floor', 'floor height storey']]),
  ...S('design', 'Windows and balconies', 'balcony glass frames', ['Balconies']),
  ...S('design', 'Flooring', 'tiles marble vitrified'),
  ...S('design', 'Roof', 'terrace roof finish'),
  ...S('design', 'Specification', 'spec finishes quality cost'),
  // scheme
  ...S('build', 'Fill the plot', 'generate layout typology', [['How much of it to build', 'amount share'], ['Building type', 'typology tower slab'], ['Most floors', 'height storeys'], 'Most buildings']),
  ...S('build', 'Living', 'green play spacing parking basements', ['Green', 'Play area', 'Roads inside', 'Parking', 'Basements']),
  ...S('build', 'Flat mix', 'bhk 1bhk 2bhk 3bhk units'),
  ...S('build', 'Buildings', 'towers list'),
  ...S('build', 'Shops at the front', 'retail commercial ground floor', ['Depth from the front']),
  ...S('build', 'Parking', 'bays cars stilt basement podium'),
  // money
  ...S('money', 'What the land is worth', 'residual land value offer price jda share target margin irr', [['Target margin', 'target'], ['Target IRR', 'target']]),
  ...S('money', 'Result', 'irr margin profit peak funding'),
  ...S('money', 'Cost', 'construction cost'),
  ...S('money', 'By use', 'homes offices hotel'),
  ...S('money', 'Prices', 'sale rate rent yield', [['Sale price', 'rate per sq ft'], ['Land price', 'land rate'], 'Office rent', 'Office yield', ['Build time', 'months construction'], 'Booked by completion', 'Soft costs']),
  ...S('money', 'The deal on the land', 'jda joint development redevelopment society outright', ['Deal', 'Refundable deposit', 'Members (existing flats)', 'Corpus each', ['GST on sales', 'gst tax'], 'Stamp duty']),
  ...S('money', 'Statement', 'cash flow month by month'),
  // approval
  ...S('approve', 'Scrutiny', 'checks rules compliance fail'),
  ...S('approve', 'Permission', 'commencement certificate building permission', ['Applying for']),
  ...S('approve', 'Drawings and report', 'drawing set pdf print sheets'),
  ...S('approve', 'NOCs', 'no objection airport trees heritage fire', ['Near an airport', 'Trees on the plot', 'Heritage precinct']),
  ...S('approve', 'Fees and charges', 'fees scrutiny fee development charges'),
  ...S('approve', 'Documents to file', 'documents 7/12 title'),
  // explore
  ...S('explore', 'Brief', 'written brief ask'),
  ...S('explore', 'Options', 'alternatives explore compare'),
  ...S('explore', 'Screen many plots', 'screening many plots compare land'),
  ...S('explore', 'Plotted layout', 'plots subdivision plotted development', ['Plot width', 'Plot depth']),
];
