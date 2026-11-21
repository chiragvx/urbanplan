// The templates gallery (/templates/ and /templates/<id>/): Pro's building templates (src/pro/form/templates.ts),
// in words. The ids are Pro's: a page's "Open in Pro" starts a project with that template on the sample plot
// (/pro/?new=template:<id>). A template added to Pro gets a line here, and a sketch in src/site/wire.ts.

export type Group = 'tower' | 'homes' | 'public' | 'sculpted';
export const GROUPS: { id: Group; label: string; intro: string }[] = [
  { id: 'tower', label: 'Towers', intro: 'Flats, offices and hotels, from a plain block to a twisting tower.' },
  { id: 'homes', label: 'Homes', intro: 'Courts, slabs, row houses and a villa: housing that stays low or spreads out.' },
  { id: 'public', label: 'Public buildings', intro: 'A library, a community hall, even a public toilet.' },
  { id: 'sculpted', label: 'Sculpted', intro: 'Forms that curve, lean, split and carve, with the floors still worked out.' },
];

export interface Template {
  id: string; name: string; group: Group;
  /** one line, for cards */
  blurb: string;
  /** a short paragraph, for its page */
  body: string;
  /** what it suits */
  suits: string[];
}

export const TEMPLATES: Template[] = [
  { id: 'box', name: 'Box tower', group: 'tower', blurb: 'A plain tower of flats.',
    body: 'The everyday residential tower: straight walls, the same floor all the way up, a core in the middle. The quickest way to see what a plot can hold before you shape anything.',
    suits: ['Residential towers', 'A first test of a plot', 'Redevelopment'] },
  { id: 'taper', name: 'Tapered tower', group: 'tower', blurb: 'Slimmer as it rises.',
    body: 'Each floor a little smaller than the one below, leaving a terrace at every edge. The floor area moves down the building, where it sells best and costs least to build.',
    suits: ['Premium residential', 'Terraced homes in a tower', 'Tight height limits'] },
  { id: 'twist', name: 'Twisted tower', group: 'tower', blurb: 'Each floor turned a little more.',
    body: 'Every floor turned a few degrees from the one below, so the tower twists as it rises. The core stays put; the flats, balconies and views turn with it.',
    suits: ['Landmark towers', 'Views on every side'] },
  { id: 'stepped', name: 'Stepped tower', group: 'tower', blurb: 'Wedding-cake setbacks with terraces.',
    body: 'The tower steps in every few floors, each step a wide terrace. A classic answer to height and light rules, and to buyers who want a garden in the sky.',
    suits: ['Terraces and penthouses', 'Light planes and height rules'] },
  { id: 'round', name: 'Round tower', group: 'tower', blurb: 'A cylinder ringed with balconies.',
    body: 'A circular plan ringed with balconies, every flat facing out. No back side, and the least wall for the floor area it holds.',
    suits: ['Corner plots', 'Views all round'] },
  { id: 'office', name: 'Office on shops', group: 'tower', blurb: 'Offices over a two-floor shopping podium.',
    body: 'A two-floor podium of shops along the road, with an office tower set back above it. Mixed use in one building, each use checked against its own rules.',
    suits: ['Commercial plots', 'Main-road frontage', 'Mixed use'] },
  { id: 'hotel', name: 'Hotel', group: 'tower', blurb: 'A curved slab of rooms over a lobby.',
    body: 'A long, gently curved slab of rooms over a lobby floor: every room on the outside, corridors short, the curve turning the rooms to the view.',
    suits: ['Hotels', 'Serviced apartments', 'Hostels'] },
  { id: 'courtyard', name: 'Courtyard homes', group: 'homes', blurb: 'A block of flats round a green court.',
    body: 'Flats built round a garden in the middle: light and air from two sides, and a shared, quiet court away from the road.',
    suits: ['Mid-rise housing', 'Large plots', 'Co-operative housing'] },
  { id: 'twinslab', name: 'Twin slabs', group: 'homes', blurb: 'Two long slabs of flats, a garden between.',
    body: 'Two parallel slabs of flats with a garden between them, spaced for light under the rules. Simple to build, easy to phase.',
    suits: ['Affordable housing', 'Phased projects', 'Deep plots'] },
  { id: 'villa', name: 'Villa', group: 'homes', blurb: 'A two-storey house under a gable roof.',
    body: 'A two-storey house under a gable roof, set in its garden. Bungalow plots get the same checks as towers: margins, coverage, height and parking.',
    suits: ['Bungalow plots', 'Weekend homes'] },
  { id: 'rows', name: 'Row houses', group: 'homes', blurb: 'Five narrow homes in a terrace.',
    body: 'A terrace of narrow two-storey homes sharing their side walls, each with its own front door and garden.',
    suits: ['Row-house schemes', 'Gated communities'] },
  { id: 'library', name: 'Library', group: 'public', blurb: 'Three airy reading floors under a curved roof.',
    body: 'Three tall, open floors under one roof that runs past the walls: reading rooms, stacks and a hall, with daylight from every side.',
    suits: ['Public amenity space', 'Institutions', 'Schools and colleges'] },
  { id: 'hall', name: 'Community hall', group: 'public', blurb: 'One tall hall under a hipped roof.',
    body: 'A single tall hall under a hipped roof, the kind every layout owes as amenity: weddings, meetings, a gym, a crèche.',
    suits: ['Amenity space in a layout', 'Clubhouses'] },
  { id: 'toilet', name: 'Public toilet', group: 'public', blurb: 'A small screened block with a mono roof.',
    body: 'A small, screened block under a single sloping roof. Proof that the same tool works from a tower down to the smallest building on a plot.',
    suits: ['Public works', 'Site amenities'] },
  { id: 'wave', name: 'Wave block', group: 'sculpted', blurb: 'A rippling block with deep fins.',
    body: 'A long block whose facade ripples floor by floor, shops below and homes above. The wave gives every flat a deep, shaded balcony.',
    suits: ['Main-road frontage', 'Mixed use', 'A strong street face'] },
  { id: 'monolith', name: 'Monolith', group: 'sculpted', blurb: 'A white tower split by a zig-zag glass slot.',
    body: 'One solid tower cut in two by a glass slot that zig-zags up its height. Two wings, one core, light deep into the middle.',
    suits: ['Landmark towers', 'Offices', 'Deep floor plates'] },
  { id: 'twins', name: 'Sculpted twins', group: 'sculpted', blurb: 'Two S-curved towers in fluted fin shells.',
    body: 'Two towers that sway and turn as they rise, wrapped in fins. Each floor is a different shape, and each is still laid out with flats, cores and checks.',
    suits: ['Landmark residential', 'Large plots'] },
  { id: 'lean', name: 'Leaning tower', group: 'sculpted', blurb: 'A tower leaning out over its base.',
    body: 'Each floor slides a little further out than the one below, so the tower leans over its base. Pro flags the overhang for the structural engineer.',
    suits: ['Statement buildings', 'Views in one direction'] },
  { id: 'skygarden', name: 'Sky garden tower', group: 'sculpted', blurb: 'Open-air gardens carved out of its corners.',
    body: 'Gardens carved out of the tower’s corners every few floors, turning as they rise, and the floors stepping in as they go.',
    suits: ['Green towers', 'Premium residential'] },
];

export const template = (id: string) => TEMPLATES.find((t) => t.id === id);
export const OPEN = (id: string) => `pro/?new=${encodeURIComponent(`template:${id}`)}`;
