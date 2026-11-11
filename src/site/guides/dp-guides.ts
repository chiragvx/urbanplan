// Guides on Pune's Development Plan for people checking a plot: the DP remark, reservations, the colours of the
// sheet. Each leads to the Pune DP plan on satellite (/pune/dp-report/). Their bodies are in src/site/Guide.tsx.
import type { Guide } from './data';
import { SITE_NAME } from '../brand';

const UPDATED = '2026-11-11';

export const DP_GUIDES: Guide[] = [
  {
    slug: 'dp-remark-zone-certificate-pune',
    title: 'How to get a DP remark (zone certificate) in Pune',
    h1: 'How to get a DP remark or zone certificate in Pune',
    description: 'What a DP remark or zone certificate says, who issues it in Pune (PMC, PCMC, PMRDA), what to apply with, and how to check the DP yourself first.',
    answer: `A DP remark (often called a zone certificate or DP opinion) is the planning authority’s written statement of what the Development Plan shows for a piece of land: its zone, any reservation on it and any road line through it. In the Pune Municipal Corporation’s limits you apply to the PMC, in Pimpri-Chinchwad to the PCMC, and in the rest of the Pune region to PMRDA. Identify the land by its survey, CTS or final plot number, with the 7/12 extract or property card and a location plan. Look at the plan yourself first on the ${SITE_NAME} Pune DP plan, so you know what to expect.`,
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['Is a DP remark the same as a zone certificate?', 'In everyday use, yes: both state what the Development Plan (or, outside municipal limits, the Regional Plan) shows for a survey or CTS number. Some authorities issue them as separate documents with slightly different contents; ask for the one your bank, buyer or architect needs.'],
      ['Who issues it for my land?', 'The planning authority whose plan covers it: the PMC inside Pune’s municipal limits (the merged villages have their own DP), the PCMC in Pimpri-Chinchwad, the Cantonment Boards in the cantonments, and PMRDA in the rest of the Pune region, which issues several planning certificates online.'],
      ['What do I need to apply?', 'Papers that identify the land beyond doubt: the survey, CTS or final plot number, the 7/12 extract or property card, and a location plan or village map extract, plus the fee. The authority’s office or portal lists the exact documents and fee, which change from time to time.'],
      ['Why check the DP myself first?', `So there are no surprises: you see whether a road line or a reservation is near the plot before you apply, and you can ask the right questions. The ${SITE_NAME} Pune DP plan shows the traced zones and reservations over the plot in a minute.`],
      [`Is the ${SITE_NAME} report a DP remark?`, 'No. It is the sanctioned DP sheets, traced and laid over satellite imagery to within a few metres, as a first look. Only the planning authority’s certificate is official.'],
    ],
    related: ['check-dp-reservation-pune', 'pune-dp-colour-code', 'dp-road-affects-property', 'what-is-development-plan'],
    sources: ['pmc'],
  },
  {
    slug: 'check-dp-reservation-pune',
    title: 'How to check if a plot is reserved in the Pune DP',
    h1: 'Is my plot reserved in the Pune DP? How to check',
    description: 'How to see if land in Pune is reserved in the Development Plan for a garden, school or other public use, what it means for owners, and what to do next.',
    answer: `Find the plot on the sanctioned Development Plan sheet and look for a reservation: an area outlined in red and marked with a code and a number (PG for a playground, for example). On the ${SITE_NAME} Pune DP plan, click the plot on the satellite image: it tells you whether the plot is in a reserved site, lists the reserved sites within 250 m and shows the DP roads near it. Confirm what you find with a DP remark from the PMC before you buy or build.`,
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['What does a reservation mean for the owner?', 'The land is earmarked for a public use, so it can’t be developed like the zone around it. The authority acquires it by paying compensation or, often in Pune, by granting TDR or FSI to the owner who hands it over; some reservations can be developed by the owner under the rules.'],
      ['Can a reservation lapse?', 'The Maharashtra Regional and Town Planning Act has a procedure (section 127) by which an owner can serve notice when reserved land isn’t acquired within the time the Act sets, after which the reservation can lapse. The conditions and dates matter: take a lawyer’s advice on your case.'],
      ['A neighbouring plot is reserved. Does it affect mine?', 'Not directly: your plot keeps its own zone. But a garden or school next door changes the neighbourhood, and a DP road line along your frontage does take land. Check both on the map.'],
      ['How accurate is the reservation outline?', 'It is traced from the scanned sheets and registered to within a few metres. Where a reservation runs close to your boundary, only the DP remark and a survey can say exactly where it falls.'],
    ],
    related: ['dp-remark-zone-certificate-pune', 'pune-dp-colour-code', 'dp-road-affects-property', 'tdr-premium-fsi'],
    sources: ['pmc', 'udd'],
  },
  {
    slug: 'pune-dp-colour-code',
    title: 'Pune DP colour codes: what each colour means',
    h1: 'Pune DP colour codes: what each colour on the plan means',
    description: 'Pune DP colours: yellow residential, blue commercial, pink public / semi-public, green gardens and more, and how reservations and roads are drawn.',
    answer: 'On Pune’s sanctioned Development Plan, yellow is residential, blue is commercial, purple is industrial, pink is public and semi-public use, green is gardens and playgrounds, olive is hill top and hill slope, and pale blue is water. Reserved sites are outlined in red with a code and a number, and planned roads are drawn as parallel lines at their planned width. The table below gives every colour as measured on the PMC’s sheets.',
    city: 'pune',
    updated: UPDATED,
    faq: [
      ['What does yellow mean on the DP?', 'Residential zone: homes, with the shops and services the rules allow in it. A deeper yellow marks housing for the economically weaker section or slum improvement.'],
      ['What does pink mean on the DP?', 'Public and semi-public use: schools, hospitals, government offices and the like. Pink land outlined in red is a site reserved for one such use.'],
      ['What does green mean on the DP?', 'Gardens, playgrounds and parks (recreational). A darker green is forest; olive is hill top and hill slope, where building is heavily restricted.'],
      ['Are the colours the same in every city?', 'Broadly: Maharashtra’s Development Plans follow similar conventions, but shades and categories differ between plans and editions. Always read the legend of the sheet you are looking at.'],
    ],
    related: ['what-is-development-plan', 'check-dp-reservation-pune', 'dp-remark-zone-certificate-pune', 'dp-road-affects-property'],
    sources: ['pmc'],
  },
];
