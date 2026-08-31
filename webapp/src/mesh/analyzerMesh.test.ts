import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYZER_SELF_NUM,
  applyAnalyzerLink,
  applyAnalyzerTelemetry,
  applyAnalyzerUnlink,
  applyHeardFrame,
} from "./analyzerMesh.ts";
import { clearDemo, seedDemo } from "./demo.ts";
import { getSnapshot } from "./store.ts";

test("linking the T-Deck drops the demo mesh and pins ME", () => {
  seedDemo();
  assert.ok(getSnapshot().nodes.size > 8);
  applyAnalyzerLink();
  const s = getSnapshot();
  assert.equal(s.myNodeNum, ANALYZER_SELF_NUM);
  assert.ok(s.nodes.get(ANALYZER_SELF_NUM));
  assert.equal(s.nodes.get(ANALYZER_SELF_NUM)?.shortName, "ME");
  assert.ok(
    [...s.nodes.values()].every((n) => n.num === ANALYZER_SELF_NUM || n.num < 0xd0000000),
    "demo nodes must leave when the T-Deck links",
  );
  applyAnalyzerUnlink();
  clearDemo();
});

test("telemetry with a fix puts the T-Deck on the map", () => {
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
  const me = getSnapshot().nodes.get(ANALYZER_SELF_NUM);
  assert.ok(me);
  assert.equal(me.lat, 37.4419);
  assert.equal(me.lon, -122.143);
  assert.equal(me.batteryLevel, 64);
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
