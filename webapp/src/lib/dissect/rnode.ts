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
	context: number | null;
	payloadOffset: number;
	payloadLength: number;
	encrypted: boolean;
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
		context: null,
		payloadOffset: RNODE_SHIM_LENGTH,
		payloadLength: n - RNODE_SHIM_LENGTH,
		encrypted: false,
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
	root.children.push(
		node(
			"Destination hash",
			destinationOffset,
			16,
			`${hexBytes(bytes, destinationOffset, 16)} (prefix ${hex(fields.destinationHashPrefix, 4)})`,
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
	} else {
		root.children.push(
			node(
				"Payload",
				physicalHeaderLength,
				fields.payloadLength,
				`undecoded — ${fields.payloadLength} raw bytes (cleartext by protocol rule; contents not parsed)`,
				[],
				"raw",
			),
		);
	}

	if (opts.truncated) {
		errorNode(root, n, 0, "the radio cut this frame short");
		return malformed(root, fields);
	}
	return result(root, fields, "matched", "header-only", kind);
}
