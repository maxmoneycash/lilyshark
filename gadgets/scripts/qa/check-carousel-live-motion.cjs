// Run inside the verified Playwriter session with state.motionPage open.
// Unlike the controlled comparison, this observes real DOM transforms under
// the browser's current motion preference and ordinary frame scheduling.
await state.motionPage.locator('[data-carousel-card]').first().waitFor({timeout:10000});
await state.motionPage.evaluate(()=>{
  const root=document.querySelector('#carousel-stage').shadowRoot;
  const card=root.querySelector('[data-carousel-slot]');
  let fiber=card[Object.keys(card).find(key=>key.startsWith('__reactFiber'))];
  while(fiber&&!fiber.memoizedProps?.progress?.get)fiber=fiber.return;
  if(!fiber)throw Error('Carousel is not mounted');
  const progress=fiber.memoizedProps.progress;
  const trace=window.__liveMotionTrace={
    systemReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    preference:document.querySelector('#carousel-motion').value,
    effective:document.querySelector('#hardware-carousel').dataset.motion,
    before:progress.get(),frames:[],done:false
  };
  root.querySelector('.vertical-carousel').addEventListener('wheel',()=>{
    trace.immediate=progress.get();
    const start=performance.now();
    const sample=()=>{
      trace.frames.push({t:performance.now()-start,progress:progress.get(),transform:card.style.transform});
      if(performance.now()-start<1600)requestAnimationFrame(sample);
      else trace.done=true;
    };
    requestAnimationFrame(sample);
  },{once:true});
});
const box=await state.motionPage.locator('#carousel-stage').boundingBox();
await state.motionPage.mouse.move(box.x+box.width/2,box.y+box.height/2);
await state.motionPage.mouse.wheel(0,240);
await state.motionPage.waitForFunction(()=>window.__liveMotionTrace.done,{timeout:10000});
const trace=await state.motionPage.evaluate(()=>window.__liveMotionTrace);
const intermediate=trace.frames.filter(frame=>Math.abs(frame.progress-Math.round(frame.progress))>.001);
const transforms=new Set(trace.frames.map(frame=>frame.transform)).size;
if(trace.effective==='full'&&(!intermediate.length||transforms<3))throw Error('Full animation did not produce intermediate rendered positions');
if(trace.effective==='reduced'&&(intermediate.length||trace.immediate===trace.before))throw Error('Reduced motion did not step immediately');
require('node:fs').writeFileSync(state.motionResultPath||'/tmp/gadgets-carousel-live-motion.json',JSON.stringify(trace,null,2));
console.log({systemReduced:trace.systemReduced,preference:trace.preference,effective:trace.effective,frames:trace.frames.length,intermediate:intermediate.length,transforms});
