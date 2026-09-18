import {normalizeKit, partDetails, PART_STATES} from './kits.mjs';
import {shareLinkNotice} from './share-links.mjs';

export const SETUP_CARD_FORMATS = Object.freeze({
  feed: Object.freeze({label:'Feed', width:1080, height:1350}),
  story: Object.freeze({label:'Story', width:1080, height:1920}),
  wide: Object.freeze({label:'Wide', width:1200, height:630})
});
export const SETUP_CARD_COLORS = Object.freeze({
  background:'#18201b', panel:'#253129', ink:'#f5f7f1', muted:'#bfcbc0',
  line:'#435247', accent:'#d5f582', accentInk:'#18201b'
});

function checkedShareURL(value) {
  if(typeof value!=='string' || !value || value!==value.trim() || /[\u0000-\u0020\u007f]/.test(value))throw new Error('Provide the complete setup share link.');
  let url;
  try {url=new URL(value);}catch {throw new Error('Provide the complete setup share link.');}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password)throw new Error('Use an HTTP or HTTPS setup link without a username or password.');
  // Stateful setup links can be long. Keep the caller's exact query or fragment.
  return value;
}

export function createSetupCardModel({kit:input, catalog, shareURL}={}) {
  if(!Array.isArray(catalog))throw new Error('The hardware catalog is unavailable.');
  const kit=normalizeKit(input,catalog),url=checkedShareURL(shareURL);
  if(!kit.devices.length && !kit.story && !kit.parts)throw new Error('Add a part or a build note before making a card.');
  const parts=kit.devices.map(slug=>{
    const device=catalog.find(entry=>entry.slug===slug),item=partDetails(kit.items[slug]);
    return {slug,name:typeof device.name==='string' && device.name.trim()?device.name.trim():slug,
      quantity:item.quantity,state:PART_STATES[item.state],note:item.note};
  });
  const model={name:kit.name,author:kit.author,credit:kit.author?`By ${kit.author}`:'',
    from:kit.from,origin:kit.origin || kit.from,story:kit.story,customParts:kit.parts,
    project:kit.project,parts,shareURL:url};
  const postText=setupCardPostText(model);
  return {...model,caption:setupCardCaption(model),postText,postCredits:creditLines(model).join('\n'),postCaption:setupCardPostCaption(model,postText)};
}

function creditLines(model) {
  const lines=model.credit?[model.credit]:[];
  if(model.from)lines.push(`Remixed from: ${model.from}`);
  if(model.origin && model.origin!==model.from)lines.push(`Earliest known credit: ${model.origin}`);
  return lines;
}

function setupCardPostText(model) {
  const note=String(model.story || model.customParts || '').replace(/\s+/g,' ').trim();
  const points=characters(note),excerpt=points.length>160?points.slice(0,159).join('').trimEnd()+'…':note;
  return [model.name,...(excerpt?['',`Build note: ${excerpt}`]:[])].join('\n');
}

/** Editable post text plus unchanged attribution. The setup link is a separate action. */
export function setupCardPostCaption(model,text=model.postText ?? setupCardPostText(model)) {
  const intro=String(text ?? '').trim(),credits=creditLines(model).join('\n');
  return [intro,credits].filter(Boolean).join('\n\n');
}

/** Counts Unicode code points, including spaces/newlines; not a platform-specific limit. */
export function setupCardCaptionCount(value) {
  return Array.from(String(value ?? '')).length;
}

/** Full details export, kept compatible with existing callers. */
export function setupCardCaption(model) {
  const lines=[model.name,...creditLines(model)];
  if(model.parts.length){
    lines.push('','Parts selected by the creator:');
    for(const part of model.parts){
      lines.push(`${part.quantity} × ${part.name} — ${part.state}`);
      if(part.note)lines.push(`Creator’s part note: ${part.note}`);
    }
  }
  if(model.story)lines.push('','Creator’s build notes:',model.story);
  if(model.customParts)lines.push('','Other parts & modifications — creator’s notes:',model.customParts);
  if(model.project)lines.push('','Creator’s build log, code or demo:',model.project);
  const notice=shareLinkNotice(model.shareURL);
  lines.push('',...(notice?[notice]:[]),'Open this setup snapshot (the parts and notes are stored in the link):',model.shareURL,'','Made with gadgets.sh.');
  return lines.join('\n');
}

const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
const characters=text=>segmenter?Array.from(segmenter.segment(text),item=>item.segment):Array.from(text);

/** Wraps explicit newlines and unbroken words without splitting emoji graphemes.
 * measure(text) returns pixels. Ellipsis always fits the last available line. */
export function wrapCardText(value,{width,maxLines,measure}) {
  if(!(width>0) || !Number.isInteger(maxLines) || maxLines<1 || typeof measure!=='function')throw new Error('Invalid text layout bounds.');
  const text=String(value ?? '').replace(/\r\n?/g,'\n'),lines=[];
  let truncated=false;
  const push=line=>{lines.push(line);return lines.length>maxLines;};
  outer: for(const paragraph of text.split('\n')){
    let line='';
    const words=paragraph.trim().split(/\s+/).filter(Boolean);
    if(!words.length){if(push(''))break;continue;}
    for(const word of words){
      const candidate=line?`${line} ${word}`:word;
      if(measure(candidate)<=width){line=candidate;continue;}
      if(line){if(push(line))break outer;line='';}
      if(measure(word)<=width){line=word;continue;}
      for(const char of characters(word)){
        if(measure(line+char)>width){
          if(line && push(line))break outer;
          line='';
          if(measure(char)>width){truncated=true;continue;}
        }
        line+=char;
      }
    }
    if(push(line))break;
  }
  truncated=truncated || lines.length>maxLines;
  const visible=lines.slice(0,maxLines);
  if(truncated && visible.length){
    const last=characters(visible.at(-1).trimEnd());
    while(last.length && measure(last.join('')+'…')>width)last.pop();
    visible[visible.length-1]=measure('…')<=width?last.join('')+'…':'';
  }
  return {lines:visible,truncated};
}

export const SETUP_CARD_PHOTO_LIMITS = Object.freeze({
  bytes:10*1024*1024, pixels:24_000_000, minDimension:64, maxDimension:10000,
  types:Object.freeze(['image/jpeg','image/png','image/webp'])
});

/** Metadata and signature checks run before decoding a user-selected local file. */
export function validateSetupCardPhotoFile(file,signature){
  if(!file || !SETUP_CARD_PHOTO_LIMITS.types.includes(file.type))throw new Error('Choose a JPEG, PNG or WebP photo.');
  if(!Number.isFinite(file.size) || file.size<=0)throw new Error('This photo file is empty. Choose another photo.');
  if(file.size>SETUP_CARD_PHOTO_LIMITS.bytes)throw new Error('Choose a photo of 10 MB or smaller.');
  if(signature!==undefined){
    const bytes=Array.from(signature),starts=values=>values.every((value,index)=>bytes[index]===value);
    const matches=file.type==='image/jpeg'?starts([255,216,255]):file.type==='image/png'?starts([137,80,78,71,13,10,26,10]):
      starts([82,73,70,70]) && [87,69,66,80].every((value,index)=>bytes[index+8]===value);
    if(!matches)throw new Error('This file does not match its photo type. Choose a valid JPEG, PNG or WebP.');
  }
}

export function validateSetupCardPhotoDimensions({width,height}={}){
  const limits=SETUP_CARD_PHOTO_LIMITS;
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<limits.minDimension || height<limits.minDimension)
    throw new Error('Choose a photo at least 64 pixels on each side.');
  if(width>limits.maxDimension || height>limits.maxDimension || width*height>limits.pixels)
    throw new Error('Resize this photo to 24 megapixels or less, with no side over 10,000 pixels.');
  return {width,height};
}

/** Source crop and destination rectangle; no URL or pixels enter the pure model. */
export function setupCardPhotoPlacement(photo,box,fit='cover'){
  const {width,height}=validateSetupCardPhotoDimensions(photo);
  if(!['cover','contain'].includes(fit))throw new Error('Choose Fill frame or Show whole photo.');
  if(!(box.width>0) || !(box.height>0))throw new Error('Invalid photo frame.');
  if(fit==='contain'){
    const scale=Math.min(box.width/width,box.height/height),w=width*scale,h=height*scale;
    return {sx:0,sy:0,sw:width,sh:height,dx:box.x+(box.width-w)/2,dy:box.y+(box.height-h)/2,dw:w,dh:h};
  }
  const scale=Math.max(box.width/width,box.height/height),sw=box.width/scale,sh=box.height/scale;
  return {sx:(width-sw)/2,sy:(height-sh)/2,sw,sh,dx:box.x,dy:box.y,dw:box.width,dh:box.height};
}

/** Pure plan; optional photo has decoded dimensions only. Text is measured and bounded. */
export function planSetupCard(model,format='feed',measure,{photo=null,photoFit='cover'}={}) {
  if(!Object.hasOwn(SETUP_CARD_FORMATS,format))throw new Error('Choose a supported card format.');
  if(typeof measure!=='function')throw new Error('Text measurement is unavailable.');
  if(photo)validateSetupCardPhotoDimensions(photo);
  const {width,height}=SETUP_CARD_FORMATS[format],wide=format==='wide',story=format==='story';
  const commands=[],overflow=[],colors=SETUP_CARD_COLORS,n=model.parts.length;
  const note=[model.story,model.customParts?`Other parts: ${model.customParts}`:''].filter(Boolean).join('\n');
  const customNote=[model.customParts?`Other parts & modifications:\n${model.customParts}`:'',model.story?`Build notes:\n${model.story}`:''].filter(Boolean).join('\n\n');
  const rect=(x,y,w,h,color,radius=0)=>commands.push({type:'rect',x,y,width:w,height:h,color,radius});
  const line=(x,y,w)=>commands.push({type:'line',x,y,width:w,color:colors.line});
  function text(id,value,x,y,w,size,maxLines=1,weight=400,color=colors.ink,lineHeight=Math.ceil(size*1.2)){
    if(!value)return;
    const wrapped=wrapCardText(value,{width:w,maxLines,measure:value=>measure(value,size,weight)});
    if(wrapped.truncated)overflow.push(id);
    commands.push({type:'text',id,x,y,width:w,height:maxLines*lineHeight,size,weight,lineHeight,color,...wrapped});
  }
  function brand(x,y,size,labelSize){
    commands.push({type:'mark',x,y,width:size,height:size});
    text('brand','gadgets.sh',x+size+14,y+(size-labelSize*1.2)/2,300,labelSize,1,600);
    rect(width-x-64,y+size/2-2,64,4,colors.accent,2);
    rect(width-x-24,y+size/2+12,24,4,colors.line,2);
  }
  function photoFrame(box){
    rect(box.x,box.y,box.width,box.height,colors.panel,20);
    commands.push({type:'photo',id:'build-photo',...box,radius:20,fit:photoFit,placement:setupCardPhotoPlacement(photo,box,photoFit)});
  }
  function noteBlock(x,y,w,size,lines,custom=false){
    const value=custom?customNote:note;
    if(!value)return;
    text(custom?'parts-heading':'note-label','CREATOR’S NOTES',x,y,w,wide?20:22,1,600,colors.muted);
    text(custom?'custom-note':'note',value,x,y+34,w,size,lines,400,colors.ink,Math.ceil(size*1.2));
  }
  function rows({x,y,w,rowHeight,size,columns=1,stackState=false,nameLines=2,stateSize=wide?20:24}){
    const gap=columns===2?28:0,cw=(w-gap)/columns,qw=Math.ceil(size*2.2),innerGap=wide?10:16;
    const lineHeight=Math.ceil(size*1.1),stateWidth=wide?124:168;
    model.parts.forEach((part,index)=>{
      const cx=x+(index%columns)*(cw+gap),cy=y+Math.floor(index/columns)*rowHeight;
      const nx=cx+qw+innerGap,nw=cw-qw-innerGap-(stackState?0:stateWidth+innerGap);
      text(`quantity-${index}`,`${part.quantity}×`,cx,cy+8,qw,size,1,600,colors.accent);
      text(`part-${index}`,part.name,nx,cy+8,nw,size,nameLines,600,colors.ink,lineHeight);
      text(`state-${index}`,part.state,stackState?nx:cx+cw-stateWidth,stackState?cy+8+nameLines*lineHeight+4:cy+10,stackState?nw:stateWidth,stateSize,1,400,colors.muted);
      line(cx,cy+rowHeight-1,cw);
    });
  }
  function sparsePanels({x,y,w,h}){
    const gap=16,cellHeight=(h-gap*(n-1))/n;
    model.parts.forEach((part,index)=>{
      const cy=y+index*(cellHeight+gap),pad=wide && n>1?18:wide?24:32;
      rect(x,cy,w,cellHeight,colors.panel,20);
      commands.at(-1).id=`part-panel-${index}`;
      if(n===1){
        const compact=wide && cellHeight<300;
        const qSize=wide?(compact?52:76):story?152:112,nameSize=wide?(compact?40:48):story?88:72,lh=Math.ceil(nameSize*1.12);
        text(`quantity-${index}`,`${part.quantity}×`,x+pad,cy+pad,w/2,qSize,1,600,colors.accent);
        text(`state-${index}`,part.state,x+w-(wide?220:300)-pad,cy+pad+qSize*.35,wide?220:300,wide?24:32,1,400,colors.muted);
        const nameY=cy+pad+Math.ceil(qSize*1.2)+(compact?16:24),available=cy+cellHeight-pad-nameY;
        text(`part-${index}`,part.name,x+pad,nameY,w-pad*2,nameSize,Math.max(1,Math.min(4,Math.floor(available/lh))),600,colors.ink,lh);
      }else{
        const size=wide?(n===3?26:30):story?52:42,lh=Math.ceil(size*1.12),qw=wide?68:112;
        text(`quantity-${index}`,`${part.quantity}×`,x+pad,cy+pad,qw,wide?34:52,1,600,colors.accent);
        text(`part-${index}`,part.name,x+pad+qw+12,cy+pad,w-pad*2-qw-12,size,2,600,colors.ink,lh);
        text(`state-${index}`,part.state,x+pad+qw+12,cy+pad+lh*2+10,w-pad*2-qw-12,wide?20:26,1,400,colors.muted);
      }
    });
  }
  rect(0,0,width,height,colors.background);
  let footerY;
  if(photo){
    if(wide){
      brand(40,32,44,28);
      photoFrame({x:40,y:112,width:436,height:438});
      text('name',model.name,518,112,642,50,2,600,colors.ink,56);
      text('credit',model.credit,518,242,642,24,1,400,colors.muted);
      if(n){
        text('parts-heading','SELECTED PARTS',518,294,642,20,1,600,colors.muted);
        if(n===1 && !note)sparsePanels({x:518,y:330,w:642,h:220});
        else {
          rows({x:518,y:342,w:642,rowHeight:n>3?68:70,size:n>3?22:24,columns:n>3?2:1,stackState:n>3,nameLines:n>3?1:2,stateSize:18});
          if(note && n===1)noteBlock(518,432,642,24,3);
          else if(note)overflow.push('note');
        }
      }else noteBlock(518,302,642,30,5,true);
      footerY=584;
    }else{
      const x=story?72:48,w=width-x*2;
      brand(x,story?80:40,story?56:44,story?32:28);
      text('name',model.name,x,story?184:120,w,story?82:70,2,600,colors.ink,story?90:76);
      text('credit',model.credit,x,story?380:282,w,story?28:26,1,400,colors.muted);
      const py=story?448:328,ph=story?(n>=4?640:n===3?720:n===2?856:n===1?944:760):(n>=4?420:n===3?500:n===2?580:n===1?620:500);
      photoFrame({x,y:py,width:w,height:ph});
      const partsY=py+ph+64;
      if(n){
        text('parts-heading','SELECTED PARTS',x,partsY-36,w,22,1,600,colors.muted);
        const rowHeight=story?(n>=4?128:n===3?112:n===2?100:112):(n>=4?104:n===3?80:n===2?84:112);
        rows({x,y:partsY,w,rowHeight,size:story?(n>=4?34:38):(n>=4?26:n===1?38:30),columns:n>=4?2:1,stackState:n>=4,stateSize:story?24:n>=4?18:24});
        const noteY=partsY+rowHeight*Math.ceil(n/(n>=4?2:1))+36;
        const lineHeight=story?38:29,noteLines=Math.floor(((story?1744:1238)-noteY-34)/lineHeight);
        if(note && noteLines>0)noteBlock(x,noteY,w,story?31:24,noteLines);
        else if(note)overflow.push('note');
      }else{
        const maxLines=Math.floor(((story?1736:1230)-partsY-34)/(story?48:42));
        noteBlock(x,partsY-20,w,story?40:34,maxLines,true);
      }
      footerY=story?1800:1272;
    }
  }else{
    const margin=wide?48:72;
    brand(margin,wide?40:story?120:64,wide?44:64,wide?28:34);
    text('eyebrow','HARDWARE SETUP',margin,wide?122:story?256:176,wide?458:936,wide?20:24,1,600,colors.accent);
    text('name',model.name,margin,wide?158:story?304:220,wide?458:936,wide?58:story?96:80,wide?3:2,600,colors.ink,wide?64:story?104:88);
    text('credit',model.credit,margin,wide?364:story?540:420,wide?458:936,wide?24:30,wide?2:1,400,colors.muted,wide?30:38);
    const x=wide?554:margin,y=wide?152:story?728:560,w=wide?598:936;
    text('parts-heading',n?'SELECTED PARTS':'CREATOR’S NOTES',x,y-(wide?36:48),w,wide?20:24,1,600,colors.muted);
    if(n){
      if(n<=3){
        const h=wide?396:story?820:560;
        sparsePanels({x,y,w,h});
        if(note){
          if(wide)noteBlock(margin,442,458,24,2);
          else noteBlock(x,y+h+36,w,story?32:26,story?3:1);
        }
      }else{
        const rh=wide?396/n:story?768/n:n===6?80:520/n;
        rows({x,y,w,rowHeight:rh,size:wide?(n===6?26:28):story?(n===6?38:44):n===6?30:38});
        if(note)noteBlock(wide?margin:x,wide?442:story?1572:1118,wide?458:w,wide?24:story?32:26,wide?2:story?3:2);
      }
    }else{
      const bottom=wide?536:story?1712:1200,size=wide?28:story?40:36,lh=Math.ceil(size*1.2);
      rect(x-16,y-4,w+32,bottom-y+12,colors.panel,20);
      text('custom-note',customNote,x+16,y+16,w-32,size,Math.floor((bottom-y-24)/lh),400,colors.ink,lh);
    }
    footerY=wide?576:story?1768:1264;
  }
  const footerMargin=wide?40:photo && !story?48:72;
  line(footerMargin,footerY-20,width-footerMargin*2);
  text('footer','Parts & notes in the setup link',footerMargin,footerY,width-footerMargin*2,wide?22:26,1,400,colors.muted);
  return {format,width,height,commands,overflow,hasPhoto:Boolean(photo),filename:setupCardFilename(model.name,format)};
}

export function setupCardFilename(name,format='feed') {
  if(!Object.hasOwn(SETUP_CARD_FORMATS,format))throw new Error('Choose a supported card format.');
  const base=String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60).replace(/-$/,'') || 'hardware-setup';
  return `${base}-${format}.png`;
}
