// Self-check: node --experimental-strip-types src/fmt.test.ts
import assert from "node:assert";

// fmt.ts reads localStorage, which doesn't exist in Node
const guardado = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (k: string) => guardado.get(k) ?? null,
		setItem: (k: string, v: string) => void guardado.set(k, v),
		removeItem: (k: string) => void guardado.delete(k),
	},
	configurable: true,
});

const { asciiBattery, distKm, fechaHora, fmtDist, getHourPref, hora, is12h } =
	await import("./fmt.ts");

const T = new Date("2026-07-20T15:04:05").getTime();
const MEDIANOCHE = new Date("2026-07-20T00:30:00").getTime();

// ── clock format ─────────────────────────────────────────────────────────
assert.equal(getHourPref(), "auto", "sin nada guardado, automático");

guardado.set("hourFormat", "24");
assert.equal(is12h(), false);
assert.match(hora(T), /^15[:.]04[:.]05$/, `24 h da ${hora(T)}`);
assert.ok(!/\d\d:\d\d:\d\d.+[ap]/i.test(hora(T)), "24 h no lleva AM/PM");

guardado.set("hourFormat", "12");
assert.equal(is12h(), true);
// 2-digit on purpose: the column mustn't shift width in a monospace table
assert.match(
	hora(T),
	/\b03[:.]04/,
	`12 h debería mostrar las 3, da ${hora(T)}`,
);
assert.match(hora(T), /[ap]\.?\s?m|[AP]M/i, `12 h sin AM/PM: ${hora(T)}`);
// midnight in 12 h is 12, never 0: the classic off-by-one of hand-rolled formatters
assert.match(
	hora(MEDIANOCHE),
	/\b12[:.]30/,
	`medianoche da ${hora(MEDIANOCHE)}`,
);

// seconds are optional, but the hour must not change with them
assert.ok(
	hora(T, false).length < hora(T).length,
	"sin segundos debe ser más corto",
);
assert.ok(hora(T).startsWith(hora(T, false).slice(0, 2)));

// a corrupt value falls back to automatic instead of breaking the clock
guardado.set("hourFormat", "basura");
assert.equal(getHourPref(), "auto");
assert.ok(hora(T).length > 0);

// ── date + time ──────────────────────────────────────────────────────────
// toLocaleString with only hour12 and no component would return the date
// alone: fechaHora has to keep carrying the time
guardado.set("hourFormat", "24");
assert.match(
	fechaHora(T),
	/15[:.]04/,
	`fechaHora pierde la hora: ${fechaHora(T)}`,
);
assert.match(
	fechaHora(T),
	/\d{1,4}[/.-]\d{1,2}/,
	`fechaHora pierde la fecha: ${fechaHora(T)}`,
);

// ── battery bar ──────────────────────────────────────────────────────────
// the width is fixed: it lines up in a column of a monospace table
const anchos = new Set([0, 5, 50, 99, 100].map((n) => asciiBattery(n).length));
assert.equal(anchos.size, 1, `la barra cambia de ancho: ${[...anchos]}`);
assert.ok(asciiBattery(101).includes("PWR"), ">100 % es alimentación externa");
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
assert.ok(d > 26 && d < 30, `Palma-Inca fuera de rango: ${d}`);

assert.equal(fmtDist(0.84), "840 m");
assert.equal(fmtDist(0.999), "999 m");
assert.equal(fmtDist(1), "1.0 km");
assert.equal(fmtDist(12.37), "12.4 km");

console.log("fmt.test.ts OK");
