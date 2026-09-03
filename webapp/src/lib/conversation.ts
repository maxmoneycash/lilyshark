/**
 * Follow conversation — the analyzer's follow-stream gesture.
 *
 * From a decoded frame, one action filters the table to the same src/dst
 * pair. It is implemented as an ORDINARY display-filter expression (the
 * `src` and `dst` fields frameFilter.ts adds): the text lands in the filter
 * box, so it stays editable, composes with everything else the operator has
 * typed, and can be cleared the same way any other filter is. The rows it
 * leaves are in capture order, which is the capture clock — the table never
 * reorders.
 *
 * ── What each protocol actually proves ───────────────────────────────────
 *
 * Addressing is read from the frame's own header and NOTHING is invented
 * beyond what that header proves:
 *
 *   Meshtastic  the 16-byte outer header names both endpoints — `to` and
 *               `from`, 32-bit little-endian node numbers. Both sides of a
 *               conversation are therefore addressable, and 0xffffffff is
 *               the broadcast destination.
 *   Reticulum   the clear RNS header names a 16-byte DESTINATION hash and no
 *               source at all — RNS carries no sender address in the header.
 *               The conversation is everything addressed to that
 *               destination, and the UI must not pretend otherwise.
 *   MeshCore    nothing. The v1 wire format puts a dest_hash/src_hash byte
 *               pair at the head of the DIRECT encrypted payload types, but
 *               the firmware proves only the payload arithmetic there, so no
 *               address is claimed here either. MeshCore frames are excluded,
 *               and `frameAddressing` says so out loud.
 *   anything    a frame whose capture profile named no protocol decodes no
 *               addressing — nothing here guesses a protocol the radio did
 *               not name.
 *
 * A frame whose addressing cannot be decoded can never match a conversation
 * filter. That exclusion is REPORTED, never silent: `conversationCoverage`
 * counts those frames and groups them by reason, and `coverageNote` turns
 * the count into the line the UI shows beside the filter.
 *
 * The header readers below are the whole of this module's protocol knowledge.
 * They were lifted from the branch's full dissector suite, which this tree
 * does not carry; each is the same byte arithmetic the firmware's decoder
 * performs, and conversation.test.ts pins both against an independently
 * written reference reader over fixtures, every prefix of them, and random
 * bytes, so a silent drift in either direction fails the test rather than
 * mislabelling a frame.
 *
 * Pure arithmetic over plain data, so it runs under node:test
 * (conversation.test.ts).
 */

/** Meshtastic's broadcast destination — NODENUM_BROADCAST. */
export const MESHTASTIC_BROADCAST_HEX = "ffffffff";

/** The Meshtastic outer header, ahead of the encrypted or decoded payload. */
export const MESHTASTIC_OUTER_HEADER_LENGTH = 16;

/** RNode's own framing byte, ahead of the Reticulum header. */
export const RNODE_SHIM_LENGTH = 1;
export const RETICULUM_HEADER_ONE_LENGTH = 19;
export const RETICULUM_HEADER_TWO_LENGTH = 35;
export const RETICULUM_MAXIMUM_HOPS_EXCLUSIVE = 128;
/** A Reticulum destination hash is the truncated 16 bytes RNS addresses by. */
export const RETICULUM_HASH_BYTES = 16;

/** Which decoder a capture profile id licenses. */
export type ProtocolHint =
	| "meshtastic"
	| "meshcore"
	| "reticulum"
	| "custom"
	| "unknown";

/**
 * Protocol hint for a frame's capture profile id — the firmware's builtin
 * table (src/core/builtin_profiles.cpp: ids 1–5 are the shipped profiles,
 * anything else is user-defined). Pass null for a frame that never reported
 * its profile; nothing then guesses, matching the firmware's own fallback.
 */
export function profileProtocolHint(profileId: number | null): ProtocolHint {
	if (profileId === null) return "unknown";
	switch (profileId) {
		case 0:
			return "unknown";
		case 1:
			return "meshtastic";
		case 2:
		case 3:
			return "meshcore";
		case 4:
			return "meshtastic";
		case 5:
			return "reticulum";
		default:
			return "custom";
	}
}

function readLe32(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) +
		bytes[offset + 3] * 0x1000000
	);
}

function hexBytes(bytes: Uint8Array, offset: number, length: number): string {
	let out = "";
	for (let i = 0; i < length; i++) {
		out += bytes[offset + i].toString(16).padStart(2, "0");
	}
	return out;
}

/**
 * The two node numbers a Meshtastic outer header names — destination at
 * bytes 0–3, source at 4–7, both little-endian — as lowercase 8-character
 * hex, or null when the frame is shorter than the header.
 */
export function meshtasticAddressHex(
	bytes: Uint8Array,
): { src: string; dst: string } | null {
	if (bytes.length < MESHTASTIC_OUTER_HEADER_LENGTH) return null;
	const destination = readLe32(bytes, 0);
	const source = readLe32(bytes, 4);
	// Official firmware rejects a zero sender as an altered packet; a frame
	// the decoder calls malformed names no conversation here either.
	if (source === 0) return null;
	const nodeHex = (value: number) => value.toString(16).padStart(8, "0");
	return { src: nodeHex(source), dst: nodeHex(destination) };
}

/**
 * The full 16-byte destination hash of a clear RNode/Reticulum header, as
 * lowercase hex — or null when the frame carries no readable one: shorter
 * than the shim plus flags, a split continuation, IFAC-masked, an
 * out-of-range hop count, or a header cut short.
 */
export function reticulumDestinationHashHex(bytes: Uint8Array): string | null {
	const n = bytes.length;
	if (n < RNODE_SHIM_LENGTH + 1) return null;
	if ((bytes[0] & 0x01) !== 0) return null; // split continuation
	const flags = bytes[1];
	if ((flags & 0x80) !== 0) return null; // IFAC masks the whole header
	const headerTwo = (flags & 0x40) !== 0;
	const physicalHeaderLength =
		RNODE_SHIM_LENGTH +
		(headerTwo ? RETICULUM_HEADER_TWO_LENGTH : RETICULUM_HEADER_ONE_LENGTH);
	if (n < physicalHeaderLength) return null;
	if (bytes[2] >= RETICULUM_MAXIMUM_HOPS_EXCLUSIVE) return null;
	const destinationOffset = headerTwo ? 3 + RETICULUM_HASH_BYTES : 3;
	return hexBytes(bytes, destinationOffset, RETICULUM_HASH_BYTES);
}

/**
 * One frame's addressing, as its own protocol proves it. Both fields are
 * lowercase hex of the address bytes: 8 characters for a Meshtastic node
 * number, 32 for a Reticulum destination hash. `null` means the protocol
 * proves no such address for this frame — never a zero, never a guess.
 */
export interface FrameAddressing {
	src: string | null;
	dst: string | null;
	/**
	 * Why this frame does not name a full src/dst pair, in the words the UI
	 * shows. Null exactly when both `src` and `dst` are present.
	 */
	reason: string | null;
}

const NO_ADDRESSING: Omit<FrameAddressing, "reason"> = { src: null, dst: null };

const REASON = {
	meshcore:
		"MeshCore v1 — the decoder claims no source or destination field in a captured frame (it proves the payload arithmetic only)",
	meshcoreShort: "MeshCore names no address the decoder proves",
	unknownProfile:
		"the capture profile names no protocol, so no addressing is decoded — nothing here guesses one the radio did not name",
	unknownProfileShort: "no protocol named by the capture profile",
	meshtasticMalformed:
		"the Meshtastic outer header is not readable — the frame is shorter than its 16 bytes, or names node 0 as sender (which the firmware rejects as altered)",
	meshtasticMalformedShort: "unreadable Meshtastic outer header",
	reticulumNoSource:
		"Reticulum names a destination hash but carries no sender address in its header — the conversation is everything addressed to this destination",
	reticulumNoHeader:
		"this Reticulum frame carries no readable destination hash — a split continuation, an IFAC-masked header, an out-of-range hop count, or a header cut short",
	reticulumNoHeaderShort: "no readable Reticulum destination hash",
} as const;

/**
 * Read one frame's addressing from the bytes its capture profile names a
 * protocol for. `profileId` is the profile the frame actually reported, or
 * null when it reported none.
 */
export function frameAddressing(
	bytes: Uint8Array,
	profileId: number | null,
): FrameAddressing {
	switch (profileProtocolHint(profileId)) {
		case "meshtastic": {
			const address = meshtasticAddressHex(bytes);
			if (!address)
				return { ...NO_ADDRESSING, reason: REASON.meshtasticMalformed };
			return { src: address.src, dst: address.dst, reason: null };
		}
		case "reticulum": {
			const dst = reticulumDestinationHashHex(bytes);
			return dst === null
				? { ...NO_ADDRESSING, reason: REASON.reticulumNoHeader }
				: { src: null, dst, reason: REASON.reticulumNoSource };
		}
		case "meshcore":
			return { ...NO_ADDRESSING, reason: REASON.meshcore };
		default:
			return { ...NO_ADDRESSING, reason: REASON.unknownProfile };
	}
}

/** True when this frame names at least one endpoint to follow. */
export function isAddressable(address: FrameAddressing): boolean {
	return address.src !== null || address.dst !== null;
}

/**
 * The display-filter expression that follows this frame's conversation, or
 * null when the frame proves no address at all.
 *
 * With both endpoints the filter is symmetric — the pair, in either
 * direction, which is what "conversation" means. A Meshtastic broadcast is
 * not a pair in both directions (no node sources from the broadcast
 * address), so it stays one-way: everything this sender broadcast. With only
 * a destination (Reticulum) it is everything addressed there.
 */
export function conversationExpression(
	address: FrameAddressing,
): string | null {
	const { src, dst } = address;
	if (src !== null && dst !== null) {
		if (dst === MESHTASTIC_BROADCAST_HEX)
			return `src == ${src} && dst == ${dst}`;
		if (src === dst) return `src == ${src} && dst == ${dst}`;
		return `(src == ${src} && dst == ${dst}) || (src == ${dst} && dst == ${src})`;
	}
	if (dst !== null) return `dst == ${dst}`;
	if (src !== null) return `src == ${src}`;
	return null;
}

/**
 * Read a filter expression back as the conversation it follows, or null when
 * the text is any other filter. Exactly the shapes `conversationExpression`
 * writes are recognized and nothing else: the expression is ordinary filter
 * text the operator may edit freely, and an edited one is simply a filter
 * again — the UI must not keep calling it a conversation once it stops being
 * one.
 */
export function parseConversationExpression(
	text: string,
): FrameAddressing | null {
	const hex = "([0-9a-f]{8}|[0-9a-f]{32})";
	const trimmed = text.trim().toLowerCase();
	const pair = new RegExp(
		`^\\(src == ${hex} && dst == ${hex}\\) \\|\\| \\(src == ${hex} && dst == ${hex}\\)$`,
	).exec(trimmed);
	if (pair && pair[1] === pair[4] && pair[2] === pair[3])
		return { src: pair[1], dst: pair[2], reason: null };
	const oneWay = new RegExp(`^src == ${hex} && dst == ${hex}$`).exec(trimmed);
	if (oneWay) return { src: oneWay[1], dst: oneWay[2], reason: null };
	const toDestination = new RegExp(`^dst == ${hex}$`).exec(trimmed);
	if (toDestination)
		return {
			src: null,
			dst: toDestination[1],
			reason: REASON.reticulumNoSource,
		};
	const fromSource = new RegExp(`^src == ${hex}$`).exec(trimmed);
	if (fromSource)
		return {
			src: fromSource[1],
			dst: null,
			reason: "this filter names a sender only",
		};
	return null;
}

/** How an address reads in a button or a status line. */
export function addressLabel(hexAddress: string): string {
	if (hexAddress === MESHTASTIC_BROADCAST_HEX) return "broadcast";
	// A 16-byte Reticulum hash is unreadable in full at this size; naming a
	// destination by its first 8 hex characters is what the rest of the
	// analyzer does with one.
	return hexAddress.length > 8 ? `${hexAddress.slice(0, 8)}…` : hexAddress;
}

/** The conversation this frame belongs to, named for a button or a line. */
export function conversationLabel(address: FrameAddressing): string | null {
	const { src, dst } = address;
	if (src !== null && dst !== null)
		return dst === MESHTASTIC_BROADCAST_HEX || src === dst
			? `${addressLabel(src)} → ${addressLabel(dst)}`
			: `${addressLabel(src)} ↔ ${addressLabel(dst)}`;
	if (dst !== null) return `→ ${addressLabel(dst)}`;
	if (src !== null) return `${addressLabel(src)} →`;
	return null;
}

/* ── the excluded frames, counted and named ──────────────────────────── */

/** How many frames of a capture a conversation filter can reach at all. */
export interface ConversationCoverage {
	total: number;
	/** Frames naming at least one endpoint — the ones a filter can match. */
	addressable: number;
	/** Frames naming none. They can never match, whatever the expression. */
	undecodable: number;
	/** Why the undecodable ones are undecodable, most frames first. */
	reasons: { reason: string; count: number }[];
}

/**
 * Short form of a reason, for the one-line note. The long sentences above
 * belong beside a single frame; a footer counting a whole capture needs the
 * clause, not the paragraph.
 */
function shortReason(reason: string): string {
	if (reason === REASON.meshcore) return REASON.meshcoreShort;
	if (reason === REASON.unknownProfile) return REASON.unknownProfileShort;
	if (reason === REASON.meshtasticMalformed)
		return REASON.meshtasticMalformedShort;
	if (reason === REASON.reticulumNoHeader) return REASON.reticulumNoHeaderShort;
	return reason;
}

/** Count what a conversation filter can and cannot reach in this capture. */
export function conversationCoverage(
	addressings: readonly FrameAddressing[],
): ConversationCoverage {
	const counts = new Map<string, number>();
	let addressable = 0;
	for (const address of addressings) {
		if (isAddressable(address)) {
			addressable++;
			continue;
		}
		const reason = shortReason(address.reason ?? "reason not recorded");
		counts.set(reason, (counts.get(reason) ?? 0) + 1);
	}
	const reasons = [...counts.entries()]
		.map(([reason, count]) => ({ reason, count }))
		.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
	return {
		total: addressings.length,
		addressable,
		undecodable: addressings.length - addressable,
		reasons,
	};
}

/**
 * Every endpoint a capture's frames name, deduplicated and sorted. Both ends
 * of every addressable frame count: a node that only ever received is still
 * a node this capture proves was addressed. Frames that name no address
 * contribute nothing, which is why `conversationCoverage` has to be read
 * alongside any difference taken over these — a node missing from the list
 * may be a node no frame could decode rather than a node nobody heard.
 */
export function captureEndpoints(
	addressings: readonly FrameAddressing[],
): string[] {
	const seen = new Set<string>();
	for (const address of addressings) {
		if (address.src !== null) seen.add(address.src);
		if (address.dst !== null) seen.add(address.dst);
	}
	return [...seen].sort();
}

/** The endpoints in `a` that `b` never names, in the order they sort. */
export function endpointsOnlyIn(
	a: readonly string[],
	b: readonly string[],
): string[] {
	const other = new Set(b);
	return a.filter((address) => !other.has(address));
}

/**
 * The line shown while a conversation filter is applied: what is being
 * followed, and — explicitly, never silently — how many frames carry no
 * decodable addressing at all and are therefore excluded from it.
 */
export function coverageNote(coverage: ConversationCoverage): string {
	if (coverage.undecodable === 0)
		return `every one of the ${coverage.total} frame(s) in this capture carries decodable addressing`;
	const parts = coverage.reasons.map((r) => `${r.count} ${r.reason}`);
	return (
		`${coverage.undecodable} of ${coverage.total} frame(s) carry no decodable addressing and are excluded from any ` +
		`conversation filter — ${parts.join(" · ")}`
	);
}
