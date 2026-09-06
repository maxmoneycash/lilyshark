/** Small line icons shared by the analyzer and flasher. */
const paths = {
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  check: "m5 12 4 4L19 6",
  pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
};

export function UiIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

/** Leaflet takes markup rather than React children. Only fixed icon data is used. */
export const mapPinMarkup = `<svg width="22" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths.pin}"/></svg>`;
