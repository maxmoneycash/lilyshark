import { useEffect, useState } from "react";
// explicit .ts: Vite doesn't care, but Node's loader needs it for the self-check
import en from "./locales/en.ts";

/** Minimal i18n: the key IS the Spanish text; en.ts maps es→en.
 *  Adding a language = one more file and one branch in t(). No dependencies. */

export type Lang = "es" | "en";

const LANG_KEY = "lang";
const LANG_EVENT = "langchange";

/** What the selector shows: "auto" while nothing has been chosen by hand. */
export function getLangPref(): Lang | "auto" {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === "es" || saved === "en" ? saved : "auto";
}

export function getLang(): Lang {
  const pref = getLangPref();
  if (pref !== "auto") return pref;
  // WebView2 reports the Windows display language here. Compare the whole
  // primary subtag: a prefix match would also catch "est" (Estonian).
  return navigator.language.toLowerCase().split("-")[0] === "es" ? "es" : "en";
}

export function setLang(l: Lang | "auto"): void {
  if (l === "auto") localStorage.removeItem(LANG_KEY);
  else localStorage.setItem(LANG_KEY, l);
  // Switch live instead of reloading: a reload would drop the radio connection.
  lang = getLang();
  window.dispatchEvent(new Event(LANG_EVENT));
}

// current resolved language; setLang refreshes it
let lang = getLang();

/** Re-renders on a language change. Called once at the root so the whole UI
 *  re-translates without a reload. */
export function useLangTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((v) => v + 1);
    window.addEventListener(LANG_EVENT, on);
    return () => window.removeEventListener(LANG_EVENT, on);
  }, []);
  return tick;
}

/** t("texto en español") · t("hace {0}", x) to interpolate */
export function t(es: string, ...args: (string | number)[]): string {
  let s = lang === "en" ? (en[es] ?? es) : es;
  args.forEach((a, i) => {
    s = s.replace(`{${i}}`, String(a));
  });
  return s;
}
