import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tab = readFileSync(new URL("./Shelby.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./shelby.css", import.meta.url), "utf8");

test("SHELBY drops the 360px evidence column on a phone and uses readable empty copy", () => {
  assert.match(tab, /className="panel shelby-evidence"/);
  assert.doesNotMatch(tab, /style=\{\{ width: 360/);
  assert.match(tab, /className="shelby-empty"/);
  assert.match(tab, /Indexer unreachable\./);
  assert.match(tab, /Registry unavailable\./);
  assert.match(tab, /Retry loading the registry/);
  assert.match(tab, /Retry loading network stats/);
  assert.match(css, /\.shelby-empty\[role="alert"\] \{[\s\S]*gap:\s*12px/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.shelby-evidence \{[\s\S]*width:\s*auto/);
  assert.match(css, /min-height:\s*44px/);
});
