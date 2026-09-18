import React, { createRoot } from './carousel/runtime.js';
import VerticalCarousel from './carousel/VerticalCarousel.js';
import { carouselWindow, wrapIndex } from './carousel-window.mjs';
import { categories,filterURL,readFilters } from './catalog.mjs';
import { CATALOG_VISIT_KEY,readCatalogVisit,catalogReturnIndex } from './catalog-visit.mjs';
import { kitButton, saveButton, compareDeviceLink, shareDeviceButton, icons } from './templates.mjs';

export function initHardwareCarousel() {
  const $ = selector => document.querySelector(selector);
  const host = $('#hardware-carousel'), stage = $('#carousel-stage'), actions = $('#carousel-actions');
  const shadow = stage.attachShadow({mode:'open'}), style = document.createElement('style'), mount = document.createElement('div');
  style.textContent = ':host{font-size:16px;line-height:normal;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}*{box-sizing:border-box;-webkit-font-smoothing:inherit}';
  mount.style.cssText = 'width:100%;height:100%';
  shadow.append(style,mount);
  const root = createRoot(mount), dialog = $('#catalog-tools'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motionChoice = $('#carousel-motion'), motionKey = 'gadgets.carousel-motion';
  const validMotion = value => ['full','reduced'].includes(value) ? value : 'system';
  let motionPreference = 'system';
  try { motionPreference = validMotion(localStorage.getItem(motionKey)); } catch { /* Use device preference when storage is unavailable. */ }
  motionChoice.value = motionPreference;
  const reduceMotion = () => motionPreference === 'reduced' || (motionPreference === 'system' && reduced.matches);
  host.after(dialog);
  const slots = [
    ['.browse-toolbar','[data-tools-toolbar]'],['.browse-sidebar','[data-tools-facets]'],
    ['.results-line','[data-tools-count]'],['#active-filters','[data-tools-count]']
  ].map(([selector,target]) => {
    const node=$(selector), anchor=document.createComment('catalog control position');
    node.before(anchor); return {node,anchor,target:dialog.querySelector(target)};
  });
  let devices=[],items=[],controller,bindings=[],selected=-1,signature='',revision=0,renderedKey='',progress=0,frame=null;
  const rememberVisit=()=>{
    if(!devices[selected])return;
    try {sessionStorage.setItem(CATALOG_VISIT_KEY,JSON.stringify({href:filterURL(readFilters(location.search)),slug:devices[selected].slug}));}
    catch { /* Returning still works when tab storage is blocked. */ }
  };
  window.addEventListener('pagehide',rememberVisit);
  const updateActions = d => {
    actions.innerHTML=`${kitButton(d)}${saveButton(d)}${compareDeviceLink(d)}${shareDeviceButton(d)}`;
    // Only the current device's controls need synchronizing during a scroll.
    try {
      const saved=JSON.parse(localStorage.getItem('gadgets.saved')||'[]');
      const kit=JSON.parse(localStorage.getItem('gadgets.kit')||'null');
      const save=actions.querySelector('[data-save]'), add=actions.querySelector('[data-kit]');
      const isSaved=Array.isArray(saved)&&saved.includes(d.slug), inKit=kit?.devices?.includes(d.slug);
      save.setAttribute('aria-pressed',String(isSaved));
      save.setAttribute('aria-label',`${isSaved?'Remove':'Save'} ${d.name} ${isSaved?'from':'to'} shortlist`);
      add.setAttribute('aria-pressed',String(Boolean(inKit)));
      add.setAttribute('aria-label',`${inKit?'Remove':'Add'} ${d.name} ${inKit?'from':'to'} setup`);
      add.querySelector('[data-kit-label]').textContent=inKit?'In your setup':'Add to setup';
      if(inKit)add.querySelector('svg').outerHTML=icons.check;
    } catch { /* Existing site controls report storage failures when used. */ }
  };
  const select = value => {
    if(!devices.length)return;
    const index=wrapIndex(Math.round(value),devices.length);
    if(index===selected)return;
    selected=index; const d=devices[index];
    host.dataset.selected=d.slug;
    $('#carousel-count').textContent=`${String(index+1).padStart(2,'0')} / ${devices.length}`;
    $('#carousel-category').textContent=categories[d.category];
    $('#carousel-summary').textContent=d.usage?.goodFor||d.description;
    $('#carousel-needs').textContent=d.usage?.needs||'Specifications are still being developed.';
    $('#carousel-radio').textContent=d.specs.radio;
    $('#carousel-evidence').textContent=d.owned?'Original hardware concept':d.verified?'Source checked · maker documentation':'Partial source review';
    $('#carousel-selected-announcement').textContent=`${d.name}, ${index+1} of ${devices.length}`;
    updateActions(d);
  };
  const recycle = () => {
    // The original animation tree stays mounted. Only the offscreen slot's
    // catalog content changes; no React render touches an active pan or spring.
    carouselWindow(items,progress).forEach((item,index)=>{
      const slot=bindings[index];
      if(!slot || slot.slug===item.slug)return;
      slot.slug=item.slug;
      slot.card.dataset.carouselCard=item.slug;
      slot.card.href=item.href;
      slot.card.setAttribute('aria-label',item.centerText);
      slot.card.style.backgroundImage=slot.background.style.backgroundImage=item.image?`url("${item.image}")`:'none';
      slot.heading.textContent=item.centerText;
      slot.maker.textContent=item.subText;
      slot.badge.textContent=item.badge;
      slot.number.textContent=item.number;
      slot.left.textContent=item.titleLeft;
      slot.right.textContent=item.titleRight;
    });
  };
  const onProgress = value => {
    progress=value;
    if(Math.round(value)!==Number(host.dataset.center)) {
      host.dataset.center=String(Math.round(value));
      // Update recycled content before Motion paints this position. Waiting for
      // another animation frame can flash an old device during a fast gesture.
      recycle();
      if(frame===null)frame=requestAnimationFrame(()=>{frame=null;select(progress);});
    }
  };
  const ready = api => {
    controller=api;
    bindings=api?[...api.element.querySelectorAll('[data-carousel-slot]')].map(card=>{
      const index=card.dataset.carouselSlot;
      return {card,slug:card.dataset.carouselCard,heading:card.querySelector('h3'),
        maker:card.querySelector('[data-carousel-maker]'),badge:card.querySelector('[data-carousel-badge]'),
        number:card.querySelector('[data-carousel-number]'),background:api.element.querySelector(`[data-carousel-background="${index}"]`),
        left:api.element.querySelector(`[data-carousel-side="left-${index}"]`),right:api.element.querySelector(`[data-carousel-side="right-${index}"]`)};
    }):[];
    recycle();
  };
  const render = () => {
    const reducedMotion = reduceMotion();
    host.dataset.motion = reducedMotion ? 'reduced' : 'full';
    if(!items.length)return;
    const cardWidth=Math.min(360,Math.max(240,stage.clientWidth-48));
    const cardHeight=Math.min(cardWidth*1.25,Math.max(300,stage.clientHeight-300));
    const width=Math.min(cardWidth,cardHeight*.8);
    const key=`${revision}|${width}|${cardHeight}|${reducedMotion}`;
    if(key===renderedKey)return;
    renderedKey=key;
    root.render(React.createElement(VerticalCarousel,{
      key:revision,items:carouselWindow(items,progress),
      initialProgress:progress,
      spacing:240,cardWidth:width,cardHeight,textSpacing:6,blurIntensity:60,overlayOpacity:.6,damping:35,
      textFont:{fontFamily:'"Inter", "Inter Placeholder", sans-serif',fontSize:'16px',fontStyle:'normal',fontWeight:400,letterSpacing:'0em',lineHeight:'1.5em'},
      onProgress,onReady:ready,reducedMotion
    }));
  };
  // Native links work for mouse, touch and modifier-click. A drag must never
  // become an accidental click when the pointer is released over a card.
  let down,dragged=false;
  shadow.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY};dragged=false;},{passive:true});
  window.addEventListener('pointermove',event=>{if(down&&Math.hypot(event.clientX-down.x,event.clientY-down.y)>7)dragged=true;},{passive:true});
  window.addEventListener('pointerup',()=>{down=null;},{passive:true});
  window.addEventListener('pointercancel',()=>{down=null;dragged=true;},{passive:true});
  shadow.addEventListener('click',event=>{if(dragged){event.preventDefault();event.stopPropagation();}else rememberVisit();},true);
  // The surrounding catalog controls must not create dead scroll regions.
  // Forward only events outside the stage to the original wheel handler.
  host.addEventListener('wheel',event=>{
    if(event.composedPath().includes(stage) || !controller)return;
    const wheel=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:event.deltaX,deltaY:event.deltaY,
      deltaZ:event.deltaZ,deltaMode:event.deltaMode,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey});
    controller.element.dispatchEvent(wheel);
    if(wheel.defaultPrevented)event.preventDefault();
  },{passive:false});
  const openTools=()=>{if(!dialog.open)dialog.showModal();$('#device-search').focus();};
  $('#carousel-browse').addEventListener('click',openTools);
  $('[data-close-catalog]').addEventListener('click',()=>dialog.close());
  document.addEventListener('keydown',event=>{
    if(event.key==='/'&&document.body.classList.contains('carousel-mode')&&!dialog.open&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,textarea,select')){event.preventDefault();openTools();}
  });
  stage.addEventListener('keydown',event=>{
    if(event.target!==stage)return;
    if(['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End','Enter'].includes(event.key)){
      event.preventDefault();
      if(event.key==='Home')controller?.jump(0);
      else if(event.key==='End')controller?.jump(devices.length-1);
      else if(event.key==='Enter'&&devices[selected]){rememberVisit();location.assign(`/devices/${devices[selected].slug}/`);}
      else controller?.step(['ArrowDown','ArrowRight'].includes(event.key)?1:-1);
    }
  });
  new ResizeObserver(()=>render()).observe(stage);
  reduced.addEventListener('change',render);
  motionChoice.addEventListener('change',()=>{
    motionPreference = validMotion(motionChoice.value);
    try { localStorage.setItem(motionKey,motionPreference); } catch { /* The selection still works for this visit. */ }
    render();
  });
  window.addEventListener('storage',event=>{
    if(event.key!==motionKey && event.key!==null)return;
    motionPreference = validMotion(event.newValue);
    motionChoice.value = motionPreference;
    render();
  });
  return {update(found,view){
    host.hidden=view!=='carousel'||!found.length;
    document.body.classList.toggle('carousel-mode',view==='carousel');
    for(const {node,anchor,target} of slots){if(view==='carousel'){if(node.parentNode!==target)target.append(node);}else if(node.previousSibling!==anchor)anchor.after(node);}
    if(view!=='carousel'&&dialog.open)dialog.close();
    const next=found.map(d=>d.slug).join(',');
    if(next!==signature){
      controller?.progress.stop();cancelAnimationFrame(frame);frame=null;signature=next;revision++;devices=found;selected=-1;progress=0;host.dataset.center='0';
      try {progress=catalogReturnIndex(readCatalogVisit(sessionStorage.getItem(CATALOG_VISIT_KEY),found),location.search,found);}catch { /* Start at the first card. */ }
      host.dataset.center=String(progress);
      items=devices.map((d,index)=>{
        const words=d.name.replace(/^The /,'').split(/\s+/);
        return {slug:d.slug,href:`/devices/${d.slug}/`,centerText:d.name,subText:d.owned?'Original hardware concept':d.maker,
          titleLeft:d.owned?'Original':words[0],titleRight:d.owned?'Hardware':words.length>1?words.at(-1):'Hardware',
          image:d.image||'',number:String(index+1).padStart(2,'0'),badge:d.owned?'CONCEPT':d.verified?'SOURCED':'IN REVIEW'};
      });
      select(progress);
    }
    actions.hidden=!found.length;
    if(!found.length){root.render(null);delete host.dataset.selected;$('#carousel-selected-announcement').textContent='No matching hardware';}
    if(!host.hidden)render();
  }};
}
