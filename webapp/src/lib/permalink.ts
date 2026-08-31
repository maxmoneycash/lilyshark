/**
 * Permalinks to a capture and a frame (UI-007), as pure hash arithmetic.
 *
 * The whole app routes on the URL hash: a base token (`#traffic`,
 * `#resolve`, …) that TerminalApp maps to a tab, plus an optional query bag
 * after `?` that belongs to the tab itself. This module owns the bag:
 *
 *   #traffic?filter=…&commit=0x…&owner=0x…&frame=9
 *   #traffic?blob=captures%2Ffield.lscap&frame=9
 *
 * - `filter` — display-filter text (UI-003);
 * - `commit` (+ optional `owner`) — a capture reference by 32-byte blob
 *   commitment, opened through the full resolve trace (indexer → RPC →
 *   anchor check), exactly the walk a Shelby pointer frame triggers;
 * - `blob` — a capture reference by blob object name, in the same grammar
 *   the FETCH input accepts: a bare name (read from the default owner's
 *   account) or `0x<owner>/<name>`;
 * - `frame` — the sequence number of the frame to select once open.
 *
 * Every helper preserves the params it does not own, so filter, capture
 * reference and frame compose non-destructively on one URL.
 */

/** A hash split into its routing token and its query bag. */
export interface HashParts {
	/** "#traffic" etc., or "" for a bare URL. Never contains "?". */
	base: string;
	params: URLSearchParams;
}

export function splitHash(hash: string): HashParts {
	const q = hash.indexOf("?");
	if (q < 0) return { base: hash, params: new URLSearchParams() };
	return {
		base: hash.slice(0, q),
		params: new URLSearchParams(hash.slice(q + 1)),
	};
}

/**
 * Reassemble a hash. A query with no base token plants `#traffic` — a bag
 * only exists on the Traffic tab — while an empty bag leaves a bare base
 * (and a bare URL stays bare, never growing a lone "#traffic").
 */
export function joinHash(base: string, params: URLSearchParams): string {
	const qs = params.toString();
	return qs ? `${base || "#traffic"}?${qs}` : base;
}

/**
 * The current hash with `updates` applied to its query bag — null deletes a
 * param, a string sets it, everything else is preserved verbatim.
 */
export function updateHashParams(
	hash: string,
	updates: Record<string, string | null>,
): string {
	const { base, params } = splitHash(hash);
	for (const [key, value] of Object.entries(updates)) {
		if (value === null) params.delete(key);
		else params.set(key, value);
	}
	return joinHash(base, params);
}

/**
 * Where a capture permalink points. A commit ref is the durable one — it
 * survives re-uploads and is what the on-chain anchor vouches for — so
 * builders prefer it whenever the commitment is known.
 */
export type CaptureRef =
	| { kind: "blob"; owner: string; name: string }
	| { kind: "commit"; owner: string; commitment: string };

/** Everything a permalink can say, parsed from a hash. */
export interface PermalinkState {
	ref: CaptureRef | null;
	/** Frame sequence number to select, or null when the link names none. */
	frame: number | null;
	/** Display-filter text, "" when absent. */
	filter: string;
}

const COMMITMENT_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Read a permalink out of a hash. `defaultOwner` fills in for a bare blob
 * name or an owner-less commit, mirroring the FETCH input's rule. A
 * malformed commitment is ignored rather than sent to the indexer, and a
 * commit ref wins when both are present.
 */
export function readPermalink(
	hash: string,
	defaultOwner: string,
): PermalinkState {
	const { params } = splitHash(hash);
	const frameRaw = params.get("frame");
	const frame =
		frameRaw !== null && /^\d+$/.test(frameRaw) ? Number(frameRaw) : null;
	const filter = params.get("filter") ?? "";
	const owner = params.get("owner") ?? defaultOwner;

	let ref: CaptureRef | null = null;
	const commit = params.get("commit");
	const blob = params.get("blob");
	if (commit !== null && COMMITMENT_RE.test(commit)) {
		ref = { kind: "commit", owner, commitment: commit };
	} else if (blob) {
		const slash = blob.indexOf("/");
		ref =
			blob.startsWith("0x") && slash > 0
				? {
						kind: "blob",
						owner: blob.slice(0, slash),
						name: blob.slice(slash + 1),
					}
				: { kind: "blob", owner, name: blob };
	}
	return { ref, frame, filter };
}

/**
 * Build the `#traffic?…` hash for a permalink to `ref`, carrying the
 * current frame and filter when given. The owner is omitted when it equals
 * `defaultOwner` (readPermalink fills it back in), keeping the common link
 * short.
 */
export function permalinkHash(
	ref: CaptureRef,
	opts: {
		frame?: number | null;
		filter?: string;
		defaultOwner?: string;
	} = {},
): string {
	const params = new URLSearchParams();
	if (opts.filter) params.set("filter", opts.filter);
	const ownerIsDefault =
		opts.defaultOwner !== undefined &&
		ref.owner.toLowerCase() === opts.defaultOwner.toLowerCase();
	if (ref.kind === "commit") {
		params.set("commit", ref.commitment);
		if (!ownerIsDefault) params.set("owner", ref.owner);
	} else {
		params.set("blob", ownerIsDefault ? ref.name : `${ref.owner}/${ref.name}`);
	}
	if (opts.frame !== null && opts.frame !== undefined)
		params.set("frame", String(opts.frame));
	return `#traffic?${params.toString()}`;
}
