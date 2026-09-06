/**
 * Keep the original twelve narrative groups, including every published render.
 * The four older stills (traffic, timeline, spectrum, packet-detail) are distinct
 * examples/empty states from their live counterparts, so they remain reachable.
 */
export const INTRO_SCREEN_GROUPS: readonly (readonly string[])[] = [
  ['splash', 'home'],
  ['traffic', 'traffic-live', 'protocols', 'protocol-detail', 'nodes'],
  ['map', 'node-detail', 'survey'],
  ['utilization', 'timeline', 'timeline-live', 'traffic-filter'],
  ['spectrum', 'spectrum-live', 'spectrum-warning'],
  ['events', 'event-detail'],
  ['packet-detail', 'packet-live', 'packet-pkt', 'packet-rf', 'packet-dec'],
  ['packet-hex', 'packet-hex-2', 'packet-hex-3', 'packet-raw'],
  ['setup-welcome', 'setup-capabilities', 'setup-network', 'setup-profile'],
  ['setup-controls', 'setup-ready', 'device-status', 'help'],
  ['settings', 'radio-profile', 'display-input', 'about', 'reset-setup'],
  ['storage'],
].map((screens) => screens.map((name) => `/intro/fw/${name}.png`));

export const INTRO_FRAMES = INTRO_SCREEN_GROUPS.flatMap((screens, sectionIndex) =>
  screens.map((screen) => ({ screen, sectionIndex })),
);

export const INTRO_SECTION_STARTS = INTRO_SCREEN_GROUPS.map((_, sectionIndex) =>
  INTRO_FRAMES.findIndex((frame) => frame.sectionIndex === sectionIndex),
);

/** Preserve the original overall track length, including the sticky viewport. */
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
