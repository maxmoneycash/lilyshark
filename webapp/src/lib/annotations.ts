/**
 * Frame annotations: an operator's note about one frame, kept beside the
 * capture and never inside it.
 *
 * Field evidence needs field notes — "this is when the interferer started" —
 * and the capture bytes must stay byte-identical to what the radio wrote and
 * to whatever commitment was published over them. So a note NEVER touches the
 * frame: it lives in its own record that NAMES the frame.
 *
 * ── How a note names a frame ─────────────────────────────────────────────
 *
 * By exactly the identity a permalink uses, and by no other. permalink.ts
 * already addresses a frame as a capture scope plus a sequence number:
 *
 *   #sniffer?frame=417                     the live listening session
 *   #traffic?commit=0x…&owner=0x…&frame=9  a capture named by its commitment
 *   #traffic?blob=captures%2Ffield.lscap&frame=9
 *
 * A FrameAddress is that pair, and `addressHash` hands it straight back to
 * permalink.ts to render. There is no second addressing scheme to keep in
 * step: a note and a link to the frame it annotates are built from the same
 * two facts, so a note can never name a frame no link could name.
 *
 * A sequence number rather than a row index, because an index into a filtered
 * table moves the moment the filter changes, while the sequence number is the
 * frame's own name in the capture.
 *
 * ── Why a note carries a witness ─────────────────────────────────────────
 *
 * Sequence numbers are only unique WITHIN one run of one radio. Unplug the
 * deck, plug it back in, and the live session starts counting from the
 * beginning again — so a note written on yesterday's frame 12 would otherwise
 * reappear silently attached to today's frame 12, and be exported as though it
 * described it. That is misattribution, and this file refuses to commit it:
 * every note stores a witness of the frame it was written on (the captured
 * length, and the clock reading that told those two frames apart), and
 * `noteStanding` reports whether the frame now carrying that sequence number
 * is the same frame. A note whose witness disagrees is still shown to the
 * operator — their words are not deleted — but it is shown as belonging to
 * ANOTHER frame, and `notesForFrames` keeps it out of exports entirely.
 *
 * Nothing here claims a note is evidence of anything. A note is written by
 * whoever held the browser, carries no signature, and is covered by no
 * commitment. What it protects is the other direction: the capture stays the
 * bytes the radio heard, and the notes ride alongside.
 *
 * Pure data arithmetic, run under node:test (annotations.test.ts). Persistence
 * lives in mesh/db.ts and the editing UI in the SNIFFER screen.
 */
import type { HeardFrame } from "./deviceLink";
import {
	type CaptureRef,
	hashRoute,
	permalinkHash,
	readFrame,
	readPermalink,
	SNIFFER_ROUTE,
	snifferFrameHash,
} from "./permalink";

/** A note is a field note, not a document; longer text is refused, not cut. */
export const MAX_NOTE_LENGTH = 500;

/**
 * Which capture a note's frame belongs to. The live session is its own scope
 * because its sequence numbers are the device's, not any stored capture's —
 * the same split frameLink.ts makes when it decides whether `frame=` on a hash
 * means a sniffer frame at all.
 */
export type NoteScope = { kind: "sniffer" } | CaptureRef;

/** The live listening session, the only scope the SNIFFER screen writes. */
export const SNIFFER_SCOPE: NoteScope = { kind: "sniffer" };

/** One frame, addressed the way a permalink addresses it. */
export interface FrameAddress {
	scope: NoteScope;
	/** The frame's sequence number, the `frame=` of a permalink. */
	frame: number;
}

/**
 * Enough of a frame to tell it from another frame that carried the same
 * sequence number in an earlier run.
 *
 * `stamp` is a clock reading that does not restart with the radio: for the
 * live session it is the host's wall clock when the frame was heard, which is
 * why a reboot cannot forge a match. For a stored capture it would be the
 * capture's own timestamp for that frame, which is fixed in the file.
 */
export interface FrameWitness {
	/** Captured payload length in bytes. */
	len: number;
	stamp: number;
}

export interface FrameNote {
	address: FrameAddress;
	text: string;
	/** Unix seconds when the note was last written. */
	updatedAtUnix: number;
	witness: FrameWitness;
}

/** Every note the browser holds, keyed by `addressKey`. */
export type NoteBook = ReadonlyMap<string, FrameNote>;

export const EMPTY_NOTES: NoteBook = new Map();

/* ── addressing ──────────────────────────────────────────────────────── */

/**
 * A scope as one canonical string. Owners and names are percent-encoded so no
 * component can contain the "/" the key is split on, and owners are lowercased
 * because `0xAB…` and `0xab…` are the same account and must not accumulate two
 * sets of notes.
 */
export function scopeKey(scope: NoteScope): string {
	if (scope.kind === "sniffer") return "sniffer";
	const owner = encodeURIComponent(scope.owner.toLowerCase());
	return scope.kind === "commit"
		? `commit/${owner}/${encodeURIComponent(scope.commitment.toLowerCase())}`
		: `blob/${owner}/${encodeURIComponent(scope.name)}`;
}

/** The key one note is stored and looked up under. */
export function addressKey(address: FrameAddress): string {
	return `${scopeKey(address.scope)}/${address.frame}`;
}

/**
 * Read a key back into the address it was built from. Persisted rows are
 * parsed with this rather than trusted, so a row written by a future build
 * (or corrupted in the store) is skipped instead of attaching a note to a
 * frame nobody meant.
 */
export function parseAddressKey(key: string): FrameAddress | null {
	const parts = key.split("/");
	const rawFrame = parts.pop();
	if (rawFrame === undefined || !/^\d+$/.test(rawFrame)) return null;
	const frame = Number(rawFrame);
	if (parts.length === 1 && parts[0] === "sniffer")
		return { scope: SNIFFER_SCOPE, frame };
	if (parts.length !== 3) return null;
	const [kind, owner, tail] = parts;
	if (owner === "" || tail === "") return null;
	if (kind === "commit")
		return {
			scope: {
				kind: "commit",
				owner: decodeURIComponent(owner),
				commitment: decodeURIComponent(tail),
			},
			frame,
		};
	if (kind === "blob")
		return {
			scope: {
				kind: "blob",
				owner: decodeURIComponent(owner),
				name: decodeURIComponent(tail),
			},
			frame,
		};
	return null;
}

/**
 * The hash that opens the annotated frame — the permalink, built by
 * permalink.ts from the same address the note is filed under. This is the one
 * place the two schemes meet, and they meet by delegation rather than by a
 * second copy of the rules.
 */
export function addressHash(
	address: FrameAddress,
	defaultOwner?: string,
): string {
	return address.scope.kind === "sniffer"
		? snifferFrameHash(address.frame)
		: permalinkHash(address.scope, { frame: address.frame, defaultOwner });
}

/**
 * The frame a hash names, as an address a note can be filed under, or null
 * when the hash names no frame. A `frame=` on a sniffer hash is a live-session
 * frame whatever else the hash carries, matching how frameLink.ts reads it.
 */
export function addressFromHash(
	hash: string,
	defaultOwner: string,
): FrameAddress | null {
	const frame = readFrame(hash);
	if (frame === null) return null;
	if (hashRoute(hash) === SNIFFER_ROUTE) return { scope: SNIFFER_SCOPE, frame };
	const { ref } = readPermalink(hash, defaultOwner);
	return ref === null ? null : { scope: ref, frame };
}

/**
 * The address and witness of a live sniffer frame, or null for one that
 * arrived without its raw record — such a frame has no sequence number, so no
 * link can name it and no note can be filed against it.
 */
export function snifferNoteTarget(
	frame: HeardFrame,
): { address: FrameAddress; witness: FrameWitness } | null {
	if (!frame.raw) return null;
	return {
		address: { scope: SNIFFER_SCOPE, frame: frame.raw.seq },
		witness: { len: frame.raw.bytes.length, stamp: frame.atMs },
	};
}

/* ── reading the book ────────────────────────────────────────────────── */

export function noteFor(
	book: NoteBook,
	address: FrameAddress,
): FrameNote | null {
	return book.get(addressKey(address)) ?? null;
}

/** Every note in one scope, ordered by sequence number. */
export function notesInScope(book: NoteBook, scope: NoteScope): FrameNote[] {
	const key = scopeKey(scope);
	return [...book.values()]
		.filter((n) => scopeKey(n.address.scope) === key)
		.sort((a, b) => a.address.frame - b.address.frame);
}

/** Sequence numbers carrying a note in one scope — what the table marks. */
export function annotatedFrames(book: NoteBook, scope: NoteScope): Set<number> {
	return new Set(notesInScope(book, scope).map((n) => n.address.frame));
}

export function witnessMatches(a: FrameWitness, b: FrameWitness): boolean {
	return a.len === b.len && a.stamp === b.stamp;
}

/**
 * What a stored note has to do with the frame now carrying its sequence
 * number:
 *
 *   "same"   — the frame it was written on, so it is that frame's note;
 *   "other"  — a different frame carries this sequence number now (the radio
 *              restarted its count), so the note is NOT about what is on
 *              screen and must not be exported as if it were;
 *   "absent" — no frame with this sequence number is listed, so there is
 *              nothing to compare it against.
 */
export function noteStanding(
	note: FrameNote,
	witness: FrameWitness | null,
): "same" | "other" | "absent" {
	if (witness === null) return "absent";
	return witnessMatches(note.witness, witness) ? "same" : "other";
}

/** One frame of a capture, as the export path knows it. */
export interface AnnotatableFrame {
	/** Sequence number. */
	frame: number;
	witness: FrameWitness;
}

/**
 * Sequence number → note text for the frames being exported: the shape the
 * CSV and JSON writers read.
 *
 * Only notes whose witness matches the frame actually being written are
 * included. A note left over from an earlier run of the radio names the same
 * sequence number but a different frame, and writing it into the export would
 * put an operator's words against bytes they never saw.
 */
export function notesForFrames(
	book: NoteBook,
	scope: NoteScope,
	frames: readonly AnnotatableFrame[],
): Map<number, string> {
	const out = new Map<number, string>();
	for (const f of frames) {
		const note = noteFor(book, { scope, frame: f.frame });
		if (note !== null && noteStanding(note, f.witness) === "same")
			out.set(f.frame, note.text);
	}
	return out;
}

/* ── writing ─────────────────────────────────────────────────────────── */

export type SetNoteResult =
	| {
			ok: true;
			book: NoteBook;
			/** The key that changed, for the store to put or delete. */
			key: string;
			/** True when blank text removed the note rather than writing one. */
			removed: boolean;
	  }
	| { ok: false; error: string };

/**
 * Write (or rewrite) the note on one frame. Blank text REMOVES the note —
 * clearing the box is how a note is deleted, and an empty note would be a mark
 * on the table meaning nothing. Returns a new book; the old one is never
 * mutated, and the key it reports is what the caller persists.
 */
export function setNote(
	book: NoteBook,
	address: FrameAddress,
	text: string,
	witness: FrameWitness,
	nowUnix: number = Math.floor(Date.now() / 1000),
): SetNoteResult {
	if (!Number.isInteger(address.frame) || address.frame < 0)
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
	const key = addressKey(address);
	const next = new Map(book);
	if (trimmed === "") {
		next.delete(key);
		return { ok: true, book: next, key, removed: true };
	}
	next.set(key, {
		address,
		text: trimmed,
		updatedAtUnix: nowUnix,
		witness: { len: witness.len, stamp: witness.stamp },
	});
	return { ok: true, book: next, key, removed: false };
}

/* ── persistence shape ───────────────────────────────────────────────── */

/**
 * A note as one flat row, which is all an IndexedDB object store wants: the
 * key is the whole address, and `scope` is a plain column so every note of one
 * capture can be found without parsing every key.
 */
export interface NoteRow {
	key: string;
	scope: string;
	frame: number;
	text: string;
	updatedAtUnix: number;
	witnessLen: number;
	witnessStamp: number;
}

export function toNoteRow(note: FrameNote): NoteRow {
	return {
		key: addressKey(note.address),
		scope: scopeKey(note.address.scope),
		frame: note.address.frame,
		text: note.text,
		updatedAtUnix: note.updatedAtUnix,
		witnessLen: note.witness.len,
		witnessStamp: note.witness.stamp,
	};
}

export interface NoteRowsRead {
	book: NoteBook;
	/**
	 * Rows that were not readable notes, each named. A row is skipped, never
	 * silently dropped, so a reload that loses a note says which one.
	 */
	skipped: string[];
}

/**
 * Read stored rows back. Never throws — a row written by another build, or
 * damaged in the store, is an error message the UI can show rather than an
 * exception that empties the whole book.
 */
export function readNoteRows(rows: readonly unknown[]): NoteRowsRead {
	const book = new Map<string, FrameNote>();
	const skipped: string[] = [];
	rows.forEach((entry, index) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			skipped.push(`row ${index}: not an object`);
			return;
		}
		const r = entry as Record<string, unknown>;
		if (typeof r.key !== "string") {
			skipped.push(`row ${index}: no key`);
			return;
		}
		const address = parseAddressKey(r.key);
		if (address === null) {
			skipped.push(`row ${index}: "${r.key}" is not a frame address`);
			return;
		}
		// The key is the truth about which frame this is; the flat columns are
		// there for indexes. A row whose columns disagree with its own key was
		// written by something that did not understand the format, and guessing
		// which half is right is exactly the misattribution this file refuses.
		if (r.frame !== address.frame || r.scope !== scopeKey(address.scope)) {
			skipped.push(`row ${index} ("${r.key}"): its columns contradict its key`);
			return;
		}
		if (typeof r.text !== "string" || r.text.trim() === "") {
			skipped.push(
				`row ${index} (frame ${address.frame}): empty or missing text`,
			);
			return;
		}
		if (r.text.length > MAX_NOTE_LENGTH) {
			skipped.push(
				`row ${index} (frame ${address.frame}): longer than ${MAX_NOTE_LENGTH} characters`,
			);
			return;
		}
		if (
			typeof r.witnessLen !== "number" ||
			!Number.isFinite(r.witnessLen) ||
			typeof r.witnessStamp !== "number" ||
			!Number.isFinite(r.witnessStamp)
		) {
			// Without a witness there is no way to tell this frame from another
			// run's frame of the same number, and a note that cannot say which
			// frame it is about is worse than no note.
			skipped.push(
				`row ${index} (frame ${address.frame}): no record of the frame it was written on`,
			);
			return;
		}
		book.set(r.key, {
			address,
			text: r.text.trim(),
			updatedAtUnix:
				typeof r.updatedAtUnix === "number" && Number.isFinite(r.updatedAtUnix)
					? Math.floor(r.updatedAtUnix)
					: 0,
			witness: { len: r.witnessLen, stamp: r.witnessStamp },
		});
	});
	return { book, skipped };
}

/* ── what the panel says about itself ────────────────────────────────── */

/** The line the annotations panel shows about the notes in one scope. */
export function notesSummary(book: NoteBook, scope: NoteScope): string {
	const notes = notesInScope(book, scope);
	if (notes.length === 0)
		return "No notes yet — a note attaches to a frame's sequence number, is kept in this browser, and is never written into the capture's bytes.";
	const frames = notes
		.slice(0, 8)
		.map((n) => n.address.frame)
		.join(", ");
	return `${notes.length} note${notes.length === 1 ? "" : "s"} on frame ${frames}${
		notes.length > 8 ? ", …" : ""
	} — kept in this browser, never in the capture's bytes.`;
}
