import { findBuildProjects, normalizeHardwareQuantities,readBuildHardware,buildHardwareSearch } from './build-projects.mjs';
import { readInventory } from './inventory.mjs';

function initBuildFinder(section) {
  const { projects, devices } = JSON.parse(section.querySelector('[data-build-data]').textContent);
  const initial = findBuildProjects(projects, {}, devices);
  if (initial.errors.length) throw new Error('Build guide data could not be validated.');
  const $ = selector => section.querySelector(selector);
  const form = $('[data-build-picker]'), picker = $('#bf-device'), quantity = $('#bf-quantity');
  const cards = new Map([...section.querySelectorAll('[data-build-project]')].map(card => [card.dataset.buildProject, card]));
  const names = new Map(devices.map(device => [device.slug, device.name]));
  let selection = readBuildHardware(location.search,devices);

  function notice(message = '') {
    $('[data-build-notice]').textContent = message;
    $('[data-build-notice]').hidden = !message;
  }

  function selectedRows() {
    const fragment = document.createDocumentFragment();
    for (const [slug, amount] of Object.entries(selection)) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = names.get(slug);
      const label = document.createElement('label');
      label.className = 'bf-selected-quantity';
      const labelText = document.createElement('span');
      labelText.textContent = 'Qty';
      const input = document.createElement('input');
      Object.assign(input, { type: 'number', min: '1', max: '99', step: '1', inputMode: 'numeric', value: String(amount), required: true });
      input.dataset.buildQuantity = slug;
      input.setAttribute('aria-label', `Quantity of ${names.get(slug)}`);
      label.append(labelText, input);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bf-remove';
      remove.textContent = '×';
      remove.dataset.buildRemove = slug;
      remove.setAttribute('aria-label', `Remove ${names.get(slug)} from this selection`);
      row.append(name, label, remove);
      fragment.append(row);
    }
    $('[data-build-selection]').replaceChildren(fragment);
  }

  function render(rebuildSelection = true) {
    const result = findBuildProjects(projects, selection, devices), active = Object.keys(selection).length > 0;
    const visible = new Set(result.matches.map(match => match.project.id));
    for (const [id, card] of cards) card.hidden = !visible.has(id);
    for (const match of result.matches) {
      const card = cards.get(match.project.id), status = card.querySelector('[data-build-match]');
      status.hidden = !active;
      status.textContent = match.coreQuantitiesCovered ? 'Core quantities match · check exact revision' : `${match.selectedTotal} of ${match.requiredTotal} core units selected`;
      status.dataset.covered = String(match.coreQuantitiesCovered);
      $('[data-build-results]').append(card);
    }
    $('[data-build-count]').textContent = active ? `${result.matches.length} ${result.matches.length === 1 ? 'guide uses' : 'guides use'} your selected hardware` : `${projects.length} external guides`;
    $('[data-build-empty]').hidden = result.matches.length > 0;
    $('[data-build-selected]').hidden = !active;
    if (rebuildSelection) selectedRows();
    try {history.replaceState(history.state,'',`${location.pathname}${buildHardwareSearch(location.search,selection,devices)}${location.hash}`);}catch { /* Filtering still works in restricted embeds. */ }
  }

  function clear() {
    selection = {};
    notice();
    render();
    picker.focus();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const slug = picker.value, amount = Number(quantity.value);
    const next = normalizeHardwareQuantities({ ...selection, [slug]: amount }, devices);
    if (!Object.hasOwn(next, slug)) return;
    const replacing = Object.hasOwn(selection, slug);
    selection = next;
    render();
    notice(`${names.get(slug)} ${replacing ? 'updated to' : 'added with'} quantity ${amount}.`);
    picker.value = '';
    quantity.value = '1';
  });

  $('[data-build-selection]').addEventListener('change', event => {
    const input = event.target.closest('[data-build-quantity]');
    if (!input) return;
    const slug = input.dataset.buildQuantity;
    if (!input.checkValidity()) {
      input.reportValidity();
      input.value = String(selection[slug]);
      notice('Use a whole-number quantity from 1 to 99. Your previous quantity is unchanged.');
      return;
    }
    selection = normalizeHardwareQuantities({ ...selection, [slug]: Number(input.value) }, devices);
    notice();
    render(false);
  });

  $('[data-build-selection]').addEventListener('click', event => {
    const button = event.target.closest('[data-build-remove]');
    if (!button) return;
    const slug = button.dataset.buildRemove;
    delete selection[slug];
    render();
    notice(`${names.get(slug)} removed from this selection.`);
    picker.focus();
  });

  $('[data-build-import]').addEventListener('click', () => {
    let result;
    try {
      result = readInventory(localStorage, devices);
    } catch {
      notice('Your saved hardware could not be read in this browser. Choose devices above; your current selection is unchanged.');
      return;
    }
    if (!['ready','missing'].includes(result.status)) {
      notice('Your saved hardware could not be read. Your selection is unchanged. Open Manage my hardware to check it.');
      return;
    }
    const owned=result.quantities;
    if (!Object.keys(owned).length) {
      notice('No owned hardware is saved yet. Open Manage my hardware to add devices or import the parts you have from a setup.');
      return;
    }
    const search=buildHardwareSearch(location.search,owned,devices);
    if (Object.keys(owned).length>100 || search.length>5000) {
      notice('This inventory is too large for one build selection. Choose fewer devices above; your saved hardware is unchanged.');
      return;
    }
    selection = owned;
    render();
    const amount = Object.values(owned).reduce((sum, value) => sum + value, 0);
    notice(`Loaded ${amount} ${amount === 1 ? 'unit' : 'units'} from My hardware. Your inventory and setup are unchanged.`);
  });

  $('[data-build-clear]').addEventListener('click', clear);
  $('[data-build-show-all]').addEventListener('click', clear);
  window.addEventListener('popstate',()=>{selection=readBuildHardware(location.search,devices);notice();render();});
  render();
  $('[data-build-controls]').hidden = false;
}

for (const section of document.querySelectorAll('.build-finder')) {
  try { initBuildFinder(section); }
  catch {
    const status = section.querySelector('[data-build-count]');
    if (status) status.textContent = 'Hardware filtering is unavailable. Browse the original guides below.';
  }
}
