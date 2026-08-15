import type { NodeEntry } from "./store";

import type { Prevision } from "./battery";

export interface AlertCfg {
  on: boolean;
  battery: number; // % · warn below this
  silentH: number; // hours without a signal
  autonomiaH: number; // hours of runtime left · 0 = don't warn
}

const DEFAULT_ALERTS: AlertCfg = {
  on: false,
  battery: 20,
  silentH: 12,
  autonomiaH: 12,
};

const KEY = "alerts";

export function getAlertCfg(): AlertCfg {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_ALERTS, ...JSON.parse(raw) } : DEFAULT_ALERTS;
  } catch {
    return DEFAULT_ALERTS;
  }
}

export function setAlertCfg(cfg: AlertCfg): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

/** No preformatted text: the module stays pure (and testable without a DOM);
 *  whoever notifies takes care of translating it. */
export interface Alert {
  key: string; // node+type, so the warning isn't repeated
  kind: "bateria" | "mudo" | "autonomia";
  name: string; // readable node name
  value: number; // % battery · hours of silence
  threshold: number;
}

/** Repeating the same warning constantly would be noise; once every 6 h is
 *  enough not to forget the problem without becoming spam. */
export const COOLDOWN_MS = 6 * 3_600_000;

/** Pending alerts. Favorites only: with ~100 nodes in the mesh, warning about
 *  all of them would be pure noise; a favorite is the "I care" signal.
 *  `lastFired` holds the last time each key fired (mutated here). */
export function evalAlerts(
  nodes: Iterable<NodeEntry>,
  cfg: AlertCfg,
  lastFired: Map<string, number>,
  now = Date.now(),
  myNodeNum?: number,
): Alert[] {
  if (!cfg.on) return [];
  const out: Alert[] = [];
  const due = (key: string) => now - (lastFired.get(key) ?? -Infinity) >= COOLDOWN_MS;

  for (const n of nodes) {
    if (!n.fav || n.num === myNodeNum) continue;
    const who = n.longName || n.shortName || `!${n.num.toString(16)}`;

    // batteryLevel > 100 means external power, not a battery
    if (
      n.batteryLevel !== undefined &&
      n.batteryLevel <= cfg.battery &&
      n.batteryLevel <= 100
    ) {
      const key = `bat:${n.num}`;
      if (due(key)) {
        out.push({
          key,
          kind: "bateria",
          name: who,
          value: n.batteryLevel,
          threshold: cfg.battery,
        });
      }
    }

    // lastHeard in epoch s; 0 = never heard, which is not measurable silence
    if (n.lastHeard > 0) {
      const horas = (now - n.lastHeard * 1000) / 3_600_000;
      if (horas >= cfg.silentH) {
        const key = `mudo:${n.num}`;
        if (due(key)) {
          out.push({
            key,
            kind: "mudo",
            name: who,
            value: Math.floor(horas),
            threshold: cfg.silentH,
          });
        }
      }
    }
  }

  for (const a of out) lastFired.set(a.key, now);
  return out;
}

/** Runtime warning: the battery isn't low yet, but at the current rate it
 *  will be soon. It stays quiet when the forecast is unreliable — warning
 *  about a runout derived from an irregular series is worse than not warning. */
export function evalAutonomia(
  nodo: { num: number; nombre: string; fav?: boolean },
  prevision: Prevision | undefined,
  cfg: AlertCfg,
  lastFired: Map<string, number>,
  now = Date.now(),
): Alert | undefined {
  if (!cfg.on || !cfg.autonomiaH || !nodo.fav) return undefined;
  const h = prevision?.horasRestantes;
  if (h === undefined || prevision!.ajuste < 0.5) return undefined;
  if (h > cfg.autonomiaH) return undefined;
  const key = `auto:${nodo.num}`;
  if (now - (lastFired.get(key) ?? -Infinity) < COOLDOWN_MS) return undefined;
  lastFired.set(key, now);
  return {
    key,
    kind: "autonomia",
    name: nodo.nombre,
    value: Math.round(h),
    threshold: cfg.autonomiaH,
  };
}
