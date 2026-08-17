// Self-check: node --experimental-strip-types src/battery.test.ts
import assert from "node:assert";
import { type Sample, forecastBattery, forecastText } from "./battery.ts";

const NOW = 1_700_000_000_000;
const H = 3_600_000;

/** series starting at `sinceMs` % changing `porHora` every hour, backwards */
const serie = (sinceMs: number, porHora: number, n = 12, ruido = 0): Sample[] =>
	Array.from({ length: n }, (_, i) => ({
		ts: NOW - (n - 1 - i) * H * 0.5, // one sample every half hour
		value: sinceMs + porHora * ((n - 1 - i) * -0.5) + (i % 2 ? ruido : -ruido),
	}));

// clean discharge: 2 %/h from 50 % ⇒ 25 h to zero
const baja = forecastBattery(serie(50, -2), 12, NOW);
assert.ok(baja, "a forecast is expected");
assert.ok(Math.abs(baja.slope + 2) < 0.01, `slope ${baja.slope}`);
assert.ok(
	Math.abs((baja.hoursRemaining ?? 0) - 25) < 0.5,
	`hours ${baja.hoursRemaining}`,
);
assert.ok(baja.fit > 0.99);

// charging: no runout is predicted
const sube = forecastBattery(serie(60, 3), 12, NOW);
assert.ok(sube);
assert.equal(sube.hoursRemaining, undefined, "cargando no se agota");

// flat battery: don't turn noise into a runout warning
const plana = forecastBattery(serie(80, 0), 12, NOW);
assert.ok(plana);
assert.equal(plana.hoursRemaining, undefined);

// too little data: better to say nothing than to invent a line
assert.equal(forecastBattery(serie(50, -2, 3), 12, NOW), undefined);

// outside the window: old samples don't count
const viejas: Sample[] = Array.from({ length: 10 }, (_, i) => ({
	ts: NOW - (50 + i) * H,
	value: 90 - i,
}));
assert.equal(forecastBattery(viejas, 6, NOW), undefined);

// >100 % is external power: discarded, leaving too little data
const enchufado: Sample[] = Array.from({ length: 10 }, (_, i) => ({
	ts: NOW - i * H * 0.5,
	value: 101,
}));
assert.equal(forecastBattery(enchufado, 12, NOW), undefined);

// noisy series: the fit must drop and flag it as unreliable
const noisy = forecastBattery(serie(50, -0.2, 12, 18), 12, NOW);
assert.ok(noisy);
assert.ok(noisy.fit < 0.5, `fit ${noisy.fit} should be low`);
assert.equal(
	forecastText(noisy)[0],
	"IRREGULAR BATTERY · no reliable forecast",
);

// texts per case
assert.equal(forecastText(baja)[0], "EMPTY IN ~{0} h");
assert.equal(forecastText(sube)[0], "CHARGING · {0} %/h");
assert.equal(forecastText(plana)[0], "STEADY · no noticeable discharge");
// very slow discharge: expressed in days, not in three-digit hours
const lenta = forecastBattery(serie(90, -0.5), 12, NOW);
assert.ok(lenta);
assert.equal(forecastText(lenta)[0], "EMPTY IN ~{0} days");

console.log("battery.test.ts OK");
