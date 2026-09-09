import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tab = readFileSync(new URL("./TrafficTab.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./traffic.css", import.meta.url), "utf8");

test("TRAFFIC filter and brush misses fill the pane instead of a dim footnote", () => {
  assert.match(tab, /traffic-frames-empty/);
  assert.match(tab, /No frame matches this filter\./);
  assert.match(tab, /Nothing was heard in/);
  assert.match(tab, /Keyboard activation never hits the click-capture/);
  assert.match(css, /\.traffic-table/);
  assert.match(css, /border-collapse:\s*separate/);
  assert.match(css, /position:\s*sticky/);
});
