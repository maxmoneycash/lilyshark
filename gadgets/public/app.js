import { categories, statuses, tasks, formats, capabilities, sorts, readFilters, filterDevices, sortDevices, filterURL, selection, readSaved, resolveComparison, escapeHTML as e } from './catalog.mjs';
import { deviceCard, compareTable, icons } from './templates.mjs';
import {initKits} from './kits.js';
import {isOfferCurrent} from './offers.mjs';
import {CATALOG_VISIT_KEY,readCatalogVisit} from './catalog-visit.mjs';
import {shareLinkNotice} from './share-links.mjs';

const $=selector=>document.querySelector(selector);
const page=document.body.dataset.page;
const offerPanels=[...document.querySelectorAll('[data-offer-review-after]')];
function refreshOffers(){for(const panel of offerPanels)panel.hidden=!isOfferCurrent({checked:panel.dataset.offerChecked,reviewAfter:panel.dataset.offerReviewAfter});}
if(offerPanels.length){
  refreshOffers();
  window.addEventListener('pageshow',refreshOffers);
  document.addEventListener('visibilitychange',refreshOffers);
  const nextDay=new Date();nextDay.setUTCHours(24,0,1,0);
  setTimeout(function daily(){refreshOffers();setTimeout(daily,86_400_000);},nextDay-Date.now());
}
function revealDetails(hash) {
  let id; try { id=decodeURIComponent(hash.slice(1)); } catch { return; }
  let node=document.getElementById(id);
  while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}
}
revealDetails(location.hash);
window.addEventListener('hashchange',()=>revealDetails(location.hash));
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');
  if(link)revealDetails(link.hash);
});
let catalog=[],saved=[],compared=[],initialCompared=[],comparisonHeading,comparisonIntro,comparisonTitle,toastTimer,kits,carousel;
function notify(message){clearTimeout(toastTimer);$('#toast').textContent=message;toastTimer=setTimeout(()=>{$('#toast').textContent='';},4200);}
function persist(key,value){try{localStorage.setItem(`gadgets.${key}`,JSON.stringify(value));return true;}catch{notify('Browser storage is unavailable. Changes will last for this page only.');return false;}}
function readCompared(){try{return selection(JSON.parse(localStorage.getItem('gadgets.compare') || '[]'),catalog,3);}catch{return [];}}
function syncButtons(){
  document.querySelectorAll('[data-save]').forEach(button=>{
    const selected=saved.includes(button.dataset.save),d=catalog.find(d=>d.slug===button.dataset.save);
    if(!d)return;
    button.setAttribute('aria-pressed',String(selected));
    const label=button.querySelector('[data-save-label]');
    if(label){label.textContent=selected?'Remove from shortlist':'Save to shortlist';button.setAttribute('aria-label',`${label.textContent}: ${d.name}`);}
    else button.setAttribute('aria-label',`${selected?'Remove':'Save'} ${d.name} ${selected?'from':'to'} shortlist`);
  });
  document.querySelectorAll('[data-compare]').forEach(button=>{
    const selected=compared.includes(button.dataset.compare),d=catalog.find(d=>d.slug===button.dataset.compare);
    if(!d)return;
    button.setAttribute('aria-pressed',String(selected));
    button.setAttribute('aria-label',`${selected?'In comparison:':'Compare'} ${d.name}${selected?'. Select to remove.':''}`);
    button.querySelector('[data-compare-label]').textContent=selected?'In comparison':'Compare';
    button.querySelector('.compare-box').innerHTML=selected?icons.check:icons.plus;
  });
  kits?.sync();
  $('[data-saved-count]').textContent=saved.length?String(saved.length):'';
  $('[data-compare-count]').textContent=compared.length?String(compared.length):'';
  const href=compared.length?`/compare/?devices=${compared.join(',')}`:'/compare/';
  $('.nav-compare').href=href;$('#tray-link').href=href;
  const show=page==='saved' && document.body.dataset.savedView!=='hardware' && compared.length>0;
  $('#compare-tray').hidden=!show;document.body.classList.toggle('has-comparison',show);
  $('[data-tray-count]').textContent=String(compared.length);
  $('#tray-items').innerHTML=compared.map(id=>{const d=catalog.find(d=>d.slug===id);return `<div class="tray-item"><span>${e(d.name)}</span><button type="button" data-remove-compare="${id}" aria-label="Remove ${e(d.name)} from comparison">${icons.close}</button></div>`;}).join('');
}
function refreshSaved(){
  if(page!=='saved')return;
  const devices=saved.map(id=>catalog.find(d=>d.slug===id));
  $('#saved-feed').innerHTML=devices.map((d,i)=>deviceCard(d,i,devices.length)).join('');
  $('#saved-empty').hidden=devices.length>0;$('#saved-feed').hidden=!devices.length;
  $('#saved-summary').textContent=devices.length?`${devices.length} saved ${devices.length===1?'device':'devices'}`:'';
}
function refreshSavedView(){
  if(page!=='saved')return;
  const hardware=new URLSearchParams(location.search).get('view')==='hardware';
  document.body.dataset.savedView=hardware?'hardware':'shortlist';
  $('#saved-shortlist').hidden=hardware;
  $('#my-hardware').hidden=!hardware;
  for(const link of document.querySelectorAll('[data-saved-view]')){
    if(link.dataset.savedView===document.body.dataset.savedView)link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  document.title=`${hardware?'My hardware':'Saved hardware'} — gadgets.sh`;
  syncButtons();
}
function refreshCompare(writeURL=false){
  if(page!=='compare')return;
  if(writeURL)history.pushState(null,'',`/compare/?devices=${compared.join(',')}`);
  const preset=$('[data-initial-compare]')?.dataset.initialCompare;
  const changed=preset && compared.join(',')!==preset;
  $('main h1').textContent=changed?'Which one fits?':comparisonHeading;
  $('main .intro').textContent=changed?'Compare the setup, the tradeoffs, then the specifications.':comparisonIntro;
  document.title=changed?'Compare your options — gadgets.sh':comparisonTitle;
  const devices=compared.map(id=>catalog.find(d=>d.slug===id));
  $('#comparison-result').innerHTML=devices.length?compareTable(devices):'';
  $('#compare-empty').hidden=devices.length>0;$('#share-comparison').hidden=!devices.length;
  $('#compare-device').innerHTML='<option value="">Choose a device…</option>'+sortDevices(catalog,'name').filter(d=>!compared.includes(d.slug)).map(d=>`<option value="${d.slug}">${e(d.name)}</option>`).join('');
  $('#compare-picker button').disabled=devices.length>=3;$('#compare-device').disabled=devices.length>=3;
  $('#compare-picker label').textContent=devices.length>=3?'Three devices selected. Remove one to add another.':'Add a device';
  $('#comparison-result').classList.toggle('show-differences',$('#differences-only').checked);
  syncButtons();
}
function changeCompare(id,remove=false){
  if(!catalog.some(d=>d.slug===id))return;
  if(remove || compared.includes(id))compared=compared.filter(s=>s!==id);
  else if(compared.length<3)compared=[...compared,id];
  else{notify('Compare up to three devices. Remove a selection to add another.');return;}
  const kept=persist('compare',compared);refreshCompare(true);syncButtons();
  if(kept)notify(compared.includes(id)?'Added to comparison.':'Removed from comparison.');
}
function refreshCatalog(){
  if(page!=='catalog')return;
  const filters=readFilters(location.search),found=sortDevices(filterDevices(catalog,filters),filters.sort),ids=new Set(found.map(d=>d.slug));

  const cards=new Map([...document.querySelectorAll('#device-feed [data-device]')].map(card=>[card.dataset.device,card]));
  cards.forEach((card,id)=>{card.hidden=!ids.has(id);});
  found.forEach(d=>$('#device-feed').append(cards.get(d.slug)));
  $('#device-feed').className=`device-feed ${filters.view}`;
  $('#result-count').textContent=`${found.length} ${found.length===1?'device':'devices'}${filters.task!=='all'?` · ${tasks[filters.task].label}`:''}`;
  $('#no-results').hidden=found.length>0;$('#device-feed').hidden=!found.length || filters.view==='carousel';
  carousel?.update(found,filters.view);
  $('input[name=q]').value=filters.q;
  for(const key of ['status','format','category','sort','capability']){const control=$(`select[name="${key}"]`);if(control)control.value=filters[key];}
  $('input[name=checked]').checked=filters.checked;
  document.querySelectorAll('[data-task-filter]').forEach(link=>{const active=link.dataset.taskFilter===filters.task;if(active)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current');link.href=filterURL({...filters,task:link.dataset.taskFilter});});
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===filters.view)));
  const task=tasks[filters.task];$('#task-context').hidden=filters.task==='all';
  if(filters.task!=='all'){$('#task-title').textContent=task.title;$('#task-description').textContent=task.description;$('#task-guide').href=`/guides/${filters.task}/`;}
  const active=[];
  if(filters.q)active.push(['q',`Search: ${filters.q}`]);
  for(const [key,map] of [['category',categories],['format',formats],['status',statuses],['capability',capabilities]])if(filters[key] && filters[key]!=='all')active.push([key,map[filters[key]]]);
  if(filters.checked)active.push(['checked','Source checked']);
  $('#active-filters').innerHTML=active.map(([key,label])=>`<button class="filter-chip" type="button" data-clear-filter="${key}" aria-label="Remove filter: ${e(label)}">${e(label)} ${icons.close}</button>`).join('');
  $('#filter-count').textContent=active.length?`(${active.length})`:'';
}
function updateFilters(values,replace=false){const filters={...readFilters(location.search),...values};history[replace?'replaceState':'pushState'](null,'',filterURL(filters));refreshCatalog();}
function guideProgress(){
  if(page!=='guide')return;
  const slug=$('[data-guide]').dataset.guide,boxes=[...document.querySelectorAll('[data-guide-step]')];
  let progress=[];
  try{progress=selection(JSON.parse(localStorage.getItem(`gadgets.guide.${slug}`) || '[]'),boxes.map(b=>({slug:b.dataset.guideStep})));}catch{}
  boxes.forEach(box=>{box.checked=progress.includes(box.dataset.guideStep);});
  $('[data-checklist-progress]').textContent=`${progress.length} of ${boxes.length} steps complete`;
}
async function init(){
  if(page==='discover' && [...new URLSearchParams(location.search).keys()].some(key=>['q','task','category','format','status','capability','checked','sort','view'].includes(key))){location.replace(`/hardware/${location.search}${location.hash}`);return;}
  if(page==='discover' && location.hash==='#directory'){location.replace('/hardware/');return;}
  const response=await fetch('/catalog.json');if(!response.ok)throw new Error('Catalog request failed');catalog=await response.json();
  try{saved=readSaved(localStorage,catalog);}catch{saved=[];}
  const params=new URLSearchParams(location.search),preset=$('[data-initial-compare]')?.dataset.initialCompare;
  initialCompared=preset?selection(preset.split(','),catalog,3):readCompared();
  compared=page==='compare'?resolveComparison(location.search,catalog,initialCompared):initialCompared;
  if(page==='compare'){comparisonHeading=$('main h1').textContent;comparisonIntro=$('main .intro').textContent;comparisonTitle=document.title;}
  if(page==='compare' && (params.has('devices') || preset))persist('compare',compared);
  if(page==='catalog'){
    $('#filter-panel').open=false;
    const {initHardwareCarousel}=await import('./hardware-carousel.js');
    carousel=initHardwareCarousel();
  }
  refreshCatalog();refreshSaved();refreshCompare();guideProgress();syncButtons();
  kits=initKits(catalog,notify);
  if(page==='saved'){
    const {initInventory}=await import('./inventory.js');
    initInventory(catalog,notify);
    refreshSavedView();
    $('.saved-views').addEventListener('click',event=>{
      const link=event.target.closest('[data-saved-view]');
      if(!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button!==0)return;
      event.preventDefault();
      const params=new URLSearchParams(location.search);
      if(link.dataset.savedView==='hardware')params.set('view','hardware');else params.delete('view');
      history.pushState(null,'',`/saved/${params.size?'?'+params:''}`);
      refreshSavedView();
    });
  }
  if(page==='device'){
    try {
      const referrer=new URL(document.referrer),visit=readCatalogVisit(sessionStorage.getItem(CATALOG_VISIT_KEY),catalog);
      if(visit && referrer.origin===location.origin && referrer.pathname==='/hardware/' && visit.href===filterURL(readFilters(referrer.search)))$('.device-back-row a').href=visit.href;
    }catch { /* Direct arrivals use the ordinary Hardware link. */ }
    const groups=[...document.querySelectorAll('.device-spec-group')];
    let openBeforeSearch;
    $('#spec-search')?.addEventListener('input',event=>{
      const query=event.target.value.trim().toLocaleLowerCase();
      if(query&&!openBeforeSearch)openBeforeSearch=groups.map(group=>group.open);
      let matches=0;
      for(const [index,group] of groups.entries()){
        let visible=0;
        for(const row of group.querySelectorAll('[data-spec-row]')){
          row.hidden=Boolean(query&&!row.textContent.toLocaleLowerCase().includes(query));
          if(!row.hidden)visible++;
        }
        matches+=visible;group.hidden=!visible;
        if(query)group.open=Boolean(visible);
        else if(openBeforeSearch)group.open=openBeforeSearch[index];
      }
      if(!query)openBeforeSearch=null;
      $('#spec-no-results').hidden=Boolean(matches);
      $('#spec-search-status').textContent=query?`${matches} matching specifications`:'';
    });
  }
  document.addEventListener('click',async event=>{
    const copyOffer=event.target.closest('[data-copy-offer]');
    if(copyOffer){
      refreshOffers();
      if(copyOffer.closest('[data-offer-review-after]').hidden){notify('This offer needs a fresh source check. Visit the maker for current promotions.');return;}
      try {await navigator.clipboard.writeText(copyOffer.dataset.copyOffer);notify('Maker code copied. Check eligibility at checkout.');}
      catch {const code=copyOffer.parentElement.querySelector('code'),range=document.createRange();range.selectNodeContents(code);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);notify('Select and copy the code shown.');}
      return;
    }
    const share=event.target.closest('[data-share-device]');
    if(share){
      const device=catalog.find(d=>d.slug===share.dataset.shareDevice);
      if(!device)return;
      const url=new URL(`/devices/${device.slug}/`,location.origin).href;
      const notice=shareLinkNotice(url);
      try {
        if(navigator.share){await navigator.share({title:device.name,...(notice?{text:notice}:{}),url});return;}
        await navigator.clipboard.writeText(url);notify(notice?`Link copied. ${notice}`:'Device link copied.');
      } catch(error) {
        if(error.name==='AbortError')return;
        const dialog=$('#share-device-dialog');
        $('#share-device-url').value=url;
        $('#share-device-notice').textContent=notice;$('#share-device-notice').hidden=!notice;
        dialog.showModal();$('#share-device-url').select();
      }
      return;
    }
    if(event.target.closest('[data-surprise]')){const finds=catalog.filter(d=>d.image && d.verified && !d.owned);location.href=`/devices/${finds[Math.floor(Math.random()*finds.length)].slug}/`;return;}
    const save=event.target.closest('[data-save]');
    if(save){const id=save.dataset.save,wasSaved=saved.includes(id);saved=wasSaved?saved.filter(s=>s!==id):[...saved,id];const kept=persist('saved',saved);refreshSaved();syncButtons();if(page==='saved')(document.querySelector('[data-save]') || $('#saved-empty a'))?.focus();if(kept)notify(wasSaved?'Removed from your shortlist.':'Saved to your shortlist.');return;}
    const compare=event.target.closest('[data-compare]');if(compare){changeCompare(compare.dataset.compare);return;}
    const remove=event.target.closest('[data-remove-compare]');if(remove){changeCompare(remove.dataset.removeCompare,true);if(page==='compare')$('#compare-device').focus();else ($('#compare-tray:not([hidden]) a') || $('.nav-compare')).focus();return;}
    const task=event.target.closest('[data-task-filter]');if(task && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button===0){event.preventDefault();updateFilters({task:task.dataset.taskFilter});return;}
    const view=event.target.closest('[data-view]');if(view){updateFilters({view:view.dataset.view});return;}
    const clear=event.target.closest('[data-clear-filter]');if(clear){const key=clear.dataset.clearFilter;updateFilters({[key]:key==='q'?'':key==='checked'?false:'all'});$('input[name=q]').focus();return;}
    if(event.target.closest('[data-reset-filters]')){updateFilters({q:'',task:'all',category:'all',format:'all',status:'all',capability:'all',checked:false});$('input[name=q]').focus();}
  });
  if(page==='catalog'){
    $('input[name=q]').addEventListener('input',event=>updateFilters({q:event.target.value},true));
    $('.search-form').addEventListener('submit',event=>{event.preventDefault();updateFilters({q:$('input[name=q]').value},true);});
    $('#facet-form').addEventListener('submit',event=>event.preventDefault());
    for(const key of ['status','format','category','sort','capability'])$(`select[name="${key}"]`)?.addEventListener('change',event=>updateFilters({[key]:event.target.value}));
    $('input[name=checked]').addEventListener('change',event=>updateFilters({checked:event.target.checked}));
  }
  if(page==='compare'){
    $('#compare-picker').addEventListener('submit',event=>{event.preventDefault();const id=$('#compare-device').value;if(id)changeCompare(id);else notify('Choose a device first.');});
    $('#differences-only').addEventListener('change',event=>$('#comparison-result').classList.toggle('show-differences',event.target.checked));
    $('#share-comparison').addEventListener('click',async()=>{const url=`${location.origin}/compare/?devices=${compared.join(',')}`;try{await navigator.clipboard.writeText(url);notify(shareLinkNotice(url)?`Link copied. ${shareLinkNotice(url)}`:'Comparison link copied.');}catch{history.replaceState(null,'',url);notify(shareLinkNotice(url) || 'Copy this page’s address to share the comparison.');}});
  }
  if(page==='guide'){
    document.querySelectorAll('[data-guide-step]').forEach(box=>box.addEventListener('change',()=>{const boxes=[...document.querySelectorAll('[data-guide-step]')],progress=boxes.filter(b=>b.checked).map(b=>b.dataset.guideStep);persist(`guide.${$('[data-guide]').dataset.guide}`,progress);$('[data-checklist-progress]').textContent=`${progress.length} of ${boxes.length} steps complete`;}));
  }
  window.addEventListener('popstate',()=>{refreshCatalog();refreshSavedView();if(page==='compare'){compared=resolveComparison(location.search,catalog,initialCompared);persist('compare',compared);refreshCompare();}});
  window.addEventListener('storage',event=>{if(event.key==='gadgets.saved' || event.key===null){try{saved=readSaved(localStorage,catalog);}catch{saved=[];}refreshSaved();syncButtons();}if((event.key==='gadgets.compare' || event.key===null) && page!=='compare'){compared=readCompared();syncButtons();}if(event.key?.startsWith('gadgets.guide.') || event.key===null)guideProgress();});
}
init().catch(error=>{console.error(error);notify('Interactive tools could not load. Reload to try again. Device pages and guides are still available.');});
