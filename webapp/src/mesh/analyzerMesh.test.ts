import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAnalyzerLink,
  applyAnalyzerTelemetry,
  applyAnalyzerUnlink,
  applyHeardFrame,
} from "./analyzerMesh.ts";
import { parseLskLine } from "../lib/deviceLink";
import { RF_FIELD } from "../lib/lscap";
import { clearDemo, seedDemo } from "./demo.ts";
import { getSnapshot } from "./store.ts";
const DECK_A = 0x96f61b44;

test("linking the T-Deck drops the demo mesh and pins ME", () => {
  seedDemo();
  assert.ok(getSnapshot().nodes.size > 8);
  applyAnalyzerLink(DECK_A);
  const s = getSnapshot();
  assert.equal(s.myNodeNum, DECK_A);
  assert.ok(s.nodes.get(DECK_A));
  assert.equal(s.nodes.has(0x4c534b01), false);
  assert.ok(
    [...s.nodes.values()].every((n) => n.num === DECK_A || n.num < 0xd0000000),
    "demo nodes must leave when the T-Deck links",
  );
  applyAnalyzerUnlink();
  clearDemo();
});

test("telemetry with a fix puts the T-Deck on the map", () => {
  applyAnalyzerLink(DECK_A);
  applyAnalyzerTelemetry({
    bat: "BAT 64%",
    gps: "GPS FIX 8",
    profile: "LongFast",
    frames: 9,
    rssiX10: -880,
    snrX10: 60,
    sim: false,
    lat: 37.4419,
    lon: -122.143,
    atMs: 1_700_000_100_000,
  });
  const me = getSnapshot().nodes.get(DECK_A);
  assert.ok(me);
  assert.equal(me.lat, 37.4419);
  assert.equal(me.lon, -122.143);
  assert.equal(me.batteryLevel, 64);
  assert.equal(me.rssi, undefined, "a last-packet reading does not measure this deck");
  assert.equal(me.snr, undefined);
  applyAnalyzerUnlink();
});

test("an explicitly unavailable battery clears old readings while a partial sample preserves them", () => {
  applyAnalyzerLink(DECK_A);
  const send = (fields: Record<string, unknown>) => {
    const parsed = parseLskLine(`LSK T ${JSON.stringify(fields)}`);
    assert.ok(parsed?.kind === "T");
    applyAnalyzerTelemetry(parsed.telemetry);
    return getSnapshot().nodes.get(DECK_A)!;
  };
  send({ bat: "BAT 64%", pct: 64, mv: 3980 });
  const partial = send({ rx: 3 });
  assert.equal(partial.batteryLevel, 64);
  assert.equal(partial.voltage, 3.98);
  const unavailable = send({ bat: "BAT --", pct: 0, mv: 0 });
  assert.equal(unavailable.batteryLevel, undefined);
  assert.equal(unavailable.voltage, undefined);
  const restored = send({ bat: "BAT 0%", pct: 0, mv: 3000 });
  assert.equal(restored.batteryLevel, 0, "a real zero reading remains present");
  assert.equal(restored.voltage, 3);
  applyAnalyzerUnlink();
});

test("unknown identity stays absent and two decks never share a made-up ID", () => {
  applyAnalyzerUnlink();
  clearNodes();
  applyAnalyzerLink();
  assert.equal(getSnapshot().myNodeNum, undefined);
  assert.equal(getSnapshot().nodes.size, 0);
  applyAnalyzerLink(DECK_A);
  assert.equal(getSnapshot().myNodeNum, DECK_A);
  applyAnalyzerLink(0xcda172e0);
  assert.equal(getSnapshot().myNodeNum, 0xcda172e0);
  assert.equal(getSnapshot().nodes.has(DECK_A), false);
  applyAnalyzerUnlink();
  assert.equal(getSnapshot().myNodeNum, undefined);
});

function rawFrame(over: Record<string, unknown>) {
  const parsed = parseLskLine(`LSK F ${JSON.stringify({
    src: DECK_A, dst: 0xffffffff, proto: "meshtastic", kind: "TEXT", port: 1,
    seq: 1, hex: "00", dir: 1, pf: RF_FIELD.rssi | RF_FIELD.snr,
    rssi_x10: -910, snr_x10: 50, sim: false, ...over,
  })}`);
  assert.ok(parsed?.kind === "F");
  return parsed.frame;
}

test("transmitted frames are outgoing, have no measured signal, and never claim delivery", () => {
  clearNodes();
  applyAnalyzerLink(DECK_A);
  applyHeardFrame(rawFrame({ dir: 2, pf: 0, rssi_x10: 0, snr_x10: 0, text: "hello", dst: 0x1234 }));
  const message = getSnapshot().messages[0];
  assert.equal(message.mine, true);
  assert.equal(message.convo, "dm:4660");
  assert.equal(message.state, "sent");
  assert.equal(message.rssi, undefined);
  assert.equal(message.snr, undefined);
  assert.equal(getSnapshot().nodes.get(DECK_A)?.rssi, undefined);
  applyAnalyzerUnlink();
});

test("a missing RF field stays absent while a reported zero is preserved", () => {
  clearNodes();
  applyHeardFrame(rawFrame({ src: 0x1234, pf: 0, rssi_x10: 0, snr_x10: 0 }));
  assert.equal(getSnapshot().nodes.get(0x1234)?.rssi, undefined);
  applyHeardFrame(rawFrame({ src: 0x5678, rssi_x10: 0, snr_x10: 0 }));
  assert.equal(getSnapshot().nodes.get(0x5678)?.rssi, 0);
  assert.equal(getSnapshot().nodes.get(0x5678)?.snr, 0);
  applyAnalyzerUnlink();
});

test("unnamed frames preserve an advertised name", () => {
  clearNodes();
  applyHeardFrame(rawFrame({ src: 0x1234, name: "Creek relay", short: "CRK" }));
  applyHeardFrame(rawFrame({ src: 0x1234, text: "hello" }));
  assert.equal(getSnapshot().nodes.get(0x1234)?.longName, "Creek relay");
  assert.equal(getSnapshot().nodes.get(0x1234)?.shortName, "CRK");
  applyAnalyzerUnlink();
});

test("one USB send consumes one echo without swallowing repeated hardware messages", () => {
  clearNodes();
  applyAnalyzerLink(DECK_A);
  const now = Date.now();
  mutate((s) => { s.messages = [{
    id: 123, from: DECK_A, to: 0xffffffff, channel: 0, convo: "ch:0",
    text: "repeatable", ts: now, mine: true, state: "queued", awaitingEcho: true,
  }]; });
  const echo = rawFrame({ dir: 2, pf: 0, text: "repeatable" });
  echo.atMs = now + 1;
  applyHeardFrame(echo);
  assert.equal(getSnapshot().messages.length, 1);
  assert.equal(getSnapshot().messages[0].awaitingEcho, false);
  assert.equal(getSnapshot().messages[0].state, "queued", "the console result still owns transmit status");
  applyHeardFrame({ ...echo, atMs: now + 2 });
  assert.equal(getSnapshot().messages.length, 2, "a later hardware send is a separate message");
  applyAnalyzerUnlink();
});

test("a heard Meshtastic position becomes a node you can see", () => {
  applyHeardFrame({
    src: 0x336a1b2c,
    dst: 0xffffffff,
    proto: "Meshtastic",
    port: 3,
    hops: 1,
    rssiX10: -912,
    snrX10: 41,
    kind: "POSITION",
    sim: false,
    lat: 37.45,
    lon: -122.16,
    name: "Bay-Node",
    short: "BAY",
    atMs: 1_700_000_200_000,
  });
  const n = getSnapshot().nodes.get(0x336a1b2c);
  assert.ok(n);
  assert.equal(n.longName, "Bay-Node");
  assert.equal(n.shortName, "BAY");
  assert.equal(n.lat, 37.45);
  assert.equal(n.hopsAway, 1);
  applyAnalyzerUnlink();
});

// The seam the whole three-city demo rides on: an envelope another operator's
// analyzer published becomes a node on this map and a message in this chat.
// Until now this path was only checked by grepping the source for the
// function's name, which proves it exists and nothing about what it does.
import { applyNetFrame, setNetPublisher } from "./analyzerMesh.ts";
import { encodeEnvelope, shouldPublish } from "./netProtocol.ts";
import { mutate } from "./store.ts";

function clearNodes(): void {
  mutate((s) => {
    s.nodes = new Map();
    s.messages = [];
  });
}

test("a relayed frame puts a distant node on the map, marked NET", () => {
  clearNodes();
  applyNetFrame({
    v: 1,
    from: "lsk-cupertino",
    at: 1_772_000_000_000,
    frame: {
      src: 0x96f61b44,
      dst: 0xffffffff,
      proto: "meshtastic",
      port: 3,
      kind: "POS",
      name: "Cupertino",
      short: "CUPE",
      lat: 37.323,
      lon: -122.0322,
    },
  });
  const node = getSnapshot().nodes.get(0x96f61b44);
  assert.ok(node, "the relayed node never reached the store");
  assert.equal(node.longName, "Cupertino");
  assert.equal(node.lat, 37.323);
  assert.equal(node.lon, -122.0322);
  assert.equal(node.viaNet, true, "a bridged node must be marked NET");
  // A frame that crossed the internet carries no local measurement, and
  // inventing one would be a lie in the column that reports measurements.
  assert.equal(node.snr, undefined);
  assert.equal(node.rssi, undefined);
});

test("a relayed text becomes a message in the right conversation", () => {
  clearNodes();
  applyNetFrame({
    v: 1,
    from: "lsk-cupertino",
    at: 1_772_000_001_000,
    frame: {
      src: 0x96f61b44,
      dst: 0xffffffff,
      proto: "meshtastic",
      port: 1,
      kind: "TEXT",
      text: "MADE IT ONTO THE MESH",
    },
  });
  const broadcast = getSnapshot().messages.filter((m) => m.convo === "ch:0");
  assert.equal(broadcast.length, 1);
  assert.equal(broadcast[0].text, "MADE IT ONTO THE MESH");
  assert.equal(broadcast[0].mine, false);

  // A direct message lands in its own thread, not the broadcast channel.
  applyNetFrame({
    v: 1,
    from: "lsk-cupertino",
    at: 1_772_000_002_000,
    frame: {
      src: 0x96f61b44,
      dst: 0x4c534b01,
      proto: "meshtastic",
      port: 1,
      kind: "TEXT",
      text: "just for you",
    },
  });
  // Derived, not a hand-typed decimal of a hex constant — the first version
  // of this line had the wrong number and failed for that reason alone.
  const direct = getSnapshot().messages.filter((m) => m.convo === `dm:${0x96f61b44}`);
  assert.equal(direct.length, 1, "a relayed DM must open its own conversation");
  assert.equal(direct[0].text, "just for you");
});

test("the same relayed frame arriving twice is stored once", () => {
  // Two analyzers in the room both hear the sender and both publish, so
  // duplicates are the normal case rather than the exception.
  clearNodes();
  const envelope = {
    v: 1 as const,
    from: "lsk-other",
    at: 1_772_000_003_000,
    frame: {
      src: 0x11223344,
      dst: 0xffffffff,
      proto: "meshtastic",
      port: 1,
      kind: "TEXT",
      text: "heard twice",
    },
  };
  applyNetFrame(envelope);
  applyNetFrame(envelope);
  assert.equal(getSnapshot().messages.length, 1, "a duplicate relay was stored twice");
});

test("a relayed frame is never published back into the room", () => {
  // The loop guard, end to end through the publisher hook: applyNetFrame must
  // not reach the publisher at all. Three analyzers would otherwise turn one
  // beacon into a storm.
  clearNodes();
  let published = 0;
  setNetPublisher(() => {
    published += 1;
  });
  applyNetFrame({
    v: 1,
    from: "lsk-other",
    at: 1_772_000_004_000,
    frame: { src: 0x55667788, dst: 0xffffffff, proto: "meshtastic", port: 1, kind: "TEXT",
             text: "must not echo" },
  });
  assert.equal(published, 0, "a relayed frame was republished into the room");

  // ...while a frame the linked deck really heard still publishes.
  applyHeardFrame({
    src: 0x99aabbcc,
    dst: 0xffffffff,
    proto: "meshtastic",
    port: 1,
    rssiX10: -700,
    snrX10: 55,
    kind: "TEXT",
    sim: false,
    atMs: 1_772_000_005_000,
    text: "heard on the air",
  });
  assert.equal(published, 1, "a device-heard frame must publish");
  setNetPublisher(undefined);
});

test("encodeEnvelope round-trips a device frame the relay would send", () => {
  const frame = {
    src: 0xcda172e0,
    dst: 0xffffffff,
    proto: "meshtastic",
    port: 3,
    rssiX10: -651,
    snrX10: 42,
    kind: "POS",
    sim: false,
    atMs: 1_772_000_006_000,
    lat: 38.3996,
    lon: -122.5795,
  };
  assert.equal(shouldPublish(frame), true);
  const env = encodeEnvelope(frame, "lsk-kenwood", 1_772_000_006_000);
  clearNodes();
  applyNetFrame(env);
  const node = getSnapshot().nodes.get(0xcda172e0);
  assert.ok(node);
  assert.equal(node.lat, 38.3996);
  assert.equal(node.viaNet, true);
});
