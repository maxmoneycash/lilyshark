import { validCoordinates, type MapperRepeater } from './meshmapper.js';
export interface DirectoryRepeater extends MapperRepeater { directory: true; frequencyMHz?: number }
export function parseDirectory(payload: unknown): DirectoryRepeater[] {
  if (!Array.isArray(payload)) throw new Error('Invalid node directory.');
  return payload.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const n = value as Record<string, unknown>;
    if (![2, 3].includes(Number(n.type)) || !validCoordinates(n.adv_lat, n.adv_lon) || (n.adv_lat === 0 && n.adv_lon === 0)) return [];
    const params = n.params && typeof n.params === 'object' ? n.params as Record<string, unknown> : {};
    const timestamp = typeof n.last_advert === 'string' ? Date.parse(n.last_advert) / 1000 : NaN;
    return [{ directory: true as const, hex: typeof n.public_key === 'string' ? n.public_key : `${n.adv_lat},${n.adv_lon},${n.adv_name}`,
      name: typeof n.adv_name === 'string' ? n.adv_name : 'Unnamed repeater', lat: n.adv_lat as number, lon: n.adv_lon as number,
      enabled: 1, last_heard: Number.isFinite(timestamp) ? timestamp : null,
      frequencyMHz: typeof params.freq === 'number' && Number.isFinite(params.freq) ? params.freq : undefined }];
  });
}
