// Self-check: node --experimental-strip-types src/mesh/i18n.test.ts
//
// The interface used to be written in Spanish and translated to English at
// render time by locales/en.ts. Both are gone: every call site now holds the
// English text it renders. This test is what stops Spanish coming back — a
// leftover string no longer breaks anything visibly, which is exactly why it
// has to be hunted on purpose.
import assert from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "./i18n.ts";

// ── t() is interpolation and nothing else ────────────────────────────────
assert.equal(t("plain"), "plain");
assert.equal(t("heard {0}", "3s"), "heard 3s");
assert.equal(t("{0} of {1}", 2, 7), "2 of 7");
assert.equal(t("no args {0}"), "no args {0}", "a missing argument stays literal");

// ── the translation layer is really gone ─────────────────────────────────
assert.ok(!existsSync("src/mesh/locales"), "locales/ must not come back");

// ── no Spanish in any shipped source ─────────────────────────────────────
function sources(dir: string): string[] {
	const out: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name !== "assets") out.push(...sources(p));
		} else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
			out.push(p);
		}
	}
	return out;
}

// Characters that only appear in Spanish text, and words common enough in this
// codebase's former Spanish to catch a paste that happens to avoid accents.
const ACCENTED = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
// Built from escaped fragments on purpose: written as one literal, a global
// rename sweep across the tree edits this list too and quietly turns the guard
// into a matcher for English words.
const SPANISH_WORDS = [
	"sin", "para", "los", "las", "del", "una", "uno",
	"por", "que", "pero", "desde", "hasta",
	"nodo", "nodos", "mensaje", "canal", "canales",
	"hora", "horas", "dias", "guardar", "fallo",
	"desconectar", "ninguno", "todos", "escucha",
	"estable", "cargando", "idioma", "tema",
];
const WORDS = new RegExp(`\\b(${SPANISH_WORDS.join("|")})\\b`, "i");

const STRING = /(["'])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/** Comments must go first: an apostrophe in English prose ("don't") would
 *  otherwise open a string literal and swallow the rest of the file. */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const offenders: string[] = [];
for (const f of sources("src")) {
	const src = stripComments(readFileSync(f, "utf8"));
	// Strings only: a stray accent in a code comment is not what ships.
	for (const m of src.matchAll(STRING)) {
		const s = m[2];
		if (s.length < 3) continue;
		// Skip anything that cannot be user-facing text.
		if (/^[\w./@-]+$/.test(s)) continue; // paths, ids, mime types
		if (/^#[0-9a-f]{3,8}$/i.test(s)) continue; // colours
		if (ACCENTED.test(s) || WORDS.test(s)) offenders.push(`${f}: ${JSON.stringify(s)}`);
	}
}

assert.deepEqual(
	offenders,
	[],
	`Spanish found in shipped strings:\n  ${offenders.join("\n  ")}`,
);

console.log(`i18n.test.ts OK · English-only, ${sources("src").length} sources scanned`);
