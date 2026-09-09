import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import {
  INTRO_FRAMES,
  INTRO_SCREEN_GROUPS,
  INTRO_SECTION_STARTS,
  INTRO_VIEWPORTS,
  introFrameIndex,
  introFrameProgress,
  introSectionProgress,
  introSnapTop,
} from './intro-sequence.ts';

test('the tour preserves the deployed twelve chapters and all 42 firmware screens', () => {
  assert.equal(INTRO_SCREEN_GROUPS.length, 12);
  assert.equal(INTRO_FRAMES.length, 42);
  assert.equal(INTRO_VIEWPORTS, 12);
  const screens = INTRO_FRAMES.map((frame) => frame.screen);
  assert.deepEqual(screens, [
    'splash', 'home',
    'traffic', 'traffic-live', 'protocols', 'protocol-detail', 'nodes',
    'map', 'node-detail', 'survey',
    'utilization', 'timeline', 'timeline-live', 'traffic-filter',
    'spectrum', 'spectrum-live', 'spectrum-warning',
    'events', 'event-detail',
    'packet-detail', 'packet-live', 'packet-pkt', 'packet-rf', 'packet-dec',
    'packet-hex', 'packet-hex-2', 'packet-hex-3', 'packet-raw',
    'setup-welcome', 'setup-capabilities', 'setup-network', 'setup-profile',
    'setup-controls', 'setup-ready', 'device-status', 'help',
    'settings', 'radio-profile', 'display-input', 'about', 'reset-setup',
    'storage',
  ].map(name => `/intro/fw/${name}.png`));
  for (const screen of screens) {
    assert.equal(existsSync(new URL(`../../public${screen}`, import.meta.url)), true, screen);
  }
  assert.deepEqual(INTRO_SECTION_STARTS, [0, 2, 7, 10, 14, 17, 19, 24, 28, 32, 36, 41]);
});

test('every stop selects its intended frame at desktop and mobile viewport sizes', () => {
  for (const viewport of [568, 740, 900, 1080]) {
    const trackHeight = INTRO_VIEWPORTS * viewport;
    const scrollRange = trackHeight - viewport;
    for (let frame = 0; frame < INTRO_FRAMES.length; frame += 1) {
      const markerScrollTop = introSnapTop(frame) * trackHeight;
      assert.equal(introFrameIndex(markerScrollTop / scrollRange), frame);
      // Browser layout may round a marker to a fractional or whole CSS pixel.
      assert.equal(introFrameIndex(Math.round(markerScrollTop) / scrollRange), frame);
    }
    assert.ok(Math.abs(introSnapTop(INTRO_FRAMES.length - 1) * trackHeight - scrollRange) < .000001);
  }
});

test('chapter positions preserve the first screen and order within uneven groups', () => {
  for (let section = 0; section < INTRO_SCREEN_GROUPS.length; section += 1) {
    const first = introFrameIndex(introSectionProgress(section));
    assert.equal(INTRO_FRAMES[first].sectionIndex, section);
    assert.equal(INTRO_FRAMES[first].screen, INTRO_SCREEN_GROUPS[section][0]);
    const sectionFrames = INTRO_SCREEN_GROUPS[section].map((_, offset) =>
      INTRO_FRAMES[introFrameIndex(introFrameProgress(first + offset))].screen,
    );
    assert.deepEqual(sectionFrames, INTRO_SCREEN_GROUPS[section]);
  }
});

test('scrolling forward and back crosses every screen in sequence', () => {
  const seen: number[] = [];
  for (let step = 0; step <= 10000; step += 1) {
    const frame = introFrameIndex(step / 10000);
    if (seen[seen.length - 1] !== frame) seen.push(frame);
  }
  assert.deepEqual(seen, INTRO_FRAMES.map((_, index) => index));
  const backward: number[] = [];
  for (let step = 10000; step >= 0; step -= 1) {
    const frame = introFrameIndex(step / 10000);
    if (backward[backward.length - 1] !== frame) backward.push(frame);
  }
  assert.deepEqual(backward, [...seen].reverse());
});

test('bounds include the final storage frame and clamp overscroll or invalid values', () => {
  for (const value of [-Infinity, -2, 0, NaN]) assert.equal(introFrameIndex(value), 0);
  for (const value of [1, 2, Infinity]) assert.equal(introFrameIndex(value), INTRO_FRAMES.length - 1);
  assert.equal(INTRO_FRAMES[introFrameIndex(1)].screen, '/intro/fw/storage.png');
  assert.equal(introSectionProgress(-1), 0);
  assert.equal(introSectionProgress(NaN), 0);
  assert.equal(introSectionProgress(12), introFrameProgress(INTRO_SECTION_STARTS.at(-1)!));
  assert.equal(introFrameProgress(-10), 0);
  assert.equal(introFrameProgress(100), 1);
});
