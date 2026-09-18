import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBuildProjects, normalizeHardwareQuantities, ownedHardwareFromKit, findBuildProjects } from '../src/build-projects.mjs';
import { buildFinderSection } from '../src/build-finder.mjs';

const document = JSON.parse(readFileSync(new URL('../data/build-projects-2026-09-16.json', import.meta.url), 'utf8'));
const devices = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const xiao = 'seeed-xiao-esp32s3';
const lightMeter = document.projects.find(project => project.id === 'xiao-s3-wireless-light-meter');

test('curated guides retain explicit quantities, attribution, sources and revision restrictions', () => {
  const result = validateBuildProjects(document, devices);
  assert.deepEqual(result.errors, []);
  assert.equal(result.projects.length, document.projects.length);
  assert.deepEqual(result.projects.map(project => project.guideURL), document.projects.map(project => project.guideURL));
  const tracker = result.projects.find(project => project.id === 't1000-e-meshcore-companion');
  assert.equal(tracker.hardwareMatch, 'exact-model-with-variant-exclusion');
  assert.match(tracker.variantNotes, /LoRaWAN/);
  assert.equal(tracker.testedByUs, false);
  assert.ok(tracker.sourceAnchors.some(anchor => anchor.url === 'https://wiki.seeedstudio.com/t1000e_for_lorawan_introduction/'));
});

test('one XIAO yields a partial two-board guide, while two cover its core quantity', () => {
  const one = findBuildProjects(document, { [xiao]: 1 }, devices);
  assert.equal(one.matches.length, 2);
  assert.equal(one.matches[0].project.id, 'xiao-s3-temperature-color-light');
  const partial = one.matches.find(match => match.project.id === lightMeter.id);
  assert.equal(partial.coreQuantitiesCovered, false);
  assert.deepEqual(partial.requirements, [{ slug: xiao, required: 2, selected: 1, missing: 1 }]);
  const two = findBuildProjects([lightMeter], { [xiao]: 2 }, devices).matches[0];
  assert.equal(two.coreQuantitiesCovered, true);
  assert.equal(two.requiresVariantCheck, true);
  assert.equal(two.project.testedByUs, false);
  assert.deepEqual(two.project.otherRequired, lightMeter.otherRequired);
  assert.equal(findBuildProjects([lightMeter], { [xiao]: 50 }, devices).matches[0].selectedTotal, 2);
});

test('a two-model build needs each exact model and does not substitute a variant', () => {
  const composite = { ...lightMeter, coreCatalogSlugs: [xiao, 'raspberry-pi-5'], coreQuantities: { [xiao]: 2, 'raspberry-pi-5': 1 } };
  const partial = findBuildProjects([composite], { [xiao]: 3, 'raspberry-pi-pico-2-w': 1 }, devices).matches[0];
  assert.equal(partial.coreQuantitiesCovered, false);
  assert.equal(partial.selectedTotal, 2);
  assert.equal(partial.requirements[1].missing, 1);
  assert.equal(findBuildProjects([composite], { [xiao]: 2, 'raspberry-pi-5': 1 }, devices).matches[0].coreQuantitiesCovered, true);
  assert.equal(findBuildProjects(document, { 'scout-lite': 1 }, devices).matches.length, 0);
  assert.equal(findBuildProjects(document, {}, devices).matches.length, document.projects.length);
});

test('saved setup import counts only explicit have items still in the device list', () => {
  const kit = { devices: [xiao, xiao, 'raspberry-pi-5', 'flipper-zero', 'sensecap-t1000-e'], items: {
    [xiao]: { quantity: 2, state: 'have' },
    'raspberry-pi-5': { quantity: 4, state: 'need' },
    'flipper-zero': { quantity: 3, state: 'considering' },
    'sensecap-t1000-e': { state: 'have' },
    'hackrf-one': { quantity: 8, state: 'have' }
  } };
  assert.deepEqual(ownedHardwareFromKit(kit, devices), { [xiao]: 2, 'sensecap-t1000-e': 1 });
  assert.deepEqual(ownedHardwareFromKit({ devices: [xiao] }, devices), {});
  assert.deepEqual(ownedHardwareFromKit({ ...kit, items: { [xiao]: { state: 'have', quantity: 0 } } }, devices), {});
  assert.deepEqual(ownedHardwareFromKit({ ...kit, items: { [xiao]: { state: { toString: 1 }, quantity: 2 } } }, devices), {});
});

test('malformed inventory and quantities cannot silently claim owned hardware', () => {
  for (const raw of [null, [], false, 1, 'xiao']) assert.deepEqual(normalizeHardwareQuantities(raw, devices), {});
  for (const raw of [0, -1, 1.5, 100, Infinity, NaN, true, {}, { toString: 1 }, '2.2', '2e1', '']) {
    assert.deepEqual(normalizeHardwareQuantities({ [xiao]: raw }, devices), {});
  }
  assert.deepEqual(normalizeHardwareQuantities({ [xiao]: '2', 'unknown-model': 1 }, devices), { [xiao]: 2 });
  const inherited = Object.create({ [xiao]: 2 });
  assert.deepEqual(normalizeHardwareQuantities(inherited, devices), {});
});

test('invalid source, revision, quantity and untrusted enum data are rejected without coercion', () => {
  const invalid = [
    { guideURL: 'javascript:alert(1)' }, { guideURL: 'https://user:pass@example.com/' }, { guideURL: 'https://example.com/ bad' },
    { coreCatalogSlugs: [xiao, xiao] }, { coreCatalogSlugs: ['not-in-catalog'] }, { coreQuantities: { [xiao]: 0 } },
    { coreQuantities: { [xiao]: '2' } }, { coreQuantities: { [xiao]: 2, 'raspberry-pi-5': 1 } },
    { variantNotes: '' }, { hardwareMatch: { toString: 1 } }, { gaps: [] }, { testedByUs: true },
    { sourceReviewedDate: '2026-02-31' }, { sourceAnchors: [] }, { sourceAnchors: [{ url: 'http://example.com/', section: 'Parts', supports: 'Board' }] }
  ];
  for (const changes of invalid) {
    const result = validateBuildProjects([{ ...lightMeter, ...changes }], devices);
    assert.equal(result.projects.length, 0, JSON.stringify(changes));
    assert.equal(result.errors.length, 1);
  }
  for (const raw of [null, 12, {}, { schemaVersion: 2, projects: [] }, { schemaVersion: 1, projects: {} }]) assert.ok(validateBuildProjects(raw, devices).errors.length);
  assert.equal(validateBuildProjects([lightMeter, lightMeter], devices).errors.length, 1);
  assert.equal(validateBuildProjects([null, false, []], devices).errors.length, 3);
});

test('server-rendered guides work without filtering and safely embed untrusted text', () => {
  const html = buildFinderSection(document, devices);
  assert.equal((html.match(/data-build-project=/g) || []).length, document.projects.length);
  assert.match(html, /Use my hardware/);
  assert.match(html, /Matches cover core hardware only/);
  assert.match(html, /2×/);
  assert.ok(html.includes(lightMeter.guideURL));
  const hostile = { ...lightMeter, title: '</script><img src=x onerror=alert(1)>' };
  const safe = buildFinderSection([hostile], devices);
  assert.ok(!safe.includes(hostile.title));
  const embedded = safe.match(/<script type="application\/json" data-build-data>(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(embedded).projects[0].title, hostile.title);
  assert.throws(() => buildFinderSection([{ ...lightMeter, variantNotes: '' }], devices), /incomplete/);
});
