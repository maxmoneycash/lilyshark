import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sniffer = readFileSync(new URL("./Sniffer.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./radio-analysis.css", import.meta.url), "utf8");

test("SNIFFER phone picks scroll the inspector into view, including keyboard", () => {
  assert.match(sniffer, /pendingReveal/);
  assert.match(sniffer, /revealDetail/);
  assert.match(sniffer, /max-width: 860px/);
  assert.match(sniffer, /Keyboard activation never hits the click-capture/);
  assert.match(sniffer, /detailRef/);
  assert.match(css, /\.sniffer-detail[\s\S]*scroll-margin-top/);
});
