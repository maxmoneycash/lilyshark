import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tab = readFileSync(new URL("./WhitepaperTab.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./whitepaper.css", import.meta.url), "utf8");

test("PAPER toolbar stays short and sticky on a phone", () => {
  assert.match(tab, /import "\.\/whitepaper\.css"/);
  assert.match(tab, /WHITEPAPER · \{PAGES\} PP/);
  assert.doesNotMatch(tab, /THE GROWTH TRAP/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /min-height:\s*44px/);
});
