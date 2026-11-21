// The rule books Pro works to (/coverage/ and /coverage/<slug>/): the pages' words, and the list the routes read.
// A rule book added to Pro gets an entry here.

export interface RuleBook {
  slug: string; name: string; full: string; where: string; status: 'live' | 'used';
  intro: string;
  /** the free tools made on this rule book: [label, path] */
  tools: [string, string][];
}

export const RULE_BOOKS: RuleBook[] = [
  {
    slug: 'udcpr-2020', name: 'UDCPR 2020', status: 'live',
    full: 'Unified Development Control and Promotion Regulations for Maharashtra, 2020',
    where: 'Maharashtra outside Mumbai: Pune, Pimpri-Chinchwad and the state’s other cities and towns, including old-city (congested) areas.',
    intro: 'The building rules for most of Maharashtra. Pro reads floor area, margins, height, parking, amenity and the rest straight from its tables, by plot size and road width.',
    tools: [['FSI calculator', 'pune/fsi-calculator/'], ['FSI map', 'pune/fsi-map/'], ['Check a plot against the DP', 'pune/dp-report/'], ['DP map', 'pune/dp-map/'], ['Road width map', 'pune/road-width-map/'], ['3D city map', 'pune/map/']],
  },
  {
    slug: 'dcpr-2034', name: 'DCPR 2034', status: 'live',
    full: 'Development Control and Promotion Regulations for Greater Mumbai, 2034',
    where: 'Greater Mumbai: the island city and the suburbs.',
    intro: 'Mumbai’s own rules, with fungible area, premium and TDR, and the road widths that set them. Pro switches to them for a plot in Greater Mumbai.',
    tools: [['FSI calculator', 'mumbai/fsi-calculator/'], ['FSI map', 'mumbai/fsi-map/'], ['Road width map', 'mumbai/road-width-map/'], ['3D city map', 'mumbai/map/']],
  },
  {
    slug: 'nbc-2016', name: 'NBC 2016', status: 'used',
    full: 'National Building Code of India 2016, Part 4: Fire and life safety',
    where: 'All of India, alongside the local rules.',
    intro: 'Pro uses Part 4 for the fire systems a building needs by its height and use, and for staircases and travel distance where the local rules point to it.',
    tools: [],
  },
];

export const ruleBook = (slug: string) => RULE_BOOKS.find((r) => r.slug === slug);
