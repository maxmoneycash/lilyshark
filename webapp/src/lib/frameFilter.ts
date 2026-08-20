/**
 * Display-filter language for the TRAFFIC frame table.
 *
 * A small Wireshark-style expression grammar, parsed by recursive descent
 * into a predicate over decoded .lscap frame records:
 *
 *   expr   := or
 *   or     := and ( "||" and )*                ("or" also accepted)
 *   and    := unary ( "&&" unary )*            ("and" also accepted)
 *   unary  := "!" unary | primary              ("not" also accepted)
 *   primary:= "(" expr ")" | "has" ":" atom | field op value
 *
 * Numeric fields (freq, bw, sf, cr, rssi, snr, len, seq) take all six
 * comparison operators and accept k/M/G suffixes on the number, so
 * `freq == 906.875M` and `snr < -3.5` both read the way an RF operator
 * writes them. Enum fields (proto, dir, crc) have no ordering and take
 * only == and !=.
 *
 * Errors never throw to the UI: parseFrameFilter returns a structured
 * error carrying the offending token's [start, end) offsets in the input,
 * so the caller can point at the exact token.
 */

import { findShelbyPointer } from "./lscap";

/** The subset of an LscapFrame a filter can see. Structural, so tests can
 *  build frames without the full 30-field record. */
export interface FilterFrame {
	sequence: bigint | number;
	capturedLength: number;
	centerFrequencyHz: number;
	bandwidthHz: number;
	spreadingFactor: number;
	codingRateDenominator: number;
	rssiDbm: number;
	snrDb: number;
	profileId: number;
	direction: string;
	crc: string;
	synthetic: boolean;
	bytes: Uint8Array;
}

/**
 * A compiled filter. `hasPointer` lets the caller pass a precomputed
 * Shelby-pointer flag (TrafficTab already scans every payload once);
 * without it the predicate scans the frame's bytes itself.
 */
export type FramePredicate = (
	frame: FilterFrame,
	hasPointer?: boolean,
) => boolean;

export interface FilterError {
	message: string;
	/** Offset of the offending token in the source text. */
	start: number;
	/** End offset (exclusive). start === end at end-of-input. */
	end: number;
}

export type FilterResult =
	| { ok: true; empty: boolean; predicate: FramePredicate }
	| { ok: false; error: FilterError };

export type FilterProto = "meshtastic" | "meshcore" | "rnode" | "unknown";

/**
 * Protocol label for a frame, from the firmware's built-in PHY profile ids
 * (src/core/builtin_profiles.cpp): 1 MESHTASTIC US LF · 2/3 MESHCORE ·
 * 4/5 RNODE EXAMPLE. The firmware invents no labels beyond its profiles,
 * and neither do we: anything else is "unknown".
 */
export function protoOfProfile(profileId: number): FilterProto {
	switch (profileId) {
		case 1:
			return "meshtastic";
		case 2:
		case 3:
			return "meshcore";
		case 4:
		case 5:
			return "rnode";
		default:
			return "unknown";
	}
}

/* ── fields ─────────────────────────────────────────────────────────── */

const NUMERIC_FIELDS: Record<string, (f: FilterFrame) => number> = {
	freq: (f) => f.centerFrequencyHz,
	bw: (f) => f.bandwidthHz,
	sf: (f) => f.spreadingFactor,
	cr: (f) => f.codingRateDenominator,
	rssi: (f) => f.rssiDbm,
	snr: (f) => f.snrDb,
	len: (f) => f.capturedLength,
	seq: (f) => Number(f.sequence),
};

interface EnumField {
	get: (f: FilterFrame) => string;
	/** Accepted literal → canonical value. */
	values: Record<string, string>;
}

const ENUM_FIELDS: Record<string, EnumField> = {
	proto: {
		get: (f) => protoOfProfile(f.profileId),
		values: {
			meshtastic: "meshtastic",
			meshcore: "meshcore",
			rnode: "rnode",
			unknown: "unknown",
		},
	},
	dir: {
		get: (f) => f.direction,
		values: { rx: "rx", tx: "tx", unknown: "unknown" },
	},
	crc: {
		// .lscap says valid/invalid/absent/unknown; the filter speaks the
		// operator's ok/fail and accepts the file's own words as aliases.
		get: (f) =>
			f.crc === "valid" ? "ok" : f.crc === "invalid" ? "fail" : f.crc,
		values: {
			ok: "ok",
			valid: "ok",
			fail: "fail",
			invalid: "fail",
			absent: "absent",
			unknown: "unknown",
		},
	},
};

export const FILTER_FIELDS = [
	...Object.keys(NUMERIC_FIELDS),
	...Object.keys(ENUM_FIELDS),
	"has:pointer",
	"has:synthetic",
] as const;

/* ── tokenizer ──────────────────────────────────────────────────────── */

type TokenKind = "ident" | "number" | "op" | "end";

interface Token {
	kind: TokenKind;
	text: string;
	/** Numeric value, suffix applied. Only for kind === "number". */
	value: number;
	start: number;
	end: number;
}

const OPS = ["&&", "||", "==", "!=", "<=", ">=", "<", ">", "!", "(", ")", ":"];
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, g: 1e9 };
const NUMBER_RE = /^-?(\d+(\.\d+)?|\.\d+)([kKmMgG])?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Thrown internally only; parseFrameFilter converts it to a FilterResult. */
class ParseFail {
	constructor(readonly error: FilterError) {}
}

function fail(message: string, start: number, end: number): never {
	throw new ParseFail({ message, start, end });
}

function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === " " || c === "\t" || c === "\n" || c === "\r") {
			i++;
			continue;
		}
		const rest = text.slice(i);
		// A number first: "-" only ever starts a numeric literal here, and
		// checking it before the operators keeps "!=" vs "!" unambiguous.
		if (/[0-9.]/.test(c) || (c === "-" && /[0-9.]/.test(text[i + 1] ?? ""))) {
			const m = NUMBER_RE.exec(rest);
			if (!m || m[0] === "-" || m[0] === ".") {
				fail("expected a number", i, i + 1);
			}
			const suffix = m[3] ? SUFFIX[m[3].toLowerCase()] : 1;
			const digits = m[3] ? m[0].slice(0, -1) : m[0];
			tokens.push({
				kind: "number",
				text: m[0],
				value: Number(digits) * suffix,
				start: i,
				end: i + m[0].length,
			});
			i += m[0].length;
			continue;
		}
		const op = OPS.find((o) => rest.startsWith(o));
		if (op) {
			tokens.push({
				kind: "op",
				text: op,
				value: 0,
				start: i,
				end: i + op.length,
			});
			i += op.length;
			continue;
		}
		const id = IDENT_RE.exec(rest);
		if (id) {
			const word = id[0].toLowerCase();
			// Wireshark accepts the word forms too; normalize them to ops.
			const alias =
				word === "and"
					? "&&"
					: word === "or"
						? "||"
						: word === "not"
							? "!"
							: null;
			tokens.push({
				kind: alias ? "op" : "ident",
				text: alias ?? word,
				value: 0,
				start: i,
				end: i + id[0].length,
			});
			i += id[0].length;
			continue;
		}
		fail(`unexpected character "${c}"`, i, i + 1);
	}
	tokens.push({
		kind: "end",
		text: "",
		value: 0,
		start: text.length,
		end: text.length,
	});
	return tokens;
}

/* ── parser ─────────────────────────────────────────────────────────── */

class Parser {
	private pos = 0;
	constructor(private readonly tokens: Token[]) {}

	private peek(): Token {
		return this.tokens[this.pos];
	}

	private next(): Token {
		return this.tokens[this.pos++];
	}

	private takeOp(op: string): boolean {
		const t = this.peek();
		if (t.kind === "op" && t.text === op) {
			this.pos++;
			return true;
		}
		return false;
	}

	parseExpr(): FramePredicate {
		return this.parseOr();
	}

	private parseOr(): FramePredicate {
		let left = this.parseAnd();
		while (this.takeOp("||")) {
			const l = left;
			const r = this.parseAnd();
			left = (f, hp) => l(f, hp) || r(f, hp);
		}
		return left;
	}

	private parseAnd(): FramePredicate {
		let left = this.parseUnary();
		while (this.takeOp("&&")) {
			const l = left;
			const r = this.parseUnary();
			left = (f, hp) => l(f, hp) && r(f, hp);
		}
		return left;
	}

	private parseUnary(): FramePredicate {
		if (this.takeOp("!")) {
			const inner = this.parseUnary();
			return (f, hp) => !inner(f, hp);
		}
		return this.parsePrimary();
	}

	private parsePrimary(): FramePredicate {
		const t = this.peek();
		if (t.kind === "op" && t.text === "(") {
			this.next();
			const inner = this.parseExpr();
			const close = this.peek();
			if (!this.takeOp(")")) {
				fail('expected ")"', close.start, close.end);
			}
			return inner;
		}
		if (t.kind === "ident" && t.text === "has") {
			this.next();
			const colon = this.peek();
			if (!this.takeOp(":")) {
				fail('expected ":" after "has"', colon.start, colon.end);
			}
			const atom = this.next();
			if (
				atom.kind !== "ident" ||
				(atom.text !== "pointer" && atom.text !== "synthetic")
			) {
				fail(
					`unknown atom "${atom.text}" — has:pointer or has:synthetic`,
					atom.start,
					atom.end,
				);
			}
			if (atom.text === "synthetic") return (f) => f.synthetic;
			return (f, hp) => hp ?? findShelbyPointer(f.bytes) !== null;
		}
		if (t.kind === "ident") {
			return this.parseComparison();
		}
		if (t.kind === "end") {
			fail("expected an expression", t.start, t.end);
		}
		fail(`expected a field, got "${t.text}"`, t.start, t.end);
	}

	private parseComparison(): FramePredicate {
		const field = this.next();
		const numeric = NUMERIC_FIELDS[field.text];
		const enumField = ENUM_FIELDS[field.text];
		if (!numeric && !enumField) {
			fail(
				`unknown field "${field.text}" — one of ${FILTER_FIELDS.join(", ")}`,
				field.start,
				field.end,
			);
		}
		const op = this.peek();
		const ordered =
			op.kind === "op" && ["<", "<=", ">", ">="].includes(op.text);
		const equality = op.kind === "op" && (op.text === "==" || op.text === "!=");
		if (!ordered && !equality) {
			fail(`expected a comparison after "${field.text}"`, op.start, op.end);
		}
		this.next();

		const value = this.next();
		if (numeric) {
			if (value.kind !== "number") {
				fail(
					`"${field.text}" compares against a number (suffixes k/M/G allowed)`,
					value.start,
					value.end,
				);
			}
			const v = value.value;
			switch (op.text) {
				case "==":
					return (f) => numeric(f) === v;
				case "!=":
					return (f) => numeric(f) !== v;
				case "<":
					return (f) => numeric(f) < v;
				case "<=":
					return (f) => numeric(f) <= v;
				case ">":
					return (f) => numeric(f) > v;
				default:
					return (f) => numeric(f) >= v;
			}
		}
		// Redundant with the guard above, but it lets the compiler see that
		// only the enum branch remains.
		if (!enumField) {
			fail(`unknown field "${field.text}"`, field.start, field.end);
		}
		if (ordered) {
			fail(`"${field.text}" has no ordering — use == or !=`, op.start, op.end);
		}
		if (value.kind !== "ident" || !(value.text in enumField.values)) {
			fail(
				`"${field.text}" is one of ${[...new Set(Object.values(enumField.values))].join(", ")}`,
				value.start,
				value.end,
			);
		}
		const want = enumField.values[value.text];
		return op.text === "=="
			? (f) => enumField.get(f) === want
			: (f) => enumField.get(f) !== want;
	}

	finish(): void {
		const t = this.peek();
		if (t.kind !== "end") {
			fail(`unexpected "${t.text}" after the expression`, t.start, t.end);
		}
	}
}

/**
 * Compile a display-filter expression. Never throws: bad input comes back
 * as `{ ok: false, error }` with the offending token's offsets. Blank input
 * is `{ ok: true, empty: true }` with a match-everything predicate.
 */
export function parseFrameFilter(text: string): FilterResult {
	if (text.trim() === "") {
		return { ok: true, empty: true, predicate: () => true };
	}
	try {
		const parser = new Parser(tokenize(text));
		const predicate = parser.parseExpr();
		parser.finish();
		return { ok: true, empty: false, predicate };
	} catch (e) {
		if (e instanceof ParseFail) return { ok: false, error: e.error };
		// Defensive: nothing above should throw anything else, but the UI
		// must never see an exception from typing into the filter box.
		return {
			ok: false,
			error: {
				message: e instanceof Error ? e.message : String(e),
				start: 0,
				end: text.length,
			},
		};
	}
}
