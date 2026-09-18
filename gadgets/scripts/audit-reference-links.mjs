// Read-only reachability checks. A successful HTTP response does not verify a
// specification, a software download, or permission to reuse the page content.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const since=[],args=process.argv.slice(2);
let output=path.join(root,'docs/research/reference-link-audit-2026-09-16.json');
for(let i=0;i<args.length;i++){
  const flag=args[i],value=args[++i];
  if(!['--since','--output'].includes(flag) || !value || value.startsWith('--'))throw new Error('Usage: audit-reference-links.mjs [--since prior-audit.json] [--output report.json]');
  if(flag==='--since')since.push(path.resolve(root,value));else output=path.resolve(root,value);
}
if(since.includes(output))throw new Error('The output must not overwrite a prior audit supplied with --since.');
const normalizedURL=value=>{const url=new URL(value);url.hash='';return url.href;};
const audited=new Set(),previousAudits=[];
for(const file of since){
  const prior=JSON.parse(await fs.readFile(file,'utf8'));
  if(!Array.isArray(prior.results))throw new Error(`Prior audit has no results array: ${file}`);
  for(const row of prior.results)for(const value of [row.url,row.finalURL])if(value)audited.add(normalizedURL(value));
  previousAudits.push({file:path.relative(root,file),checked:prior.checked,results:prior.results.length});
}
const profiles=JSON.parse(await fs.readFile(path.join(root,'data/device-details.json'),'utf8'));
const references=new Map();
for(const [slug,profile] of Object.entries(profiles))for(const resource of profile.resources){
  const url=new URL(resource.url);url.hash='';
  if(url.protocol!=='https:' || url.username || url.password)throw new Error('Unsafe reference URL');
  if(!references.has(url.href))references.set(url.href,{url:url.href,devices:[]});
  const item=references.get(url.href);if(!item.devices.includes(slug))item.devices.push(slug);
}
const jobs=[...references.values()].filter(job=>!audited.has(job.url)),results=[],limitedHosts=new Set();let next=0,lastProgress=0;
async function worker(){
  while(next<jobs.length){
    const job=jobs[next++],host=new URL(job.url).hostname;
    if(limitedHosts.has(host)){results.push({...job,state:'deferred',reason:'Host requested rate limiting'});continue;}
    const started=Date.now();
    try {
      const response=await fetch(job.url,{redirect:'follow',signal:AbortSignal.timeout(15_000),headers:{'User-Agent':'gadgets-reference-review/1.0','Accept':'text/html,application/pdf,*/*;q=0.5'}});
      const row={...job,status:response.status,finalURL:response.url,contentType:response.headers.get('content-type') || '',elapsedMs:Date.now()-started};
      if(response.status===429)limitedHosts.add(host);
      row.state=response.ok?'reachable':response.status===404||response.status===410?'missing':'needs-browser-check';
      results.push(row);
      // A body cleanup failure must not add a second result for this URL.
      await response.body?.cancel().catch(()=>{});
    }catch(error){results.push({...job,state:'needs-browser-check',reason:error.name==='TimeoutError'?'Request timed out':error.message,elapsedMs:Date.now()-started});}
    // Space requests; never retry a blocked or rate-limited host automatically.
    await new Promise(resolve=>setTimeout(resolve,400));
    if(results.length-lastProgress>=40){lastProgress=results.length;console.log(`Checked ${results.length} / ${jobs.length} reference URLs.`);}
  }
}
await Promise.all([worker(),worker(),worker()]);
results.sort((a,b)=>a.url.localeCompare(b.url));
const counts=Object.fromEntries(['reachable','missing','needs-browser-check','deferred'].map(state=>[state,results.filter(row=>row.state===state).length]));
const report={checked:new Date().toISOString(),scope:'HTTP reachability of curated device resources; headers only, no raw page bodies saved. This does not verify source claims or downloaded software.',counts,results};
if(since.length)report.incremental={previousAudits,currentProfiles:Object.keys(profiles).length,currentResourceEntries:Object.values(profiles).reduce((total,profile)=>total+profile.resources.length,0),currentUniqueURLs:references.size,skippedPreviouslyAudited:references.size-jobs.length,checkedNewURLs:jobs.length,normalization:'URL parsing and fragment removal; prior requested and final redirect URLs are both excluded.'};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({references:jobs.length,...counts,output:path.relative(root,output)}));
