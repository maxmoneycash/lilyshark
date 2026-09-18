export const DEMO_PROJECT_ID = 'wio-l1-environment-node';
export const DEMO_IMAGE_SLUG = 'seeed-wio-tracker-l1';
export const DEMO_STORAGE_KEY = 'gadgets.maker-demo-pilot';
export const DEMO_REVIEW_DATE = '2026-09-16';
export const DEMO_SOURCES = Object.freeze({
  guide: 'https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/#sensor-connection',
  firmware: 'https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/#flash-firmware',
  board: 'https://wiki.seeedstudio.com/wio_tracker_l1_node/',
  boardStore: 'https://www.seeedstudio.com/Wio-Tracker-L1-p-6453.html',
  sensorStore: 'https://www.seeedstudio.com/Grove-BME280-Environmental-Sensor-Temperature-Humidity-Barometer.html',
  license: 'https://creativecommons.org/licenses/by-sa/4.0/',
  licenseDeclaration: 'https://wiki.seeedstudio.com/License/'
});

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const mark = '<svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#d5f582"/><path d="M28 13H18a7 7 0 0 0-7 7v2a7 7 0 0 0 7 7h10V20h-8" stroke="#18201b" stroke-width="4" stroke-linejoin="round"/><circle cx="29" cy="10" r="2" fill="#18201b"/></svg>';

export function makerDemoHTML({image, project}) {
  if(project?.id !== DEMO_PROJECT_ID || project.guideURL !== DEMO_SOURCES.guide) throw new Error('Use the reviewed Wio L1 project.');
  const s = DEMO_SOURCES;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="description" content="A useful next step for your gadget demo: the exact parts, the original guide, and a path to your store. Explore the proposed gadgets.sh maker pilot.">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>Make the next click useful. — gadgets.sh for makers</title>
  <link rel="stylesheet" href="./maker-demo.css">
  <script type="module" src="./maker-pilot.js"></script>
</head>
<body id="top">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header wrap">
    <a class="brand" href="#top" aria-label="gadgets.sh, back to top">${mark}<span>gadgets<span class="brand-suffix">.sh</span></span></a>
    <nav aria-label="Page navigation"><a href="#example">The example</a><a href="#pilot">The pilot</a></nav>
    <span class="header-label">For makers &amp; creators</span>
  </header>
  <main id="main" class="wrap">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">You made the gadget. We make the next step.</p>
        <h1 id="hero-title">Make the next <br>click <span>useful.</span></h1>
        <p class="lede">Give your next post a page people can build from. Your parts, your guide, and a clear path to your store.</p>
        <a class="button button-dark" href="#example">See it in action ${arrow}</a>
        <p class="hero-note">Your media. Your credit. Your existing audience.</p>
      </div>
      <figure class="hero-photo">
        <div class="photo-label"><span class="signal-dot" aria-hidden="true"></span> A real starting point</div>
        <img src="./assets/seeed-wio-tracker-l1.jpg" width="${escape(image.width)}" height="${escape(image.height)}" alt="Seeed Wio Tracker L1 board with its OLED display" fetchpriority="high">
        <div class="photo-title"><span>01 / Mesh &amp; sensors</span><strong>Small board. <br>Useful possibilities.</strong></div>
        <figcaption>Image: ${escape(image.credit)} · <a href="${escape(image.sourcePage)}">Source</a> · <a href="${escape(image.license.url)}">${escape(image.license.label)}</a><span class="image-changes">Original file unchanged; resized for display.</span></figcaption>
      </figure>
    </section>

    <section id="example" class="example section" aria-labelledby="example-title">
      <div class="section-heading">
        <div><p class="eyebrow">The companion page, in miniature</p><h2 id="example-title">Environmental readings <br>on your mesh node.</h2></div>
        <p class="section-intro">One outcome. The right parts. The maker’s own instructions, within reach.</p>
      </div>
      <div class="example-card">
        <div class="parts-panel">
          <div class="panel-heading"><h3>The parts</h3><span>2 core parts</span></div>
          <ol class="parts-list">
            <li><span class="quantity" aria-label="Quantity 1">1×</span><div><strong>Wio Tracker L1</strong><p>The base model with OLED.</p></div><a class="store-link" href="${s.boardStore}" aria-label="Wio Tracker L1 at the official Seeed store">Store ${arrow}</a></li>
            <li><span class="quantity" aria-label="Quantity 1">1×</span><div><strong>Grove BME280</strong><p>Temperature, humidity and pressure.</p></div><a class="store-link" href="${s.sensorStore}" aria-label="Grove BME280 at the official Seeed store">Store ${arrow}</a></li>
          </ol>
          <p class="parts-extra"><strong>Also have ready</strong> Grove cable, suitable power, a band-matched antenna, USB data cable, computer and phone. Remote reception needs another configured node.</p>
          <a class="button button-dark" href="./downloads/wio-l1-parts.md" download>Download the parts list ${arrow}</a>
        </div>
        <div class="setup-panel">
          <p class="eyebrow">The setup path</p>
          <ol class="steps">
            <li><span aria-hidden="true">01</span><div><h3>Connect the sensor</h3><p>Use the L1’s Grove interface.</p></div></li>
            <li><span aria-hidden="true">02</span><div><h3>Match the firmware</h3><p>Meshtastic target: <strong>Seeed Wio Tracker L1</strong>. For updates, follow the guide’s USB DFU method; avoid NRF-OTA.</p></div></li>
            <li><span aria-hidden="true">03</span><div><h3>Enable the readings</h3><p>Set your region. Enable environment telemetry and “on screen” for the OLED.</p></div></li>
          </ol>
          <a class="guide-link" href="${s.guide}">Open Seeed’s original guide ${arrow}</a>
        </div>
      </div>
      <div class="source-note"><p><strong>Independent source example.</strong> Based on Seeed Studio’s guide. Not hands-on tested or maker commissioned. Store links are direct, with no affiliate tracking.</p><p>Sources reviewed <time datetime="${DEMO_REVIEW_DATE}">16 Sep 2026</time> · <a href="${s.board}">Model reference</a> · <a href="${s.firmware}">Firmware instructions</a></p></div>
    </section>

    <section id="sharing" class="sharing section" aria-labelledby="sharing-title">
      <div class="section-heading"><div><p class="eyebrow">The sharing files</p><h2 id="sharing-title">One design. <br>Three sizes.</h2></div><p class="section-intro">A photo-free example you can inspect, download and edit.</p></div>
      <div class="sharing-grid">
        <figure class="sharing-preview"><img src="./sharing/wio-l1-wide.png" width="1200" height="630" loading="lazy" alt="Wio Tracker L1 OLED and Grove BME280 sharing design, credited to Seeed Studio’s guide"><figcaption>Independent source example. Not hands-on tested or commissioned.</figcaption></figure>
        <div class="sharing-files"><h3>Download the example</h3><ul aria-label="Sharing image formats">${[['feed','Feed','1080 × 1350'],['story','Story','1080 × 1920'],['wide','Wide','1200 × 630']].map(([format,label,size])=>`<li><div><strong>${label}</strong><span>${size}</span></div><div class="sharing-file-links"><a href="./sharing/wio-l1-${format}.png" download aria-label="Download ${label.toLowerCase()} PNG">PNG</a><a href="./sharing/wio-l1-${format}.svg" download aria-label="Download editable ${label.toLowerCase()} SVG">Editable SVG</a></div></li>`).join('')}</ul><a class="text-link" href="./downloads/wio-l1-caption.txt" download>Download the caption ${arrow}</a><p>The caption includes the required extras and Seeed’s original guide.</p></div>
      </div>
    </section>

    <section id="pilot" class="pilot section" aria-labelledby="pilot-title">
      <div class="pilot-intro"><p class="eyebrow">For your next product or build</p><h2 id="pilot-title">A page worth <br>putting in your bio.</h2><p>You bring an existing demo and approved media. We turn them into a useful companion people can keep, follow and share.</p><a class="text-link" href="#pilot-brief">Prepare your brief ${arrow}</a></div>
      <div class="offer-card"><div class="offer-price"><strong>$750</strong><span>Proposed one-time pilot</span></div>
        <ul class="deliverables"><li><strong>One build &amp; buy page</strong><span>Your credit, original links and editable files.</span></li><li><strong>An exact starting point</strong><span>Parts, one revision and firmware path, source links and a downloadable list.</span></li><li><strong>Ready for your next post</strong><span>One sharing design in three crops.</span></li></ul>
        <p class="offer-timing">Five working days after materials and scope are agreed. One consolidated review.</p>
        <details class="scope-details"><summary>See the scope</summary><div><p>Up to six catalog devices, stated accessories, eight primary sources, one approved existing demo and five supplied images.</p><p>Includes social-preview metadata and official store links. One merchant-approved offer can be included when its terms are confirmed.</p><p>Hosting is agreed separately. Proposed payments: $375 after scope agreement and $375 after acceptance. The fee buys production assets; reach and sales are not guaranteed.</p></div></details>
      </div>
    </section>

    <section id="pilot-brief" class="brief section" aria-labelledby="brief-title">
      <div class="brief-intro"><p class="eyebrow">Start with three things</p><h2 id="brief-title">What are you <br>working on?</h2><p>Make a short brief to keep or share in your own conversation.</p><p class="privacy-note">Saved in this browser. Nothing is submitted, booked or paid.</p><a class="text-link" href="./downloads/maker-pilot-brief.md" download>Download a blank brief ${arrow}</a></div>
      <form id="maker-pilot-form" novalidate aria-labelledby="brief-title">
        <noscript><p class="noscript-note">Enable JavaScript to prepare a brief here, or download the blank brief beside this form.</p></noscript>
        <fieldset id="pilot-fields" disabled><legend class="sr-only">Your maker pilot brief</legend>
          <div class="field"><label for="pilot-company">Maker or creator name</label><input id="pilot-company" name="company" autocomplete="organization" maxlength="100" required aria-describedby="pilot-company-error"><p id="pilot-company-error" class="field-error" hidden></p></div>
          <div class="field"><label for="pilot-productURL">Product or build link</label><input id="pilot-productURL" name="productURL" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" maxlength="600" placeholder="Paste the HTTPS link" required aria-describedby="pilot-productURL-error"><p id="pilot-productURL-error" class="field-error" hidden></p></div>
          <div class="field"><label for="pilot-outcome">What should someone be able to make or do?</label><textarea id="pilot-outcome" name="outcome" rows="3" maxlength="500" placeholder="One useful outcome from your demo" required aria-describedby="pilot-outcome-error"></textarea><p id="pilot-outcome-error" class="field-error" hidden></p></div>
          <p id="pilot-form-error" class="field-error" role="alert" hidden></p>
          <div class="brief-actions"><button id="pilot-download" class="button button-dark" type="button">Download brief ${arrow}</button><button id="pilot-copy" class="button button-light" type="button">Copy brief</button></div>
          <p id="pilot-action-state" class="action-state" role="status" aria-live="polite"></p>
        </fieldset>
        <p id="pilot-save-state" class="save-state" role="status" aria-live="polite">JavaScript enables the local brief editor.</p>
      </form>
    </section>
  </main>
  <footer class="site-footer wrap"><p><strong>gadgets.sh</strong> <span>Useful next steps for hardware.</span></p><nav aria-label="Files and credits"><a href="./CREDITS.md" download>Credits &amp; sources</a><a href="./README.md" download>About this demo</a><a href="#top">Back to top ↑</a></nav></footer>
  <dialog id="pilot-copy-dialog" aria-labelledby="copy-title"><div class="dialog-heading"><h2 id="copy-title">Copy your brief</h2><form method="dialog"><button class="button button-light" type="submit">Done</button></form></div><label for="pilot-copy-text">Select this text and copy it.</label><textarea id="pilot-copy-text" rows="14" readonly></textarea></dialog>
</body>
</html>
`;
}

export function demoPartsMarkdown() {
  const s = DEMO_SOURCES;
  return `# Wio L1 environment node — parts reference\n\nIndependent source example by gadgets.sh. Not hands-on tested or maker commissioned. Sources reviewed ${DEMO_REVIEW_DATE}.\n\n## Parts\n\n- 1 × [Wio Tracker L1, OLED model](${s.boardStore})\n- 1 × [Grove BME280](${s.sensorStore})\n- Grove cable, suitable power, regional antenna, USB data cable, computer and phone.\n- Another configured node for remote reception.\n\n## Setup\n\nUse the Grove interface. Choose Meshtastic target Seeed Wio Tracker L1. Updates use USB DFU, not NRF-OTA. Set your region; enable environment telemetry and on-screen readings.\n\nFollow [Seeed Studio’s original guide](${s.guide}) and [firmware instructions](${s.firmware}). Check the [model reference](${s.board}) before buying. Direct store links carry no affiliate tracking.\n`;
}

export function demoCreditsMarkdown(image) {
  return `# Credits and sources\n\n## Product photograph\n\n- Work: Seeed Wio Tracker L1 product image (OLED model).\n- Creator: ${image.credit}.\n- Local file: assets/seeed-wio-tracker-l1.jpg\n- [Source page](${image.sourcePage})\n- [Original image file](${image.source})\n- License: [${image.license.label}](${image.license.url}).\n- [Seeed’s license declaration](${image.license.source}), Documents and Images section; checked ${image.license.checked}.\n- Changes: ${image.license.changes}\n- SHA-256: ${image.sha256}\n\nRetain this attribution and license link when sharing the photograph. CC BY-SA 4.0 governs the photograph; this package places no additional restrictions on it. If you adapt the licensed material, follow the license’s ShareAlike terms. Attribution does not imply endorsement.\n\n## Technical reference\n\nThe example selects the BME280 option in [Seeed Studio’s Wio L1 guide](${DEMO_SOURCES.guide}). Its [firmware section](${DEMO_SOURCES.firmware}) and [model reference](${DEMO_SOURCES.board}) identify the matching hardware path. Reviewed ${DEMO_REVIEW_DATE}. This is an independent source example, not a commissioned project or hands-on test. No affiliation, active discount or affiliate arrangement is asserted.\n\n## Sharing designs\n\nThe three photo-free sharing designs and caption are original gadgets.sh project work. They use system-font text and original vector geometry, with no product photographs or third-party illustrations. Editable SVGs and matching PNGs are included; sharing/render-manifest.json records the source SVG and rendered PNG hashes and dimensions. Preserve Seeed Studio guide credit and the source-example status when reusing them. The designs do not show measurements or a commissioned client result.\n\n## Original page\n\nThe gadgets.sh interface, wordmark treatment, copy, layout and brief utility are project work. System fonts are used; no font files, third-party UI libraries, other product photographs, tracking code or video embeds are distributed.\n`;
}
