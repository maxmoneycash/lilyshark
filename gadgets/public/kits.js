import {normalizeKit,readKit,kitFromURL,kitURL,toggleKit,KIT_LIMIT,DEFAULT_KIT_NAME,safeURL,remixKit,partDetails,updateKitPart,kitMarkdown} from './kits.mjs';
import {sortDevices,escapeHTML as e} from './catalog.mjs';
import {kitCards,icons} from './templates.mjs';
import {shareLinkNotice} from './share-links.mjs';

export function initKits(catalog,notify) {
  const $=s=>document.querySelector(s),isBuilder=document.body.dataset.page==='kit';
  const read=()=>{try{return readKit(localStorage,catalog);}catch{return normalizeKit(null,catalog);}};
  let draft=read(),shared=isBuilder?kitFromURL(location.search,catalog,location.hash):null,photoURL='',stored=true,previousDraft=null;
  const current=()=>shared || draft;
  function persist() {
    try {localStorage.setItem('gadgets.kit',JSON.stringify(draft));stored=true;}
    catch {stored=false;notify('Browser storage is unavailable. Copy your setup link before leaving this page.');}
    if(isBuilder)$('#kit-save-state').textContent=stored?'Saved in this browser. Shared links include your notes.':'Storage unavailable. Share or export your setup before leaving.';
  }
  function rememberDraft() {
    // Keep one recovery point. Replacing an untouched empty draft must not erase it.
    const hasContent=draft.devices.length || draft.name!==DEFAULT_KIT_NAME || ['author','from','origin','story','parts','project','photo'].some(key=>draft[key]);
    if(hasContent)previousDraft=structuredClone(draft);
  }
  function recoveryState() {
    const help=$('#kit-restore-help');
    $('#kit-recovery').hidden=!previousDraft || Boolean(shared);
    $('#undo-reset-kit').hidden=!previousDraft;
    help.hidden=!previousDraft;
    help.textContent=previousDraft?`Restores “${previousDraft.name}”. Available until you leave or reload this page.`:'';
  }
  function sync() {
    document.querySelectorAll('[data-kit]').forEach(button=>{
      const id=button.dataset.kit,d=catalog.find(d=>d.slug===id),selected=draft.devices.includes(id);
      if(!d)return;
      button.setAttribute('aria-pressed',String(selected));
      button.setAttribute('aria-label',`${selected?'Remove':'Add'} ${d.name} ${selected?'from':'to'} setup`);
      button.querySelector('[data-kit-label]').textContent=selected?'In your setup':'Add to setup';
      button.querySelector('svg').outerHTML=selected?icons.check:icons.plus;
    });
    $('[data-kit-count]').textContent=draft.devices.length?String(draft.devices.length):'';
    $('[data-kit-nav-label]').textContent=draft.devices.length || draft.story?'Your setup':'Share a setup';
    const show=draft.devices.length>0 && !isBuilder && document.body.dataset.page!=='compare' && document.body.dataset.page!=='saved';
    $('#kit-tray').hidden=!show;document.body.classList.toggle('has-kit',show);
    $('[data-kit-tray-count]').textContent=String(draft.devices.length);
  }
  function validFields() {
    if(shared)return true;
    return ['project','photo'].every(key=>!$(`#kit-${key}`).value.trim() || Boolean(safeURL($(`#kit-${key}`).value,key==='photo'))) && [...document.querySelectorAll('[data-part-link]')].every(field=>!field.value.trim() || Boolean(safeURL(field.value)));
  }
  function shareActions() {
    if(!isBuilder)return;
    $('#kit-link-notice').hidden=!location.hash.startsWith('#kit=') || Boolean(shared);
    const kit=current(),empty=!kit.devices.length && !kit.story && !kit.parts;
    $('#kit-empty').hidden=!empty;
    $('#copy-kit').disabled=empty || !validFields();
    $('#export-kit').disabled=empty || !validFields();
    $('#export-card').disabled=empty || !validFields();
    $('#download-kit').disabled=empty || !validFields();
    $('#preview-kit').hidden=Boolean(shared) || empty || !validFields();
    $('#preview-kit').href=kitURL(kit);
  }
  function readiness() {
    const count={have:0,need:0,considering:0};
    for(const id of current().devices){const item=partDetails(current().items[id]);count[item.state]+=item.quantity;}
    const summary=$('#kit-readiness');summary.hidden=!count.have && !count.need;
    summary.textContent=[count.have?`${count.have} on your bench`:'',count.need?`${count.need} to get`:'',count.considering?`${count.considering} considering`:''].filter(Boolean).join(' · ');
  }
  function renderPhoto() {
    const kit=current();
    $('#setup-photo').hidden=!kit.photo;
    const img=$('#setup-image');img.alt=`${kit.name} — photo supplied by the setup creator`;
    if(kit.photo===photoURL)return;
    photoURL=kit.photo;
    img.hidden=false;
    $('#setup-photo-status').textContent='';
    if(kit.photo)img.src=kit.photo;else img.removeAttribute('src');
  }
  function render(fields=false) {
    sync();if(!isBuilder)return;
    const kit=current(),editing=!shared;
    document.body.dataset.setupMode=editing?'editing':'shared';
    $('#kit-editor').hidden=!editing;$('#remix-kit').hidden=editing;$('#edit-kit').hidden=editing;
    $('#kit-picker-panel').hidden=!editing;$('#kit-shared-actions').hidden=editing;
    $('#kit-mode').textContent=editing?'FROM YOUR WORKBENCH':'A SHARED HARDWARE SETUP';
    $('#kit-heading').textContent=editing?'Your setup.':kit.name;
    $('#kit-description').textContent=editing?'The parts, the plan, and what you make of it.':'A setup you can make your own.';
    document.title=`${editing?'Share your setup':kit.name} — gadgets.sh`;
    if(fields)for(const key of ['name','author','story','parts','project','photo'])$(`#kit-${key}`).value=editing?draft[key]:'';
    $('#kit-objects').innerHTML=kitCards(kit,catalog,editing);
    $('#kit-empty').hidden=Boolean(kit.devices.length || kit.parts || kit.story);
    $('#kit-empty h2').textContent=shared?'This setup is empty.':'Start with one device.';
    $('#kit-empty p').textContent=shared?'This link has no build notes or recognized devices. Remix it to start your own setup.':'Choose it above or find something in the catalog.';
    $('#kit-count').textContent=`${kit.devices.length} ${kit.devices.length===1?'device':'devices'}${editing?` / ${KIT_LIMIT}`:''}`;
    $('#setup-story').hidden=editing;
    $('#setup-author').textContent=kit.author?`Shared by ${kit.author}`:'Shared setup · creator not named';
    $('#setup-description').textContent=kit.story;
    $('#setup-origin').hidden=!kit.from && !kit.origin;$('#setup-origin').textContent=[kit.from?`Remixed from ${kit.from}`:'',kit.origin && kit.origin!==kit.from?`Earlier version: ${kit.origin}`:''].filter(Boolean).join(' · ');
    $('#setup-project').hidden=!kit.project;if(kit.project)$('#setup-project').href=kit.project;
    $('#setup-other-parts').hidden=editing || !kit.parts;$('#setup-other-parts').textContent=kit.parts?`Other parts & modifications: ${kit.parts}`:'';
    if(editing){
      $('#kit-device').innerHTML='<option value="">Choose a device…</option>'+sortDevices(catalog,'name').filter(d=>!draft.devices.includes(d.slug)).map(d=>`<option value="${d.slug}">${e(d.name)}</option>`).join('');
      const full=draft.devices.length>=KIT_LIMIT;
      $('#kit-device').disabled=full;$('#kit-picker button').disabled=full;
      $('#kit-picker-help').textContent=full?'Six devices selected. Remove one to add another.':'Up to six devices. Add custom parts in your build notes.';
    }
    renderPhoto();shareActions();readiness();recoveryState();
  }
  function change(id) {
    const result=toggleKit(draft,id,catalog);
    if(result.reason==='full'){notify('Your setup has six devices. Remove one on your setup page to add another.');return;}
    if(result.reason==='unknown')return;
    draft=result.kit;persist();render();
  }
  document.addEventListener('click',event=>{
    const add=event.target.closest('[data-kit]');if(add){change(add.dataset.kit);return;}
    const remove=event.target.closest('[data-remove-kit]');if(remove && !shared){change(remove.dataset.removeKit);$('#kit-device').focus();}
  });
  if(isBuilder){
    const restoreButton=$('#undo-reset-kit');
    $('#kit-objects').addEventListener('change',event=>{
      const field=event.target;
      if(field.hasAttribute('data-part-link')){validatePartLink(field);return;}
      const id=field.dataset.partQuantity || field.dataset.partState || field.dataset.partAffiliate;
      if(!id || shared)return;
      const changes=field.hasAttribute('data-part-quantity')?{quantity:Number(field.value)}:field.hasAttribute('data-part-affiliate')?{affiliate:field.checked}:{state:field.value};
      draft=updateKitPart(draft,id,changes,catalog);persist();shareActions();readiness();
      if(field.hasAttribute('data-part-quantity'))field.value=partDetails(draft.items[id]).quantity;
    });
    $('#kit-objects').addEventListener('input',event=>{
      const field=event.target,id=field.dataset.partNote || field.dataset.partLink;if(!id || shared)return;
      draft=updateKitPart(draft,id,field.hasAttribute('data-part-note')?{note:field.value}:{link:field.value},catalog);persist();shareActions();
      if(field.hasAttribute('data-part-link') && field.hasAttribute('aria-invalid'))validatePartLink(field);
    });
    function validatePartLink(field){
      const invalid=Boolean(field.value.trim() && !safeURL(field.value));
      field.setAttribute('aria-invalid',String(invalid));
      $(`#part-link-help-${field.dataset.partLink}`).textContent=invalid?'Enter a complete HTTP or HTTPS link without a username or password.':'Use your shop link or an affiliate link approved for this page.';
    }
    $('#reset-kit').addEventListener('click',()=>{
      if(shared)return;
      rememberDraft();draft=normalizeKit(null,catalog);persist();render(true);$('#kit-name').focus();
      if(stored && previousDraft)notify('New setup started. You can restore your previous setup.');
    });
    restoreButton.addEventListener('click',()=>{
      if(!previousDraft || shared)return;
      draft=previousDraft;previousDraft=null;persist();render(true);$('#kit-name').focus();
      if(stored)notify('Previous setup restored and saved in this browser.');
    });
    $('#kit-picker').addEventListener('submit',event=>{event.preventDefault();const id=$('#kit-device').value;if(id)change(id);else {notify('Choose a device first.');$('#kit-device').focus();}});
    for(const key of ['name','author','story','parts','project','photo']){
      const field=$(`#kit-${key}`);
      field.addEventListener('input',()=>{
        draft=normalizeKit({...draft,[key]:field.value},catalog);persist();shareActions();sync();
        if(key==='name')renderPhoto();
        if(field.hasAttribute('aria-invalid'))validateField(key);
      });
      if(['photo','project'].includes(key))field.addEventListener('change',()=>{validateField(key);renderPhoto();});
    }
    function validateField(key){
      if(!['photo','project'].includes(key))return;
      const field=$(`#kit-${key}`),invalid=field.value.trim() && !safeURL(field.value,key==='photo');
      field.setAttribute('aria-invalid',String(Boolean(invalid)));
      $(`#kit-${key}-help`).textContent=invalid?`Enter a complete ${key==='photo'?'HTTPS image':'HTTP or HTTPS'} URL without a username or password.`:key==='photo'?'Link a public image here. Use Create a post to choose a photo from your device.':'Link to the instructions, repository or a video of it working.';
    }
    $('#setup-image').addEventListener('error',()=>{$('#setup-image').hidden=true;$('#setup-photo-status').textContent='This photo could not load. The build note and hardware are still available.';});
    $('#setup-image').addEventListener('load',()=>{$('#setup-image').hidden=false;$('#setup-photo-status').textContent='Photo supplied by the setup creator.';});
    $('#remix-kit').addEventListener('click',()=>{
      if(!shared)return;
      rememberDraft();draft=remixKit(shared,catalog);shared=null;history.pushState(null,'','/setup/');persist();render(true);$('#kit-name').focus();
      if(stored)notify(previousDraft?'Remix saved. You can restore your previous setup.':'Remix saved. Make it yours.');
    });
    $('#copy-kit').addEventListener('click',async()=>{
      if($('#copy-kit').disabled)return;
      const url=new URL(kitURL(current()),location.origin).href,button=$('#copy-kit');
      const notice=shareLinkNotice(url);
      $('#kit-export-menu').close();$('#export-kit').focus();
      button.disabled=true;
      try {
        if(navigator.share){
          try {await navigator.share({title:current().name,text:notice || 'The parts and notes behind this hardware setup.',url});return;}
          catch(error){if(error.name==='AbortError')return;}
        }
        await navigator.clipboard.writeText(url);notify(notice?`Link copied. ${notice}`:'Setup link copied. It includes your parts and notes.');
      }
      catch {$('#kit-share-url').value=url;$('#kit-share-notice').textContent=notice;$('#kit-share-notice').hidden=!notice;$('#kit-share-fallback').showModal();$('#kit-share-url').focus();$('#kit-share-url').select();}
      finally {shareActions();}
    });
    let setupCardDialog;
    $('#export-kit').addEventListener('click',()=>$('#kit-export-menu').showModal());
    $('#export-card').addEventListener('click',async()=>{
      if($('#export-card').disabled)return;
      const input={kit:current(),catalog,shareURL:new URL(kitURL(current()),location.origin).href};
      $('#kit-export-menu').close();$('#export-card').focus();
      try {
        if(!setupCardDialog){const {initSetupCardDialog}=await import('./setup-card.js');setupCardDialog=initSetupCardDialog();}
        await setupCardDialog.open(input);
      }catch {notify('The image exporter could not open. You can still export your parts list or share the setup link.');}
    });
    $('#download-kit').addEventListener('click',()=>{
      if($('#download-kit').disabled)return;
      $('#kit-export-menu').close();
      try {
        const url=URL.createObjectURL(new Blob([kitMarkdown(current(),catalog)],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');
        link.href=url;link.download=`${current().name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'hardware-setup'}-parts.md`;
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        notify('Parts list download started, with your notes and maker links.');
      } catch {notify('The download could not start. Share your setup link to keep your notes.');}
    });
    const restoreShared=()=>{shared=kitFromURL(location.search,catalog,location.hash);render(true);};
    window.addEventListener('popstate',restoreShared);
    window.addEventListener('hashchange',restoreShared);
  }
  window.addEventListener('storage',event=>{
    if(event.key!=='gadgets.kit' && event.key!==null)return;
    if(!stored){
      notify('Another tab changed the saved setup. Your unsaved changes are kept here; export them before leaving.');
      return;
    }
    draft=read();render(true);
  });
  render(true);
  return {sync};
}
