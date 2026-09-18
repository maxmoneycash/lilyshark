import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeKit, kitURL, remixKit} from '../src/kits.mjs';
import {SETUP_CARD_FORMATS, SETUP_CARD_PHOTO_LIMITS, createSetupCardModel, setupCardCaption, setupCardPostCaption, setupCardCaptionCount, planSetupCard, wrapCardText, setupCardFilename, validateSetupCardPhotoFile, validateSetupCardPhotoDimensions, setupCardPhotoPlacement} from '../src/setup-card.mjs';

const catalog=Array.from({length:6},(_,i)=>({slug:`part-${i}`,name:`Maker ${i} hardware development board`,image:`https://example.com/photo-${i}.jpg`,description:'Unrelated product claim'}));
const makeModel=(input,devices=catalog)=>{
  const kit=normalizeKit(input,devices);
  return createSetupCardModel({kit,catalog:devices,shareURL:new URL(kitURL(kit),'https://gadgets.example').href});
};
const measure=(text,size)=>Array.from(text).reduce((width,char)=>width+(/[MW]/.test(char)?.85:/\s/.test(char)?.3:.57)*size,0);

test('caption preserves the exact stateful URL, quantities, planning states and full creator notes',()=>{
  const model=makeModel({name:'Field kit',author:'@builder',devices:['part-5','part-1'],story:'Plan for next week.\nStill testing the enclosure.',parts:'Printed clip\nCustom wiring',
    items:{'part-5':{quantity:2,state:'have',note:'One on each end\nCheck the antenna'},'part-1':{quantity:3,state:'need'}}});
  assert.deepEqual(model.parts.map(part=>[part.slug,part.quantity,part.state]),[['part-5',2,'Have it'],['part-1',3,'Need it']]);
  assert.match(model.caption,/2 × Maker 5 hardware development board — Have it/);
  assert.ok(model.caption.includes('Creator’s build notes:\nPlan for next week.\nStill testing the enclosure.'));
  assert.ok(model.caption.includes('Creator’s part note: One on each end\nCheck the antenna'));
  assert.ok(model.caption.includes('Other parts & modifications — creator’s notes:\nPrinted clip\nCustom wiring'));
  assert.ok(model.caption.includes(model.shareURL));
  assert.equal(model.caption.split(model.shareURL).length,2);
  assert.ok(!model.caption.includes('Unrelated product claim'));
  assert.ok(!JSON.stringify(model).includes('photo-5.jpg'));
});

test('short post text stays concise while the full details API retains the exact snapshot and notes',()=>{
  const model=makeModel({name:'Field kit',author:'@builder',devices:catalog.map(device=>device.slug),story:'Working on the printed enclosure. '.repeat(30),
    parts:'A custom antenna\nTwo brackets',project:'https://maker.example/build-log',items:{'part-0':{note:'Keep this complete part note.',quantity:2,state:'have'}}});
  assert.ok(model.postText.startsWith('Field kit\n\nBuild note: Working on'));
  assert.ok(model.postText.endsWith('…'));
  assert.ok(setupCardCaptionCount(model.postText)<200);
  assert.equal(model.postCaption,setupCardPostCaption(model));
  assert.equal(model.postCredits,'By @builder');
  assert.equal(model.postCaption,model.postText+'\n\nBy @builder');
  assert.ok(!model.postCaption.includes(model.shareURL));
  assert.ok(!model.postCaption.includes(model.project));
  assert.equal(model.caption,setupCardCaption(model));
  assert.ok(model.caption.includes(model.shareURL));
  assert.ok(model.caption.includes(model.story));
  assert.ok(model.caption.includes('Keep this complete part note.'));
  assert.ok(model.caption.includes(model.project));
  for(const format of Object.keys(SETUP_CARD_FORMATS)){
    const footer=planSetupCard(model,format,measure).commands.find(command=>command.id==='footer');
    assert.equal(footer.lines.join(' '),'Parts & notes in the setup link');
  }
});

test('editing post text preserves every credit without changing the setup, full details or long links',()=>{
  const model=makeModel({name:'Third build',author:'@third',from:'Second build by @second',origin:'First build by @first',devices:['part-0'],story:'Original notes.'});
  const before=structuredClone(model),edited='My revised caption.\nA second line.';
  assert.equal(setupCardPostCaption(model,edited),edited+'\n\nBy @third\nRemixed from: Second build by @second\nEarliest known credit: First build by @first');
  assert.equal(setupCardPostCaption(model,''),model.postCredits);
  const longText='📻'.repeat(1200)+'\n'+model.shareURL;
  assert.ok(setupCardPostCaption(model,longText).startsWith(longText+'\n\n'));
  assert.deepEqual(model,before);
  const sameCredit=makeModel({name:'Remix',from:'First build by @first',origin:'First build by @first',devices:['part-0']});
  assert.equal(sameCredit.postCredits,'Remixed from: First build by @first');
  assert.equal(setupCardPostCaption(sameCredit,'My text').split('First build by @first').length,2);
  const unnamed=makeModel({name:'One part',devices:['part-0']});
  assert.equal(unnamed.postText,'One part');assert.equal(unnamed.postCredits,'');assert.equal(unnamed.postCaption,'One part');
});

test('caption counting states its Unicode basis and custom-only/local snapshots remain honest',()=>{
  assert.equal(setupCardCaptionCount('A📻\n界'),4);
  assert.equal(setupCardCaptionCount('👩🏽‍🔧'),4);
  assert.equal(setupCardCaptionCount('e\u0301'),2);
  const kit=normalizeKit({name:'Custom coil',parts:'A hand-wound coil\nPrinted mounts'},catalog);
  const shareURL='http://127.0.0.1:54644/setup/#kit=v1.'+'a'.repeat(20000);
  const model=createSetupCardModel({kit,catalog,shareURL});
  assert.equal(model.postText,'Custom coil\n\nBuild note: A hand-wound coil Printed mounts');
  assert.equal(model.shareURL,shareURL);
  assert.ok(model.caption.includes(shareURL));
  assert.match(model.caption,/Local preview link — it only opens on this computer\./);
  assert.ok(!model.postCaption.includes(shareURL));
  assert.ok(!model.postCaption.includes('link in bio'));
});

test('multiple remixes retain earliest known and immediate credit, even without a named current creator',()=>{
  const original=normalizeKit({name:'Original bench',author:'@first',devices:['part-0']},catalog);
  const next=normalizeKit({...remixKit(original,catalog),name:'Second bench',author:'@second'},catalog);
  const model=makeModel(remixKit(next,catalog));
  assert.equal(model.credit,'');
  assert.ok(!model.caption.includes('Creator not named'));
  assert.ok(!planSetupCard(model,'feed',measure).commands.some(command=>command.id==='credit'));
  assert.equal(model.from,'Second bench by @second');
  assert.equal(model.origin,'Original bench by @first');
  assert.match(model.caption,/Remixed from: Second bench by @second/);
  assert.match(model.caption,/Earliest known credit: Original bench by @first/);
  assert.equal(model.parts[0].state,'Considering');
  const firstRemix=makeModel(remixKit(original,catalog));
  assert.equal(firstRemix.caption.split('Original bench by @first').length,2);
});

test('long titles, part names and multiline notes stay within every format’s text boxes',()=>{
  const longCatalog=catalog.map(device=>({...device,name:'A very long hardware name with an unusually detailed edition label '+ 'W'.repeat(180)}));
  const model=makeModel({name:'W'.repeat(64),author:'W'.repeat(40),devices:catalog.map(device=>device.slug),story:Array(40).fill('Multiple lines of the creator’s actual note.').join('\n'),parts:'Custom component '.repeat(20),items:{'part-0':{quantity:99,state:'considering'}}},longCatalog);
  for(const [format,dimensions] of Object.entries(SETUP_CARD_FORMATS)){
    const plan=planSetupCard(model,format,measure);
    assert.deepEqual([plan.width,plan.height],[dimensions.width,dimensions.height]);
    assert.equal(plan.commands.filter(command=>command.id?.startsWith('part-')).length,6);
    assert.equal(plan.commands.find(command=>command.id==='quantity-0').lines[0],'99×');
    assert.ok(plan.overflow.includes('part-0'));
    assert.ok(plan.overflow.includes('note'));
    for(const command of plan.commands){
      assert.ok(command.x>=0 && command.y>=0,`${format}: positive coordinates`);
      assert.ok(command.x+command.width<=plan.width,`${format}: ${command.id} fits width`);
      if(command.height!==undefined)assert.ok(command.y+command.height<=plan.height,`${format}: ${command.id} fits height`);
      if(command.type==='text'){
        assert.ok(command.lines.length*command.lineHeight<=command.height);
        for(const line of command.lines)assert.ok(measure(line,command.size,command.weight)<=command.width,`${format}: ${command.id} bounded line`);
      }
    }
  }
  assert.ok(model.caption.includes(longCatalog[0].name),'caption retains unshortened names');
});

test('custom-only builds keep freeform parts as creator notes without inventing counts or quantities',()=>{
  const model=makeModel({name:'A custom build',author:'@maker',parts:'2 printed brackets\nA hand-wound coil\nWiring TBD',story:'Trying a smaller enclosure.'});
  assert.equal(model.parts.length,0);
  for(const format of Object.keys(SETUP_CARD_FORMATS)){
    const plan=planSetupCard(model,format,measure),note=plan.commands.find(command=>command.id==='custom-note');
    assert.ok(note.lines.length);
    assert.ok(!plan.commands.some(command=>command.id?.startsWith('quantity-')));
    assert.equal(plan.commands.find(command=>command.id==='parts-heading').lines.join(' '),'CREATOR’S NOTES');
  }
  assert.ok(!model.caption.includes('0 parts'));
  assert.ok(!model.caption.includes('Parts selected by the creator:'));
  assert.ok(model.caption.includes('2 printed brackets\nA hand-wound coil\nWiring TBD'));
});

test('a single part and a notes-only setup use the available space without affecting the source kit',()=>{
  const kit=normalizeKit({name:'One radio',devices:['part-0'],story:'A long note. '.repeat(40),photo:'https://example.com/private-photo.jpg'},catalog),before=structuredClone(kit);
  const model=createSetupCardModel({kit,catalog,shareURL:new URL(kitURL(kit),'http://127.0.0.1:54644').href});
  assert.deepEqual(kit,before);
  const plan=planSetupCard(model,'feed',measure),note=plan.commands.find(command=>command.id==='note');
  assert.ok(plan.commands.find(command=>command.id==='part-0').size>=64,'one part gets a larger display treatment');
  assert.ok(plan.commands.find(command=>command.id==='part-panel-0').height>=500);
  assert.ok(note.y+note.height<plan.commands.find(command=>command.id==='footer').y-20);
  const notesOnly=makeModel({story:'Designing the first prototype.'});
  assert.ok(planSetupCard(notesOnly,'story',measure).commands.some(command=>command.id==='custom-note'));
  assert.ok(!plan.commands.some(command=>command.type==='image'));
});

test('text wrapping keeps deliberate newlines, splits long words and uses a fitting ellipsis',()=>{
  const metric=text=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].length*10;
  assert.deepEqual(wrapCardText('Line one\n\nLine two',{width:100,maxLines:4,measure:metric}),{lines:['Line one','','Line two'],truncated:false});
  assert.deepEqual(wrapCardText('ABCDEFGHIJK',{width:40,maxLines:2,measure:metric}),{lines:['ABCD','EFG…'],truncated:true});
  const emoji='👩🏽‍🔧';
  assert.deepEqual(wrapCardText(emoji.repeat(4),{width:20,maxLines:2,measure:metric}),{lines:[emoji.repeat(2),emoji.repeat(2)],truncated:false});
  assert.deepEqual(wrapCardText('No room',{width:5,maxLines:1,measure:metric}),{lines:[''],truncated:true});
  assert.throws(()=>wrapCardText('x',{width:0,maxLines:1,measure:metric}));
});

test('invalid and empty inputs fail clearly while long snapshot URLs are preserved verbatim',()=>{
  const kit=normalizeKit({devices:['part-0']},catalog);
  for(const shareURL of ['', '/setup/?devices=part-0','javascript:alert(1)','data:text/plain,hello','https://user:pass@example.com/setup/',' https://example.com/setup/','https://example.com/line\nbreak']){
    assert.throws(()=>createSetupCardModel({kit,catalog,shareURL}));
  }
  const shareURL='https://example.com/setup/?devices=part-0&story='+ 'a'.repeat(18000)+'&origin=First%20maker';
  assert.equal(createSetupCardModel({kit,catalog,shareURL}).shareURL,shareURL);
  assert.throws(()=>makeModel({}),/Add a part or a build note/);
  assert.throws(()=>createSetupCardModel({kit,shareURL}),/catalog/);
  assert.throws(()=>planSetupCard(makeModel(kit),'poster',measure),/supported/);
  assert.equal(setupCardFilename('../Été / Radio 🔧','story'),'ete-radio-story.png');
  assert.equal(setupCardFilename('夏','wide'),'hardware-setup-wide.png');
});

test('every photo/text layout keeps content bounded for zero to six parts, long titles and notes',()=>{
  const longCatalog=catalog.map(device=>({...device,name:'A very long hardware name '+ 'W'.repeat(180)}));
  const photo={width:4032,height:3024};
  for(const format of Object.keys(SETUP_CARD_FORMATS))for(const count of [0,1,2,3,4,5,6])for(const withPhoto of [false,true])for(const hasNotes of [false,true]){
    const model=makeModel({name:'W'.repeat(64),author:'@'+'W'.repeat(39),devices:catalog.slice(0,count).map(device=>device.slug),
      story:hasNotes?'My build notes\n'.repeat(35):'',parts:count===0?'Custom case\nHand-wound coil\nCustom wiring':'',items:{'part-0':{quantity:99,state:'have'}}},longCatalog);
    const before=JSON.stringify(model),plan=planSetupCard(model,format,measure,{photo:withPhoto?photo:null});
    assert.equal(JSON.stringify(model),before,'planning does not change model or caption');
    assert.equal(plan.hasPhoto,withPhoto);
    assert.equal(plan.commands.filter(command=>/^part-\d+$/.test(command.id)).length,count);
    const frame=plan.commands.find(command=>command.type==='photo');
    assert.equal(Boolean(frame),withPhoto);
    const textCommands=plan.commands.filter(command=>command.type==='text');
    for(const command of plan.commands){
      const label=`${format}, ${count} parts, photo=${withPhoto}, notes=${hasNotes}: ${command.id}`;
      assert.ok(command.x>=0 && command.y>=0,label);
      assert.ok(command.x+command.width<=plan.width+.001,label+' width');
      if(command.height!==undefined)assert.ok(command.y+command.height<=plan.height+.001,label+' height');
      if(command.type==='text'){
        for(const line of command.lines)assert.ok(measure(line,command.size)<=command.width+.001,label+' line width');
        if(frame)assert.ok(command.x>=frame.x+frame.width || command.x+command.width<=frame.x || command.y>=frame.y+frame.height || command.y+command.height<=frame.y,label+' separate from photo');
      }
    }
    for(const panel of plan.commands.filter(command=>command.id?.startsWith('part-panel-'))){
      const index=panel.id.split('-').at(-1);
      for(const child of textCommands.filter(command=>[`quantity-${index}`,`part-${index}`,`state-${index}`].includes(command.id))){
        assert.ok(child.y+child.height<=panel.y+panel.height+.001,`${format} ${count} part panel contains ${child.id}`);
      }
    }
    for(let i=0;i<textCommands.length;i++)for(let j=i+1;j<textCommands.length;j++){
      const a=textCommands[i],b=textCommands[j];
      assert.ok(a.x>=b.x+b.width || a.x+a.width<=b.x || a.y>=b.y+b.height || a.y+a.height<=b.y,
        `${format}, ${count}, photo=${withPhoto}: ${a.id} and ${b.id} do not overlap`);
    }
    if(count===0)assert.ok(plan.commands.some(command=>command.id==='custom-note'));
    assert.ok(model.caption.includes(model.shareURL));
  }
});

test('photo framing centers a crop or contains the whole image without stretching',()=>{
  const frame={x:48,y:328,width:984,height:420};
  for(const photo of [{width:4000,height:3000},{width:1200,height:2400},{width:6000,height:1000}])for(const fit of ['cover','contain']){
    const p=setupCardPhotoPlacement(photo,frame,fit);
    assert.ok(Math.abs(p.dw/p.dh-p.sw/p.sh)<1e-9);
    assert.ok(p.sx>=0 && p.sy>=0 && p.sx+p.sw<=photo.width+.001 && p.sy+p.sh<=photo.height+.001);
    assert.ok(p.dx>=frame.x && p.dy>=frame.y && p.dx+p.dw<=frame.x+frame.width+.001 && p.dy+p.dh<=frame.y+frame.height+.001);
    if(fit==='cover')assert.deepEqual([p.dx,p.dy,p.dw,p.dh],[frame.x,frame.y,frame.width,frame.height]);
    else assert.deepEqual([p.sx,p.sy,p.sw,p.sh],[0,0,photo.width,photo.height]);
  }
  assert.throws(()=>setupCardPhotoPlacement({width:400,height:400},frame,'stretch'));
});

test('local photo validation rejects unsupported, oversized, empty and mismatched files',()=>{
  const png=new Uint8Array([137,80,78,71,13,10,26,10]),jpg=new Uint8Array([255,216,255]),webp=new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
  for(const [type,signature] of [['image/png',png],['image/jpeg',jpg],['image/webp',webp]])assert.doesNotThrow(()=>validateSetupCardPhotoFile({type,size:512},signature));
  for(const type of ['image/svg+xml','image/gif','image/avif','text/html',''])assert.throws(()=>validateSetupCardPhotoFile({type,size:512}));
  assert.throws(()=>validateSetupCardPhotoFile({type:'image/png',size:0}));
  assert.throws(()=>validateSetupCardPhotoFile({type:'image/png',size:SETUP_CARD_PHOTO_LIMITS.bytes+1}));
  assert.throws(()=>validateSetupCardPhotoFile({type:'image/png',size:512},jpg));
  assert.throws(()=>validateSetupCardPhotoFile({type:'image/png',size:512},new TextEncoder().encode('<svg xmlns="')));
  assert.doesNotThrow(()=>validateSetupCardPhotoFile({type:'image/png',size:SETUP_CARD_PHOTO_LIMITS.bytes},png));
  for(const dimensions of [{width:0,height:100},{width:63,height:100},{width:100,height:NaN},{width:100.5,height:100},{width:10001,height:100},{width:6000,height:5000}])assert.throws(()=>validateSetupCardPhotoDimensions(dimensions));
  assert.deepEqual(validateSetupCardPhotoDimensions({width:6000,height:4000}),{width:6000,height:4000});
});
