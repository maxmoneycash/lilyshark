/**
 * Transports the net bridge can ride, and the ladder between them.
 *
 * The envelope contract lives in netProtocol; a transport only moves opaque
 * payload strings for a room. Two exist because real networks disagree about
 * what traffic may live: MQTT over WebSocket is the natural fit and is tried
 * first, but some networks — a cellular hotspot's proxy was the discovery
 * case — complete the TCP handshake and then silently kill anything that is
 * not plain HTTPS, WebSocket upgrades included, on every port. ntfy.sh is the
 * fallback for exactly that world: publish is an HTTPS POST, subscribe is
 * SSE over the same port 443 a browser already uses, so it works anywhere
 * the web itself works. Same public-room posture as the public broker.
 *
 * The ladder tries each rung for a bounded window and climbs on to the next;
 * once connected it stays put until the connection drops.
 */
import mqtt, { type MqttClient } from 'mqtt';
import { netTopic } from './netProtocol';

export interface NetTransport {
  readonly name: string;
  /** Human-readable endpoint for status lines. */
  readonly endpoint: string;
  connect(
    room: string,
    onMessage: (payload: string) => void,
    onUp: () => void,
    onDown: () => void,
  ): void;
  publish(room: string, payload: string): void;
  disconnect(): void;
}

/** Public MQTT brokers with WSS endpoints, in preference order. */
export const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

export const NTFY_BASE_DEFAULT = 'https://ntfy.sh';

/** How long a rung may sit unconnected before the ladder climbs past it. */
export const CONNECT_WINDOW_MS = 12000;

/** ntfy topics share one global namespace and a restricted charset. */
export function ntfyTopic(room: string): string {
  return `lilyshark-mesh-v1-${room.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** Pull the bridge payload back out of one ntfy SSE event's data line.
 *  Returns undefined for keepalives, opens, and anything malformed. */
export function payloadFromNtfyEvent(data: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  const event = parsed as { event?: string; message?: string };
  if (event.event !== 'message' || typeof event.message !== 'string') return undefined;
  return event.message;
}

export class MqttTransport implements NetTransport {
  readonly name = 'mqtt';
  readonly endpoint: string;
  private client: MqttClient | undefined;

  constructor(private readonly broker: string) {
    this.endpoint = broker;
  }

  connect(
    room: string,
    onMessage: (payload: string) => void,
    onUp: () => void,
    onDown: () => void,
  ): void {
    const client = mqtt.connect(this.broker, {
      clientId: `lsk-${Math.random().toString(36).slice(2, 10)}`,
      clean: true,
      // The ladder owns retry policy; a rung that failed once is abandoned.
      reconnectPeriod: 0,
      connectTimeout: CONNECT_WINDOW_MS - 1000,
    });
    this.client = client;
    client.on('connect', () => {
      client.subscribe(netTopic(room), { qos: 0 });
      onUp();
    });
    client.on('close', onDown);
    client.on('error', () => {
      /* 'close' follows and carries the ladder onward */
    });
    client.on('message', (_topic, payload) => {
      onMessage(new TextDecoder().decode(payload));
    });
  }

  publish(room: string, payload: string): void {
    this.client?.publish(netTopic(room), payload, { qos: 0 });
  }

  disconnect(): void {
    this.client?.end(true);
    this.client = undefined;
  }
}

export class NtfyTransport implements NetTransport {
  readonly name = 'ntfy';
  readonly endpoint: string;
  private source: EventSource | undefined;
  private stopped = false;

  constructor(private readonly base: string = NTFY_BASE_DEFAULT) {
    this.endpoint = base;
  }

  connect(
    room: string,
    onMessage: (payload: string) => void,
    onUp: () => void,
    onDown: () => void,
  ): void {
    this.stopped = false;
    const source = new EventSource(`${this.base}/${ntfyTopic(room)}/sse`);
    this.source = source;
    source.onopen = () => onUp();
    source.onmessage = (event) => {
      const payload = payloadFromNtfyEvent(String(event.data));
      if (payload !== undefined) onMessage(payload);
    };
    source.onerror = () => {
      // EventSource reconnects by itself while alive; only a closed source
      // is a real down. Report down once so the ladder can move on if this
      // rung never managed to open at all.
      if (source.readyState === EventSource.CLOSED && !this.stopped) onDown();
    };
  }

  publish(room: string, payload: string): void {
    // Fire-and-forget POST; the room is best-effort like the radio channel.
    void fetch(`${this.base}/${ntfyTopic(room)}`, {
      method: 'POST',
      body: payload,
      // ntfy needs no headers for a plain text publish, and omitting them
      // keeps the request CORS-simple.
    }).catch(() => {
      /* a dropped publish is a dropped packet; the mesh is lossy by nature */
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.source?.close();
    this.source = undefined;
  }
}

/** The rungs to try, in order. A user-pinned broker replaces the whole MQTT
 *  ladder but keeps the ntfy fallback: an explicitly configured broker that
 *  is down should still not strand the mesh. */
export function buildLadder(pinnedBroker?: string): NetTransport[] {
  const brokers = pinnedBroker ? [pinnedBroker] : MQTT_BROKERS;
  return [...brokers.map((b) => new MqttTransport(b)), new NtfyTransport()];
}
