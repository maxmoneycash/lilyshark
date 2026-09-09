import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mesh = readFileSync(new URL("./Mesh.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./radio-analysis.css", import.meta.url), "utf8");

test("MESH empty graph and activity states use readable copy, not a dim line", () => {
  assert.match(mesh, /className="mesh-empty"/);
  assert.match(mesh, /No sightings in this range\./);
  assert.match(mesh, /No links recorded\./);
  assert.doesNotMatch(mesh, /className="dim" style=\{\{ padding: 16/);
  assert.match(css, /\.meshterm \.mesh-empty/);
  assert.match(css, /min-height:\s*10rem/);
});
