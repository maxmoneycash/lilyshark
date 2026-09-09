import { validCoordinates } from './meshmapper';
export type MapPoint = { lat: number; lon: number };
const R = 6371000;
const rad = (v: number) => v * Math.PI / 180;
export function distanceMeters(a: MapPoint, b: MapPoint): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function samplePath(a: MapPoint, b: MapPoint, count = 65): MapPoint[] {
  if (!validCoordinates(a.lat, a.lon) || !validCoordinates(b.lat, b.lon) || count < 2 || !Number.isInteger(count)) throw new Error('Choose two valid map points.');
  const angle = distanceMeters(a, b) / R;
  if (Math.PI - angle < 1e-8) throw new Error('Choose points with an unambiguous shortest path.');
  return Array.from({ length: count }, (_, i) => {
    if (i === 0 || angle === 0) return { ...a };
    if (i === count - 1) return { ...b };
    const f = i / (count - 1);
    const first = Math.sin((1 - f) * angle) / Math.sin(angle), second = Math.sin(f * angle) / Math.sin(angle);
    const x = first * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + second * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
    const y = first * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + second * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon));
    const z = first * Math.sin(rad(a.lat)) + second * Math.sin(rad(b.lat));
    return { lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
  });
}
/** Match the native GeoMath sampling policy; long paths must not use 3 km gaps. */
export function terrainSampleCount(distance: number): number {
  return distance < 1000 ? 20 : distance < 5000 ? 50 : distance < 20000 ? 100 : distance < 50000 ? 200 : Math.min(500, Math.floor(distance / 100));
}
export interface TerrainSample { distance: number; ground: number; bulge: number; los: number; fresnel: number; clearance: number }
export function analyzeTerrain(elevations: number[], distance: number, heightA: number, heightB: number, frequencyMHz: number): TerrainSample[] {
  if (elevations.length < 2 || elevations.some(v => !Number.isFinite(v)) || ![distance, heightA, heightB, frequencyMHz].every(Number.isFinite) || distance <= 0 || heightA < 0 || heightB < 0 || frequencyMHz <= 0) throw new Error('Valid terrain, antenna heights, and frequency are required.');
  const wavelength = 299792458 / (frequencyMHz * 1e6);
  return elevations.map((ground, i) => {
    const fraction = i / (elevations.length - 1);
    const d1 = distance * fraction, d2 = distance - d1;
    const los = (elevations[0] + heightA) * (1 - fraction) + (elevations[elevations.length - 1] + heightB) * fraction;
    const bulge = d1 * d2 / (2 * R * (4 / 3));
    const fresnel = Math.sqrt(wavelength * d1 * d2 / distance);
    return { distance: d1, ground, bulge, los, fresnel, clearance: los - ground - bulge };
  });
}
export function terrariumElevation(r: number, g: number, b: number) { return r * 256 + g + b / 256 - 32768; }
const tiles = new Map<string, Promise<ImageData>>();
async function elevationAt(point: MapPoint): Promise<number> {
  const zoom = 12, size = 2 ** zoom;
  if (Math.abs(point.lat) > 85.0511) throw new Error('Terrain tiles do not cover this polar latitude.');
  const lat = point.lat;
  const x = (point.lon + 180) / 360 * size;
  const y = (1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2 * size;
  const tileX = Math.min(size - 1, Math.floor(x)), tileY = Math.min(size - 1, Math.floor(y));
  const key = `${zoom}/${tileX}/${tileY}`;
  if (!tiles.has(key)) {
    if (tiles.size >= 32) tiles.delete(tiles.keys().next().value!);
    const pending = (async () => {
      const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Terrain tiles could not be loaded.');
      const image = await createImageBitmap(await response.blob());
      try {
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Terrain sampling is unavailable in this browser.');
        ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height);
      } finally { image.close(); }
    })();
    tiles.set(key, pending);
    pending.catch(() => { if (tiles.get(key) === pending) tiles.delete(key); });
  }
  const image = await tiles.get(key)!;
  const px = Math.min(image.width - 1, Math.floor((x - tileX) * image.width));
  const py = Math.min(image.height - 1, Math.floor((y - tileY) * image.height));
  const i = (py * image.width + px) * 4;
  return terrariumElevation(image.data[i], image.data[i + 1], image.data[i + 2]);
}
export async function fetchTerrain(a: MapPoint, b: MapPoint, signal?: AbortSignal): Promise<number[]> {
  const distance = distanceMeters(a, b);
  if (distance < 1 || distance > 200000) throw new Error('Choose points between 1 m and 200 km apart.');
  const points = samplePath(a, b, terrainSampleCount(distance));
  const values: number[] = [];
  for (let start = 0; start < points.length; start += 4) {
    signal?.throwIfAborted();
    values.push(...await Promise.all(points.slice(start, start + 4).map(elevationAt)));
  }
  return values;
}
