/**
 * MeshCore structural dissector — port of src/core/meshcore_decoder.cpp.
 *
 * MeshCore v1 wire format:
 *   header[1]         route (bits 0-1), payload type (bits 2-5), version (6-7)
 *   transport codes   two LE16 values, only for TransportFlood/TransportDirect
 *   path length[1]    hash count (bits 0-5), hash size - 1 (bits 6-7)
 *   path              count × size bytes of hop hashes
 *   payload           layout depends on the payload type
 *
 * Only payload version 1 (encoded as zero) has a published layout; a
 * future-version frame is a protocol match but is not parsed as v1.
 */

import type {
	DecodeState,
	Dissection,
	DissectNode,
	DissectOptions,
	PacketKind,
} from "./types";
import { hex, hexBytes, node, readLe16, readLe32 } from "./types";

export const MESHCORE_MAX_PATH_BYTES = 64;
export const MESHCORE_MAX_PAYLOAD_BYTES = 184;
export const MESHCORE_ADVERT_MINIMUM_PAYLOAD_BYTES = 100;

/** MeshCoreRouteType in include/lilyshark/protocols/meshcore_decoder.h. */
export const MESHCORE_ROUTE = {
	transportFlood: 0,
	flood: 1,
	direct: 2,
	transportDirect: 3,
} as const;

const ROUTE_LABEL = [
	"transport flood",
	"flood",
	"direct",
	"transport direct",
] as const;

/** MeshCorePayloadType in include/lilyshark/protocols/meshcore_decoder.h. */
export const MESHCORE_PAYLOAD_TYPE = {
	request: 0,
	response: 1,
	textMessage: 2,
	acknowledgement: 3,
	advertisement: 4,
	groupText: 5,
	groupData: 6,
	anonymousRequest: 7,
	returnedPath: 8,
	trace: 9,
	multipart: 10,
	control: 11,
	rawCustom: 15,
} as const;

const PAYLOAD_TYPE_LABEL: Record<number, string> = {
	0: "REQUEST",
	1: "RESPONSE",
	2: "TEXT MESSAGE",
	3: "ACKNOWLEDGEMENT",
	4: "ADVERTISEMENT",
	5: "GROUP TEXT",
	6: "GROUP DATA",
	7: "ANONYMOUS REQUEST",
	8: "RETURNED PATH",
	9: "TRACE",
	10: "MULTIPART",
	11: "CONTROL",
	12: "RESERVED (12)",
	13: "RESERVED (13)",
	14: "RESERVED (14)",
	15: "RAW CUSTOM",
};

function isDirectEncryptedType(type: number): boolean {
	return (
		type === MESHCORE_PAYLOAD_TYPE.request ||
		type === MESHCORE_PAYLOAD_TYPE.response ||
		type === MESHCORE_PAYLOAD_TYPE.textMessage ||
		type === MESHCORE_PAYLOAD_TYPE.returnedPath
	);
}

function routeHasTransportCodes(route: number): boolean {
	return (
		route === MESHCORE_ROUTE.transportFlood ||
		route === MESHCORE_ROUTE.transportDirect
	);
}

export interface MeshCoreAdvertisementFields {
	publicKeyHex: string;
	nodeIdHex: string;
	timestamp: number;
	signatureHex: string;
	nodeType: number;
	nodeTypeLabel: string;
	hasLocation: boolean;
	latitude?: number;
	longitude?: number;
	featureOne?: number;
	featureTwo?: number;
	name?: string;
}

export interface MeshCoreFields {
	header: number;
	routeType: number;
	payloadType: number;
	payloadVersion: number;
	/** Only for TransportFlood/TransportDirect routes. */
	transportCodeOne: number | null;
	transportCodeTwo: number | null;
	/** Raw encoded path-length byte, and its two decoded halves. */
	encodedPathLength: number | null;
	pathHashCount: number | null;
	pathHashSize: number | null;
	payloadOffset: number;
	payloadLength: number;
	/** ACK only: the 4-byte checksum (CRC over message + sender). */
	acknowledgementChecksum: number | null;
	/** GroupText/GroupData only: the channel hash byte. */
	channelHash: number | null;
	encrypted: boolean;
	advertisement?: MeshCoreAdvertisementFields;
}

export interface MeshCoreDissection extends Dissection {
	protocol: "MeshCore";
	fields: MeshCoreFields | null;
}

interface Outcome {
	result: "matched" | "malformed";
	state: DecodeState;
	kind: PacketKind;
}

const MALFORMED: Outcome = {
	result: "malformed",
	state: "malformed",
	kind: "unknown",
};

function finish(
	root: DissectNode,
	fields: MeshCoreFields | null,
	outcome: Outcome,
): MeshCoreDissection {
	return {
		protocol: "MeshCore",
		result: outcome.result,
		state: outcome.state,
		kind: outcome.kind,
		root,
		fields,
	};
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
 * Dissect the type-specific payload region. Returns the outcome, pushing
 * nodes for whatever the firmware proves structurally and honest raw /
 * encrypted nodes for everything it does not.
 */
function dissectPayload(
	bytes: Uint8Array,
	root: DissectNode,
	fields: MeshCoreFields,
): Outcome {
	const type = fields.payloadType;
	const cursor = fields.payloadOffset;
	const payloadLength = fields.payloadLength;
	const label = PAYLOAD_TYPE_LABEL[type] ?? String(type);

	if (type === MESHCORE_PAYLOAD_TYPE.acknowledgement) {
		if (payloadLength < 4) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`ACK needs a 4-byte checksum, have ${payloadLength}`,
			);
			return MALFORMED;
		}
		fields.acknowledgementChecksum = readLe32(bytes, cursor);
		const children = [
			node("Checksum", cursor, 4, hex(fields.acknowledgementChecksum, 4)),
		];
		if (payloadLength > 4) {
			children.push(
				node(
					"Trailing bytes",
					cursor + 4,
					payloadLength - 4,
					`undecoded — ${payloadLength - 4} raw bytes`,
					[],
					"raw",
				),
			);
		}
		root.children.push(
			node("Acknowledgement", cursor, payloadLength, undefined, children),
		);
		return { result: "matched", state: "payload-decoded", kind: "control" };
	}

	if (type === MESHCORE_PAYLOAD_TYPE.advertisement) {
		if (payloadLength < MESHCORE_ADVERT_MINIMUM_PAYLOAD_BYTES) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`advertisement needs at least ${MESHCORE_ADVERT_MINIMUM_PAYLOAD_BYTES} bytes, have ${payloadLength}`,
			);
			return MALFORMED;
		}

		const publicKeyHex = hexBytes(bytes, cursor, 32);
		const nodeId = readLe32(bytes, cursor);
		const nodeIdHex = nodeId.toString(16).padStart(8, "0");
		const timestamp = readLe32(bytes, cursor + 32);
		const signatureHex = hexBytes(bytes, cursor + 36, 64);

		let formattedTimestamp = String(timestamp);
		if (timestamp >= 1500000000 && timestamp <= 4200000000) {
			try {
				formattedTimestamp = `${timestamp} (${new Date(timestamp * 1000).toISOString()})`;
			} catch {
				// Keep numeric fallback
			}
		}

		const advertChildren: DissectNode[] = [
			node("Public key", cursor, 32, publicKeyHex, [
				node("Node ID", cursor, 4, hex(nodeId, 4)),
			]),
			node("Timestamp", cursor + 32, 4, formattedTimestamp),
			node("Signature", cursor + 36, 64, signatureHex),
		];

		let nodeType = 0;
		let nodeTypeLabel = "None";
		let hasLocation = false;
		let latitude: number | undefined;
		let longitude: number | undefined;
		let featureOne: number | undefined;
		let featureTwo: number | undefined;
		let name: string | undefined;

		if (payloadLength > MESHCORE_ADVERT_MINIMUM_PAYLOAD_BYTES) {
			const appDataOffset = cursor + 100;
			const appDataLength = payloadLength - 100;
			const flags = bytes[appDataOffset];
			nodeType = flags & 0x0f;
			const NODE_TYPE_LABELS: Record<number, string> = {
				0: "None",
				1: "Chat",
				2: "Repeater",
				3: "Room",
				4: "Sensor",
			};
			nodeTypeLabel = NODE_TYPE_LABELS[nodeType] ?? `Unknown (${nodeType})`;
			hasLocation = (flags & 0x10) !== 0;
			const hasFeatureOne = (flags & 0x20) !== 0;
			const hasFeatureTwo = (flags & 0x40) !== 0;
			const hasName = (flags & 0x80) !== 0;

			const appDataChildren: DissectNode[] = [
				node(
					"Flags & node type",
					appDataOffset,
					1,
					`${nodeTypeLabel} (flags: 0x${flags.toString(16).padStart(2, "0")})`,
				),
			];

			let adCursor = appDataOffset + 1;
			const adEnd = appDataOffset + appDataLength;

			if (hasLocation) {
				if (adCursor + 8 <= adEnd) {
					const latMicros = readLe32(bytes, adCursor) | 0;
					const lonMicros = readLe32(bytes, adCursor + 4) | 0;
					latitude = latMicros / 1e6;
					longitude = lonMicros / 1e6;
					appDataChildren.push(
						node(
							"Position",
							adCursor,
							8,
							`${latitude.toFixed(6)}°, ${longitude.toFixed(6)}°`,
							[
								node(
									"Latitude",
									adCursor,
									4,
									`${latitude.toFixed(6)}° (${latMicros} µ°)`,
								),
								node(
									"Longitude",
									adCursor + 4,
									4,
									`${longitude.toFixed(6)}° (${lonMicros} µ°)`,
								),
							],
						),
					);
					adCursor += 8;
				} else {
					appDataChildren.push(
						node(
							"Position (truncated)",
							adCursor,
							adEnd - adCursor,
							"truncated position field",
							[],
							"error",
						),
					);
					adCursor = adEnd;
				}
			}

			if (hasFeatureOne) {
				if (adCursor + 2 <= adEnd) {
					featureOne = readLe16(bytes, adCursor);
					appDataChildren.push(
						node("Feature 1", adCursor, 2, hex(featureOne, 2)),
					);
					adCursor += 2;
				} else {
					appDataChildren.push(
						node(
							"Feature 1 (truncated)",
							adCursor,
							adEnd - adCursor,
							"truncated feature field",
							[],
							"error",
						),
					);
					adCursor = adEnd;
				}
			}

			if (hasFeatureTwo) {
				if (adCursor + 2 <= adEnd) {
					featureTwo = readLe16(bytes, adCursor);
					appDataChildren.push(
						node("Feature 2", adCursor, 2, hex(featureTwo, 2)),
					);
					adCursor += 2;
				} else {
					appDataChildren.push(
						node(
							"Feature 2 (truncated)",
							adCursor,
							adEnd - adCursor,
							"truncated feature field",
							[],
							"error",
						),
					);
					adCursor = adEnd;
				}
			}

			if (hasName) {
				if (adCursor < adEnd) {
					const nameBytes = bytes.subarray(adCursor, adEnd);
					name = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);
					appDataChildren.push(
						node("Name", adCursor, adEnd - adCursor, name),
					);
					adCursor = adEnd;
				} else {
					appDataChildren.push(node("Name", adCursor, 0, "(empty)"));
				}
			} else if (adCursor < adEnd) {
				appDataChildren.push(
					node(
						"Trailing bytes",
						adCursor,
						adEnd - adCursor,
						`undecoded — ${adEnd - adCursor} raw bytes`,
						[],
						"raw",
					),
				);
			}

			advertChildren.push(
				node("App data", appDataOffset, appDataLength, undefined, appDataChildren),
			);
		}

		fields.advertisement = {
			publicKeyHex,
			nodeIdHex,
			timestamp,
			signatureHex,
			nodeType,
			nodeTypeLabel,
			hasLocation,
			latitude,
			longitude,
			featureOne,
			featureTwo,
			name,
		};

		root.children.push(
			node("Advertisement", cursor, payloadLength, undefined, advertChildren),
		);
		return {
			result: "matched",
			state: payloadLength > MESHCORE_ADVERT_MINIMUM_PAYLOAD_BYTES ? "payload-decoded" : "header-only",
			kind: "advertisement",
		};
	}

	if (type === MESHCORE_PAYLOAD_TYPE.trace) {
		// TRACE v1 begins with tag[4], auth[4], and flags[1].
		if (payloadLength < 9) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`TRACE needs tag[4] auth[4] flags[1], have ${payloadLength}`,
			);
			return MALFORMED;
		}
		const children = [
			node("Trace tag", cursor, 4, hex(readLe32(bytes, cursor), 4)),
			node("Auth code", cursor + 4, 4, hex(readLe32(bytes, cursor + 4), 4)),
			node("Flags", cursor + 8, 1, hex(bytes[cursor + 8], 1)),
		];
		if (payloadLength > 9) {
			children.push(
				node(
					"Path SNRs",
					cursor + 9,
					payloadLength - 9,
					`undecoded — ${payloadLength - 9} raw bytes`,
					[],
					"raw",
				),
			);
		}
		root.children.push(
			node("Trace", cursor, payloadLength, undefined, children),
		);
		return { result: "matched", state: "header-only", kind: "control" };
	}

	if (type === MESHCORE_PAYLOAD_TYPE.control) {
		root.children.push(
			node(
				"Control",
				cursor,
				payloadLength,
				`undecoded — ${payloadLength} raw bytes`,
				[],
				"raw",
			),
		);
		return { result: "matched", state: "header-only", kind: "control" };
	}

	if (type >= 12 && type <= 14) {
		// Values 12..14 are reserved in the published v1 wire format.
		root.children.push(
			node(
				`Reserved payload type ${type}`,
				cursor,
				payloadLength,
				`undecoded — ${payloadLength} raw bytes (reserved in v1)`,
				[],
				"raw",
			),
		);
		return { result: "matched", state: "header-only", kind: "unknown" };
	}

	if (isDirectEncryptedType(type)) {
		if (payloadLength < 20 || (payloadLength - 4) % 16 !== 0) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`${label} needs 4 bytes + whole cipher blocks (≥ 20 total), have ${payloadLength}`,
			);
			return MALFORMED;
		}
		fields.encrypted = true;
		const destHash = bytes[cursor];
		const srcHash = bytes[cursor + 1];
		const mac = readLe16(bytes, cursor + 2);
		const children = [
			node("Destination hash", cursor, 1, hex(destHash, 1)),
			node("Source hash", cursor + 1, 1, hex(srcHash, 1)),
			node("MAC", cursor + 2, 2, hex(mac, 2)),
			node(
				"Ciphertext",
				cursor + 4,
				payloadLength - 4,
				`encrypted payload — ${payloadLength - 4} bytes (end-to-end key not held)`,
				[],
				"encrypted",
			),
		];
		root.children.push(
			node(
				label.charAt(0) + label.slice(1).toLowerCase(),
				cursor,
				payloadLength,
				undefined,
				children,
			),
		);
		return {
			result: "matched",
			state: "header-only",
			kind: "encrypted-payload",
		};
	}

	if (
		type === MESHCORE_PAYLOAD_TYPE.groupText ||
		type === MESHCORE_PAYLOAD_TYPE.groupData
	) {
		if (payloadLength < 19 || (payloadLength - 3) % 16 !== 0) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`${label} needs channel hash + MAC + whole cipher blocks (≥ 19 total), have ${payloadLength}`,
			);
			return MALFORMED;
		}
		fields.channelHash = bytes[cursor];
		fields.encrypted = true;
		const mac = readLe16(bytes, cursor + 1);
		root.children.push(
			node(
				label === "GROUP TEXT" ? "Group text" : "Group data",
				cursor,
				payloadLength,
				undefined,
				[
					node("Channel hash", cursor, 1, hex(bytes[cursor], 1)),
					node("MAC", cursor + 1, 2, hex(mac, 2)),
					node(
						"Ciphertext",
						cursor + 3,
						payloadLength - 3,
						`encrypted payload — ${payloadLength - 3} bytes (channel key not held)`,
						[],
						"encrypted",
					),
				],
			),
		);
		return {
			result: "matched",
			state: "header-only",
			kind: "encrypted-payload",
		};
	}

	if (type === MESHCORE_PAYLOAD_TYPE.anonymousRequest) {
		if (payloadLength < 51 || (payloadLength - 35) % 16 !== 0) {
			errorNode(
				root,
				cursor,
				payloadLength,
				`ANONYMOUS REQUEST needs 35 bytes + whole cipher blocks (≥ 51 total), have ${payloadLength}`,
			);
			return MALFORMED;
		}
		fields.encrypted = true;
		root.children.push(
			node(
				"Anonymous request",
				cursor,
				payloadLength,
				`encrypted payload — ${payloadLength} bytes (ephemeral key exchange; not decodable)`,
				[],
				"encrypted",
			),
		);
		return {
			result: "matched",
			state: "header-only",
			kind: "encrypted-payload",
		};
	}

	// Multipart (10) and RawCustom (15): bytes are present but v1 publishes no
	// structure for them.
	root.children.push(
		node(
			type === MESHCORE_PAYLOAD_TYPE.rawCustom
				? "Raw custom payload"
				: "Multipart payload",
			cursor,
			payloadLength,
			`undecoded — ${payloadLength} raw bytes`,
			[],
			"raw",
		),
	);
	return { result: "matched", state: "header-only", kind: "data" };
}

/**
 * Dissect one MeshCore frame. The caller (registry.ts) is responsible for
 * profile gating, exactly as the firmware restricts this decoder to profiles
 * with a MeshCore protocol hint.
 */
export function dissectMeshCore(
	bytes: Uint8Array,
	opts: DissectOptions = {},
): MeshCoreDissection {
	const n = bytes.length;
	const root = node("MeshCore", 0, n);

	if (n < 1) {
		errorNode(root, 0, 0, "empty frame — needs at least the 1-byte header");
		return finish(root, null, MALFORMED);
	}

	const header = bytes[0];
	const route = header & 0x03;
	const type = (header >>> 2) & 0x0f;
	const version = (header >>> 6) & 0x03;

	const fields: MeshCoreFields = {
		header,
		routeType: route,
		payloadType: type,
		payloadVersion: version,
		transportCodeOne: null,
		transportCodeTwo: null,
		encodedPathLength: null,
		pathHashCount: null,
		pathHashSize: null,
		payloadOffset: 0,
		payloadLength: n,
		acknowledgementChecksum: null,
		channelHash: null,
		encrypted: false,
	};

	root.children.push(
		node("Header", 0, 1, hex(header, 1), [
			node("Route type", 0, 1, `${route} (${ROUTE_LABEL[route]})`),
			node(
				"Payload type",
				0,
				1,
				`${type} (${PAYLOAD_TYPE_LABEL[type] ?? type})`,
			),
			node("Payload version", 0, 1, `${version} (v${version + 1})`),
		]),
	);

	// Only payload version 1 (encoded as zero) has a published layout.
	if (version !== 0) {
		root.children.push(
			node(
				"Unpublished payload version",
				1,
				n - 1,
				`undecoded — v${version + 1} layout is not published; ${n - 1} raw bytes`,
				[],
				"opaque",
			),
		);
		if (opts.truncated) {
			errorNode(root, n, 0, "the radio cut this frame short");
			return finish(root, fields, MALFORMED);
		}
		return finish(root, fields, {
			result: "matched",
			state: "header-only",
			kind: "unknown",
		});
	}

	let cursor = 1;
	if (routeHasTransportCodes(route)) {
		if (n - cursor < 4) {
			errorNode(
				root,
				cursor,
				n - cursor,
				"transport route needs two 2-byte transport codes",
			);
			return finish(root, fields, MALFORMED);
		}
		fields.transportCodeOne = readLe16(bytes, cursor);
		fields.transportCodeTwo = readLe16(bytes, cursor + 2);
		root.children.push(
			node("Transport codes", cursor, 4, undefined, [
				node("Transport code 1", cursor, 2, hex(fields.transportCodeOne, 2)),
				node(
					"Transport code 2",
					cursor + 2,
					2,
					hex(fields.transportCodeTwo, 2),
				),
			]),
		);
		cursor += 4;
	}

	if (cursor >= n) {
		errorNode(root, cursor, 0, "frame ends before the path-length byte");
		return finish(root, fields, MALFORMED);
	}

	const encodedPathLength = bytes[cursor];
	const pathLengthOffset = cursor;
	cursor += 1;
	const pathHashCount = encodedPathLength & 0x3f;
	const pathHashSize = (encodedPathLength >>> 6) + 1;
	const pathBytes = pathHashCount * pathHashSize;
	fields.encodedPathLength = encodedPathLength;
	fields.pathHashCount = pathHashCount;
	fields.pathHashSize = pathHashSize;

	root.children.push(
		node("Path length", pathLengthOffset, 1, hex(encodedPathLength, 1), [
			node("Hop hash count", pathLengthOffset, 1, String(pathHashCount)),
			node("Hop hash size", pathLengthOffset, 1, `${pathHashSize} byte(s)`),
		]),
	);

	if (
		pathHashSize === 4 ||
		pathBytes > MESHCORE_MAX_PATH_BYTES ||
		pathBytes > n - cursor
	) {
		errorNode(
			root,
			pathLengthOffset,
			1,
			pathHashSize === 4
				? "4-byte hop hashes are not valid in v1"
				: `path claims ${pathBytes} bytes (max ${MESHCORE_MAX_PATH_BYTES}, ${n - cursor} available)`,
		);
		return finish(root, fields, MALFORMED);
	}

	if (pathBytes > 0) {
		const hashes: DissectNode[] = [];
		for (let i = 0; i < pathHashCount; i++) {
			const at = cursor + i * pathHashSize;
			hashes.push(
				node(
					`Hop hash ${i}`,
					at,
					pathHashSize,
					`0x${hexBytes(bytes, at, pathHashSize)}`,
				),
			);
		}
		root.children.push(
			node("Path", cursor, pathBytes, `${pathHashCount} hop hash(es)`, hashes),
		);
	}
	cursor += pathBytes;

	// Dispatcher::tryParsePacket accepts a zero-length remainder, and
	// Mesh::createRawData can emit one — but only for RAW_CUSTOM.
	if (cursor === n && type !== MESHCORE_PAYLOAD_TYPE.rawCustom) {
		errorNode(
			root,
			cursor,
			0,
			"empty payload is only valid for RAW CUSTOM frames",
		);
		return finish(root, fields, MALFORMED);
	}

	const payloadLength = n - cursor;
	if (payloadLength > MESHCORE_MAX_PAYLOAD_BYTES) {
		errorNode(
			root,
			cursor,
			payloadLength,
			`payload of ${payloadLength} bytes exceeds the v1 maximum of ${MESHCORE_MAX_PAYLOAD_BYTES}`,
		);
		return finish(root, fields, MALFORMED);
	}
	fields.payloadOffset = cursor;
	fields.payloadLength = payloadLength;

	const outcome = dissectPayload(bytes, root, fields);
	if (outcome.result === "malformed") {
		return finish(root, fields, MALFORMED);
	}
	if (opts.truncated) {
		errorNode(root, n, 0, "the radio cut this frame short");
		return finish(root, fields, MALFORMED);
	}
	return finish(root, fields, outcome);
}
