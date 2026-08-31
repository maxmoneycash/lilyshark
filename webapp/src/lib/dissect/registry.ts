/**
 * Dissector registry — port of src/core/decoder_registry.cpp plus the
 * firmware's registration order in src/sim_main.cpp: Meshtastic, MeshCore,
 * Reticulum, then the Shelby pointer decoder last.
 *
 * Decoding is profile-gated exactly as in the firmware: each protocol decoder
 * only engages when the radio profile's protocol hint names it, so unrelated
 * LoRa traffic stays Unknown rather than being guessed at. The Shelby pointer
 * scan is profile-independent — a pointer is identified by its own magic —
 * and is merged as secondary application metadata: it never replaces the
 * enclosing protocol's decode (src/shelby/shelby_pointer_decoder.cpp).
 */

import type { ShelbyPointer } from "../lscap";
import { findShelbyPointer, SHELBY_POINTER_SIZE } from "../lscap";
import type { MeshCoreDissection } from "./meshcore";
import { dissectMeshCore } from "./meshcore";
import type { MeshtasticDissection } from "./meshtastic";
import { dissectMeshtastic } from "./meshtastic";
import type { ReticulumDissection } from "./rnode";
import { dissectRNode } from "./rnode";
import type { Dissection, DissectNode, DissectOptions } from "./types";
import { hex, node } from "./types";

/** ProtocolId in include/lilyshark/core/protocol.h, as profile hints. */
export type ProtocolHint =
	| "unknown"
	| "meshtastic"
	| "meshcore"
	| "reticulum"
	| "custom";

export interface UnknownDissection extends Dissection {
	protocol: "Unknown";
	fields: null;
}

export interface ShelbyDissection extends Dissection {
	protocol: "Custom";
	fields: { pointerOffset: number; pointer: ShelbyPointer };
}

export type AnyDissection =
	| MeshtasticDissection
	| MeshCoreDissection
	| ReticulumDissection
	| ShelbyDissection
	| UnknownDissection;

export interface FrameDissection {
	primary: AnyDissection;
	/**
	 * AttributeShelbyPointer equivalent: a complete, valid Shelby pointer found
	 * anywhere in the captured bytes, decoded by the shared reader in lscap.ts.
	 * Secondary metadata — the primary decode is never replaced by it.
	 */
	shelby: { offset: number; pointer: ShelbyPointer } | null;
}

/** Build the dissection subtree for a decoded Shelby pointer. */
export function shelbyPointerNode(
	offset: number,
	pointer: ShelbyPointer,
): DissectNode {
	const flagBits = [
		node("Blob encrypted", offset + 5, 1, pointer.encrypted ? "yes" : "no"),
		node("Chunked", offset + 5, 1, pointer.chunked ? "yes" : "no"),
		node("Capture (.lscap)", offset + 5, 1, pointer.capture ? "yes" : "no"),
	];
	return node(
		"Shelby pointer",
		offset,
		SHELBY_POINTER_SIZE,
		pointer.encrypted
			? "references an encrypted off-grid blob"
			: "references an off-grid blob",
		[
			node("Magic", offset, 4, '"SHLB"'),
			node("Version", offset + 4, 1, String(pointer.version)),
			node("Flags", offset + 5, 1, hex(pointer.flags, 1), flagBits),
			node("Blob commitment", offset + 6, 32, pointer.commitment),
			node("Owner account", offset + 38, 32, pointer.owner),
			node("Blob size", offset + 70, 4, `${pointer.sizeBytes} bytes`),
			node(
				"Expiry",
				offset + 74,
				4,
				`${pointer.expiresAtUnix} (${new Date(pointer.expiresAtUnix * 1000).toISOString()})`,
			),
			node("Chunk index", offset + 78, 2, String(pointer.chunkIndex)),
			node("Chunk count", offset + 80, 2, String(pointer.chunkCount)),
		],
	);
}

function unknownDissection(
	bytes: Uint8Array,
	opts: DissectOptions,
): UnknownDissection {
	const n = bytes.length;
	const root = node("Unknown protocol", 0, n, undefined, [
		node("Raw bytes", 0, n, `undecoded — ${n} raw bytes`, [], "raw"),
	]);
	if (opts.truncated) {
		root.children.push(
			node(
				"Truncated capture",
				n,
				0,
				"the radio cut this frame short",
				[],
				"error",
			),
		);
	}
	return {
		protocol: "Unknown",
		result: "no-match",
		state: "unknown",
		kind: "unknown",
		root,
		fields: null,
	};
}

/**
 * Standalone Custom decode when no protocol decoder matched but the frame
 * carries a pointer — mirrors ShelbyPointerDecoder::decode.
 */
function shelbyDissection(
	bytes: Uint8Array,
	offset: number,
	pointer: ShelbyPointer,
	opts: DissectOptions,
): ShelbyDissection {
	const n = bytes.length;
	const root = node("Custom (Shelby pointer)", 0, n);
	if (offset > 0) {
		root.children.push(
			node(
				"Leading bytes",
				0,
				offset,
				`undecoded — ${offset} raw bytes`,
				[],
				"raw",
			),
		);
	}
	root.children.push(shelbyPointerNode(offset, pointer));
	const trailing = n - (offset + SHELBY_POINTER_SIZE);
	if (trailing > 0) {
		root.children.push(
			node(
				"Trailing bytes",
				offset + SHELBY_POINTER_SIZE,
				trailing,
				`undecoded — ${trailing} raw bytes`,
				[],
				"raw",
			),
		);
	}
	if (opts.truncated) {
		root.children.push(
			node(
				"Truncated capture",
				n,
				0,
				"the radio cut this frame short",
				[],
				"error",
			),
		);
	}
	return {
		protocol: "Custom",
		result: "matched",
		state: "payload-decoded",
		kind: "data",
		root,
		fields: { pointerOffset: offset, pointer },
	};
}

function rangesOverlap(
	aOff: number,
	aLen: number,
	bOff: number,
	bLen: number,
): boolean {
	return aOff < bOff + bLen && bOff < aOff + aLen;
}

/**
 * Attach the pointer subtree to the deepest tree node that fully contains its
 * byte range, keeping the sibling-disjointness invariant: if any existing
 * child partially overlaps the pointer's range, the subtree is not attached
 * (the pointer is still reported in FrameDissection.shelby).
 */
function attachShelbySubtree(
	root: DissectNode,
	offset: number,
	pointer: ShelbyPointer,
): void {
	let host = root;
	let descended = true;
	while (descended) {
		descended = false;
		for (const child of host.children) {
			if (
				offset >= child.byteOffset &&
				offset + SHELBY_POINTER_SIZE <= child.byteOffset + child.byteLength
			) {
				host = child;
				descended = true;
				break;
			}
		}
	}
	for (const child of host.children) {
		if (
			rangesOverlap(
				child.byteOffset,
				child.byteLength,
				offset,
				SHELBY_POINTER_SIZE,
			)
		) {
			return;
		}
	}
	host.children.push(shelbyPointerNode(offset, pointer));
}

/**
 * Dissect one captured frame under a radio profile's protocol hint —
 * DecoderRegistry::decode. The hint gates which structural decoder engages;
 * "unknown" and "custom" hints never guess, matching
 * testUnknownFallbackDoesNotGuessProtocol in test/core_runtime.
 */
export function dissectFrame(
	bytes: Uint8Array,
	hint: ProtocolHint,
	opts: DissectOptions = {},
): FrameDissection {
	let primary: AnyDissection;
	switch (hint) {
		case "meshtastic":
			primary = dissectMeshtastic(bytes, opts);
			break;
		case "meshcore":
			primary = dissectMeshCore(bytes, opts);
			break;
		case "reticulum":
			primary = dissectRNode(bytes, opts);
			break;
		default:
			primary = unknownDissection(bytes, opts);
			break;
	}

	// Shelby pointer scan, registered last and profile-independent. Reuses the
	// shared decoder in lscap.ts, which accepts exactly the bytes the firmware
	// accepts.
	const shelby = findShelbyPointer(bytes);
	if (!shelby) {
		return { primary, shelby: null };
	}

	if (primary.result === "no-match") {
		return {
			primary: shelbyDissection(bytes, shelby.offset, shelby.pointer, opts),
			shelby,
		};
	}

	// Only the marker (and its subtree) merges into a primary decode; the
	// enclosing protocol keeps every field and the overall result.
	attachShelbySubtree(primary.root, shelby.offset, shelby.pointer);
	return { primary, shelby };
}
