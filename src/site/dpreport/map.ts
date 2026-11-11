// The DP report's map (Leaflet, loaded only on the DP report pages): satellite imagery, with the Development Plan
// over it either as the traced zones (coloured parcels, reserved sites outlined) or as the scanned DP sheets
// themselves, registered to the city. Click anywhere to pick a point.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cellsIn, loadCell, loadIndex, loadTiles, tileUrl, toLatLon, type Parcel } from './geo';

export type Overlay = 'zones' | 'sheet' | 'none';
export const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ROADS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
export const IMAGERY_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';
/** zones and sheets show from this zoom (below it there'd be too much to draw) */
export const MIN_DP_ZOOM = 14;

export interface DpMap {
  setOverlay(o: Overlay): void;
  setOpacity(v: number): void;
  setLabels(on: boolean): void;
  pick(lat: number, lon: number, fly?: boolean): void;
  highlight(p: Parcel | null): void;
  flyTo(lat: number, lon: number, zoom?: number): void;
  zoom(): number;
  destroy(): void;
}

export async function createMap(el: HTMLElement, o: {
  lat: number; lon: number; zoom: number; overlay: Overlay; opacity: number;
  ring?: { lat: number; lon: number; r: number };
  onPick: (lat: number, lon: number) => void;
  onZoom?: (z: number) => void;
}): Promise<DpMap> {
  const I = await loadIndex();
  const map = L.map(el, { zoomControl: false, attributionControl: true, preferCanvas: true, minZoom: 11, maxZoom: 20 }).setView([o.lat, o.lon], o.zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  L.tileLayer(ESRI_IMAGERY, { maxNativeZoom: 19, maxZoom: 20, attribution: IMAGERY_CREDIT, crossOrigin: 'anonymous' }).addTo(map);
  const labels = L.layerGroup([
    L.tileLayer(ESRI_ROADS, { maxNativeZoom: 19, maxZoom: 20, opacity: 0.8 }),
    L.tileLayer(ESRI_PLACES, { maxNativeZoom: 19, maxZoom: 20 }),
  ]).addTo(map);
  // the city frame's box, to show where the plan is when zoomed out
  const renderer = L.canvas({ padding: 0.3 });
  const zones = L.layerGroup().addTo(map), sheet = L.layerGroup(), roads = L.layerGroup().addTo(map);
  if (o.ring) L.circle([o.ring.lat, o.ring.lon], { radius: o.ring.r, color: '#fff', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
  let overlay = o.overlay, opacity = o.opacity;
  const drawnCells = new Map<string, L.Layer[]>(), drawnRoads = new Set<string>(), drawnTiles = new Map<string, L.ImageOverlay>();
  let hi: L.Layer | null = null, pin: L.Marker | null = null;

  const style = (p: Parcel): L.PathOptions => {
    const c = I.classes[p.cls]?.color ?? '#ccc';
    return p.reserved
      ? { renderer, color: '#e5484d', weight: 2, dashArray: '5 4', fillColor: c, fillOpacity: opacity * 0.85 }
      : { renderer, color: '#3f3f46', weight: 0.6, opacity: 0.7, fillColor: c, fillOpacity: opacity * 0.7 };
  };

  async function sync() {
    const z = map.getZoom();
    o.onZoom?.(z);
    const b = map.getBounds().pad(0.15);
    if (z < MIN_DP_ZOOM) { zones.clearLayers(); drawnCells.clear(); roads.clearLayers(); drawnRoads.clear(); sheet.clearLayers(); drawnTiles.clear(); return; }
    const keys = await cellsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    // zones and DP roads, by cell
    for (const [k, layers] of drawnCells) if (!keys.includes(k)) { for (const l of layers) zones.removeLayer(l); drawnCells.delete(k); }
    if (overlay === 'zones') {
      for (const k of keys) {
        if (drawnCells.has(k)) continue;
        drawnCells.set(k, []);
        const c = await loadCell(k);
        if (!drawnCells.has(k) || overlay !== 'zones') continue;
        const ls = c.plots.map((p) => L.polygon(p.polys as any, { ...style(p), interactive: false }).addTo(zones));
        (ls as any).forEach((l: any, i: number) => (l._dp = c.plots[i]));
        drawnCells.set(k, ls);
      }
    }
    for (const k of keys) {
      if (drawnRoads.has(k)) continue;
      drawnRoads.add(k);
      const c = await loadCell(k);
      for (const r of c.roads) {
        L.polyline(r.line, { renderer, color: '#e5484d', weight: 3, opacity: 0.9, interactive: false }).addTo(roads)
          .bindTooltip(`${r.name ?? 'DP road'}: ${r.w} m today, ${r.dp} m in the DP`, { sticky: true });
      }
    }
    // the scanned sheets, by 500 m tile
    if (overlay === 'sheet') {
      const T = await loadTiles(), F = I.frame;
      for (const t of T.tiles) {
        const [n, w] = toLatLon(F, t.x0, t.z0), [s, e] = toLatLon(F, t.x0 + t.size, t.z0 + t.size);
        const key = t.file, inView = b.intersects(L.latLngBounds([s, w], [n, e]));
        const have = drawnTiles.get(key);
        if (inView && !have) { const im = L.imageOverlay(await tileUrl(t), [[s, w], [n, e]], { opacity, interactive: false }); im.addTo(sheet); drawnTiles.set(key, im); }
        else if (!inView && have) { sheet.removeLayer(have); drawnTiles.delete(key); }
      }
    }
  }
  map.on('moveend', () => void sync());
  map.on('click', (e: L.LeafletMouseEvent) => o.onPick(e.latlng.lat, e.latlng.lng));
  void sync();

  const api: DpMap = {
    setOverlay(v) {
      overlay = v;
      zones.clearLayers(); drawnCells.clear(); sheet.clearLayers(); drawnTiles.clear();
      if (v === 'sheet') { map.removeLayer(zones); sheet.addTo(map); } else { map.removeLayer(sheet); zones.addTo(map); }
      if (v === 'none') map.removeLayer(zones);
      void sync();
    },
    setOpacity(v) {
      opacity = v;
      zones.eachLayer((l: any) => l.setStyle?.(style(l._dp)));
      for (const im of drawnTiles.values()) im.setOpacity(v);
    },
    setLabels(on) { if (on) labels.addTo(map); else map.removeLayer(labels); },
    pick(lat, lon, fly) {
      if (pin) pin.setLatLng([lat, lon]);
      else pin = L.marker([lat, lon], { icon: L.divIcon({ className: 'dpr-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] }), interactive: false }).addTo(map);
      if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 17), { duration: 0.8 });
    },
    highlight(p) {
      if (hi) map.removeLayer(hi);
      hi = p ? L.polygon(p.polys as any, { color: '#2f5bff', weight: 3, fill: false, interactive: false }).addTo(map) : null;
    },
    flyTo(lat, lon, zoom = 17) { map.flyTo([lat, lon], zoom, { duration: 0.8 }); },
    zoom: () => map.getZoom(),
    destroy() { map.remove(); },
  };
  return api;
}
