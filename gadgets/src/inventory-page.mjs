export function inventorySection() {
  return `<section id="my-hardware" class="inventory-panel" aria-labelledby="inventory-title" hidden>
    <header class="inventory-heading"><div><h2 id="inventory-title">On your bench.</h2><p>Keep track of what you own, across all your projects.</p></div><button class="inventory-button inventory-primary" type="button" data-inventory-builds disabled>Find builds with my hardware <span aria-hidden="true">↗</span></button></header>
    <p class="inventory-link-warning" data-inventory-link-warning hidden>This inventory is too large for one search link. <a href="/builds/#build-finder">Open the build finder</a> and choose a smaller selection.</p>
    <form class="inventory-form" data-inventory-form><fieldset data-inventory-fields disabled><legend class="sr-only">Add hardware you own</legend>
      <label class="inventory-device-field" for="inventory-device">Hardware<select id="inventory-device" name="device" required><option value="">Choose a device…</option></select></label>
      <label class="inventory-count-field" for="inventory-quantity">Quantity<input id="inventory-quantity" name="quantity" type="number" inputmode="numeric" min="1" max="99" step="1" value="1" required></label>
      <button class="inventory-button" type="submit" data-inventory-add>Add hardware</button>
    </fieldset></form>
    <div class="inventory-import"><button class="inventory-text-button" type="button" data-inventory-import disabled aria-describedby="inventory-import-help">Import “Have it” from my setup</button><p id="inventory-import-help">Adds missing devices. Keeps quantities already on this list.</p></div>
    <div class="inventory-status-row"><p class="inventory-status" data-inventory-status role="status" aria-live="polite">Loading your hardware…</p><button class="inventory-text-button" type="button" data-inventory-retry hidden>Try saving again</button><button class="inventory-text-button" type="button" data-inventory-download hidden>Download this list</button><button class="inventory-text-button" type="button" data-inventory-undo hidden>Undo removal</button></div>
    <div class="inventory-list-heading"><p data-inventory-summary></p><span>Owned quantity</span></div>
    <ul class="inventory-list" data-inventory-list aria-label="Hardware you own"></ul>
    <div class="inventory-empty" data-inventory-empty hidden><h3>Start with what you own.</h3><p>Choose your first device above.</p></div>
    <p class="inventory-footnote">Saved in this browser. Your shortlist and project setups stay separate. Clearing site storage removes this list.</p>
    <noscript><p class="inventory-status">JavaScript is needed to manage hardware saved in this browser.</p></noscript>
  </section>`;
}
