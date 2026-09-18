// Run in the existing Playwriter session; see docs/hardware-carousel.md.
const result=await state.motionPage.evaluate(async(stepped)=>{
  const scenes=['reference','candidate'].map(id=>{
    const doc=document.getElementById(id).contentDocument;
    const win=doc.defaultView,root=doc.querySelector('#carousel-stage')?.shadowRoot||doc;
    const card=[...root.querySelectorAll('div,a')].find(e=>e.style.cursor==='pointer'&&e.style.backgroundImage);
    let fiber=card[Object.keys(card).find(k=>k.startsWith('__reactFiber'))];
    while(fiber&&!fiber.memoizedProps?.progress?.get)fiber=fiber.return;
    if(!fiber)throw Error('Missing progress for '+id);
    const progress=fiber.memoizedProps.progress;
    let top=fiber;while(top.return)top=top.return;
    return {id,doc,win,root,progress,reactRoot:top.stateNode,element:root.querySelector('.vertical-carousel')||doc.querySelector('#root>div'),pan:root.querySelector('[style*="touch-action: none"]')};
  });
  let time=0;
  const raf=stepped?async()=>{time+=1000/120;scenes.forEach(s=>s.win.__motionClock.advance(time));}:()=>new Promise(requestAnimationFrame);
  const results=[];
  const wheel=(scene,delta)=>scene.element.dispatchEvent(new scene.win.WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));
  const pointer=(scene,type,x,y)=>{
    const event=new scene.win.PointerEvent(type,{pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,bubbles:true,cancelable:true});
    (type==='pointerdown'?scene.pan:scene.win).dispatchEvent(event);
  };
  for(const mode of ['wheel','reverse','drag','interrupt']){
    for(const scene of scenes){scene.progress.stop();scene.progress.set(0);}
    for(let n=0;n<24;n++)await raf();
    let rootElement=scenes[1].reactRoot.current.memoizedState.element,commits=0;
    const frames=[],start=stepped?time:performance.now();
    for(let step=0;step<110;step++){
      await raf();
      if(mode==='wheel'&&[0,3,6,9].includes(step))scenes.forEach(s=>wheel(s,120));
      if(mode==='reverse'&&[0,3,6,9].includes(step))scenes.forEach(s=>wheel(s,step<6?160:-160));
      if(mode==='interrupt'&&step===0)scenes.forEach(s=>wheel(s,960));
      if(mode==='drag'||mode==='interrupt'){
        if(step===10)scenes.forEach(s=>pointer(s,'pointerdown',250,560));
        if(step>10&&step<=22)scenes.forEach(s=>pointer(s,'pointermove',250,560-(step-10)*20));
        if(step===23)scenes.forEach(s=>pointer(s,'pointerup',250,320));
      }
      const a=scenes[0].progress.get(),b=scenes[1].progress.get();
      frames.push({t:(stepped?time:performance.now())-start,reference:a,candidate:b,error:Math.abs(a-b)});
      const current=scenes[1].reactRoot.current.memoizedState.element;
      if(current!==rootElement){commits++;rootElement=current;}
    }
    results.push({mode,frames,maxError:Math.max(...frames.map(f=>f.error)),end:frames.at(-1),reactRendersDuringMotion:commits});
  }
  return results;
},Boolean(state.motionStepped));
require('node:fs').writeFileSync(state.motionResultPath||'/tmp/gadgets-carousel-motion.json',JSON.stringify(result,null,2));
console.log(result.map(({frames,...summary})=>summary));

if(state.motionStepped&&result.some(run=>run.maxError>1e-7))throw Error("Motion differs from the original reference");
if(result.some(run=>run.reactRendersDuringMotion))throw Error("The moving stack re-rendered");
