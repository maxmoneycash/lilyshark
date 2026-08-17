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
