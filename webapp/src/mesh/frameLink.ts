/**
 * The URL side of the SNIFFER screen: which frame a permalink is asking for,
 * and when the address bar may be rewritten.
 *
 * This is a state machine in its own module rather than a pair of effects
 * inside the screen because both halves have been got wrong once already, and
 * neither failure is reachable from a rendered-component test — the webapp's
 * runner is node:test over plain .ts files, with no DOM.
 *
 * Reading a link. A permalink pasted into an ALREADY-OPEN tab changes the
 * hash without reloading the page, so a screen that reads the hash once at
 * mount ignores it. Opening the screen and the hash changing under it raise
 * the SAME event here, so there is no second path that can go stale.
 *
 * Writing a link. The hash is shared with the router and with every other
 * screen's permalinks, so merely arriving on the SNIFFER tab must not stamp
 * "#sniffer" over a link the operator was about to follow. Only a selection
 * the operator actually made yields a hash to write, and closing the pane
 * takes back nothing but the frame this screen itself put there.
 */
import {
	hashRoute,
	readFrame,
	SNIFFER_ROUTE,
	snifferFrameHash,
	splitHash,
	updateHashParams,
} from "../lib/permalink";

/** What the machine carries between events. */
export interface FrameLinkState {
	/**
	 * Sequence number a link named that no listed frame carries yet. A link is
	 * usually opened before the session has heard anything, so the request is
	 * held until its frame arrives rather than dropped on the spot — on a quiet
	 * band that wait can be minutes.
	 */
	pending: number | null;
	/** Sequence number the detail pane holds, null when nothing is open. */
	shown: number | null;
}

export const INITIAL_FRAME_LINK: FrameLinkState = {
	pending: null,
	shown: null,
};

export type FrameLinkEvent =
	/** The screen opened, or the hash changed while it was open. */
	| { kind: "url"; hash: string }
	/** The frame list changed; these are the frames that have a sequence number. */
	| { kind: "frames"; seqs: readonly number[] }
	/**
	 * The operator picked a frame, or closed the pane with `seq: null`. `seq`
	 * is null too for a frame that arrived without its raw record, since no
	 * link can name a frame that has no sequence number.
	 */
	| { kind: "pick"; hash: string; seq: number | null };

export interface FrameLinkStep {
	state: FrameLinkState;
	/**
	 * Sequence number to open now — the answer to a link that was waiting.
	 * Undefined leaves the selection exactly where the operator left it.
	 */
	select?: number;
	/** Hash to write into the address bar, or null to leave the URL alone. */
	hash: string | null;
}

/**
 * The hash a selection change should leave behind, or null when the address
 * bar must not be touched.
 *
 * Clearing the pane deletes the frame param and nothing else, and only from a
 * hash that is already the sniffer's: anything else in the address bar
 * belongs to another screen, or to a link the operator pasted and has not
 * followed yet, and overwriting it would destroy it.
 */
export function snifferSelectionHash(
	hash: string,
	seq: number | null,
): string | null {
	if (seq !== null) {
		const next = snifferFrameHash(seq);
		return next === hash ? null : next;
	}
	if (hashRoute(hash) !== SNIFFER_ROUTE) return null;
	// splitHash rather than readFrame: a malformed frame param selects nothing
	// but is still this screen's leftover, so closing the pane clears it too.
	if (!splitHash(hash).params.has("frame")) return null;
	return updateHashParams(hash, { frame: null }, SNIFFER_ROUTE);
}

/**
 * The frame a hash asks the sniffer to open, or null when it asks for none.
 *
 * A frame param only means a sniffer frame on a sniffer hash: `#traffic?…`
 * carries a frame number of its own, naming a frame inside a stored capture,
 * and the live session's sequence numbers are a different space entirely.
 */
function requestedFrame(hash: string): number | null {
	return hashRoute(hash) === SNIFFER_ROUTE ? readFrame(hash) : null;
}

/** Fold one event into the link state, reporting what the screen must do. */
export function frameLinkStep(
	state: FrameLinkState,
	event: FrameLinkEvent,
): FrameLinkStep {
	switch (event.kind) {
		case "url": {
			const asked = requestedFrame(event.hash);
			// A link naming the frame that is already open asks for nothing, and
			// leaving it pending would let it re-open that frame later, after the
			// operator had moved on.
			const pending = asked === state.shown ? null : asked;
			// No hash is ever written here. Reading the URL is what happens on
			// arrival, and arrival must leave the address bar exactly as it found
			// it.
			return { state: { ...state, pending }, hash: null };
		}
		case "frames": {
			if (state.pending === null || !event.seqs.includes(state.pending)) {
				return { state, hash: null };
			}
			// The awaited frame is finally listed. The hash already names it, so
			// there is nothing to write back.
			return {
				state: { pending: null, shown: state.pending },
				select: state.pending,
				hash: null,
			};
		}
		case "pick": {
			// A pick settles any waiting link: the operator's own choice wins over
			// a frame the URL asked for, which would otherwise yank the pane away
			// from them whenever it finally arrived.
			return {
				state: { pending: null, shown: event.seq },
				hash: snifferSelectionHash(event.hash, event.seq),
			};
		}
	}
}
