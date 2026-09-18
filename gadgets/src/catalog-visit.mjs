import {readFilters,filterURL} from './catalog.mjs';

export const CATALOG_VISIT_KEY='gadgets.catalog-visit';

// A tab-local return location. Accept only known hardware and canonical filters;
// never turn stored data into an external or executable navigation destination.
export function readCatalogVisit(value,devices) {
  try {
    if(typeof value!=='string' || value.length>3000)return null;
    const visit=JSON.parse(value);
    if(!visit || typeof visit.href!=='string' || typeof visit.slug!=='string' || !devices.some(device=>device.slug===visit.slug))return null;
    const url=new URL(visit.href,'https://gadgets.invalid');
    if(!visit.href.startsWith('/hardware/') || url.origin!=='https://gadgets.invalid' || url.pathname!=='/hardware/' || url.hash)return null;
    return {href:filterURL(readFilters(url.search)),slug:visit.slug};
  } catch {return null;}
}

export function catalogReturnIndex(visit,search,devices) {
  if(!visit || visit.href!==filterURL(readFilters(search)))return 0;
  const index=devices.findIndex(device=>device.slug===visit.slug);
  return index<0?0:index;
}
