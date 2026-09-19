import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The entry chunk is what every visitor downloads before anything appears,
 * including the people who only came for the flasher. A heavy screen that is
 * not the landing screen belongs behind lazy(), so its code arrives the first
 * time somebody opens it and never before.
 *
 * TRAFFIC was the last heavy screen still imported statically: it dragged
 * uPlot and its stylesheet, the capture-diff and frame-table panels and the
 * RNode dissector into the first load of every visit. This pins the pattern so
 * none of these can quietly slide back into the entry chunk.
 */
const terminal = readFileSync(new URL("./TerminalApp.tsx", import.meta.url), "utf8");

const lazyScreens: Array<[name: string, module: string]> = [
  ["MapView", "./screens/MapView"],
  ["Telemetry", "./screens/Telemetry"],
  ["Docs", "./screens/Docs"],
  ["Spectrum", "./screens/Spectrum"],
  ["Sniffer", "./screens/Sniffer"],
  ["TrafficTab", "../components/TrafficTab"],
  ["FlashPage", "../flash/FlashPage"],
];

for (const [name, module] of lazyScreens) {
  assert.match(
    terminal,
    new RegExp(`const ${name} = lazy\\(\\(\\) => import\\("${module}"\\)`),
    `${name} must load on first visit, not ride in the entry chunk`,
  );
  // A static import of the same module puts it back in the entry chunk however
  // the screen itself is declared, so the lazy() alone does not settle it.
  assert.doesNotMatch(
    terminal,
    new RegExp(`^import .* from "${module}";$`, "m"),
    `${name} must not also be imported statically`,
  );
}
