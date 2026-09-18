import test from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogVisit,catalogReturnIndex} from '../src/catalog-visit.mjs';
const devices=[{slug:'first'},{slug:'second'},{slug:'third'}];

test('returning to the same filtered catalog restores the exact selected device after reordering',()=>{
  const visit=readCatalogVisit(JSON.stringify({href:'/hardware/?q=radio&sort=name',slug:'second'}),devices);
  assert.equal(catalogReturnIndex(visit,'?sort=name&q=radio',devices),1);
  assert.equal(catalogReturnIndex(visit,'?q=radio&sort=name',[devices[2],devices[0],devices[1]]),2);
  assert.equal(catalogReturnIndex(visit,'?q=other&sort=name',devices),0);
  assert.equal(catalogReturnIndex(visit,'?q=radio&sort=name',[devices[0]]),0);
});

test('untrusted or stale return state cannot escape the catalog or select missing hardware',()=>{
  for(const href of ['https://example.com/hardware/','//example.com/hardware/','javascript:alert(1)','/hardware/../setup/','/hardware/other/','/hardware/#unexpected']) {
    assert.equal(readCatalogVisit(JSON.stringify({href,slug:'second'}),devices),null);
  }
  for(const input of [null,'{','[]','null',JSON.stringify({href:'/hardware/',slug:'removed'}),JSON.stringify({href:{toString:1},slug:'second'}),'x'.repeat(3001)])assert.equal(readCatalogVisit(input,devices),null);
  assert.deepEqual(readCatalogVisit(JSON.stringify({href:'/hardware/?category=constructor&unknown=1',slug:'second'}),devices),{href:'/hardware/',slug:'second'});
});
