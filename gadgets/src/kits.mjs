import { selection } from './catalog.mjs';

export const KIT_LIMIT = 6;
export const DEFAULT_KIT_NAME = 'My hardware setup';
export const PART_STATES = {considering:'Considering',need:'Need it',have:'Have it'};
// This is our format cutover, not a universal browser or social-platform limit.
export const KIT_QUERY_MAX_LENGTH = 1800;
export const KIT_FRAGMENT_MAX_BYTES = 16 * 1024;
const fragmentPrefix = '#kit=v1.';
const fragmentMaxLength = Math.ceil(KIT_FRAGMENT_MAX_BYTES / 3) * 4;

// Retain the existing UTF-16 field budgets without cutting a code point in half.
function boundedText(value,limit) {
  let result='';
  for(const point of value){
    if(result.length+point.length>limit)break;
    const unit=point.charCodeAt(0);
    result+=point.length===1 && unit>=0xd800 && unit<=0xdfff ? '\ufffd' : point;
  }
  return result;
}
const clean = (value,limit) => typeof value === 'string' ? boundedText(value.replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim(),limit) : '';
const multiline = (value,limit) => typeof value === 'string' ? boundedText(value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,' ').trim(),limit) : '';
export const kitName = value => clean(value,64) || DEFAULT_KIT_NAME;
export function safeURL(value, image=false) {
  if(typeof value!=='string' || value.trim().length>400)return '';
  try {
    const url=new URL(value.trim());
    return (image ? url.protocol==='https:' : ['http:','https:'].includes(url.protocol)) && !url.username && !url.password && url.href.length<=400 ? url.href : '';
  } catch {return '';}
}
export function normalizeKit(value, catalog) {
  const devices=selection(value?.devices,catalog,KIT_LIMIT),items={};
  for(const id of devices){
    const item=partDetails(value?.items?.[id]);
    if(item.quantity!==1 || item.state!=='considering' || item.note || item.link || item.affiliate)items[id]=item;
  }
  return {name:kitName(value?.name),author:clean(value?.author,40),from:clean(value?.from,120),origin:clean(value?.origin,120),story:multiline(value?.story,500),parts:multiline(value?.parts,240),project:safeURL(value?.project),photo:safeURL(value?.photo,true),devices,items};
}
export function partDetails(value) {
  const raw=value?.quantity,quantity=typeof raw==='number' || typeof raw==='string'?Number(raw):NaN;
  return {quantity:Number.isInteger(quantity)?Math.max(1,Math.min(99,quantity)):1,state:typeof value?.state==='string' && Object.hasOwn(PART_STATES,value.state)?value.state:'considering',note:multiline(value?.note,160),link:safeURL(value?.link),affiliate:value?.affiliate===true};
}
export function updateKitPart(kit,id,changes,catalog) {
  const current=normalizeKit(kit,catalog);
  if(!current.devices.includes(id))return current;
  return normalizeKit({...current,items:{...current.items,[id]:{...partDetails(current.items[id]),...changes}}},catalog);
}
export function readKit(storage,catalog) {
  try {return normalizeKit(JSON.parse(storage.getItem('gadgets.kit') || 'null'),catalog);} catch {return normalizeKit(null,catalog);}
}
function base64URL(bytes) {
  return btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function kitFromFragment(hash,catalog) {
  if(!hash.startsWith(fragmentPrefix) || hash.length>fragmentPrefix.length+fragmentMaxLength)return null;
  const encoded=hash.slice(fragmentPrefix.length);
  if(!encoded || encoded.length%4===1 || !/^[A-Za-z0-9_-]+$/.test(encoded))return null;
  try {
    const bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
    if(bytes.length>KIT_FRAGMENT_MAX_BYTES || base64URL(bytes)!==encoded)return null;
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value || typeof value!=='object' || Array.isArray(value) || !Array.isArray(value.devices))return null;
    return normalizeKit(value,catalog);
  } catch {return null;}
}
export function kitFromURL(search,catalog,hash='') {
  // A recognized but invalid snapshot must not silently load a different query kit.
  if(typeof hash==='string' && hash.startsWith('#kit='))return kitFromFragment(hash,catalog);
  const p=new URLSearchParams(search);
  let items={};
  try {const raw=p.get('items');if(raw && raw.length<=10000)items=JSON.parse(raw);}catch{}
  return p.has('devices') ? normalizeKit({...Object.fromEntries(p),items,devices:(p.get('devices') || '').split(',')},catalog) : null;
}
export function kitURL(kit) {
  const p=new URLSearchParams({name:kitName(kit.name),devices:kit.devices.join(',')});
  for(const key of ['author','from','origin','story','parts','project','photo'])if(kit[key])p.set(key,kit[key]);
  if(kit.items && Object.keys(kit.items).length)p.set('items',JSON.stringify(kit.items));
  const query=`/setup/?${p}`;
  if(query.length<=KIT_QUERY_MAX_LENGTH)return query;
  const snapshot={name:kitName(kit.name),devices:kit.devices};
  for(const key of ['author','from','origin','story','parts','project','photo'])if(kit[key])snapshot[key]=kit[key];
  const items=Object.fromEntries(kit.devices.flatMap(id=>{
    const item=partDetails(kit.items?.[id]),compact={};
    if(item.quantity!==1)compact.quantity=item.quantity;
    if(item.state!=='considering')compact.state=item.state;
    if(item.note)compact.note=item.note;
    if(item.link)compact.link=item.link;
    if(item.affiliate)compact.affiliate=true;
    return Object.keys(compact).length?[[id,compact]]:[];
  }));
  if(Object.keys(items).length)snapshot.items=items;
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
  if(bytes.length>KIT_FRAGMENT_MAX_BYTES)throw new RangeError('This setup is too large to include in a share link.');
  return `/setup/${fragmentPrefix}${base64URL(bytes)}`;
}
export function toggleKit(kit,id,catalog) {
  const current=normalizeKit(kit,catalog);
  if(!catalog.some(d=>d.slug===id))return {kit:current,reason:'unknown'};
  if(current.devices.includes(id))return {kit:normalizeKit({...current,devices:current.devices.filter(x=>x!==id)},catalog),reason:'removed'};
  if(current.devices.length>=KIT_LIMIT)return {kit:current,reason:'full'};
  return {kit:{...current,devices:[...current.devices,id]},reason:'added'};
}

export function remixKit(shared,catalog) {
  const source=normalizeKit(shared,catalog);
  const items=Object.fromEntries(source.devices.map(id=>[id,{...partDetails(source.items[id]),state:'considering'}]));
  const from=`${source.name}${source.author?` by ${source.author}`:''}`;
  return normalizeKit({...source,items,name:`${boundedText(source.name,56)} — remix`,author:'',from,origin:source.origin || source.from || from},catalog);
}

const markdownText=value=>String(value || '').replace(/[\\`*_{}\[\]<>#!|()~]/g,'\\$&');
const markdownURL=value=>new URL(value).href.replace(/[<>()]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
export function kitMarkdown(value,catalog) {
  const kit=normalizeKit(value,catalog),lines=[`# ${markdownText(kit.name)}`,''];
  if(kit.author)lines.push(`By ${markdownText(kit.author)}`,'');
  if(kit.from)lines.push(`Remixed from ${markdownText(kit.from)}`,'');
  if(kit.origin && kit.origin!==kit.from)lines.push(`Earlier version: ${markdownText(kit.origin)}`,'');
  if(kit.story)lines.push(markdownText(kit.story),'');
  if(kit.project)lines.push(`[Build log, code or demo](${markdownURL(kit.project)})`,'');
  if(kit.photo)lines.push(`[Creator's build photo](${markdownURL(kit.photo)})`,'');
  if(kit.devices.length)lines.push('## Hardware','');
  for(const id of kit.devices){
    const d=catalog.find(d=>d.slug===id),item=partDetails(kit.items[id]);
    lines.push(`### ${item.quantity} × ${markdownText(d.name || id)}`,'',`Status: ${PART_STATES[item.state]}`);
    if(item.note)lines.push(`Part note: ${markdownText(item.note)}`);
    if(item.link)lines.push(`[${item.affiliate?'Creator affiliate buying link':'Creator buying link'}](${markdownURL(item.link)})`);
    if(d.usage?.needs)lines.push(`Requirements: ${markdownText(d.usage.needs)}`);
    if(d.usage?.tradeoff)lines.push(`Keep in mind: ${markdownText(d.usage.tradeoff)}`);
    if(d.source && safeURL(d.source))lines.push(`[Maker / project source](${markdownURL(d.source)})`);
    if(d.owned)lines.push('Original hardware concept; not available to order.');
    lines.push('');
  }
  if(kit.parts)lines.push('## Other parts & modifications','',markdownText(kit.parts),'');
  lines.push('---','Made with gadgets.sh. Notes and ownership states are supplied by the setup creator. Listing parts together does not establish compatibility or a tested build.','');
  return lines.join('\n');
}
