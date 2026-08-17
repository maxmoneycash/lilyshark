// Self-check: node --experimental-strip-types src/alerts.test.ts
import assert from "node:assert";
import { COOLDOWN_MS, evalAlerts, evalAutonomia } from "./alerts.ts";
import type { Forecast } from "./battery.ts";
import type { NodeEntry } from "./store.ts";

const NOW = 1_700_000_000_000;
const cfg = { on: true, battery: 20, silentH: 12, autonomiaH: 12 };
const node = (p: Partial<NodeEntry>): NodeEntry => ({
	num: 1,
	longName: "Repetidor",
	shortName: "REP",
	lastHeard: Math.floor(NOW / 1000),
	...p,
});

// off = nothing, even with plenty of reasons
assert.equal(
	evalAlerts(
		[node({ fav: true, batteryLevel: 5 })],
		{ ...cfg, on: false },
		new Map(),
		NOW,
	).length,
	0,
);

// favorites only: a regular node on its last legs doesn't warn
assert.equal(
	evalAlerts([node({ batteryLevel: 5 })], cfg, new Map(), NOW).length,
	0,
);

// battery below the threshold
const bat = evalAlerts(
	[node({ fav: true, batteryLevel: 12 })],
	cfg,
	new Map(),
	NOW,
);
assert.equal(bat.length, 1);
assert.ok(bat[0].key.startsWith("bat:"));

// exactly at the threshold it warns; above it doesn't
assert.equal(
	evalAlerts([node({ fav: true, batteryLevel: 20 })], cfg, new Map(), NOW)
		.length,
	1,
);
assert.equal(
	evalAlerts([node({ fav: true, batteryLevel: 21 })], cfg, new Map(), NOW)
		.length,
	0,
);

// >100 is external power, not a dying battery
assert.equal(
	evalAlerts([node({ fav: true, batteryLevel: 101 })], cfg, new Map(), NOW)
		.length,
	0,
);

// silence: 13 h without a signal passes the 12 h threshold
const mudo = evalAlerts(
	[node({ fav: true, lastHeard: Math.floor(NOW / 1000) - 13 * 3600 })],
	cfg,
	new Map(),
	NOW,
);
assert.equal(mudo.length, 1);
assert.ok(mudo[0].key.startsWith("mudo:"));

// lastHeard 0 = never heard, not measurable silence
assert.equal(
	evalAlerts([node({ fav: true, lastHeard: 0 })], cfg, new Map(), NOW).length,
	0,
);

// our own node doesn't alert about itself
assert.equal(
	evalAlerts(
		[node({ num: 7, fav: true, batteryLevel: 3 })],
		cfg,
		new Map(),
		NOW,
		7,
	).length,
	0,
);

// cooldown: the same reason doesn't fire again until it has passed
const fired = new Map<string, number>();
const n = [node({ fav: true, batteryLevel: 10 })];
assert.equal(evalAlerts(n, cfg, fired, NOW).length, 1);
assert.equal(
	evalAlerts(n, cfg, fired, NOW + 60_000).length,
	0,
	"no debe repetir enseguida",
);
assert.equal(
	evalAlerts(n, cfg, fired, NOW + COOLDOWN_MS).length,
	1,
	"debe volver a avisar pasado el cooldown",
);

// two reasons at once on the same node = two separate warnings
const dos = evalAlerts(
	[
		node({
			fav: true,
			batteryLevel: 5,
			lastHeard: Math.floor(NOW / 1000) - 20 * 3600,
		}),
	],
	cfg,
	new Map(),
	NOW,
);
assert.equal(dos.length, 2);

// ── evalAutonomia ────────────────────────────────────────────────────────
const fav = { num: 9, nombre: "Repetidor", fav: true };
const prev = (hoursRemaining?: number, fit = 0.9): Forecast => ({
	slope: -2,
	hoursRemaining,
	fit,
	samples: 20,
	ultimo: 40,
});

// below the threshold: warns
const av = evalAutonomia(fav, prev(6), cfg, new Map(), NOW);
assert.ok(av);
assert.equal(av.kind, "autonomia");
assert.equal(av.value, 6);

// exactly at the threshold it warns; above it doesn't
assert.ok(evalAutonomia(fav, prev(12), cfg, new Map(), NOW));
assert.equal(evalAutonomia(fav, prev(13), cfg, new Map(), NOW), undefined);

// unreliable forecast: better to stay quiet than to invent an hour
assert.equal(evalAutonomia(fav, prev(3, 0.2), cfg, new Map(), NOW), undefined);

// no forecast (charging or steady) means nothing to warn about
assert.equal(
	evalAutonomia(fav, prev(undefined), cfg, new Map(), NOW),
	undefined,
);
assert.equal(evalAutonomia(fav, undefined, cfg, new Map(), NOW), undefined);

// favorites only, and only with alerts enabled
assert.equal(
	evalAutonomia({ ...fav, fav: false }, prev(3), cfg, new Map(), NOW),
	undefined,
);
assert.equal(
	evalAutonomia(fav, prev(3), { ...cfg, on: false }, new Map(), NOW),
	undefined,
);
// 0 h = disabled
assert.equal(
	evalAutonomia(fav, prev(3), { ...cfg, autonomiaH: 0 }, new Map(), NOW),
	undefined,
);

// cooldown shared with the rest of the alerts
const f2 = new Map<string, number>();
assert.ok(evalAutonomia(fav, prev(5), cfg, f2, NOW));
assert.equal(evalAutonomia(fav, prev(5), cfg, f2, NOW + 60_000), undefined);
assert.ok(evalAutonomia(fav, prev(5), cfg, f2, NOW + COOLDOWN_MS));

console.log("alerts.test.ts OK");
