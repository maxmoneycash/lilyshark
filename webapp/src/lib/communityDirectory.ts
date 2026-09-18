import { validCoordinates, type MapperRepeater } from './meshmapper.js';

export const DIRECTORY_SOURCE = 'https://map.meshcore.io/';
export type DirectoryRole = 1 | 2 | 3 | 4;
export interface DirectoryRepeater extends MapperRepeater {
  directory: true;
  type: DirectoryRole;
  frequencyMHz?: number;
  updatedAt?: number;
  source?: string;
}
export interface DirectorySnapshot {
  nodes: DirectoryRepeater[];
  at: number;
  source: typeof DIRECTORY_SOURCE;
}
const keyIsValid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f\d]{64}$/i.test(value) && !/^0+$/.test(value);
const roleIsValid = (value: unknown): value is DirectoryRole => [1, 2, 3, 4].includes(value as number);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const epoch = (value: unknown): number | undefined => {
  const date = typeof value === 'string' ? Date.parse(value) / 1000 : NaN;
  return Number.isFinite(date) && date > 0 ? date : undefined;
};
export function directoryRoleLabel(type?: number): string {
  return ({ 1: 'Contact', 2: 'Repeater', 3: 'Room', 4: 'Sensor' } as Record<number, string>)[type ?? 0] ?? 'Node';
}
function uniqueNodes(nodes: DirectoryRepeater[]): DirectoryRepeater[] {
  const unique = new Map<string, DirectoryRepeater>();
  for (const node of nodes) {
    const prior = unique.get(node.hex);
    if (!prior || (node.updatedAt ?? node.last_heard ?? 0) >= (prior.updatedAt ?? prior.last_heard ?? 0)) unique.set(node.hex, node);
  }
  return [...unique.values()];
}

/** Decode the official directory. A missing public identity never becomes a pin. */
export function parseDirectory(payload: unknown): DirectoryRepeater[] {
  if (!Array.isArray(payload)) throw new Error('Invalid node directory.');
  const nodes: DirectoryRepeater[] = [];
  for (const n of payload) {
    if (!object(n) || !keyIsValid(n.public_key) || !roleIsValid(n.type)
      || !validCoordinates(n.adv_lat, n.adv_lon) || (n.adv_lat === 0 && n.adv_lon === 0)) continue;
    const params = object(n.params) ? n.params : {};
    const key = n.public_key.toLowerCase();
    nodes.push({ directory: true, type: n.type, hex: key,
      name: typeof n.adv_name === 'string' && n.adv_name.trim() ? n.adv_name.trim() : `Node ${key.slice(0, 8)}`,
      lat: n.adv_lat as number, lon: n.adv_lon as number, enabled: 1,
      last_heard: epoch(n.last_advert) ?? null, updatedAt: epoch(n.updated_date),
      source: typeof n.source === 'string' ? n.source : undefined,
      frequencyMHz: finite(params.freq) && params.freq > 0 ? params.freq : undefined });
  }
  if (payload.length && !nodes.length) throw new Error('The directory contains no valid positioned identities.');
  return uniqueNodes(nodes);
}

/** Validate the same-origin API or saved snapshot without accepting arbitrary pins. */
export function parseDirectorySnapshot(payload: unknown, now = Date.now()): DirectorySnapshot {
  if (!object(payload) || !Array.isArray(payload.nodes) || !finite(payload.at)
    || payload.at <= 0 || payload.at > now + 60_000
    || (payload.source !== undefined && payload.source !== DIRECTORY_SOURCE)) throw new Error('Invalid saved directory.');
  const nodes: DirectoryRepeater[] = [];
  for (const n of payload.nodes) {
    if (!object(n) || n.directory !== true || !keyIsValid(n.hex) || !roleIsValid(n.type)
      || !validCoordinates(n.lat, n.lon) || (n.lat === 0 && n.lon === 0)) continue;
    nodes.push({ directory: true, type: n.type, hex: n.hex.toLowerCase(),
      name: typeof n.name === 'string' && n.name.trim() ? n.name.trim() : `Node ${n.hex.slice(0, 8)}`,
      lat: n.lat as number, lon: n.lon as number, enabled: 1,
      last_heard: finite(n.last_heard) && n.last_heard > 0 ? n.last_heard : null,
      updatedAt: finite(n.updatedAt) && n.updatedAt > 0 ? n.updatedAt : undefined,
      source: typeof n.source === 'string' ? n.source : undefined,
      frequencyMHz: finite(n.frequencyMHz) && n.frequencyMHz > 0 ? n.frequencyMHz : undefined });
  }
  if (payload.nodes.length && !nodes.length) throw new Error('No valid saved directory nodes.');
  return { nodes: uniqueNodes(nodes), at: payload.at, source: DIRECTORY_SOURCE };
}
