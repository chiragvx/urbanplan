// Public-purpose reservation codes printed on Pune's DP sheets (from the sheet legend), e.g. "PG 61" = play ground no. 61.
export const DP_CODES: Record<string, string> = {
  AQRM: 'Aquarium', AQSC: 'Aqua sports complex', APMC: 'Agricultural produce market', BC: 'Boat club', BGAS: 'Bio-gas plant',
  BST: 'Bus terminus', BU: 'Burial ground', BUA: 'Burial ground for animals', 'BT&FM': 'Bamboo trade and flea market',
  'C-2': 'Commercial centre', CC: 'Civic centre', 'CC&WT': 'Civic centre and water tank', CCC: 'Child care centre', CL: 'City library',
  CPG: "Children's play ground", CR: 'Cremation ground', 'CR&BU': 'Cremation and burial ground', D: 'Dispensary',
  'D&MH': 'Dispensary and maternity home', DB: 'Dhobi ghat', FB: 'Fire brigade', FC: 'Film city', FM: 'Fish market',
  FMKT: "Farmers' market", G: 'Garden', 'G&PG': 'Garden and play ground', H: 'Hospital', HC: 'Health centre',
  HDH: 'Housing the dishoused', HS: 'High school', 'HS&PG': 'High school and play ground', IC: 'Interchange',
  ITI: 'Industrial training institute', KGM: 'Kalagram', M: 'Market', MH: 'Maternity home', MK: 'Municipal kothi',
  MP: 'Municipal purpose', 'MP&PC': 'Municipal purpose and police chowky', 'MP&VM': 'Municipal purpose and vegetable market',
  MPG: 'Multi-purpose ground', MSEDCL: 'Electricity (MSEDCL)', MSTN: 'Metro station', 'MSTN&DT': 'Metro station and depot',
  'MU&AG': 'Museum and art gallery', MUH: 'Municipal housing', NG: 'Nala garden', NS: 'Night shelter', OAH: 'Old age home',
  OM: 'Otta market', ON: 'Octroi naka', P: 'Parking', 'P&MSTN': 'Parking and metro station', PC: 'Police chowky', PG: 'Play ground',
  PHADA: 'Public housing (PHADA)', PK: 'Park', PMPML: 'Bus depot (PMPML)', 'PMPML&TP': 'Bus depot and truck parking', PMRDA: 'PMRDA',
  PO: 'Post office', PS: 'Primary school', 'PS&CPG': "Primary school and children's play ground", 'PS&HS': 'Primary and high school',
  PSTN: 'Police station', PUH: 'Public housing', RFD: 'River front development', RP: 'Recreational purpose', 'S&HRC': 'Rehabilitation centre',
  SC: 'Shopping centre', 'SC&VM': 'Shopping centre and vegetable market', SCP: 'Science centre and planetarium', SI: 'Slum improvement',
  ST: 'State transport', STDM: 'Stadium', SW: 'Sewage works', TEL: 'Telephone exchange', TH: 'Transportation hub', TI: 'Timber industry',
  TRP: 'Transport parking', 'TP': 'Truck parking', UR: 'Utility reservation', VD: 'Vehicle depot', VM: 'Vegetable market',
  WH: 'Washing haud', WO: 'Ward office', WS: 'Water sports', WW: 'Water works', YGC: 'Youth guidance centre', EWS: 'Economically weaker section housing',
};

/** "PG 61" → { code: 'PG', no: '61', purpose: 'Play ground' } (purpose undefined for unknown codes). */
export function parseCode(s: string | undefined): { code: string; no: string; purpose?: string } | null {
  if (!s) return null;
  const m = /^\s*([A-Za-z][A-Za-z0-9&+\-]*)\s*[-/ ]?\s*(\d+[A-Za-z]?)?\s*$/.exec(s);
  if (!m) return { code: s.trim(), no: '', purpose: undefined };
  const code = m[1].toUpperCase().replace('+', '&');
  return { code, no: m[2] ?? '', purpose: DP_CODES[code] };
}

export const CODE_OPTIONS = Object.entries(DP_CODES).map(([k, v]) => ({ code: k, label: v })).sort((a, b) => a.code.localeCompare(b.code));
