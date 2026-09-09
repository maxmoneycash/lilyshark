import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('intro never mounts the 2D T-Deck photograph', () => {
  const model = readFileSync(new URL('./TDeckModel.tsx', import.meta.url), 'utf8');
  const intro = readFileSync(new URL('./IntroTab.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(model, /TDeckPhoto/);
  assert.doesNotMatch(model, /tdeck\.webp/);
  assert.doesNotMatch(intro, /TDeckPhoto/);
  assert.doesNotMatch(intro, /tdeck\.webp/);
});
