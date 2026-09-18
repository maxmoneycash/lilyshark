import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSetupFromProject } from '../src/build-setup.mjs';
import { buildFinderSection } from '../src/build-finder.mjs';
import { kitURL, kitFromURL, partDetails, remixKit, kitMarkdown } from '../src/kits.mjs';

const devices = JSON.parse(readFileSync(new URL('../data/catalog.json', import.meta.url), 'utf8'));
const document = JSON.parse(readFileSync(new URL('../data/build-projects-2026-09-16.json', import.meta.url), 'utf8'));
const guide = document.projects.find(project => project.id === 'xiao-s3-wireless-light-meter');
const slug = guide.coreCatalogSlugs[0];
const fromLink = link => {
  const url = new URL(link, 'https://gadgets.example');
  return kitFromURL(url.search, devices, url.hash);
};

test('a guide handoff preserves quantities and credits without attributing submission or ownership', () => {
  const before = structuredClone(guide);
  const kit = fromLink(kitURL(buildSetupFromProject(guide, devices)));
  assert.deepEqual(kit.devices, guide.coreCatalogSlugs);
  assert.equal(partDetails(kit.items[slug]).quantity, 2);
  assert.equal(partDetails(kit.items[slug]).state, 'considering');
  assert.equal(kit.author, 'gadgets.sh');
  assert.equal(kit.project, guide.guideURL);
  assert.equal(kit.from, `Original guide by ${guide.author}`);
  assert.equal(kit.origin, kit.from);
  assert.ok(kit.story.includes(guide.summary));
  assert.match(kit.story, /Planning template; not reproduced by gadgets\.sh/);
  assert.ok(kit.from.includes(guide.author));
  assert.deepEqual(guide, before);
  const remixed = fromLink(kitURL(remixKit(kit, devices)));
  assert.equal(remixed.author, '');
  assert.equal(remixed.origin, kit.origin);
  assert.equal(remixed.project, guide.guideURL);
  assert.equal(remixed.story, kit.story);
  assert.equal(partDetails(remixed.items[slug]).quantity, 2);
  assert.equal(partDetails(remixed.items[slug]).state, 'considering');
});

test('every sourced card retains its guide and creates the exact core list', () => {
  const html = buildFinderSection(document, devices);
  const cards = [...html.matchAll(/<article class="bf-card"[^>]*>(.*?)<\/article>/gs)].map(match => match[1]);
  assert.equal(cards.length, document.projects.length);
  for (const [index, card] of cards.entries()) {
    const project = document.projects[index];
    const link = card.match(/class="bf-setup" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
    const kit = fromLink(link);
    assert.deepEqual(kit.devices, project.coreCatalogSlugs);
    for (const id of kit.devices) {
      assert.equal(partDetails(kit.items[id]).quantity, project.coreQuantities[id]);
      assert.equal(partDetails(kit.items[id]).state, 'considering');
    }
    assert.equal(kit.project, project.guideURL);
    assert.ok(kit.from.includes(project.author));
    assert.match(card, /class="bf-actions"/);
    assert.match(card, />Use these core parts<\/a>/);
    assert.match(card, /class="bf-guide"/);
    assert.match(card, /Open original guide/);
    assert.match(card, /We have not reproduced this build/);
  }
});

test('a two-model handoff preserves each amount and discards unrelated ownership data', () => {
  const project = {
    ...guide,
    coreCatalogSlugs: [slug, 'raspberry-pi-5'],
    coreQuantities: { [slug]: 2, 'raspberry-pi-5': 3 },
    items: { [slug]: { quantity: 99, state: 'have' } },
    authorSubmitted: true,
  };
  const kit = fromLink(kitURL(buildSetupFromProject(project, devices)));
  assert.equal(partDetails(kit.items[slug]).quantity, 2);
  assert.equal(partDetails(kit.items['raspberry-pi-5']).quantity, 3);
  assert.ok(Object.values(kit.items).every(item => item.state === 'considering'));
  assert.equal(kit.author, 'gadgets.sh');
});

test('requirements remain whole or explicitly defer to the complete original guide', () => {
  const short = { ...guide, otherRequired: ['USB data cable', 'A suitable power supply'], variantNotes: 'Use the specified board revision.' };
  const complete = fromLink(kitURL(buildSetupFromProject(short, devices)));
  assert.equal(complete.parts, 'Also required (check original guide):\nUSB data cable\nA suitable power supply');
  assert.equal(complete.items[slug].note, 'Core hardware only. Use the specified board revision.');
  const long = { ...guide, otherRequired: ['Required adapter '.repeat(30), 'Antenna required before power-on.'], variantNotes: 'Check the revision. '.repeat(25) + 'Do not use the older board.' };
  const kit = fromLink(kitURL(buildSetupFromProject(long, devices)));
  assert.match(kit.parts, /^Core parts only\./);
  assert.match(kit.parts, /every accessory, software requirement and hardware revision/);
  assert.ok(!kit.parts.includes('Required adapter'));
  assert.equal(kit.items[slug].note, 'Core hardware only. Check the original guide for exact variants and revisions.');
  assert.equal(kit.project, guide.guideURL);
  const html = buildFinderSection([long], devices);
  assert.ok(html.includes(long.otherRequired[0]));
  assert.ok(html.includes(long.otherRequired[1]));
  assert.ok(html.includes(long.variantNotes));
  assert.ok(html.includes(long.guideURL));
});

test('long original author credit survives setup limits and a subsequent remix', () => {
  const author = 'Research team '.repeat(14).trim();
  const project = { ...guide, author };
  const kit = fromLink(kitURL(buildSetupFromProject(project, devices)));
  assert.equal(kit.from, 'Original guide (full author credit in notes)');
  assert.equal(kit.origin, kit.from);
  assert.ok(kit.story.includes(author));
  assert.ok(remixKit(kit, devices).story.includes(author));
  assert.equal(kit.author, 'gadgets.sh');
});

test('source markup is escaped in cards and exports and unsafe or unshareable URLs fail explicitly', () => {
  const project = { ...guide, title: '<img src=x onerror=alert(1)>', author: '[maker](javascript:alert(1))', guideURL: 'https://example.com/guide?mode=a&revision=b#parts' };
  const kit = buildSetupFromProject(project, devices);
  const html = buildFinderSection([project], devices);
  assert.ok(!html.includes(project.title));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const link = html.match(/class="bf-setup" href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(fromLink(link).project, project.guideURL);
  assert.ok(fromLink(link).from.includes(project.author));
  const markdown = kitMarkdown(kit, devices);
  assert.ok(!markdown.includes(project.title));
  assert.ok(!markdown.includes('[maker]('));
  for (const guideURL of ['javascript:alert(1)', 'https://user:secret@example.com/', 'https://example.com/' + 'x'.repeat(450)]) {
    assert.throws(() => buildSetupFromProject({ ...guide, guideURL }, devices), /setup|source/);
  }
});
