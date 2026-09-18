/** Escape untrusted text for the small Leaflet popups that use HTML strings.
 * Use textContent for new DOM content wherever possible. */
export function htmlText(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
