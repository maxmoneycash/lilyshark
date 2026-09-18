import assert from 'node:assert/strict';
import test from 'node:test';
import { htmlText } from './htmlText';

test('map names and descriptions cannot introduce elements or quoted attributes', () => {
  assert.equal(htmlText('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(htmlText("Trail & valley's \"north\" radio"), 'Trail &amp; valley&#39;s &quot;north&quot; radio');
  assert.equal(htmlText('山頂 📻'), '山頂 📻');
  assert.equal(htmlText('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});
