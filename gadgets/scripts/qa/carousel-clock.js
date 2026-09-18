// QA-only stepped clock. Both isolated documents receive identical frame times.
(() => {
 let now=0,next=1;
 const frames=new Map(),timers=new Map();
 window.requestAnimationFrame=callback=>{const id=next++;frames.set(id,callback);return id;};
 window.cancelAnimationFrame=id=>frames.delete(id);
 window.setTimeout=(callback,delay=0,...args)=>{const id=next++;timers.set(id,{at:now+Math.max(0,delay),callback:()=>callback(...args)});return id;};
 window.clearTimeout=id=>timers.delete(id);
 Object.defineProperty(performance,'now',{value:()=>now});
 window.__motionClock={advance(time){
   now=time;
   for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
   const pending=[...frames];frames.clear();for(const [,callback]of pending)callback(now);
 },get now(){return now;}};
})();
