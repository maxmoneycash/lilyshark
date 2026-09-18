import { escapeHTML as e } from './catalog.mjs';
import { kitURL, normalizeKit } from './kits.mjs';

const SOURCE = {
  hardware: 'https://www.pingequa.com/products/scout-lite',
  guide: 'https://github.com/pingequalab/scout-lite',
  app: 'https://github.com/pingequalab/sigroam-wardriving',
  release: 'https://github.com/pingequalab/sigroam-wardriving/releases/tag/v0.3',
  transfer: 'https://docs.flipper.net/zero/qflipper',
  flipper: 'https://flipper.net/products/flipper-zero',
};
const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';
const external = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>';
const outward = (url, text, className='scout-source-link') => `<a class="${className}" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(text)}${external}</a>`;

function devicePhoto(device, alt, eager=false) {
  return `<img src="${e(device.image)}" alt="${e(alt)}" width="${Number(device.imageWidth)}" height="${Number(device.imageHeight)}" loading="${eager?'eager':'lazy'}" decoding="async"${eager?' fetchpriority="high"':''}>`;
}

function hardwareRow(device, role, shop) {
  return `<li class="scout-part">
    <a class="scout-part-device" href="/devices/${e(device.slug)}/">
      <span class="scout-part-photo">${devicePhoto(device, `${device.name}; maker photo by ${device.imageCredit || device.maker}`)}</span>
      <span class="scout-part-copy"><strong>${e(device.name)}</strong><span>${e(role)}</span></span>
      <span class="scout-quantity" aria-label="Quantity 1">1×</span>
    </a>
    <div class="scout-part-footer"><span>Photo: ${e(device.imageCredit || device.maker)}</span>${outward(shop,'Maker store','scout-store-link')}</div>
  </li>`;
}

export function scoutCompanionBody(devices) {
  const scout=devices.find(device=>device.slug==='scout-lite');
  const flipper=devices.find(device=>device.slug==='flipper-zero');
  if(!scout || !flipper)throw new Error('Scout companion needs scout-lite and flipper-zero catalog entries.');
  const setup=normalizeKit({
    name:'Scout Lite + SigRoam',
    author:'gadgets.sh source guide',
    story:'A source-based starting point for GPS-tagged Wi-Fi surveys. Scout Lite and SigRoam are PINGEQUA projects; Flipper Zero is by Flipper Devices. Not hands-on tested or maker commissioned.',
    project:SOURCE.app,
    parts:'2 microSD cards: Flipper card for the app; separate FAT32 card in Scout Lite for CSV logs. USB-C data cable for qFlipper file transfer. Scout Lite includes a dual-band SMA antenna; attach before power-on.',
    devices:[scout.slug,flipper.slug],
    items:{
      [scout.slug]:{quantity:1,state:'considering',note:'ESP32-C5 board. Keep factory ESP32 Marauder firmware. CSV logs go to its own FAT32 microSD. GPS coordinates require a fix.'},
      [flipper.slug]:{quantity:1,state:'considering',note:'SigRoam 0.3: sigroam-0.3.fap in SD Card/apps/GPIO/. Official or Momentum. Settings > System > Log Device: Off.'},
    },
  },devices);
  return `<main id="main" class="scout-companion shell">
    <nav class="scout-breadcrumb" aria-label="Breadcrumb"><a href="/builds/">Builds</a><span aria-hidden="true">/</span><span>Scout Lite + SigRoam</span></nav>
    <article>
      <header class="scout-hero">
        <figure class="scout-hero-photo">
          ${devicePhoto(scout,'PINGEQUA Scout Lite connected to a Flipper Zero, with the Marauder menu visible and its antenna attached',true)}
          <figcaption>${outward(scout.imageSourcePage || SOURCE.hardware,`${scout.imageCredit || scout.maker} photo`)}<span>Marauder interface shown</span></figcaption>
        </figure>
        <div class="scout-intro">
          <p class="scout-eyebrow">Independent source guide</p>
          <h1>A pocket <br>Wi-Fi survey kit.</h1>
          <p class="scout-lede">Scout Lite + SigRoam. Collect GPS-tagged Wi-Fi logs with your Flipper Zero.</p>
          <p class="scout-maker-line">Scout Lite &amp; SigRoam by <strong>PINGEQUA</strong></p>
          <a class="scout-primary" href="${e(kitURL(setup))}">Use these parts ${arrow}</a>
          <p class="scout-action-note">Open the parts list. Mark what you own. Make it yours.</p>
          ${outward(SOURCE.hardware,'See the maker’s overview')}
        </div>
      </header>

      <div class="scout-guide-grid">
        <section class="scout-hardware" aria-labelledby="scout-hardware-heading">
          <div class="scout-section-heading"><h2 id="scout-hardware-heading">The hardware</h2><span>2 parts</span></div>
          <ul class="scout-parts">
            ${hardwareRow(scout,'Wi-Fi scanner + GPS',SOURCE.hardware)}
            ${hardwareRow(flipper,'Handheld controls + display',SOURCE.flipper)}
          </ul>
          <div class="scout-accessories">
            <h3>Also on the bench</h3>
            <dl>
              <div><dt>2 microSD cards</dt><dd>Flipper: app. Scout Lite: FAT32 survey logs.</dd></div>
              <div><dt>USB-C data cable</dt><dd>Transfer the app with qFlipper.</dd></div>
              <div><dt>Dual-band SMA antenna</dt><dd>Included with Scout Lite.</dd></div>
            </dl>
            <div class="scout-link-row">${outward(SOURCE.guide,'Hardware guide')}${outward(SOURCE.transfer,'File transfer guide')}</div>
          </div>
        </section>

        <section class="scout-software" aria-labelledby="scout-software-heading">
          <div class="scout-section-heading"><h2 id="scout-software-heading">What goes where</h2></div>
          <div class="scout-firmware-map">
            <div class="scout-firmware-target">
              <span class="scout-target-label">On the Flipper</span>
              <h3>SigRoam <span>0.3</span></h3>
              <p>The survey dashboard. One <code>.fap</code> for Official or Momentum firmware; Unleashed is unsupported by this release.</p>
              ${outward(SOURCE.release,'Get SigRoam 0.3','scout-download')}
            </div>
            <div class="scout-firmware-target">
              <span class="scout-target-label">On Scout Lite · ESP32-C5</span>
              <h3>ESP32 Marauder</h3>
              <p>Keep the factory image. The board does the scanning and writes CSV to its own microSD.</p>
              ${outward(SOURCE.app+'#where-the-survey-data-goes','How logging works')}
            </div>
          </div>

          <div class="scout-start">
            <h3>Before your first survey</h3>
            <ol>
              <li><span>1</span><p>Attach the antenna before power-on, then dock Scout Lite on the Flipper GPIO header.</p></li>
              <li><span>2</span><p>Put <code>sigroam-0.3.fap</code> in <code>SD Card/apps/GPIO/</code> on the Flipper.</p></li>
              <li><span>3</span><p>Set <strong>Settings → System → Log Device</strong> to <strong>Off</strong>. Open SigRoam’s Dashboard; <strong>OK</strong> starts and stops the survey.</p></li>
            </ol>
            ${outward(SOURCE.guide+'#better-wardriving-ui--sigroam','Full setup instructions')}
          </div>
        </section>
      </div>

      <section class="scout-limits" aria-labelledby="scout-limits-heading">
        <h2 id="scout-limits-heading">Know this before you go.</h2>
        <div><p>GPS-tagged rows need a GPS fix. SigRoam is receive-only; 5 GHz is for scanning. The dedicated SigRoam scanner firmware for Scout Lite is still unreleased.</p>${outward(SOURCE.guide,'Current hardware & firmware limits')}</div>
      </section>
      <footer class="scout-provenance">
        <p>Compiled by gadgets.sh from the makers’ documentation. Not hands-on tested or maker commissioned.</p>
        <div><span>Sources checked 16 Sep 2026</span>${outward(SOURCE.app,'SigRoam source')}${outward(SOURCE.guide,'Scout Lite source')}</div>
      </footer>
    </article>
  </main>`;
}
