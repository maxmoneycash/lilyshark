import {DEMO_SOURCES,DEMO_REVIEW_DATE} from './maker-demo.mjs';

export const MAKER_DEMO_SHARING_FORMATS = Object.freeze({
  feed: Object.freeze({width:1080,height:1350}),
  story: Object.freeze({width:1080,height:1920}),
  wide: Object.freeze({width:1200,height:630})
});

const INK='#18201b',PANEL='#253129',PAPER='#f5f7f1',MUTED='#bfcbc0',LIME='#d5f582',LINE='#435247';
const FONT='system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const rounded=value=>Math.round(value*100)/100;

// Fixed editorial strings use explicit SVG advances. textLength keeps a fallback
// system font inside the same bounds, without clipping or loading a font file.
// This estimates a comfortable natural width; it is not a browser measurement.
function advance(text,size) {
  let em=0;
  for(const char of text) {
    if(char===' ')em+=.29;
    else if(/[ilI.,:;'!|]/.test(char))em+=.28;
    else if(/[frt()]/.test(char))em+=.39;
    else if(/[mwMW]/.test(char))em+=.86;
    else if(/[A-Z0-9×+]/.test(char))em+=.65;
    else em+=.56;
  }
  return em*size;
}

const layouts={
  feed:{margin:64,brandY:60,brandSize:48,brandText:38,kickerY:176,titleY:233,titleSize:108,titleLeading:132,titleWidth:950,creditY:641,creditSize:28,
    partsX:64,partsY:737,partsW:952,partH:154,partGap:40,partSize:51,partDetailSize:27,partPadding:34,quantitySize:34,
    footerY:1135,statusY:1163,statusSize:27,noteY:1205,noteSize:25,captionY:1267,captionSize:24},
  story:{margin:76,brandY:144,brandSize:52,brandText:40,kickerY:298,titleY:369,titleSize:116,titleLeading:144,titleWidth:928,creditY:820,creditSize:30,
    partsX:76,partsY:979,partsW:928,partH:210,partGap:68,partSize:54,partDetailSize:30,partPadding:42,quantitySize:38,
    footerY:1573,statusY:1610,statusSize:30,noteY:1661,noteSize:27,captionY:1761,captionSize:28},
  wide:{margin:48,brandY:38,brandSize:42,brandText:31,kickerY:124,titleY:175,titleSize:66,titleLeading:82,titleWidth:550,creditY:422,creditSize:23,
    partsX:669,partsY:176,partsW:483,partH:130,partGap:39,partSize:31,partDetailSize:23,partPadding:24,quantitySize:25,
    footerY:508,statusY:534,statusSize:23,noteY:572,noteSize:22,captionY:null,captionSize:22}
};

function makeCard(format) {
  const {width,height}=MAKER_DEMO_SHARING_FORMATS[format],l=layouts[format],bounds=[],nodes=[];
  const text=(id,value,x,y,size,maxWidth,fill=PAPER,weight=500)=>{
    const natural=advance(value,size),drawWidth=rounded(Math.min(natural,maxWidth));
    const box={id,text:value,x,y,width:drawWidth,height:rounded(size*1.2),fontSize:size};
    if(!(size>0 && maxWidth>0) || x<0 || y<0 || x+drawWidth>width || y+box.height>height)throw new Error(`Sharing text outside ${format}: ${id}`);
    bounds.push(box);
    nodes.push(`<text data-text="${id}" x="${x}" y="${rounded(y+size*.94)}" font-size="${size}" font-weight="${weight}" fill="${fill}" textLength="${drawWidth}" lengthAdjust="spacingAndGlyphs">${xml(value)}</text>`);
  };
  nodes.push(`<rect width="${width}" height="${height}" fill="${INK}"/>`);
  // Original geometric G, matching the existing gadgets.sh demo mark.
  nodes.push(`<g transform="translate(${l.margin} ${l.brandY}) scale(${l.brandSize/40})" aria-hidden="true"><rect width="40" height="40" rx="12" fill="${LIME}"/><path d="M28 13H18a7 7 0 0 0-7 7v2a7 7 0 0 0 7 7h10V20h-8" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><circle cx="29" cy="10" r="2" fill="${INK}"/></g>`);
  text('brand','gadgets.sh',l.margin+l.brandSize+16,l.brandY+3,l.brandText,270,PAPER,600);
  text('category','MESH + SENSORS',l.margin,l.kickerY,format==='wide'?20:24,width-l.margin*2,LIME,600);
  ['Environmental','readings on','your mesh node.'].forEach((line,i)=>{
    text(`title-${i}`,line,l.margin,l.titleY+i*l.titleLeading,l.titleSize,l.titleWidth,PAPER,650);
  });
  text('guide-credit','Guide by Seeed Studio',l.margin,l.creditY,l.creditSize,format==='wide'?550:width-l.margin*2,MUTED);

  const part=(index,name,detail)=>{
    const y=l.partsY+index*(l.partH+l.partGap),x=l.partsX,p=l.partPadding;
    nodes.push(`<rect x="${x}" y="${y}" width="${l.partsW}" height="${l.partH}" rx="${format==='wide'?18:24}" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>`);
    const quantityW=l.quantitySize*1.55,copyX=x+p+quantityW+(format==='wide'?14:24),copyWidth=x+l.partsW-p-copyX;
    const copyY=y+(l.partH-l.partSize*1.2-l.partDetailSize*1.2-9)/2;
    text(`quantity-${index}`,'1×',x+p,y+(l.partH-l.quantitySize*1.2)/2,l.quantitySize,quantityW,LIME,600);
    text(`part-${index}`,name,copyX,rounded(copyY),l.partSize,copyWidth,PAPER,600);
    text(`part-detail-${index}`,detail,copyX,rounded(copyY+l.partSize*1.2+9),l.partDetailSize,copyWidth,MUTED);
  };
  part(0,'Wio Tracker L1','OLED base model');
  part(1,'Grove BME280','Environmental sensor');
  // A plus expresses a parts pairing, not a wiring diagram or measured signal.
  const cx=l.partsX+l.partsW/2,cy=l.partsY+l.partH+l.partGap/2,r=format==='story'?22:16;
  nodes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${LIME}"/><path d="M${cx-r*.4} ${cy}h${r*.8}M${cx} ${cy-r*.4}v${r*.8}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`);
  nodes.push(`<path d="M${l.margin} ${l.footerY}H${width-l.margin}" fill="none" stroke="${LINE}" stroke-width="2"/>`);
  text('status','Independent source example',l.margin,l.statusY,l.statusSize,width-l.margin*2,LIME,600);
  text('evidence-limit','Not hands-on tested or commissioned.',l.margin,l.noteY,l.noteSize,width-l.margin*2,MUTED);
  if(l.captionY!==null)text('caption-pointer','Guide & required extras in the caption',l.margin,l.captionY,l.captionSize,width-l.margin*2,PAPER);

  const title='Wio Tracker L1 + Grove BME280 source example';
  const description='Environmental readings on a mesh node, following Seeed Studio’s guide. One Wio Tracker L1 OLED base model and one Grove BME280. Independent source example by gadgets.sh; not hands-on tested or commissioned. Required accessories and the original guide are in the accompanying caption.';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="card-title card-description"><title id="card-title">${xml(title)}</title><desc id="card-description">${xml(description)}</desc><g font-family="${xml(FONT)}">${nodes.join('')}</g></svg>\n`;
  return {format,filename:`wio-l1-${format}.svg`,width,height,svg,textBounds:bounds};
}

/** Original photo-free vectors and copy. No file writes, network or public URL. */
export function createMakerDemoSharing() {
  const caption=[
    'Environmental readings on a mesh node, following Seeed Studio’s guide.',
    'Core parts: 1× Wio Tracker L1 (OLED base model) + 1× Grove BME280.',
    'Also needed: Grove cable, suitable power, band-matched antenna, USB data cable, computer and phone. Remote reception needs another configured node.',
    'Check the exact model, firmware and region in the original guide:',
    DEMO_SOURCES.guide,
    `Independent source example by gadgets.sh. Not hands-on tested or commissioned. Sources reviewed ${DEMO_REVIEW_DATE}.`
  ].join('\n\n');
  return {cards:Object.keys(MAKER_DEMO_SHARING_FORMATS).map(makeCard),caption};
}
