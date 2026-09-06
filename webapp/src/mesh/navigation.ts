import { hashRoute } from "../lib/permalink";

export const NAV_TABS = [
  "INTRO",
  "FLASH",
  "DOCS",
  "TRAFFIC",
  "SHELBY",
  "CHAT",
  "NODES",
  "MAP",
  "MESH",
  "TELEMETRY",
  "SPECTRUM",
  "SNIFFER",
  "CONFIG",
] as const;

export type Tab = (typeof NAV_TABS)[number] | "PAPER" | "DEBUG";

export function isTab(value: string): value is Tab {
  return (
    value === "PAPER" ||
    value === "DEBUG" ||
    (NAV_TABS as readonly string[]).includes(value)
  );
}

export function tabFromLocation(location: {
  pathname: string;
  hash: string;
}): Tab {
  const route = hashRoute(location.hash).slice(1).toUpperCase();
  if (route === "RESOLVE") return "TRAFFIC";
  if (isTab(route)) return route;
  return /^\/flash(?:\/|$)/.test(location.pathname) ? "FLASH" : "INTRO";
}

export function tabHref(tab: Tab): string {
  return tab === "FLASH" ? "/flash/" : `/#${tab.toLowerCase()}`;
}

export function parentTab(tab: Tab): (typeof NAV_TABS)[number] {
  return tab === "PAPER" ? "DOCS" : tab === "DEBUG" ? "CONFIG" : tab;
}
