import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateOffers,currentOffers,isOfferCurrent} from '../src/offers.mjs';

const offer={id:'maker-sample',maker:'Example maker',devices:['radio'],headline:'Example promotion',code:'BUILD10',source:'https://example.com/offer',checked:'2026-09-16',reviewAfter:'2026-09-23',evidence:'Maker banner',qualification:'Check eligible items with the maker.',relationship:'Public offer; no affiliate relationship',checkoutTested:false};
const catalog=[{slug:'radio'},{slug:'other'}];

test('only dated offers for the selected hardware survive the internal freshness window',()=>{
  assert.deepEqual(currentOffers([offer],'radio','2026-09-16'),[offer]);
  assert.deepEqual(currentOffers([offer],'radio','2026-09-23'),[offer]);
  assert.deepEqual(currentOffers([offer],'radio','2026-09-15'),[]);
  assert.deepEqual(currentOffers([offer],'radio','2026-09-24'),[]);
  assert.deepEqual(currentOffers([offer],'other','2026-09-17'),[]);
  assert.equal(isOfferCurrent(offer,'not a date'),false);
  assert.equal(isOfferCurrent(null,'2026-09-17'),false);
  assert.equal(isOfferCurrent({...offer,checked:'2026-02-30'},'2026-09-17'),false);
});

test('publication requires an explicit relationship, checkout evidence and safe primary-source URL',()=>{
  assert.equal(validateOffers([offer],catalog)[0],offer);
  for(const patch of [
    {relationship:''},{checkoutTested:undefined},{code:'<script>'},{devices:['missing']},
    {source:'javascript:alert(1)'},{source:'http://example.com'},{source:'https://user:pass@example.com'},
    {checked:'2026-02-30'},{reviewAfter:'2026-09-15'}
  ])assert.throws(()=>validateOffers([{...offer,...patch}],catalog));
  assert.throws(()=>validateOffers([offer,offer],catalog),/duplicate/);
});

test('the current public merchant offer records its qualification without claiming an affiliate relationship or tested checkout',async()=>{
  const offers=JSON.parse(await readFile(new URL('../data/offers.json',import.meta.url),'utf8'));
  const devices=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
  validateOffers(offers,devices);
  const publicOffer=offers.find(item=>item.id==='pingequa-build10');
  assert.equal(publicOffer.checkoutTested,false);
  assert.match(publicOffer.relationship,/no gadgets\.sh affiliate relationship/);
  assert.match(publicOffer.headline,/2\+/);
  assert.match(publicOffer.qualification,/expiry and exclusions are not stated/);
});
