import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { INTRO_SECTIONS } from './intro-copy.ts';
import { INTRO_FRAMES, INTRO_SCREEN_GROUPS } from './intro-sequence.ts';

test('every chapter keeps its copy and its firmware screens', () => {
  assert.equal(INTRO_SECTIONS.length, INTRO_SCREEN_GROUPS.length);
  INTRO_SECTIONS.forEach((section, i) => {
    assert.ok(section.head.length > 0 && section.body.length > 0);
    assert.deepEqual([...section.screens], [...INTRO_SCREEN_GROUPS[i]]);
  });
});

test('every firmware screen in the tour has its image', () => {
  for (const { screen } of INTRO_FRAMES) {
    assert.ok(existsSync(new URL(`../../public${screen}`, import.meta.url)), `missing asset ${screen}`);
  }
});
