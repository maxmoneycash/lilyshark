/**
 * Shared model for the in-browser protocol dissection tree (UI-004).
 *
 * Mirrors the firmware's decoder vocabulary in
 * include/lilyshark/core/decoded_packet.h and include/lilyshark/core/decoder.h:
 * a decode either does not match, matches, or is malformed, and a matched
 * packet is header-only or payload-decoded. The tree itself is the browser's
 * addition — every node carries the byte range it was decoded from so a hex
 * view can highlight it.
 */

/** DecodeResult in include/lilyshark/core/decoder.h. */
export type DissectResult = "matched" | "malformed" | "no-match";

/** DecodeState in include/lilyshark/core/decoded_packet.h. */
export type DecodeState =
	| "unknown"
	| "header-only"
	| "payload-decoded"
	| "malformed";

/** PacketKind in include/lilyshark/core/decoded_packet.h. */
export type PacketKind =
	| "unknown"
	| "encrypted-payload"
	| "data"
	| "control"
	| "advertisement"
	| "opaque-payload";

export type ProtocolName =
	| "Unknown"
	| "Meshtastic"
	| "MeshCore"
	| "Reticulum"
	| "Custom";

/**
 * Tone marks nodes that state a *limit* of decoding rather than a decoded
 * fact, so a UI can render them distinctly. "error" is a malformed-frame
 * explanation, "encrypted" a provably protected region, "opaque" bytes whose
 * protection status cannot be proven, "raw" bytes nothing decodes.
 */
export type NodeTone = "error" | "encrypted" | "opaque" | "raw";

/**
 * One node of the dissection tree.
 *
 * Byte-range invariants (asserted by dissect.test.ts):
 * - every child's range lies within its parent's range;
 * - sibling ranges are either identical (bit-fields packed into the same
 *   byte(s), Wireshark-style) or fully disjoint — never partially overlapping.
 */
export interface DissectNode {
	label: string;
	value?: string;
	byteOffset: number;
	byteLength: number;
	children: DissectNode[];
	tone?: NodeTone;
}

/** A completed dissection of one captured frame under one protocol. */
export interface Dissection {
	protocol: ProtocolName;
	result: DissectResult;
	state: DecodeState;
	kind: PacketKind;
	/** Root node spanning the whole captured frame. */
	root: DissectNode;
}

/**
 * A user-supplied channel key (UI-011). The name is the user's own label for
 * the key and is what decrypted-state labels report, so a decode always says
 * WHICH key read it. Key material lives only in the caller's memory — the
 * dissectors never copy it anywhere else.
 */
export interface ChannelKey {
	name: string;
	/** Raw key bytes — Meshtastic accepts 16 (AES-128) or 32 (AES-256). */
	key: Uint8Array;
}

export interface DissectOptions {
	/**
	 * True when the radio truncated the frame (RawFrame::wasTruncated in the
	 * firmware; LscapFrame.truncated in the browser). MeshCore and Reticulum
	 * report truncated frames as malformed; Meshtastic only flags them.
	 */
	truncated?: boolean;
	/**
	 * User-supplied channel keys, tried in the given order AFTER the published
	 * default PSK (Meshtastic is the only consumer today). A key that fails to
	 * produce a parseable plaintext is skipped — a wrong key never changes the
	 * output, so omitting this (or passing []) keeps every dissection
	 * byte-identical to the keyless behavior.
	 */
	channelKeys?: readonly ChannelKey[];
}

/** Build a tree node. */
export function node(
	label: string,
	byteOffset: number,
	byteLength: number,
	value?: string,
	children: DissectNode[] = [],
	tone?: NodeTone,
): DissectNode {
	const built: DissectNode = { label, byteOffset, byteLength, children };
	if (value !== undefined) built.value = value;
	if (tone !== undefined) built.tone = tone;
	return built;
}

/** 0x-prefixed fixed-width hex for a decoded integer. */
export function hex(value: number, bytes: number): string {
	return `0x${value.toString(16).padStart(bytes * 2, "0")}`;
}

/** Plain hex string of a byte range (no 0x prefix, no separators). */
export function hexBytes(
	bytes: Uint8Array,
	offset: number,
	length: number,
): string {
	let out = "";
	for (let i = 0; i < length; i++) {
		out += bytes[offset + i].toString(16).padStart(2, "0");
	}
	return out;
}

export function readLe16(bytes: Uint8Array, offset: number): number {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readLe32(bytes: Uint8Array, offset: number): number {
	return (
		(bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) +
		bytes[offset + 3] * 0x1000000
	);
}

/** Network byte order (big-endian) 32-bit read — Reticulum hash prefixes. */
export function readBe32(bytes: Uint8Array, offset: number): number {
	return (
		bytes[offset] * 0x1000000 +
		((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
	);
}
