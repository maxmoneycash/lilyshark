export const PILOT_BRIEF_STORAGE_KEY = 'gadgets.maker-pilot';
export const PILOT_PRICE = 750;
export const PILOT_FIELD_LIMITS = Object.freeze({company:100,productURL:600,outcome:500,viewer:300,mediaURL:600,parts:2000,storeURL:600,dealNotes:1200,timing:200});
export const MEDIA_RIGHTS = Object.freeze({unknown:'To confirm',owned:'I own the media',approved:'The owner approved reuse',permission:'Permission is still needed',none:'No media available yet'});
export const PILOT_BUDGETS = Object.freeze({considering:'Considering the proposed $750 pilot',discuss:'I need to discuss the scope or budget',undecided:'Not decided'});

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const clean = (value,limit) => typeof value === 'string' ? Array.from(value.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')).slice(0,limit).join('') : '';

export function normalizePilotBrief(value) {
  const source=record(value),brief={version:1};
  for(const [key,limit] of Object.entries(PILOT_FIELD_LIMITS)) brief[key]=clean(source[key],limit);
  brief.mediaRights=typeof source.mediaRights==='string' && Object.hasOwn(MEDIA_RIGHTS,source.mediaRights)?source.mediaRights:'unknown';
  brief.budget=typeof source.budget==='string' && Object.hasOwn(PILOT_BUDGETS,source.budget)?source.budget:'undecided';
  return brief;
}

export function safePilotURL(value) {
  if(typeof value!=='string')return '';
  const text=value.trim();
  if(!/^https:\/\//i.test(text) || /[\s\\]/.test(text))return '';
  try {
    const url=new URL(text);
    return url.protocol==='https:' && url.hostname && !url.username && !url.password ? url.href : '';
  } catch {return '';}
}

export function validatePilotBrief(value) {
  const brief=normalizePilotBrief(value),errors={};
  if(!brief.company.trim())errors.company='Add your maker, company or creator name.';
  if(!brief.outcome.trim())errors.outcome='Describe one thing someone should be able to do.';
  if(!brief.productURL.trim())errors.productURL='Add the product or build’s HTTPS link.';
  for(const key of ['productURL','mediaURL','storeURL']) {
    if(brief[key].trim() && !safePilotURL(brief[key]))errors[key]='Use a complete HTTPS link without a username or password.';
  }
  return {brief,errors,valid:Object.keys(errors).length===0};
}

const block = value => (value.trim() || 'To confirm').split('\n').map(line=>`    ${line}`).join('\n');
export function pilotBriefMarkdown(value) {
  const brief=normalizePilotBrief(value);
  const sections=[
    ['Maker / creator',brief.company],['Product or build',brief.productURL],
    ['One intended outcome',brief.outcome],['Viewer / existing post',brief.viewer],
    ['Existing media',brief.mediaURL],['Media reuse status',MEDIA_RIGHTS[brief.mediaRights]],
    ['Parts, revision and firmware',brief.parts],['Official store',brief.storeURL],
    ['Merchant-approved offer and terms, if any',brief.dealNotes],
    ['Budget discussion',PILOT_BUDGETS[brief.budget]],['Preferred timing',brief.timing]
  ];
  return `# gadgets.sh maker pilot brief\n\nLocal draft only. Nothing has been submitted, booked or paid. Details below are supplied by the person preparing this brief and still need review.\n\n${sections.map(([title,value])=>`## ${title}\n\n${block(value)}`).join('\n\n')}\n\n## Proposed scope — $750 one time\n\n- One product/build companion page with editable static files and social-preview metadata.\n- Up to six catalog devices plus stated accessories, one revision/firmware path, and up to eight primary-source references.\n- One approved existing demo and up to five supplied images; no new hardware shoot.\n- A Markdown parts/reference export and one sharing design in three crops.\n- Official store links and one merchant-approved offer, if provided and confirmed.\n- One consolidated review round. Five working days of production after complete materials and scope agreement; hosting is agreed separately.\n- Proposed payments: $375 after scope agreement and $375 after acceptance. No payment is requested by this draft.\n\n## Before production\n\nConfirm media ownership and reuse permission, selected hardware/firmware revision, source gaps, offer eligibility and terms, review contact, schedule and acceptance criteria. Source checks do not establish independent hardware testing. The fee buys production assets; it includes no reach or sales guarantee. Creators keep their credit and existing links unless a separate agreement says otherwise.\n`;
}

export function pilotBriefFilename(value) {
  const name=normalizePilotBrief(value).company.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
  return `gadgets-${name || 'maker'}-pilot-brief.md`;
}
