import {INVENTORY_KEY,readInventory,normalizeInventory,setInventoryQuantity,importKitInventory,inventoryHardware} from './inventory.mjs';
import {buildHardwareSearch,readBuildHardware} from './build-projects.mjs';

const editableStatuses=new Set(['missing','ready']);

export function initInventory(catalog,notify=()=>{}) {
  const section=document.querySelector('#my-hardware');
  if(!section || section.dataset.inventoryInitialized==='true')return;
  section.dataset.inventoryInitialized='true';
  const $=selector=>section.querySelector(selector),devices=new Map(catalog.map(device=>[device.slug,device]));
  const form=$('[data-inventory-form]'),fields=$('[data-inventory-fields]'),picker=$('#inventory-device'),quantity=$('#inventory-quantity');
  const list=$('[data-inventory-list]'),status=$('[data-inventory-status]'),builds=$('[data-inventory-builds]');
  let inventory=null,baselineRaw=null,blocked=true,dirty=false,conflict=false,lastRemoved=null,searchHref='';

  function readStored() {
    let raw=null;
    const result=readInventory({getItem(key){raw=localStorage.getItem(key);return raw;}},catalog);
    return {...result,raw};
  }
  function report(message,error=false) {
    status.textContent=message;status.dataset.error=String(error);
  }
  function blockedMessage(state) {
    if(state==='unsupported')return 'This hardware list uses a newer format. Editing is paused to preserve it.';
    if(state==='invalid')return 'The saved hardware list could not be read. Editing is paused so it is not overwritten.';
    return 'Browser storage is unavailable. Editing is paused; try reading it again.';
  }
  function updateSearch() {
    const known=inventory?inventoryHardware(inventory,catalog):{},entries=Object.entries(known);
    searchHref='';
    let tooLarge=false;
    if(entries.length){
      const search=buildHardwareSearch('',known,catalog),roundTrip=readBuildHardware(search,catalog);
      tooLarge=entries.length>100 || search.length>5000 || Object.keys(roundTrip).length!==entries.length || entries.some(([slug,amount])=>roundTrip[slug]!==amount);
      if(!tooLarge)searchHref=`/builds/${search}#build-finder`;
    }
    builds.disabled=!searchHref;builds.dataset.inventoryHref=searchHref;
    $('[data-inventory-link-warning]').hidden=!tooLarge;
  }
  function controls() {
    fields.disabled=blocked;
    $('[data-inventory-import]').disabled=blocked;
    for(const input of list.querySelectorAll('input,button'))input.disabled=blocked;
    $('[data-inventory-retry]').hidden=!dirty && !blocked;
    $('[data-inventory-retry]').disabled=conflict;
    $('[data-inventory-retry]').textContent=dirty?'Try saving again':'Try reading again';
    $('[data-inventory-download]').hidden=!inventory || !dirty;
    $('[data-inventory-undo]').hidden=!lastRemoved;
    $('[data-inventory-undo]').disabled=blocked;
    updateSearch();
  }
  function element(tag,className,text='') {
    const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
  }
  function renderRows(focusSlug) {
    const entries=Object.entries(inventory?.quantities || {}).sort(([a],[b])=>(devices.get(a)?.name || a).localeCompare(devices.get(b)?.name || b));
    const fragment=document.createDocumentFragment();
    for(const [slug,amount] of entries){
      const device=devices.get(slug),name=device?.name || slug,row=element('li','inventory-row');
      const photo=element('span','inventory-photo',device?'':'—');photo.setAttribute('aria-hidden','true');
      if(device?.image && /^\/assets\/[a-z0-9-]+\.(?:png|jpg|webp|avif)$/.test(device.image)){
        const img=document.createElement('img');img.src=device.image;img.alt='';img.loading='lazy';img.width=64;img.height=64;
        img.addEventListener('error',()=>{img.remove();photo.textContent='—';},{once:true});photo.append(img);
      } else photo.textContent='—';
      const description=element('div','inventory-name'),title=element(device?'a':'strong','',name);
      if(device)title.href=`/devices/${slug}/`;
      description.append(title);
      if(!device)description.append(element('p','','Unavailable in the current catalog. Kept here, excluded from build matching.'));
      const input=document.createElement('input');Object.assign(input,{id:`inventory-owned-${slug}`,type:'number',min:'1',max:'99',step:'1',inputMode:'numeric',value:String(amount),required:true});
      input.dataset.inventoryQuantity=slug;input.setAttribute('aria-label',`Owned quantity of ${name}`);
      const remove=element('button','inventory-remove','×');remove.type='button';remove.dataset.inventoryRemove=slug;remove.setAttribute('aria-label',`Remove ${name} from my hardware`);
      row.append(photo,description,input,remove);fragment.append(row);
    }
    list.replaceChildren(fragment);
    const total=entries.reduce((sum,[,amount])=>sum+amount,0),unknown=entries.filter(([slug])=>!devices.has(slug)).length;
    $('[data-inventory-summary]').textContent=inventory?`${entries.length} ${entries.length===1?'model':'models'} · ${total} ${total===1?'unit':'units'}${unknown?` · ${unknown} unavailable to match`:''}`:'';
    $('[data-inventory-empty]').hidden=!inventory || entries.length>0;
    controls();
    if(focusSlug)$(`#inventory-owned-${focusSlug}`)?.focus({preventScroll:true});
  }
  function load() {
    const result=readStored();inventory=result.inventory;baselineRaw=result.raw;blocked=!editableStatuses.has(result.status);dirty=false;conflict=false;lastRemoved=null;
    report(blocked?blockedMessage(result.status):result.status==='missing'?'Add hardware you own. Nothing is saved until you make a change.':'Saved in this browser.',blocked);
    renderRows();
  }
  function persist(successMessage) {
    const current=readStored();
    if(!editableStatuses.has(current.status)){
      blocked=true;report(`${blockedMessage(current.status)} Your unsaved list is kept on this page.`,true);controls();return false;
    }
    if(current.raw!==baselineRaw){
      conflict=true;blocked=true;report('Another tab changed the saved list. Your unsaved list is kept here. Download it before reloading to review the saved version.',true);controls();return false;
    }
    try {
      const raw=JSON.stringify(inventory);localStorage.setItem(INVENTORY_KEY,raw);baselineRaw=raw;dirty=false;blocked=false;conflict=false;
      report(successMessage || 'Saved in this browser.');controls();return true;
    }catch {
      report('This change is not saved. Your list is kept on this page; try saving again or download it before leaving.',true);controls();return false;
    }
  }
  function change(next,message,{removed=null,focusSlug}={}) {
    inventory=next;dirty=true;lastRemoved=removed;renderRows(focusSlug);persist(message);
  }

  const options=document.createDocumentFragment();
  for(const device of [...devices.values()].filter(device=>device.status!=='concept').sort((a,b)=>a.name.localeCompare(b.name))){
    const option=document.createElement('option');option.value=device.slug;option.textContent=device.name;options.append(option);
  }
  picker.append(options);
  picker.addEventListener('change',()=>{
    const amount=inventory?.quantities[picker.value];quantity.value=String(amount || 1);
    $('[data-inventory-add]').textContent=amount?'Update quantity':'Add hardware';
  });
  form.addEventListener('submit',event=>{
    event.preventDefault();if(blocked || !form.reportValidity())return;
    const slug=picker.value,amount=Number(quantity.value);
    try {
      change(setInventoryQuantity(inventory,slug,amount,catalog),`${devices.get(slug).name}: ${amount} owned. Saved in this browser.`);
      picker.value='';quantity.value='1';$('[data-inventory-add]').textContent='Add hardware';picker.focus();
    }catch {report('Choose a catalog device and a whole-number quantity from 1 to 99.',true);}
  });
  list.addEventListener('change',event=>{
    const input=event.target.closest('[data-inventory-quantity]');if(!input || blocked)return;
    const slug=input.dataset.inventoryQuantity;
    if(!input.checkValidity()){
      input.reportValidity();input.value=String(inventory.quantities[slug]);report('Use a whole-number quantity from 1 to 99. Your previous quantity is unchanged.',true);return;
    }
    try {change(setInventoryQuantity(inventory,slug,Number(input.value),catalog),'Quantity saved in this browser.',{focusSlug:slug});}
    catch {report('This quantity could not be updated. Your previous quantity is unchanged.',true);input.value=String(inventory.quantities[slug]);}
  });
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-inventory-remove]');if(!button || blocked)return;
    const slug=button.dataset.inventoryRemove,amount=inventory.quantities[slug];
    try {
      change(setInventoryQuantity(inventory,slug,0,catalog),`${devices.get(slug)?.name || slug} removed. You can undo this removal.`,{removed:{slug,amount}});
      $('[data-inventory-undo]').focus();
    }catch {report('This device could not be removed. Your list is unchanged.',true);}
  });
  $('[data-inventory-undo]').addEventListener('click',()=>{
    if(blocked || !lastRemoved)return;
    const {slug,amount}=lastRemoved;
    // This also restores a previously stored unknown slug without inventing one.
    const restored=normalizeInventory({...inventory,quantities:{...inventory.quantities,[slug]:amount}});
    if(restored)change(restored,'Removal undone. Saved in this browser.',{focusSlug:slug});
  });
  $('[data-inventory-import]').addEventListener('click',()=>{
    if(blocked)return;
    let result;
    try {
      const raw=localStorage.getItem('gadgets.kit');if(raw && raw.length>100000)throw new Error('Setup too large');
      result=importKitInventory(inventory,raw?JSON.parse(raw):null,catalog);
    }catch {report('Your setup could not be read. This hardware list is unchanged.',true);return;}
    if(!result.added.length){report(result.kept.length?'Those devices are already on your list. Their quantities are unchanged.':'No additional “Have it” devices were found in your current setup.');return;}
    change(result.inventory,`Added ${result.added.length} ${result.added.length===1?'model':'models'} from your setup.${result.kept.length?' Existing quantities are unchanged.':''} Saved in this browser.`);
  });
  builds.addEventListener('click',()=>{if(searchHref)location.assign(searchHref);});
  $('[data-inventory-retry]').addEventListener('click',()=>{
    if(conflict)return;
    if(dirty)persist();else load();
  });
  $('[data-inventory-download]').addEventListener('click',()=>{
    if(!inventory)return;
    try {
      const url=URL.createObjectURL(new Blob([`${JSON.stringify(inventory,null,2)}\n`],{type:'application/json'})),link=document.createElement('a');
      link.href=url;link.download='gadgets-my-hardware.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      notify('Hardware list download started. Browser storage has not changed.');
    }catch {report('The download could not start. Keep this page open to retain unsaved changes.',true);}
  });
  window.addEventListener('storage',event=>{
    if(event.key!==INVENTORY_KEY && event.key!==null)return;
    if(dirty){
      conflict=true;blocked=true;report('Another tab changed the saved list. Your unsaved list is kept here. Download it before reloading to review the saved version.',true);controls();return;
    }
    load();
  });
  load();
  return {refresh(){if(!dirty)load();}};
}
