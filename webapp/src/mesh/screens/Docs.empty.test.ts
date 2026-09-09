import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const docs = readFileSync(new URL("./Docs.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./docs.css", import.meta.url), "utf8");

test("DOCS failed fetches expose Retry instead of a dead error line", () => {
  assert.match(docs, /className="docs-retry"/);
  assert.match(docs, /className="docs-retry"[\s\S]*Retry/);
  assert.match(docs, /setListAttempt/);
  assert.match(docs, /setDocAttempt/);
  assert.match(docs, /Documents unavailable/);
  assert.match(docs, /Could not load the document list/);
  assert.match(docs, /Could not load this document/);
  assert.match(css, /\.meshterm \.docs-grid \.docs-retry/);
  assert.match(css, /\.meshterm \.docs-grid \.docs-error/);
});
