import {PILOT_BRIEF_STORAGE_KEY,normalizePilotBrief,validatePilotBrief,pilotBriefMarkdown,pilotBriefFilename} from './pilot-brief.mjs';

const form=document.querySelector('#maker-pilot-form');
if(form) {
  const fields=document.querySelector('#pilot-fields'),saveState=document.querySelector('#pilot-save-state'),actionState=document.querySelector('#pilot-action-state'),formError=document.querySelector('#pilot-form-error');
  const copyButton=document.querySelector('#pilot-copy'),downloadButton=document.querySelector('#pilot-download');
  let draft=normalizePilotBrief(null),storageAvailable=true,corruptDraft=false,savedDraft=false;
  try {
    const stored=localStorage.getItem(PILOT_BRIEF_STORAGE_KEY);
    if(stored) {try {
      const decoded=JSON.parse(stored);
      if(!decoded || typeof decoded!=='object' || Array.isArray(decoded))throw new Error('Unrecognized draft');
      draft=normalizePilotBrief(decoded);savedDraft=true;
    }catch {corruptDraft=true;}}
  }catch {storageAvailable=false;}
  for(const [key,value] of Object.entries(draft))if(form.elements.namedItem(key))form.elements.namedItem(key).value=value;

  function storageMessage() {
    saveState.textContent=!storageAvailable?'Browser storage is unavailable. Copy or download to keep your brief. Nothing sent.':corruptDraft?'The previous draft could not be read. Start a new one here. Nothing sent.':savedDraft?'Saved here. Nothing sent.':'Your draft will save here. Nothing sent.';
  }
  function readForm() {return normalizePilotBrief(Object.fromEntries(new FormData(form)));}
  function persist() {
    draft=readForm();corruptDraft=false;
    try {localStorage.setItem(PILOT_BRIEF_STORAGE_KEY,JSON.stringify(draft));storageAvailable=true;savedDraft=true;}catch {storageAvailable=false;}
    storageMessage();
  }
  function fieldError(key,message='') {
    const field=form.elements.namedItem(key),error=document.querySelector(`#pilot-${key}-error`);
    if(!field || !error)return;
    field.setAttribute('aria-invalid',String(Boolean(message)));error.textContent=message;error.hidden=!message;
  }
  function validate() {
    const result=validatePilotBrief(readForm());
    for(const key of ['company','productURL','outcome','mediaURL','storeURL'])fieldError(key,result.errors[key]);
    formError.hidden=result.valid;
    formError.textContent=result.valid?'':'Check the marked fields, then copy or download your brief.';
    if(!result.valid) {
      const first=form.elements.namedItem(Object.keys(result.errors)[0]);
      if(first.closest('details'))first.closest('details').open=true;
      first.focus();actionState.textContent='';
    }
    return result;
  }
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('input',event=>{
    persist();actionState.textContent='';
    if(event.target.getAttribute('aria-invalid')==='true') {
      const result=validatePilotBrief(draft);fieldError(event.target.name,result.errors[event.target.name]);
      if(result.valid){formError.hidden=true;formError.textContent='';}
    }
  });
  form.addEventListener('change',persist);
  form.addEventListener('focusout',event=>{
    if(['productURL','mediaURL','storeURL'].includes(event.target.name) && event.target.value.trim()) {
      fieldError(event.target.name,validatePilotBrief(readForm()).errors[event.target.name]);
    }
  });
  copyButton.addEventListener('click',async()=>{
    const result=validate();if(!result.valid)return;
    persist();copyButton.disabled=true;copyButton.setAttribute('aria-busy','true');
    const text=pilotBriefMarkdown(result.brief);
    try {
      if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);actionState.textContent='Brief copied. Ready for you to share.';
    }catch {
      const dialog=document.querySelector('#pilot-copy-dialog'),textarea=document.querySelector('#pilot-copy-text');
      textarea.value=text;dialog.showModal();textarea.focus();textarea.select();actionState.textContent='Select and copy your brief, or download it.';
    }finally {copyButton.disabled=false;copyButton.removeAttribute('aria-busy');}
  });
  downloadButton.addEventListener('click',()=>{
    const result=validate();if(!result.valid)return;
    persist();
    try {
      const url=URL.createObjectURL(new Blob([pilotBriefMarkdown(result.brief)],{type:'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=pilotBriefFilename(result.brief);document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);actionState.textContent='Download started. Your brief has not been sent.';
    }catch {actionState.textContent='The download could not start. Use Copy brief to keep your draft.';}
  });
  storageMessage();
  fields.disabled=false;
}
