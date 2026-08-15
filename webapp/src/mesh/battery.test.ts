// Self-check: node --experimental-strip-types src/battery.test.ts
import assert from "node:assert";
import { type Muestra, preverBateria, textoPrevision } from "./battery.ts";

const NOW = 1_700_000_000_000;
const H = 3_600_000;

/** series starting at `desde` % changing `porHora` every hour, backwards */
const serie = (desde: number, porHora: number, n = 12, ruido = 0): Muestra[] =>
	Array.from({ length: n }, (_, i) => ({
		ts: NOW - (n - 1 - i) * H * 0.5, // one sample every half hour
		value: desde + porHora * ((n - 1 - i) * -0.5) + (i % 2 ? ruido : -ruido),
	}));

// clean discharge: 2 %/h from 50 % ⇒ 25 h to zero
const baja = preverBateria(serie(50, -2), 12, NOW);
assert.ok(baja, "debería haber previsión");
assert.ok(Math.abs(baja.pendiente + 2) < 0.01, `pendiente ${baja.pendiente}`);
assert.ok(
	Math.abs((baja.horasRestantes ?? 0) - 25) < 0.5,
	`horas ${baja.horasRestantes}`,
);
assert.ok(baja.ajuste > 0.99);

// charging: no runout is predicted
const sube = preverBateria(serie(60, 3), 12, NOW);
assert.ok(sube);
assert.equal(sube.horasRestantes, undefined, "cargando no se agota");

// flat battery: don't turn noise into a runout warning
const plana = preverBateria(serie(80, 0), 12, NOW);
assert.ok(plana);
assert.equal(plana.horasRestantes, undefined);

// too little data: better to say nothing than to invent a line
assert.equal(preverBateria(serie(50, -2, 3), 12, NOW), undefined);

// outside the window: old samples don't count
const viejas: Muestra[] = Array.from({ length: 10 }, (_, i) => ({
	ts: NOW - (50 + i) * H,
	value: 90 - i,
}));
assert.equal(preverBateria(viejas, 6, NOW), undefined);

// >100 % is external power: discarded, leaving too little data
const enchufado: Muestra[] = Array.from({ length: 10 }, (_, i) => ({
	ts: NOW - i * H * 0.5,
	value: 101,
}));
assert.equal(preverBateria(enchufado, 12, NOW), undefined);

// noisy series: the fit must drop and flag it as unreliable
const ruidosa = preverBateria(serie(50, -0.2, 12, 18), 12, NOW);
assert.ok(ruidosa);
assert.ok(ruidosa.ajuste < 0.5, `ajuste ${ruidosa.ajuste} debería ser bajo`);
assert.equal(
	textoPrevision(ruidosa)[0],
	"BATERÍA IRREGULAR · sin previsión fiable",
);

// texts per case
assert.equal(textoPrevision(baja)[0], "SE AGOTA EN ~{0} h");
assert.equal(textoPrevision(sube)[0], "CARGANDO · {0} %/h");
assert.equal(textoPrevision(plana)[0], "ESTABLE · sin descarga apreciable");
// very slow discharge: expressed in days, not in three-digit hours
const lenta = preverBateria(serie(90, -0.5), 12, NOW);
assert.ok(lenta);
assert.equal(textoPrevision(lenta)[0], "SE AGOTA EN ~{0} días");

console.log("battery.test.ts OK");
