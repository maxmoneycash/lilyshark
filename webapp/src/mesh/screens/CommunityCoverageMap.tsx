import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type CoverageCache, type MapperReport, parseCoverage, refreshCoverage, refreshCoverageFromService, SHARED_COVERAGE_FINGERPRINT } from '../../lib/meshmapper';
import { sendAdvert } from '../radio';
import { useCoverageRadio } from './useCoverageRadio';
import CoverageCanvas from './CoverageCanvas';
import { CoverageIcon } from './CoverageControls';
import './community-coverage.css';

const CACHE_KEY = 'lilyshark.meshmapper.coverage.v1';
function restoreCache(): CoverageCache | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as CoverageCache | null;
    if (!cached || typeof cached.fingerprint !== 'string' || !Number.isFinite(cached.nextAllowed) || !Number.isFinite(cached.checkedAt)) return;
    if (cached.report) cached.report = parseCoverage(cached.report);
    return cached;
  } catch { return; }
}
const EMPTY: MapperReport = { success: true, region: 'OAK', region_name: 'Oakland', generated_at: 0, data_age_seconds: null, grid_squares: [] };
export default function CommunityCoverageMap({ children, focusNode }: { children: ReactNode; focusNode?: number }) {
  const [mode, setMode] = useState<'coverage' | 'radio'>('radio');
  const [area, setArea] = useState('oak');
  const [panel, setPanel] = useState<'sources' | 'radio'>();
  const [visitedRadio, setVisitedRadio] = useState(true);
  useEffect(() => { if (mode === 'radio') setVisitedRadio(true); }, [mode]);
  const [key, setKey] = useState('');
  const [cache, setCache] = useState<CoverageCache | undefined>(restoreCache);
  const [error, setError] = useState('');
  const [fetching, setFetching] = useState(false);
  const initialCache = useRef(cache);
  const requestGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    setFetching(true);
    void refreshCoverageFromService(initialCache.current).then(result => {
      if (!active || generation !== requestGeneration.current) return;
      setCache(result.cache); setError(result.error ?? '');
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result.cache)); } catch { /* The map can still show the in-memory snapshot. */ }
    }).finally(() => {
      if (active && generation === requestGeneration.current) setFetching(false);
    });
    return () => { active = false; };
  }, []);
  const busy = useRef(false);
  const [now, setNow] = useState(Date.now);
  const dialog = useRef<HTMLDialogElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusNode !== undefined) setMode('radio'); }, [focusNode]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (panel) dialog.current?.showModal(); else dialog.current?.close(); }, [panel]);
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    const generation = ++requestGeneration.current;
    setFetching(true); setError('');
    try {
      const result = key.trim() ? await refreshCoverage(key, cache) : await refreshCoverageFromService(cache);
      if (generation !== requestGeneration.current) return;
      setCache(result.cache); setError(result.error ?? ''); setNow(Date.now());
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result.cache)); }
      catch { setError('This browser could not save the coverage snapshot.'); }
    } finally {
      busy.current = false;
      if (generation === requestGeneration.current) setFetching(false);
    }
  }
  return <section className="community-map-screen" aria-label="Map workspace" data-mode={mode}>
    <div className="coverage-navigation">
      <div ref={tabs} className="coverage-tabs" role="tablist" aria-label="Map source" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'radio' : event.key === 'End' ? 'coverage' : mode === 'radio' ? 'coverage' : 'radio';
        setMode(next);
        tabs.current?.querySelector<HTMLButtonElement>(`#map-tab-${next}`)?.focus();
      }}>
        <button id="map-tab-radio" className="coverage-tab" role="tab" aria-controls="map-panel-radio" aria-selected={mode === 'radio'} tabIndex={mode === 'radio' ? 0 : -1} onClick={() => setMode('radio')}>My mesh</button>
        <button id="map-tab-coverage" className="coverage-tab" role="tab" aria-controls="map-panel-coverage" aria-selected={mode === 'coverage'} tabIndex={mode === 'coverage' ? 0 : -1} onClick={() => setMode('coverage')}>Coverage</button>
      </div>
      <div className="coverage-actions"><button aria-label="My radio" title="My radio" onClick={() => setPanel('radio')}><CoverageIcon name="radio" /><span>My radio</span></button><button aria-label="Map data" title="Map data" onClick={() => setPanel('sources')}><CoverageIcon name="data" /><span>Map data</span></button></div>
    </div>
    <div id="map-panel-radio" className="coverage-mode" role="tabpanel" aria-labelledby="map-tab-radio" hidden={mode !== 'radio'}>{visitedRadio && children}</div>
    <div id="map-panel-coverage" className="coverage-mode" role="tabpanel" aria-labelledby="map-tab-coverage" hidden={mode !== 'coverage'}><CoverageCanvas report={cache?.report ?? EMPTY} area={area} openSources={() => setPanel('sources')} openRadio={() => setPanel('radio')} serviceStatus={fetching ? 'Refreshing survey data…' : 'Regional survey feed not connected'} refreshing={fetching} /></div>
    <dialog ref={dialog} className="coverage-dialog" onCancel={() => setPanel(undefined)} onClose={() => setPanel(undefined)} aria-labelledby="coverage-dialog-title">
      <div className="coverage-dialog-heading"><h2 id="coverage-dialog-title">{panel === 'radio' ? 'My radio' : 'Map data'}</h2><button className="coverage-icon-button" aria-label="Close map settings" onClick={() => setPanel(undefined)}><CoverageIcon name="close" /></button></div>
      {panel === 'radio' ? <RadioVisibility /> : <div className="coverage-settings">
        <label>Map area<select value={area} onChange={e => setArea(e.target.value)}><option value="oak">Oakland</option><option value="baus">San Francisco Bay Area</option><option value="sfo">San Francisco</option></select></label>
        <h3>Regional survey</h3>
        <p>Measured coverage appears automatically when your regional feed is available. Saved observations remain on this device between sessions.</p>
        <button disabled={fetching || !!(cache && now < cache.nextAllowed) || !!(cache && cache.fingerprint !== SHARED_COVERAGE_FINGERPRINT && !key.trim())} onClick={() => void refresh()}>{fetching ? 'REFRESHING…' : 'REFRESH SURVEY'}</button>
        {cache && now < cache.nextAllowed && <p className="coverage-note">Next refresh after {new Date(cache.nextAllowed).toLocaleTimeString()}. Refreshes are at least 15 minutes apart.</p>}
        {error && <p className="coverage-note" role="status">{error}</p>}
        {cache?.report && cache.fingerprint !== SHARED_COVERAGE_FINGERPRINT && !key.trim() && <p className="coverage-note">Reconnect your personal feed to refresh this saved survey.</p>}
        <details><summary>Connect a personal feed</summary><form onSubmit={event => { event.preventDefault(); void refresh(); }}>
          <p>Use an authorized regional API key to connect your own survey data.</p>
          <label>Coverage API key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <p className="coverage-note">Your key stays in memory for this page session. Only the survey snapshot is saved in this browser.</p>
          <button type="submit" className="primary" disabled={!key.trim() || fetching}>{fetching ? 'CONNECTING…' : 'CONNECT FEED'}</button>
        </form></details>
        {cache?.report && <button disabled={fetching} onClick={() => { requestGeneration.current += 1; setCache(undefined); setKey(''); setError(''); try { localStorage.removeItem(CACHE_KEY); } catch { /* no persisted cache */ } }}>REMOVE SAVED SURVEY</button>}
        <h3>What’s on the map</h3>
        {cache?.report ? <dl className="coverage-facts"><dt>Region</dt><dd>{cache.report.region_name}</dd><dt>Snapshot</dt><dd>{new Date(cache.report.generated_at * 1000).toLocaleString()}</dd><dt>Grid cells</dt><dd>{cache.report.grid_squares.length}</dd></dl> : <p>The public repeater directory is available without a coverage key. Directory pins do not represent surveyed coverage.</p>}
        <p>My mesh shows contacts and the connected radio with reported positions. Phone position, radio position, and community coverage are separate measurements.</p>
      </div>}
    </dialog>
  </section>;
}
function RadioVisibility() {
  const { state, link, realMeshCore, realMeshtastic, meshtastic, ownNode, telemetry, self, position, connected } = useCoverageRadio();
  const [announcement, setAnnouncement] = useState('');
  return <div className="coverage-settings">
    <div className="coverage-radio-status"><span className="coverage-node-symbol"><CoverageIcon name="radio" /></span><h3>{connected ? (self?.name ?? ownNode?.longName ?? 'T-Deck connected') : 'Connect your radio'}</h3></div>
    {!connected && <p>Use Connect in the app header to pair your T-Deck. Demo nodes are synthetic; they are not your radio or public coverage.</p>}
    {connected && <dl className="coverage-facts">
      <dt>Link</dt><dd>{realMeshtastic ? 'Meshtastic BLE' : self ? 'MeshCore companion' : 'Lilyshark USB analyzer'}</dd>
      <dt>Identity</dt><dd>{self?.publicKey ?? (realMeshtastic && state.myNodeNum !== undefined ? `!${state.myNodeNum.toString(16).padStart(8, '0')}` : link.node !== undefined ? `!${link.node.toString(16).padStart(8, '0')}` : 'Not reported')}</dd>
      <dt>Profile</dt><dd>{realMeshtastic ? !meshtastic ? 'Not reported' : meshtastic.usePreset ? `Meshtastic preset ${meshtastic.modemPreset}` : 'Meshtastic custom' : telemetry?.profile ?? (self ? 'MeshCore' : 'Not reported')}</dd>
      <dt>Frequency</dt><dd>{realMeshtastic ? meshtastic?.frequencyMHz !== undefined ? `${meshtastic.frequencyMHz.toFixed(3)} MHZ` : 'Not reported' : self ? `${(self.radioFreq / 1000).toFixed(3)} MHZ` : telemetry?.freqHz !== undefined ? `${(telemetry.freqHz / 1e6).toFixed(3)} MHZ` : 'Not reported'}</dd>
      <dt>Bandwidth</dt><dd>{realMeshtastic ? meshtastic?.bandwidthKHz !== undefined ? `${meshtastic.bandwidthKHz.toFixed(2)} KHZ` : 'Not reported' : self ? `${(self.radioBw / 1000).toFixed(2)} KHZ` : telemetry?.bwHz !== undefined ? `${(telemetry.bwHz / 1000).toFixed(2)} KHZ` : 'Not reported'}</dd>
      <dt>Spreading factor</dt><dd>{(realMeshtastic ? meshtastic?.spreadingFactor : self?.radioSf ?? telemetry?.sf) ?? 'Not reported'}</dd>
      {realMeshtastic && meshtastic && <><dt>Transmit</dt><dd>{meshtastic.txEnabled ? 'Enabled' : 'Disabled'}</dd></>}
      <dt>Reported position</dt><dd>{position ? `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}` : 'No usable position reported'}</dd>
      {telemetry?.sim && <><dt>Simulation</dt><dd>SYNTHETIC · not received over the air</dd></>}
    </dl>}
    <h3>Why your radio may not appear</h3>
    <p>Community coverage maps show repeaters and contributed observations. A powered-on handheld is not automatically a public map entry.</p>
    <p>Check the active RF profile, local frequency, bandwidth, spreading factor, and GPS fix. MeshCore and Meshtastic are separate networks. A connected USB or Bluetooth link does not confirm that another radio heard you.</p>
    <p>A repeater must be heard by the region’s observers. Handheld coverage is contributed through an authenticated survey session with location access and internet.</p>
    {realMeshCore && <><button onClick={async () => { try { await sendAdvert(false); setAnnouncement('Local announcement requested. Reception and public listing are not confirmed.'); } catch { setAnnouncement('The radio did not accept the announcement request. Check the connection.'); } }}>REQUEST LOCAL ANNOUNCEMENT</button><p role="status">{announcement}</p></>}
    <p>Public survey upload is not connected yet. A local announcement only sends over the radio; it does not publish your position to the internet.</p>
  </div>;
}
