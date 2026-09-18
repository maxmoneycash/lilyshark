import { validateCapture, captureFrames, crcLabel, frameState, frameExplanation, hexRows } from '/capture-demo.mjs';
import { escapeHTML as e } from '/catalog.mjs';

const root=document.querySelector('[data-capture-demo]');
const message=document.querySelector('#capture-message');
const workspace=document.querySelector('#capture-workspace');
const retry=document.querySelector('#capture-retry');
let records=[],filter='all',selected;

function restoreState() {
  const params=new URLSearchParams(location.search);
  filter=['crc','truncated'].includes(params.get('view'))?params.get('view'):'all';
  const frames=captureFrames(records,filter);
  selected=frames.find(frame=>String(frame.sequence)===params.get('frame')) || frames[0];
}
function writeState(push=false) {
  const url=new URL(location.href);
  if(filter==='all')url.searchParams.delete('view');else url.searchParams.set('view',filter);
  url.searchParams.set('frame',String(selected.sequence));
  url.hash='demo';
  history[push?'pushState':'replaceState'](null,'',url);
}
function inspect() {
  const f=selected;
  document.querySelector('#packet-title').textContent=`Frame ${String(f.sequence).padStart(2,'0')}`;
  const status=document.querySelector('#packet-state');
  status.textContent=frameState(f);
  status.classList.toggle('has-issue',f.crc_state===3 || f.captured_length<f.original_length);
  document.querySelector('#packet-explanation').textContent=frameExplanation(f);
  const measures=[['RSSI',`${(f.rssi_dbm_x10/10).toFixed(1)} dBm`],['SNR',`${(f.snr_db_x10/10).toFixed(1)} dB`],['Frequency',`${(f.center_frequency_hz/1e6).toFixed(3)} MHz`],['Radio profile',`SF${f.spreading_factor} / BW${f.bandwidth_hz/1000}`],['Captured',`${f.captured_length} / ${f.original_length} bytes`],['Direction',f.direction_name==='transmit'?'Transmit (synthetic)':'Receive (synthetic)']];
  document.querySelector('#packet-measurements').innerHTML=measures.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('');
  document.querySelector('#packet-hex').textContent=hexRows(f.payload_hex);
  document.querySelector('#packet-byte-count').textContent=`${f.captured_length} bytes`;
  root.querySelectorAll('[data-frame]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.frame)===f.sequence)));
}
function render() {
  const frames=captureFrames(records,filter);
  document.querySelector('#capture-frames').classList.toggle('is-filtered',filter!=='all');
  root.querySelectorAll('[data-capture-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.captureFilter===filter)));
  document.querySelector('#capture-frames').innerHTML=frames.map(f=>`<button type="button" class="capture-frame" data-frame="${f.sequence}" aria-pressed="${f.sequence===selected.sequence}" aria-label="Inspect frame ${f.sequence}, ${e(frameState(f))}"><span><strong>${String(f.sequence).padStart(2,'0')}</strong><small>+${((f.timestamp_us-records[0].timestamp_us)/1e6).toFixed(2)}s</small></span><span>${(f.rssi_dbm_x10/10).toFixed(1)} <small>dBm</small></span><span class="frame-integrity ${f.crc_state===3?'failed':''}">${crcLabel(f)}${f.captured_length<f.original_length?'<small>Truncated</small>':''}</span></button>`).join('');
  message.textContent=`${frames.length} of ${records.length} frames · ${filter==='crc'?'CRC failure isolated':filter==='truncated'?'Truncated frame isolated':'Choose a frame to inspect'}`;
  workspace.hidden=false;
  inspect();
}
async function load() {
  message.textContent='Loading the synthetic capture…';
  retry.hidden=true;workspace.hidden=true;root.setAttribute('aria-busy','true');
  root.querySelectorAll('[data-capture-filter]').forEach(button=>button.disabled=true);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch('/samples/lilyshark-synthetic.json',{signal:controller.signal});
    if(!response.ok)throw new Error('Capture request failed');
    records=validateCapture(await response.json());
    restoreState();render();
    root.querySelectorAll('[data-capture-filter]').forEach(button=>button.disabled=false);
  } catch {
    message.textContent='The sample could not load. Try again, or download the capture to inspect it separately.';
    retry.hidden=false;
  } finally {clearTimeout(timeout);root.removeAttribute('aria-busy');}
}
root.addEventListener('click',event=>{
  const choice=event.target.closest('[data-capture-filter]');
  if(choice && records.length){filter=choice.dataset.captureFilter;const frames=captureFrames(records,filter);selected=frames.find(f=>f.sequence===selected.sequence) || frames[0];writeState(true);render();return;}
  const frame=event.target.closest('[data-frame]');
  if(frame){selected=records.find(f=>f.sequence===Number(frame.dataset.frame));writeState();inspect();}
});
retry.addEventListener('click',load);
window.addEventListener('popstate',()=>{if(records.length){restoreState();render();}});
document.querySelector('[data-share-build]').addEventListener('click',async event=>{
  const button=event.currentTarget;
  const local=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  try {
    await navigator.clipboard.writeText(location.href);
    document.querySelector('#toast').textContent=local?'Build link copied. This preview opens on this machine only.':'Build link copied.';
    button.textContent='Link copied';
    setTimeout(()=>{button.innerHTML='Copy build link <span aria-hidden="true">↗</span>';document.querySelector('#toast').textContent='';},4500);
  } catch {
    const fallback=document.querySelector('#build-share-fallback');
    fallback.hidden=false;
    const input=document.querySelector('#build-share-url');
    input.value=location.href;input.focus();input.select();
  }
});
load();
