// Explain known local destinations without implying that other hosts are public.
export function shareLinkNotice(value) {
  let host;
  try { host=new URL(value).hostname.toLowerCase(); } catch { return ''; }
  if(host==='localhost' || host.endsWith('.localhost') || host==='[::1]' || host==='0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host)) {
    return 'Local preview link — it only opens on this computer.';
  }
  const parts=host.split('.').map(Number);
  if((parts.length===4 && (parts[0]===10 || (parts[0]===172 && parts[1]>=16 && parts[1]<=31) || (parts[0]===192 && parts[1]===168))) || host.endsWith('.local') || /^\[f[cd][\da-f]{2}:/.test(host) || /^\[fe[89ab][\da-f]:/.test(host)) {
    return 'Private-network link — recipients need access to that network.';
  }
  return '';
}
