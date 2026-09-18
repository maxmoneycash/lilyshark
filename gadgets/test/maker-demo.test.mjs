import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createMakerDemoFiles,validateMakerDemoFiles,validateDemoImage,validateDemoSharing,DEMO_RENDER_MANIFEST_PATH,DEMO_FILE_ALLOWLIST,DEMO_IMAGE_PATH,DEMO_IMAGE_SHA256,PROJECT_ROOT} from '../scripts/build-maker-demo.mjs';
import {DEMO_STORAGE_KEY,DEMO_SOURCES} from '../src/maker-demo.mjs';
import {createMakerDemoSharing} from '../src/maker-demo-sharing.mjs';

const files = await createMakerDemoFiles();
const html = String(files.get('index.html'));
const manifest = JSON.parse(files.get('asset-manifest.json'));

test('the package contains one unchanged licensed photograph and exactly three rendered sharing designs',()=>{
  assert.deepEqual([...files.keys()].sort(),[...DEMO_FILE_ALLOWLIST].sort());
  assert.deepEqual([...files.keys()].filter(path=>/\.(?:jpe?g|png|webp|woff2?|ttf|mp4)$/i.test(path)).sort(),[DEMO_IMAGE_PATH,'sharing/wio-l1-feed.png','sharing/wio-l1-story.png','sharing/wio-l1-wide.png'].sort());
  assert.equal(createHash('sha256').update(files.get(DEMO_IMAGE_PATH)).digest('hex'),DEMO_IMAGE_SHA256);
  assert.equal(manifest.images.length,1);
  assert.match(html,/object-fit|<img /);
  assert.doesNotMatch(html,/<(?:iframe|video)\b|scout-lite|seeed-xiao/i);
});

test('uncleared image metadata or changed bytes fail closed',()=>{
  const image={...manifest.images[0],path:`/${DEMO_IMAGE_PATH}`},bytes=files.get(DEMO_IMAGE_PATH);
  assert.doesNotThrow(()=>validateDemoImage(image,bytes));
  for(const changed of [
    {...image,path:'/assets/scout-lite.jpg'}, {...image,credit:'Unknown'}, {...image,source:'https://example.com/photo.jpg'},
    {...image,license:null}, {...image,license:{...image.license,id:'unknown'}}, {...image,license:{...image.license,source:''}}
  ]) assert.throws(()=>validateDemoImage(changed,bytes),/allowlist/);
  assert.throws(()=>validateDemoImage(image,Buffer.from('replacement image')),/allowlist/);
});

test('all page, module and Markdown local references resolve at the artifact root',()=>{
  const result=validateMakerDemoFiles(files);
  assert.equal(result.files,18);
  assert.equal(result.sharingDesigns,3);
  assert.ok(result.localReferences>10);
  for(const bad of ['./missing.html','#missing','/hardware/','../private.md']) {
    const modified=new Map(files);modified.set('index.html',html.replace('href="#example"',`href="${bad}"`));
    assert.throws(()=>validateMakerDemoFiles(modified),/local link|fragment/);
  }
  const brokenModule=new Map(files);brokenModule.set('maker-pilot.js',String(files.get('maker-pilot.js')).replace('./pilot-brief.mjs','./missing.mjs'));
  assert.throws(()=>validateMakerDemoFiles(brokenModule),/local link/);
});

test('visible and packaged attribution are mandatory, including source and license',()=>{
  for(const [file,required] of [['index.html','CC BY-SA 4.0'],['index.html','Original file unchanged; resized for display.'],['CREDITS.md',DEMO_SOURCES.licenseDeclaration],['CREDITS.md',DEMO_IMAGE_SHA256]]) {
    const modified=new Map(files);modified.set(file,String(files.get(file)).replace(required,''));
    assert.throws(()=>validateMakerDemoFiles(modified),/attribution/);
  }
});

test('public content rejects preview URLs, remote assets and submission code',()=>{
  for(const url of ['http://127.0.0.1:54644/','http://localhost:5187/','http://[::1]:5187/']) {
    const modified=new Map(files);modified.set('index.html',html.replace('href="#example"',`href="${url}"`));
    assert.throws(()=>validateMakerDemoFiles(modified),/Local preview URL/);
  }
  const remote=new Map(files);remote.set('index.html',html.replace('./assets/seeed-wio-tracker-l1.jpg','https://www.seeedstudio.com/unreviewed.jpg'));
  assert.throws(()=>validateMakerDemoFiles(remote),/Remote asset/);
  const submit=new Map(files);submit.set('maker-pilot.js',files.get('maker-pilot.js')+'\nfetch("https://example.com");');
  assert.throws(()=>validateMakerDemoFiles(submit),/network requests/);
  const extra=new Map(files);extra.set('assets/another.jpg',Buffer.from('image'));
  assert.throws(()=>validateMakerDemoFiles(extra),/allowlist/);
  assert.match(String(files.get('README.md')),/python3 -m http\.server/);
  assert.match(String(files.get('README.md')),/Public URL: \[insert the real URL after deployment\]/);
  assert.doesNotMatch(html,/example\.com|insert the real URL|action=|mailto:|Buy now|Book now/);
});

test('the three-field brief reuses the existing behavior with isolated local persistence',async()=>{
  assert.equal(files.get('maker-pilot.js'),await readFile(resolve(PROJECT_ROOT,'public/maker-pilot.js'),'utf8'));
  const mainModule=await readFile(resolve(PROJECT_ROOT,'src/pilot-brief.mjs'),'utf8');
  const packagedModule=String(files.get('pilot-brief.mjs'));
  assert.equal(packagedModule,mainModule.replace("'gadgets.maker-pilot'",`'${DEMO_STORAGE_KEY}'`));
  const form=html.match(/<form id="maker-pilot-form"[\s\S]*?<\/form>/)[0];
  assert.deepEqual([...form.matchAll(/\bname="([^"]+)"/g)].map(match=>match[1]),['company','productURL','outcome']);
  for(const id of ['pilot-fields','pilot-save-state','pilot-action-state','pilot-form-error','pilot-copy','pilot-download','pilot-copy-dialog','pilot-copy-text']) assert.ok(html.includes(`id="${id}"`));
  for(const field of ['company','productURL','outcome']) assert.ok(form.includes(`aria-describedby="pilot-${field}-error"`));
  assert.match(form,/<fieldset id="pilot-fields" disabled>/);
  const module=await import(`data:text/javascript;base64,${Buffer.from(packagedModule).toString('base64')}`);
  assert.equal(module.PILOT_BRIEF_STORAGE_KEY,DEMO_STORAGE_KEY);
  const valid=module.validatePilotBrief({company:'Bench & Co',productURL:'https://www.seeedstudio.com/Wio-Tracker-L1-p-6453.html',outcome:'Make a sensor node.\nKeep the exact board revision.'});
  assert.equal(valid.valid,true);
  assert.match(module.pilotBriefMarkdown(valid.brief),/Make a sensor node\.\n    Keep the exact board revision\./);
  assert.equal(module.validatePilotBrief({company:'Bench',productURL:'javascript:alert(1)',outcome:'Build a node'}).valid,false);
});

test('example and brief downloads carry independent status and the scoped proposed price',()=>{
  const parts=String(files.get('downloads/wio-l1-parts.md'));
  assert.match(parts,/1 × \[Wio Tracker L1, OLED model\]/);
  assert.match(parts,/1 × \[Grove BME280\]/);
  assert.match(parts,/Not hands-on tested or maker commissioned/);
  assert.ok(parts.includes(DEMO_SOURCES.guide));
  const brief=String(files.get('downloads/maker-pilot-brief.md'));
  assert.match(brief,/Nothing has been submitted, booked or paid/);
  assert.match(brief,/Proposed scope — \$750 one time/);
  assert.match(brief,/Five working days of production after complete materials and scope agreement/);
  assert.match(brief,/includes no reach or sales guarantee/);
  assert.match(html,/Proposed one-time pilot/);
});

test('the page exposes all actual sharing downloads and the exact caption',()=>{
  assert.match(html,/<section id="sharing"/);
  assert.match(html,/<img src="\.\/sharing\/wio-l1-wide\.png" width="1200" height="630"/);
  for(const {filename,svg} of createMakerDemoSharing().cards) {
    assert.equal(files.get(`sharing/${filename}`),svg);
    for(const file of [filename,filename.replace('.svg','.png')])assert.ok(html.includes(`href="./sharing/${file}" download`));
  }
  assert.equal(files.get('downloads/wio-l1-caption.txt'),createMakerDemoSharing().caption+'\n');
  assert.ok(html.includes('href="./downloads/wio-l1-caption.txt" download'));
  assert.match(String(files.get('README.md')),/real public HTTPS/);
  assert.doesNotMatch(html,/<meta[^>]+(?:og:url|og:image)/);
});

test('changed SVGs and stale render records are rejected before packaging',()=>{
  const changedSVG=new Map(files);
  changedSVG.set('sharing/wio-l1-feed.svg',String(files.get('sharing/wio-l1-feed.svg')).replace('Environmental','Changed'));
  assert.throws(()=>validateDemoSharing(changedSVG),/Stale sharing SVG render/);
  const stale=new Map(files),record=JSON.parse(String(files.get(DEMO_RENDER_MANIFEST_PATH)));
  record.renders[0].svgSHA256='0'.repeat(64);stale.set(DEMO_RENDER_MANIFEST_PATH,JSON.stringify(record));
  assert.throws(()=>validateDemoSharing(stale),/Stale sharing SVG render/);
  const changedCaption=new Map(files);changedCaption.set('downloads/wio-l1-caption.txt','Replacement caption');
  assert.throws(()=>validateDemoSharing(changedCaption),/caption does not match/);
});

test('PNG signature, IHDR dimensions and byte hashes must all match the reviewed render',()=>{
  const path='sharing/wio-l1-feed.png';
  for(const [mutate,error] of [
    [png=>{png[0]=0;},/Invalid sharing PNG header/],
    [png=>{png.writeUInt32BE(12,8);},/Invalid sharing PNG header/],
    [png=>{png.write('NOPE',12,'ascii');},/Invalid sharing PNG header/],
    [png=>{png.writeUInt32BE(1081,16);},/Sharing PNG dimensions/],
    [png=>{png[png.length-1]^=1;},/Sharing PNG hash mismatch/]
  ]) {
    const modified=new Map(files),png=Buffer.from(files.get(path));mutate(png);modified.set(path,png);
    assert.throws(()=>validateDemoSharing(modified),error);
  }
  for(const invalid of [Buffer.alloc(20),'not a buffer',undefined]) {
    const modified=new Map(files);modified.set(path,invalid);
    assert.throws(()=>validateDemoSharing(modified),/Invalid sharing PNG header/);
  }
});

test('render manifest cannot omit, duplicate or change format dimensions',()=>{
  for(const mutate of [
    record=>{record.schemaVersion=2;},
    record=>{record.renders.pop();},
    record=>{record.renders[1]=record.renders[0];},
    record=>{record.renders[0].format='unknown';},
    record=>{record.renders[0].width=1;}
  ]) {
    const modified=new Map(files),record=JSON.parse(String(files.get(DEMO_RENDER_MANIFEST_PATH)));
    mutate(record);modified.set(DEMO_RENDER_MANIFEST_PATH,JSON.stringify(record));
    assert.throws(()=>validateDemoSharing(modified),/Sharing render/);
  }
});
