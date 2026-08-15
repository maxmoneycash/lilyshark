// Self-check: node --experimental-strip-types src/i18n.test.ts
// An untranslated key breaks nothing: t() returns the Spanish. That's exactly
// why it has to be hunted on purpose, or the English UI fills up with leftovers.
import assert from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "./locales/en.ts";
import { THEME_LABELS } from "./theme.ts";

// t("...") / t('...') and addLog("...") / addLog('...'), keeping the literal.
// addLog stores the key untranslated (fmtLog translates it at render), so its
// keys must be in en.ts just like t()'s.
const CALL = /\b(?:t|addLog)\(\s*(["'])(.*?)(?<!\\)\1/gs;

// keys that never appear as a literal because they're built at runtime:
// tabs (t(tab)), theme names (t(THEME_LABELS[x])) and the battery forecast
// texts, which battery.ts returns as a key. The theme names come from the real
// table: a copy by hand is what let INVERTED BONE ship untranslated.
const DINAMICAS = [
	"NODOS",
	"MAPA",
	"MALLA",
	"TELEMETRÍA",
	...Object.values(THEME_LABELS),
	"BATERÍA IRREGULAR · sin previsión fiable",
	"CARGANDO · {0} %/h",
	"ESTABLE · sin descarga apreciable",
	"SE AGOTA EN ~{0} h",
	"SE AGOTA EN ~{0} días",
];

function fuentes(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...fuentes(p));
		// i18n.ts is excluded: its example comment is not a real string
		else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name))
			if (!p.includes("locales") && e.name !== "i18n.ts") out.push(p);
	}
	return out;
}

const usadas = new Set<string>();
// ported into the lilyshark webapp: the terminal UI lives under src/mesh, and
// scanning the whole webapp would catch unrelated t() calls outside the port
for (const f of fuentes("src/mesh")) {
	const src = readFileSync(f, "utf8");
	for (const m of src.matchAll(CALL)) usadas.add(m[2]);
}

assert.ok(
	usadas.size > 100,
	`pocas claves encontradas (${usadas.size}): ¿regex rota?`,
);

const faltan = [...usadas].filter((k) => !(k in en));
assert.deepEqual(
	faltan,
	[],
	`sin traducir en en.ts:\n  ${faltan.join("\n  ")}`,
);

// the dynamic ones don't show up in the scan, so they're checked by hand
const faltanDin = DINAMICAS.filter((k) => !(k in en));
assert.deepEqual(faltanDin, [], `claves dinámicas sin traducir: ${faltanDin}`);

// ── automatic language ───────────────────────────────────────────────────
// i18n.ts reads localStorage and navigator, which don't exist in Node
const guardado = new Map<string, string>();
const stub = (lang: string) => {
	Object.defineProperty(globalThis, "navigator", {
		value: { language: lang },
		configurable: true,
	});
};
Object.defineProperty(globalThis, "localStorage", {
	value: {
		getItem: (k: string) => guardado.get(k) ?? null,
		setItem: (k: string, v: string) => void guardado.set(k, v),
		removeItem: (k: string) => void guardado.delete(k),
	},
	configurable: true,
});
stub("es-ES");

const { getLang, getLangPref } = await import("./i18n.ts");

assert.equal(getLangPref(), "auto", "sin nada guardado, automático");
assert.equal(getLang(), "es");
stub("es"); // without a region
assert.equal(getLang(), "es");
stub("ES-MX"); // capitals: Windows sometimes reports them
assert.equal(getLang(), "es");
// "est" is Estonian: a prefix match would take it for Spanish
for (const otro of ["en-US", "ca-ES", "fr", "de-DE", "est-EE", "eu-ES"]) {
	stub(otro);
	assert.equal(getLang(), "en", `${otro} no es español, toca inglés`);
}
// a manual choice wins over the system
guardado.set("lang", "es");
assert.equal(getLangPref(), "es");
assert.equal(getLang(), "es", "en-US de sistema pero español elegido a mano");
guardado.set("lang", "basura");
assert.equal(getLangPref(), "auto", "un valor corrupto vuelve a automático");

console.log(`i18n.test.ts OK · ${usadas.size} claves usadas, todas traducidas`);
