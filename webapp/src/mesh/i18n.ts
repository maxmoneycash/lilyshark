/** The interface is English, and the strings live at their call sites.
 *
 *  This used to be a translation layer: the key was the Spanish source text
 *  and locales/en.ts mapped it to English. That indirection is gone — every
 *  call site now holds the text it renders, so what you read in the source is
 *  what appears on screen.
 *
 *  t() survives because roughly four hundred call sites pass interpolation
 *  arguments through it, and because log entries are stored as a string plus
 *  its arguments and only formatted when the DEBUG screen draws them. All it
 *  does now is fill {0}, {1}, … positionally.
 */

/** t("heard {0}", x) → "heard 3s". */
export function t(text: string, ...args: (string | number)[]): string {
  let out = text;
  args.forEach((a, i) => {
    out = out.replace(`{${i}}`, String(a));
  });
  return out;
}

/** Kept so screens can keep calling it. There is nothing left to re-render
 *  for, so it never ticks. */
export function useLangTick(): number {
  return 0;
}
