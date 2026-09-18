import {readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makerDemoHTML,demoPartsMarkdown,demoCreditsMarkdown,DEMO_PROJECT_ID,DEMO_IMAGE_SLUG,DEMO_STORAGE_KEY,DEMO_SOURCES,DEMO_REVIEW_DATE} from '../src/maker-demo.mjs';
import {pilotBriefMarkdown} from '../src/pilot-brief.mjs';
import {createMakerDemoSharing,MAKER_DEMO_SHARING_FORMATS} from '../src/maker-demo-sharing.mjs';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const DEMO_IMAGE_PATH = 'assets/seeed-wio-tracker-l1.jpg';
export const DEMO_IMAGE_SHA256 = 'f8e8e7edfc74d34458ab4343f2d31ed984fb018a0c545d184521407fca238269';
export const DEMO_RENDER_MANIFEST_PATH = 'sharing/render-manifest.json';
export const DEMO_FILE_ALLOWLIST = Object.freeze([
  'index.html','maker-demo.css','maker-pilot.js','pilot-brief.mjs',DEMO_IMAGE_PATH,
  'downloads/wio-l1-parts.md','downloads/maker-pilot-brief.md','downloads/wio-l1-caption.txt','CREDITS.md','README.md','asset-manifest.json',
  DEMO_RENDER_MANIFEST_PATH,...Object.keys(MAKER_DEMO_SHARING_FORMATS).flatMap(format=>[`sharing/wio-l1-${format}.svg`,`sharing/wio-l1-${format}.png`])
]);
const IMAGE_SOURCE = 'https://media-cdn.seeedstudio.com/media/catalog/product/cache/bb49d3ec4ee05b6f018e93f896b8a25d/1/-/1-114993648-wio-tracker-l1.jpg';
const STORAGE_DECLARATION = "export const PILOT_BRIEF_STORAGE_KEY = 'gadgets.maker-pilot';";
const localPreviewURL = /(?:https?:)?\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?=[:/\s"')]|$)/i;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateDemoImage(image, bytes) {
  const expected = image?.path === `/${DEMO_IMAGE_PATH}` && image?.sha256 === DEMO_IMAGE_SHA256 &&
    image?.source === IMAGE_SOURCE && image?.sourcePage === DEMO_SOURCES.board && image?.credit === 'Seeed Studio' &&
    image?.width === 1400 && image?.height === 1050 && image?.license?.id === 'CC-BY-SA-4.0' &&
    image?.license?.label === 'CC BY-SA 4.0' && image?.license?.url === DEMO_SOURCES.license &&
    image?.license?.source === DEMO_SOURCES.licenseDeclaration && image?.license?.checked === DEMO_REVIEW_DATE &&
    image?.license?.changes === 'Original image file unchanged; resized for display.';
  if(!expected || sha256(bytes) !== DEMO_IMAGE_SHA256) throw new Error('Wio L1 image does not match the reviewed image and license allowlist.');
}

export function validateDemoSharing(files) {
  const {cards,caption}=createMakerDemoSharing();
  let manifest;
  try {manifest=JSON.parse(String(files.get(DEMO_RENDER_MANIFEST_PATH)));}catch {throw new Error('Sharing render manifest is unreadable.');}
  if(manifest?.schemaVersion!==1 || !Array.isArray(manifest.renders) || manifest.renders.length!==cards.length)throw new Error('Sharing render manifest requires all three formats.');
  const seen=new Set(),signature=Buffer.from([137,80,78,71,13,10,26,10]);
  for(const render of manifest.renders) {
    const card=cards.find(card=>card.format===render?.format);
    if(!card || seen.has(card.format))throw new Error('Sharing render manifest has an unexpected or duplicate format.');
    seen.add(card.format);
    if(render.width!==card.width || render.height!==card.height)throw new Error(`Sharing render dimensions changed: ${card.format}.`);
    const svg=files.get(`sharing/${card.filename}`);
    if(typeof svg!=='string' || sha256(svg)!==sha256(card.svg) || render.svgSHA256!==sha256(card.svg))throw new Error(`Stale sharing SVG render: ${card.format}. Re-render the current source.`);
    const png=files.get(`sharing/wio-l1-${card.format}.png`);
    if(!Buffer.isBuffer(png) || png.length<33 || !png.subarray(0,8).equals(signature) || png.readUInt32BE(8)!==13 || png.toString('ascii',12,16)!=='IHDR')throw new Error(`Invalid sharing PNG header: ${card.format}.`);
    if(png.readUInt32BE(16)!==card.width || png.readUInt32BE(20)!==card.height)throw new Error(`Sharing PNG dimensions changed: ${card.format}.`);
    if(typeof render.pngSHA256!=='string' || !/^[a-f0-9]{64}$/.test(render.pngSHA256) || sha256(png)!==render.pngSHA256)throw new Error(`Sharing PNG hash mismatch: ${card.format}.`);
  }
  if(files.get('downloads/wio-l1-caption.txt')!==caption+'\n')throw new Error('Sharing caption does not match the reviewed source.');
  return {sharingDesigns:cards.length};
}

function readmeMarkdown() {
  return `# gadgets.sh maker demo\n\nA standalone, reviewable one-page pitch with a real Wio Tracker L1 + Grove BME280 source example. This package has not been deployed.\n\n## View locally\n\nUnzip the archive, open a terminal in the extracted directory containing index.html, then run:\n\n\`\`\`sh\npython3 -m http.server 5187 --bind 127.0.0.1\n\`\`\`\n\nOpen http://127.0.0.1:5187/ in your browser. Stop the server with Ctrl+C. Serve the files over HTTP; opening index.html directly with file:// can block JavaScript modules. A current browser with native JavaScript modules and dialog support is required for the brief editor.\n\nIf viewing from the source repository, run from gadgets/:\n\n\`\`\`sh\nnode scripts/build-maker-demo.mjs\npython3 -m http.server 5187 --bind 127.0.0.1 --directory maker-demo-dist\n\`\`\`\n\n## Exact scope\n\n- Original gadgets.sh page layout, inline brand mark and system fonts.\n- One unchanged Seeed Studio Wio Tracker L1 image, with visible CC BY-SA 4.0 attribution and full source/license records. No other product images, remote fonts or video embeds.\n- One concise source example, direct official guide/store links and a downloadable Markdown parts reference. It is independent, not maker commissioned or hands-on tested. Hardware and firmware are not included.\n- One original photo-free sharing design in three sizes, as PNGs and editable SVGs, plus a caption linking to the original Seeed guide. The render manifest binds the PNGs to the exact source SVGs.\n- The proposed $750 production pilot and its scope; no checkout, booking or payment request. This demo is not the complete paid-pilot deliverable.\n- A three-field brief saved in this browser under ${DEMO_STORAGE_KEY}. Download or copy its Markdown to share it yourself. No hosted submission, network form request, tracking or analytics. Clear this site's browser storage to remove a saved draft.\n- Copying uses the browser clipboard when available and a selectable-text dialog otherwise. Storage failures still allow editing and exports. Without JavaScript, the source links and blank brief download remain usable.\n- All assets and downloads resolve relative to this folder, including when hosted in a subdirectory. Original source/store links require an internet connection.\n\n## Files\n\n- index.html and maker-demo.css: page and styling.\n- maker-pilot.js and pilot-brief.mjs: existing local brief utility. The storage key is isolated from the main preview; other behavior is unchanged.\n- assets/seeed-wio-tracker-l1.jpg: licensed photograph.\n- downloads/wio-l1-parts.md: example reference.\n- downloads/maker-pilot-brief.md: blank brief including proposed scope.\n- downloads/wio-l1-caption.txt: caption with accessories, guide credit and source-example status.\n- sharing/wio-l1-{feed,story,wide}.png and .svg: matching rendered images and editable vectors.\n- sharing/render-manifest.json: dimensions and SVG/PNG SHA-256 records.\n- CREDITS.md and asset-manifest.json: attribution, provenance and license evidence.\n\n## Publication handoff\n\nPublic URL: [insert the real URL after deployment].\n\nNo public URL or fake contact destination is embedded in the page. Deploy this folder as a static root after review, preserve CREDITS.md and the image attribution, and test the final URLs and downloads. Hosting and an actual brief-receiving channel still need to be chosen. Publication and outreach are separate actions.\n\nFor social metadata, configure og:url and og:image with the real public HTTPS page and sharing/wio-l1-wide.png destinations after deployment. Confirm the image URL is reachable externally. This package has no invented absolute metadata URL and does not produce dynamic previews for URL-encoded creator setups.\n\n## Sources and rights\n\nSee [CREDITS.md](./CREDITS.md). The photograph remains available under its stated CC BY-SA 4.0 license; no extra restrictions are imposed on it. Product names and attribution do not imply a partnership. Technical sources were reviewed ${DEMO_REVIEW_DATE}; source review does not establish hardware testing.\n`;
}

export async function createMakerDemoFiles(root = PROJECT_ROOT) {
  const [imageText,projectText,css,pilotJS,briefModule] = await Promise.all([
    readFile(resolve(root,'data/images.json'),'utf8'),readFile(resolve(root,'data/build-projects-2026-09-16.json'),'utf8'),
    readFile(resolve(root,'public/maker-demo.css'),'utf8'),readFile(resolve(root,'public/maker-pilot.js'),'utf8'),readFile(resolve(root,'src/pilot-brief.mjs'),'utf8')
  ]);
  const image = JSON.parse(imageText)[DEMO_IMAGE_SLUG];
  const project = JSON.parse(projectText).projects.find(item=>item.id === DEMO_PROJECT_ID);
  if(project?.guideURL !== DEMO_SOURCES.guide || project?.hardwareMatch !== 'exact-model' || project?.testedByUs !== false ||
    project?.coreCatalogSlugs?.length !== 1 || project?.coreCatalogSlugs?.[0] !== DEMO_IMAGE_SLUG ||
    project?.coreQuantities?.[DEMO_IMAGE_SLUG] !== 1) throw new Error('The reviewed project record has changed; review the demo before rebuilding.');
  // Read only the fixed approved path. Never resolve an arbitrary manifest path.
  const imageBytes = await readFile(resolve(root,'public',DEMO_IMAGE_PATH));
  validateDemoImage(image,imageBytes);
  if(briefModule.split(STORAGE_DECLARATION).length !== 2) throw new Error('Pilot storage declaration changed; review the isolated brief module.');
  const isolatedBriefModule = briefModule.replace(STORAGE_DECLARATION,`export const PILOT_BRIEF_STORAGE_KEY = '${DEMO_STORAGE_KEY}';`);
  const sharing=createMakerDemoSharing();
  const [renderManifest,...pngs]=await Promise.all([
    readFile(resolve(root,'assets/maker-demo-sharing/manifest.json'),'utf8'),
    ...sharing.cards.map(card=>readFile(resolve(root,`assets/maker-demo-sharing/wio-l1-${card.format}.png`)))
  ]);
  const files = new Map([
    ['index.html',makerDemoHTML({image,project})],['maker-demo.css',css],['maker-pilot.js',pilotJS],['pilot-brief.mjs',isolatedBriefModule],
    [DEMO_IMAGE_PATH,imageBytes],['downloads/wio-l1-parts.md',demoPartsMarkdown()],['downloads/maker-pilot-brief.md',pilotBriefMarkdown({})],
    ['CREDITS.md',demoCreditsMarkdown(image)],['README.md',readmeMarkdown()],
    ['asset-manifest.json',JSON.stringify({schemaVersion:1,sourceReviewedDate:DEMO_REVIEW_DATE,projectId:DEMO_PROJECT_ID,images:[{...image,path:DEMO_IMAGE_PATH}]},null,2)+'\n'],
    [DEMO_RENDER_MANIFEST_PATH,renderManifest],['downloads/wio-l1-caption.txt',sharing.caption+'\n'],
    ...sharing.cards.flatMap((card,index)=>[[`sharing/${card.filename}`,card.svg],[`sharing/wio-l1-${card.format}.png`,pngs[index]]])
  ]);
  validateMakerDemoFiles(files);
  return files;
}

export function validateMakerDemoFiles(files) {
  if([...files.keys()].sort().join('\n') !== [...DEMO_FILE_ALLOWLIST].sort().join('\n')) throw new Error('Demo file allowlist mismatch.');
  const html = String(files.get('index.html'));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  if(new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id.');
  const references = [];
  for(const [file,content] of files) {
    if(Buffer.isBuffer(content)) continue;
    const text = String(content);
    if(file !== 'README.md' && localPreviewURL.test(text)) throw new Error(`Local preview URL in ${file}.`);
    if(file.endsWith('.html')) {
      for(const match of text.matchAll(/\b(href|src|action|poster)="([^"]*)"/g)) references.push({file,url:match[2],asset:['src','poster'].includes(match[1])});
      if(/<(?:iframe|base)\b|\bsrcset=|\bon[a-z]+\s*=/i.test(text)) throw new Error('Unsupported embedded content or inline event handler.');
    }
    if(file.endsWith('.css')) {
      if(/@import|@font-face|\burl\(/i.test(text)) throw new Error('Demo CSS must not load external or unreviewed assets.');
    }
    if(/\.(?:js|mjs)$/.test(file)) {
      for(const match of text.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) references.push({file,url:match[1],asset:true});
      if(/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/.test(text)) throw new Error('The local brief must not submit network requests.');
    }
    if(file.endsWith('.md')) for(const match of text.matchAll(/\]\(([^)]+)\)/g)) references.push({file,url:match[1],asset:false});
  }
  for(const {file,url,asset} of references) {
    const value = url.replace(/&amp;/g,'&');
    if(/^https:\/\//.test(value)) {
      if(asset) throw new Error(`Remote asset in ${file}.`);
      const parsed = new URL(value);
      if(parsed.username || parsed.password) throw new Error('Credential-bearing external link.');
      continue;
    }
    if(!value || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.includes('\\')) throw new Error(`Invalid local link in ${file}: ${value}`);
    const [pathWithQuery,fragment] = value.split('#');
    const path = decodeURIComponent(pathWithQuery.split('?')[0]);
    const target = path ? posix.normalize(posix.join(posix.dirname(file),path)) : file;
    if(target.startsWith('../') || !files.has(target)) throw new Error(`Broken local link in ${file}: ${value}`);
    if(fragment !== undefined && (!fragment || target !== 'index.html' || !ids.includes(decodeURIComponent(fragment)))) throw new Error(`Broken fragment in ${file}: ${value}`);
  }
  const manifest = JSON.parse(String(files.get('asset-manifest.json')));
  const image = manifest.images?.[0];
  if(manifest.images?.length !== 1) throw new Error('Exactly one reviewed image is allowed.');
  validateDemoImage({...image,path:`/${image?.path}`},files.get(DEMO_IMAGE_PATH));
  for(const required of ['Seeed Studio',DEMO_SOURCES.board,DEMO_SOURCES.license,'CC BY-SA 4.0','Original file unchanged; resized for display.']) {
    if(!html.includes(required)) throw new Error(`Missing visible image attribution: ${required}`);
  }
  const credits = String(files.get('CREDITS.md'));
  for(const required of [IMAGE_SOURCE,DEMO_SOURCES.licenseDeclaration,DEMO_SOURCES.license,DEMO_IMAGE_SHA256,'Original image file unchanged; resized for display.']) {
    if(!credits.includes(required)) throw new Error(`Missing packaged attribution: ${required}`);
  }
  return {files:files.size,images:1,...validateDemoSharing(files),localReferences:references.filter(ref=>!ref.url.startsWith('https://')).length};
}

async function writeDefaultDemo() {
  const files = await createMakerDemoFiles();
  const output = resolve(PROJECT_ROOT,'maker-demo-dist');
  const zip = resolve(PROJECT_ROOT,'maker-demo.zip');
  // Refuse to erase unexpected content in the owned output directory.
  try {
    const present = await readdir(output,{recursive:true,withFileTypes:true});
    for(const entry of present) {
      if(entry.isSymbolicLink()) throw new Error('Refusing to replace symlinked demo output.');
      const parent = entry.parentPath ?? entry.path;
      const relative = posix.join(parent.slice(output.length + 1),entry.name);
      const permittedDirectory = entry.isDirectory() && ['assets','downloads','sharing'].includes(relative);
      if(!permittedDirectory && !DEMO_FILE_ALLOWLIST.includes(relative)) throw new Error(`Unexpected output file: ${relative}`);
    }
  } catch(error) {if(error.code !== 'ENOENT') throw error;}
  await rm(output,{recursive:true,force:true});
  for(const [file,content] of files) {const path=resolve(output,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,content);}
  await rm(zip,{force:true});
  execFileSync('zip',['-X','-q',zip,...DEMO_FILE_ALLOWLIST],{cwd:output});
  execFileSync('unzip',['-tqq',zip]);
  console.log(JSON.stringify({output,zip,...validateMakerDemoFiles(files)},null,2));
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeDefaultDemo().catch(error=>{console.error(error.message);process.exitCode=1;});
}
