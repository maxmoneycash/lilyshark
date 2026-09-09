import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const map = readFileSync(
  new URL("./CommunityCoverageMap.tsx", import.meta.url),
  "utf8",
);

test("MAP refresh does not yank My mesh over to Coverage", () => {
  assert.match(map, /async function refresh\(\)/);
  assert.doesNotMatch(
    map,
    /if \(result\.cache\.report\) setMode\('coverage'\)/,
  );
  assert.match(map, /if \(focusNode !== undefined\) setMode\('radio'\)/);
});
