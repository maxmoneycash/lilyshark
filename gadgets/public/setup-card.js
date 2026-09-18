import {SETUP_CARD_FORMATS, SETUP_CARD_COLORS, createSetupCardModel, setupCardPostCaption, setupCardCaptionCount, planSetupCard, validateSetupCardPhotoFile, validateSetupCardPhotoDimensions} from './setup-card.mjs';
import {shareLinkNotice} from './share-links.mjs';

const FONT='"Instrument Sans", system-ui, sans-serif';
let nextDialog=0;
const localPhotos=new WeakSet();

/** Decode only an explicitly selected local File/Blob. The caller must dispose it. */
export async function readSetupCardPhoto(file,{signal}={}){
  const aborted=()=>{if(signal?.aborted)throw new DOMException('Photo selection cancelled.','AbortError');};
  aborted();
  validateSetupCardPhotoFile(file);
  if(!(file instanceof Blob))throw new Error('Choose a photo file from your device.');
  validateSetupCardPhotoFile(file,new Uint8Array(await file.slice(0,12).arrayBuffer()));
  aborted();
  let source=null,url='',disposed=false,photo=null;
  const release=()=>{
    if(disposed)return;
    disposed=true;
    if(photo)localPhotos.delete(photo);
    if(typeof source?.close==='function')source.close();
    else if(source?.removeAttribute)source.removeAttribute('src');
    if(url)URL.revokeObjectURL(url);
    source=null;url='';
  };
  try {
    try {
      if(typeof createImageBitmap==='function')source=await createImageBitmap(file,{imageOrientation:'from-image'});
      else {
        url=URL.createObjectURL(file);
        source=new Image();
        await new Promise((resolve,reject)=>{
          const finish=error=>{clearTimeout(timer);source.onload=null;source.onerror=null;signal?.removeEventListener('abort',cancel);error?reject(error):resolve();};
          const cancel=()=>finish(new DOMException('Photo selection cancelled.','AbortError'));
          const timer=setTimeout(()=>finish(new Error('Photo decoding timed out.')),15000);
          source.onload=()=>finish();source.onerror=()=>finish(new Error('Photo decoding failed.'));
          signal?.addEventListener('abort',cancel,{once:true});
          if(signal?.aborted)cancel();else source.src=url;
        });
      }
    }catch(error){if(error?.name==='AbortError')throw error;throw new Error('This photo could not be opened. Choose another JPEG, PNG or WebP.');}
    aborted();
    const dimensions=validateSetupCardPhotoDimensions({width:source.naturalWidth || source.width,height:source.naturalHeight || source.height});
    photo=Object.freeze({source,...dimensions,name:typeof file.name==='string'?file.name:'Build photo',dispose:release});
    localPhotos.add(photo);return photo;
  }catch(error){release();throw error;}
}

function roundedRect(ctx,x,y,width,height,radius=0){
  ctx.beginPath();
  if(typeof ctx.roundRect==='function')ctx.roundRect(x,y,width,height,radius);
  else {
    const r=Math.min(radius,width/2,height/2);
    ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);
    ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath();
  }
}

function drawMark(ctx,command){
  const {x,y,width}=command;
  ctx.save();ctx.translate(x,y);ctx.scale(width/40,width/40);
  roundedRect(ctx,0,0,40,40,12);ctx.fillStyle=SETUP_CARD_COLORS.accent;ctx.fill();
  ctx.beginPath();ctx.moveTo(28,13);ctx.lineTo(18,13);ctx.arcTo(11,13,11,20,7);ctx.lineTo(11,22);
  ctx.arcTo(11,29,18,29,7);ctx.lineTo(28,29);ctx.lineTo(28,20);ctx.lineTo(20,20);
  ctx.strokeStyle=SETUP_CARD_COLORS.accentInk;ctx.lineWidth=4;ctx.lineJoin='round';ctx.stroke();
  ctx.beginPath();ctx.arc(29,10,2,0,Math.PI*2);ctx.fillStyle=SETUP_CARD_COLORS.accentInk;ctx.fill();ctx.restore();
}

/** Original graphics/text, plus an optional local photo returned by readSetupCardPhoto.
 * Never reads kit.photo, catalog images, or a remote image URL. */
export function renderSetupCard(canvas,model,format='feed',{photo=null,photoFit='cover'}={}){
  if(photo && !localPhotos.has(photo))throw new Error('Choose a local build photo again before exporting.');
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('This browser cannot create a card preview.');
  const measure=(text,size,weight)=>{ctx.font=`${weight} ${size}px ${FONT}`;return ctx.measureText(text).width;};
  const plan=planSetupCard(model,format,measure,{photo:photo?{width:photo.width,height:photo.height}:null,photoFit});
  canvas.width=plan.width;canvas.height=plan.height;
  ctx.textBaseline='top';
  for(const command of plan.commands){
    if(command.type==='rect'){
      roundedRect(ctx,command.x,command.y,command.width,command.height,command.radius);ctx.fillStyle=command.color;ctx.fill();
    }else if(command.type==='line'){
      ctx.beginPath();ctx.moveTo(command.x,command.y);ctx.lineTo(command.x+command.width,command.y);ctx.strokeStyle=command.color;ctx.lineWidth=1;ctx.stroke();
    }else if(command.type==='mark')drawMark(ctx,command);
    else if(command.type==='photo'){
      const p=command.placement;
      ctx.save();roundedRect(ctx,command.x,command.y,command.width,command.height,command.radius);ctx.clip();
      try {ctx.drawImage(photo.source,p.sx,p.sy,p.sw,p.sh,p.dx,p.dy,p.dw,p.dh);}finally {ctx.restore();}
    }
    else if(command.type==='text'){
      ctx.save();ctx.beginPath();ctx.rect(command.x,command.y,command.width,command.height);ctx.clip();
      ctx.font=`${command.weight} ${command.size}px ${FONT}`;ctx.fillStyle=command.color;
      command.lines.forEach((line,index)=>ctx.fillText(line,command.x,command.y+index*command.lineHeight));ctx.restore();
    }
  }
  return plan;
}

const element=(tag,className,text)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
};
const button=(text,className)=>{const node=element('button',className,text);node.type='button';return node;};

/** One reusable native dialog. The caller supplies a snapshot on every open.
 * open({kit,catalog,shareURL,format='feed'}) => Promise<boolean>
 * close(), destroy(). No storage, network, automatic downloads or publishing. */
export function initSetupCardDialog({container=document.body}={}){
  const id=`setup-card-${++nextDialog}`,dialog=element('dialog','setup-card-dialog');
  dialog.setAttribute('aria-labelledby',`${id}-title`);dialog.setAttribute('aria-describedby',`${id}-intro`);
  const header=element('header','setup-card-header'),heading=element('h2','', 'Create a post');heading.id=`${id}-title`;
  const closeButton=button('×','setup-card-close');closeButton.setAttribute('aria-label','Close setup card preview');
  header.append(heading,closeButton);
  const intro=element('p','setup-card-intro','Make a card and copy the words to go with it.');intro.id=`${id}-intro`;
  const body=element('div','setup-card-body'),preview=element('figure','setup-card-preview'),canvas=element('canvas','setup-card-canvas');
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Setup card preview');
  const previewLabel=element('figcaption','setup-card-preview-label');previewLabel.id=`${id}-preview-label`;
  canvas.setAttribute('aria-describedby',`${id}-preview-label`);preview.append(canvas,previewLabel);
  const controls=element('div','setup-card-controls'),formats=element('fieldset','setup-card-formats'),legend=element('legend','','Image format');formats.append(legend);
  const formatOptions=element('div','setup-card-format-options'),radios=[];
  for(const [value,details] of Object.entries(SETUP_CARD_FORMATS)){
    const label=element('label','setup-card-format'),input=element('input');input.type='radio';input.name=`${id}-format`;input.value=value;input.checked=value==='feed';
    const copy=element('span'),name=element('strong','',details.label),dimensions=element('small','',`${details.width} × ${details.height}`);
    copy.append(name,dimensions);label.append(input,copy);formatOptions.append(label);radios.push(input);
  }
  formats.append(formatOptions);
  const photoSection=element('section','setup-card-photo-section'),photoLabel=element('label','setup-card-caption-label','Your build photo (optional)');photoLabel.htmlFor=`${id}-photo`;
  const photoInput=element('input','setup-card-photo-input');photoInput.id=`${id}-photo`;photoInput.type='file';photoInput.accept='image/jpeg,image/png,image/webp';
  const photoHelp=element('p','setup-card-help','Used only in this PNG. It isn’t added to the shared setup. JPEG, PNG or WebP, up to 10 MB.');photoHelp.id=`${id}-photo-help`;photoInput.setAttribute('aria-describedby',photoHelp.id);
  const photoTools=element('div','setup-card-photo-tools'),fitLabel=element('label','','Framing'),fitSelect=element('select');fitSelect.setAttribute('aria-label','Photo framing');
  for(const [value,label] of [['cover','Fill frame'],['contain','Show whole photo']]){const option=element('option','',label);option.value=value;fitSelect.append(option);}
  fitLabel.append(fitSelect);
  const removePhoto=button('Remove photo','setup-card-remove-photo');photoTools.append(fitLabel,removePhoto);photoTools.hidden=true;
  const photoStatus=element('p','setup-card-photo-status');photoStatus.setAttribute('role','status');photoStatus.setAttribute('aria-live','polite');photoStatus.setAttribute('aria-atomic','true');
  photoSection.append(photoLabel,photoInput,photoHelp,photoTools,photoStatus);
  const captionLabel=element('label','setup-card-caption-label','Post caption');captionLabel.htmlFor=`${id}-caption`;
  const caption=element('textarea','setup-card-caption');caption.id=`${id}-caption`;caption.rows=4;
  const postCredits=element('p','setup-card-post-credits');postCredits.id=`${id}-credits`;
  const captionCount=element('p','setup-card-caption-count');captionCount.id=`${id}-caption-count`;
  const captionHelp=element('p','setup-card-help','Edits affect this caption only. Copy the setup link separately.');captionHelp.id=`${id}-caption-help`;caption.setAttribute('aria-describedby',`${captionHelp.id} ${captionCount.id}`);
  const linkRow=element('div','setup-card-link-row'),copyLink=button('Copy setup link','setup-card-text-button'),linkHelp=element('p','setup-card-help');linkHelp.id=`${id}-link-help`;copyLink.setAttribute('aria-describedby',linkHelp.id);linkRow.append(copyLink,linkHelp);
  const fullDetails=element('details','setup-card-full-details'),fullSummary=element('summary','','Full details'),fullLabel=element('label','setup-card-caption-label','Parts, notes and setup link');fullLabel.htmlFor=`${id}-full-details`;
  const fullCaption=element('textarea','setup-card-caption setup-card-full-caption');fullCaption.id=`${id}-full-details`;fullCaption.readOnly=true;fullCaption.rows=6;fullCaption.spellcheck=false;
  const copyFull=button('Copy full details','setup-card-text-button');fullDetails.append(fullSummary,fullLabel,fullCaption,copyFull);
  const actions=element('div','setup-card-actions'),copyButton=button('Copy caption','setup-card-secondary'),download=button('Download PNG','setup-card-primary');
  const manualCopy=element('div','setup-card-manual-copy');manualCopy.hidden=true;
  const manualLabel=element('label','setup-card-caption-label','Text to copy');manualLabel.htmlFor=`${id}-manual-copy`;
  const manualText=element('textarea','setup-card-caption');manualText.id=`${id}-manual-copy`;manualText.readOnly=true;manualText.rows=3;manualText.spellcheck=false;manualCopy.append(manualLabel,manualText);
  const status=element('p','setup-card-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const retry=button('Try preview again','setup-card-retry');retry.hidden=true;
  actions.append(copyButton,download);controls.append(formats,photoSection,captionLabel,caption,postCredits,captionCount,captionHelp,linkRow,fullDetails,actions,manualCopy,status,retry);
  body.append(preview,controls);dialog.append(header,intro,body);container.append(dialog);

  let model=null,plan=null,format='feed',revision=0,copyRevision=0,destroyed=false,returnFocus=null,downloading=false;
  let photo=null,photoFit='cover',photoRevision=0,photoLoading=false,photoAbort=null;
  const objectURLs=new Map();
  const revoke=url=>{const timer=objectURLs.get(url);if(timer)clearTimeout(timer);URL.revokeObjectURL(url);objectURLs.delete(url);};
  const cleanup=()=>{for(const url of [...objectURLs.keys()])revoke(url);};
  const report=(message,error=false)=>{status.textContent=message;status.dataset.error=String(error);};
  const reportPhoto=(message,error=false)=>{photoStatus.textContent=message;photoStatus.dataset.error=String(error);};
  function clearPhoto(){
    ++photoRevision;photoLoading=false;
    photoAbort?.abort();photoAbort=null;
    photo?.dispose();photo=null;photoInput.value='';photoFit='cover';fitSelect.value='cover';
    reportPhoto('');
  }
  function reflectControls(){
    download.disabled=!model || !plan || downloading || photoLoading;
    copyButton.disabled=!model || !setupCardPostCaption(model,caption.value);
    copyLink.disabled=!model;copyFull.disabled=!model;caption.disabled=!model;
    photoInput.disabled=!model || photoLoading;
    photoTools.hidden=!photo && !photoLoading;
    fitSelect.disabled=!photo;
    removePhoto.disabled=!photo && !photoLoading;
    for(const radio of radios){radio.checked=radio.value===format;radio.disabled=!model;}
  }
  async function updatePreview(){
    if(!model || destroyed)return false;
    const ticket=++revision;plan=null;downloading=false;canvas.hidden=true;retry.hidden=true;reflectControls();
    preview.setAttribute('aria-busy','true');previewLabel.textContent='Preparing preview…';report('');
    try {
      // Wait only for the page's existing font loads; no exporter font/network requests.
      if(document.fonts?.ready)await document.fonts.ready;
      if(ticket!==revision || destroyed || !dialog.open)return false;
      try {plan=renderSetupCard(canvas,model,format,{photo,photoFit});}
      catch(error){
        if(!photo)throw error;
        clearPhoto();reportPhoto('The photo could not be drawn. Your text-only card is ready; choose another photo to try again.',true);
        plan=renderSetupCard(canvas,model,format);
      }
      canvas.hidden=false;
      canvas.setAttribute('aria-label',[model.name,model.credit,photo?'Includes your locally selected build photo':'',model.parts.length?`${model.parts.length} selected parts`:'Creator’s custom build notes','Full text is available in the setup link and Full details.'].filter(Boolean).join('. '));
      previewLabel.textContent=`${SETUP_CARD_FORMATS[format].label} · ${plan.width} × ${plan.height} PNG${plan.overflow.length?' · Shortened on card; see Full details':''}`;
      return true;
    }catch(error){
      if(ticket!==revision || destroyed || !dialog.open)return false;
      plan=null;previewLabel.textContent='Preview unavailable';retry.hidden=false;
      report(error instanceof Error?error.message:'The preview could not be created. Try again.',true);return false;
    }finally{
      if(ticket===revision && !destroyed){preview.removeAttribute('aria-busy');reflectControls();}
    }
  }
  function close(){if(!destroyed && dialog.open)dialog.close();}
  closeButton.addEventListener('click',close);
  dialog.addEventListener('close',()=>{
    // A queued close event can arrive after the caller has already reopened it.
    if(dialog.open)return;
    ++revision;downloading=false;cleanup();clearPhoto();canvas.width=1;canvas.height=1;plan=null;preview.removeAttribute('aria-busy');
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  });
  formats.addEventListener('change',event=>{
    if(event.target.type!=='radio' || !event.target.checked || !Object.hasOwn(SETUP_CARD_FORMATS,event.target.value))return;
    format=event.target.value;void updatePreview();
  });
  retry.addEventListener('click',()=>{void updatePreview();});
  photoInput.addEventListener('change',async()=>{
    const file=photoInput.files?.[0];photoInput.value='';
    if(!file || !model || destroyed || !dialog.open)return;
    const ticket=++photoRevision,controller=new AbortController();photoAbort?.abort();photoAbort=controller;
    ++revision;photoLoading=true;downloading=false;reflectControls();reportPhoto('Opening your photo…');
    let decoded=null;
    try {
      decoded=await readSetupCardPhoto(file,{signal:controller.signal});
      if(ticket!==photoRevision || destroyed || !dialog.open){decoded.dispose();return;}
      photo?.dispose();photo=decoded;photoLoading=false;
      reportPhoto(`${photo.name} · ${photo.width} × ${photo.height}. Kept on this device.`);
      await updatePreview();
    }catch(error){
      if(ticket!==photoRevision || destroyed || !dialog.open){decoded?.dispose();return;}
      reportPhoto(`${error instanceof Error?error.message:'This photo could not be opened.'} ${photo?'Your previous photo is still selected.':'Your text-only card is still available.'}`,true);
      if(!plan)await updatePreview();
    }finally {
      if(photoAbort===controller)photoAbort=null;
      if(ticket===photoRevision && !destroyed){photoLoading=false;reflectControls();}
    }
  });
  removePhoto.addEventListener('click',()=>{clearPhoto();void updatePreview();photoInput.focus();});
  fitSelect.addEventListener('change',()=>{photoFit=fitSelect.value;void updatePreview();});
  function updateCaptionCount(){
    captionCount.textContent=model?`${setupCardCaptionCount(setupCardPostCaption(model,caption.value)).toLocaleString()} characters (Unicode code points)`:'';
    reflectControls();
  }
  caption.addEventListener('input',()=>{++copyRevision;manualCopy.hidden=true;manualText.value='';updateCaptionCount();});
  async function copyText(value,success){
    if(!model || destroyed)return;
    const ticket=revision,copyTicket=++copyRevision;manualCopy.hidden=true;manualText.value='';
    try {
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if(ticket===revision && copyTicket===copyRevision && !destroyed && dialog.open)report(success);
    }catch{
      if(ticket!==revision || copyTicket!==copyRevision || destroyed || !dialog.open)return;
      manualCopy.hidden=false;manualText.value=value;manualText.focus();manualText.select();manualText.setSelectionRange(0,manualText.value.length);
      report('The complete text is selected. Use Copy from your device’s text menu, or press Command+C / Ctrl+C.');
    }
  }
  copyButton.addEventListener('click',()=>{
    if(!model || copyButton.disabled)return;
    void copyText(setupCardPostCaption(model,caption.value),'Caption copied. Copy the setup link separately if you want to include it.');
  });
  copyLink.addEventListener('click',()=>{
    if(!model)return;
    const notice=shareLinkNotice(model.shareURL);
    void copyText(model.shareURL,notice?`Setup link copied. ${notice}`:'Setup link copied. Keep the complete link when pasting.');
  });
  copyFull.addEventListener('click',()=>{
    if(!model)return;
    void copyText(model.caption,'Full details copied, including your setup link.');
  });
  download.addEventListener('click',async()=>{
    if(!model || !plan || downloading || photoLoading || destroyed)return;
    const ticket=revision,filename=plan.filename;downloading=true;reflectControls();report('Preparing PNG…');
    try {
      const blob=await new Promise((resolve,reject)=>{
        canvas.toBlob(value=>value?resolve(value):reject(new Error('The PNG could not be created. Try again.')),'image/png');
      });
      if(ticket!==revision || destroyed || !dialog.open)return;
      const url=URL.createObjectURL(blob);objectURLs.set(url,null);
      try {
        const link=element('a');link.href=url;link.download=filename;link.hidden=true;dialog.append(link);
        try {link.click();}finally {link.remove();}
        // Give the browser time to consume the Blob; close/destroy also revoke it.
        objectURLs.set(url,setTimeout(()=>revoke(url),30000));
        report('PNG download started. Copy your caption and setup link when you’re ready.');
      }catch(error){revoke(url);throw error;}
    }catch(error){
      if(ticket===revision && !destroyed && dialog.open)report(error instanceof Error?error.message:'The PNG download could not start. Try again.',true);
    }finally {if(ticket===revision && !destroyed){downloading=false;reflectControls();}}
  });
  reflectControls();
  return {
    async open(input){
      if(destroyed)throw new Error('This setup card dialog has been destroyed.');
      if(typeof dialog.showModal!=='function')throw new Error('This browser does not support the setup card dialog.');
      if(!dialog.open)returnFocus=document.activeElement;
      ++revision;cleanup();clearPhoto();model=null;plan=null;downloading=false;canvas.width=1;canvas.height=1;canvas.hidden=true;retry.hidden=true;caption.value='';postCredits.textContent='';captionCount.textContent='';fullCaption.value='';fullDetails.open=false;manualCopy.hidden=true;manualText.value='';linkHelp.textContent='';report('');
      preview.removeAttribute('aria-busy');format='feed';
      if(!dialog.open)dialog.showModal();
      try {
        model=createSetupCardModel(input);
        if(input.format!==undefined && !Object.hasOwn(SETUP_CARD_FORMATS,input.format))throw new Error('Choose Feed, Story or Wide for the card format.');
        format=input.format || 'feed';caption.value=model.postText;postCredits.textContent=model.postCredits;postCredits.hidden=!model.postCredits;fullCaption.value=model.caption;
        captionHelp.textContent=model.postCredits?'Credits above stay with your copied caption. Edits affect this caption only.':'Edits affect this caption only. Copy the setup link separately.';
        linkHelp.textContent=shareLinkNotice(model.shareURL) || 'Includes the full setup. Keep the link intact when pasting.';
        updateCaptionCount();
        radios.find(radio=>radio.checked)?.focus({preventScroll:true});
        return await updatePreview();
      }catch(error){
        model=null;plan=null;reflectControls();previewLabel.textContent='Add setup details to make a card';
        report(error instanceof Error?error.message:'The setup card could not open.',true);closeButton.focus();return false;
      }
    },
    close,
    destroy(){
      if(destroyed)return;
      close();destroyed=true;++revision;cleanup();clearPhoto();canvas.width=1;canvas.height=1;dialog.remove();model=null;plan=null;
    }
  };
}
