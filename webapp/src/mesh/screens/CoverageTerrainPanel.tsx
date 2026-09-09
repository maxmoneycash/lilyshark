import { useEffect, useMemo, useState } from 'react';
import { analyzeTerrain, distanceMeters, fetchTerrain, terrainSampleCount, type MapPoint } from '../../lib/terrainProfile';
import { CoverageIcon, CoverageScrollSurface } from './CoverageControls';

export default function CoverageTerrainPanel({ points, close }: { points: MapPoint[]; close: () => void }) {
  const [heightA, setHeightA] = useState('7'), [heightB, setHeightB] = useState('7'), [frequency, setFrequency] = useState('910.525');
  const [elevations, setElevations] = useState<number[]>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const distance = points.length === 2 ? distanceMeters(points[0], points[1]) : 0;
  useEffect(() => {
    const controller = new AbortController();
    let active = true; setLoading(true); setError(''); setElevations(undefined);
    if (points.length !== 2) { setLoading(false); return; }
    fetchTerrain(points[0], points[1], controller.signal).then(value => { if (active) setElevations(value); }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Terrain could not be loaded. Check your connection.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [points, attempt]);
  const samples = useMemo(() => {
    if (!elevations || distance <= 0 || !heightA.trim() || !heightB.trim() || !frequency.trim()) return [];
    const a = Number(heightA), b = Number(heightB), mhz = Number(frequency);
    if (![a, b, mhz].every(Number.isFinite) || mhz <= 0 || a < 0 || b < 0 || a > 1000 || b > 1000) return [];
    return analyzeTerrain(elevations, distance, a, b, mhz);
  }, [elevations, distance, heightA, heightB, frequency]);
  const min = Math.min(...samples.map(sample => sample.ground + sample.bulge), ...samples.map(sample => sample.los - sample.fresnel));
  const max = Math.max(...samples.map(sample => sample.ground + sample.bulge), ...samples.map(sample => sample.los + sample.fresnel));
  const y = (value: number) => 146 - (value - min) / Math.max(1, max - min) * 116;
  const x = (value: number) => 20 + value / distance * 560;
  const ground = samples.map(sample => `${x(sample.distance)},${y(sample.ground + sample.bulge)}`).join(' ');
  const ray = samples.map(sample => `${x(sample.distance)},${y(sample.los)}`).join(' ');
  const fresnel = [...samples.map(sample => `${x(sample.distance)},${y(sample.los + sample.fresnel * .6)}`), ...[...samples].reverse().map(sample => `${x(sample.distance)},${y(sample.los - sample.fresnel * .6)}`)].join(' ');
  const blocked = samples.some(sample => sample.clearance < 0);
  const fresnelBlocked = samples.some(sample => sample.fresnel > 0 && sample.clearance < sample.fresnel * .6);
  return <section className="coverage-terrain coverage-surface" aria-label="Terrain analysis">
    <div className="coverage-detail-heading"><span className="coverage-eyebrow">PATH ANALYSIS · {(distance / 1000).toFixed(2)} KM</span><button className="coverage-icon-button" aria-label="Close terrain" onClick={close}><CoverageIcon name="close" /></button></div>
    <CoverageScrollSurface label="Terrain profile and antenna settings" className="coverage-terrain-scroll">
      <h2>Follow the terrain</h2>
      <div className="coverage-terrain-inputs"><label>Antenna A (M)<input type="number" min="0" max="1000" value={heightA} onChange={event => setHeightA(event.target.value)} /></label><label>Antenna B (M)<input type="number" min="0" max="1000" value={heightB} onChange={event => setHeightB(event.target.value)} /></label><label>Frequency (MHZ)<input type="number" min="1" step="any" value={frequency} onChange={event => setFrequency(event.target.value)} /></label></div>
      {loading ? <p role="status">Loading terrain elevations…</p> : error ? <><p role="alert">{error}</p><button className="coverage-detail-action" onClick={() => setAttempt(value => value + 1)}>Retry terrain</button></> : samples.length > 0 ? <>
        <svg className="coverage-profile-chart" viewBox="0 0 600 180" role="img" aria-label={`Terrain profile: ${blocked ? 'line of sight obstructed' : fresnelBlocked ? 'Fresnel zone partially obstructed' : 'modeled path clear'}`}>
          <line x1="20" x2="580" y1="150" y2="150" stroke="currentColor" opacity=".12" />
          <polygon points={`20,150 ${ground} 580,150`} fill="currentColor" opacity=".12" />
          <polygon points={fresnel} fill="var(--fg)" opacity=".18" />
          <polyline points={ground} fill="none" stroke="currentColor" strokeWidth="1.5" />
          <polyline points={ray} fill="none" stroke="var(--fg)" strokeWidth="2" strokeDasharray="5 3" />
          <text x="20" y="173" fill="currentColor" fontSize="11">A · {Math.round(elevations![0])} M</text>
          <text x="580" y="173" textAnchor="end" fill="currentColor" fontSize="11">B · {Math.round(elevations![elevations!.length - 1])} M</text>
        </svg>
        <div className="coverage-chart-key"><span><i />Terrain</span><span><i className="los-key" />Line of sight</span><span><i className="fresnel-key" />60% Fresnel zone</span></div>
        <p className="coverage-terrain-verdict" data-clear={!blocked && !fresnelBlocked}><i />{blocked ? 'Terrain obstructs the modeled line of sight.' : fresnelBlocked ? 'Line of sight is clear. The Fresnel zone is partly obstructed.' : 'Terrain clears the modeled path and Fresnel zone.'}</p>
      </> : <p>Enter antenna heights from 0 to 1,000 m and a positive frequency.</p>}
      <p className="coverage-note">Terrain estimate · {elevations?.length ?? terrainSampleCount(distance)} samples with standard 4/3 Earth refraction. Buildings, vegetation, interference, and radio reception are not measured. Elevation: Mapzen terrain tiles.</p>
    </CoverageScrollSurface>
  </section>;
}
