import test from 'node:test';
import assert from 'node:assert/strict';
import {shareLinkNotice} from '../src/share-links.mjs';

test('local sharing identifies loopback spellings and private-network destinations',()=>{
  for(const url of ['http://127.0.0.1:54644/setup/','http://127.1/setup/','http://2130706433/setup/','http://[::1]/','https://demo.localhost/']) {
    assert.match(shareLinkNotice(url),/only opens on this computer/);
  }
  for(const url of ['http://192.168.1.5/','http://10.1.2.3/','http://172.31.2.4/','http://device.local/','http://[fd12::1]/']) {
    assert.match(shareLinkNotice(url),/access to that network/);
  }
});

test('public-looking names and addresses do not inherit a misleading local label',()=>{
  for(const url of ['https://gadgets.sh/setup/','https://localhost.example.com/','http://172.32.2.4/','http://192.169.1.5/','https://127.0.0.1.example.com/','not a URL']) {
    assert.equal(shareLinkNotice(url),'');
  }
});
