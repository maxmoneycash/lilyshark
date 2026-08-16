import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  startTrafficDemoInterval,
  TRAFFIC_DEMO_INTERVAL_MS,
} from "../components/trafficDemo.ts";

let scheduled: (() => void) | undefined;
let scheduledDelay = 0;
let cleared: ReturnType<typeof setInterval> | undefined;
const handle = 17 as unknown as ReturnType<typeof setInterval>;
const start = (callback: () => void, delayMs: number) => {
  scheduled = callback;
  scheduledDelay = delayMs;
  return handle;
};
const stop = (value: ReturnType<typeof setInterval>) => {
  cleared = value;
};
const fireScheduled = () => {
  assert.ok(scheduled);
  scheduled();
};

let injected = 0;
assert.equal(
  startTrafficDemoInterval(false, () => true, () => injected++, start, stop),
  undefined,
);
assert.equal(scheduled, undefined, "device mode must not schedule synthetic frames");

let mayInject = true;
const cleanup = startTrafficDemoInterval(
  true,
  () => mayInject,
  () => injected++,
  start,
  stop,
);
assert.equal(scheduledDelay, TRAFFIC_DEMO_INTERVAL_MS);
fireScheduled();
assert.equal(injected, 1);
mayInject = false;
fireScheduled();
assert.equal(injected, 1, "a queued tick must not inject after demo mode ends");
cleanup?.();
assert.equal(cleared, handle, "leaving demo mode must clear the synthetic timer");

const traffic = readFileSync(
  new URL("../components/TrafficTab.tsx", import.meta.url),
  "utf8",
);
const terminal = readFileSync(new URL("./TerminalApp.tsx", import.meta.url), "utf8");
const shelby = readFileSync(new URL("./screens/Shelby.tsx", import.meta.url), "utf8");

assert.match(traffic, /startTrafficDemoInterval\(\s*simulatedLive,/);
assert.match(traffic, /SYNTHETIC · NOT OTA/);
assert.match(traffic, /SIM DISABLED/);
assert.match(
  terminal,
  /demoActive=\{!connected && !everConnectedRef\.current\}/,
);

assert.doesNotMatch(shelby, /\bmeasured\b/i);
assert.match(shelby, />DEMO RATE</);
assert.match(shelby, /from synthetic sample metadata/);
assert.match(shelby, /DECODED FROM SYNTHETIC SAMPLE/);

console.log("web_truth.test.ts OK");
