import { useEffect, useState } from "react";

/** Clock format. "auto" follows the system locale, which is what most people
 *  expect; the other two force it. Dates always follow the locale. */
export type HourPref = "auto" | "12" | "24";

const HOUR_KEY = "hourFormat";
const HOUR_EVENT = "hourformatchange";

export function getHourPref(): HourPref {
  const v = localStorage.getItem(HOUR_KEY);
  return v === "12" || v === "24" ? v : "auto";
}

export function setHourPref(p: HourPref): void {
  if (p === "auto") localStorage.removeItem(HOUR_KEY);
  else localStorage.setItem(HOUR_KEY, p);
  window.dispatchEvent(new Event(HOUR_EVENT));
}

/** undefined = let the locale decide */
function hour12(): boolean | undefined {
  const p = getHourPref();
  return p === "auto" ? undefined : p === "12";
}

/** True when the format in force is 12 h, whatever decided it. */
export function is12h(): boolean {
  return (
    hour12() ??
    (new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions()
      .hour12 === true)
  );
}

/** Re-renders on a format change. Used at the root so the whole UI follows. */
export function useHourTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const on = () => setTick((v) => v + 1);
    window.addEventListener(HOUR_EVENT, on);
    return () => window.removeEventListener(HOUR_EVENT, on);
  }, []);
  return tick;
}

/** hh:mm:ss. 2-digit even in 12 h: the width has to stay fixed in a monospace UI. */
export function hhmm(ms: number, seconds = true): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    hour12: hour12(),
  });
}

/** Date + time, for anything not from today. */
export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "medium",
    hour12: hour12(),
  });
}

export function ago(epochS: number): string {
  if (!epochS) return "—";
  const s = Math.floor(Date.now() / 1000 - epochS);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Distance between two coordinates, km. Equirectangular approximation:
 *  within one mesh (tens of km) the error vs haversine is well under 1 %. */
export function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** "840M" under a km, "12.4KM" above. Matches field range chrome. */
export function fmtDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}M` : `${km.toFixed(1)}KM`;
}

/** Field-style hemisphere coords. West is W, south is S. */
export function fmtHemisphere(
  lat: number,
  lon: number,
  latDigits = 4,
  lonDigits = 3,
): string {
  return `${Math.abs(lat).toFixed(latDigits)} ${lat >= 0 ? "N" : "S"}  ${Math.abs(lon).toFixed(lonDigits)} ${lon >= 0 ? "E" : "W"}`;
}

/** [███████░░░]  72% — or PWR when plugged in.
 *  The U+2588/U+2591 blocks depend on the JetBrains Mono bundled in
 *  App.css: Google Fonts subsets cut that range and break the alignment.
 *  The percentage is padded with NBSP because HTML collapses normal spaces. */
export function asciiBattery(level?: number): string {
  if (level === undefined) return "—";
  if (level > 100) return "[██████████] PWR";
  const full = Math.min(10, Math.max(0, Math.round(level / 10)));
  const pct = String(level).padStart(3, " ");
  return `[${"█".repeat(full)}${"░".repeat(10 - full)}] ${pct}%`;
}

/** color class by SNR: ≥5 ok, 0–5 warn, <0 err */
export function snrClass(snr?: number): string {
  if (snr === undefined) return "dim";
  if (snr >= 5) return "ok";
  if (snr >= 0) return "warn";
  return "err";
}

/** MeshCore has no hardware enum: contacts advertise a type (numeric literals
 *  = protocol constants, store.ts ContactType; this module stays pure), and
 *  the radio itself reports a free-form model string shown in the footer. */
export function contactTypeName(type?: number): string {
  switch (type) {
    case 1:
      return "CHAT";
    case 2:
      return "REPEATER";
    case 3:
      return "ROOM";
    case 4:
      return "SENSOR";
    default:
      return "—";
  }
}

/** Kept under the old name so the node detail reads the same: for a MeshCore
 *  contact the "hardware" column is its advertised role. */
export function hwName(type?: number | string): string {
  if (type === undefined) return "—";
  return typeof type === "string" ? type : contactTypeName(type);
}

/** 869525 kHz → "869.525 MHz" */
export function fmtFreq(khz?: number): string {
  if (!khz) return "—";
  return `${(khz / 1000).toFixed(3)} MHz`;
}
