import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = readFileSync(new URL("./Chat.tsx", import.meta.url), "utf8");
const polish = readFileSync(new URL("./chat-polish.css", import.meta.url), "utf8");

test("CHAT composer pins to visualViewport the way CONNECT does", () => {
  assert.match(chat, /window\.visualViewport/);
  assert.match(chat, /innerHeight - vv\.height - vv\.offsetTop/);
  assert.match(chat, /addEventListener\("resize", syncVv\)/);
  assert.match(chat, /addEventListener\("scroll", syncVv\)/);
  assert.match(chat, /dockRef/);
  assert.match(chat, /chat-keyboard-spacer/);
  assert.match(polish, /--keyboard-inset/);
});
