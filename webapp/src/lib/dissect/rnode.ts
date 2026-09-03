/**
 * Reticulum-over-RNode structural dissector — port of
 * src/core/reticulum_decoder.cpp.
 *
 * Physical layout:
 *   shim[1]     RNode physical framing byte; bit 0 marks a split frame
 *   flags[1]    IFAC (bit 7), header type (6), context flag (5),
 *               transport/propagation (4), destination type (3-2),
 *               packet type (1-0)
 *   hops[1]
 *   transport id[16]      HEADER_2 only
 *   destination hash[16]
 *   context[1]
 *   payload
 *
 * RNS hashes are 128-bit; the firmware exposes only their first four
 * network-order bytes as prefixes and never claims them as full identifiers.
 * IFAC masks the header and payload — only the marker bit is interpreted.
 */

import type {
	DecodeState,
	Dissection,
	DissectNode,
	DissectOptions,
	PacketKind,
} from "./types";
import { hex, hexBytes, node, readBe32 } from "./types";

export const RNODE_SHIM_LENGTH = 1;
export const RETICULUM_HEADER_ONE_LENGTH = 19;
export const RETICULUM_HEADER_TWO_LENGTH = 35;
export const RETICULUM_MINIMUM_IFAC_BYTES = 1;
export const RETICULUM_MAXIMUM_HOPS_EXCLUSIVE = 128;

/* ── announce semantic tier — include/lilyshark/protocols/reticulum_decoder.h
 *
 * An RNS announce payload has a fixed layout apart from two optional tails:
 *
 *   public key   64 bytes (32B X25519 + 32B Ed25519)
 *   name hash    10 bytes
 *   random hash  10 bytes
 *   [ratchet     32 bytes — present only when the header's context flag is set]
 *   signature    64 bytes
 *   [app_data    everything remaining — application-defined]
 *
 * Every field is placed by length and flag arithmetic alone; no cryptography
 * runs here. Key, ratchet, and signature bytes cannot be validated without
 * crypto, so they are reported as *present* with byte ranges rather than as
 * verified values. app_data is application-defined and stays undecoded raw
 * bytes — it is never interpreted. */

export const RETICULUM_HASH_BYTES = 16;
export const RETICULUM_ANNOUNCE_PUBLIC_KEY_BYTES = 64;
export const RETICULUM_ANNOUNCE_NAME_HASH_BYTES = 10;
export const RETICULUM_ANNOUNCE_RANDOM_HASH_BYTES = 10;
export const RETICULUM_ANNOUNCE_RATCHET_BYTES = 32;
export const RETICULUM_ANNOUNCE_SIGNATURE_BYTES = 64;

/** Announce payload length with neither ratchet nor app_data: 64+10+10+64. */
export const RETICULUM_ANNOUNCE_MINIMUM_BYTES =
	RETICULUM_ANNOUNCE_PUBLIC_KEY_BYTES +
	RETICULUM_ANNOUNCE_NAME_HASH_BYTES +
	RETICULUM_ANNOUNCE_RANDOM_HASH_BYTES +
	RETICULUM_ANNOUNCE_SIGNATURE_BYTES;

/** kMaxFrameBytes in include/lilyshark/core/raw_frame.h. */
export const RETICULUM_MAX_FRAME_BYTES = 255;

/**
 * Largest app_data that fits a captured frame: the shortest possible clear
 * announce framing is RNode shim + HEADER_1 + the fixed announce fields
 * (kReticulumAnnounceMaxAppDataBytes in the firmware).
 */
export const RETICULUM_ANNOUNCE_MAX_APP_DATA_BYTES =
	RETICULUM_MAX_FRAME_BYTES -
	RNODE_SHIM_LENGTH -
	RETICULUM_HEADER_ONE_LENGTH -
	RETICULUM_ANNOUNCE_MINIMUM_BYTES;

/** ReticulumPacketType in include/lilyshark/protocols/reticulum_decoder.h. */
export const RETICULUM_PACKET_TYPE = {
	data: 0,
	announce: 1,
	linkRequest: 2,
	proof: 3,
} as const;

const PACKET_TYPE_LABEL = [
	"DATA",
	"ANNOUNCE",
	"LINK REQUEST",
	"PROOF",
] as const;

/** ReticulumDestinationType. */
export const RETICULUM_DESTINATION_TYPE = {
	single: 0,
	group: 1,
	plain: 2,
	link: 3,
} as const;

const DESTINATION_TYPE_LABEL = ["SINGLE", "GROUP", "PLAIN", "LINK"] as const;

/** Context values the firmware names (reticulum_decoder.cpp). */
const CONTEXT_RESOURCE = 0x01;
const CONTEXT_RESOURCE_PROOF = 0x05;
const CONTEXT_CACHE_REQUEST = 0x08;
const CONTEXT_KEEPALIVE = 0xfa;

const CONTEXT_LABEL: Record<number, string> = {
	0: "NONE",
	[CONTEXT_RESOURCE]: "RESOURCE",
	[CONTEXT_RESOURCE_PROOF]: "RESOURCE PROOF",
	[CONTEXT_CACHE_REQUEST]: "CACHE REQUEST",
	[CONTEXT_KEEPALIVE]: "KEEPALIVE",
};

/** payloadIsClear in reticulum_decoder.cpp, byte for byte. */
export function reticulumPayloadIsClear(
	packetType: number,
	destinationType: number,
	context: number,
): boolean {
	if (
		packetType === RETICULUM_PACKET_TYPE.announce ||
		packetType === RETICULUM_PACKET_TYPE.linkRequest ||
		destinationType === RETICULUM_DESTINATION_TYPE.plain
	) {
		return true;
	}
	if (
		packetType === RETICULUM_PACKET_TYPE.proof &&
		(context === CONTEXT_RESOURCE_PROOF ||
			destinationType === RETICULUM_DESTINATION_TYPE.link)
	) {
		return true;
	}
	return (
		context === CONTEXT_RESOURCE ||
		context === CONTEXT_CACHE_REQUEST ||
		context === CONTEXT_KEEPALIVE
	);
}

/**
 * The full 16-byte destination hash of a clear RNode/Reticulum header, as
 * lowercase hex — or null when the frame carries no readable one: shorter
 * than the shim plus flags, a split continuation, IFAC-masked, an
 * out-of-range hop count, or a header cut short. This is the same header
 * arithmetic `dissectRNode` performs, without building a tree: the display
 * filter's `dest ==` runs it over every frame of a capture on every
 * keystroke. dissect.test.ts pins it against `dissectRNode`'s own
 * `destinationHashHex` for every fixture, every prefix of every fixture and
 * random bytes, so the two can never drift apart.
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

/** Absolute byte range inside the captured frame (ReticulumByteRange). */
export interface ReticulumByteRange {
	offset: number;
	length: number;
}

/**
 * One decoded announce — the TypeScript form of ReticulumAnnounce filled by
 * readReticulumAnnounce in src/core/reticulum_decoder.cpp. Present only when
 * the frame proves, by length and flag arithmetic, that every fixed field
 * fits: ANNOUNCE packet type, SINGLE destination, no split, no IFAC, no
 * truncation, and a payload long enough for every promised field (including
 * the ratchet when the context flag promises one). All ranges are absolute
 * offsets into the captured frame bytes.
 */
export interface ReticulumAnnounceFields {
	headerType: 1 | 2;
	hops: number;
	/** Full 16-byte truncated destination hash, lowercase hex. */
	destinationHashHex: string;
	destinationHashRange: ReticulumByteRange;
	/** HEADER_2 only: the transport instance the announce travelled through. */
	transportIdHex: string | null;
	transportIdRange: ReticulumByteRange | null;
	/** Presence + range only — arithmetic cannot validate key bytes. */
	publicKeyRange: ReticulumByteRange;
	nameHashHex: string;
	nameHashRange: ReticulumByteRange;
	randomHashHex: string;
	randomHashRange: ReticulumByteRange;
	/** Ratchet presence is signalled by the header's context flag. */
	ratchetRange: ReticulumByteRange | null;
	/** Presence + range only — the signature is never verified here. */
	signatureRange: ReticulumByteRange;
	/** Application-defined tail, kept as raw bytes; 0 when absent. */
	appDataLength: number;
	appDataRange: ReticulumByteRange | null;
	appDataHex: string | null;
	/**
	 * Set only when EVERY app_data byte is printable ASCII — a preview, not a
	 * decode: Reticulum app_data is often msgpack and is never interpreted.
	 */
	appDataPreview: string | null;
}

export interface ReticulumFields {
	rnodeShim: number;
	splitFrame: boolean;
	/** Everything below is null for split frames (no clear RNS header). */
	rnsFlags: number | null;
	ifacProtected: boolean;
	headerType: 1 | 2 | null;
	contextFlag: boolean;
	transportPacket: boolean;
	packetType: number | null;
	destinationType: number | null;
	hops: number | null;
	/** First four network-order bytes of the 16-byte hashes — prefixes only. */
	transportIdPrefix: number | null;
	destinationHashPrefix: number | null;
	/** Full 16-byte destination hash, lowercase hex — clear headers only. */
	destinationHashHex: string | null;
	context: number | null;
	payloadOffset: number;
	payloadLength: number;
	encrypted: boolean;
	/** Semantic announce tier (UI-013); null unless provably an announce. */
	announce: ReticulumAnnounceFields | null;
}

export interface ReticulumDissection extends Dissection {
	protocol: "Reticulum";
	fields: ReticulumFields | null;
}

function result(
	root: DissectNode,
	fields: ReticulumFields | null,
	res: "matched" | "malformed",
	state: DecodeState,
	kind: PacketKind,
): ReticulumDissection {
	return { protocol: "Reticulum", result: res, state, kind, root, fields };
}

function malformed(
	root: DissectNode,
	fields: ReticulumFields | null,
): ReticulumDissection {
	return result(root, fields, "malformed", "malformed", "unknown");
}

function errorNode(
	root: DissectNode,
	offset: number,
	length: number,
	message: string,
): void {
	root.children.push(
		node("Malformed frame", offset, length, message, [], "error"),
	);
}

/**
 * Dissect one RNode-framed Reticulum frame. The caller (registry.ts) is
 * responsible for profile gating, as in the firmware.
 */
export function dissectRNode(
	bytes: Uint8Array,
	opts: DissectOptions = {},
): ReticulumDissection {
	const n = bytes.length;
	const root = node("Reticulum (RNode)", 0, n);

	if (n < RNODE_SHIM_LENGTH + 1) {
		errorNode(
			root,
			0,
			n,
			`needs the RNode shim byte plus RNS flags, have ${n} byte(s)`,
		);
		return malformed(root, null);
	}

	const shim = bytes[0];
	const splitFrame = (shim & 0x01) !== 0;
	const fields: ReticulumFields = {
		rnodeShim: shim,
		splitFrame,
		rnsFlags: null,
		ifacProtected: false,
		headerType: null,
		contextFlag: false,
		transportPacket: false,
		packetType: null,
		destinationType: null,
		hops: null,
		transportIdPrefix: null,
		destinationHashPrefix: null,
		destinationHashHex: null,
		context: null,
		payloadOffset: RNODE_SHIM_LENGTH,
		payloadLength: n - RNODE_SHIM_LENGTH,
		encrypted: false,
		announce: null,
	};

	root.children.push(
		node("RNode shim", 0, 1, hex(shim, 1), [
			node("Split frame", 0, 1, splitFrame ? "yes" : "no"),
		]),
	);

	if (splitFrame) {
		// This stateless decoder never claims split reassembly.
		root.children.push(
			node(
				"Split continuation",
				1,
				n - 1,
				`undecoded — ${n - 1} raw bytes of a frame split across RNode transfers`,
				[],
				"raw",
			),
		);
		if (opts.truncated) {
			errorNode(root, n, 0, "the radio cut this frame short");
			return malformed(root, fields);
		}
		return result(root, fields, "matched", "header-only", "data");
	}

	const flags = bytes[1];
	fields.rnsFlags = flags;
	const ifac = (flags & 0x80) !== 0;
	const headerTwo = (flags & 0x40) !== 0;
	const contextFlag = (flags & 0x20) !== 0;
	const transport = (flags & 0x10) !== 0;
	const destinationType = (flags >>> 2) & 0x03;
	const packetType = flags & 0x03;
	fields.ifacProtected = ifac;

	if (ifac) {
		// IFAC masks the header and payload. Only its marker bit is safe to
		// interpret without the interface key.
		root.children.push(
			node("RNS flags", 1, 1, hex(flags, 1), [
				node("IFAC protected", 1, 1, "yes"),
			]),
		);
		const minimumProtectedLength =
			RNODE_SHIM_LENGTH +
			RETICULUM_HEADER_ONE_LENGTH +
			RETICULUM_MINIMUM_IFAC_BYTES;
		if (n < minimumProtectedLength || opts.truncated) {
			errorNode(
				root,
				2,
				n - 2,
				opts.truncated
					? "the radio cut this frame short"
					: `IFAC frame needs at least ${minimumProtectedLength} bytes, have ${n}`,
			);
			return malformed(root, fields);
		}
		fields.encrypted = true;
		root.children.push(
			node(
				"IFAC-masked frame",
				2,
				n - 2,
				`encrypted — ${n - 2} bytes masked with the interface access code (key not held)`,
				[],
				"encrypted",
			),
		);
		return result(root, fields, "matched", "header-only", "encrypted-payload");
	}

	fields.headerType = headerTwo ? 2 : 1;
	fields.contextFlag = contextFlag;
	fields.transportPacket = transport;
	fields.packetType = packetType;
	fields.destinationType = destinationType;

	root.children.push(
		node("RNS flags", 1, 1, hex(flags, 1), [
			node("IFAC protected", 1, 1, "no"),
			node(
				"Header type",
				1,
				1,
				headerTwo ? "HEADER_2 (transport id present)" : "HEADER_1",
			),
			node("Context flag", 1, 1, contextFlag ? "set" : "clear"),
			node(
				"Transport",
				1,
				1,
				transport ? "propagated via transport" : "direct",
			),
			node(
				"Destination type",
				1,
				1,
				`${destinationType} (${DESTINATION_TYPE_LABEL[destinationType]})`,
			),
			node(
				"Packet type",
				1,
				1,
				`${packetType} (${PACKET_TYPE_LABEL[packetType]})`,
			),
		]),
	);

	const logicalHeaderLength = headerTwo
		? RETICULUM_HEADER_TWO_LENGTH
		: RETICULUM_HEADER_ONE_LENGTH;
	const physicalHeaderLength = RNODE_SHIM_LENGTH + logicalHeaderLength;
	if (n < physicalHeaderLength) {
		errorNode(
			root,
			2,
			n - 2,
			`${headerTwo ? "HEADER_2" : "HEADER_1"} needs ${physicalHeaderLength} bytes, have ${n}`,
		);
		return malformed(root, fields);
	}

	const hops = bytes[2];
	if (hops >= RETICULUM_MAXIMUM_HOPS_EXCLUSIVE) {
		root.children.push(node("Hops", 2, 1, String(hops)));
		errorNode(root, 2, 1, `hop count ${hops} is outside RNS limits (< 128)`);
		return malformed(root, fields);
	}
	fields.hops = hops;
	root.children.push(node("Hops", 2, 1, String(hops)));

	const transportOffset = 3;
	const destinationOffset = headerTwo ? transportOffset + 16 : transportOffset;
	if (headerTwo) {
		fields.transportIdPrefix = readBe32(bytes, transportOffset);
		root.children.push(
			node(
				"Transport id",
				transportOffset,
				16,
				`${hexBytes(bytes, transportOffset, 16)} (prefix ${hex(fields.transportIdPrefix, 4)})`,
			),
		);
	}
	fields.destinationHashPrefix = readBe32(bytes, destinationOffset);
	fields.destinationHashHex = hexBytes(bytes, destinationOffset, 16);
	root.children.push(
		node(
			"Destination hash",
			destinationOffset,
			16,
			`${fields.destinationHashHex} (prefix ${hex(fields.destinationHashPrefix, 4)})`,
		),
	);

	const contextOffset = destinationOffset + 16;
	const context = bytes[contextOffset];
	fields.context = context;
	const contextLabel = CONTEXT_LABEL[context];
	root.children.push(
		node(
			"Context",
			contextOffset,
			1,
			contextLabel ? `${hex(context, 1)} (${contextLabel})` : hex(context, 1),
		),
	);

	fields.payloadOffset = physicalHeaderLength;
	fields.payloadLength = n - physicalHeaderLength;

	let kind: PacketKind = "data";
	if (packetType === RETICULUM_PACKET_TYPE.announce) {
		kind = "advertisement";
	} else if (
		packetType === RETICULUM_PACKET_TYPE.linkRequest ||
		packetType === RETICULUM_PACKET_TYPE.proof
	) {
		kind = "control";
	}

	// Semantic announce tier — announceArithmeticHolds in the firmware:
	// announces are only issued by SINGLE destinations, and the payload must
	// provably hold every fixed field the flags promise. Anything else stays
	// structural (header-only), exactly as in the C++ decoder.
	const isAnnounce = packetType === RETICULUM_PACKET_TYPE.announce;
	const announceFixedLength =
		RETICULUM_ANNOUNCE_MINIMUM_BYTES +
		(contextFlag ? RETICULUM_ANNOUNCE_RATCHET_BYTES : 0);
	const announceArithmeticHolds =
		isAnnounce &&
		destinationType === RETICULUM_DESTINATION_TYPE.single &&
		fields.payloadLength >= announceFixedLength;
	// The state follows the announce that is actually read, not the flags that
	// promised one. The C++ decode() sets PayloadDecoded from
	// announceArithmeticHolds alone, but on-device that can never disagree
	// with the reader: a RawFrame is capped at kMaxFrameBytes, so app_data can
	// never exceed kReticulumAnnounceMaxAppDataBytes there. A .lscap record
	// carries a 16-bit captured length and CAN, and calling such a frame
	// payload-decoded while reporting no announce would be a claim about
	// bytes nothing read.
	let state: DecodeState = "header-only";

	const clear = reticulumPayloadIsClear(packetType, destinationType, context);
	if (!clear) {
		fields.encrypted = true;
		kind = "encrypted-payload";
		root.children.push(
			node(
				"Payload",
				physicalHeaderLength,
				fields.payloadLength,
				`encrypted payload — ${fields.payloadLength} bytes (destination key not held)`,
				[],
				"encrypted",
			),
		);
	} else if (
		announceArithmeticHolds &&
		!opts.truncated &&
		fields.payloadLength - announceFixedLength <=
			RETICULUM_ANNOUNCE_MAX_APP_DATA_BYTES
	) {
		// readReticulumAnnounce: the fields are placed by arithmetic alone. A
		// truncated capture never reaches this branch (the C++ reader refuses a
		// malformed packet), and app_data beyond the frame arithmetic's maximum
		// stays structural exactly as the firmware's reader refuses it.
		fields.announce = fillAnnounce(
			root,
			bytes,
			fields,
			headerTwo,
			contextFlag,
			hops,
			transportOffset,
			destinationOffset,
		);
		state = "payload-decoded";
	} else {
		// The generic clear-payload node, with the firmware reader's refusal
		// reasons said out loud where the flags looked like an announce.
		const reason = !isAnnounce
			? "contents not parsed"
			: destinationType !== RETICULUM_DESTINATION_TYPE.single
				? `ANNOUNCE from a ${DESTINATION_TYPE_LABEL[destinationType]} destination is a flag inconsistency — stays structural`
				: fields.payloadLength < announceFixedLength
					? `announce payload shorter than the ${announceFixedLength}-byte fixed field layout${contextFlag ? " (context flag promises a ratchet)" : ""} — stays structural`
					: opts.truncated
						? "truncated capture — announce fields cannot be trusted"
						: `announce app_data exceeds the ${RETICULUM_ANNOUNCE_MAX_APP_DATA_BYTES}-byte frame arithmetic — stays structural`;
		root.children.push(
			node(
				"Payload",
				physicalHeaderLength,
				fields.payloadLength,
				`undecoded — ${fields.payloadLength} raw bytes (cleartext by protocol rule; ${reason})`,
				[],
				"raw",
			),
		);
	}

	if (opts.truncated) {
		errorNode(root, n, 0, "the radio cut this frame short");
		return malformed(root, fields);
	}
	return result(root, fields, "matched", state, kind);
}

/** True when every byte of the range is printable ASCII (0x20–0x7e). */
function isPrintableAscii(
	bytes: Uint8Array,
	offset: number,
	length: number,
): boolean {
	for (let i = 0; i < length; i++) {
		const b = bytes[offset + i];
		if (b < 0x20 || b > 0x7e) return false;
	}
	return length > 0;
}

/** Preview cap so a maximal app_data tail cannot flood a tree row. */
const APP_DATA_PREVIEW_LIMIT = 48;
/** Hex shown in the tree caps at this many bytes; fields keep the full hex. */
const APP_DATA_HEX_NODE_LIMIT = 32;

/**
 * Fill the announce fields and attach the announce subtree — the TypeScript
 * body of readReticulumAnnounce, byte range for byte range. Only called once
 * the caller has proven the arithmetic holds.
 */
function fillAnnounce(
	root: DissectNode,
	bytes: Uint8Array,
	fields: ReticulumFields,
	headerTwo: boolean,
	contextFlag: boolean,
	hops: number,
	transportOffset: number,
	destinationOffset: number,
): ReticulumAnnounceFields {
	const range = (offset: number, length: number): ReticulumByteRange => ({
		offset,
		length,
	});

	let cursor = fields.payloadOffset;
	const publicKeyRange = range(cursor, RETICULUM_ANNOUNCE_PUBLIC_KEY_BYTES);
	cursor += RETICULUM_ANNOUNCE_PUBLIC_KEY_BYTES;
	const nameHashRange = range(cursor, RETICULUM_ANNOUNCE_NAME_HASH_BYTES);
	cursor += RETICULUM_ANNOUNCE_NAME_HASH_BYTES;
	const randomHashRange = range(cursor, RETICULUM_ANNOUNCE_RANDOM_HASH_BYTES);
	cursor += RETICULUM_ANNOUNCE_RANDOM_HASH_BYTES;
	let ratchetRange: ReticulumByteRange | null = null;
	if (contextFlag) {
		ratchetRange = range(cursor, RETICULUM_ANNOUNCE_RATCHET_BYTES);
		cursor += RETICULUM_ANNOUNCE_RATCHET_BYTES;
	}
	const signatureRange = range(cursor, RETICULUM_ANNOUNCE_SIGNATURE_BYTES);
	cursor += RETICULUM_ANNOUNCE_SIGNATURE_BYTES;
	const appDataLength = fields.payloadOffset + fields.payloadLength - cursor;
	const appDataRange = appDataLength > 0 ? range(cursor, appDataLength) : null;

	const printable =
		appDataRange !== null &&
		isPrintableAscii(bytes, appDataRange.offset, appDataRange.length);
	const previewText = printable
		? String.fromCharCode(
				...bytes.subarray(
					// appDataRange is non-null whenever printable is true.
					(appDataRange as ReticulumByteRange).offset,
					(appDataRange as ReticulumByteRange).offset +
						Math.min(appDataLength, APP_DATA_PREVIEW_LIMIT),
				),
			) + (appDataLength > APP_DATA_PREVIEW_LIMIT ? "…" : "")
		: null;

	const announce: ReticulumAnnounceFields = {
		headerType: headerTwo ? 2 : 1,
		hops,
		// destinationHashHex is set for every clear header before this runs.
		destinationHashHex: fields.destinationHashHex ?? "",
		destinationHashRange: range(destinationOffset, RETICULUM_HASH_BYTES),
		transportIdHex: headerTwo
			? hexBytes(bytes, transportOffset, RETICULUM_HASH_BYTES)
			: null,
		transportIdRange: headerTwo
			? range(transportOffset, RETICULUM_HASH_BYTES)
			: null,
		publicKeyRange,
		nameHashHex: hexBytes(bytes, nameHashRange.offset, nameHashRange.length),
		nameHashRange,
		randomHashHex: hexBytes(
			bytes,
			randomHashRange.offset,
			randomHashRange.length,
		),
		randomHashRange,
		ratchetRange,
		signatureRange,
		appDataLength,
		appDataRange,
		appDataHex: appDataRange
			? hexBytes(bytes, appDataRange.offset, appDataRange.length)
			: null,
		appDataPreview: previewText,
	};

	const children: DissectNode[] = [
		node(
			"Public key",
			publicKeyRange.offset,
			publicKeyRange.length,
			"present — 64 bytes (32B X25519 + 32B Ed25519); presence proven by arithmetic, bytes not validated (no crypto runs here)",
		),
		node(
			"Name hash",
			nameHashRange.offset,
			nameHashRange.length,
			announce.nameHashHex,
		),
		node(
			"Random hash",
			randomHashRange.offset,
			randomHashRange.length,
			announce.randomHashHex,
		),
	];
	if (ratchetRange) {
		children.push(
			node(
				"Ratchet key",
				ratchetRange.offset,
				ratchetRange.length,
				"present — 32 bytes, promised by the context flag; bytes not validated",
			),
		);
	}
	children.push(
		node(
			"Signature",
			signatureRange.offset,
			signatureRange.length,
			"present — 64 bytes Ed25519; not verified (no crypto runs here)",
		),
	);
	if (appDataRange) {
		const hexShown =
			hexBytes(
				bytes,
				appDataRange.offset,
				Math.min(appDataLength, APP_DATA_HEX_NODE_LIMIT),
			) + (appDataLength > APP_DATA_HEX_NODE_LIMIT ? "…" : "");
		children.push(
			node(
				"App data",
				appDataRange.offset,
				appDataRange.length,
				`undecoded — ${appDataLength} raw application-defined byte(s) (often msgpack, never interpreted): ${hexShown}` +
					(previewText !== null
						? ` · printable-ASCII preview only: ${JSON.stringify(previewText)}`
						: ""),
				[],
				"raw",
			),
		);
	}

	root.children.push(
		node(
			"Announce",
			fields.payloadOffset,
			fields.payloadLength,
			`destination ${announce.destinationHashHex} · ${hops} hop(s) — cleartext by protocol rule; field layout proven by length arithmetic`,
			children,
		),
	);
	return announce;
}
