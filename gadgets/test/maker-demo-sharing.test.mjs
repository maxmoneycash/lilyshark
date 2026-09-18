import test from 'node:test';
import assert from 'node:assert/strict';
import {createMakerDemoSharing} from '../src/maker-demo-sharing.mjs';
import {DEMO_SOURCES} from '../src/maker-demo.mjs';

test('exports the three delivery dimensions and distinct vector filenames',()=>{
  const {cards}=createMakerDemoSharing();
  assert.deepEqual(cards.map(({format,width,height,filename})=>({format,width,height,filename})),[
    {format:'feed',width:1080,height:1350,filename:'wio-l1-feed.svg'},
    {format:'story',width:1080,height:1920,filename:'wio-l1-story.svg'},
    {format:'wide',width:1200,height:630,filename:'wio-l1-wide.svg'}
  ]);
  for(const card of cards)assert.ok(card.svg.includes(`viewBox="0 0 ${card.width} ${card.height}"`));
});

test('each exported card preserves exact core identity and visible evidence limits',()=>{
  for(const {svg} of createMakerDemoSharing().cards) {
    const visible=[...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map(match=>match[1]);
    for(const value of ['Wio Tracker L1','OLED base model','Grove BME280','Guide by Seeed Studio','Independent source example','Not hands-on tested or commissioned.'])assert.ok(visible.includes(value),value);
    assert.equal(visible.filter(value=>value==='1×').length,2);
    assert.ok(svg.includes('<title id="card-title">'));
    assert.ok(svg.includes('<desc id="card-description">'));
    assert.doesNotMatch(svg,/\b(?:tested build|client project|verified build|our build|discount|buy now)\b/i);
  }
});

test('vectors are self-contained geometry and system text with no active or remote resources',()=>{
  for(const {svg} of createMakerDemoSharing().cards) {
    assert.doesNotMatch(svg,/<(?:image|script|style|foreignObject|iframe|a|use|animate|set)\b|\b(?:href|src|onload|onclick)=|@font-face|url\(|data:/i);
    assert.deepEqual(svg.match(/https?:\/\/[^"<> ]+/g),['http://www.w3.org/2000/svg']);
    assert.match(svg,/font-family="system-ui,/);
    assert.match(svg,/fill="#d5f582"/);
    assert.match(svg,/fill="#18201b"/);
  }
});

test('every text run has explicit advance bounds, safe margins and no text collisions',()=>{
  for(const {width,height,svg,textBounds} of createMakerDemoSharing().cards) {
    assert.equal((svg.match(/<text\b/g)||[]).length,textBounds.length);
    assert.equal((svg.match(/lengthAdjust="spacingAndGlyphs"/g)||[]).length,textBounds.length);
    for(const box of textBounds) {
      assert.ok(box.width>0 && box.fontSize>=20,box.id);
      assert.ok(box.x>=40 && box.y>=30 && box.x+box.width<=width-40 && box.y+box.height<=height-30,box.id);
      assert.ok(svg.includes(`data-text="${box.id}"`));
    }
    for(let i=0;i<textBounds.length;i++)for(let j=i+1;j<textBounds.length;j++) {
      const a=textBounds[i],b=textBounds[j];
      const overlap=a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
      assert.equal(overlap,false,`${a.id} and ${b.id} overlap`);
    }
  }
});

test('caption carries source credit, required extras and one original guide URL',()=>{
  const {caption}=createMakerDemoSharing();
  for(const phrase of ['Seeed Studio','1× Wio Tracker L1 (OLED base model)','1× Grove BME280','Grove cable','suitable power','band-matched antenna','USB data cable','computer and phone','another configured node','Not hands-on tested or commissioned.'])assert.ok(caption.includes(phrase),phrase);
  assert.deepEqual(caption.match(/https?:\/\/\S+/g),[DEMO_SOURCES.guide]);
  assert.ok(caption.length<850);
  assert.doesNotMatch(caption,/localhost|127\.0\.0\.1|example\.com|utm_|affiliate|discount|\$750|we built|our hardware/i);
});

test('generating a later export cannot retain mutations to an earlier result',()=>{
  const first=createMakerDemoSharing(),expected=createMakerDemoSharing();
  first.cards[0].textBounds[0].text='Changed';first.cards[0].svg='Changed';first.caption='Changed';
  assert.deepEqual(createMakerDemoSharing(),expected);
});
