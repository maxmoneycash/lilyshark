import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePilotBrief,validatePilotBrief,pilotBriefMarkdown,pilotBriefFilename,safePilotURL,PILOT_FIELD_LIMITS} from '../src/pilot-brief.mjs';

const valid={company:'Mara & Sons',productURL:'https://example.com/device?revision=2',outcome:'Build a portable weather display.'};

test('briefs preserve meaningful entered text while rejecting unknown fields, controls and oversized input',()=>{
  const brief=normalizePilotBrief({...valid,outcome:' First line\r\nSecond line <not HTML> 🛠️\u0000',parts:'x'.repeat(2100),mediaRights:'invented',budget:'accepted',token:'secret',storeURL:{toString:()=> 'https://example.com'}});
  assert.equal(brief.outcome,' First line\nSecond line <not HTML> 🛠️');
  assert.equal(brief.parts.length,PILOT_FIELD_LIMITS.parts);
  assert.equal(brief.storeURL,'');assert.equal(brief.mediaRights,'unknown');assert.equal(brief.budget,'undecided');
  assert.equal(Object.hasOwn(brief,'token'),false);
  assert.deepEqual(normalizePilotBrief(null),normalizePilotBrief(['wrong shape']));
});

test('a useful brief needs three essentials but does not pretend media rights or a budget were agreed',()=>{
  const empty=validatePilotBrief({});assert.deepEqual(Object.keys(empty.errors).sort(),['company','outcome','productURL']);
  const result=validatePilotBrief(valid);assert.equal(result.valid,true);assert.equal(result.brief.mediaRights,'unknown');assert.equal(result.brief.budget,'undecided');
  assert.equal(validatePilotBrief({...valid,company:'  ',outcome:'\n'}).valid,false);
});

test('malformed JSON enum values cannot throw or coerce into approved media rights or a budget choice',()=>{
  const malformed=JSON.parse('[null,1,false,[],["approved"],["considering"],{"toString":1},{"toString":null,"valueOf":null},"toString","__proto__"]');
  for(const value of malformed) {
    const result=validatePilotBrief({...valid,mediaRights:value,budget:value});
    assert.equal(result.valid,true);
    assert.equal(result.brief.mediaRights,'unknown');
    assert.equal(result.brief.budget,'undecided');
    assert.match(pilotBriefMarkdown(result.brief),/## Media reuse status\n\n    To confirm/);
  }
  const result=validatePilotBrief({...valid,mediaRights:'approved',budget:'considering'});
  assert.equal(result.brief.mediaRights,'approved');
  assert.equal(result.brief.budget,'considering');
});

test('all source URL fields reject executable, insecure, credentialed and malformed URLs without erasing the draft',()=>{
  for(const value of ['javascript:alert(1)','http://example.com','https:example.com','https:\\example.com','https://user:pass@example.com/path','https://exa mple.com','https://example.com/\nthing','//example.com','data:text/html,hello']) {
    for(const key of ['productURL','mediaURL','storeURL']) {
      const result=validatePilotBrief({...valid,[key]:value});assert.ok(result.errors[key],`${key}: ${value}`);assert.equal(result.brief[key],value);
    }
  }
  assert.equal(safePilotURL(' https://example.com/x?a=1&b=2#version '),'https://example.com/x?a=1&b=2#version');
  assert.equal(validatePilotBrief({...valid,mediaURL:'',storeURL:'https://example.com/store'}).valid,true);
});

test('export preserves multiline notes as literal content and identifies unknowns, proposed scope and local status',()=>{
  const markdown=pilotBriefMarkdown({...valid,company:'<script>not executable</script>',parts:'Two boards\n# My note\n[link](javascript:alert(1))',dealNotes:'No code agreed.'});
  assert.match(markdown,/Local draft only\. Nothing has been submitted, booked or paid\./);
  assert.match(markdown,/    <script>not executable<\/script>/);
  assert.match(markdown,/    Two boards\n    # My note\n    \[link\]\(javascript:alert\(1\)\)/);
  assert.match(markdown,/## Media reuse status\n\n    To confirm/);
  assert.match(markdown,/## Budget discussion\n\n    Not decided/);
  assert.match(markdown,/Proposed scope — \$750 one time/);
  assert.match(markdown,/Proposed payments: \$375 after scope agreement and \$375 after acceptance/);
  assert.match(markdown,/Source checks do not establish independent hardware testing/);
  assert.doesNotMatch(markdown,/^<script>|^# My note/m);
});

test('download filenames cannot escape their filename or include private URLs',()=>{
  assert.equal(pilotBriefFilename({...valid,company:'../../My Maker 🛠️'}),'gadgets-my-maker-pilot-brief.md');
  assert.equal(pilotBriefFilename({company:'📻'}),'gadgets-maker-pilot-brief.md');
  assert.ok(pilotBriefFilename({company:'a'.repeat(500)}).length<100);
});
