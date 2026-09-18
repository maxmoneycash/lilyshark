import { validateBuildProjects } from './build-projects.mjs';
import { buildSetupFromProject } from './build-setup.mjs';
import { kitURL } from './kits.mjs';

const e = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const external = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5m0-5-9 9M10 5H5v14h14v-5"/></svg>';
const list = items => `<ul>${items.map(item => `<li>${e(item)}</li>`).join('')}</ul>`;

function guideCard(project, devices) {
  const deviceBySlug = new Map(devices.map(device => [device.slug, device]));
  const setupURL = kitURL(buildSetupFromProject(project, devices));
  return `<article class="bf-card" data-build-project="${e(project.id)}" aria-labelledby="bf-title-${e(project.id)}">
    <p class="bf-credit">By ${e(project.author)}</p>
    <h3 id="bf-title-${e(project.id)}">${e(project.title)}</h3>
    <p class="bf-summary">${e(project.summary)}</p>
    <div class="bf-core"><span>Core hardware</span><ul>${project.coreCatalogSlugs.map(slug => `<li><a href="/devices/${e(slug)}/"><span class="bf-quantity">${project.coreQuantities[slug]}×</span> ${e(deviceBySlug.get(slug).name)}</a></li>`).join('')}</ul></div>
    <p class="bf-match" data-build-match hidden></p>
    ${project.hardwareMatch === 'exact-model-with-variant-exclusion' ? `<p class="bf-revision"><strong>Check the version.</strong> ${e(project.variantNotes)}</p>` : ''}
    <details class="bf-details"><summary>Parts, software & revision notes</summary><div class="bf-details-body">
      <h4>Also required</h4>${list(project.otherRequired)}
      <h4>Software</h4>${list(project.software)}
      <h4>Exact hardware</h4><p>${e(project.variantNotes)}</p>
      <h4>Before you start</h4>${list(project.gaps)}
      <p class="bf-source-date">Source reviewed <time datetime="${e(project.sourceReviewedDate)}">${e(project.sourceReviewedDate)}</time>. We have not reproduced this build.</p>
      <ul class="bf-sources">${project.sourceAnchors.map(anchor => `<li><a href="${e(anchor.url)}" target="_blank" rel="noopener noreferrer">${e(anchor.section)} ${external}</a><p>${e(anchor.supports)}</p></li>`).join('')}</ul>
    </div></details>
    <div class="bf-actions">
      <a class="bf-setup" href="${e(setupURL)}" aria-label="Use these core parts for ${e(project.title)}">Use these core parts</a>
      <a class="bf-guide" href="${e(project.guideURL)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${e(project.title)} by ${e(project.author)} — external guide">Open original guide ${external}</a>
    </div>
  </article>`;
}

export function buildFinderSection(value, devices) {
  const { projects, errors } = validateBuildProjects(value, devices);
  if (errors.length) throw new Error(`Build finder data is incomplete: ${errors.join(' ')}`);
  const catalog = devices.filter(device => typeof device?.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(device.slug) && typeof device.name === 'string').map(device => ({ slug: device.slug, name: device.name })).sort((a, b) => a.name.localeCompare(b.name));
  const data = JSON.stringify({ projects, devices: catalog }).replace(/</g, '\\u003c');
  return `<section class="build-finder" id="build-finder" aria-labelledby="build-finder-title">
    <header class="bf-heading"><h2 id="build-finder-title">What can you build?</h2><p>Start with the hardware on your bench. Find a guide from the people who made it.</p></header>
    <div class="bf-controls" data-build-controls hidden>
      <form class="bf-picker" data-build-picker>
        <label class="bf-device-field" for="bf-device">Start with a device<select id="bf-device" name="device" required><option value="">Choose a device…</option>${catalog.map(device => `<option value="${e(device.slug)}">${e(device.name)}</option>`).join('')}</select></label>
        <label class="bf-count-field" for="bf-quantity">Quantity<input id="bf-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="99" step="1" value="1" required></label>
        <button class="bf-button bf-add" type="submit">Add hardware</button>
        <button class="bf-button bf-import" data-build-import type="button">Use my hardware</button>
      </form>
      <p class="bf-help"><a href="/saved/?view=hardware">Manage my hardware</a></p>
      <p class="bf-notice" data-build-notice role="status" hidden></p>
      <div class="bf-selected" data-build-selected hidden><div class="bf-selected-heading"><h3>Selected hardware</h3><button class="bf-text-button" data-build-clear type="button">Clear selection</button></div><ul data-build-selection></ul></div>
    </div>
    <div class="bf-results-heading"><p data-build-count role="status">${projects.length} external guides</p><p>Matches cover core hardware only. Check accessories and exact revisions below.</p></div>
    <div class="bf-results" data-build-results>${projects.map(project => guideCard(project, catalog)).join('')}</div>
    <div class="bf-empty" data-build-empty hidden><h3>No sourced guides for this hardware yet.</h3><p>Try another device or explore the full directory.</p><button class="bf-button" data-build-show-all type="button">Show all guides</button></div>
    <p class="bf-footnote">Guides belong to their credited authors and open on their original websites. Source review is separate from hands-on testing.</p>
    <noscript><p class="bf-footnote">All guides are shown. Turn on JavaScript to filter by hardware.</p></noscript>
    <script type="application/json" data-build-data>${data}</script><script type="module" src="/build-finder.js"></script>
  </section>`;
}
