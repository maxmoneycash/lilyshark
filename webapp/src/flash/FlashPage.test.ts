import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flashPage = readFileSync(new URL("./FlashPage.tsx", import.meta.url), "utf8");

test("FLASH picker swaps a distinct LCD for T-Deck and T-Deck Plus", () => {
  assert.match(
    flashPage,
    /id: "tdeck-plus"[\s\S]*?screen: "\/flash\/deck-screen-plus\.png"/,
  );
  assert.match(
    flashPage,
    /id: "tdeck",[\s\S]*?screen: "\/flash\/deck-screen-base\.png"/,
  );
  assert.doesNotMatch(flashPage, /T-Deck Plus pictured/);
  assert.match(flashPage, /\$\{selected\.name\} pictured/);
  const plus = readFileSync(
    new URL("../../public/flash/deck-screen-plus.png", import.meta.url),
  );
  const base = readFileSync(
    new URL("../../public/flash/deck-screen-base.png", import.meta.url),
  );
  assert.notEqual(plus.equals(base), true);
});
