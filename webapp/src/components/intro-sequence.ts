/** Nine chapters, sixteen screens: the ones with the most going on, the best
 * UI and real use. No setup, controls or settings pages (Max, 2026-09-18).
 * Every firmware screen is still in public/intro/fw; this is the selection. */
export const INTRO_SCREEN_GROUPS: readonly (readonly string[])[] = [
  ['splash', 'home'],
  ['traffic', 'protocols', 'nodes'],
  ['map', 'node-detail'],
  ['utilization', 'timeline'],
  ['spectrum-live'],
  ['events'],
  ['packet-detail', 'packet-rf', 'packet-dec'],
  ['packet-hex'],
  ['storage'],
].map((screens) => screens.map((name) => `/intro/fw/${name}.png`));

export const INTRO_FRAMES = INTRO_SCREEN_GROUPS.flatMap((screens, sectionIndex) =>
  screens.map((screen) => ({ screen, sectionIndex })),
);

export const INTRO_SECTION_STARTS = INTRO_SCREEN_GROUPS.map((_, sectionIndex) =>
  INTRO_FRAMES.findIndex((frame) => frame.sectionIndex === sectionIndex),
);

/** One viewport per chapter: related screens share its scroll distance. */
export const INTRO_VIEWPORTS = INTRO_SCREEN_GROUPS.length;

function clampIndex(value: number, length: number): number {
  return Number.isNaN(value) ? 0 : Math.min(length - 1, Math.max(0, Math.round(value)));
}

/** Nearest snap stop; both endpoints and every intermediate frame are reachable. */
export function introFrameIndex(progress: number): number {
  return clampIndex(progress * (INTRO_FRAMES.length - 1), INTRO_FRAMES.length);
}

export function introFrameProgress(frameIndex: number): number {
  return clampIndex(frameIndex, INTRO_FRAMES.length) / (INTRO_FRAMES.length - 1);
}

/** Section navigation lands on its first firmware screen, even for uneven groups. */
export function introSectionProgress(sectionIndex: number): number {
  return introFrameProgress(INTRO_SECTION_STARTS[clampIndex(sectionIndex, INTRO_SCREEN_GROUPS.length)]);
}

/** Marker offset as a fraction of the track; its last viewport cannot scroll away. */
export function introSnapTop(frameIndex: number): number {
  return introFrameProgress(frameIndex) * (1 - 1 / INTRO_VIEWPORTS);
}

/**
 * `#intro?chapter=4` opens on chapter 4 (1-based, clamped). Anything else,
 * including no bag at all, is null and the intro starts at the top.
 */
export function introChapterFromHash(hash: string): number | null {
  const q = hash.indexOf('?');
  if (q < 0) return null;
  const raw = new URLSearchParams(hash.slice(q + 1)).get('chapter');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Math.min(INTRO_SCREEN_GROUPS.length, Math.max(1, Number(raw)));
}
