import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { INTRO_SCREEN_LABELS, INTRO_SECTIONS, introScreenLabel, introScreenName } from './intro-copy.ts';
import { INTRO_FRAMES, INTRO_SCREEN_GROUPS } from './intro-sequence.ts';

test('every chapter keeps its copy and its firmware screens', () => {
  assert.equal(INTRO_SECTIONS.length, INTRO_SCREEN_GROUPS.length);
  INTRO_SECTIONS.forEach((section, i) => {
    assert.ok(section.head.length > 0 && section.body.length > 0);
    assert.deepEqual([...section.screens], [...INTRO_SCREEN_GROUPS[i]]);
  });
});

test('every screen shown on a phone has an asset and a plain-word label', () => {
  for (const { screen } of INTRO_FRAMES) {
    const name = introScreenName(screen);
    assert.ok(existsSync(new URL(`../../public${screen}`, import.meta.url)), `missing asset ${screen}`);
    assert.ok(INTRO_SCREEN_LABELS[name], `no label for ${name}`);
    assert.equal(introScreenLabel(screen), INTRO_SCREEN_LABELS[name]);
    // No abbreviations or shortcut letters on a caption a reader has to understand.
    assert.doesNotMatch(introScreenLabel(screen), /\b[A-Z]{2,}\b|\bpkt\b|\bdec\b|\brf\b/);
  }
});
