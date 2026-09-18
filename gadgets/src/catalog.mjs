export const categories = {
  all: 'Everything', multitools: 'Multitools', radio: 'Radio & mesh',
  wifi: 'Wi-Fi & Bluetooth', rfid: 'RFID & NFC', computers: 'Computers & handhelds', boards: 'Boards & controllers',
  instruments: 'Instruments', kits: 'DIY & play', wearables: 'Wearables'
};
export const statuses = { all: 'Any availability', listed: 'Listed by maker', preorder: 'Preorder', crowdfunding: 'Crowdfunding', development: 'In development', soldout: 'Sold out', unknown: 'Availability unconfirmed', concept: 'Concept' };
export const tasks = {
  all: { label: 'All devices' },
  mesh: { label: 'Off-grid messaging', title: 'Send messages off-grid', description: 'Compare keyboard handhelds, phone-connected nodes and messaging kits.', icon: 'mesh' },
  wifi: { label: 'Wi-Fi & Bluetooth', title: 'Explore wireless signals', description: 'Find survey tools and understand the phone, host or extra board they need.', icon: 'wifi' },
  rfid: { label: 'RFID & NFC', title: 'Learn RFID & NFC', description: 'Choose between a general-purpose handheld and a dedicated RFID research tool.', icon: 'rfid' },
  computers: { label: 'Pocket computing', title: 'Carry a tiny computer', description: 'Compare keyboards, operating systems and modular hardware. Check development status before ordering.', icon: 'computer' },
  build: { label: 'Build & code', title: 'Build something you can program', description: 'Start with a kit, a watch board or an app-capable handheld. Check tools and assembly requirements.', icon: 'build' },
  radio: { label: 'Radio experiments', title: 'Explore radio protocols', description: 'Match the radio band, host computer and firmware to your experiment.', icon: 'radio' }
};
export const formats = { all: 'Any device format', handheld: 'Self-contained device', phone: 'Client / app companion', computer: 'Browser / USB tool', addon: 'Expansion board', kit: 'Assembly kit', board: 'Development board', unknown: 'Format unconfirmed', concept: 'Concept' };
export const capabilities = { all: 'Any radio / protocol', sdr: 'Software-defined radio', meshtastic: 'Meshtastic', lora: 'LoRa radio', wifi5: '5 GHz Wi-Fi', subghz: 'Sub-GHz transceiver', lf: '125 kHz RFID', hf: '13.56 MHz NFC / RFID', ble: 'Bluetooth LE', gnss: 'GNSS / GPS' };
export const sorts = { useful: 'Maker listings first', name: 'Name A–Z' };
export const slugify = text => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export function readFilters(search) {
  const p = new URLSearchParams(search);
  return { q: (p.get('q') || '').slice(0, 200), category: Object.hasOwn(categories, p.get('category')) ? p.get('category') : 'all', status: Object.hasOwn(statuses, p.get('status')) ? p.get('status') : 'all', task: Object.hasOwn(tasks, p.get('task')) ? p.get('task') : 'all', format: Object.hasOwn(formats, p.get('format')) ? p.get('format') : 'all', capability: Object.hasOwn(capabilities, p.get('capability')) ? p.get('capability') : 'all', checked: p.get('checked') === '1', sort: Object.hasOwn(sorts, p.get('sort')) ? p.get('sort') : 'useful', view: ['grid','list'].includes(p.get('view')) ? p.get('view') : 'carousel' };
}
export function filterDevices(devices, {q='', category='all', status='all', task='all', format='all', capability='all', checked=false} = {}) {
  const words = q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return devices.filter(d => (category === 'all' || d.category === category) && (status === 'all' || d.status === status) && (task === 'all' || d.usage?.tasks.includes(task)) && (format === 'all' || d.usage?.format === format) && (capability === 'all' || d.usage?.capabilities.includes(capability)) && (!checked || d.verified) && words.every(w => `${d.name} ${d.maker} ${d.description} ${d.tags.join(' ')} ${Object.values(d.specs).join(' ')} ${d.usage?.goodFor || ''} ${d.usage?.needs || ''}`.toLocaleLowerCase().includes(w)));
}
export function sortDevices(devices, sort='useful') {
  const rank = { listed: 0, soldout: 1, preorder: 2, crowdfunding: 3, development: 4, unknown: 5, concept: 6 };
  return [...devices].sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : (rank[a.status]-rank[b.status] || Number(b.verified)-Number(a.verified)));
}
export function filterURL(filters) {
  const p = new URLSearchParams();
  for (const key of ['q','task','category','format','status','capability']) if (filters[key] && filters[key] !== 'all') p.set(key,filters[key]);
  if (filters.checked) p.set('checked','1');
  if (filters.sort && filters.sort !== 'useful') p.set('sort',filters.sort);
  if (filters.view && filters.view !== 'carousel') p.set('view',filters.view);
  return p.size ? `/hardware/?${p}` : '/hardware/';
}
export function selection(value, devices, limit = Infinity) {
  const ids = new Set(devices.map(d => d.slug));
  return [...new Set(Array.isArray(value) ? value : [])].filter(s => typeof s === 'string' && ids.has(s)).slice(0, limit);
}
export function readSaved(storage, devices) {
  try { return selection(JSON.parse(storage.getItem('gadgets.saved') || '[]'), devices); } catch { return []; }
}
export function compareIDs(search, devices) {
  return selection((new URLSearchParams(search).get('devices') || '').split(','), devices, 3);
}
export function resolveComparison(search, devices, fallback = []) {
  return new URLSearchParams(search).has('devices') ? compareIDs(search, devices) : selection(fallback, devices, 3);
}
