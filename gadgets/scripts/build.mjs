import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as templates from '../src/templates.mjs';
import { categories, statuses, tasks, formats, capabilities } from '../src/catalog.mjs';
import { guides, comparisons } from '../src/guides.mjs';
import { collections } from '../src/discovery.mjs';
import { validateDeviceDetails } from '../src/device-details.mjs';
import { validateOffers, currentOffers } from '../src/offers.mjs';
import { validateAffiliates } from '../src/affiliates.mjs';
import { validateListings } from '../src/listings.mjs';
import {validateBuildProjects} from '../src/build-projects.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// GADGETS_DIST lets a test build somewhere else instead of racing the shared dist directory.
const dist = process.env.GADGETS_DIST ? path.resolve(process.env.GADGETS_DIST) : path.join(root, 'dist');
const devices = JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
const images = JSON.parse(await fs.readFile(path.join(root,'data/images.json'),'utf8'));
const details = JSON.parse(await fs.readFile(path.join(root,'data/device-details.json'),'utf8'));
const offers = JSON.parse(await fs.readFile(path.join(root,'data/offers.json'),'utf8'));
const affiliates = validateAffiliates(JSON.parse(await fs.readFile(path.join(root,'data/affiliates.json'),'utf8')));
const listings = validateListings(JSON.parse(await fs.readFile(path.join(root,'data/listings.json'),'utf8')),devices);
// The checkout worker URL; empty on previews without one, which hides checkout.
const buyEndpoint = process.env.GADGETS_BUY_ENDPOINT || '';
templates.setBuyEndpoint(buyEndpoint);
const siteOrigin=(process.env.GADGETS_SITE_ORIGIN || 'https://gadgets.sh').replace(/\/$/,'');
templates.setSiteOrigin(siteOrigin);
validateDeviceDetails(devices, details);
validateOffers(offers,devices);
const projectData=JSON.parse(await fs.readFile(path.join(root,'data/build-projects-2026-09-16.json'),'utf8'));
const {projects,errors:projectErrors}=validateBuildProjects(projectData,devices);
if(projectErrors.length)throw new Error(projectErrors.join(' '));
const slugs = new Set();
for (const d of devices) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug) || slugs.has(d.slug)) throw new Error(`Invalid or duplicate slug: ${d.slug}`);
  slugs.add(d.slug);
  if (!(d.category in categories) || !(d.status in statuses)) throw new Error(`Invalid facet: ${d.slug}`);
  if (!d.usage || !(d.usage.format in formats) || !d.usage.tasks.every(t=>t in tasks) || !d.usage.capabilities.every(c=>c in capabilities)) throw new Error(`Invalid usage metadata: ${d.slug}`);
  for (const url of [d.source, ...(d.extraSources || []).map(s => s.url)].filter(Boolean)) {
    if (!/^https:\/\//.test(url)) throw new Error(`Non-HTTPS source: ${d.slug}`);
  }
  if (d.verified && (!d.checked || !d.source || !d.verificationNotes?.length)) throw new Error(`Missing source-check evidence: ${d.slug}`);
  const image = images[d.slug];
  if (image) {
    if (!/^\/assets\/[a-z0-9-]+\.(?:png|jpg|webp|avif)$/.test(image.path) || ![image.source, image.sourcePage].every(url => /^https:\/\//.test(url)) || !image.credit || !image.caption || !(image.width > 0 && image.height > 0)) throw new Error(`Invalid image provenance: ${d.slug}`);
    Object.assign(d, { image: image.path, imageSource: image.source, imageSourcePage: image.sourcePage, imageCaption: image.caption, imageCredit: image.credit, imageWidth: image.width, imageHeight: image.height });
    if(image.license){
      if(image.license.id!=='CC-BY-SA-4.0' || image.license.url!=='https://creativecommons.org/licenses/by-sa/4.0/' || !/^https:\/\//.test(image.license.source) || !image.license.changes)throw new Error(`Incomplete image license: ${d.slug}`);
      d.imageLicense={...image.license};
    }
    await fs.access(path.join(root, 'public', d.image));
  }
}
for (const c of collections) if (!c.devices.every(id=>slugs.has(id)) || !slugs.has(c.cover)) throw new Error(`Unknown collection device: ${c.slug}`);
await fs.rm(dist, {recursive:true, force:true});
await fs.mkdir(dist, {recursive:true});
await fs.cp(path.join(root, 'public'), dist, {recursive:true});
await fs.copyFile(path.join(root,'src/catalog.mjs'),path.join(dist,'catalog.mjs'));
await fs.copyFile(path.join(root,'src/templates.mjs'),path.join(dist,'templates.mjs'));
await fs.copyFile(path.join(root,'src/guides.mjs'),path.join(dist,'guides.mjs'));
for(const name of ['kits.mjs','discovery.mjs','workbench.mjs','capture-demo.mjs','carousel-window.mjs','maker-pilot.mjs','pilot-brief.mjs','scout-companion.mjs','offers.mjs','build-finder.mjs','build-setup.mjs','build-projects.mjs','inventory.mjs','inventory-page.mjs','listings.mjs','catalog-visit.mjs','setup-card.mjs','share-links.mjs']) await fs.copyFile(path.join(root,'src',name),path.join(dist,name));
await fs.copyFile(path.join(root,'tokens.css'),path.join(dist,'tokens.css'));
await fs.writeFile(path.join(dist,'catalog.json'),JSON.stringify(devices));
const pages = new Map([
  ['/',templates.homePage(devices)],['/hardware/',templates.catalogPage(devices)],['/builds/',templates.buildsPage(devices,projects)],['/builds/lilyshark/',templates.buildPage(devices)],['/for-makers/',templates.makerPilotPage(devices)],['/builds/scout-lite/',templates.scoutCompanionPage(devices)],['/setup/',templates.kitPage()],['/kit/',templates.kitPage()],
  ['/collections/',templates.collectionsPage(devices)],...collections.map(c=>[`/collections/${c.slug}/`,templates.collectionPage(c,devices)]),['/saved/',templates.savedPage()],
  ['/compare/',templates.comparePage()],['/about/',templates.aboutPage(devices)],
  ['/firmware/lilyshark/',templates.firmwarePage()],
  ['/guides/',templates.guidesPage()],
  ...guides.map(g=>[`/guides/${g.slug}/`,templates.guidePage(g,devices)]),
  ...comparisons.map(c=>[`/comparisons/${c.slug}/`,templates.comparePage({...c,devices:c.devices.map(slug=>devices.find(d=>d.slug===slug))})]),
  ...devices.map(d=>[`/devices/${d.slug}/`,templates.detailPage(d,devices,details[d.slug],currentOffers(offers,d.slug),projects,affiliates,listings)]),
  ['/buy/thanks/',templates.buyThanksPage()]
]);
for (const [route, html] of pages) {
  const dir = path.join(dist,route);
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'index.html'),html);
}

// Search engines cannot rank pages they never find; a catalog lives or dies on this.
const today = new Date().toISOString().slice(0,10);
const priority = route => route === '/' ? '1.0' : route.startsWith('/devices/') ? '0.8' : route.startsWith('/guides/') || route.startsWith('/comparisons/') ? '0.7' : '0.5';
const urls = [...pages.keys()]
  .filter(route => !route.startsWith('/buy/'))
  .map(route => `  <url><loc>${siteOrigin}${route}</loc><lastmod>${today}</lastmod><priority>${priority(route)}</priority></url>`)
  .join('\n');
await fs.writeFile(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
await fs.writeFile(path.join(dist,'404.html'),templates.layout({title:'Device not found',description:'This device is not in the collection yet.',page:'notfound',active:'',body:'<main id="main" class="essay"><p class="eyebrow">404 / UNKNOWN DEVICE</p><h1>Off the map.</h1><p>That page is not in this collection.</p><a class="primary-button" href="/">Back to the gallery →</a></main>'}));
// The preview must not be indexed before the sources, image permissions and domain are ready.
// Set GADGETS_PUBLIC=1 when deploying the real site to allow crawling and advertise the sitemap.
await fs.writeFile(path.join(dist,'robots.txt'), process.env.GADGETS_PUBLIC === '1'
  ? `User-agent: *\nAllow: /\nDisallow: /buy/\n\nSitemap: ${siteOrigin}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n');
console.log(`Built ${pages.size} pages and ${devices.length} device records in gadgets/dist.`);
