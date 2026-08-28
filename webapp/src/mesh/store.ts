import { hhmm } from "./fmt";
import { t } from "./i18n";

/** Connection lifecycle. Numeric order matters: `status >= Connected` is the
 *  "link is up" test, mirroring how the UI reads it everywhere. */
export enum DeviceStatus {
  Disconnected = 1,
  Connecting = 2,
  Connected = 3,
  Configuring = 4,
  Configured = 5,
}

/** MeshCore contact types (companion firmware). */
export enum ContactType {
  None = 0,
  Chat = 1,
  Repeater = 2,
  Room = 3,
  Sensor = 4,
}

/** A MeshCore contact. `num` is the first 4 bytes of the public key as a
 *  uint32 (big endian): stable, unique in practice, and lets every screen key
 *  nodes by number exactly like the tables and convo keys expect. The first
 *  byte (`num >>> 24`) is also the 1-byte hash MeshCore uses in paths. */
export interface NodeEntry {
  num: number;
  publicKey?: string; // full key, hex (64 chars); undefined for path-only ghosts
  type?: ContactType;
  longName: string; // advert name
  shortName: string;
  lastHeard: number; // epoch s (last advert or last activity)
  lastAdvert?: number; // epoch s of the last advert specifically
  snr?: number; // dB, last direct reception
  rssi?: number; // dBm
  batteryLevel?: number; // %
  voltage?: number; // V
  lat?: number;
  lon?: number;
  hopsAway?: number; // out path length; undefined = flood / unknown
  outPath?: number[]; // 1-byte hashes of the repeaters towards the contact
  fav?: boolean; // local: first in the list
  /** Heard through the internet bridge, not this deck's radio. */
  viaNet?: boolean;
  ignored?: boolean; // local: its messages are discarded
}

export interface Message {
  id: number;
  convo: string; // "ch:N" o "dm:nodeNum"
  from: number;
  to: number;
  channel: number;
  text: string;
  ts: number; // epoch ms
  mine: boolean;
  // queued: waiting locally · sent: the radio accepted the packet ·
  // delivered: ACK received from the contact · failed: error/timeout
  state: "queued" | "sent" | "delivered" | "failed";
  hops?: number; // hops traveled to reach us; undefined = unknown/direct
  replyId?: number; // kept for UI compatibility; MeshCore has no reply id
  snr?: number; // rx SNR of the last hop to us (dB); undefined = unknown
  rssi?: number; // rx RSSI of the last hop to us (dBm); undefined = unknown
}

export interface ChannelEntry {
  index: number;
  name: string;
  secret?: Uint8Array; // 128-bit shared key
}

/** Local map marker. MeshCore has no waypoint packet: these live only in the
 *  local database, they are never transmitted. */
export interface Waypoint {
  id: number;
  lat: number;
  lon: number;
  name: string;
  description: string;
  icon: number; // emoji codepoint (0 = no icon)
  expire: number; // epoch s · 0 = never expires
  lockedTo: number; // unused, kept for db compatibility
  from: number; // who created it (our num)
}

/** One trace path run: per-hop SNR over the route to a contact. */
export interface Traceroute {
  route: number[]; // node nums (mapped from path hashes where possible)
  snrTowards: number[]; // dB ×4 (same encoding the UI already renders)
  routeBack: number[];
  snrBack: number[];
  ts: number; // epoch ms when received
}

/** What the radio says about itself (CMD_APP_START reply). */
export interface SelfInfo {
  num: number;
  publicKey: string; // hex
  name: string;
  advLat: number;
  advLon: number;
  txPower: number;
  maxTxPower: number;
  radioFreq: number; // kHz
  radioBw: number; // kHz ×1000 as reported
  radioSf: number;
  radioCr: number;
  manualAddContacts: boolean;
}

export interface DeviceInfo {
  firmwareVer: number;
  buildDate: string;
  model: string;
  batteryMv?: number;
}

interface State {
  status?: DeviceStatus;
  myNodeNum?: number;
  selfInfo?: SelfInfo;
  deviceInfo?: DeviceInfo;
  nodes: Map<number, NodeEntry>;
  messages: Message[];
  channels: Map<number, ChannelEntry>;
  traceroutes: Map<number, Traceroute>; // key: destination node
  waypoints: Map<number, Waypoint>; // key: waypoint id
  posUpdates: Map<number, number>; // key: node → ts ms of the last position update
  unread: Map<string, number>; // key: convo → number of unread messages
  log: LogEntry[];
}

// Stored untranslated (key + args) so the whole log re-translates live when the
// language changes, like the rest of the UI. Render with fmtLog().
export interface LogEntry {
  time: number; // epoch ms
  key: string; // t() key, may carry {0}, {1}… placeholders
  args: (string | number)[];
}

const state: State = {
  nodes: new Map(),
  messages: [],
  channels: new Map(),
  traceroutes: new Map(),
  waypoints: new Map(),
  posUpdates: new Map(),
  unread: new Map(),
  log: [],
};

// Immutable snapshot for useSyncExternalStore
let snapshot = { ...state, version: 0 };
const listeners = new Set<() => void>();

export function mutate(fn: (s: State) => void): void {
  fn(state);
  snapshot = { ...state, version: snapshot.version + 1 };
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSnapshot() {
  return snapshot;
}

export function addLog(key: string, ...args: (string | number)[]): void {
  mutate((s) => {
    // ponytail: log capped at 500 lines, enough for diagnosis
    s.log = [...s.log.slice(-499), { time: Date.now(), key, args }];
  });
}

/** Render a log entry in the current language. hhmm() is language-neutral. */
export function fmtLog(e: LogEntry): string {
  return `${hhmm(e.time)} ${t(e.key, ...e.args)}`;
}

export function markUnread(convo: string): void {
  mutate((s) => {
    s.unread = new Map(s.unread).set(convo, (s.unread.get(convo) ?? 0) + 1);
  });
}

export function clearUnread(convo: string): void {
  if (!state.unread.has(convo)) return; // avoids a useless re-render
  mutate((s) => {
    const m = new Map(s.unread);
    m.delete(convo);
    s.unread = m;
  });
}

export function convoKey(msg: {
  from: number;
  to: number;
  channel: number;
  mine: boolean;
}): string {
  const BROADCAST = 0xffffffff;
  if (msg.to !== BROADCAST) {
    return `dm:${msg.mine ? msg.to : msg.from}`;
  }
  return `ch:${msg.channel}`;
}
