// Detailed reference data stays in the generated device pages, out of the carousel payload.
export function validateDeviceDetails(devices, profiles) {
  const ids = new Set(devices.map(device => device.slug));
  const https = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
  };
  for (const id of Object.keys(profiles)) if (!ids.has(id)) throw new Error(`Unknown detail profile: ${id}`);
  for (const device of devices) {
    const profile = profiles[device.slug];
    const fail = reason => { throw new Error(`${device.slug}: ${reason}`); };
    if (!profile || !/^\d{4}-\d{2}-\d{2}$/.test(profile.reviewed)) fail('missing dated detail review');
    if (!['reviewed', 'unconfirmed', 'concept'].includes(profile.coverage)) fail('invalid detail coverage');
    if ((profile.coverage === 'concept') !== Boolean(device.owned)) fail('concept ownership mismatch');
    if (!Array.isArray(profile.gaps) || !Array.isArray(profile.notes)) fail('missing research notes');
    if (profile.coverage === 'unconfirmed' && !profile.gaps.length) fail('unconfirmed profile needs an explanation');
    if (!Array.isArray(profile.resources) || (!device.owned && !profile.resources.length)) fail('missing resources');
    const sources = new Set();
    for (const resource of profile.resources) {
      if (!resource.label?.trim() || !https(resource.url) || sources.has(resource.url)) fail('invalid or duplicate resource');
      sources.add(resource.url);
    }
    if (!profile.sections?.length) fail('missing detail sections');
    for (const section of profile.sections) {
      if (!section.title?.trim() || !section.rows?.length) fail('empty detail section');
      for (const row of section.rows) {
        if (!row.label?.trim() || !row.value?.trim()) fail('empty specification');
        if (!device.owned && (!https(row.source) || !sources.has(row.source))) fail(`unlisted source for ${row.label}`);
      }
    }
  }
}
