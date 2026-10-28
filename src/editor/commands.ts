// Every action in one registry: menus, the command palette (Ctrl+K) and keyboard shortcuts all use it.
import type { Editor } from './editor';
import { isTyping } from './editor';
import * as ops from '../doc/ops';
import * as xs from '../doc/xsection';
import {
  accuracyView, anchorSel, dialog, leftTab, mode, paletteOpen, profileOpen, readOnly, select, selection, toast, tool, xray,
} from './state';
import type { Id, SectionObj } from '../doc/types';
import type { Part } from '../net/model';

export interface Command {
  id: string;
  label: string;
  group: 'File' | 'Edit' | 'Road' | 'Junction' | 'View' | 'Tools' | 'Review' | 'Help';
  keys?: string;
  /** shown greyed out / skipped when false */
  enabled?: (E: Editor) => boolean;
  run: (E: Editor) => void;
}

const sel1 = () => selection.value.length === 1 ? selection.value[0] : null;
const hasRoads = (E: Editor) => E.selectedSections().length > 0;
const editable = () => !readOnly.value;

/** Apply a cross-section change to the selection: road-level for selected roads, section-level for sections. */
export function editParts(E: Editor, label: string, f: (p: Part[], s: SectionObj) => Part[]) {
  E.edit(label, () => {
    for (const s of selection.value) {
      if (s.kind === 'road') {
        const secs = E.doc.sectionsOf(s.id);
        if (!secs.length) continue;
        // road level: the longest section's cross-section, changed, for the whole road
        const lead = secs.reduce((a, b) => ((E.C.geo(a.id)?.len ?? 0) >= (E.C.geo(b.id)?.len ?? 0) ? a : b));
        E.doc.set(s.id, 'parts', f(lead.parts, lead));
      } else if (s.kind === 'section') {
        const o = E.doc.get<'section'>(s.id);
        if (o) E.doc.set(s.id, 'parts', f(o.parts, o));
      }
    }
  });
}

function eachSection(E: Editor, label: string, f: (s: SectionObj) => void) {
  const secs = E.selectedSections();
  if (!secs.length) return;
  E.edit(label, () => { for (const s of secs) f(s); });
}

function junctionsSel(E: Editor): Id[] {
  return selection.value.filter((s) => s.kind === 'junction').map((s) => s.id).filter((id) => E.doc.get(id));
}

export const COMMANDS: Command[] = [
  // ---- File ----
  { id: 'file.new', label: 'New map (start from the base map)', group: 'File', run: (E) => E.app.newMap() },
  { id: 'file.open', label: 'Open…', group: 'File', keys: 'Ctrl+O', run: () => { dialog.value = 'open'; } },
  { id: 'file.save', label: 'Save', group: 'File', keys: 'Ctrl+S', run: (E) => void E.app.save() },
  { id: 'file.saveas', label: 'Save a copy…', group: 'File', keys: 'Ctrl+Shift+S', run: (E) => void E.app.save(true) },
  { id: 'file.download', label: 'Download map file', group: 'File', run: (E) => E.app.download() },
  { id: 'file.export', label: 'Export (GeoJSON, network)…', group: 'File', run: () => { dialog.value = 'export'; } },
  { id: 'file.publish', label: 'Publish…', group: 'File', run: () => { dialog.value = 'publish'; } },
  { id: 'file.fork', label: 'Edit a copy of this map', group: 'File', enabled: () => readOnly.value, run: (E) => E.app.fork() },
  { id: 'file.settings', label: 'Settings…', group: 'File', run: () => { dialog.value = 'settings'; } },

  // ---- Edit ----
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', enabled: (E) => E.doc.canUndo, run: (E) => E.doc.undo() },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Shift+Z', enabled: (E) => E.doc.canRedo, run: (E) => E.doc.redo() },
  { id: 'edit.redo2', label: 'Redo', group: 'Edit', keys: 'Ctrl+Y', enabled: (E) => E.doc.canRedo, run: (E) => E.doc.redo() },
  {
    id: 'edit.delete', label: 'Delete', group: 'Edit', keys: 'Delete', enabled: () => selection.value.length > 0 || !!anchorSel.value,
    run: (E) => {
      if (anchorSel.value && tool.value === 'direct' && E.deleteAnchor()) return;
      const sel = selection.value;
      E.edit('Delete', () => {
        for (const s of sel) {
          if (s.kind === 'road') ops.deleteRoad(E.doc, s.id);
          else if (s.kind === 'section') ops.deleteSections(E.doc, [s.id]);
          else if (s.kind === 'junction') ops.deleteJunction(E.doc, s.id);
          else if (s.kind === 'line' || s.kind === 'building') E.doc.remove(s.id);
        }
      });
      select([]);
    },
  },
  { id: 'edit.delete2', label: 'Delete', group: 'Edit', keys: 'Backspace', enabled: () => selection.value.length > 0 || !!anchorSel.value, run: (E) => COMMANDS.find((c) => c.id === 'edit.delete')!.run(E) },
  {
    id: 'edit.selectview', label: 'Select all roads in view', group: 'Edit', keys: 'Ctrl+A',
    run: (E) => {
      const ids = E.hit.inRect(...E.view.rect, ['section'], E.canPick);
      select([...new Set(ids.map((id) => E.doc.get<'section'>(id)!.road))].map((id) => ({ kind: 'road' as const, id })));
    },
  },
  {
    id: 'edit.escape', label: 'Deselect / step out', group: 'Edit', keys: 'Escape',
    run: (E) => {
      if (E.pen.pts.length || E.linePts.length) { if (tool.value === 'pen' && E.pen.pts.length >= 2) E.finishPen(); else E.cancelPen(); return; }
      if (tool.value !== 'select') { E.setTool('select'); return; }
      const s = sel1();
      if (s?.kind === 'section') { const o = E.doc.get<'section'>(s.id); if (o) { select([{ kind: 'road', id: o.road }]); return; } }
      select([]);
    },
  },
  {
    id: 'edit.enter', label: 'Finish drawing / step into road', group: 'Edit', keys: 'Enter',
    run: (E) => {
      if (tool.value === 'pen') { E.finishPen(); return; }
      if (tool.value === 'line') { E.finishLine(); return; }
      const s = sel1();
      if (s?.kind === 'road') select(E.doc.sectionsOf(s.id).map((x) => ({ kind: 'section' as const, id: x.id })));
    },
  },
  ...([['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]] as const).flatMap(([k, dx, dz]) => [
    { id: `edit.nudge.${k}`, label: `Nudge ${k.replace('Arrow', '').toLowerCase()} 0.1 m`, group: 'Edit' as const, keys: k, enabled: () => selection.value.length > 0 && editable(), run: (E: Editor) => E.edit('Nudge', () => ops.translate(E.doc, selection.value.map((s) => s.id), dx * 0.1, dz * 0.1), 'nudge') },
    { id: `edit.nudge.${k}.big`, label: `Nudge ${k.replace('Arrow', '').toLowerCase()} 1 m`, group: 'Edit' as const, keys: `Shift+${k}`, enabled: () => selection.value.length > 0 && editable(), run: (E: Editor) => E.edit('Nudge', () => ops.translate(E.doc, selection.value.map((s) => s.id), dx, dz), 'nudge') },
  ]),

  // ---- Road ----
  { id: 'road.widen', label: 'Widen by 0.5 m', group: 'Road', keys: ']', enabled: hasRoads, run: (E) => editParts(E, 'Widen', (p) => xs.setTotalWidth(p, xs.totalWidth(p) + 0.5)) },
  { id: 'road.narrow', label: 'Narrow by 0.5 m', group: 'Road', keys: '[', enabled: hasRoads, run: (E) => editParts(E, 'Narrow', (p) => xs.setTotalWidth(p, Math.max(3, xs.totalWidth(p) - 0.5))) },
  { id: 'road.widen.big', label: 'Widen by 3 m', group: 'Road', keys: 'Shift+]', enabled: hasRoads, run: (E) => editParts(E, 'Widen', (p) => xs.setTotalWidth(p, xs.totalWidth(p) + 3)) },
  { id: 'road.narrow.big', label: 'Narrow by 3 m', group: 'Road', keys: 'Shift+[', enabled: hasRoads, run: (E) => editParts(E, 'Narrow', (p) => xs.setTotalWidth(p, Math.max(3, xs.totalWidth(p) - 3))) },
  { id: 'road.lane.add', label: 'Add a lane each way', group: 'Road', keys: 'Alt+]', enabled: hasRoads, run: (E) => editParts(E, 'Add lane', (p) => { const n = xs.laneCount(p); return xs.isOneway(p) ? xs.setLanes(p, n.f + 1, 0) : xs.setLanes(p, n.f + 1, n.b + 1); }) },
  { id: 'road.lane.remove', label: 'Remove a lane each way', group: 'Road', keys: 'Alt+[', enabled: hasRoads, run: (E) => editParts(E, 'Remove lane', (p) => { const n = xs.laneCount(p); return xs.isOneway(p) ? xs.setLanes(p, Math.max(1, n.f - 1), 0) : xs.setLanes(p, Math.max(1, n.f - 1), Math.max(n.f > 1 ? 1 : 0, n.b - 1)); }) },
  { id: 'road.oneway', label: 'Toggle one-way', group: 'Road', enabled: hasRoads, run: (E) => editParts(E, 'One-way', (p) => xs.makeOneway(p, !xs.isOneway(p))) },
  { id: 'road.median', label: 'Toggle median', group: 'Road', enabled: hasRoads, run: (E) => editParts(E, 'Median', (p) => xs.setMedian(p, xs.hasMedian(p) ? 0 : 1.2)) },
  { id: 'road.footpaths', label: 'Footpaths 2 m both sides', group: 'Road', enabled: hasRoads, run: (E) => editParts(E, 'Footpaths', (p) => xs.setFootpath(xs.setFootpath(p, 'L', 2), 'R', 2)) },
  {
    id: 'road.dp', label: 'Use the Development Plan width', group: 'Road', enabled: (E) => E.selectedSections().some((s) => s.reserve),
    run: (E) => editParts(E, 'DP width', (p, s) => (s.reserve ? xs.setTotalWidth(p, s.reserve) : p)),
  },
  { id: 'road.straighten', label: 'Straighten', group: 'Road', enabled: hasRoads, run: (E) => eachSection(E, 'Straighten', (s) => ops.straighten(E.doc, s.id)) },
  { id: 'road.smooth', label: 'Smooth curve', group: 'Road', enabled: hasRoads, run: (E) => eachSection(E, 'Smooth', (s) => ops.smoothSection(E.doc, s.id)) },
  {
    id: 'road.arc', label: 'Make a circular arc…', group: 'Road', enabled: hasRoads,
    run: (E) => { const r = Number(prompt('Arc radius (m)', '60')); if (r > 0) eachSection(E, 'Arc', (s) => ops.arcSection(E.doc, s.id, r)); },
  },
  { id: 'road.reverse', label: 'Reverse direction', group: 'Road', keys: 'Shift+R', enabled: hasRoads, run: (E) => eachSection(E, 'Reverse', (s) => ops.reverseSection(E.doc, s.id)) },
  {
    id: 'road.verify', label: 'Mark as verified', group: 'Review', keys: 'Y', enabled: hasRoads,
    run: (E) => { const secs = E.selectedSections(); const on = !secs.every((s) => s.verified); E.edit(on ? 'Verified' : 'Unverified', () => { for (const s of secs) E.doc.set(s.id, 'verified', on); }); toast(on ? `${secs.length} section(s) verified` : 'Verification removed', 'ok'); },
  },
  {
    id: 'road.separate', label: 'Make selected sections a separate road', group: 'Road', enabled: (E) => selection.value.some((s) => s.kind === 'section'),
    run: (E) => { const ids = selection.value.filter((s) => s.kind === 'section').map((s) => s.id); const rid = E.edit('Separate road', () => ops.regroup(E.doc, ids)); if (rid) select([{ kind: 'road', id: rid }]); },
  },
  {
    id: 'road.reset', label: 'Reset to the imported road', group: 'Road', enabled: (E) => E.selectedSections().some((s) => E.doc.patch.has(s.id)) || selection.value.some((s) => s.kind === 'road' && E.doc.patch.get(s.id)?.set),
    run: (E) => E.edit('Reset', () => { for (const s of selection.value) E.doc.reset(s.id); for (const s of E.selectedSections()) if (E.doc.base.has(s.id)) E.doc.reset(s.id); }),
  },

  // ---- Junction ----
  { id: 'junction.signals', label: 'Toggle traffic signals', group: 'Junction', enabled: (E) => junctionsSel(E).length > 0, run: (E) => E.edit('Signals', () => { for (const id of junctionsSel(E)) E.doc.set(id, 'signals', !E.doc.get<'junction'>(id)!.signals); }) },
  {
    id: 'junction.roundabout', label: 'Make / remove roundabout', group: 'Junction', enabled: (E) => junctionsSel(E).length > 0,
    run: (E) => E.edit('Roundabout', () => { for (const id of junctionsSel(E)) { const j = E.doc.get<'junction'>(id)!; if (j.R) E.doc.update(id, { R: undefined, ringLanes: undefined }); else E.doc.update(id, { R: 14, ringLanes: 1 }); } }),
  },
  {
    id: 'junction.dissolve', label: 'Dissolve junction (join its two sections)', group: 'Junction', enabled: (E) => junctionsSel(E).some((id) => E.doc.sectionsAt(id).length === 2),
    run: (E) => { for (const id of junctionsSel(E)) { const s = E.edit('Join', () => ops.joinAt(E.doc, id)); if (s) select([{ kind: 'section', id: s }]); } },
  },

  // ---- Tools ----
  { id: 'tool.select', label: 'Select tool', group: 'Tools', keys: 'V', run: (E) => E.setTool('select') },
  { id: 'tool.direct', label: 'Edit points tool', group: 'Tools', keys: 'A', run: (E) => E.setTool('direct') },
  { id: 'tool.pen', label: 'Draw road tool', group: 'Tools', keys: 'P', enabled: editable, run: (E) => E.setTool('pen') },
  { id: 'tool.knife', label: 'Split / join tool', group: 'Tools', keys: 'K', enabled: editable, run: (E) => E.setTool('knife') },
  { id: 'tool.line', label: 'Draw utility / rail line tool', group: 'Tools', keys: 'L', enabled: editable, run: (E) => E.setTool('line') },
  { id: 'tool.measure', label: 'Measure tool', group: 'Tools', keys: 'M', run: (E) => E.setTool('measure') },
  { id: 'tool.hand', label: 'Hand (pan) tool', group: 'Tools', keys: 'H', run: (E) => E.setTool('hand') },

  // ---- View ----
  { id: 'view.toggle3d', label: 'Switch 2D / 3D', group: 'View', keys: 'Tab', run: (E) => E.setMode(mode.value === '2d' ? '3d' : '2d') },
  { id: 'view.xray', label: 'X-ray (see underground)', group: 'View', keys: 'X', run: (E) => { E.setXray(!xray.value); if (xray.value && mode.value === '2d') E.setMode('3d'); } },
  { id: 'view.dp', label: 'Development Plan sheets', group: 'View', keys: 'D', run: (E) => E.app.toggleLayer('dp') },
  { id: 'view.accuracy', label: 'Accuracy view (where widths come from)', group: 'View', keys: 'Shift+A', run: (E) => { accuracyView.value = !accuracyView.value; E.overlayDirty = true; } },
  { id: 'view.fit', label: 'Zoom to the whole map', group: 'View', keys: 'Shift+1', run: (E) => { const h = E.world.tile.half; E.zoomTo([-h, -h, h, h]); } },
  { id: 'view.sel', label: 'Zoom to selection', group: 'View', keys: 'Shift+2', enabled: () => selection.value.length > 0, run: (E) => E.zoomToSelection() },
  { id: 'view.zoomin', label: 'Zoom in', group: 'View', keys: '=', run: (E) => { E.view.zoomAt(E.view.w / 2, E.view.h / 2, 1.5); E.world.needsRender = true; } },
  { id: 'view.zoomout', label: 'Zoom out', group: 'View', keys: '-', run: (E) => { E.view.zoomAt(E.view.w / 2, E.view.h / 2, 1 / 1.5); E.world.needsRender = true; } },
  { id: 'view.profile', label: 'Height profile panel', group: 'View', keys: 'Shift+P', run: () => { profileOpen.value = !profileOpen.value; } },
  { id: 'view.layers', label: 'Show layers', group: 'View', run: () => { leftTab.value = 'layers'; } },
  { id: 'view.issues', label: 'Show issues', group: 'View', keys: 'I', run: () => { leftTab.value = 'issues'; } },
  { id: 'view.palette', label: 'Command palette', group: 'View', keys: 'Ctrl+K', run: () => { paletteOpen.value = true; } },
  { id: 'view.palette2', label: 'Command palette', group: 'View', keys: 'Ctrl+/', run: () => { paletteOpen.value = true; } },

  // ---- Review ----
  { id: 'review.next', label: 'Next road to review', group: 'Review', keys: 'N', run: (E) => E.app.reviewNext() },
  { id: 'review.open', label: 'Open the review queue', group: 'Review', run: () => { leftTab.value = 'review'; } },

  // ---- Help ----
  { id: 'help.keys', label: 'Keyboard shortcuts & help', group: 'Help', keys: '?', run: () => { dialog.value = 'help'; } },
  { id: 'help.about', label: 'About & data sources', group: 'Help', run: () => { dialog.value = 'about'; } },
];

/** "Ctrl+Shift+Z" style key name for an event. */
export function keyName(e: KeyboardEvent): string {
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (k.length === 1) {
    // letters by code so Shift / Alt don't change them; symbols as typed except shifted brackets / digits
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (e.code === 'BracketLeft') k = '[';
    else if (e.code === 'BracketRight') k = ']';
    else if (e.code === 'Equal') k = '=';
    else if (e.code === 'Minus') k = '-';
    else if (e.code === 'Slash') k = e.shiftKey ? '?' : '/';
  }
  if (e.shiftKey && k !== '?') mods.push('Shift');
  return [...mods.sort((a, b) => ['Ctrl', 'Alt', 'Shift'].indexOf(a) - ['Ctrl', 'Alt', 'Shift'].indexOf(b)), k].join('+');
}

export function bindShortcuts(E: Editor) {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e) || paletteOpen.value || dialog.value) return;
    const name = keyName(e);
    // the 3D camera flies with W A S D Q E R F
    if (mode.value === '3d' && /^[WASDQERF]$/.test(name)) return;
    const cmd = COMMANDS.find((c) => c.keys === name);
    if (!cmd) return;
    e.preventDefault();
    if (cmd.enabled && !cmd.enabled(E)) return;
    cmd.run(E);
  });
}
