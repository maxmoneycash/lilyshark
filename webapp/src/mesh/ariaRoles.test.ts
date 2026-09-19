import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ARIA forbids aria-label on an element with no role: such an element maps to
// role=generic, and browsers throw the name away. Every named container below
// therefore has to carry a role that accepts a name, or the label reaches nobody.
// The serial log is the sharpest case: it is an explicit tab stop, so a keyboard
// and screen-reader user lands on it and hears nothing (WCAG 2.1 4.1.2).

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The opening tag that carries `label`, so attribute order does not matter. */
const taggedBy = (text: string, label: string) => {
  const at = text.indexOf(`aria-label="${label}"`);
  assert.notEqual(at, -1, `no element is labelled "${label}" any more`);
  const open = text.lastIndexOf("<", at);
  const close = text.indexOf(">", at);
  assert.ok(open !== -1 && close !== -1, `could not read the tag around "${label}"`);
  return text.slice(open, close + 1);
};

const named: Array<[string, string, string]> = [
  ["../components/IoGraphPanel.tsx", "Capture IO graph, frames over time", 'role="img"'],
  ["./ThisDevice.tsx", "Capture and attribution counters", 'role="group"'],
  ["./screens/CoverageCanvas.tsx", "MeshCore public nodes and community coverage", 'role="group"'],
  ["./screens/CoverageCanvas.tsx", "Map tools", 'role="group"'],
  ["./screens/CoverageCanvas.tsx", "Coverage legend", 'role="group"'],
  ["./screens/Spectrum.tsx", "Frequency in megahertz", 'role="group"'],
];

for (const [path, label, role] of named) {
  const tag = taggedBy(source(path), label);
  assert.ok(tag.includes(role), `"${label}" needs ${role} for its name to survive: ${tag}`);
}

// role=log accepts a name and keeps the existing tab stop; aria-live="off" stops
// a screen reader reading out every serial line as it arrives.
const serialLog = taggedBy(source("./TerminalApp.tsx"), "Serial log");
assert.ok(serialLog.includes('role="log"'), `the serial log needs role=log: ${serialLog}`);
assert.ok(serialLog.includes('aria-live="off"'), `the serial log must not announce: ${serialLog}`);
assert.ok(serialLog.includes("tabIndex={0}"), `the serial log must stay reachable: ${serialLog}`);

console.log("ariaRoles.test.ts OK");
