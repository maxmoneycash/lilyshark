/** Shared geometry for the labelled Meshtastic / MeshCore packet demo.
 *
 * The scene is schematic: seven fixed nodes, a four-second cycle, no radio
 * math. Hosts must badge it as an illustration. Progress is 0…1 through one
 * cycle; Reduce Motion should freeze at MESH_DEMO_REDUCED_MOTION_PROGRESS so
 * the routes stay readable as a static diagram.
 */

export type MeshRoutingMode = 'flood' | 'routed';

export type MeshDemoNode = {
  readonly x: number;
  readonly y: number;
  readonly label: string;
};

export type MeshDemoLink = {
  readonly a: number;
  readonly b: number;
  /** Flood waves fire in sequence; the route demo ignores this. */
  readonly wave: number;
};

export type MeshDemoPulse = {
  readonly from: number;
  readonly to: number;
  readonly t: number;
  readonly kind: 'packet' | 'receipt';
};

export const MESH_DEMO_NODES: readonly MeshDemoNode[] = [
  { x: 0.10, y: 0.50, label: 'You' },
  { x: 0.30, y: 0.20, label: '' },
  { x: 0.32, y: 0.80, label: '' },
  { x: 0.54, y: 0.50, label: '' },
  { x: 0.74, y: 0.22, label: '' },
  { x: 0.76, y: 0.76, label: '' },
  { x: 0.92, y: 0.50, label: 'Peer' },
];

export const MESH_FLOOD_LINKS: readonly MeshDemoLink[] = [
  { a: 0, b: 1, wave: 0 }, { a: 0, b: 2, wave: 0 },
  { a: 1, b: 3, wave: 1 }, { a: 1, b: 4, wave: 1 },
  { a: 2, b: 3, wave: 1 }, { a: 2, b: 5, wave: 1 },
  { a: 3, b: 6, wave: 2 }, { a: 4, b: 6, wave: 2 },
  { a: 5, b: 6, wave: 2 }, { a: 3, b: 4, wave: 2 },
  { a: 3, b: 5, wave: 2 },
];

export const MESH_ROUTE: readonly number[] = [0, 2, 5, 6];

export const MESH_DEMO_CYCLE_MS = 4000;
/** Mid-wave-1 freeze: several flood rebroadcasts and a MeshCore hop are on screen. */
export const MESH_DEMO_REDUCED_MOTION_PROGRESS = 0.36;

const HOP = 0.18;
const OUT_START = 0.06;
const IN_START = 0.64;
const FLOOD_WAVE = 0.22;
const FLOOD_DUR = 0.18;
const FLOOD_START = 0.05;

export function meshDemoProgress(nowMs: number, cycleMs = MESH_DEMO_CYCLE_MS): number {
  if (!Number.isFinite(nowMs) || cycleMs <= 0) return 0;
  const wrapped = ((nowMs % cycleMs) + cycleMs) % cycleMs;
  return wrapped / cycleMs;
}

export function meshDemoPulses(mode: MeshRoutingMode, progress: number): MeshDemoPulse[] {
  const p = Number.isFinite(progress) ? ((progress % 1) + 1) % 1 : 0;
  if (mode === 'flood') {
    const pulses: MeshDemoPulse[] = [];
    for (const link of MESH_FLOOD_LINKS) {
      const local = (p - (FLOOD_START + link.wave * FLOOD_WAVE)) / FLOOD_DUR;
      if (local > 0 && local < 1) {
        pulses.push({ from: link.a, to: link.b, t: local, kind: 'packet' });
      }
    }
    return pulses;
  }

  const hops = MESH_ROUTE.length - 1;
  if (p >= OUT_START && p < OUT_START + hops * HOP) {
    const hop = Math.min(hops - 1, Math.floor((p - OUT_START) / HOP));
    const local = (p - OUT_START - hop * HOP) / HOP;
    return [{ from: MESH_ROUTE[hop], to: MESH_ROUTE[hop + 1], t: local, kind: 'packet' }];
  }
  if (p >= IN_START && p < IN_START + hops * HOP) {
    const hop = Math.min(hops - 1, Math.floor((p - IN_START) / HOP));
    const local = (p - IN_START - hop * HOP) / HOP;
    return [{
      from: MESH_ROUTE[hops - hop],
      to: MESH_ROUTE[hops - hop - 1],
      t: local,
      kind: 'receipt',
    }];
  }
  return [];
}

export const MESH_DEMO_COPY: Record<MeshRoutingMode, { title: string; body: string }> = {
  flood: {
    title: 'Meshtastic · Flood',
    body: 'Meshtastic floods: every node that hears a packet repeats it. Simple and resilient, but one message becomes many transmissions — about seven per delivered message in measured captures — and reach drops as the mesh grows.',
  },
  routed: {
    title: 'MeshCore · Routed',
    body: 'MeshCore routes: the path is discovered up front, then packets follow only that route — up to 64 hops — and a delivery receipt travels back along it. Lilyshark decks speak Meshtastic; MeshCore radios also expose radio settings and remote management.',
  },
};
