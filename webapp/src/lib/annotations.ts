/**
 * Frame annotations in a sidecar (UI-010).
 *
 * Field evidence needs field notes — "this is when the interferer started" —
 * and the capture bytes must stay byte-identical to the commitment that was
 * published and anchored on chain. So a note NEVER touches the .lscap: it
 * lives in a separate JSON document that names the frame by its SEQUENCE
 * NUMBER, the capture's own stable identifier for a frame (an index into a
 * filtered table is not: it moves the moment a filter changes).
 *
 * ── The sidecar ─────────────────────────────────────────────────────────
 *
 * One JSON object, written next to the capture as `<capture name>.notes.json`
 * (see `sidecarFileName`), UTF-8:
 *
 *   {
 *     "kind": "lilyshark-annotations",   // what this document is
 *     "version": 1,                      // this shape
 *     "capture": {
 *       "name": "field-2026-03-01.lscap",// the capture it belongs to
 *       "frameCount": 1240,              // frames it had when written, or null
 *       "commitment": "0x…" | null       // the published capture's commitment,
 *                                        // when it has one — the sidecar is
 *                                        // ABOUT that commitment and never
 *                                        // part of it
 *     },
 *     "notes": [
 *       {
 *         "sequence": 9,                 // the frame's .lscap sequence number
 *         "text": "interferer starts",   // the note, ≤ MAX_NOTE_LENGTH chars
 *         "updatedAtUnix": 1772409600    // when it was last written, seconds
 *       }
 *     ]
 *   }
 *
 * `notes` holds at most one entry per sequence number and is kept sorted by
 * it, so two sidecars of the same notes are the same bytes.
 *
 * Nothing here claims a note is evidence of anything: a sidecar is written by
 * whoever held the file, carries no signature, and is not covered by the
 * capture's commitment. What it protects is the other direction — the capture
 * stays exactly the bytes that were committed, and the notes ride alongside.
 *
 * Pure data arithmetic, run under node:test (annotations.test.ts).
 */

export const ANNOTATION_SIDECAR_KIND = "lilyshark-annotations";
export const ANNOTATION_SIDECAR_VERSION = 1;

/** A note is a field note, not a document; longer text is refused, not cut. */
export const MAX_NOTE_LENGTH = 500;

export interface FrameNote {
	/** The frame's .lscap sequence number. */
	sequence: number;
	text: string;
	/** Unix seconds when the note was last written. */
	updatedAtUnix: number;
}

export interface AnnotatedCapture {
	name: string;
	/** Frames the capture held when the sidecar was written; null if unknown. */
	frameCount: number | null;
	/** The published capture's commitment, when it has one. */
	commitment: string | null;
}

export interface AnnotationSidecar {
	kind: typeof ANNOTATION_SIDECAR_KIND;
	version: typeof ANNOTATION_SIDECAR_VERSION;
	capture: AnnotatedCapture;
	notes: FrameNote[];
}

export function emptySidecar(
	capture: Partial<AnnotatedCapture> = {},
): AnnotationSidecar {
	return {
		kind: ANNOTATION_SIDECAR_KIND,
		version: ANNOTATION_SIDECAR_VERSION,
		capture: {
			name: capture.name ?? "",
			frameCount: capture.frameCount ?? null,
			commitment: capture.commitment ?? null,
		},
		notes: [],
	};
}

/** The sidecar with its capture facts refreshed; the notes are untouched. */
export function describeCapture(
	sidecar: AnnotationSidecar,
	capture: Partial<AnnotatedCapture>,
): AnnotationSidecar {
	return {
		...sidecar,
		capture: { ...sidecar.capture, ...capture },
	};
}

export function noteFor(
	sidecar: AnnotationSidecar,
	sequence: number,
): FrameNote | null {
	return sidecar.notes.find((n) => n.sequence === sequence) ?? null;
}

/** Sequence numbers carrying a note — what the table marks. */
export function annotatedSequences(sidecar: AnnotationSidecar): Set<number> {
	return new Set(sidecar.notes.map((n) => n.sequence));
}

/** Sequence number → note text, the shape the exporters read. */
export function noteMap(sidecar: AnnotationSidecar): Map<number, string> {
	return new Map(sidecar.notes.map((n) => [n.sequence, n.text]));
}

export type SetNoteResult =
	| { ok: true; sidecar: AnnotationSidecar }
	| { ok: false; error: string };

/**
 * Write (or rewrite) the note on one frame. Blank text REMOVES the note —
 * clearing the box is how a note is deleted, and an empty note would be a
 * mark on the table meaning nothing. Returns the new sidecar; the old one is
 * never mutated.
 */
export function setNote(
	sidecar: AnnotationSidecar,
	sequence: number,
	text: string,
	nowUnix: number = Math.floor(Date.now() / 1000),
): SetNoteResult {
	if (!Number.isInteger(sequence) || sequence < 0)
		return {
			ok: false,
			error: "a note names a frame by its whole sequence number",
		};
	const trimmed = text.trim();
	if (trimmed.length > MAX_NOTE_LENGTH)
		return {
			ok: false,
			error: `a note is at most ${MAX_NOTE_LENGTH} characters — this one is ${trimmed.length}`,
		};
	const notes = sidecar.notes.filter((n) => n.sequence !== sequence);
	if (trimmed !== "")
		notes.push({ sequence, text: trimmed, updatedAtUnix: nowUnix });
	notes.sort((a, b) => a.sequence - b.sequence);
	return { ok: true, sidecar: { ...sidecar, notes } };
}

/** The sidecar as the bytes that get downloaded — stable, sorted, newline. */
export function serializeSidecar(sidecar: AnnotationSidecar): string {
	const ordered: AnnotationSidecar = {
		kind: ANNOTATION_SIDECAR_KIND,
		version: ANNOTATION_SIDECAR_VERSION,
		capture: sidecar.capture,
		notes: [...sidecar.notes].sort((a, b) => a.sequence - b.sequence),
	};
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * `<capture>.notes.json` — the capture's own file name with the sidecar
 * suffix appended, NOT its extension replaced: the pairing has to survive
 * two captures whose names differ only by extension, and a file called
 * `field.notes.json` beside `field.lscap` says less than
 * `field.lscap.notes.json` does.
 */
export function sidecarFileName(captureName: string): string {
	return `${captureName || "capture.lscap"}.notes.json`;
}

export type SidecarParse =
	| { ok: true; sidecar: AnnotationSidecar; skipped: string[] }
	| { ok: false; error: string };

/**
 * Read a sidecar back. Never throws — a bad file is an error message the UI
 * can show, not an exception. Entries that are not readable notes are SKIPPED
 * and named in `skipped` rather than silently dropped, so an upload that
 * loses something says which something.
 */
export function parseSidecar(text: string): SidecarParse {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return {
			ok: false,
			error: `not JSON: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return {
			ok: false,
			error: "not an annotation sidecar (expected an object)",
		};
	const doc = raw as Record<string, unknown>;
	if (doc.kind !== ANNOTATION_SIDECAR_KIND)
		return {
			ok: false,
			error: `not an annotation sidecar — "kind" is ${JSON.stringify(doc.kind ?? null)}, expected "${ANNOTATION_SIDECAR_KIND}"`,
		};
	if (doc.version !== ANNOTATION_SIDECAR_VERSION)
		return {
			ok: false,
			error: `sidecar version ${JSON.stringify(doc.version ?? null)} — this build reads version ${ANNOTATION_SIDECAR_VERSION}`,
		};
	if (!Array.isArray(doc.notes))
		return { ok: false, error: '"notes" is missing or not an array' };

	const capture =
		typeof doc.capture === "object" && doc.capture !== null
			? (doc.capture as Record<string, unknown>)
			: {};
	const sidecar = emptySidecar({
		name: typeof capture.name === "string" ? capture.name : "",
		frameCount:
			typeof capture.frameCount === "number" &&
			Number.isInteger(capture.frameCount)
				? capture.frameCount
				: null,
		commitment:
			typeof capture.commitment === "string" ? capture.commitment : null,
	});

	const skipped: string[] = [];
	const seen = new Set<number>();
	const notes: FrameNote[] = [];
	doc.notes.forEach((entry: unknown, index: number) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			skipped.push(`note ${index}: not an object`);
			return;
		}
		const n = entry as Record<string, unknown>;
		if (typeof n.sequence !== "number" || !Number.isInteger(n.sequence)) {
			skipped.push(`note ${index}: "sequence" is not a whole number`);
			return;
		}
		if (typeof n.text !== "string" || n.text.trim() === "") {
			skipped.push(
				`note ${index} (frame ${n.sequence}): empty or missing text`,
			);
			return;
		}
		if (n.text.length > MAX_NOTE_LENGTH) {
			skipped.push(
				`note ${index} (frame ${n.sequence}): longer than ${MAX_NOTE_LENGTH} characters`,
			);
			return;
		}
		if (seen.has(n.sequence)) {
			skipped.push(`note ${index}: frame ${n.sequence} already has a note`);
			return;
		}
		seen.add(n.sequence);
		notes.push({
			sequence: n.sequence,
			text: n.text.trim(),
			updatedAtUnix:
				typeof n.updatedAtUnix === "number" && Number.isFinite(n.updatedAtUnix)
					? Math.floor(n.updatedAtUnix)
					: 0,
		});
	});
	notes.sort((a, b) => a.sequence - b.sequence);
	return { ok: true, sidecar: { ...sidecar, notes }, skipped };
}

/**
 * What an uploaded sidecar does and does not line up with. A sidecar written
 * for another capture still loads — the operator may know exactly what they
 * are doing — but the disagreements are stated, never swallowed.
 */
export function sidecarMismatches(
	sidecar: AnnotationSidecar,
	capture: { name: string; sequences: ReadonlySet<number> },
): string[] {
	const out: string[] = [];
	if (
		sidecar.capture.name !== "" &&
		capture.name !== "" &&
		sidecar.capture.name !== capture.name
	)
		out.push(
			`the sidecar was written for "${sidecar.capture.name}", this capture is "${capture.name}"`,
		);
	const missing = sidecar.notes.filter(
		(n) => !capture.sequences.has(n.sequence),
	);
	if (missing.length > 0)
		out.push(
			`${missing.length} note(s) name frame sequence number(s) this capture does not hold (${missing
				.slice(0, 5)
				.map((n) => n.sequence)
				.join(", ")}${missing.length > 5 ? ", …" : ""})`,
		);
	return out;
}

/** The line the annotations panel shows about itself. */
export function sidecarSummary(sidecar: AnnotationSidecar): string {
	if (sidecar.notes.length === 0)
		return "no notes yet — a note attaches to a frame's sequence number and is stored beside the capture, never inside it";
	return `${sidecar.notes.length} note(s) on frame(s) ${sidecar.notes
		.slice(0, 8)
		.map((n) => n.sequence)
		.join(
			", ",
		)}${sidecar.notes.length > 8 ? ", …" : ""} · kept beside the capture, never in its bytes`;
}
