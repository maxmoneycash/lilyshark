// Self-check: node --experimental-strip-types src/fmt.test.ts
import assert from "node:assert";

// fmt.ts reads localStorage, which doesn't exist in Node
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (k: string) => stored.get(k) ?? null,
		setItem: (k: string, v: string) => void stored.set(k, v),
		removeItem: (k: string) => void stored.delete(k),
	},
	configurable: true,
});

const { asciiBattery, distKm, dateTime, fmtDist, fmtHemisphere, getHourPref, hhmm, is12h } =
	await import("./fmt.ts");

const T = new Date("2026-07-20T15:04:05").getTime();
const MIDNIGHT = new Date("2026-07-20T00:30:00").getTime();

// ── clock format ─────────────────────────────────────────────────────────
assert.equal(getHourPref(), "auto", "nothing stored yields the default");

stored.set("hourFormat", "24");
assert.equal(is12h(), false);
assert.match(hhmm(T), /^15[:.]04[:.]05$/, `24 h gave ${hhmm(T)}`);
assert.ok(!/\d\d:\d\d:\d\d.+[ap]/i.test(hhmm(T)), "24 h must not carry AM/PM");

stored.set("hourFormat", "12");
assert.equal(is12h(), true);
// 2-digit on purpose: the column mustn't shift width in a monospace table
assert.match(
	hhmm(T),
	/\b03[:.]04/,
	`12 h should show 3 o'clock, got ${hhmm(T)}`,
);
assert.match(hhmm(T), /[ap]\.?\s?m|[AP]M/i, `12 h missing AM/PM: ${hhmm(T)}`);
// midnight in 12 h is 12, never 0: the classic off-by-one of hand-rolled formatters
assert.match(
	hhmm(MIDNIGHT),
	/\b12[:.]30/,
	`midnight gave ${hhmm(MIDNIGHT)}`,
);

// seconds are optional, but the hour must not change with them
assert.ok(
	hhmm(T, false).length < hhmm(T).length,
	"without seconds it must be shorter",
);
assert.ok(hhmm(T).startsWith(hhmm(T, false).slice(0, 2)));

// a corrupt value falls back to automatic instead of breaking the clock
stored.set("hourFormat", "garbage");
assert.equal(getHourPref(), "auto");
assert.ok(hhmm(T).length > 0);

// ── date + time ──────────────────────────────────────────────────────────
// toLocaleString with only hour12 and no component would return the date
// alone: dateTime has to keep carrying the time
stored.set("hourFormat", "24");
assert.match(
	dateTime(T),
	/15[:.]04/,
	`dateTime dropped the time: ${dateTime(T)}`,
);
assert.match(
	dateTime(T),
	/\d{1,4}[/.-]\d{1,2}/,
	`dateTime dropped the date: ${dateTime(T)}`,
);

// ── battery bar ──────────────────────────────────────────────────────────
// the width is fixed: it lines up in a column of a monospace table
const widths = new Set([0, 5, 50, 99, 100].map((n) => asciiBattery(n).length));
assert.equal(widths.size, 1, `battery bar width shifted: ${[...widths]}`);
assert.ok(asciiBattery(101).includes("PWR"), ">100 % means external power");
assert.equal(asciiBattery(undefined), "—");

// ── distance ─────────────────────────────────────────────────────────────
// same point is zero
assert.equal(distKm(39.57, 2.65, 39.57, 2.65), 0);
// ~1° of latitude is ~111 km, regardless of longitude
assert.ok(
	Math.abs(distKm(39, 2, 40, 2) - 111.2) < 1,
	`1° lat: ${distKm(39, 2, 40, 2)}`,
);
// symmetric
assert.ok(
	Math.abs(distKm(39.5, 2.6, 39.7, 2.9) - distKm(39.7, 2.9, 39.5, 2.6)) < 1e-9,
);
// known short leg (Palma → Inca, ~28 km) within a few percent of haversine
const d = distKm(39.5696, 2.6502, 39.7217, 2.9106);
assert.ok(d > 26 && d < 30, `Palma-Inca out of range: ${d}`);

assert.equal(fmtDist(0.84), "840M");
assert.equal(fmtDist(0.999), "999M");
assert.equal(fmtDist(1), "1.0KM");
assert.equal(fmtDist(12.37), "12.4KM");

assert.equal(fmtHemisphere(37.7749, -122.4194), "37.7749 N  122.419 W");
assert.equal(fmtHemisphere(-33.8688, 151.2093), "33.8688 S  151.209 E");
assert.equal(
	fmtHemisphere(37.4419, -122.143, 5, 5),
	"37.44190 N  122.14300 W",
);

console.log("fmt.test.ts OK");
