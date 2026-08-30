/**
 * The internet leg of the mesh.
 *
 * Two decks a hundred kilometres apart will never hear each other on the air,
 * but each one sits on a USB cable next to this analyzer. So the analyzer
 * bridges: every frame the linked deck hears (or sends) is published to a
 * shared room, and every frame another analyzer publishes is shown here and
 * handed down the cable with `LSK INJ`, where the firmware treats it as
 * heard — nodes, map, chat, notification chime — while marking its origin NET
 * so provenance survives into the packet inspector and captures.
 *
 * The room rides whichever transport the local network permits — the ladder
 * in netTransport tries MQTT over WebSocket first and falls back to plain
 * HTTPS via ntfy.sh, because some networks kill WebSocket upgrades outright.
 * Either way the room is public, the same standing as the LongFast radio
 * channel it mirrors. A private mesh sets its own room and broker in
 * localStorage.
 *
 * Loop safety is structural, not heuristic: a frame is only published from a
 * device link (never from the room), the firmware marks injected frames with
 * the net metadata bit so their serial echoes are never re-published, and
 * every envelope carries the publisher's client id so an echo of our own
 * message drops on sight.
 */
import { useSyncExternalStore } from 'react';
import type { HeardFrame } from '../lib/deviceLink';
import { getDeviceLinkState, sendDeviceLine } from '../lib/deviceLink';
import { applyNetFrame } from './analyzerMesh';
import { decodeEnvelope, encodeEnvelope, shouldPublish } from './netProtocol';
import { buildLadder, CONNECT_WINDOW_MS, type NetTransport } from './netTransport';

export const NET_ROOM_DEFAULT = 'longfast';
/** Pause after the whole ladder fails before starting over. */
const LADDER_RETRY_MS = 20000;

export interface NetState {
  enabled: boolean;
  connected: boolean;
  room: string;
  /** Which transport carries the room right now, e.g. "ntfy https://ntfy.sh". */
  via: string;
  published: number;
  received: number;
  injected: number;
}

function loadSetting(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

let state: NetState = {
  enabled: loadSetting('lilyshark-net-enabled') !== 'off',
  connected: false,
  room: loadSetting('lilyshark-net-room') ?? NET_ROOM_DEFAULT,
  via: '',
  published: 0,
  received: 0,
  injected: 0,
};
const listeners = new Set<() => void>();
function set(next: Partial<NetState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
export function getNetState(): NetState {
  return state;
}
export function useNetState(): NetState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Ephemeral per-tab identity; not a secret, only an echo filter. */
const clientId = `lsk-${Math.random().toString(36).slice(2, 10)}`;

let ladder: NetTransport[] = [];
let rung = 0;
let active: NetTransport | undefined;
let windowTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function onMessage(payload: string): void {
  const env = decodeEnvelope(payload, clientId);
  if (!env) return;
  set({ received: state.received + 1 });
  applyNetFrame(env);
  if (env.raw && getDeviceLinkState().status === 'linked') {
    sendDeviceLine(`LSK INJ ${env.raw}`)
      .then(() => set({ injected: state.injected + 1 }))
      .catch(() => {
        /* the deck being briefly busy is not an error worth surfacing */
      });
  }
}

function climb(): void {
  if (!running) return;
  active?.disconnect();
  active = undefined;
  set({ connected: false, via: '' });
  if (rung >= ladder.length) {
    // Every rung failed; rest, then start the ladder again. Networks change —
    // a laptop walks between the hotspot and home wifi.
    rung = 0;
    retryTimer = setTimeout(climb, LADDER_RETRY_MS);
    return;
  }
  const transport = ladder[rung++];
  active = transport;
  let settled = false;
  windowTimer = setTimeout(() => {
    if (!settled) climb();
  }, CONNECT_WINDOW_MS);
  transport.connect(
    state.room,
    onMessage,
    () => {
      settled = true;
      if (windowTimer) clearTimeout(windowTimer);
      // A rung that connects wins outright; a later drop restarts from the
      // top, since whatever broke may have healed.
      rung = 0;
      set({ connected: true, via: `${transport.name} ${transport.endpoint}` });
    },
    () => {
      if (!running) return;
      if (windowTimer) clearTimeout(windowTimer);
      climb();
    },
  );
}

/** Called by analyzerMesh for every frame the linked deck reports. */
export function publishHeardFrame(frame: HeardFrame): void {
  if (!state.enabled || !active || !state.connected) return;
  if (!shouldPublish(frame)) return;
  active.publish(state.room, JSON.stringify(encodeEnvelope(frame, clientId, Date.now())));
  set({ published: state.published + 1 });
}

export function netConnect(): void {
  if (!state.enabled || running) return;
  running = true;
  ladder = buildLadder(loadSetting('lilyshark-net-broker'));
  rung = 0;
  climb();
}

export function netDisconnect(): void {
  running = false;
  if (windowTimer) clearTimeout(windowTimer);
  if (retryTimer) clearTimeout(retryTimer);
  active?.disconnect();
  active = undefined;
  set({ connected: false, via: '' });
}

export function setNetEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('lilyshark-net-enabled', enabled ? 'on' : 'off');
  } catch {
    /* private windows forbid storage; the toggle still works this session */
  }
  set({ enabled });
  if (enabled) netConnect();
  else netDisconnect();
}
