import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("./TerminalApp.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./meshterm.css", import.meta.url), "utf8");

test("DEBUG empty serial log is readable copy, not a lone cursor", () => {
  assert.match(app, /className="debug-empty"/);
  assert.match(app, /Serial is quiet\./);
  assert.match(app, /s\.log\.length === 0/);
  assert.match(css, /\.meshterm \.debug-empty/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.meshterm \.cursor/);
});
