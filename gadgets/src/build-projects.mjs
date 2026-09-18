const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (value, limit = 600) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const textList = (value, minimum = 0) => Array.isArray(value) && value.length >= minimum && value.length <= 24 && value.every(item => text(item));
const own = (value, key) => isRecord(value) && Object.hasOwn(value, key);

function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 1800 || !value.startsWith('https://') || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

function reviewDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function catalogSlugs(devices) {
  return new Set(Array.isArray(devices) ? devices.filter(device => isRecord(device) && typeof device.slug === 'string' && slugPattern.test(device.slug)).map(device => device.slug) : []);
}

// Source records are reviewed data, not evidence that gadgets.sh reproduced a build.
// Reject incomplete revision/source information instead of silently weakening it.
export function validateBuildProjects(value, devices) {
  const rows = Array.isArray(value) ? value : isRecord(value) && value.schemaVersion === 1 ? value.projects : null;
  if (!Array.isArray(rows)) return { projects: [], errors: ['Expected a project array or a schemaVersion 1 project document.'] };
  const known = catalogSlugs(devices), seen = new Set(), projects = [], errors = [];
  for (const [index, row] of rows.entries()) {
    const problems = [];
    if (!isRecord(row)) { errors.push(`Project ${index + 1}: expected an object.`); continue; }
    if (!text(row.id, 100) || !slugPattern.test(row.id)) problems.push('invalid id');
    else if (seen.has(row.id)) problems.push('duplicate id');
    if (!text(row.title, 180) || !text(row.author, 200) || !text(row.summary)) problems.push('missing title, author or summary');
    if (!sourceURL(row.guideURL)) problems.push('guide must have a complete HTTPS source URL');
    const slugs = row.coreCatalogSlugs;
    const validSlugs = Array.isArray(slugs) && slugs.length >= 1 && slugs.length <= 2 && slugs.every(slug => typeof slug === 'string' && known.has(slug)) && new Set(slugs).size === slugs.length;
    if (!validSlugs) problems.push('core hardware must list one or two distinct catalog slugs');
    const quantities = row.coreQuantities;
    if (!validSlugs || !isRecord(quantities) || Object.keys(quantities).length !== slugs.length || !slugs.every(slug => own(quantities, slug) && Number.isInteger(quantities[slug]) && quantities[slug] >= 1 && quantities[slug] <= 99)) problems.push('explicit core quantities from 1 to 99 are required');
    if (!textList(row.otherRequired, 1) || !textList(row.software, 1)) problems.push('required accessories and software must be listed');
    if (typeof row.hardwareMatch !== 'string' || !['exact-model', 'exact-model-with-variant-exclusion'].includes(row.hardwareMatch) || !text(row.variantNotes) || !textList(row.gaps, 1)) problems.push('exact model, revision notes and limitations are required');
    if (row.testedByUs !== false) problems.push('external guides must explicitly remain untested by us');
    if (!reviewDate(row.sourceReviewedDate)) problems.push('invalid source review date');
    if (!Array.isArray(row.sourceAnchors) || row.sourceAnchors.length < 1 || row.sourceAnchors.length > 8 || !row.sourceAnchors.every(anchor => isRecord(anchor) && sourceURL(anchor.url) && text(anchor.section) && text(anchor.supports))) problems.push('credited source anchors are required');
    if (problems.length) { errors.push(`Project ${index + 1}: ${problems.join('; ')}.`); continue; }
    seen.add(row.id);
    projects.push({
      id: row.id, title: row.title, author: row.author, summary: row.summary, guideURL: row.guideURL,
      coreCatalogSlugs: [...slugs], coreQuantities: Object.fromEntries(slugs.map(slug => [slug, quantities[slug]])),
      otherRequired: [...row.otherRequired], software: [...row.software], hardwareMatch: row.hardwareMatch,
      variantNotes: row.variantNotes, gaps: [...row.gaps], testedByUs: false, sourceReviewedDate: row.sourceReviewedDate,
      sourceAnchors: row.sourceAnchors.map(anchor => ({ url: anchor.url, section: anchor.section, supports: anchor.supports }))
    });
  }
  return { projects, errors };
}

function quantity(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,2}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 1 && number <= 99 ? number : 0;
}

export function normalizeHardwareQuantities(value, devices) {
  if (!isRecord(value)) return {};
  const known = catalogSlugs(devices);
  return Object.fromEntries(Object.entries(value).filter(([slug, amount]) => known.has(slug) && quantity(amount)).map(([slug, amount]) => [slug, quantity(amount)]));
}

export function readBuildHardware(search,devices) {
  if(typeof search!=='string' || search.length>5000)return {};
  const raw=new URLSearchParams(search).get('hardware');
  if(!raw)return {};
  const entries=raw.split(',').slice(0,100).flatMap(value=>{
    const parts=value.split(':');
    return parts.length>2?[]:[[parts[0],parts.length===1?1:parts[1]]];
  });
  return normalizeHardwareQuantities(Object.fromEntries(entries),devices);
}

export function buildHardwareSearch(search,hardware,devices) {
  const params=new URLSearchParams(search);
  const selected=Object.entries(normalizeHardwareQuantities(hardware,devices)).map(([slug,amount])=>amount===1?slug:`${slug}:${amount}`).join(',');
  if(selected)params.set('hardware',selected);else params.delete('hardware');
  return params.size?`?${params}`:'';
}

// Read only explicit "have" states for devices still in the saved setup. Orphaned
// items, wishlists and malformed quantities must not become ownership claims.
export function ownedHardwareFromKit(value, devices) {
  if (!isRecord(value) || !Array.isArray(value.devices) || !isRecord(value.items)) return {};
  const entries = [];
  for (const slug of new Set(value.devices.filter(slug => typeof slug === 'string'))) {
    if (!own(value.items, slug)) continue;
    const item = value.items[slug];
    if (!isRecord(item) || item.state !== 'have') continue;
    entries.push([slug, own(item, 'quantity') ? item.quantity : 1]);
  }
  return normalizeHardwareQuantities(Object.fromEntries(entries), devices);
}

// An empty selection shows the directory. Otherwise show guides using at least
// one selected model, including partial quantities, with covered cores first.
export function findBuildProjects(value, hardware, devices) {
  const { projects, errors } = validateBuildProjects(value, devices);
  const selection = normalizeHardwareQuantities(hardware, devices);
  const filtered = Object.keys(selection).length > 0;
  const matches = projects.map(project => {
    const requirements = project.coreCatalogSlugs.map(slug => {
      const required = project.coreQuantities[slug], selected = selection[slug] || 0;
      return { slug, required, selected, missing: Math.max(0, required - selected) };
    });
    const requiredTotal = requirements.reduce((sum, item) => sum + item.required, 0);
    const selectedTotal = requirements.reduce((sum, item) => sum + Math.min(item.selected, item.required), 0);
    return { project, requirements, requiredTotal, selectedTotal, coreQuantitiesCovered: selectedTotal === requiredTotal, requiresVariantCheck: true };
  }).filter(match => !filtered || match.selectedTotal > 0);
  if (filtered) matches.sort((a, b) => Number(b.coreQuantitiesCovered) - Number(a.coreQuantitiesCovered) || (a.requiredTotal - a.selectedTotal) - (b.requiredTotal - b.selectedTotal));
  return { matches, selection, errors };
}
