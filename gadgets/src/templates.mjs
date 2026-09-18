import { categories, statuses, tasks, formats, capabilities, sorts, sortDevices, escapeHTML as e } from './catalog.mjs';
import { guides, comparisons } from './guides.mjs';
import { hooks, collections } from './discovery.mjs';
import { kitURL, partDetails, PART_STATES } from './kits.mjs';
import { discoveryHome, lilysharkBuild } from './workbench.mjs';
import { makerPilotBody } from './maker-pilot.mjs';
import { scoutCompanionBody } from './scout-companion.mjs';
import { buildFinderSection } from './build-finder.mjs';
import { inventorySection } from './inventory-page.mjs';
import { affiliateLink } from './affiliates.mjs';
import { activeListing, formatMoney } from './listings.mjs';

let buyEndpoint='';
export function setBuyEndpoint(url){buyEndpoint=url || '';}

// True when the maker sells somewhere other than the merchant we earn from, so the page
// can offer both rather than sending everyone to a reseller in the wrong continent.
function otherHost(source,paidHref) {
  try { return new URL(source).hostname !== new URL(paidHref).hostname; }
  catch { return false; }
}

const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const icons = {
  download: svg('<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>'),
  share: svg('<path d="M12 16V3m-4 4 4-4 4 4M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8"/>'),
  compare: svg('<rect x="3" y="5" width="7" height="14" rx="2"/><rect x="14" y="5" width="7" height="14" rx="2"/>'),
  arrow: svg('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
  external: svg('<path d="M14 5h5v5m0-5-9 9M10 5H5v14h14v-5"/>'),
  bookmark: svg('<path d="M6 4h12v17l-6-4-6 4z"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'),
  mesh: svg('<circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="m6 9 5 7m2 0 5-7M7 7h10"/>'),
  wifi: svg('<path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r=".7"/>'),
  rfid: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10v4m4-5a5 5 0 0 1 0 6m4-8a8 8 0 0 1 0 10"/>'),
  computer: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6 6h12v7H6zm1 11h.01M11 17h.01M15 17h2"/>'),
  build: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4m-12-5h4v4h-4z"/>'),
  radio: svg('<path d="M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14M8 8a6 6 0 0 0 0 8m8-8a6 6 0 0 1 0 8"/><circle cx="12" cy="12" r="2"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  list: svg('<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>'),
  check: svg('<path d="m5 12 4 4L19 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  close: svg('<path d="m6 6 12 12M6 18 18 6"/>'),
  filter: svg('<path d="M3 6h18M6 12h12M9 18h6"/>')
};
export const brandMark = '<svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#d5f582"/><path d="M28 13H18a7 7 0 0 0-7 7v2a7 7 0 0 0 7 7h10V20h-8" stroke="#18201b" stroke-width="4" stroke-linejoin="round"/><circle cx="29" cy="10" r="2" fill="#18201b"/></svg>';
export const brand = `${brandMark}<span class="brand-name">gadgets<span>.sh</span></span>`;
const icon = name => icons[name] || icons.grid;
const options = (items, selected) => Object.entries(items).map(([value,label])=>`<option value="${value}"${value===selected?' selected':''}>${e(label)}</option>`).join('');
const date = value => value ? new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`)) : 'Not set';
const review = d => d.owned ? 'Concept' : d.verified ? 'Source checked' : 'Partial review';
const availability = d => `<span class="availability ${e(d.status)}"><i aria-hidden="true"></i>${e(statuses[d.status])}</span>`;
const evidence = d => `<span class="evidence ${d.verified?'checked':''}">${d.verified?icons.check:''}${review(d)}</span>`;

export function art(d, eager=false) {
  return `<div class="device-art ${d.image?'has-image':'no-image'}" data-art="${e(d.slug)}">${d.image?`<img src="${e(d.image)}" alt="${e(d.name)} — ${e(d.imageCaption || 'maker product image')}" loading="${eager?'eager':'lazy'}" decoding="async" width="${e(d.imageWidth || 1200)}" height="${e(d.imageHeight || 900)}">`:`<div class="concept-mark">${icons.radio}<strong>LilyShark</strong><span>Original hardware concept</span></div>`}</div>`;
}
export function saveButton(d, text=false) {
  return `<button type="button" class="save-button ${text?'button secondary':'icon-button'}" data-save="${d.slug}" aria-label="Save ${e(d.name)} to shortlist" aria-pressed="false">${icons.bookmark}${text?'<span data-save-label>Save to shortlist</span>':''}</button>`;
}
export function compareButton(d) {
  return `<button type="button" class="compare-toggle" data-compare="${d.slug}" aria-label="Compare ${e(d.name)}" aria-pressed="false"><span class="compare-box">${icons.plus}</span><span data-compare-label>Compare</span></button>`;
}
export function kitButton(d) {
  return `<button type="button" class="kit-add" data-kit="${d.slug}" aria-label="Add ${e(d.name)} to setup" aria-pressed="false">${icons.plus}<span data-kit-label>Add to setup</span></button>`;
}
export function shareDeviceButton(d) {
  return `<button type="button" class="device-share icon-button" data-share-device="${d.slug}" aria-label="Share ${e(d.name)}" title="Share device">${icons.share}</button>`;
}
export function compareDeviceLink(d) {
  return `<a class="device-compare-link icon-button" href="/compare/?devices=${d.slug}" aria-label="Compare ${e(d.name)}" title="Compare device">${icons.compare}</a>`;
}
export function deviceCard(d, index=0, total=0) {
  const u=d.usage || {};
  const imageNote=/prototype|illustration|proposed|older|previous|development|concept/i.test(d.imageCaption || '')?d.imageCaption:'';
  return `<article class="device-card" data-device="${d.slug}" data-category="${d.category}" aria-labelledby="title-${d.slug}">
    <div class="card-visual"><a href="/devices/${d.slug}/" tabindex="-1" aria-hidden="true">${art(d,index<3)}</a>${imageNote?`<span class="card-image-note">${e(imageNote)}</span>`:''}</div>
    <div class="card-copy"><div class="card-meta"><span>${e(categories[d.category])}</span>${availability(d)}</div><h2 id="title-${d.slug}"><a href="/devices/${d.slug}/">${e(d.name)}</a></h2><p class="device-description">${e(hooks[d.slug] || u.goodFor || d.description)}</p></div>
    <div class="card-controls">${kitButton(d)}<a class="card-detail" href="/devices/${d.slug}/" aria-label="Details for ${e(d.name)}">Explore ${icons.arrow}</a>${saveButton(d)}</div>
  </article>`;
}
let siteOrigin='https://gadgets.sh';
export function setSiteOrigin(url){siteOrigin=(url||'https://gadgets.sh').replace(/\/$/,'');}
export function getSiteOrigin(){return siteOrigin;}

export function layout({title,description,body,page='catalog',active='explore',path='',image='',jsonLd=null}) {
  const canonical=`${siteOrigin}${path||'/'}`;
  const ogImage=`${siteOrigin}${image||'/assets/og-default.png'}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f7f8fa"><meta name="color-scheme" content="light"><title>${e(title)} — gadgets.sh</title><meta name="description" content="${e(description)}"><meta property="og:title" content="${e(title)} — gadgets.sh"><meta property="og:description" content="${e(description)}"><meta property="og:type" content="website"><link rel="canonical" href="${e(canonical)}"><meta property="og:url" content="${e(canonical)}"><meta property="og:image" content="${e(ogImage)}"><meta property="og:site_name" content="gadgets.sh"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${e(title)} — gadgets.sh"><meta name="twitter:description" content="${e(description)}"><meta name="twitter:image" content="${e(ogImage)}">${jsonLd?`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g,String.fromCharCode(92)+"u003c")}</script>`:''}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preload" href="/assets/instrument-sans-600.ttf" as="font" type="font/ttf" crossorigin><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/discovery.css"><link rel="stylesheet" href="/workbench.css"><link rel="stylesheet" href="/quiet-pages.css"><link rel="stylesheet" href="/device-pages.css">${page==='builds'?'<link rel="stylesheet" href="/build-finder.css">':''}${page==='saved'?'<link rel="stylesheet" href="/inventory.css">':''}${page==='kit'?'<link rel="stylesheet" href="/setup-pages.css"><link rel="stylesheet" href="/setup-card.css">':''}${page==='maker-pilot'?'<link rel="stylesheet" href="/maker-pilot.css">':''}${page==='scout-companion'?'<link rel="stylesheet" href="/scout-companion.css">':''}${page==='catalog'?'<link rel="stylesheet" href="/hardware-carousel.css">':''}${page==='device' || page==='buy-thanks'?'<script type="module" src="/buy.js"></script>':''}<script type="module" src="/app.js"></script></head><body data-page="${page}" data-buy-endpoint="${e(buyEndpoint)}"><a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header workbench-header"><div class="workbench-header-inner"><a class="workbench-brand" href="/" aria-label="gadgets.sh home">${brand}</a><nav aria-label="Main navigation"><a href="/" ${active==='explore' && page==='discover'?'aria-current="page"':''}>Discover</a><a href="/builds/" ${active==='builds'?'aria-current="page"':''}>Builds</a><a href="/hardware/" ${page==='catalog'||page==='device'?'aria-current="page"':''}>Hardware</a></nav><div class="header-utilities"><a href="/saved/" class="header-saved" aria-label="Saved hardware">${icons.bookmark}<span data-saved-count></span></a><a class="kit-nav" href="/setup/" ${active==='kit'?'aria-current="page"':''}><span data-kit-nav-label>Your setup</span><span data-kit-count></span>${icons.plus}</a></div></div></header>
  ${body}<dialog id="share-device-dialog" aria-labelledby="share-device-title"><form method="dialog"><h2 id="share-device-title">Share this device</h2><label for="share-device-url">Copy this link</label><input id="share-device-url" readonly><p id="share-device-notice" class="field-help" hidden></p><button class="button primary" type="submit">Done</button></form></dialog><aside id="kit-tray" class="kit-tray" aria-label="Your hardware setup" hidden><span><strong data-kit-tray-count></strong> in your setup</span><a href="/setup/">Finish your setup ${icons.arrow}</a></aside><aside id="compare-tray" class="compare-tray" aria-label="Your device comparison" hidden><div><strong><span data-tray-count>0</span> selected</strong><span class="tray-hint">Choose up to 3 devices</span></div><div id="tray-items" class="tray-items"></div><a id="tray-link" class="button tray-action" href="/compare/">Compare ${icons.arrow}</a></aside><div id="toast" class="toast" role="status" aria-live="polite"></div>
  <footer class="site-footer discovery-footer"><a class="footer-wordmark" href="/">gadgets.sh</a><nav aria-label="Footer"><a href="/about/">About & sources</a><a href="/saved/">Saved</a><a class="nav-compare" href="/compare/">Compare<span data-compare-count></span></a><a href="/builds/">Builds</a><a href="/guides/">Guides</a><a href="/for-makers/">For makers</a></nav></footer></body></html>`;
}
function collectionTile(c,devices) {
  const d=devices.find(d=>d.slug===c.cover);
  return `<a class="collection-tile" href="/collections/${c.slug}/"><div class="collection-image">${art(d)}</div><div><h3>${e(c.title)}</h3><span>${c.devices.length} finds ${icons.arrow}</span></div></a>`;
}
export function homePage(devices) {
  return layout({title:'Find your next obsession', description:'Hackable handhelds, pocket radio labs and hardware worth building with. See what it does, explore the build, make it your own.',page:'discover',body:discoveryHome(devices)});
}
export function buildsPage(devices,projects=[]) {
  const scout=devices.find(d=>d.slug==='scout-lite');
  return layout({title:'Hardware builds',description:'Explore hardware projects, find the exact parts and share your own setup.',page:'builds',active:'builds',body:`<main id="main" class="collection-main shell"><h1>Find your next build.</h1><p class="intro">Parts, files, and the choices that make a setup work.</p>
    <div class="builds-index">
      <article class="builds-card"><a class="builds-card-photo" href="/builds/scout-lite/" tabindex="-1" aria-hidden="true">${art(scout,true)}</a><div><span class="builds-card-credit">Source guide · PINGEQUA projects</span><h2><a href="/builds/scout-lite/">A pocket Wi-Fi survey kit ${icons.arrow}</a></h2><p>Scout Lite, SigRoam, and your Flipper Zero.</p></div></article>
      <article class="builds-card"><a class="builds-card-photo" href="/builds/lilyshark/" tabindex="-1" aria-hidden="true"><img src="/builds/lilyshark/tdeck-traffic.jpg" alt="LilyShark on a T-Deck — simulated traffic display" width="1050" height="1400"></a><div><span class="builds-card-credit">By LilyShark · Developer alpha</span><h2><a href="/builds/lilyshark/">A handheld radio lab ${icons.arrow}</a></h2><p>Firmware and a synthetic capture you can explore.</p></div></article>
    </div>${buildFinderSection(projects,devices)}<aside class="builds-invitation"><div><h2>What are you building?</h2><p>Give your setup a page.</p></div><a class="button primary" href="/setup/">Create a setup ${icons.arrow}</a></aside></main>`});
}
export function buildPage(devices) {
  return layout({title:'A radio lab. In your hand. — LilyShark',description:'Explore a T-Deck running LilyShark, inspect a synthetic capture, and find the parts, firmware and development notes.',page:'build',active:'builds',body:lilysharkBuild(devices)});
}
export function makerPilotPage(devices) {
  return layout({title:'For hardware makers & creators',description:'Turn your gadget demo into a useful companion page with parts, setup references and your store links.',page:'maker-pilot',active:'',body:makerPilotBody(devices)});
}
export function scoutCompanionPage(devices) {
  return layout({title:'A GPS-tagged Wi-Fi survey setup',description:'Scout Lite, Flipper Zero, and the parts and firmware behind a receive-only SigRoam survey.',page:'scout-companion',active:'builds',body:scoutCompanionBody(devices)});
}
export function catalogPage(devices) {
  return layout({title:'Hardware directory',description:'Explore hardware, check its requirements and choose the parts for your next setup.',page:'catalog',active:'hardware',body:`<main id="main" class="catalog-main shell"><div class="hardware-intro"><p class="overline">THE HARDWARE FILES</p><h1>The hardware catalog.</h1><p>Find the parts. Build your own setup.</p></div><section id="directory" class="discovery-directory" aria-labelledby="directory-heading"><div class="discovery-section-head"><h2 id="directory-heading">The hardware directory.</h2><span>${devices.filter(d=>!d.owned).length} devices + one concept</span></div><nav class="task-nav" aria-label="Explore hardware">${Object.entries(tasks).map(([key,t])=>`<a href="${key==='all'?'/hardware/':`/hardware/?task=${key}`}" data-task-filter="${key}"${key==='all'?' aria-current="true"':''}>${e(key==='all'?'Everything':t.label)}</a>`).join('')}</nav>
  <div class="browse-layout"><aside class="browse-sidebar"><details id="filter-panel" class="filter-panel"><summary>${icons.filter}Refine<span id="filter-count"></span></summary><form id="facet-form"><div class="filter-heading"><h2>Find something specific.</h2><button type="button" class="quiet-button" data-reset-filters>Reset</button></div><label>Radio / protocol<select name="capability">${options(capabilities,'all')}</select></label><label>Availability<select name="status">${options(statuses,'all')}</select></label><label>Device format<select name="format">${options(formats,'all')}</select></label><label>Category<select name="category">${options(categories,'all')}</select></label><label>Sort by<select name="sort">${options(sorts,'useful')}</select></label><label class="checkbox-label"><input type="checkbox" name="checked">Source-checked claims only</label><p class="filter-help">Checked against maker documentation. Hands-on testing is separate.</p></form></details></aside>
  <section class="browse-results" aria-label="Browse devices"><div class="browse-toolbar"><form class="search-form" role="search" action="/hardware/"><label for="device-search" class="sr-only">Search the directory</label><div class="search-field">${icons.search}<input id="device-search" name="q" type="search" placeholder="Search hardware, radios, chips…" autocomplete="off" maxlength="200"><button class="sr-only" type="submit">Search</button></div></form><div class="view-controls" role="group" aria-label="Display mode"><button type="button" data-view="carousel" aria-label="Carousel view" aria-pressed="true">${icons.radio}</button><button type="button" data-view="grid" aria-label="Grid view" aria-pressed="false">${icons.grid}</button><button type="button" data-view="list" aria-label="List view" aria-pressed="false">${icons.list}</button></div></div><div id="task-context" class="task-context" hidden><div><h2 id="task-title"></h2><p id="task-description"></p></div><a id="task-guide" class="text-link" href="/guides/">Read the guide ${icons.arrow}</a></div><div class="results-line"><p id="result-count" role="status">${devices.length} finds</p></div><div id="active-filters" class="active-filters" aria-label="Active filters"></div><section id="hardware-carousel" class="hardware-carousel" hidden aria-roledescription="carousel" aria-label="Hardware catalog"><div id="carousel-stage" tabindex="0" aria-label="Hardware cards. Use up and down arrow keys to browse; Enter opens device details." aria-describedby="carousel-instructions"></div><div class="carousel-topbar"><a href="/" class="carousel-wordmark" aria-label="gadgets.sh home">${brand}</a><div><span id="carousel-count">${devices.length} devices</span><button id="carousel-browse" type="button" aria-label="Search and filter hardware">${icons.search}<span>Search & filters</span><kbd>/</kbd></button><a class="carousel-setup-link" href="/setup/">Your setup ${icons.arrow}</a></div></div><aside class="carousel-context" aria-label="About this device"><p id="carousel-category"></p><p id="carousel-summary"></p><p id="carousel-evidence"></p></aside><aside class="carousel-specs" aria-label="Setup requirements"><dl><div><dt>Connectivity</dt><dd id="carousel-radio"></dd></div><div><dt>You’ll need</dt><dd id="carousel-needs"></dd></div></dl></aside><p id="carousel-instructions" class="sr-only">Scroll or drag to explore. Click a neighboring card to center it. Click the centered card to open its page.</p><div class="carousel-bottom"><div id="carousel-actions" class="carousel-actions"></div></div><p id="carousel-selected-announcement" class="sr-only" role="status" aria-live="polite"></p><dialog id="catalog-tools" aria-labelledby="catalog-tools-title"><div class="catalog-tools-heading"><h2 id="catalog-tools-title">Hardware catalog</h2><button type="button" data-close-catalog aria-label="Close catalog controls">${icons.close}</button></div><div data-tools-toolbar></div><div data-tools-count></div><div data-tools-facets></div><label class="carousel-motion-setting" for="carousel-motion">Carousel motion<select id="carousel-motion"><option value="system">Use device setting</option><option value="full">Full animation</option><option value="reduced">Reduced motion</option></select></label><div class="catalog-tools-bottom"><nav aria-label="Catalog navigation"><a href="/">Home</a><a href="/setup/">Your setup</a><a href="/saved/">Saved</a></nav></div></dialog></section><section id="device-feed" class="device-feed grid" aria-label="Device collection">${sortDevices(devices).map((d,i)=>deviceCard(d,i,devices.length)).join('')}</section><div id="no-results" class="empty-state" hidden><h2>No finds with that combination.</h2><p>Try a broader search or remove a filter.</p><button type="button" class="button primary" data-reset-filters>Clear filters</button></div><noscript><p class="notice">All devices are shown. Search and interactive filters need JavaScript.</p></noscript></section></div></section></main>`});
}
export function collectionsPage(devices) {
  return layout({title:'Pick a rabbit hole',description:'Curated collections of unusual hardware, from off-grid messengers to pocket science.',page:'collections',active:'collections',body:`<main id="main" class="collection-main shell"><h1>Pick a rabbit hole.</h1><p class="intro">A few paths through the hardware. Follow the one that makes you curious.</p><div class="collections-full">${collections.map(c=>collectionTile(c,devices)).join('')}</div></main>`});
}
export function collectionPage(c,devices) {
  const selected=c.devices.map(id=>devices.find(d=>d.slug===id));
  return layout({title:c.title,description:c.description,page:'collection',active:'collections',body:`<main id="main" class="collection-main shell"><a class="back-collection" href="/collections/">← Collections</a><h1>${e(c.title)}</h1><p class="intro">${e(c.description)}</p><div class="collection-actions"><a class="ink-button" href="${e(kitURL({name:c.name,devices:c.devices}))}">Remix this collection ${icons.arrow}</a><span>${selected.length} finds · Curated by gadgets.sh</span></div><div class="device-feed grid">${selected.map((d,i)=>deviceCard(d,i,selected.length)).join('')}</div></main>`});
}
export function kitCards(kit,devices,editable=false) {
  return kit.devices.map(id=>{
    const d=devices.find(d=>d.slug===id),item=partDetails(kit.items?.[id]);
    return `<article class="kit-object" data-kit-part="${id}">
      <a class="kit-object-image" href="/devices/${id}/" tabindex="-1" aria-hidden="true">${art(d)}</a>
      <div class="kit-object-copy"><span class="kit-part-maker">${e(d.maker)}</span><h2><a href="/devices/${id}/">${e(d.name)}</a></h2>
        ${editable?`<div class="kit-part-controls"><label for="part-quantity-${id}">Qty<input id="part-quantity-${id}" data-part-quantity="${id}" type="number" min="1" max="99" step="1" inputmode="numeric" value="${item.quantity}" aria-label="Quantity of ${e(d.name)}"></label><label for="part-state-${id}">Status<select id="part-state-${id}" data-part-state="${id}" aria-label="Planning state for ${e(d.name)}">${options(PART_STATES,item.state)}</select></label></div>`:`<p class="kit-part-state">${item.quantity} × · ${e(PART_STATES[item.state])}</p>${item.link || d.source?`<a class="kit-buy-link" href="${e(item.link || d.source)}" target="_blank" rel="${item.affiliate && item.link?'sponsored ':''}noopener noreferrer">${item.link?'Get this part':'Maker page'} ${icons.external}</a>${item.affiliate && item.link?'<span class="kit-affiliate-note">Creator affiliate link</span>':''}`:''}`}
      </div>
      ${editable?`<button class="kit-remove icon-button" type="button" data-remove-kit="${id}" aria-label="Remove ${e(d.name)} from setup" title="Remove from setup">${icons.close}</button>`:''}
      <details class="kit-part-details"><summary>Notes & requirements ${icons.plus}</summary><div>
        ${editable?`<label for="part-note-${id}">Why this part?<textarea id="part-note-${id}" data-part-note="${id}" maxlength="160" rows="2" placeholder="Its role, the revision, or a modification…">${e(item.note)}</textarea></label><label class="kit-part-link-field" for="part-link-${id}">Buying link <span>(optional)</span><input id="part-link-${id}" data-part-link="${id}" type="url" maxlength="400" value="${e(item.link)}" placeholder="https://…" aria-describedby="part-link-help-${id}"><span id="part-link-help-${id}" class="field-help">Use your shop link or an affiliate link approved for this page.</span></label><label class="kit-affiliate-check"><input type="checkbox" data-part-affiliate="${id}"${item.affiliate?' checked':''}>This is an affiliate link</label>`:item.note?`<p class="kit-part-note">${e(item.note)}</p>`:''}
        <dl><div><dt>You’ll need</dt><dd>${e(d.usage?.needs || 'Requirements have not been established.')}</dd></div><div><dt>Keep in mind</dt><dd>${e(d.usage?.tradeoff || 'Check the maker’s current documentation.')}</dd></div></dl>
        <a href="/devices/${id}/#specifications">Full specifications ${icons.arrow}</a>${d.source?`<a href="${e(d.source)}" target="_blank" rel="noopener noreferrer">Maker documentation ${icons.external}</a>`:''}
      </div></details>
    </article>`;
  }).join('');
}
export function kitPage() {
  return layout({title:'Your hardware setup',description:'Plan your parts, keep build notes and share a setup someone else can make their own.',page:'kit',active:'kit',body:`<main id="main" class="kit-main shell">
    <div class="kit-page-head"><div><p id="kit-mode" class="tiny-label">FROM YOUR WORKBENCH</p><h1 id="kit-heading">Your setup.</h1><p id="kit-description">The parts, the plan, and what you make of it.</p></div>
      <div class="kit-page-actions"><button id="export-card" class="ink-button" type="button" aria-haspopup="dialog" disabled>${icons.share}<span>Create a post</span></button><button id="export-kit" class="quiet-button" type="button" aria-label="More share options" title="More share options" aria-haspopup="dialog" disabled>${icons.download}<span>Save & share</span></button><a id="preview-kit" class="text-link" href="/setup/" hidden>Preview ${icons.arrow}</a></div>
    </div>
    <p id="kit-link-notice" class="notice" role="status" hidden>This setup link could not be read. Your saved draft is unchanged. <a href="/setup/">Open your draft</a></p>
    <div id="kit-shared-actions" class="kit-shared-actions" hidden><button id="remix-kit" class="ink-button" type="button">Remix this setup ${icons.plus}</button><a id="edit-kit" class="text-link" href="/setup/">Your saved draft</a></div>
    <section id="setup-story" class="setup-story" hidden><p id="setup-author"></p><p id="setup-origin" hidden></p><p id="setup-description"></p><a id="setup-project" class="ink-button" target="_blank" rel="noopener noreferrer" hidden>See the project ${icons.external}</a></section>
    <figure id="setup-photo" class="setup-photo" hidden><img id="setup-image" alt="" referrerpolicy="no-referrer"><figcaption id="setup-photo-status" role="status"></figcaption></figure>
    <div class="setup-workspace">
      <section class="setup-hardware" aria-labelledby="setup-hardware-heading">
        <div class="setup-parts-head"><h2 id="setup-hardware-heading">Hardware</h2><p id="kit-count" role="status"></p></div>
        <div id="kit-picker-panel" class="setup-picker"><form id="kit-picker"><label class="sr-only" for="kit-device">Add a device</label><div><select id="kit-device"><option value="">Choose a device…</option></select><button type="submit" class="ink-button" aria-label="Add selected device">${icons.plus}<span>Add</span></button></div><p id="kit-picker-help">Up to six devices. Add custom parts in your build notes.</p></form><a class="text-link" href="/hardware/">Browse the catalog ${icons.arrow}</a></div>
        <section id="kit-objects" class="kit-objects" aria-label="Hardware in this setup"></section>
        <section id="kit-empty" class="kit-empty"><span aria-hidden="true">${icons.build}</span><h2>Start with one device.</h2><p>Choose it above or find something in the catalog.</p><a class="text-link" href="/hardware/">Explore hardware ${icons.arrow}</a></section>
        <p id="kit-readiness" class="kit-readiness" role="status" hidden></p><p id="setup-other-parts" class="setup-other-parts" hidden></p>
      </section>
      <section id="kit-editor" class="setup-editor" aria-labelledby="setup-notes-heading"><div class="setup-fields"><h2 id="setup-notes-heading">Build notes</h2>
        <div id="kit-recovery" class="setup-recovery" hidden><button id="undo-reset-kit" class="text-link" type="button" aria-describedby="kit-restore-help" hidden>Restore previous setup</button><p id="kit-restore-help" class="field-help" hidden></p></div>
        <label for="kit-name">Setup name<input id="kit-name" maxlength="64" autocomplete="off" placeholder="The off-grid weekend rig"></label>
        <label for="kit-story">What does it do?<textarea id="kit-story" maxlength="500" rows="3" placeholder="What you’re making, and how it works…"></textarea></label>
        <label for="kit-parts">Other parts<textarea id="kit-parts" maxlength="240" rows="2" placeholder="Antenna, cables, power, an enclosure…"></textarea></label>
        <details class="setup-extras"><summary>Photo, credit & project link ${icons.plus}</summary>
          <label for="kit-author">Built by<input id="kit-author" maxlength="40" autocomplete="off" placeholder="Your name or handle"></label>
          <label for="kit-project">Build log, code or demo<input id="kit-project" type="url" maxlength="400" placeholder="https://…" aria-describedby="kit-project-help"><span id="kit-project-help" class="field-help">Link to instructions, a repository or a video.</span></label>
          <label for="kit-photo">Photo on the shared page<input id="kit-photo" type="url" maxlength="400" placeholder="https://…/my-build.jpg" aria-describedby="kit-photo-help"><span id="kit-photo-help" class="field-help">Link a public image here. Use Create a post to choose a photo from your device.</span></label>
        </details><p id="kit-save-state" class="field-help" role="status">Saved in this browser. Shared links include your notes.</p>
        <div class="setup-draft-actions"><button id="reset-kit" class="quiet-button" type="button">Start a new setup</button></div>
      </div></section>
    </div>
    <p class="kit-footnote">Parts and build notes are supplied by the creator. Check requirements before combining devices. <a href="/about/">About gadgets.sh</a></p>
    <dialog id="kit-export-menu" class="setup-export-menu" aria-labelledby="kit-export-title"><header><h2 id="kit-export-title">Share & save.</h2><form method="dialog"><button type="submit" aria-label="Close export choices">${icons.close}</button></form></header><button id="copy-kit" type="button" disabled><span><strong>Setup link</strong><small>Share a snapshot of your parts and notes.</small></span>${icons.share}</button><button id="download-kit" type="button" disabled><span><strong>Parts list</strong><small>Download your parts, notes and links as Markdown.</small></span>${icons.download}</button></dialog>
    <dialog id="kit-share-fallback" aria-labelledby="kit-share-title"><form method="dialog"><h2 id="kit-share-title">Share this setup</h2><label for="kit-share-url">Copy this link</label><input id="kit-share-url" readonly><p id="kit-share-notice" class="field-help" hidden></p><button class="ink-button" type="submit">Done</button></form></dialog>
    <noscript><p class="notice">The setup builder needs JavaScript. <a href="/collections/">Browse the curated collections</a>.</p></noscript>
  </main>`});
}
export function detailPage(d,devices,profile={},offers=[],projects=[],affiliates=[],listings={makers:[],listings:[]}) {
  const u=d.usage || {};
  const listing=d.owned?null:activeListing(listings,d.slug);
  const paid=d.owned || listing?null:affiliateLink(d.buy || d.source,affiliates);
  const similar=devices.filter(x=>x.slug!==d.slug && (u.tasks?.length?x.usage?.tasks.some(t=>u.tasks.includes(t)):x.category===d.category)).slice(0,3);
  const researchNote=d.owned?'Original hardware concept. Specifications, price and availability are not set.':d.verified?`Maker listing checked ${date(d.checked)}. Detailed documentation reviewed ${date(profile.reviewed || d.reviewed || d.checked)}. Not hands-on tested.`:`Sources reviewed ${date(d.reviewed)}. Final specifications remain unconfirmed. Check delivery with the maker.`;
  const groups=profile.sections?.length?profile.sections:[{title:'Hardware',rows:Object.entries(d.specs).map(([key,value])=>({label:{processor:'Processor',display:'Display',radio:'Radio & connectivity',power:'Power'}[key],value,source:d.source}))}];
  const resources=profile.resources?.length?profile.resources:[...(d.source?[{label:d.sourceLabel,url:d.source}]:[]),...(d.extraSources||[])];
  const count=groups.reduce((sum,g)=>sum+g.rows.length,0);
  const offer=listing?{"@type":"Offer",price:(listing.priceCents/100).toFixed(2),priceCurrency:listing.currency.toUpperCase(),availability:`https://schema.org/${listing.stock>0?'InStock':'OutOfStock'}`,url:`${siteOrigin}/devices/${d.slug}/`}:null;
  const productLd={"@context":"https://schema.org","@type":"Product",name:d.name,description:d.description,
    ...(d.image?{image:`${siteOrigin}${d.image}`}:{}),brand:{"@type":"Brand",name:d.maker},
    ...(offer?{offers:offer}:{}),...(d.source?{sameAs:[d.source]}:{})};
  return layout({title:d.name,description:d.description,page:'device',path:`/devices/${d.slug}/`,image:d.image||'',jsonLd:productLd,body:`
  <main id="main" class="device-page shell">
    <div class="device-back-row"><a href="/hardware/">${icons.arrow} Hardware</a><span>${e(categories[d.category])}</span>${shareDeviceButton(d)}</div>
    <section id="overview" class="device-overview">
      <figure class="device-photo">${art(d,true)}<figcaption><details><summary>Image credit</summary>${d.imageSource?`${e(d.imageCaption)} · <a href="${e(d.imageSourcePage||d.imageSource)}" target="_blank" rel="noopener noreferrer">${e(d.imageCredit)} ${icons.external}</a>${d.imageLicense?`<p><a href="${e(d.imageLicense.url)}" target="_blank" rel="noopener noreferrer">${e(d.imageLicense.label)}</a> · ${e(d.imageLicense.changes)} <a href="${e(d.imageSource)}" target="_blank" rel="noopener noreferrer">Original image</a></p>`:''}`:'Original concept · no product photograph.'}</details></figcaption></figure>
      <div class="device-intro"><p class="device-maker">${e(d.maker)} ${d.owned?'<span>Concept</span>':''}</p><h1>${e(d.name)}</h1><p class="device-purpose">${e(u.goodFor||d.description)}</p>
        <div class="device-tags">${d.tags.slice(0,5).map(tag=>`<span>${e(tag)}</span>`).join('')}</div>
        <div class="device-purchase">${d.price?`<strong>${e(d.price)}</strong>`:''}${availability(d)}${paid?`<a href="${e(paid.href)}" target="_blank" rel="sponsored noopener noreferrer" data-affiliate="${e(paid.program.id)}">Buy from ${e(paid.program.merchant)} ${icons.external}</a>`:''}${!paid || otherHost(d.source,paid.href)?d.source?`<a href="${e(d.source)}" target="_blank" rel="noopener noreferrer">Maker’s website ${icons.external}</a>`:'':''}</div>
        ${listing?`<div class="device-buy"><button type="button" class="button primary" data-buy-slug="${e(d.slug)}" data-buy-label="Buy on gadgets.sh · ${e(formatMoney(listing.priceCents,listing.currency))}">Buy on gadgets.sh · ${e(formatMoney(listing.priceCents,listing.currency))}</button><p class="device-buy-note" data-buy-note>${e(listing.makerName)} makes and ships it${listing.leadTime?` · ${e(listing.leadTime.toLowerCase())}`:''}. Shipping is added at checkout. gadgets.sh takes a small fee; the price is the same.</p></div>`:''}
        ${paid?`<p class="device-affiliate-note">If you buy through this link, ${e(paid.program.merchant)} pays us a small commission. The price is the same, and it doesn’t change what we list.</p>`:''}
        ${offers.map(offer=>`<details class="device-maker-offer" data-offer-checked="${e(offer.checked)}" data-offer-review-after="${e(offer.reviewAfter)}"><summary><span>Maker offer</span>${e(offer.headline)}${icons.plus}</summary><div><div class="device-offer-code"><code>${e(offer.code)}</code><button type="button" data-copy-offer="${e(offer.code)}" aria-label="Copy ${e(offer.maker)} code ${e(offer.code)}">Copy code</button></div><p>${e(offer.qualification)}</p><a href="${e(offer.source)}" target="_blank" rel="noopener noreferrer">See the maker’s offer ${icons.external}</a><small>${e(offer.relationship)} · Listed ${date(offer.checked)}${offer.checkoutTested?'':' · Not tested at checkout'}</small></div></details>`).join('')}
        <div class="device-primary-actions">${kitButton(d)}${saveButton(d)}${compareDeviceLink(d)}</div>
        <dl class="device-fit"><div><dt>Bring along</dt><dd>${e(u.needs||'Hardware details are still being developed.')}</dd></div><div><dt>Keep in mind</dt><dd>${e(u.tradeoff||'Specifications are under development.')}</dd></div></dl>
        <a class="device-evidence" href="#sources">${d.verified?icons.check:icons.external}<span>${e(review(d))}${profile.reviewed?` · ${date(profile.reviewed)}`:''}</span></a>
      </div>
    </section>
    <nav class="device-section-nav" aria-label="Device sections"><a href="#overview">Overview</a><a href="#specifications">Specifications <span>${count}</span></a><a href="#resources">Resources <span>${resources.length}</span></a></nav>
    <div class="device-reference-layout"><section id="specifications" class="device-specifications"><div class="device-section-heading"><div><h2>Specifications</h2></div><label class="device-spec-search">${icons.search}<input type="search" id="spec-search" placeholder="Find a specification" aria-label="Find a specification"></label></div>
      <p id="spec-search-status" class="sr-only" role="status"></p>
      <div class="device-spec-groups">${groups.map((group,index)=>`<details class="device-spec-group" ${index===0?'open':''}><summary><h3>${e(group.title)}</h3><span>${group.rows.length}</span></summary><dl>${group.rows.map(row=>`<div data-spec-row><dt>${e(row.label)}</dt><dd>${e(row.value)}${row.source?`<a class="spec-source" href="${e(row.source)}" target="_blank" rel="noopener noreferrer" aria-label="Source for ${e(row.label)}">${icons.external}</a>`:''}</dd></div>`).join('')}</dl></details>`).join('')}</div>
      <p id="spec-no-results" hidden>No matching specification. Try a chip name, connector or feature.</p>
      ${profile.gaps?.length?`<details class="device-gaps"><summary>What still needs checking</summary><ul>${profile.gaps.map(note=>`<li>${e(note)}</li>`).join('')}</ul></details>`:''}
    </section>
    <aside id="resources" class="device-resources"><h2>Downloads & docs</h2><div class="device-resource-list">${d.owned?'<p class="device-concept-note">This original hardware is still a concept. <a href="/builds/lilyshark/">Explore the separate LilyShark firmware project →</a></p>':''}${resources.map(r=>`<a href="${e(r.url)}" target="_blank" rel="noopener noreferrer"><span><strong>${e(r.label)}</strong><small>${e(r.kind||new URL(r.url).hostname.replace(/^www\./,''))}</small></span>${icons.external}</a>`).join('')}</div>
      ${projects.some(project=>project.coreCatalogSlugs.includes(d.slug))?`<a class="device-firmware-link" href="/builds/?hardware=${e(d.slug)}#build-finder"><span>From the original makers</span><strong>Build with ${e(d.name)} ${icons.arrow}</strong></a>`:''}
      ${['scout-lite','flipper-zero'].includes(d.slug)?`<a class="device-firmware-link" href="/builds/scout-lite/"><span>Source guide · PINGEQUA projects</span><strong>A pocket Wi-Fi survey kit ${icons.arrow}</strong></a>`:''}
      ${d.firmware?`<a class="device-firmware-link" href="/builds/lilyshark/"><span>LILYGO makes the hardware. LilyShark makes separate firmware.</span><strong>Explore the radio lab ${icons.arrow}</strong></a>`:''}
      <details id="sources" class="device-source-notes"><summary>Source & revision notes</summary><p>${e(researchNote)}</p>${d.price?'<p>Price is a dated listing; confirm with the maker.</p>':''}${(d.verificationNotes||[]).map(note=>`<p>${e(note)}</p>`).join('')}${profile.notes?.map(note=>`<p>${e(note)}</p>`).join('')||''}${d.owned?'<p>LilyShark and gadgets.sh are separate projects with shared ownership. The proposed device is not available to order.</p>':''}<a href="/about/">How we check sources ${icons.arrow}</a></details>
    </aside></div>
    <section class="device-related"><div class="section-heading"><h2>Related hardware</h2><a class="text-link" href="/hardware/?category=${d.category}">Explore more ${icons.arrow}</a></div><div class="device-feed grid">${similar.map((x,i)=>deviceCard(x,i,similar.length)).join('')}</div></section>
    <div class="device-mobile-actions"><div><strong>${e(d.name)}</strong><span>${e(d.price||statuses[d.status])}</span></div>${saveButton(d)}${kitButton(d)}</div>
  </main>`});
}
export function savedPage() {
  return layout({title:'Saved hardware',description:'Keep a shortlist and track the hardware you own, independently of each build.',page:'saved',active:'saved',body:`<main id="main" class="collection-main shell"><h1>Saved hardware.</h1><p class="storage-note">Saved in this browser. No account needed.</p><nav class="saved-views" aria-label="Saved hardware views"><a href="/saved/" data-saved-view="shortlist" aria-current="page">Shortlist</a><a href="/saved/?view=hardware" data-saved-view="hardware">My hardware</a></nav><section id="saved-shortlist" aria-label="Shortlist"><p id="saved-summary" role="status"></p><section id="saved-feed" class="device-feed grid" aria-label="Saved devices"></section><div id="saved-empty" class="empty-state">${icons.bookmark}<h2>Nothing saved yet.</h2><p>Save a device to find it here.</p><a class="button primary" href="/hardware/">Find a device ${icons.arrow}</a></div></section>${inventorySection()}<noscript><p class="notice">JavaScript is needed to access hardware saved in this browser.</p></noscript></main>`});
}
export function compareTable(devices) {
  const rows=[['Good for',d=>d.usage?.goodFor || d.description],['You’ll need',d=>d.usage?.needs || 'Unconfirmed'],['Main tradeoff',d=>d.usage?.tradeoff || 'Unconfirmed'],['Device format',d=>formats[d.usage?.format] || categories[d.category]],['Availability',d=>statuses[d.status]],['Listed price',d=>d.price || 'Unconfirmed'],['Processor',d=>d.specs.processor],['Display',d=>d.specs.display],['Radio',d=>d.specs.radio],['Power',d=>d.specs.power],['Source check',d=>d.owned?'Concept — specifications not set':d.verified?`Source checked ${d.checked}; maker claims, not field tested`:`Reviewed ${d.reviewed}; final specifications unconfirmed`],['Revision & source notes',d=>(d.verificationNotes || []).join(' ') || 'Original hardware concept; specifications and price are not set.']];
  return `<div class="comparison-scroll" tabindex="0" aria-label="Device comparison table"><table class="comparison" style="--device-count:${devices.length}"><caption class="sr-only">Compare selected devices, including setup requirements, tradeoffs and source caveats.</caption><thead><tr><th scope="col"><span>What matters <br>for your setup</span></th>${devices.map(d=>`<th scope="col">${art(d,true)}<a href="/devices/${d.slug}/">${e(d.name)}</a><button type="button" class="remove-compare quiet-button" data-remove-compare="${d.slug}" aria-label="Remove ${e(d.name)} from comparison">Remove ${icons.close}</button></th>`).join('')}</tr></thead><tbody>${rows.map(([label,get])=>{const values=devices.map(get),same=devices.length>1 && values.every(v=>v===values[0]);return `<tr data-same="${same}"><th scope="row">${label}</th>${values.map(value=>`<td>${e(value)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>`;
}
export function comparePage(preset={}) {
  const selected=preset.devices || [];
  const initial=selected.length?` data-initial-compare="${selected.map(d=>d.slug).join(',')}"`:'';
  return layout({title:preset.title || 'Compare your options',description:preset.summary || 'Compare what devices do, what they need and the tradeoffs that matter.',page:'compare',active:'compare',body:`<main id="main" class="collection-main shell"${initial}><h1>${e(preset.title || 'Compare hardware.')}</h1><p class="intro">${e(preset.summary || 'Up to three devices, side by side.')}</p><div class="compare-tools"><form id="compare-picker" class="compare-picker"><label for="compare-device">Add a device</label><div><select id="compare-device" name="device"><option value="">Choose a device…</option></select><button class="button primary" type="submit">Add ${icons.plus}</button></div></form><label class="checkbox-label"><input id="differences-only" type="checkbox">Show differences only</label><button id="share-comparison" class="button secondary" hidden>Copy comparison link ${icons.external}</button></div><div id="comparison-result">${selected.length?compareTable(selected):''}</div><div id="compare-empty" class="empty-state" ${selected.length?'hidden':''}>${icons.grid}<h2>Choose your first device above.</h2><a class="button secondary" href="/hardware/">Browse hardware</a><div class="comparison-examples">${comparisons.map(c=>`<a href="/comparisons/${c.slug}/">${e(c.title)} ${icons.arrow}</a>`).join('')}</div></div><noscript><p class="notice">JavaScript is needed to change this selection. Published comparisons remain readable.</p></noscript></main>`});
}
export function guidesPage() {
  return layout({title:'A useful place to start',description:'Practical starting guides for mesh messaging, wireless experiments, RFID, pocket computing and DIY hardware.',page:'guides',active:'guides',body:`<main id="main" class="collection-main shell"><h1>Guides.</h1><p class="intro">Choose your hardware. Get it working.</p><nav class="comparison-examples guide-comparisons" aria-label="Featured comparisons">${comparisons.map(c=>`<a href="/comparisons/${c.slug}/">${e(c.title)} ${icons.arrow}</a>`).join('')}</nav><div class="guide-directory">${guides.map((g,i)=>`<a class="guide-tile" href="/guides/${g.slug}/"><span class="guide-icon">${icon(tasks[g.slug].icon)}</span><h2>${e(tasks[g.slug].label)}</h2><p>${e(g.title)}</p><span class="text-link">Read guide ${icons.arrow}</span></a>`).join('')}</div></main>`});
}
export function guidePage(g,devices) {
  const picks=g.picks.map(p=>({...p,device:devices.find(d=>d.slug===p.slug)}));
  const compareURL=`/compare/?devices=${picks.map(p=>p.slug).join(',')}`;
  return layout({title:g.title,description:g.summary,page:'guide',active:'guides',body:`<main id="main" class="guide-main shell" data-guide="${g.slug}"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/guides/">Guides</a><span>/</span><span>${e(tasks[g.slug].label)}</span></nav><header class="guide-header"><span class="guide-icon">${icon(tasks[g.slug].icon)}</span><h1>${e(g.title)}</h1><p class="intro">${e(g.summary)}</p></header><section class="guide-options"><div class="section-heading"><h2>Three starting points</h2><a class="button secondary" href="${compareURL}">Compare these devices ${icons.arrow}</a></div><div class="guide-picks">${picks.map((p,i)=>`<article class="guide-pick"><span class="pick-number">0${i+1}</span><a href="/devices/${p.slug}/" tabindex="-1" aria-hidden="true">${art(p.device,true)}</a><h3>${e(p.reason)}</h3><a class="pick-device" href="/devices/${p.slug}/">${e(p.device.name)} ${icons.arrow}</a><p>${e(p.detail)}</p>${availability(p.device)}</article>`).join('')}</div><p class="source-note">${e(g.sourceNote)}</p></section><div class="guide-lower"><section class="buying-checks"><h2>Before you buy</h2><ol>${g.checks.map(c=>`<li>${e(c)}</li>`).join('')}</ol><a class="text-link" href="/hardware/?task=${g.slug}">See all ${e(tasks[g.slug].label.toLowerCase())} devices ${icons.arrow}</a></section><section class="session-checklist"><div><h2>Setup checklist</h2><p class="checklist-note">Progress saved in this browser.</p><p data-checklist-progress role="status">0 of ${g.steps.length} steps complete</p></div><ol>${g.steps.map((step,i)=>{const d=devices.find(d=>d.slug===step.device),url=step.url || d?.source;return `<li><label><input type="checkbox" data-guide-step="${i}"><span>${e(step.title)}</span></label><p>${e(step.text)}</p><a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(step.label || `${d.name} maker resources`)} ↗</a></li>`;}).join('')}</ol></section></div></main>`});
}
export function aboutPage(devices) {
  return layout({title:'About gadgets.sh',description:'Independent hardware discovery, maker sources and setups you can share.',page:'about',active:'',body:`<main id="main" class="essay shell"><h1>Curious hardware.<br>Useful starting points.</h1><p class="lede">Discover devices, build a setup, and share what you make.</p>
    <h2>A place for hardware and its makers</h2><p>Browse ${devices.filter(d=>!d.owned).length} devices, explore builds, and share your own setup.</p><h2>Separate from LilyShark</h2><p>LilyShark is a firmware and hardware project featured here. gadgets.sh is a separate catalog and build-sharing platform. The two projects share ownership; neither name replaces the other.</p>
    <h2>Follow the sources</h2><p>“Source checked” means compared with maker documentation, not tested on our bench. Device pages keep revision notes, unknowns and image credits alongside their sources. Confirm prices and stock with the maker.</p><p>gadgets.sh has no paid placements or affiliate agreements in this preview. Creators can supply their own buying links and label affiliate links.</p>
    <details class="info-disclosure"><summary><h2>Your data & shared setups</h2></summary><div class="disclosure-copy"><p>Drafts, saved devices, comparisons and checklist progress stay in this browser. Clearing site storage removes them.</p><p>A setup link includes the details you add: name, creator credit, notes, parts and project or photo URLs. A setup link lets other people view and remix those details once the site is publicly hosted. Local preview links stay on this computer. Opening a link preserves your draft; Remix replaces it.</p><p>There are no accounts or photo uploads. Linked photos load from the creator’s supplied address.</p></div></details><a class="button primary" href="/hardware/">Explore hardware ${icons.arrow}</a></main>`});
}
export function firmwarePage() {
  return layout({title:'LilyShark firmware',description:'Radio firmware for the LILYGO T-Deck. Developer alpha.',page:'firmware',active:'builds',body:`<main id="main" class="essay shell"><a class="back-link" href="/builds/lilyshark/">← LilyShark build</a><p class="eyebrow">Developer alpha</p><h1>LilyShark firmware.</h1><p class="lede">Explore mesh traffic, exchange messages, and inspect captures on the LILYGO T-Deck.</p><a class="button primary" href="/builds/lilyshark/#demo">Try the capture demo ${icons.arrow}</a>
    <h2>Recorded on hardware</h2><p>The project documents live Meshtastic reception and direct messages between two T-Deck devices.</p>
    <h2>Still to validate</h2><p>MicroSD capture writes, scan recovery and live MeshCore / RNode paths remain unverified.</p>
    <details class="info-disclosure"><summary><h2>Radio & capture notes</h2></summary><div class="disclosure-copy"><p>Reception, decoding and decryption are separate. Private message content requires the appropriate keys.</p><p>Local capture and export come first. Optional Shelby storage is a separate sharing integration under evaluation; radio use requires no token or per-packet on-chain action.</p></div></details>
    <h2>LilyShark hardware</h2><p>LILYGO makes the T-Deck. An original LilyShark board and enclosure are still a concept; radio architecture, battery targets and price are undecided.</p><a class="text-link" href="/devices/lilyshark/">Explore the concept ${icons.arrow}</a></main>`});
}

export function buyThanksPage() {
  return layout({title:'Thanks for your order',description:'Your gadgets.sh order confirmation.',page:'buy-thanks',body:`<main id="main" class="collection-main shell"><h1>Thanks — your payment went through.</h1><p id="order-status" data-order-status role="status">Checking your order…</p><p><a class="button" href="/hardware/">Back to hardware ${icons.arrow}</a></p><noscript><p class="notice">Your payment went through. A confirmation email is on its way.</p></noscript></main>`});
}
