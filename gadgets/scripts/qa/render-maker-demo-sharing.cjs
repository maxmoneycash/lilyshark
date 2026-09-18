// Run inside the existing verified Arc Playwriter session. Only fixed, locally
// generated SVG inputs are used; nothing is fetched, uploaded or published.
const fs=require('node:fs'),crypto=require('node:crypto');
const source=JSON.parse(fs.readFileSync('/tmp/gadgets-maker-sharing-render-input.json','utf8'));
const output='/Users/maxmohammadi/lilyshark/gadgets/assets/maker-demo-sharing';
const renders=[];
for(const card of source.cards){
  const result=await state.page.evaluate(async({svg,width,height})=>{
    const holder=document.createElement('div');
    holder.style.cssText='position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1';
    holder.inert=true;holder.innerHTML=svg;document.body.append(holder);
    let url='';
    try {
      await document.fonts.ready;
      const boxes=[...holder.querySelectorAll('text')].map(node=>{
        const b=node.getBBox();return {id:node.dataset.text,x:b.x,y:b.y,width:b.width,height:b.height};
      });
      url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
      const img=new Image();img.src=url;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(img,0,0,width,height);
      return {png:canvas.toDataURL('image/png').split(',')[1],boxes};
    }finally{holder.remove();if(url)URL.revokeObjectURL(url);}
  },card);
  const bytes=Buffer.from(result.png,'base64');
  if(bytes.length<1000)throw new Error(`Empty render: ${card.format}`);
  fs.writeFileSync(`${output}/wio-l1-${card.format}.png`,bytes);
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  renders.push({format:card.format,width:card.width,height:card.height,svgSHA256:hash(card.svg),pngSHA256:hash(bytes)});
  fs.writeFileSync(`${output}/wio-l1-${card.format}-bounds.json`,JSON.stringify(result.boxes,null,2)+'\n');
  console.log({format:card.format,bytes:bytes.length,textBoxes:result.boxes.length});
}
fs.writeFileSync(`${output}/manifest.json`,JSON.stringify({schemaVersion:1,renders},null,2)+'\n');
