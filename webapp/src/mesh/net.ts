/**
 * The internet leg of the mesh.
 *
 * Two decks a hundred kilometres apart will never hear each other on the air,
 * but each one sits on a USB cable next to this analyzer. So the analyzer
 * bridges: every frame the linked deck hears (or sends) is published to a
 * shared MQTT room, and every frame another analyzer publishes is shown here
 * and handed down the cable with `LSK INJ`, where the firmware treats it as
 * heard — nodes, map, chat, notification chime — while marking its origin NET
 * so provenance survives into the packet inspector and captures.
 *
 * The default room rides a public broker, so treat it like the radio channel
 * it mirrors — LongFast with the published default key is public speech on RF
 * and it is public speech here. A private mesh would set its own room and its
 * own broker; both persist in localStorage.
 */
import mqtt, { type MqttClient } from 'mqtt';
import { useSyncExternalStore } from 'react';
import type { HeardFrame } from '../lib/deviceLink';
import { getDeviceLinkState, sendDeviceLine } from '../lib/deviceLink';
import { applyNetFrame } from './analyzerMesh';
import { decodeEnvelope, encodeEnvelope, netTopic, shouldPublish } from './netProtocol';

export const NET_BROKER_DEFAULT = 'wss://broker.emqx.io:8084/mqtt';
export const NET_ROOM_DEFAULT = 'longfast';

export interface NetState {
  enabled: boolean;
  connected: boolean;
  room: string;
  broker: string;
  published: number;
  received: number;
  injected: number;
}

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

let state: NetState = {
  enabled: loadSetting('lilyshark-net-enabled', 'on') !== 'off',
  connected: false,
  room: loadSetting('lilyshark-net-room', NET_ROOM_DEFAULT),
  broker: loadSetting('lilyshark-net-broker', NET_BROKER_DEFAULT),
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

let client: MqttClient | undefined;

/** Called by analyzerMesh for every frame the linked deck reports. */
export function publishHeardFrame(frame: HeardFrame): void {
  if (!state.enabled || !client || !state.connected) return;
  if (!shouldPublish(frame)) return;
  client.publish(netTopic(state.room), JSON.stringify(encodeEnvelope(frame, clientId, Date.now())), {
    qos: 0,
  });
  set({ published: state.published + 1 });
}

function onMessage(payload: Uint8Array): void {
  const env = decodeEnvelope(new TextDecoder().decode(payload), clientId);
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

export function netConnect(): void {
  if (!state.enabled || client) return;
  const connecting = mqtt.connect(state.broker, {
    clientId: `${clientId}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 15000,
  });
  client = connecting;
  connecting.on('connect', () => {
    connecting.subscribe(netTopic(state.room), { qos: 0 });
    set({ connected: true });
  });
  connecting.on('close', () => set({ connected: false }));
  connecting.on('message', (_topic, payload) => onMessage(payload));
  connecting.on('error', () => {
    /* reconnectPeriod owns retries; surfacing every blip is noise */
  });
}

export function netDisconnect(): void {
  client?.end(true);
  client = undefined;
  set({ connected: false });
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
