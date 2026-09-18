const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
export function validateOffers(offers,catalog) {
  if(!Array.isArray(offers))throw new Error('Offers must be an array');
  const ids=new Set(),devices=new Set(catalog.map(d=>d.slug));
  for(const offer of offers){
    if(!offer || !/^[a-z0-9-]+$/.test(offer.id) || ids.has(offer.id))throw new Error('Invalid or duplicate offer');
    ids.add(offer.id);
    for(const key of ['maker','headline','evidence','qualification','relationship'])if(typeof offer[key]!=='string' || !offer[key].trim())throw new Error(`Missing offer ${key}: ${offer.id}`);
    if(!Array.isArray(offer.devices) || !offer.devices.length || !offer.devices.every(id=>devices.has(id)))throw new Error(`Unknown offer device: ${offer.id}`);
    if(typeof offer.code!=='string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(offer.code))throw new Error(`Invalid offer code: ${offer.id}`);
    let source;try {source=new URL(offer.source);}catch {throw new Error(`Invalid offer source: ${offer.id}`);}
    if(source.protocol!=='https:' || source.username || source.password)throw new Error(`Unsafe offer source: ${offer.id}`);
    if(!validDate(offer.checked) || !validDate(offer.reviewAfter) || offer.reviewAfter<offer.checked)throw new Error(`Invalid offer review dates: ${offer.id}`);
    if(typeof offer.checkoutTested!=='boolean')throw new Error(`Missing checkout evidence: ${offer.id}`);
  }
  return offers;
}

// A review deadline is our freshness limit, not a claim about a merchant's expiry.
export function isOfferCurrent(offer,today=new Date().toISOString().slice(0,10)) {
  return validDate(today) && validDate(offer?.checked) && validDate(offer?.reviewAfter) && offer.checked<=today && offer.reviewAfter>=today;
}
export function currentOffers(offers,device,today=new Date().toISOString().slice(0,10)) {
  return offers.filter(offer=>offer.devices.includes(device) && isOfferCurrent(offer,today));
}
