import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { canStartDemo, clearDemo, demoSendText, isDemo, seedDemo } from "./demo";
import { DeviceStatus, getSnapshot, mutate, type NodeEntry } from "./store";
import { applyNetFrame } from './analyzerMesh';

function reset() {
  clearDemo();
  mutate(s => {
    s.nodes = new Map(); s.messages = []; s.channels = new Map();
    s.waypoints = new Map(); s.posUpdates = new Map(); s.unread = new Map();
    s.status = undefined; s.myNodeNum = undefined; s.selfInfo = undefined;
  });
}
beforeEach(reset);
afterEach(reset);

test('real network data exits demo before reusing a sample node number', () => {
  seedDemo();
  const sample = [...getSnapshot().nodes.values()].find(n => n.num !== getSnapshot().myNodeNum)!;
  applyNetFrame({ v: 1, from: 'another-analyzer', at: Date.now(), frame: {
    src: sample.num, dst: 0xffffffff, proto: 'meshtastic', port: 3,
    kind: 'POS', name: 'Real relayed node', short: 'REAL', lat: 37, lon: -122,
  } });
  assert.equal(isDemo(), false);
  const received = getSnapshot().nodes.get(sample.num)!;
  assert.equal(received.longName, 'Real relayed node');
  assert.equal(received.viaNet, true);
  assert.equal(received.viaDemo, undefined);
  assert.equal(getSnapshot().messages.some(m => m.viaDemo), false);
  clearDemo();
  assert.equal(getSnapshot().nodes.get(sample.num), received);
});

function realNode(num: number): NodeEntry {
  return { num, longName: "Real radio", shortName: "REAL", lastHeard: 123 };
}

test("the demo starts only on request and every sample carries its origin", () => {
  assert.equal(isDemo(), false);
  assert.equal(getSnapshot().nodes.size, 0);
  assert.equal(seedDemo(), true);
  const s = getSnapshot();
  assert.ok(s.nodes.size > 0);
  assert.ok([...s.nodes.values()].every(n => n.viaDemo && n.viaSim));
  assert.ok(s.messages.every(m => m.viaDemo));
  const count = s.messages.length;
  seedDemo();
  assert.equal(getSnapshot().messages.length, count, "starting twice is idempotent");
});

test("a saved node or an active connection prevents mixing in samples", () => {
  mutate(s => { s.nodes.set(1, realNode(1)); s.posUpdates.set(1, 456); });
  assert.equal(canStartDemo(), false);
  assert.equal(seedDemo(), false);
  assert.equal(getSnapshot().nodes.size, 1);
  assert.equal(getSnapshot().posUpdates.get(1), 456);
  reset();
  mutate(s => { s.status = DeviceStatus.Connecting; });
  assert.equal(seedDemo(), false);
});

test("exiting removes sample sends as well as seeded messages", () => {
  seedDemo();
  demoSendText("This was only a sample", "ch:0");
  assert.ok(getSnapshot().messages.some(m => m.mine));
  clearDemo();
  const s = getSnapshot();
  assert.equal(s.messages.length, 0);
  assert.equal(s.nodes.size, 0);
  assert.equal(s.channels.size, 0);
  assert.equal(s.posUpdates.size, 0);
  assert.equal(s.myNodeNum, undefined);
  demoSendText("Ignored after exit", "ch:0");
  assert.equal(getSnapshot().messages.length, 0);
});

test("cleanup preserves real high-numbered identities and replacement channels", () => {
  seedDemo();
  const real = realNode(0xfabcdef0);
  const replacement = realNode(0xd0000001);
  mutate(s => {
    s.nodes.set(real.num, real);
    s.nodes.set(replacement.num, replacement);
    s.posUpdates.set(real.num, 987);
    s.posUpdates.set(replacement.num, 988);
    s.channels.set(0, { index: 0, name: "LongFast" });
    s.unread.set("ch:0", 1);
    s.messages.push({ id: 12, convo: "ch:0", from: real.num, to: 0xffffffff,
      channel: 0, text: "Real reception", ts: 456, mine: false, state: "delivered" });
  });
  clearDemo();
  const s = getSnapshot();
  assert.equal(s.nodes.get(real.num), real);
  assert.equal(s.nodes.get(replacement.num), replacement);
  assert.equal(s.posUpdates.get(replacement.num), 988);
  assert.equal(s.channels.get(0)?.name, "LongFast");
  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].text, "Real reception");
  assert.equal(s.unread.get("ch:0"), 1);
});

test("an old simulated reply cannot leak into a later demo session", context => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  seedDemo();
  demoSendText("Old sample", "ch:0");
  clearDemo();
  seedDemo();
  const count = getSnapshot().messages.length;
  context.mock.timers.tick(6500);
  assert.equal(getSnapshot().messages.length, count);
  assert.equal(getSnapshot().unread.size, 0);
});

test("simulated activity creates no unread notifications and stops on exit", context => {
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  seedDemo();
  context.mock.timers.tick(28_000);
  assert.equal(getSnapshot().unread.size, 0);
  clearDemo();
  context.mock.timers.tick(28_000);
  assert.equal(getSnapshot().messages.length, 0);
  assert.equal(getSnapshot().nodes.size, 0);
});
