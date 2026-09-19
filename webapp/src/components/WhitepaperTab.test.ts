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

test("PAPER toolbar pins to the top of its scrollport, not below a header offset", () => {
  // Below 860px `.pdf-scroll` is the scroll container and the header is
  // static, so the sticky containing block already starts under the header.
  // A `top` offset in the phone block would leave a live band of whitepaper
  // scrolling above the bar.
  const phone = css.slice(css.indexOf("@media (max-width: 860px)"));
  assert.ok(phone.length > 0, "expected a max-width: 860px block");
  const toolbar = phone.slice(
    phone.indexOf(".pdf-toolbar {"),
    phone.indexOf("}", phone.indexOf(".pdf-toolbar {")),
  );
  assert.doesNotMatch(toolbar, /(^|[\s;{])top\s*:/);
  assert.match(css, /position:\s*sticky;\s*top:\s*0;/);
});
