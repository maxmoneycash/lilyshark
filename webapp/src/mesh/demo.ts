/**
 * Demo mesh — a plausible Palo Alto deployment, loaded when no radio is
 * attached.
 *
 * Every screen in this app is a view onto a live radio, which means that
 * without hardware the whole interface is a row of empty panels. That is a bad
 * way to show what the instrument does, so the app seeds a mesh that behaves
 * like a real one: repeaters on the hills with good paths and mains power,
 * handhelds down in the flats on battery, a sensor cluster, and a few nodes
 * that are only ever heard through someone else.
 *
 * It is clearly labelled as demo data in the footer and is dropped the moment a
 * real device connects — see `clearDemo`.
 *
 * The numbers are not random noise. Signal strength falls off with distance
 * from the receiver, hop count follows from which repeater covers a node, and
 * battery level tracks whether the node is a mains-powered repeater or a
 * handheld. That way the tables, the map and the mesh graph all agree with each
 * other, which is what makes the screens readable.
 */

import { type LscapFrame, RF_FIELD, SHELBY_POINTER_SIZE } from "../lib/lscap";
import { DEMO_BLOB } from "../lib/shelby";
import {
  ContactType,
  DeviceStatus,
  markUnread,
  mutate,
  type Message,
  type NodeEntry,
} from "./store";

/** Our own position: downtown Palo Alto, near the Caltrain station. */
export const DEMO_CENTER = { lat: 37.4419, lon: -122.143 };

/** Marks the seeded state so the UI can say so and so we know what to remove. */
export const DEMO_NODE_FLOOR = 0xd0000000;

/** Our own node while the demo is up, so the map draws a self marker and the
 *  tables can measure distances from somewhere. */
const DEMO_ME = DEMO_NODE_FLOOR + 999;

let seeded = false;
/** Each of these is only undone by clearDemo if the demo is what did it. */
let createdChannel0 = false;
let setMyNode = false;

interface Spec {
  name: string;
  short: string;
  lat: number;
  lon: number;
  type: ContactType;
  /** Mains-powered sites keep a flat battery reading; handhelds drain. */
  mains?: boolean;
  /** Which repeater carries it, if it isn't heard directly. */
  via?: number;
}

/**
 * Sites are real Palo Alto geography — the hills to the west carry the
 * repeaters, because that is where a mesh actually puts them.
 */
const SPECS: Spec[] = [
  // Repeaters, on high ground west of the valley floor.
  { name: "Skyline-Ridge", short: "SKY", lat: 37.3405, lon: -122.2005, type: ContactType.Repeater, mains: true },
  { name: "Windy-Hill", short: "WND", lat: 37.3703, lon: -122.2372, type: ContactType.Repeater, mains: true },
  { name: "Arastradero-R1", short: "AR1", lat: 37.3897, lon: -122.1739, type: ContactType.Repeater, mains: true },
  { name: "Hoover-Tower", short: "HVR", lat: 37.4275, lon: -122.1668, type: ContactType.Repeater, mains: true },
  { name: "Black-Mountain", short: "BLK", lat: 37.3227, lon: -122.1461, type: ContactType.Repeater, mains: true },

  // Handhelds around downtown and the university.
  { name: "University-Ave", short: "UNI", lat: 37.4459, lon: -122.1608, type: ContactType.Chat },
  { name: "Lytton-Plaza", short: "LYT", lat: 37.4443, lon: -122.1607, type: ContactType.Chat },
  { name: "Stanford-Oval", short: "OVL", lat: 37.4281, lon: -122.1699, type: ContactType.Chat, via: 3 },
  { name: "Escondido-Village", short: "ESC", lat: 37.4213, lon: -122.1652, type: ContactType.Chat, via: 3 },
  { name: "Palo-Alto-Caltrain", short: "CAL", lat: 37.4436, lon: -122.1649, type: ContactType.Chat },
  { name: "Rinconada-Park", short: "RIN", lat: 37.4468, lon: -122.1447, type: ContactType.Chat },
  { name: "Mitchell-Park", short: "MIT", lat: 37.4183, lon: -122.1108, type: ContactType.Chat, via: 2 },
  { name: "Baylands-Trail", short: "BAY", lat: 37.4595, lon: -122.1075, type: ContactType.Chat },
  { name: "Duveneck-School", short: "DUV", lat: 37.4497, lon: -122.1372, type: ContactType.Chat },
  { name: "Greer-Park", short: "GRE", lat: 37.4318, lon: -122.1073, type: ContactType.Chat, via: 2 },
  { name: "Cubberley", short: "CUB", lat: 37.4132, lon: -122.1122, type: ContactType.Chat, via: 2 },
  { name: "Foothills-Park", short: "FTH", lat: 37.3624, lon: -122.1755, type: ContactType.Chat, via: 2 },
  { name: "Los-Altos-Hills", short: "LAH", lat: 37.3797, lon: -122.1372, type: ContactType.Chat, via: 4 },
  { name: "Menlo-Downtown", short: "MEN", lat: 37.4538, lon: -122.1822, type: ContactType.Chat, via: 3 },
  { name: "Sharon-Heights", short: "SHR", lat: 37.4222, lon: -122.2101, type: ContactType.Chat, via: 1 },
  { name: "Portola-Valley", short: "PRT", lat: 37.3841, lon: -122.2352, type: ContactType.Chat, via: 1 },
  { name: "Woodside-Store", short: "WDS", lat: 37.4291, lon: -122.2536, type: ContactType.Chat, via: 1 },
  { name: "Mountain-View-Dt", short: "MVW", lat: 37.3939, lon: -122.0797, type: ContactType.Chat, via: 4 },
  { name: "Shoreline-Amph", short: "SHO", lat: 37.4267, lon: -122.0806, type: ContactType.Chat, via: 4 },
  { name: "East-Palo-Alto", short: "EPA", lat: 37.4688, lon: -122.1411, type: ContactType.Chat },
  { name: "Dumbarton-Approach", short: "DMB", lat: 37.4863, lon: -122.1113, type: ContactType.Chat, via: 3 },

  // Sensors: fixed, low duty cycle, solar.
  { name: "Creek-Gauge-01", short: "CG1", lat: 37.4103, lon: -122.1298, type: ContactType.Sensor, mains: true, via: 2 },
  { name: "Creek-Gauge-02", short: "CG2", lat: 37.3982, lon: -122.1189, type: ContactType.Sensor, mains: true, via: 2 },
  { name: "Weather-Foothills", short: "WXF", lat: 37.3562, lon: -122.1899, type: ContactType.Sensor, mains: true, via: 2 },
  { name: "Fire-Watch-Skyline", short: "FWS", lat: 37.3311, lon: -122.2138, type: ContactType.Sensor, mains: true, via: 0 },
  { name: "Tide-Baylands", short: "TID", lat: 37.4631, lon: -122.1002, type: ContactType.Sensor, mains: true },

  // Rooms.
  { name: "PA-Emergency-Net", short: "EMR", lat: 37.4419, lon: -122.1502, type: ContactType.Room, mains: true },
  { name: "SV-Mesh-Builders", short: "SVM", lat: 37.4021, lon: -122.1189, type: ContactType.Room, mains: true, via: 2 },
];

/** Great-circle distance in km — close enough at this scale for a path model. */
function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const p =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(p));
}

/**
 * Deterministic jitter. A seeded hash rather than Math.random so the demo mesh
 * is identical on every load — screenshots stay comparable and nothing moves
 * under the reader between renders.
 */
function jitter(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
}

function buildNodes(now: number): NodeEntry[] {
  return SPECS.map((s, i) => {
    const num = DEMO_NODE_FLOOR + i + 1;
    const d = km(DEMO_CENTER.lat, DEMO_CENTER.lon, s.lat, s.lon);

    // Free-space-ish falloff, then jitter: near nodes land around -80 dBm and
    // the far edge of the mesh sits near the -125 dBm noise floor.
    const rssi = Math.max(-127, Math.round(-74 - 21 * Math.log10(Math.max(d, 0.3)) + jitter(i + 1, 5)));
    // SNR tracks RSSI but LoRa still demodulates below the noise floor.
    const snr = Math.round((rssi + 92) * 0.55 + jitter(i + 7, 2.5));

    const hops = s.via === undefined ? 0 : 1 + (SPECS[s.via].via === undefined ? 0 : 1);
    const battery = s.mains ? 100 : Math.max(11, Math.round(88 + jitter(i + 13, 26)));

    return {
      num,
      publicKey: (num >>> 0).toString(16).padStart(8, "0").repeat(8),
      type: s.type,
      longName: s.name,
      shortName: s.short,
      // Repeaters and sensors advertise often; handhelds are heard when moved.
      lastHeard: Math.round(now / 1000) - Math.round(Math.abs(jitter(i + 3, 1)) * 2400),
      lastAdvert: Math.round(now / 1000) - Math.round(Math.abs(jitter(i + 5, 1)) * 5400),
      snr,
      rssi,
      batteryLevel: battery,
      voltage: Number((3.4 + (battery / 100) * 0.75).toFixed(2)),
      lat: s.lat,
      lon: s.lon,
      hopsAway: hops === 0 ? undefined : hops,
      // A MeshCore path is a list of 1-byte hashes, one per repeater. Deriving
      // them from the demo nums would give every hop the same byte (they all
      // share a top byte by construction), which reads as a bug in the RUTA
      // column, so each repeater gets its own illustrative byte instead.
      outPath: s.via === undefined ? [] : [(s.via * 37 + 0x11) & 0xff],
    } satisfies NodeEntry;
  });
}

/**
 * The demo topology as neighbor links, for the MESH graph. The screen reads
 * links from IndexedDB (they come from NeighborInfo packets on a real radio),
 * so the demo supplies its own set at render time instead of writing invented
 * rows into the database: direct nodes link to us, relayed nodes link to their
 * repeater, and each SNR is the one the node table already shows.
 */
export function demoNeighbors(): { node: number; neighbor: number; snr: number }[] {
  if (!seeded) return [];
  const out: { node: number; neighbor: number; snr: number }[] = [];
  SPECS.forEach((s, i) => {
    const num = DEMO_NODE_FLOOR + i + 1;
    const other = s.via === undefined ? DEMO_ME : DEMO_NODE_FLOOR + s.via + 1;
    const snr = Math.round((jitter(i + 7, 2.5) + 6) * 10) / 10;
    out.push({ node: other, neighbor: num, snr });
  });
  return out;
}

/* ── Live air ─────────────────────────────────────────────────────────────
   Synthetic frames for the analyzer's live mode: the same LongFast radio
   parameters as the bundled capture, deterministic per sequence number, and
   every ninth frame carries a well-formed Shelby pointer — so a recording of
   the screen shows a pointer actually arriving over the air and being decoded
   the moment it lands. */

const DEMO_RF_FIELDS =
  RF_FIELD.timestamp |
  RF_FIELD.frequency |
  RF_FIELD.bandwidth |
  RF_FIELD.airtime |
  RF_FIELD.rssi |
  RF_FIELD.snr |
  RF_FIELD.spreadingFactor |
  RF_FIELD.codingRate;

/** Deterministic bytes, so a given sequence number always looks the same. */
function demoBytes(seed: number, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = seed * 2654435761;
  for (let i = 0; i < len; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** Hex string (with or without 0x) into a fixed-length byte array. */
function hexBytes(hex: string, length: number): Uint8Array {
  const clean = hex.replace(/^0x/, "");
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++)
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * An encoded pointer carrying the coordinates of the REAL demo blob on
 * shelbynet, so any live ◆ frame resolves end to end: capture flag, one
 * chunk of one, commitment and owner of captures/field-capture-0847.lscap.
 */
function demoPointerBytes(_seed: number): Uint8Array {
  const b = new Uint8Array(SHELBY_POINTER_SIZE);
  b.set([0x53, 0x48, 0x4c, 0x42]); // "SHLB"
  b[4] = 1; // version
  b[5] = 1 << 2; // capture flag
  b.set(hexBytes(DEMO_BLOB.commitment, 32), 6);
  b.set(hexBytes(DEMO_BLOB.owner, 32), 38);
  const view = new DataView(b.buffer);
  view.setUint32(70, DEMO_BLOB.sizeBytes, true);
  view.setUint32(74, DEMO_BLOB.expiresAtUnix, true);
  view.setUint16(78, 0, true); // chunk index
  view.setUint16(80, 1, true); // chunk count
  return b;
}

/**
 * The next frame heard on the demo air. Timing and airtime follow LongFast
 * (SF11 · BW250 · CR4/5 at ~987 bit/s, the figure measured from the sample).
 */
export function demoNextFrame(seq: number, timestampUs: number): LscapFrame {
  const pointer = seq % 9 === 4;
  const len = pointer
    ? 16 + SHELBY_POINTER_SIZE
    : 24 + Math.round(Math.abs(jitter(seq * 3 + 2, 1)) * 150);
  const bytes = pointer
    ? (() => {
        const b = new Uint8Array(16 + SHELBY_POINTER_SIZE);
        b.set(demoBytes(seq * 7 + 3, 16)); // protocol header in front
        b.set(demoPointerBytes(seq), 16);
        return b;
      })()
    : demoBytes(seq * 7 + 3, len);

  const rssi = Math.round(-88 - Math.abs(jitter(seq + 1, 1)) * 28);
  return {
    sequence: BigInt(seq),
    timestampUs: BigInt(timestampUs),
    capturedLength: len,
    originalLength: len,
    truncated: false,
    presentFields: DEMO_RF_FIELDS,
    centerFrequencyHz: 906_875_000,
    bandwidthHz: 250_000,
    bitRateBps: 0,
    frequencyDeviationHz: 0,
    airtimeUs: Math.round(((len * 8) / 987) * 1e6),
    frequencyErrorHz: 0,
    rssiDbm: rssi,
    snrDb: Math.round(((rssi + 92) * 0.55 + jitter(seq + 5, 2)) * 10) / 10,
    preambleSymbols: 0,
    syncWord: 0,
    profileId: 0,
    radioStatus: 0,
    txPowerDbm: 0,
    spreadingFactor: 11,
    codingRateDenominator: 5,
    channelIndex: 0,
    radioIndex: 0,
    modulation: "lora",
    direction: "rx",
    crc: seq % 13 === 7 ? "invalid" : "valid",
    bytes,
  };
}

/* ── Telemetry ─────────────────────────────────────────────────────────────
   The TELEMETRY screen reads series from IndexedDB, where a real radio's
   packets accumulate. The demo computes its series on demand instead of
   writing invented rows into the database: deterministic diurnal curves, so
   the chart is stable between loads and nothing pollutes real storage. */

const TELE_STEP_MS = 15 * 60_000;

export function demoTelemetryNodes(): number[] {
  if (!seeded) return [];
  return [DEMO_ME, ...SPECS.map((_, i) => DEMO_NODE_FLOOR + i + 1)];
}

/** Sensors report weather on top of the device metrics every node has. */
export function demoTelemetryMetrics(node: number): string[] {
  if (!seeded) return [];
  const base = ["batteryLevel", "voltage", "channelUtilization", "airUtilTx"];
  const spec = SPECS[node - DEMO_NODE_FLOOR - 1];
  return spec?.type === ContactType.Sensor
    ? [...base, "temperature", "relativeHumidity", "barometricPressure"]
    : base;
}

/**
 * A metric's series since `sinceTs`, one sample per 15 minutes, capped at 30
 * days. Everything is a daily sinusoid with node-seeded jitter: solar charge
 * peaks mid-afternoon, channel use follows people being awake, temperature
 * and humidity move against each other, pressure wanders over days.
 */
export function demoTelemetry(
  node: number,
  metric: string,
  sinceTs: number,
): { ts: number; value: number }[] {
  if (!seeded) return [];
  const i = node - DEMO_NODE_FLOOR - 1;
  if (node !== DEMO_ME && !SPECS[i]) return [];
  const mains = node === DEMO_ME ? true : (SPECS[i].mains ?? false);

  const now = Date.now();
  const start = Math.max(sinceTs, now - 30 * 86_400_000);
  const first = now - Math.floor((now - start) / TELE_STEP_MS) * TELE_STEP_MS;
  const out: { ts: number; value: number }[] = [];

  for (let ts = first; ts <= now; ts += TELE_STEP_MS) {
    // Peaks at 14:00: solar noon-ish for charge, mid-afternoon for the rest.
    const day = Math.sin((2 * Math.PI * ((ts / 3_600_000) % 24 - 8)) / 24);
    const j = (k: number, spread: number) =>
      jitter(Math.floor(ts / TELE_STEP_MS) * 13 + (node % 997) * 7 + k, spread);
    const battery = mains
      ? 100
      : Math.min(100, Math.max(18, 72 + 16 * day + j(1, 3)));

    let v: number | undefined;
    switch (metric) {
      case "batteryLevel":
        v = battery;
        break;
      case "voltage":
        v = 3.4 + (battery / 100) * 0.75;
        break;
      case "channelUtilization":
        v = Math.max(0.5, 8 + 6 * day + j(2, 2));
        break;
      case "airUtilTx":
        v = Math.max(0.1, 1.4 + 0.9 * day + j(3, 0.4));
        break;
      case "temperature":
        v = 16 + 7 * day + j(4, 0.8);
        break;
      case "relativeHumidity":
        v = Math.min(97, Math.max(30, 62 - 18 * day + j(5, 3)));
        break;
      case "barometricPressure":
        v = 1013 + 4 * Math.sin(ts / (86_400_000 * 3)) + j(6, 0.5);
        break;
    }
    if (v !== undefined) out.push({ ts, value: Math.round(v * 100) / 100 });
  }
  return out;
}

/** Us: at the center of the map, mains-fed, heard this second. */
function meNode(now: number): NodeEntry {
  return {
    num: DEMO_ME,
    publicKey: (DEMO_ME >>> 0).toString(16).padStart(8, "0").repeat(8),
    type: ContactType.Chat,
    longName: "Lilyshark-HQ",
    shortName: "HQ",
    lastHeard: Math.round(now / 1000),
    lastAdvert: Math.round(now / 1000),
    snr: 12,
    rssi: -58,
    batteryLevel: 96,
    voltage: 4.12,
    lat: DEMO_CENTER.lat,
    lon: DEMO_CENTER.lon,
    hopsAway: 0,
    outPath: [],
  } satisfies NodeEntry;
}

const CHATTER: [number, string, number][] = [
  [5, "net check-in, Lytton Plaza, 5 by 5", 47],
  [3, "Hoover repeater back up after the power work", 44],
  [11, "walking the Baylands loop, will report path quality at the levee", 39],
  [0, "Skyline is hearing Black Mountain direct tonight, unusual", 31],
  [24, "EPA node moved to the roof, gained about 6 dB", 26],
  [18, "anyone have a spare 915 antenna? Menlo", 22],
  [26, "creek gauge 01 reading 0.42 m, steady", 17],
  [2, "Arastradero on solar only, 61% and holding", 13],
  [12, "capture uploaded, pointer going out on Primary now", 8],
  [9, "got the pointer at Caltrain, resolving it now", 6],
  [5, "resolved — 19,200 B, commitment checks out", 4],
  [31, "reminder: weekly net Thursday 19:30 on this channel", 2],
];

function buildMessages(nodes: NodeEntry[], now: number): Message[] {
  return CHATTER.map(([idx, text, minsAgo], i) => {
    const n = nodes[idx];
    return {
      id: 900_000 + i,
      convo: "ch:0",
      from: n.num,
      to: 0xffffffff,
      channel: 0,
      text,
      ts: now - minsAgo * 60_000,
      mine: false,
      state: "delivered",
      hops: n.hopsAway,
      snr: n.snr,
      rssi: n.rssi,
    } satisfies Message;
  });
}

/**
 * Seed the demo mesh. Idempotent, and a no-op once a radio has been seen — the
 * caller checks that, but the guard is kept here too so a stray call can never
 * mix invented nodes into a real capture.
 */
/* ── Live ticker ──────────────────────────────────────────────────────────
   A seeded mesh that never changes reads as a screenshot of itself. While the
   demo is up, a slow heartbeat keeps the screens honest about what the real
   instrument does all day: chatter arrives on the channel, nodes are heard
   again with fresh signal readings, and the Baylands walker actually walks —
   so the map, the tables, the unread badge and the footer all move. */

let liveTimer: ReturnType<typeof setInterval> | undefined;
let liveN = 0;

/** Rotating chatter: [SPECS index, text]. Written to loop cleanly. */
const LIVE_POOL: [number, string][] = [
  [12, "levee checkpoint — path via HVR holding at 2 hops"],
  [5, "reading the last pointer now, commitment matches"],
  [9, "Caltrain platform, RSSI to HVR up 4 dB since morning"],
  [3, "Hoover relaying 18 pkt/min, all CRC clean"],
  [0, "Skyline wx: fog rolling over the ridge, antennas dry"],
  [26, "creek gauge 02: 0.44 m, +2 cm on the hour"],
  [21, "Woodside store porch node back on solar"],
  [12, "reached the tide station, TID direct at -87 dBm"],
  [16, "Cubberley test tx done — who copied?"],
  [7, "copied Cubberley at 1 hop via Arastradero"],
  [24, "EPA roof node steady, best SNR of the week"],
  [31, "builders: bring SD cards Thursday, we rotate captures"],
  [12, "heading back, dropping a capture to Shelby at the car"],
  [1, "Windy Hill sees all three portola nodes direct tonight"],
  [28, "fire watch cam battery cycled fine overnight"],
  [5, "new .lscap up — pointer on Primary in a minute"],
];

/** The Baylands walker: a small loop along the levee, one step per tick. */
const WALKER = 12; // Baylands-Trail
const WALK_R = 0.006;

function liveTick(): void {
  if (!seeded) return;
  liveN++;
  const now = Date.now();

  mutate((s) => {
    // A couple of nodes are heard again, with believable new readings.
    const nodes = new Map(s.nodes);
    for (let k = 0; k < 3; k++) {
      const i = (liveN * 7 + k * 11) % SPECS.length;
      const num = DEMO_NODE_FLOOR + i + 1;
      const n = nodes.get(num);
      if (!n) continue;
      nodes.set(num, {
        ...n,
        lastHeard: Math.round(now / 1000),
        snr: Math.round((n.snr ?? 0) + jitter(liveN * 3 + k, 1.5)),
        rssi: Math.round((n.rssi ?? -100) + jitter(liveN * 5 + k, 2)),
      });
    }

    // The walker moves one step around the levee loop.
    const wNum = DEMO_NODE_FLOOR + WALKER + 1;
    const w = nodes.get(wNum);
    if (w) {
      const a = (liveN / 14) * 2 * Math.PI;
      nodes.set(wNum, {
        ...w,
        lat: SPECS[WALKER].lat + WALK_R * Math.sin(a),
        lon: SPECS[WALKER].lon + WALK_R * 1.2 * Math.cos(a),
        lastHeard: Math.round(now / 1000),
      });
      s.posUpdates = new Map(s.posUpdates).set(wNum, now);
    }
    s.nodes = nodes;

    // Every other tick, a message lands on the channel.
    if (liveN % 2 === 0) {
      const [idx, text] = LIVE_POOL[(liveN / 2) % LIVE_POOL.length];
      const from = DEMO_NODE_FLOOR + idx + 1;
      const sender = nodes.get(from);
      s.messages = [
        ...s.messages,
        {
          id: 920_000 + liveN,
          convo: "ch:0",
          from,
          to: 0xffffffff,
          channel: 0,
          text,
          ts: now,
          mine: false,
          state: "delivered",
          hops: sender?.hopsAway,
          snr: sender?.snr,
          rssi: sender?.rssi,
        } satisfies Message,
      ];
    }
  });
  if (liveN % 2 === 0) markUnread("ch:0");
}

function startDemoLive(): void {
  if (liveTimer !== undefined) return;
  liveTimer = setInterval(liveTick, 7000);
}

function stopDemoLive(): void {
  if (liveTimer !== undefined) {
    clearInterval(liveTimer);
    liveTimer = undefined;
  }
}

export function seedDemo(): void {
  if (seeded) return;
  const now = Date.now();
  const nodes = buildNodes(now);
  const me = meNode(now);

  mutate((s) => {
    if (s.status !== undefined && s.status >= DeviceStatus.Connected) return;
    seeded = true;

    for (const n of nodes) s.nodes.set(n.num, n);
    // Without a node of our own there is no self marker on the map and no
    // distance in any table, which makes half the screens look broken.
    if (s.myNodeNum === undefined) {
      s.myNodeNum = DEMO_ME;
      s.nodes.set(me.num, me);
      setMyNode = true;
    }
    s.nodes = new Map(s.nodes);

    s.messages = [...buildMessages(nodes, now), ...s.messages].sort((a, b) => a.ts - b.ts);

    if (!s.channels.has(0)) {
      s.channels = new Map(s.channels).set(0, { index: 0, name: "Primary" });
      createdChannel0 = true;
    }
    s.posUpdates = new Map(nodes.map((n) => [n.num, now - Math.abs(jitter(n.num, 1)) * 900_000]));
  });
  if (seeded) startDemoLive();
}

/** Drop everything seeded, so a real radio never shares the screen with it.
 *  Only what the demo itself put there is removed — a channel that was already
 *  configured, a real node number, and the log stay exactly as they were. */
export function clearDemo(): void {
  if (!seeded) return;
  seeded = false;
  stopDemoLive();
  mutate((s) => {
    const keep = new Map<number, NodeEntry>();
    for (const [num, n] of s.nodes) if (num < DEMO_NODE_FLOOR) keep.set(num, n);
    s.nodes = keep;
    s.messages = s.messages.filter((m) => m.from < DEMO_NODE_FLOOR);
    const pos = new Map<number, number>();
    for (const [num, ts] of s.posUpdates) if (num < DEMO_NODE_FLOOR) pos.set(num, ts);
    s.posUpdates = pos;

    if (setMyNode) {
      if (s.myNodeNum === DEMO_ME) s.myNodeNum = undefined;
      setMyNode = false;
    }
    const droppedCh0 = createdChannel0;
    if (createdChannel0) {
      const ch = new Map(s.channels);
      // only if it is still the one we invented
      if (ch.get(0)?.name === "Primary") ch.delete(0);
      s.channels = ch;
      createdChannel0 = false;
    }

    // Unread counters for conversations that only ever existed in the demo:
    // channel 0 if we are the ones who created it, and any DM with an
    // invented node. Everything else is a real conversation.
    const unread = new Map<string, number>();
    for (const [convo, n] of s.unread) {
      if (convo === "ch:0" && droppedCh0) continue;
      if (convo.startsWith("dm:") && Number(convo.slice(3)) >= DEMO_NODE_FLOOR) continue;
      unread.set(convo, n);
    }
    s.unread = unread;
  });
}

/** True while the screens are showing invented data. */
export function isDemo(): boolean {
  return seeded;
}
