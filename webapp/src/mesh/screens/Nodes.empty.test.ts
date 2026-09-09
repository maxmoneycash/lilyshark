import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nodes = readFileSync(new URL("./Nodes.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./nodes.css", import.meta.url), "utf8");

test("NODES empty filter uses readable copy and a 44px search field", () => {
  assert.match(nodes, /className="nodes-empty"/);
  assert.match(nodes, /<h2>/);
  assert.match(nodes, /CLEAR FILTER/);
  assert.match(nodes, /type="search"/);
  assert.match(nodes, /visibleSelected/);
  assert.match(css, /\.nodes-empty-clear/);
  assert.match(css, /\.nodes-filter[\s\S]*min-height:\s*44px/);
  assert.match(css, /\.nodes-detail \{[\s\S]*width:\s*100%/);
});
