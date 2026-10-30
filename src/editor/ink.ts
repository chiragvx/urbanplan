// Neutral colours of the drawing overlay that change with the UI theme (set by ui/theme.ts); most overlay colours
// are accents that read on both the light and the dark map.
export const ink = { text: '#1f2328', halo: 'rgba(255,255,255,0.85)', faint: 'rgba(60,60,60,0.25)', outline: '#111' };

export function setInk(dark: boolean) {
  ink.text = dark ? '#e8eaed' : '#1f2328';
  ink.halo = dark ? 'rgba(22,24,27,0.85)' : 'rgba(255,255,255,0.85)';
  ink.faint = dark ? 'rgba(220,220,220,0.22)' : 'rgba(60,60,60,0.25)';
  ink.outline = dark ? '#f2f2f2' : '#111';
}
