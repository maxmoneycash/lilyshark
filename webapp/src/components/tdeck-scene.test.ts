import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The flasher shares the entry chunk with the intro but never shows the
// device. Requesting the model as this module loaded charged every visit to
// /flash/ four megabytes it could not use, over whatever network the field had.
test('the T-Deck model is requested only once something asks for it', async () => {
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.resolve({ ok: false, status: 404 } as unknown as Response);
  }) as typeof globalThis.fetch;
  try {
    const { preloadTDeck } = await import('./tdeck-scene');
    assert.deepEqual(requested, [], 'loading the scene module must request nothing');
    await preloadTDeck().catch(() => undefined);
    await preloadTDeck().catch(() => undefined);
    assert.equal(requested.length, 1, 'the model is fetched once and then remembered');
    assert.match(requested[0], /tdeck-plus-v5\.glb$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the head start belongs to the page that shows the device', () => {
  const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
  const model = readFileSync(new URL('./TDeckModel.tsx', import.meta.url), 'utf8');
  assert.match(main, /tabFromLocation\(window\.location\) !== 'FLASH'\) preloadTDeck\(\)/);
  // Which path the flasher lives at is navigation's fact to keep, not this one's.
  assert.doesNotMatch(main, /\/flash/);
  // The viewer starts its own load, so nothing preloads just by being imported.
  assert.doesNotMatch(model, /preloadTDeck/);
});
