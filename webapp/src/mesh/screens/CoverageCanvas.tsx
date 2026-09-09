import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { COVERAGE_LABELS, COVERAGE_TYPES, type CoverageType, filterCoverage, type MapperCell, type MapperRepeater, type MapperReport, repeaterID, validCoordinates } from '../../lib/meshmapper';
import CoverageTerrainPanel from './CoverageTerrainPanel';
import { clusterMapPoints } from './coverageCluster';
import { useCoverageRadio } from './useCoverageRadio';
import { CoverageIcon, CoverageScrollSurface } from './CoverageControls';
import { distanceMeters, type MapPoint } from '../../lib/terrainProfile';
import type { DirectoryRepeater } from '../../lib/communityDirectory';
import { fg, isLight, useThemeTick } from '../theme';

const AREA_VIEWS: Record<string, { name: string; center: L.LatLngTuple; zoom: number }> = {
  oak: { name: 'Oakland', center: [37.8044, -122.2712], zoom: 11 },
  baus: { name: 'San Francisco Bay Area', center: [37.65, -122.2], zoom: 9 },
  sfo: { name: 'San Francisco', center: [37.7749, -122.4194], zoom: 11 },
};
const COLORS: Record<CoverageType, string> = { BIDIR: '#40ba83', DISC: '#38b6ca', TX: '#e3a449', RX: '#a483db', DEAD: '#858e95', DROP: '#e57575' };
type Repeater = MapperRepeater & { directory?: boolean; frequencyMHz?: number };
const dateLabel = (epoch?: number | null) => epoch ? new Date(epoch * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not reported';
const observedTypes = (mask: number) => {
  if (!Number.isSafeInteger(mask) || mask < 0) return 'Not reported';
  const bits: [number, string][] = [[1, 'Two-way'], [2, 'Transmit'], [4, 'Receive'], [8, 'Discovery'], [16, 'Dead end'], [32, 'Dropped']];
  const names = bits.filter(([bit]) => Math.floor(mask / bit) % 2 === 1).map(([, name]) => name);
  if (mask >= 64) names.push('Additional types');
  return names.join(' · ') || 'None recorded';
};
const signalLabel = (value?: number | null) => value == null ? 'Unknown' : `${value.toFixed(1)} DB`;
const numberLabel = (value: number) => new Intl.NumberFormat().format(value);

export default function CoverageCanvas({ report, area, openSources, openRadio, serviceStatus }: { report: MapperReport; area: string; openSources: () => void; openRadio: () => void; serviceStatus?: string }) {
  useThemeTick();
  const light = isLight(), markerColor = fg();
  const radio = useCoverageRadio();
  const [directory, setDirectory] = useState<DirectoryRepeater[]>([]);
  const [directoryState, setDirectoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const [panel, setPanel] = useState<'filters' | 'repeaters'>();
  const [basemap, setBasemap] = useState<'street' | 'satellite'>('street');
  const [clusterMembers, setClusterMembers] = useState<Repeater[]>();
  const [measuring, setMeasuring] = useState(false);
  const [measurement, setMeasurement] = useState<MapPoint[]>([]);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [selectedRepeater, setSelectedRepeater] = useState<Repeater>();
  const [selected, setSelected] = useState<MapperCell>();
  const [types, setTypes] = useState<readonly string[]>(COVERAGE_TYPES);
  const [snr, setSNR] = useState('any');
  const [days, setDays] = useState('0');
  const [search, setSearch] = useState('');
  const [showRepeaters, setShowRepeaters] = useState(true);
  const [visibleCount, setVisibleCount] = useState(0);
  const [visibleRepeaters, setVisibleRepeaters] = useState<Repeater[]>([]);
  const [tileError, setTileError] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const div = useRef<HTMLDivElement>(null);
  const detailClose = useRef<HTMLButtonElement>(null);
  const filterControl = useRef<HTMLButtonElement>(null);
  const keyboardSelection = useRef(false);
  const map = useRef<L.Map>();
  const vectorMap = useRef<L.MaplibreGL>();
  const measuringRef = useRef(false);
  measuringRef.current = measuring;
  const hasCoverage = report.generated_at > 0;
  const view = AREA_VIEWS[area] ?? AREA_VIEWS.oak;
  const filtered = types.length !== COVERAGE_TYPES.length || snr !== 'any' || days !== '0';
  const cells = useMemo(() => filterCoverage(report, { types, minimumSNR: snr === 'any' ? undefined : Number(snr), since: days === '0' ? undefined : Date.now() / 1000 - Number(days) * 86400 }), [report, types, snr, days]);
  const repeaters: Repeater[] = useMemo(() => (report.repeaters ?? directory).filter(n => !search.trim() || `${n.name ?? ''} ${n.hex}`.toLowerCase().includes(search.trim().toLowerCase())), [report, directory, search]);
  const visibleIDs = useMemo(() => new Set(visibleRepeaters.map(repeaterID)), [visibleRepeaters]);
  const listedRepeaters = clusterMembers ?? (search.trim() ? [...visibleRepeaters, ...repeaters.filter(node => !visibleIDs.has(repeaterID(node)))] : visibleRepeaters);
  const counts = useMemo(() => Object.fromEntries(COVERAGE_TYPES.map(type => [type, cells.filter(c => c.coverage_type === type).length])), [cells]);
  useEffect(() => { if ((selected || selectedRepeater) && keyboardSelection.current) detailClose.current?.focus({ preventScroll: true }); }, [selected, selectedRepeater]);

  useEffect(() => {
    const controller = new AbortController();
    setDirectoryState('loading');
    fetch('/api/mesh-directory', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('directory');
      const body = await response.json() as { nodes: DirectoryRepeater[] };
      if (!Array.isArray(body.nodes)) throw new Error('directory');
      setDirectory(body.nodes.filter(n => typeof n.hex === 'string' && validCoordinates(n.lat, n.lon)));
      setDirectoryState('ready');
    }).catch(() => { if (!controller.signal.aborted) setDirectoryState('error'); });
    return () => controller.abort();
  }, [directoryAttempt]);

  useEffect(() => {
    if (!div.current) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instance = L.map(div.current, { preferCanvas: true, zoomControl: false, minZoom: 2, maxZoom: 20, zoomAnimation: !reduceMotion, fadeAnimation: !reduceMotion, markerZoomAnimation: !reduceMotion, maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1 }).setView(AREA_VIEWS.oak.center, AREA_VIEWS.oak.zoom);
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    instance.on('click', (event: L.LeafletMouseEvent) => {
      if (!measuringRef.current) return;
      setTerrainOpen(false);
      setMeasurement(previous => previous.length < 2 ? [...previous, { lat: event.latlng.lat, lon: event.latlng.lng }] : [{ lat: event.latlng.lat, lon: event.latlng.lng }]);
    });
    let resizeFrame = 0, vectorResizeFrame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(vectorResizeFrame);
      if (!entry.contentRect.width || !entry.contentRect.height) return;
      resizeFrame = requestAnimationFrame(() => {
        instance.invalidateSize({ pan: false });
        // The Leaflet adapter resizes its container but not the GL viewport.
        // Its container update uses another frame; resize GL after that update.
        vectorResizeFrame = requestAnimationFrame(() => {
          if (div.current?.clientWidth && div.current.clientHeight) vectorMap.current?.getMaplibreMap()?.resize();
        });
      });
    }); observer.observe(div.current);
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(vectorResizeFrame); instance.remove(); map.current = undefined; };
  }, []);
  useEffect(() => { if (measurement.length === 2) setMeasuring(false); }, [measurement]);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    let stopped = false, vector: L.MaplibreGL | undefined, failed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    setTileError(false); setUsingFallback(false);
    instance.getContainer().setAttribute('aria-busy', 'true');
    const raster = L.tileLayer(basemap === 'street' ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: basemap === 'street' ? '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' : 'Tiles &copy; Esri',
      maxZoom: 20, maxNativeZoom: basemap === 'street' ? 19 : 20,
      className: basemap === 'street' && !light ? 'coverage-street-tiles' : '',
    }).on('tileerror', () => setTileError(true)).on('load', () => { if (!vector || failed) instance.getContainer().setAttribute('aria-busy', 'false'); }).addTo(instance);
    const removeVector = () => {
      if (!vector) return;
      try { vector.remove(); } catch { vector.getContainer()?.remove(); }
      if (vectorMap.current === vector) vectorMap.current = undefined;
      vector = undefined;
    };
    const fallback = () => {
      if (stopped || failed) return;
      failed = true; clearTimeout(timeout);
      // Defer removal until the renderer has finished dispatching its event.
      queueMicrotask(() => { if (!stopped) { removeVector(); if (!instance.hasLayer(raster)) raster.addTo(instance); setUsingFallback(true); } });
    };
    if (basemap === 'street') {
      timeout = setTimeout(fallback, 15000);
      void import('./coverageVectorBasemap').then(({ createVectorBasemap }) => {
        if (stopped || failed) return;
        vector = createVectorBasemap(light);
        vector.addTo(instance);
        vectorMap.current = vector;
        vector.getMaplibreMap().on('dataloading', () => { if (!stopped) instance.getContainer().setAttribute('aria-busy', 'true'); });
        vector.getMaplibreMap().on('idle', () => { if (!stopped) instance.getContainer().setAttribute('aria-busy', 'false'); });
        vector.getMaplibreMap().on('load', () => { if (!stopped && !failed) { clearTimeout(timeout); raster.remove(); setTileError(false); } });
        vector.getMaplibreMap().on('error', fallback);
        vector.getMaplibreMap().on('webglcontextlost', fallback);
      }).catch(fallback);
    }
    return () => { stopped = true; clearTimeout(timeout); removeVector(); raster.remove(); };
  }, [basemap, light]);
  useEffect(() => { const next = AREA_VIEWS[area] ?? AREA_VIEWS.oak; map.current?.setView(next.center, next.zoom); }, [area]);
  useEffect(() => {
    const instance = map.current; if (!instance || !radio.position) return;
    const label = document.createElement('span');
    label.textContent = `${radio.name} · ${radio.telemetry?.sim ? 'Radio position · simulation on' : 'Radio’s reported position'}`;
    const marker = L.marker([radio.position.lat, radio.position.lon], {
      title: `${radio.name}, ${radio.telemetry?.sim ? 'simulated radio' : 'your radio'}`, zIndexOffset: 1000, bubblingMouseEvents: true,
      icon: L.divIcon({ className: 'coverage-own-radio', html: `<span class="coverage-own-radio-face"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="8" width="10" height="13" rx="2"/><path d="M9 8V3m2 10h2m-2 4h2m4-12a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/></svg>${radio.telemetry?.sim ? '<small>SIM</small>' : ''}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }),
    }).bindTooltip(label, { direction: 'top', className: 'coverage-own-radio-label' }).on('click', () => { if (!measuringRef.current) openRadio(); }).addTo(instance);
    return () => { marker.closeTooltip(); marker.unbindTooltip(); marker.remove(); };
  }, [radio.position?.lat, radio.position?.lon, radio.name, radio.telemetry?.sim, openRadio]);
  useEffect(() => {
    const bounds = filterCoverage(report, { types: COVERAGE_TYPES }).flatMap(c => [[c.bounds.south, c.bounds.west], [c.bounds.north, c.bounds.east]] as L.LatLngTuple[]);
    if (bounds.length) map.current?.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 14 });
    setSelected(undefined); setSelectedRepeater(undefined);
  }, [report]);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    const layer = L.layerGroup().addTo(instance);
    for (const [index, point] of measurement.entries()) L.marker([point.lat, point.lon], { interactive: false, keyboard: false, title: `Measurement point ${index === 0 ? 'A' : 'B'}`, icon: L.divIcon({ className: 'coverage-measure-point', html: `<span>${index === 0 ? 'A' : 'B'}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(layer);
    if (measurement.length === 2) {
      const label = document.createElement('span'); label.textContent = `${(distanceMeters(measurement[0], measurement[1]) / 1000).toFixed(2)} KM`;
      L.polyline(measurement.map(p => [p.lat, p.lon]), { color: markerColor, weight: 2, dashArray: '5 5', interactive: false }).bindTooltip(label, { permanent: true, direction: 'center', className: 'coverage-distance-label' }).addTo(layer);
    }
    return () => { layer.remove(); };
  }, [measurement, markerColor]);
  useEffect(() => {
    const instance = map.current; if (!instance) return;
    const layer = L.layerGroup().addTo(instance);
    const draw = () => {
      layer.clearLayers();
      const bounds = instance.getBounds();
      const visible = cells.filter(c => bounds.intersects([[c.bounds.south, c.bounds.west], [c.bounds.north, c.bounds.east]]));
      setVisibleCount(visible.length);
      for (const cell of visible.slice(0, 800)) {
        const color = COLORS[cell.coverage_type as CoverageType] ?? '#858e95';
        const active = selected?.grid_id === cell.grid_id;
        L.rectangle([[cell.bounds.south, cell.bounds.west], [cell.bounds.north, cell.bounds.east]], { fillColor: color, color: active ? markerColor : color, fillOpacity: active ? 0.55 : 0.32, weight: active ? 2 : 1 }).on('click', () => { if (!measuringRef.current) { setSelected(cell); setSelectedRepeater(undefined); setTerrainOpen(false); setPanel(undefined); } }).addTo(layer);
      }
      const nodes = repeaters.filter(n => validCoordinates(n.lat, n.lon) && bounds.contains([n.lat!, n.lon!]));
      setVisibleRepeaters(nodes);
      if (!showRepeaters) return;
      // Screen-space clustering merges neighboring buckets to keep labels apart.
      const groups = clusterMapPoints(nodes, node => instance.latLngToContainerPoint([node.lat!, node.lon!]));
      for (const cluster of groups) {
        const group = cluster.items;
        const coordinate = instance.containerPointToLatLng([cluster.x, cluster.y]);
        const lat = coordinate.lat, lon = coordinate.lng;
        if (group.length > 1) {
          const size = group.length < 10 ? 22 : group.length < 100 ? 24 : 28;
          const active = selectedRepeater && group.some(node => repeaterID(node) === repeaterID(selectedRepeater));
          L.marker([lat, lon], { bubblingMouseEvents: true, title: `${group.length} repeaters. ${instance.getZoom() >= 19 ? 'Show cluster members' : 'Zoom in to explore'}`, icon: L.divIcon({ className: `coverage-cluster${active ? ' is-selected' : ''}`, html: `<span class="coverage-cluster-face" style="width:${size}px;height:${size}px">${group.length}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }) }).on('click', () => {
            if (measuringRef.current) return;
            setSelected(undefined); setSelectedRepeater(undefined); setTerrainOpen(false);
            if (instance.getZoom() >= 19) { setClusterMembers([...group]); setPanel('repeaters'); }
            else instance.setView([lat, lon], Math.min(20, instance.getZoom() + 2));
          }).addTo(layer);
        } else {
          const node = group[0];
          const label = document.createElement('span'); label.textContent = node.name ?? node.hex;
          const active = selectedRepeater && repeaterID(node) === repeaterID(selectedRepeater);
          L.marker([lat, lon], { bubblingMouseEvents: true, title: node.name || 'Unnamed repeater', zIndexOffset: active ? 500 : 0, icon: L.divIcon({ className: `coverage-repeater${active ? ' is-selected' : ''}`, html: '<span class="coverage-repeater-face"></span>', iconSize: [44, 44], iconAnchor: [22, 22] }) })
            .bindTooltip(label).on('click', (event: L.LeafletMouseEvent) => { if (!measuringRef.current) { keyboardSelection.current = event.originalEvent instanceof KeyboardEvent; setSelectedRepeater(node); setSelected(undefined); setTerrainOpen(false); setPanel(undefined); } }).addTo(layer);
        }
      }
    };
    draw(); instance.on('moveend', draw);
    return () => { instance.off('moveend', draw); layer.remove(); };
  }, [cells, repeaters, showRepeaters, selected?.grid_id, selectedRepeater, markerColor]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('dialog'))) return;
      if (terrainOpen) setTerrainOpen(false);
      else if (selected || selectedRepeater) { closeDetail(); }
      else if (panel) setPanel(undefined);
      else if (measuring || measurement.length) { setMeasuring(false); setMeasurement([]); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [panel, selected, selectedRepeater, terrainOpen, measuring, measurement.length]);

  const closeDetail = (restoreFocus = true) => { setSelected(undefined); setSelectedRepeater(undefined); if (keyboardSelection.current && restoreFocus) filterControl.current?.focus({ preventScroll: true }); keyboardSelection.current = false; };
  const openPanel = (next: 'filters' | 'repeaters') => { closeDetail(false); setTerrainOpen(false); setClusterMembers(undefined); setPanel(next); };
  const clearMeasurement = () => { setMeasurement([]); setMeasuring(false); setTerrainOpen(false); };
  const resetFilters = () => { setTypes(COVERAGE_TYPES); setSNR('any'); setDays('0'); setShowRepeaters(true); };
  const selectRepeater = (node: Repeater, fromKeyboard = false) => {
    keyboardSelection.current = fromKeyboard;
    if (validCoordinates(node.lat, node.lon)) map.current?.setView([node.lat!, node.lon!], Math.max(14, map.current.getZoom()));
    setSelectedRepeater(node); setSelected(undefined); setTerrainOpen(false); setPanel(undefined);
  };
  return <div className="saved-coverage">
    <div className={`coverage-map-stage ${measuring ? 'is-measuring' : ''}`} data-detail={!!(selected || selectedRepeater || terrainOpen)}>
      <div ref={div} className="saved-coverage-canvas" aria-label="Community coverage and repeater map" />
      <div className="coverage-explorer coverage-surface">
        <h1 className="coverage-sr-only">Explore the mesh</h1>
        <div className="coverage-search-row"><CoverageIcon name="search" /><input aria-label="Find repeater" type="search" placeholder="Find a repeater" value={search} onFocus={() => openPanel('repeaters')} onChange={event => { setSearch(event.target.value); openPanel('repeaters'); }} /><button ref={filterControl} className={`coverage-icon-button ${panel === 'filters' || filtered ? 'is-selected' : ''}`} aria-label="Coverage filters" aria-expanded={panel === 'filters'} onClick={() => panel === 'filters' ? setPanel(undefined) : openPanel('filters')}><CoverageIcon name="filter" />{filtered && <span className="coverage-filter-dot" />}</button></div>
        <div className="coverage-summary"><button onClick={() => panel === 'repeaters' ? setPanel(undefined) : openPanel('repeaters')} aria-expanded={panel === 'repeaters'}><span className="coverage-repeater-dot" />{numberLabel(visibleRepeaters.length)} in view<CoverageIcon name="arrow" /></button><button className="coverage-summary-source" onClick={openSources} title={hasCoverage ? `${numberLabel(visibleCount)} survey cells in view` : serviceStatus || 'Directory positions. Connect a survey feed for measured coverage.'}>{hasCoverage ? 'Survey' : directoryState === 'loading' ? 'Loading…' : 'Directory'}<CoverageIcon name="data" /></button></div>
        {panel === 'filters' && <CoverageScrollSurface label="Coverage filters" className="coverage-explorer-scroll">
          <div className="coverage-panel-heading"><h2>Coverage filters</h2><button className="coverage-icon-button" aria-label="Close filters" onClick={() => setPanel(undefined)}><CoverageIcon name="close" /></button></div>
          <div className="coverage-filter-options"><fieldset disabled={!hasCoverage}><legend>Observation type</legend><div className="coverage-type-options">{COVERAGE_TYPES.map(type => <button key={type} aria-pressed={types.includes(type)} className={types.includes(type) ? 'is-selected' : ''} onClick={() => setTypes(value => value.includes(type) ? value.filter(t => t !== type) : [...value, type])}><i style={{ background: COLORS[type] }} />{COVERAGE_LABELS[type]}<span>{counts[type] ?? 0}</span></button>)}</div></fieldset>
            <div className="coverage-filter-selects"><label>Minimum SNR<select value={snr} disabled={!hasCoverage} onChange={event => setSNR(event.target.value)}><option value="any">Any signal</option><option value="-10">−10 DB</option><option value="0">0 DB</option><option value="10">10 DB</option></select></label><label>Observed within<select value={days} disabled={!hasCoverage} onChange={event => setDays(event.target.value)}><option value="0">All time</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></select></label></div>
            <label className="coverage-switch"><span>Repeater pins</span><input type="checkbox" checked={showRepeaters} onChange={event => setShowRepeaters(event.target.checked)} /></label>
            {!hasCoverage && <p className="coverage-secondary">Coverage filters become available when a survey feed is connected.</p>}
            <button className="coverage-text-button" onClick={resetFilters}>Reset filters</button>
          </div>
        </CoverageScrollSurface>}
        {panel === 'repeaters' && <CoverageScrollSurface label="Repeater search results" className="coverage-explorer-scroll">
          <div className="coverage-panel-heading"><h2>{clusterMembers ? `${numberLabel(clusterMembers.length)} at this location` : search.trim() ? `${numberLabel(repeaters.length)} matches worldwide` : 'Repeaters in view'}</h2><button className="coverage-icon-button" aria-label="Close repeater list" onClick={() => setPanel(undefined)}><CoverageIcon name="close" /></button></div>
          {listedRepeaters.slice(0, 50).map(node => <button className="coverage-repeater-row" key={repeaterID(node)} onClick={event => selectRepeater(node, event.detail === 0)}><span className="coverage-node-symbol"><CoverageIcon name="radio" /></span><span><strong>{node.name || 'Unnamed repeater'}</strong><small>{node.enabled === 2 ? 'Ambiguous identity' : `${node.hex.slice(0, 12).toUpperCase()}${node.hex.length > 12 ? '…' : ''}`}{!validCoordinates(node.lat, node.lon) ? ' · No position' : ''}</small></span><CoverageIcon name="arrow" /></button>)}
          {!listedRepeaters.length && <div className="coverage-list-empty"><strong>{directoryState === 'loading' ? 'Loading repeaters' : 'No repeaters found'}</strong><p>{search.trim() ? 'Try a shorter name or public key.' : 'Zoom out or move the map to explore another area.'}</p></div>}
          {listedRepeaters.length > 50 && <p className="coverage-list-footnote">Showing 50 of {numberLabel(listedRepeaters.length)}. Search by name to narrow the list.</p>}
        </CoverageScrollSurface>}
      </div>
      <div className="coverage-map-tools" aria-label="Map tools">
        <div className="coverage-tool-group coverage-surface"><button className="coverage-icon-button" aria-label="Center on my radio" title={radio.position ? "Center on my radio" : "Radio position unavailable"} disabled={!radio.position} onClick={() => { if (radio.position) map.current?.setView([radio.position.lat, radio.position.lon], 14); }}><CoverageIcon name="radio" /></button><button className={`coverage-icon-button ${basemap === 'satellite' ? 'is-selected' : ''}`} aria-label={basemap === 'street' ? 'Show satellite map' : 'Show street map'} title={basemap === 'street' ? 'Satellite map' : 'Street map'} onClick={() => setBasemap(value => value === 'street' ? 'satellite' : 'street')}><CoverageIcon name="layers" /></button><button className={`coverage-icon-button ${measuring || measurement.length ? 'is-selected' : ''}`} aria-label={measuring ? 'Cancel measurement' : 'Measure distance'} title="Measure distance" onClick={() => { if (measuring) clearMeasurement(); else { closeDetail(); setPanel(undefined); setMeasurement([]); setTerrainOpen(false); setMeasuring(true); } }}><CoverageIcon name="measure" /></button><button className="coverage-icon-button" aria-label="Center map on selected area" title={`Center on ${view.name}`} onClick={() => map.current?.setView(view.center, view.zoom)}><CoverageIcon name="locate" /></button></div>
        <div className="coverage-tool-group coverage-surface coverage-zoom-tools"><button className="coverage-icon-button" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><CoverageIcon name="plus" /></button><button className="coverage-icon-button" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><CoverageIcon name="minus" /></button></div>
      </div>
      {!!measurement.length || measuring ? <div className="coverage-measure-summary coverage-surface" role="status"><span className="coverage-node-symbol"><CoverageIcon name="measure" /></span><div><strong>{measurement.length === 2 ? `${(distanceMeters(measurement[0], measurement[1]) / 1000).toFixed(2)} KM` : `Choose point ${measurement.length ? 'B' : 'A'}`}</strong><small>{measurement.length === 2 ? 'Straight-line distance' : 'Click or tap anywhere on the map'}</small></div>{measurement.length === 2 && <button onClick={() => { closeDetail(); setPanel(undefined); setTerrainOpen(value => !value); }} aria-expanded={terrainOpen}><CoverageIcon name="terrain" />Terrain</button>}<button className="coverage-icon-button" aria-label="Clear measurement" onClick={clearMeasurement}><CoverageIcon name="close" /></button></div> : null}
      {(selected || selectedRepeater) && <section className="coverage-detail coverage-surface" aria-label={selected ? 'Coverage cell details' : 'Repeater details'}>
        <div className="coverage-detail-heading"><span className="coverage-eyebrow">{selected ? 'SURVEY OBSERVATION' : 'REPEATER'}</span><button ref={detailClose} className="coverage-icon-button" aria-label="Close detail" onClick={() => closeDetail()}><CoverageIcon name="close" /></button></div>
        <CoverageScrollSurface label="Map detail" className="coverage-detail-scroll">
          {selectedRepeater && <><h2>{selectedRepeater.name || 'Unnamed repeater'}</h2><p className="coverage-detail-meta">{selectedRepeater.frequencyMHz != null && <span>{selectedRepeater.frequencyMHz.toFixed(3)} MHZ · </span>}Last reported {dateLabel(selectedRepeater.last_heard)}</p><p className="coverage-secondary">{selectedRepeater.directory ? 'Directory position. Reception by your radio is unconfirmed.' : 'Community observation. Reception by your radio is unconfirmed.'}</p><details className="coverage-detail-disclosure"><summary>Details</summary><p className="coverage-identity">{selectedRepeater.hex}</p><dl className="coverage-detail-facts"><dt>Position</dt><dd>{validCoordinates(selectedRepeater.lat, selectedRepeater.lon) ? `${selectedRepeater.lat!.toFixed(5)}, ${selectedRepeater.lon!.toFixed(5)}` : 'Not reported'}</dd>{selectedRepeater.advert_bytes != null && <><dt>Path ID width</dt><dd>{selectedRepeater.advert_bytes} {selectedRepeater.advert_bytes === 1 ? 'byte' : 'bytes'}</dd></>}{selectedRepeater.enabled === 2 && <><dt>Identity</dt><dd>Ambiguous public-key prefix</dd></>}</dl></details><button className="coverage-detail-action" disabled={!validCoordinates(selectedRepeater.lat, selectedRepeater.lon)} onClick={() => { setMeasurement([{ lat: selectedRepeater.lat!, lon: selectedRepeater.lon! }]); setMeasuring(true); closeDetail(); }}><CoverageIcon name="measure" />Measure from here</button></>}
          {selected && <><h2><i className="coverage-status-dot" style={{ background: COLORS[selected.coverage_type as CoverageType] ?? '#858e95' }} />{COVERAGE_LABELS[selected.coverage_type as CoverageType] ?? 'Other observation'}</h2><p className="coverage-detail-meta">Observed {dateLabel(selected.timestamp)}</p><div className="coverage-cell-metrics"><div><strong>{selected.count == null ? '—' : numberLabel(selected.count)}</strong><span>Samples</span></div><div><strong>{signalLabel(selected.snr)}</strong><span>Average SNR</span></div></div>{selected.status_mask != null && <p className="coverage-secondary">Observed types: {observedTypes(selected.status_mask)}</p>}<details className="coverage-detail-disclosure"><summary>Details</summary><p className="coverage-identity">Cell {selected.grid_id}</p><dl className="coverage-detail-facts"><dt>SNR range</dt><dd>{signalLabel(selected.snr_min)} / {signalLabel(selected.snr_max)}</dd><dt>Noise above floor</dt><dd>{signalLabel(selected.noise)}</dd><dt>Quality</dt><dd>{selected.effective == null ? 'Unknown' : `${selected.effective} / 3`}</dd><dt>First seen</dt><dd>{dateLabel(selected.first_seen)}</dd></dl></details><p className="coverage-secondary">Cell summary. Individual packet routes are not included.</p></>}

        </CoverageScrollSurface>
      </section>}
      {terrainOpen && measurement.length === 2 && <CoverageTerrainPanel points={measurement} close={() => setTerrainOpen(false)} />}

      {(tileError || (directoryState === 'error' && !hasCoverage)) && <div className="coverage-map-error coverage-surface" role="status"><span>{tileError ? 'Some map tiles could not load. Try switching the map layer.' : 'The repeater directory is unavailable.'}</span>{directoryState === 'error' && <button onClick={() => setDirectoryAttempt(value => value + 1)}>Retry</button>}</div>}
      {hasCoverage && !cells.length && <div className="coverage-empty-filters coverage-surface" role="status"><strong>No matching coverage</strong><span>Try a wider time or signal range.</span><button onClick={resetFilters}>Reset filters</button></div>}
    </div>
    <div className="coverage-map-footer"><span className="coverage-provenance">{hasCoverage ? `Saved survey · ${dateLabel(report.generated_at)}` : 'Directory · coverage unmeasured'}{usingFallback ? ' · Basic map' : ''}</span>{hasCoverage && <div className="coverage-legend" aria-label="Coverage legend">{COVERAGE_TYPES.filter(type => counts[type] > 0).map(type => <span key={type}><i style={{ background: COLORS[type] }} />{COVERAGE_LABELS[type]}</span>)}{cells.some(cell => !COVERAGE_TYPES.includes(cell.coverage_type as CoverageType)) && <span><i style={{ background: "#858e95" }} />Other</span>}</div>}{visibleCount > 800 && <span>Zoom in to show all {numberLabel(visibleCount)} cells.</span>}</div>
  </div>;
}
