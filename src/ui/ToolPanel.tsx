// The panel above the bottom-left of the bar (Cities: Skylines' tool options): while a tool is in use it holds that
// tool's options; otherwise it is the inspector of what's selected.
import { lineLayer, tool } from '../editor/state';
import { RoadToolbar, TpHead, TpRow } from './RoadToolbar';
import { MultiToolbar } from './MultiToolbar';
import { TerrainToolbar } from './TerrainToolbar';
import { InspectorCard } from './Inspector';
import { ui } from './ctx';

const BUILD = ['pen', 'route', 'place', 'area', 'bulldoze'];

export function ToolPanel() {
  const t = tool.value;
  if (BUILD.includes(t)) return <RoadToolbar />;
  if (t === 'multi') return <MultiToolbar />;
  if (t === 'terrain') return <TerrainToolbar />;
  if (t === 'line') return <LineOptions />;
  return <InspectorCard />;
}

function LineOptions() {
  return (
    <div class="card tp" onPointerDown={(e) => e.stopPropagation()}>
      <TpHead kind="Draw a line" onClose={() => ui.E.setTool('select')} />
      <TpRow label="Layer" title="The layer the line is drawn into">
        <select class="select" value={lineLayer.value} onChange={(e) => { lineLayer.value = (e.currentTarget as HTMLSelectElement).value; }}>
          <option value="">Choose a layer…</option>
          {ui.doc.all('layer').filter((l) => l.type === 'lines').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </TpRow>
      <p class="tp-hint">Click points · <kbd>Enter</kbd> or double-click to finish</p>
    </div>
  );
}
