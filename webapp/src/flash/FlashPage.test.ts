import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

test("the flash page carries no second copy of the terminal's fonts", () => {
  // meshterm.css is the one @font-face block; Vite hashes those files out of
  // src/mesh/assets/fonts. A copy under public/flash/ would ship a second,
  // unhashed pair that nothing loads and that can silently drift.
  const strays = readdirSync(new URL("../../public/flash/", import.meta.url))
    .filter((name) => name.endsWith(".woff2"));
  assert.deepEqual(strays, []);
});
