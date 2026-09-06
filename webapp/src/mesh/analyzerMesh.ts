/**
 * Bridge: Lilyshark USB telemetry and heard frames into the mesh store
 * the NODES / MAP / CHAT screens already read.
 *
 * Node identity and RF measurements come from the deck's reported fields.
 * Its own transmissions also enter this stream, with a transmit direction.
 */

import type { DeviceTelemetry, HeardFrame } from "../lib/deviceLink";
import { setAnalyzerMeshSink } from "../lib/deviceLink";
import { RF_FIELD } from "../lib/lscap";
import { clearDemo } from "./demo";
import { batteryUnavailable, telemetryBattery, telemetryVoltage } from "./deviceTelemetry";
import type { NetEnvelope } from "./netProtocol";
import { addLog, mutate, type Message, type NodeEntry } from "./store";

let linkedNodeNum: number | undefined;

export function getLinkedNodeNum(): number | undefined {
  return linkedNodeNum;
}

function hexId(num: number): string {
  return num.toString(16);
}

function upsertLive(num: number, patch: Partial<NodeEntry>, clear: readonly (keyof NodeEntry)[] = []): void {
  mutate((s) => {
    const prev = s.nodes.get(num) ?? {
      num,
      longName: `!${hexId(num)}`,
      shortName: hexId(num).slice(-4),
      lastHeard: 0,
    };
    const next = { ...prev };
    for (const key of clear) Reflect.deleteProperty(next, key);
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

let sessionOpen = false;

/** The net bridge's publish hook, registered at app start. Kept as a setter
 *  so this module and the bridge can import each other's types without an
 *  import cycle at runtime. */
let netPublisher: ((frame: HeardFrame) => void) | undefined;
export function setNetPublisher(publish: ((frame: HeardFrame) => void) | undefined): void {
  netPublisher = publish;
}

export function applyAnalyzerLink(node?: number): void {
  if (!sessionOpen) {
    clearDemo();
    addLog("T-Deck linked over USB");
    sessionOpen = true;
  }
  if (node !== undefined && node !== linkedNodeNum) {
    if (linkedNodeNum !== undefined) applyAnalyzerUnlink();
    linkedNodeNum = node;
    sessionOpen = true;
  }
  mutate((s) => {
    s.myNodeNum = linkedNodeNum;
  });
  if (linkedNodeNum === undefined) return;
  upsertLive(linkedNodeNum, {
    lastHeard: Date.now() / 1000,
    hopsAway: 0,
  });
}

export function applyAnalyzerUnlink(): void {
  sessionOpen = false;
  const previous = linkedNodeNum;
  linkedNodeNum = undefined;
  if (previous === undefined) return;
  mutate((s) => {
    const nodes = new Map(s.nodes);
    nodes.delete(previous);
    s.nodes = nodes;
    if (s.myNodeNum === previous) s.myNodeNum = undefined;
    const pos = new Map(s.posUpdates);
    pos.delete(previous);
    s.posUpdates = pos;
  });
}

export function applyAnalyzerTelemetry(sample: DeviceTelemetry): void {
  applyAnalyzerLink();
  if (linkedNodeNum === undefined) return;
  upsertLive(linkedNodeNum, {
    lastHeard: sample.atMs / 1000,
    batteryLevel: telemetryBattery(sample),
    voltage: telemetryVoltage(sample),
    // Last-packet RSSI/SNR describes a received frame, not this deck's signal.
    lat: sample.lat,
    lon: sample.lon,
    hopsAway: 0,
    // The deck says whether it is making this up; the node keeps saying so.
    viaSim: sample.sim,
  }, batteryUnavailable(sample) ? ["batteryLevel", "voltage"] : []);
}

export function applyHeardFrame(frame: HeardFrame): void {
  if (!frame.src) return;
  applyAnalyzerLink();
  netPublisher?.(frame);
  const mine = frame.raw
    ? frame.raw.direction === 2 // FrameDirection::Transmit
    : linkedNodeNum !== undefined && frame.src === linkedNodeNum;
  const rssi = !mine && (!frame.raw || (frame.raw.presentFields & RF_FIELD.rssi) !== 0)
    ? frame.rssiX10 / 10 : undefined;
  const snr = !mine && (!frame.raw || (frame.raw.presentFields & RF_FIELD.snr) !== 0)
    ? frame.snrX10 / 10 : undefined;
  upsertLive(frame.src, {
    longName: frame.name,
    shortName: frame.short,
    lastHeard: frame.atMs / 1000,
    rssi,
    snr,
    hopsAway: mine ? 0 : frame.hops,
    lat: frame.lat,
    lon: frame.lon,
    viaSim: frame.sim,
    viaNet: false,
  });

  if (!frame.text) return;
  const BROADCAST = 0xffffffff;
  const isBroadcast = frame.dst === BROADCAST || frame.dst === 0;
  const convo = isBroadcast ? "ch:0" : `dm:${mine ? frame.dst : frame.src}`;
  const msg: Message = {
    id: frame.atMs ^ frame.src,
    convo,
    from: frame.src,
    to: isBroadcast ? BROADCAST : frame.dst,
    channel: 0,
    text: frame.text,
    ts: frame.atMs,
    mine,
    state: mine ? "sent" : "delivered",
    hops: mine ? 0 : frame.hops,
    snr,
    rssi,
  };
  mutate((s) => {
    if (!s.channels.has(0)) {
      s.channels = new Map(s.channels).set(0, { index: 0, name: "LongFast" });
    }
    if (s.messages.some((m) => m.id === msg.id && m.from === msg.from && m.ts === msg.ts)) {
      return;
    }
    // The USB command creates a row before the firmware reports the frame.
    // Consume one matching echo, so repeated hardware sends still get rows.
    if (mine) {
      const index = s.messages.findIndex((m) => m.awaitingEcho && m.mine &&
        m.state !== "failed" && m.text === msg.text && m.to === msg.to &&
        m.convo === msg.convo && Math.abs(m.ts - msg.ts) < 60_000);
      if (index >= 0) {
        s.messages = s.messages.map((m, i) => i === index ? { ...m, awaitingEcho: false } : m);
        return;
      }
    }
    s.messages = [...s.messages, msg].slice(-400);
  });
}

/** A frame relayed from another analyzer over the internet. Shown even with
 *  no deck on the cable: the web map is a viewer in its own right. Never
 *  re-published — frames enter the room only from a device link. */
export function applyNetFrame(env: NetEnvelope): void {
  const frame = env.frame;
  if (linkedNodeNum !== undefined && frame.src === linkedNodeNum) return;
  upsertLive(frame.src, {
    longName: frame.name,
    shortName: frame.short,
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
  return linkedNodeNum !== undefined && num === linkedNodeNum;
}
