// Affiliate programs stay inactive until the owner adds an ID issued by the merchant.
const safeURL=value=>{
  try {const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password?url:null;}
  catch {return null;}
};
export function validateAffiliates(programs) {
  if(!Array.isArray(programs))throw new Error('Affiliate programs must be an array');
  const ids=new Set(),hosts=new Set();
  for(const program of programs){
    if(!program || !/^[a-z0-9-]+$/.test(program.id) || ids.has(program.id))throw new Error('Invalid or duplicate affiliate program');
    ids.add(program.id);
    const fail=reason=>{throw new Error(`${program.id}: ${reason}`);};
    if(typeof program.merchant!=='string' || !program.merchant.trim())fail('missing merchant');
    if(!Array.isArray(program.hosts) || !program.hosts.length)fail('missing hosts');
    for(const host of program.hosts){
      if(!/^[a-z0-9.-]+$/.test(host) || hosts.has(host))fail(`invalid or duplicate host ${host}`);
      hosts.add(host);
    }
    if(typeof program.affiliateId!=='string' || !/^[A-Za-z0-9_-]{0,80}$/.test(program.affiliateId))fail('invalid affiliate ID');
    if(program.mode==='redirect'){
      if(program.template && (!safeURL(program.template.replace('{id}','x').replace('{url}','x')) || !program.template.includes('{id}') || !program.template.includes('{url}')))fail('redirect template needs https, {id} and {url}');
    }else if(program.mode==='param'){
      if(program.param && !/^[A-Za-z0-9_-]{1,40}$/.test(program.param))fail('invalid parameter name');
    }else fail('mode must be redirect or param');
    if(!safeURL(program.applyUrl))fail('invalid apply URL');
  }
  return programs;
}
export function isAffiliateActive(program) {
  return Boolean(program?.affiliateId && (program.mode==='redirect'?program.template:program.param));
}
// Returns the tagged link for a merchant URL, or null when no active program covers it.
export function affiliateLink(value,programs) {
  const url=safeURL(value);
  if(!url)return null;
  const program=programs.find(program=>program.hosts.includes(url.hostname) && isAffiliateActive(program));
  if(!program)return null;
  if(program.mode==='redirect')return {program,href:program.template.replace('{id}',encodeURIComponent(program.affiliateId)).replace('{url}',encodeURIComponent(url.href))};
  url.searchParams.set(program.param,program.affiliateId);
  return {program,href:url.href};
}
