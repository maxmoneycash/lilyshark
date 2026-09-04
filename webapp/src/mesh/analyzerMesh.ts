/**
 * Bridge: Lilyshark USB telemetry and heard frames into the mesh store
 * the NODES / MAP / CHAT screens already read.
 *
 * This radio is a listener. Heard Meshtastic nodes are shown so you can
 * see who is on the air. They are not MeshCore contacts and cannot be
 * messaged from this T-Deck.
 */

import type { DeviceTelemetry, HeardFrame } from "../lib/deviceLink";
import { setAnalyzerMeshSink } from "../lib/deviceLink";
import { clearDemo } from "./demo";
import type { NetEnvelope } from "./netProtocol";
import { addLog, mutate, type Message, type NodeEntry } from "./store";

/** Stable local id for the T-Deck itself. Not a Meshtastic node number. */
export const ANALYZER_SELF_NUM = 0x4c534b01;

function hexId(num: number): string {
  return num.toString(16);
}

function upsertLive(num: number, patch: Partial<NodeEntry>): void {
  mutate((s) => {
    const prev = s.nodes.get(num) ?? {
      num,
      longName: `!${hexId(num)}`,
      shortName: hexId(num).slice(-4),
      lastHeard: 0,
    };
    const next = { ...prev };
    for (const key of Object.keys(patch) as (keyof NodeEntry)[]) {
      const value = patch[key];
      if (value !== undefined) {
        (next as Record<string, unknown>)[key as string] = value;
      }
    }
    s.nodes = new Map(s.nodes).set(num, next);
    if (patch.lat !== undefined && patch.lon !== undefined) {
      s.posUpdates = new Map(s.posUpdates).set(num, Date.now());
    }
  });
}

function batteryFromTelemetry(sample: DeviceTelemetry): number | undefined {
  if (sample.pct !== undefined) return sample.pct;
  const m = sample.bat.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : undefined;
}

let sessionOpen = false;

/** The net bridge's publish hook, registered at app start. Kept as a setter
 *  so this module and the bridge can import each other's types without an
 *  import cycle at runtime. */
let netPublisher: ((frame: HeardFrame) => void) | undefined;
export function setNetPublisher(publish: ((frame: HeardFrame) => void) | undefined): void {
  netPublisher = publish;
}

export function applyAnalyzerLink(): void {
  if (!sessionOpen) {
    clearDemo();
    addLog("T-Deck linked over USB");
    sessionOpen = true;
  }
  mutate((s) => {
    s.myNodeNum = ANALYZER_SELF_NUM;
  });
  upsertLive(ANALYZER_SELF_NUM, {
    longName: "T-Deck",
    shortName: "ME",
    lastHeard: Date.now() / 1000,
    hopsAway: 0,
  });
}

export function applyAnalyzerUnlink(): void {
  sessionOpen = false;
  mutate((s) => {
    const nodes = new Map(s.nodes);
    nodes.delete(ANALYZER_SELF_NUM);
    s.nodes = nodes;
    if (s.myNodeNum === ANALYZER_SELF_NUM) s.myNodeNum = undefined;
    const pos = new Map(s.posUpdates);
    pos.delete(ANALYZER_SELF_NUM);
    s.posUpdates = pos;
  });
}

export function applyAnalyzerTelemetry(sample: DeviceTelemetry): void {
  applyAnalyzerLink();
  upsertLive(ANALYZER_SELF_NUM, {
    longName: "T-Deck",
    shortName: "ME",
    lastHeard: sample.atMs / 1000,
    batteryLevel: batteryFromTelemetry(sample),
    voltage: sample.mv !== undefined ? sample.mv / 1000 : undefined,
    rssi: sample.rssiX10 / 10,
    snr: sample.snrX10 / 10,
    lat: sample.lat,
    lon: sample.lon,
    hopsAway: 0,
    // The deck says whether it is making this up; the node keeps saying so.
    viaSim: sample.sim,
  });
}

export function applyHeardFrame(frame: HeardFrame): void {
  if (!frame.src) return;
  applyAnalyzerLink();
  netPublisher?.(frame);
  upsertLive(frame.src, {
    longName: frame.name ?? `!${hexId(frame.src)}`,
    shortName: frame.short ?? hexId(frame.src).slice(-4).toUpperCase(),
    lastHeard: frame.atMs / 1000,
    rssi: frame.rssiX10 / 10,
    snr: frame.snrX10 / 10,
    hopsAway: frame.hops,
    lat: frame.lat,
    lon: frame.lon,
    viaSim: frame.sim,
  });

  if (!frame.text || frame.src === ANALYZER_SELF_NUM) return;
  const BROADCAST = 0xffffffff;
  const isBroadcast = frame.dst === BROADCAST || frame.dst === 0;
  const convo = isBroadcast ? "ch:0" : `dm:${frame.src}`;
  const msg: Message = {
    id: frame.atMs ^ frame.src,
    convo,
    from: frame.src,
    to: isBroadcast ? BROADCAST : frame.dst,
    channel: 0,
    text: frame.text,
    ts: frame.atMs,
    mine: false,
    state: "delivered",
    hops: frame.hops,
    snr: frame.snrX10 / 10,
    rssi: frame.rssiX10 / 10,
  };
  mutate((s) => {
    if (!s.channels.has(0)) {
      s.channels = new Map(s.channels).set(0, { index: 0, name: "LongFast" });
    }
    if (s.messages.some((m) => m.id === msg.id && m.from === msg.from && m.ts === msg.ts)) {
      return;
    }
    s.messages = [...s.messages, msg].slice(-400);
  });
}

/** A frame relayed from another analyzer over the internet. Shown even with
 *  no deck on the cable: the web map is a viewer in its own right. Never
 *  re-published — frames enter the room only from a device link. */
export function applyNetFrame(env: NetEnvelope): void {
  const frame = env.frame;
  upsertLive(frame.src, {
    longName: frame.name ?? `!${hexId(frame.src)}`,
    shortName: frame.short ?? hexId(frame.src).slice(-4).toUpperCase(),
    lastHeard: env.at / 1000,
    hopsAway: frame.hops,
    lat: frame.lat,
    lon: frame.lon,
    viaNet: true,
  });

  if (!frame.text) return;
  const BROADCAST = 0xffffffff;
  const isBroadcast = frame.dst === BROADCAST || frame.dst === 0;
  const convo = isBroadcast ? "ch:0" : `dm:${frame.src}`;
  const msg: Message = {
    id: env.at ^ frame.src,
    convo,
    from: frame.src,
    to: isBroadcast ? BROADCAST : frame.dst,
    channel: 0,
    text: frame.text,
    ts: env.at,
    mine: false,
    state: "delivered",
    hops: frame.hops,
  };
  mutate((s) => {
    if (!s.channels.has(0)) {
      s.channels = new Map(s.channels).set(0, { index: 0, name: "LongFast" });
    }
    if (s.messages.some((m) => m.id === msg.id && m.from === msg.from && m.ts === msg.ts)) {
      return;
    }
    s.messages = [...s.messages, msg].slice(-400);
  });
}

export function bindAnalyzerMesh(): void {
  setAnalyzerMeshSink({
    onLink: applyAnalyzerLink,
    onUnlink: applyAnalyzerUnlink,
    onTelemetry: applyAnalyzerTelemetry,
    onFrame: applyHeardFrame,
  });
}

export function isAnalyzerSelf(num: number): boolean {
  return num === ANALYZER_SELF_NUM;
}
