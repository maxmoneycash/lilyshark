/**
 * Meshtastic structural dissector.
 *
 * Ports the firmware decoders byte for byte:
 * - src/core/meshtastic_decoder.cpp — the 16-byte outer radio header
 *   (verified there against meshtastic/firmware RadioInterface.h at commit
 *   34680833b88b37bbcffca0b31dffe45f29e9d35c);
 * - src/core/meshtastic_payload.cpp — the default-key payload reader.
 *
 * The payload reader applies the *published* default channel PSK that every
 * Meshtastic radio ships with, then any user-supplied channel keys (UI-011),
 * in order. Success under the default key proves the traffic was never
 * private; success under a user key is labeled with that key's name and
 * claims nothing more. Failure leaves the payload opaque, which is the
 * honest outcome for an unknown PSK — the outer header cannot prove whether
 * protobuf bytes are encrypted at all (an empty/zero PSK sends them in
 * cleartext).
 */

import type {
	ChannelKey,
	DecodeState,
	Dissection,
	DissectNode,
	DissectOptions,
	PacketKind,
} from "./types";
import { hex, node, readLe32 } from "./types";

export const MESHTASTIC_OUTER_HEADER_LENGTH = 16;

/** Flag-byte masks, meshtastic_decoder.cpp. */
export const MESHTASTIC_FLAG = {
	hopLimitMask: 0x07,
	wantAck: 0x08,
	viaMqtt: 0x10,
	hopStartMask: 0xe0,
	hopStartShift: 5,
} as const;

/**
 * The published default channel key shipped in every Meshtastic device
 * (include/lilyshark/protocols/meshtastic_payload.h, kMeshtasticDefaultPsk).
 */
export const MESHTASTIC_DEFAULT_PSK = Uint8Array.from([
	0xd4, 0xf1, 0xbb, 0x3a, 0x20, 0x29, 0x07, 0x59, 0xf0, 0xbc, 0xff, 0xab, 0xcf,
	0x4e, 0x69, 0x01,
]);

/** Port numbers this build names — MeshtasticPort in meshtastic_payload.h. */
export const MESHTASTIC_PORT = {
	textMessage: 1,
	position: 3,
	nodeInfo: 4,
	routing: 5,
	telemetry: 67,
	traceroute: 70,
	neighborinfo: 71,
} as const;

export const MESHTASTIC_MAX_TEXT_BYTES = 200;

/** Short label for a port number — meshtasticPortLabel in the firmware. */
export function meshtasticPortLabel(portnum: number): string {
	switch (portnum) {
		case MESHTASTIC_PORT.textMessage:
			return "TEXT";
		case MESHTASTIC_PORT.position:
			return "POSITION";
		case MESHTASTIC_PORT.nodeInfo:
			return "NODEINFO";
		case MESHTASTIC_PORT.routing:
			return "ROUTING";
		case MESHTASTIC_PORT.telemetry:
			return "TELEMETRY";
		case MESHTASTIC_PORT.traceroute:
			return "TRACEROUTE";
		case MESHTASTIC_PORT.neighborinfo:
			return "NEIGHBORINFO";
		default:
			return `PORT ${portnum}`;
	}
}

/* ────────────────────────────────────────────────────────────────────────────
 * AES counter mode — port of src/crypto/aes128.cpp.
 *
 * Encryption direction only: counter mode uses the forward cipher for both
 * encrypting and decrypting. Checked against the same FIPS-197 vector the
 * firmware pins in test/meshtastic_payload/test_meshtastic_payload.cpp.
 *
 * The firmware ships AES-128 only (kAes128KeySize); this port additionally
 * accepts 32-byte keys (14-round AES-256, the size Meshtastic uses for
 * non-default channel PSKs) so user-supplied channel keys of either size can
 * be tried in the browser. The 256-bit schedule follows FIPS-197 and is
 * pinned against its Appendix C vectors in meshtasticCrypto.test.ts.
 * ──────────────────────────────────────────────────────────────────────── */

const SBOX = new Uint8Array(256);
const RCON = new Uint8Array(11);
{
	// Generate the S-box the standard way (multiplicative inverse in GF(2^8)
	// followed by the affine transform) instead of shipping a 256-entry table.
	let p = 1;
	let q = 1;
	const sbox = SBOX;
	sbox[0] = 0x63;
	do {
		// p := p * 3, q := q / 3 in GF(2^8)
		p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
		q ^= q << 1;
		q ^= q << 2;
		q ^= q << 4;
		q &= 0xff;
		if (q & 0x80) q ^= 0x09;
		sbox[p] =
			(q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
	} while (p !== 1);

	let rc = 1;
	for (let i = 1; i <= 10; i++) {
		RCON[i] = rc;
		rc = (rc << 1) ^ (rc & 0x80 ? 0x11b : 0);
		rc &= 0xff;
	}
}

function rotl8(x: number, shift: number): number {
	return ((x << shift) | (x >> (8 - shift))) & 0xff;
}

function xtime(x: number): number {
	return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
}

interface KeySchedule {
	rk: Uint8Array;
	rounds: number;
}

/** FIPS-197 key expansion: 16-byte key → 10 rounds, 32-byte key → 14. */
function expandKey(key: Uint8Array): KeySchedule {
	const nk = key.length; // 16 or 32, validated by aesCtrXcrypt
	const rounds = nk / 4 + 6;
	const rk = new Uint8Array(16 * (rounds + 1));
	rk.set(key);
	for (let i = nk; i < rk.length; i += 4) {
		let t0 = rk[i - 4];
		let t1 = rk[i - 3];
		let t2 = rk[i - 2];
		let t3 = rk[i - 1];
		if (i % nk === 0) {
			const tmp = t0;
			t0 = SBOX[t1] ^ RCON[i / nk];
			t1 = SBOX[t2];
			t2 = SBOX[t3];
			t3 = SBOX[tmp];
		} else if (nk === 32 && i % nk === 16) {
			// AES-256 only: an extra SubWord halfway through each key block.
			t0 = SBOX[t0];
			t1 = SBOX[t1];
			t2 = SBOX[t2];
			t3 = SBOX[t3];
		}
		rk[i] = rk[i - nk] ^ t0;
		rk[i + 1] = rk[i - nk + 1] ^ t1;
		rk[i + 2] = rk[i - nk + 2] ^ t2;
		rk[i + 3] = rk[i - nk + 3] ^ t3;
	}
	return { rk, rounds };
}

function encryptBlock(rk: Uint8Array, rounds: number, block: Uint8Array): void {
	const s = block;
	for (let i = 0; i < 16; i++) s[i] ^= rk[i];
	for (let round = 1; round <= rounds; round++) {
		// SubBytes
		for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
		// ShiftRows
		let t = s[1];
		s[1] = s[5];
		s[5] = s[9];
		s[9] = s[13];
		s[13] = t;
		t = s[2];
		s[2] = s[10];
		s[10] = t;
		t = s[6];
		s[6] = s[14];
		s[14] = t;
		t = s[3];
		s[3] = s[15];
		s[15] = s[11];
		s[11] = s[7];
		s[7] = t;
		// MixColumns (skipped in the final round)
		if (round < rounds) {
			for (let c = 0; c < 16; c += 4) {
				const a0 = s[c];
				const a1 = s[c + 1];
				const a2 = s[c + 2];
				const a3 = s[c + 3];
				const all = a0 ^ a1 ^ a2 ^ a3;
				s[c] = (a0 ^ all ^ xtime(a0 ^ a1)) & 0xff;
				s[c + 1] = (a1 ^ all ^ xtime(a1 ^ a2)) & 0xff;
				s[c + 2] = (a2 ^ all ^ xtime(a2 ^ a3)) & 0xff;
				s[c + 3] = (a3 ^ all ^ xtime(a3 ^ a0)) & 0xff;
			}
		}
		// AddRoundKey
		for (let i = 0; i < 16; i++) s[i] ^= rk[round * 16 + i];
	}
}

/**
 * AES-CTR over `input` with a 16- or 32-byte key (AES-128 / AES-256).
 * Symmetric — the same call decrypts. Only the last `counterBytes` bytes of
 * the IV advance (big-endian), matching Meshtastic's CTR<AESxxx> with its
 * 4-byte counter (crypto::aesCtrXcrypt in the firmware).
 */
export function aesCtrXcrypt(
	key: Uint8Array,
	iv: Uint8Array,
	input: Uint8Array,
	counterBytes = 4,
): Uint8Array {
	if (key.length !== 16 && key.length !== 32) {
		throw new RangeError(`AES key must be 16 or 32 bytes, got ${key.length}`);
	}
	const { rk, rounds } = expandKey(key);
	const counter = Uint8Array.from(iv);
	const keystream = new Uint8Array(16);
	const output = new Uint8Array(input.length);
	for (let offset = 0; offset < input.length; offset += 16) {
		keystream.set(counter);
		encryptBlock(rk, rounds, keystream);
		const chunk = Math.min(16, input.length - offset);
		for (let i = 0; i < chunk; i++)
			output[offset + i] = input[offset + i] ^ keystream[i];
		for (let step = 0; step < counterBytes; step++) {
			const index = 15 - step;
			counter[index] = (counter[index] + 1) & 0xff;
			if (counter[index] !== 0) break;
		}
	}
	return output;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Default-key payload reader — port of readMeshtasticPayload.
 * ──────────────────────────────────────────────────────────────────────── */

/** Largest ciphertext worth attempting (kMaxCiphertext in the firmware). */
const MAX_CIPHERTEXT = 256;

const WIRE_VARINT = 0;
const WIRE_64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32 = 5;

export interface MeshtasticDeviceMetrics {
	batteryLevel: number | null;
	voltage: number | null;
	channelUtilization: number | null;
	airUtilTx: number | null;
	uptimeSeconds: number | null;
}

export interface MeshtasticEnvironmentMetrics {
	temperature: number | null;
	relativeHumidity: number | null;
	barometricPressure: number | null;
	gasResistance: number | null;
	voltage: number | null;
	current: number | null;
	iaq: number | null;
}

export interface MeshtasticTelemetryFields {
	time: number | null;
	deviceMetrics: MeshtasticDeviceMetrics | null;
	environmentMetrics: MeshtasticEnvironmentMetrics | null;
}

export interface MeshtasticRouteHop {
	nodeNum: number;
	nodeHex: string;
	snrDb: number | null;
	rawSnr: number | null;
}

export interface MeshtasticRouteDiscoveryFields {
	route: number[];
	snrTowards: number[];
	routeBack: number[];
	snrBack: number[];
	towardsHops: MeshtasticRouteHop[];
	backHops: MeshtasticRouteHop[];
}

export const MESHTASTIC_ROUTING_ERROR: Record<number, string> = {
	0: "NONE",
	1: "NO_ROUTE",
	2: "GOT_NAK",
	3: "TIMEOUT",
	4: "NO_INTERFACE",
	5: "MAX_RETRANSMIT",
	6: "NO_CHANNEL",
	7: "TOO_LARGE",
	8: "NO_RESPONSE",
	9: "DUTY_CYCLE_LIMIT",
	32: "BAD_REQUEST",
	33: "NOT_AUTHORIZED",
	34: "PKI_FAILED",
	35: "PKI_UNKNOWN_PUBKEY",
	36: "ADMIN_BAD_SESSION_KEY",
	37: "ADMIN_PUBLIC_KEY_UNAUTHORIZED",
	38: "RATE_LIMIT_EXCEEDED",
	39: "PKI_SEND_FAIL_PUBLIC_KEY",
};

export interface MeshtasticRoutingFields {
	errorReason: number | null;
	errorName: string | null;
	routeRequest: MeshtasticRouteDiscoveryFields | null;
	routeReply: MeshtasticRouteDiscoveryFields | null;
}

export interface MeshtasticNeighbor {
	nodeId: number;
	nodeHex: string;
	snrDb: number | null;
	lastRxTime: number | null;
	broadcastIntervalSecs: number | null;
}

export interface MeshtasticNeighborInfoFields {
	nodeId: number;
	nodeHex: string;
	lastSentById: number | null;
	lastSentByHex: string | null;
	broadcastIntervalSecs: number | null;
	neighbors: MeshtasticNeighbor[];
}

export interface MeshtasticPayloadFields {
	portnum: number;
	portLabel: string;
	/** Length of the application payload inside the Data message. */
	payloadLength: number;
	text: string | null;
	latitudeDegrees: number | null;
	longitudeDegrees: number | null;
	longName: string | null;
	shortName: string | null;
	requestId?: number | null;
	telemetry?: MeshtasticTelemetryFields | null;
	routeDiscovery?: MeshtasticRouteDiscoveryFields | null;
	routing?: MeshtasticRoutingFields | null;
	neighborInfo?: MeshtasticNeighborInfoFields | null;
}

/** A decoded region, tracked so tree nodes can point into the ciphertext. */
interface Span {
	offset: number;
	length: number;
}

/**
 * Which key produced a readable plaintext. The default PSK proves the
 * traffic was never private; a user key proves only that the user knew the
 * channel's secret, so labels must name the key and nothing more.
 */
export type MeshtasticDecryptSource =
	| { kind: "default" }
	| { kind: "user"; name: string; bits: 128 | 256 };

interface PayloadParse {
	fields: MeshtasticPayloadFields;
	plain: Uint8Array;
	source: MeshtasticDecryptSource;
	portnumSpan: Span;
	payloadSpan: Span | null;
	latitudeSpan: Span | null;
	longitudeSpan: Span | null;
	longNameSpan: Span | null;
	shortNameSpan: Span | null;
	requestIdSpan: Span | null;
	telemetryNodes: DissectNode[] | null;
	routeDiscoveryNodes: DissectNode[] | null;
	routingNodes: DissectNode[] | null;
	neighborInfoNodes: DissectNode[] | null;
}

interface VarintResult {
	value: number;
	next: number;
}

/** Base-128 varint; reads up to 10 bytes (standard protobuf max). */
function readVarint(
	bytes: Uint8Array,
	length: number,
	cursor: number,
): VarintResult | null {
	let result = 0;
	let shift = 0;
	let at = cursor;
	let count = 0;
	while (at < length && count < 10) {
		const byte = bytes[at++];
		count++;
		if (shift < 32) {
			result = (result | ((byte & 0x7f) << shift)) >>> 0;
		}
		shift += 7;
		if ((byte & 0x80) === 0) return { value: result, next: at };
	}
	return null;
}

/** Signed base-128 varint for protobuf int32 (e.g. SNR measurements). */
function readSignedVarint(
	bytes: Uint8Array,
	length: number,
	cursor: number,
): VarintResult | null {
	let result = 0;
	let shift = 0;
	let at = cursor;
	let count = 0;
	while (at < length && count < 10) {
		const byte = bytes[at++];
		count++;
		if (shift < 32) {
			result |= (byte & 0x7f) << shift;
		}
		shift += 7;
		if ((byte & 0x80) === 0) {
			return { value: result | 0, next: at };
		}
	}
	return null;
}

/** Read a 32-bit IEEE 754 little-endian floating point value. */
function readFloat32(bytes: Uint8Array, offset: number): number {
	const buf = new Uint8Array(4);
	buf.set(bytes.subarray(offset, offset + 4));
	return new DataView(buf.buffer).getFloat32(0, true);
}

/** Recursively adjust all byte offsets in a dissection tree branch. */
function offsetTree(n: DissectNode, delta: number): DissectNode {
	return {
		...n,
		byteOffset: n.byteOffset + delta,
		children: n.children.map((c) => offsetTree(c, delta)),
	};
}

function skipField(
	bytes: Uint8Array,
	length: number,
	cursor: number,
	wire: number,
): number | null {
	if (wire === WIRE_VARINT) {
		const v = readVarint(bytes, length, cursor);
		return v ? v.next : null;
	}
	if (wire === WIRE_64) return cursor + 8 <= length ? cursor + 8 : null;
	if (wire === WIRE_LENGTH_DELIMITED) {
		const size = readVarint(bytes, length, cursor);
		if (!size || size.value > length - size.next) return null;
		return size.next + size.value;
	}
	if (wire === WIRE_32) return cursor + 4 <= length ? cursor + 4 : null;
	return null;
}

function meshtasticDegrees(raw: number): number {
	return (raw | 0) * 1e-7; // interpret as signed 32-bit
}

interface PositionParse {
	latitude: number;
	longitude: number;
	latitudeSpan: Span;
	longitudeSpan: Span;
}

/** parsePosition: fixed32 latitude_i (field 1) and longitude_i (field 2). */
function parsePosition(
	bytes: Uint8Array,
	base: number,
	length: number,
): PositionParse | null {
	let cursor = base;
	const end = base + length;
	let lat: { value: number; span: Span } | null = null;
	let lon: { value: number; span: Span } | null = null;
	while (cursor < end) {
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if ((field === 1 || field === 2) && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			const value = readLe32(bytes, tag.next);
			const entry = { value, span: { offset: tag.next, length: 4 } };
			if (field === 1) lat = entry;
			else lon = entry;
			cursor = tag.next + 4;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}
	if (!lat || !lon) return null;
	return {
		latitude: meshtasticDegrees(lat.value),
		longitude: meshtasticDegrees(lon.value),
		latitudeSpan: lat.span,
		longitudeSpan: lon.span,
	};
}

/**
 * copyName: accept only printable ASCII, bounded like the firmware's char
 * arrays (long 39 + NUL, short 7 + NUL). Returns null for empty or
 * non-printable names. Unlike the C++ (which can leave a partial copy behind
 * before detecting a bad byte), a rejected name is dropped entirely.
 */
function readName(
	bytes: Uint8Array,
	offset: number,
	length: number,
	cap: number,
): string | null {
	const n = Math.min(length, cap - 1);
	let out = "";
	for (let i = 0; i < n; i++) {
		const byte = bytes[offset + i];
		if (byte < 0x20 || byte >= 0x7f) return null;
		out += String.fromCharCode(byte);
	}
	return out.length > 0 ? out : null;
}

interface UserParse {
	longName: string | null;
	shortName: string | null;
	longNameSpan: Span | null;
	shortNameSpan: Span | null;
}

/** parseUser: long_name (field 2) and short_name (field 3). */
function parseUser(
	bytes: Uint8Array,
	base: number,
	length: number,
): UserParse | null {
	let cursor = base;
	const end = base + length;
	const out: UserParse = {
		longName: null,
		shortName: null,
		longNameSpan: null,
		shortNameSpan: null,
	};
	while (cursor < end) {
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			if (field === 2) {
				out.longName = readName(bytes, size.next, size.value, 40);
				if (out.longName !== null)
					out.longNameSpan = { offset: size.next, length: size.value };
			} else if (field === 3) {
				out.shortName = readName(bytes, size.next, size.value, 8);
				if (out.shortName !== null)
					out.shortNameSpan = { offset: size.next, length: size.value };
			}
			cursor = size.next + size.value;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}
	return out;
}

interface NodeInfoParse {
	user: UserParse | null;
	position: PositionParse | null;
}

/** parseNodeInfo: User (field 2) and Position (field 4). */
function parseNodeInfo(
	bytes: Uint8Array,
	base: number,
	length: number,
): NodeInfoParse {
	let cursor = base;
	const end = base + length;
	const out: NodeInfoParse = { user: null, position: null };
	while (cursor < end) {
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return out;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return out;
			// Failures inside sub-messages are non-fatal, as in the firmware.
			if (field === 2) out.user = parseUser(bytes, size.next, size.value);
			else if (field === 4)
				out.position = parsePosition(bytes, size.next, size.value);
			cursor = size.next + size.value;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return out;
			cursor = next;
		}
	}
	return out;
}

/** True when the bytes are plausible message text (looksLikeText). */
function looksLikeText(
	bytes: Uint8Array,
	offset: number,
	length: number,
): boolean {
	if (length === 0) return false;
	for (let i = 0; i < length; i++) {
		const byte = bytes[offset + i];
		const printable = byte >= 0x20 && byte < 0x7f;
		const whitespace = byte === 0x0a || byte === 0x0d || byte === 0x09;
		const utf8 = byte >= 0x80;
		if (!printable && !whitespace && !utf8) return false;
	}
	return true;
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

function decodeText(bytes: Uint8Array, offset: number, length: number): string {
	return utf8.decode(bytes.subarray(offset, offset + length));
}

interface TelemetryParse {
	fields: MeshtasticTelemetryFields;
	nodes: DissectNode[];
}

function parseDeviceMetrics(
	bytes: Uint8Array,
	base: number,
	length: number,
): { fields: MeshtasticDeviceMetrics; nodes: DissectNode[] } | null {
	let cursor = base;
	const end = base + length;
	const fields: MeshtasticDeviceMetrics = {
		batteryLevel: null,
		voltage: null,
		channelUtilization: null,
		airUtilTx: null,
		uptimeSeconds: null,
	};
	const nodes: DissectNode[] = [];
	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (field === 1 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			fields.batteryLevel = val.value > 100 ? 100 : val.value;
			nodes.push(
				node(
					"Battery level",
					tagStart,
					val.next - tagStart,
					`${fields.batteryLevel}%${val.value > 100 ? " (externally powered)" : ""}`,
				),
			);
			cursor = val.next;
		} else if (field === 2 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.voltage = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Voltage",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.voltage.toFixed(2)} V`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 3 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.channelUtilization = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Channel utilization",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.channelUtilization.toFixed(2)}%`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 4 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.airUtilTx = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Air transmit utilization",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.airUtilTx.toFixed(2)}%`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 5 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			fields.uptimeSeconds = val.value;
			nodes.push(
				node(
					"Uptime",
					tagStart,
					val.next - tagStart,
					`${fields.uptimeSeconds.toLocaleString()} s`,
				),
			);
			cursor = val.next;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}
	return { fields, nodes };
}

function parseEnvironmentMetrics(
	bytes: Uint8Array,
	base: number,
	length: number,
): { fields: MeshtasticEnvironmentMetrics; nodes: DissectNode[] } | null {
	let cursor = base;
	const end = base + length;
	const fields: MeshtasticEnvironmentMetrics = {
		temperature: null,
		relativeHumidity: null,
		barometricPressure: null,
		gasResistance: null,
		voltage: null,
		current: null,
		iaq: null,
	};
	const nodes: DissectNode[] = [];
	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (field === 1 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.temperature = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Temperature",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.temperature.toFixed(2)} °C`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 2 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.relativeHumidity = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Relative humidity",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.relativeHumidity.toFixed(2)}%`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 3 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.barometricPressure = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Barometric pressure",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.barometricPressure.toFixed(2)} hPa`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 4 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.gasResistance = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Gas resistance",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.gasResistance.toFixed(2)} MΩ`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 5 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.voltage = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Sensor voltage",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.voltage.toFixed(2)} V`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 6 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			fields.current = readFloat32(bytes, tag.next);
			nodes.push(
				node(
					"Sensor current",
					tagStart,
					tag.next + 4 - tagStart,
					`${fields.current.toFixed(2)} mA`,
				),
			);
			cursor = tag.next + 4;
		} else if (field === 7 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			fields.iaq = val.value;
			nodes.push(node("IAQ", tagStart, val.next - tagStart, `${fields.iaq}`));
			cursor = val.next;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}
	return { fields, nodes };
}

function parseTelemetry(
	bytes: Uint8Array,
	base: number,
	length: number,
): TelemetryParse | null {
	let cursor = base;
	const end = base + length;
	const fields: MeshtasticTelemetryFields = {
		time: null,
		deviceMetrics: null,
		environmentMetrics: null,
	};
	const nodes: DissectNode[] = [];
	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (field === 1 && (wire === WIRE_32 || wire === WIRE_VARINT)) {
			let timeVal: number;
			let fieldLen: number;
			if (wire === WIRE_32) {
				if (tag.next + 4 > end) return null;
				timeVal = readLe32(bytes, tag.next);
				fieldLen = tag.next + 4 - tagStart;
				cursor = tag.next + 4;
			} else {
				const val = readVarint(bytes, end, tag.next);
				if (!val) return null;
				timeVal = val.value;
				fieldLen = val.next - tagStart;
				cursor = val.next;
			}
			fields.time = timeVal;
			const dateStr =
				timeVal > 0 ? new Date(timeVal * 1000).toISOString() : "unknown";
			nodes.push(node("Time", tagStart, fieldLen, `${timeVal} (${dateStr})`));
		} else if (field === 2 && wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			const dev = parseDeviceMetrics(bytes, size.next, size.value);
			if (dev) {
				fields.deviceMetrics = dev.fields;
				nodes.push(
					node(
						"Device metrics",
						tagStart,
						size.next + size.value - tagStart,
						`${size.value} bytes`,
						dev.nodes,
					),
				);
			}
			cursor = size.next + size.value;
		} else if (field === 3 && wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			const env = parseEnvironmentMetrics(bytes, size.next, size.value);
			if (env) {
				fields.environmentMetrics = env.fields;
				nodes.push(
					node(
						"Environment metrics",
						tagStart,
						size.next + size.value - tagStart,
						`${size.value} bytes`,
						env.nodes,
					),
				);
			}
			cursor = size.next + size.value;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}
	return { fields, nodes };
}

interface RouteDiscoveryParse {
	fields: MeshtasticRouteDiscoveryFields;
	nodes: DissectNode[];
}

function parseRouteDiscovery(
	bytes: Uint8Array,
	base: number,
	length: number,
): RouteDiscoveryParse | null {
	let cursor = base;
	const end = base + length;
	const route: number[] = [];
	const snrTowards: number[] = [];
	const routeBack: number[] = [];
	const snrBack: number[] = [];
	const towardsSpans: Span[] = [];
	const backSpans: Span[] = [];

	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;

		if (field === 1) {
			if (wire === WIRE_32) {
				if (tag.next + 4 > end) return null;
				const val = readLe32(bytes, tag.next);
				route.push(val);
				towardsSpans.push({
					offset: tagStart,
					length: tag.next + 4 - tagStart,
				});
				cursor = tag.next + 4;
			} else if (wire === WIRE_LENGTH_DELIMITED) {
				const size = readVarint(bytes, end, tag.next);
				if (!size || size.value > end - size.next) return null;
				for (let off = size.next; off + 4 <= size.next + size.value; off += 4) {
					route.push(readLe32(bytes, off));
					towardsSpans.push({ offset: off, length: 4 });
				}
				cursor = size.next + size.value;
			} else {
				return null;
			}
		} else if (field === 2) {
			if (wire === WIRE_VARINT) {
				const val = readSignedVarint(bytes, end, tag.next);
				if (!val) return null;
				snrTowards.push(val.value);
				cursor = val.next;
			} else if (wire === WIRE_LENGTH_DELIMITED) {
				const size = readVarint(bytes, end, tag.next);
				if (!size || size.value > end - size.next) return null;
				let at = size.next;
				const packEnd = size.next + size.value;
				while (at < packEnd) {
					const val = readSignedVarint(bytes, packEnd, at);
					if (!val) return null;
					snrTowards.push(val.value);
					at = val.next;
				}
				cursor = packEnd;
			} else {
				return null;
			}
		} else if (field === 3) {
			if (wire === WIRE_32) {
				if (tag.next + 4 > end) return null;
				const val = readLe32(bytes, tag.next);
				routeBack.push(val);
				backSpans.push({ offset: tagStart, length: tag.next + 4 - tagStart });
				cursor = tag.next + 4;
			} else if (wire === WIRE_LENGTH_DELIMITED) {
				const size = readVarint(bytes, end, tag.next);
				if (!size || size.value > end - size.next) return null;
				for (let off = size.next; off + 4 <= size.next + size.value; off += 4) {
					routeBack.push(readLe32(bytes, off));
					backSpans.push({ offset: off, length: 4 });
				}
				cursor = size.next + size.value;
			} else {
				return null;
			}
		} else if (field === 4) {
			if (wire === WIRE_VARINT) {
				const val = readSignedVarint(bytes, end, tag.next);
				if (!val) return null;
				snrBack.push(val.value);
				cursor = val.next;
			} else if (wire === WIRE_LENGTH_DELIMITED) {
				const size = readVarint(bytes, end, tag.next);
				if (!size || size.value > end - size.next) return null;
				let at = size.next;
				const packEnd = size.next + size.value;
				while (at < packEnd) {
					const val = readSignedVarint(bytes, packEnd, at);
					if (!val) return null;
					snrBack.push(val.value);
					at = val.next;
				}
				cursor = packEnd;
			} else {
				return null;
			}
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}

	const towardsHops: MeshtasticRouteHop[] = route.map((nodeNum, i) => {
		const rawSnr = snrTowards[i] !== undefined ? snrTowards[i] : null;
		const snrDb = rawSnr !== null ? rawSnr / 4 : null;
		const nodeHex = `!${nodeNum.toString(16).padStart(8, "0")}`;
		return { nodeNum, nodeHex, snrDb, rawSnr };
	});

	const backHops: MeshtasticRouteHop[] = routeBack.map((nodeNum, i) => {
		const rawSnr = snrBack[i] !== undefined ? snrBack[i] : null;
		const snrDb = rawSnr !== null ? rawSnr / 4 : null;
		const nodeHex = `!${nodeNum.toString(16).padStart(8, "0")}`;
		return { nodeNum, nodeHex, snrDb, rawSnr };
	});

	const nodes: DissectNode[] = [];
	towardsHops.forEach((hop, i) => {
		const span = towardsSpans[i] ?? { offset: base, length };
		const snrLabel =
			hop.snrDb !== null
				? ` (SNR: ${hop.snrDb > 0 ? "+" : ""}${hop.snrDb.toFixed(1)} dB)`
				: "";
		nodes.push(
			node(
				`Hop ${i + 1}`,
				span.offset,
				span.length,
				`${hop.nodeHex}${snrLabel}`,
			),
		);
	});
	backHops.forEach((hop, i) => {
		const span = backSpans[i] ?? { offset: base, length };
		const snrLabel =
			hop.snrDb !== null
				? ` (SNR: ${hop.snrDb > 0 ? "+" : ""}${hop.snrDb.toFixed(1)} dB)`
				: "";
		nodes.push(
			node(
				`Return hop ${i + 1}`,
				span.offset,
				span.length,
				`${hop.nodeHex}${snrLabel}`,
			),
		);
	});

	return {
		fields: {
			route,
			snrTowards,
			routeBack,
			snrBack,
			towardsHops,
			backHops,
		},
		nodes,
	};
}

interface RoutingParse {
	fields: MeshtasticRoutingFields;
	nodes: DissectNode[];
}

function parseRouting(
	bytes: Uint8Array,
	base: number,
	length: number,
): RoutingParse | null {
	let cursor = base;
	const end = base + length;
	const fields: MeshtasticRoutingFields = {
		errorReason: null,
		errorName: null,
		routeRequest: null,
		routeReply: null,
	};
	const nodes: DissectNode[] = [];

	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;

		if (field === 1 && wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			const rd = parseRouteDiscovery(bytes, size.next, size.value);
			if (rd) {
				fields.routeRequest = rd.fields;
				nodes.push(
					node(
						"Route request",
						tagStart,
						size.next + size.value - tagStart,
						`${rd.fields.route.length} hops`,
						rd.nodes,
					),
				);
			}
			cursor = size.next + size.value;
		} else if (field === 2 && wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			const rd = parseRouteDiscovery(bytes, size.next, size.value);
			if (rd) {
				fields.routeReply = rd.fields;
				nodes.push(
					node(
						"Route reply",
						tagStart,
						size.next + size.value - tagStart,
						`${rd.fields.route.length} hops`,
						rd.nodes,
					),
				);
			}
			cursor = size.next + size.value;
		} else if ((field === 3 || field === 1) && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			fields.errorReason = val.value;
			fields.errorName =
				MESHTASTIC_ROUTING_ERROR[val.value] ?? `ERROR_${val.value}`;
			nodes.push(
				node(
					"Routing error",
					tagStart,
					val.next - tagStart,
					`${fields.errorName} (${val.value})`,
					[],
					val.value === 0 ? undefined : "error",
				),
			);
			cursor = val.next;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}

	return { fields, nodes };
}

interface NeighborParse {
	fields: MeshtasticNeighbor;
	nodes: DissectNode[];
}

function parseNeighbor(
	bytes: Uint8Array,
	base: number,
	length: number,
): NeighborParse | null {
	let cursor = base;
	const end = base + length;
	let nodeId = 0;
	let snrDb: number | null = null;
	let lastRxTime: number | null = null;
	let broadcastIntervalSecs: number | null = null;
	const nodes: DissectNode[] = [];

	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;

		if (field === 1 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			nodeId = val.value >>> 0;
			const hexStr = `!${nodeId.toString(16).padStart(8, "0")}`;
			nodes.push(
				node("Node ID", tagStart, val.next - tagStart, `${nodeId} (${hexStr})`),
			);
			cursor = val.next;
		} else if (field === 2 && wire === WIRE_32) {
			if (tag.next + 4 > end) return null;
			const snr = readFloat32(bytes, tag.next);
			if (Number.isFinite(snr)) {
				snrDb = snr;
				nodes.push(
					node(
						"SNR",
						tagStart,
						tag.next + 4 - tagStart,
						`${snrDb > 0 ? "+" : ""}${snrDb.toFixed(2)} dB`,
					),
				);
			} else {
				nodes.push(
					node(
						"SNR",
						tagStart,
						tag.next + 4 - tagStart,
						"invalid float",
						[],
						"error",
					),
				);
			}
			cursor = tag.next + 4;
		} else if (field === 3 && (wire === WIRE_32 || wire === WIRE_VARINT)) {
			let timeVal: number;
			let fieldLen: number;
			if (wire === WIRE_32) {
				if (tag.next + 4 > end) return null;
				timeVal = readLe32(bytes, tag.next);
				fieldLen = tag.next + 4 - tagStart;
				cursor = tag.next + 4;
			} else {
				const val = readVarint(bytes, end, tag.next);
				if (!val) return null;
				timeVal = val.value >>> 0;
				fieldLen = val.next - tagStart;
				cursor = val.next;
			}
			lastRxTime = timeVal;
			const dateStr =
				timeVal > 0 ? new Date(timeVal * 1000).toISOString() : "none";
			nodes.push(
				node("Last RX time", tagStart, fieldLen, `${timeVal} (${dateStr})`),
			);
		} else if (field === 4 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			broadcastIntervalSecs = val.value >>> 0;
			nodes.push(
				node(
					"Broadcast interval",
					tagStart,
					val.next - tagStart,
					`${broadcastIntervalSecs} s`,
				),
			);
			cursor = val.next;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}

	const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
	return {
		fields: {
			nodeId,
			nodeHex,
			snrDb,
			lastRxTime,
			broadcastIntervalSecs,
		},
		nodes,
	};
}

interface NeighborInfoParse {
	fields: MeshtasticNeighborInfoFields;
	nodes: DissectNode[];
}

function parseNeighborInfo(
	bytes: Uint8Array,
	base: number,
	length: number,
): NeighborInfoParse | null {
	let cursor = base;
	const end = base + length;
	let nodeId = 0;
	let lastSentById: number | null = null;
	let broadcastIntervalSecs: number | null = null;
	const neighbors: MeshtasticNeighbor[] = [];
	const nodes: DissectNode[] = [];

	while (cursor < end) {
		const tagStart = cursor;
		const tag = readVarint(bytes, end, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;

		if (field === 1 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			nodeId = val.value >>> 0;
			const hexStr = `!${nodeId.toString(16).padStart(8, "0")}`;
			nodes.push(
				node(
					"Reporting node ID",
					tagStart,
					val.next - tagStart,
					`${nodeId} (${hexStr})`,
				),
			);
			cursor = val.next;
		} else if (field === 2 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			lastSentById = val.value >>> 0;
			const hexStr = `!${lastSentById.toString(16).padStart(8, "0")}`;
			nodes.push(
				node(
					"Last sent by ID",
					tagStart,
					val.next - tagStart,
					`${lastSentById} (${hexStr})`,
				),
			);
			cursor = val.next;
		} else if (field === 3 && wire === WIRE_VARINT) {
			const val = readVarint(bytes, end, tag.next);
			if (!val) return null;
			broadcastIntervalSecs = val.value >>> 0;
			nodes.push(
				node(
					"Broadcast interval",
					tagStart,
					val.next - tagStart,
					`${broadcastIntervalSecs} s`,
				),
			);
			cursor = val.next;
		} else if (field === 4 && wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(bytes, end, tag.next);
			if (!size || size.value > end - size.next) return null;
			const n = parseNeighbor(bytes, size.next, size.value);
			if (n) {
				neighbors.push(n.fields);
				const snrLabel =
					n.fields.snrDb !== null
						? ` · ${n.fields.snrDb > 0 ? "+" : ""}${n.fields.snrDb.toFixed(1)} dB`
						: "";
				nodes.push(
					node(
						`Neighbor ${neighbors.length}`,
						tagStart,
						size.next + size.value - tagStart,
						`${n.fields.nodeHex}${snrLabel}`,
						n.nodes,
					),
				);
			}
			cursor = size.next + size.value;
		} else {
			const next = skipField(bytes, end, tag.next, wire);
			if (next === null) return null;
			cursor = next;
		}
	}

	const nodeHex = `!${nodeId.toString(16).padStart(8, "0")}`;
	const lastSentByHex =
		lastSentById !== null
			? `!${lastSentById.toString(16).padStart(8, "0")}`
			: null;

	return {
		fields: {
			nodeId,
			nodeHex,
			lastSentById,
			lastSentByHex,
			broadcastIntervalSecs,
			neighbors,
		},
		nodes,
	};
}

/**
 * CryptoEngine::initNonce — the packet id occupies a 64-bit little-endian
 * slot (so the upper four bytes are zero for every packet a radio actually
 * sends), followed by the sender's node number. Exported so tests can build
 * ciphertext with the exact construction the reader reverses.
 */
export function meshtasticNonce(
	fromNode: number,
	packetId: number,
): Uint8Array {
	const nonce = new Uint8Array(16);
	nonce[0] = packetId & 0xff;
	nonce[1] = (packetId >>> 8) & 0xff;
	nonce[2] = (packetId >>> 16) & 0xff;
	nonce[3] = (packetId >>> 24) & 0xff;
	nonce[8] = fromNode & 0xff;
	nonce[9] = (fromNode >>> 8) & 0xff;
	nonce[10] = (fromNode >>> 16) & 0xff;
	nonce[11] = (fromNode >>> 24) & 0xff;
	return nonce;
}

/**
 * Parse candidate plaintext strictly as a Data message. Anything unexpected
 * means the key that produced these bytes was wrong, and the caller must
 * keep treating the payload as opaque — noise must never be presented as a
 * message.
 */
function parseDataMessage(
	plain: Uint8Array,
): Omit<PayloadParse, "source"> | null {
	const length = plain.length;
	let portnum: number | null = null;
	let portnumSpan: Span | null = null;
	let payloadSpan: Span | null = null;
	let requestId: number | null = null;
	let requestIdSpan: Span | null = null;

	let cursor = 0;
	while (cursor < length) {
		const tagStart = cursor;
		const tag = readVarint(plain, length, cursor);
		if (!tag) return null;
		const field = tag.value >>> 3;
		const wire = tag.value & 0x07;
		if (field === 0) return null;

		if (wire === WIRE_VARINT) {
			const value = readVarint(plain, length, tag.next);
			if (!value) return null;
			if (field === 1) {
				if (value.value > 0xffff) return null;
				portnum = value.value;
				portnumSpan = { offset: tagStart, length: value.next - tagStart };
			} else if (field === 6) {
				requestId = value.value;
				requestIdSpan = { offset: tagStart, length: value.next - tagStart };
			}
			cursor = value.next;
		} else if (wire === WIRE_LENGTH_DELIMITED) {
			const size = readVarint(plain, length, tag.next);
			if (!size || size.value > length - size.next) return null;
			if (field === 2) payloadSpan = { offset: size.next, length: size.value };
			cursor = size.next + size.value;
		} else {
			// Fixed-width fields are legal protobuf but absent from Data; seeing
			// one means this is not a Data message.
			return null;
		}
	}

	if (portnum === null || portnumSpan === null) return null;

	const fields: MeshtasticPayloadFields = {
		portnum,
		portLabel: meshtasticPortLabel(portnum),
		payloadLength: payloadSpan ? payloadSpan.length : 0,
		text: null,
		latitudeDegrees: null,
		longitudeDegrees: null,
		longName: null,
		shortName: null,
		requestId,
		telemetry: null,
		routeDiscovery: null,
		routing: null,
		neighborInfo: null,
	};
	const parse: Omit<PayloadParse, "source"> = {
		fields,
		plain,
		portnumSpan,
		payloadSpan,
		latitudeSpan: null,
		longitudeSpan: null,
		longNameSpan: null,
		shortNameSpan: null,
		requestIdSpan,
		telemetryNodes: null,
		routeDiscoveryNodes: null,
		routingNodes: null,
		neighborInfoNodes: null,
	};

	if (payloadSpan && payloadSpan.length > 0) {
		if (
			portnum === MESHTASTIC_PORT.textMessage &&
			looksLikeText(plain, payloadSpan.offset, payloadSpan.length)
		) {
			const copy = Math.min(payloadSpan.length, MESHTASTIC_MAX_TEXT_BYTES);
			fields.text = decodeText(plain, payloadSpan.offset, copy);
		} else if (portnum === MESHTASTIC_PORT.position) {
			const position = parsePosition(
				plain,
				payloadSpan.offset,
				payloadSpan.length,
			);
			if (position) {
				fields.latitudeDegrees = position.latitude;
				fields.longitudeDegrees = position.longitude;
				parse.latitudeSpan = position.latitudeSpan;
				parse.longitudeSpan = position.longitudeSpan;
			}
		} else if (portnum === MESHTASTIC_PORT.nodeInfo) {
			const info = parseNodeInfo(plain, payloadSpan.offset, payloadSpan.length);
			if (info.user) {
				fields.longName = info.user.longName;
				fields.shortName = info.user.shortName;
				parse.longNameSpan = info.user.longNameSpan;
				parse.shortNameSpan = info.user.shortNameSpan;
			}
			if (info.position) {
				fields.latitudeDegrees = info.position.latitude;
				fields.longitudeDegrees = info.position.longitude;
				parse.latitudeSpan = info.position.latitudeSpan;
				parse.longitudeSpan = info.position.longitudeSpan;
			}
		} else if (portnum === MESHTASTIC_PORT.telemetry) {
			const telem = parseTelemetry(
				plain,
				payloadSpan.offset,
				payloadSpan.length,
			);
			if (telem) {
				fields.telemetry = telem.fields;
				parse.telemetryNodes = telem.nodes;
			}
		} else if (portnum === MESHTASTIC_PORT.traceroute) {
			const rd = parseRouteDiscovery(
				plain,
				payloadSpan.offset,
				payloadSpan.length,
			);
			if (rd) {
				fields.routeDiscovery = rd.fields;
				parse.routeDiscoveryNodes = rd.nodes;
			}
		} else if (portnum === MESHTASTIC_PORT.routing) {
			const rout = parseRouting(plain, payloadSpan.offset, payloadSpan.length);
			if (rout) {
				fields.routing = rout.fields;
				parse.routingNodes = rout.nodes;
			}
		} else if (portnum === MESHTASTIC_PORT.neighborinfo) {
			const ni = parseNeighborInfo(
				plain,
				payloadSpan.offset,
				payloadSpan.length,
			);
			if (ni) {
				fields.neighborInfo = ni.fields;
				parse.neighborInfoNodes = ni.nodes;
			}
		}
	}

	return parse;
}

/**
 * Try to read ciphertext taken from immediately after the 16-byte outer
 * header. The published default PSK is tried first — exactly the keyless
 * behavior — then each user-supplied key in the order given (16- or 32-byte;
 * other lengths are skipped). The first key whose plaintext parses as a Data
 * message wins, and the result names it. Returns null when no key works — a
 * wrong key produces noise, and noise must never be presented as a message.
 */
export function readMeshtasticPayload(
	ciphertext: Uint8Array,
	fromNode: number,
	packetId: number,
	userKeys: readonly ChannelKey[] = [],
): PayloadParse | null {
	const length = ciphertext.length;
	if (length === 0 || length > MAX_CIPHERTEXT) return null;

	const nonce = meshtasticNonce(fromNode, packetId);
	const byDefault = parseDataMessage(
		aesCtrXcrypt(MESHTASTIC_DEFAULT_PSK, nonce, ciphertext),
	);
	if (byDefault) return { ...byDefault, source: { kind: "default" } };

	for (const candidate of userKeys) {
		if (candidate.key.length !== 16 && candidate.key.length !== 32) continue;
		const parsed = parseDataMessage(
			aesCtrXcrypt(candidate.key, nonce, ciphertext),
		);
		if (parsed) {
			return {
				...parsed,
				source: {
					kind: "user",
					name: candidate.name,
					bits: candidate.key.length === 32 ? 256 : 128,
				},
			};
		}
	}
	return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Outer-header dissection — port of MeshtasticDecoder::decode.
 * ──────────────────────────────────────────────────────────────────────── */

export interface MeshtasticFields {
	destination: number;
	source: number;
	packetId: number;
	flags: number;
	channelHash: number;
	hopLimit: number;
	hopStart: number;
	/** Present only when hop_start != 0, as in the firmware. */
	nextHop: number | null;
	relayNode: number | null;
	broadcast: boolean;
	wantAck: boolean;
	viaMqtt: boolean;
	payloadOffset: number;
	payloadLength: number;
	/** Readable under the published default key — never a broken secret. */
	defaultKeyReadable: boolean;
	/**
	 * Set when a user-supplied channel key (UI-011) read the payload instead.
	 * Mutually exclusive with defaultKeyReadable — the default PSK is always
	 * tried first.
	 */
	userKey: { name: string; bits: 128 | 256 } | null;
	payload: MeshtasticPayloadFields | null;
}

export interface MeshtasticDissection extends Dissection {
	protocol: "Meshtastic";
	fields: MeshtasticFields | null;
}

function payloadNodes(
	bytes: Uint8Array,
	fields: MeshtasticFields,
	userKeys: readonly ChannelKey[],
): DissectNode[] {
	const base = fields.payloadOffset;
	const length = fields.payloadLength;
	if (length === 0) {
		return [node("Payload", base, 0, "0 bytes")];
	}

	const parse = readMeshtasticPayload(
		bytes.subarray(base, base + length),
		fields.source,
		fields.packetId,
		userKeys,
	);
	if (!parse) {
		// The outer header does not prove whether the protobuf bytes are
		// encrypted: channels with an empty/zero PSK send them in cleartext.
		const triedKeys =
			userKeys.length > 0
				? `the published default key or the ${userKeys.length} supplied channel key(s) `
				: "the published default key ";
		return [
			node(
				"Payload",
				base,
				length,
				`opaque — ${length} bytes, not readable with ${triedKeys}` +
					"(private PSK or non-default traffic); shown as raw bytes",
				[],
				"opaque",
			),
		];
	}

	if (parse.source.kind === "default") {
		fields.defaultKeyReadable = true;
	} else {
		fields.userKey = { name: parse.source.name, bits: parse.source.bits };
	}
	fields.payload = parse.fields;
	const p = parse.fields;

	const children: DissectNode[] = [
		node(
			"Port",
			base + parse.portnumSpan.offset,
			parse.portnumSpan.length,
			`${p.portnum} (${p.portLabel})`,
		),
	];
	if (
		parse.requestIdSpan &&
		p.requestId !== undefined &&
		p.requestId !== null
	) {
		children.push(
			node(
				"Request ID",
				base + parse.requestIdSpan.offset,
				parse.requestIdSpan.length,
				`0x${p.requestId.toString(16).padStart(8, "0")}`,
			),
		);
	}
	if (parse.payloadSpan) {
		if (parse.payloadSpan.length === 0) {
			children.push(
				node(
					"Application payload",
					base + parse.payloadSpan.offset,
					0,
					p.requestId !== undefined && p.requestId !== null
						? `ACK for request 0x${p.requestId.toString(16).padStart(8, "0")}`
						: "0 bytes",
				),
			);
		} else {
			const inner: DissectNode[] = [];
			if (p.text !== null) {
				inner.push(
					node(
						"Text",
						base + parse.payloadSpan.offset,
						parse.payloadSpan.length,
						JSON.stringify(p.text),
					),
				);
			}
			if (parse.latitudeSpan && p.latitudeDegrees !== null) {
				inner.push(
					node(
						"Latitude",
						base + parse.latitudeSpan.offset,
						parse.latitudeSpan.length,
						`${p.latitudeDegrees.toFixed(7)}°`,
					),
				);
			}
			if (parse.longitudeSpan && p.longitudeDegrees !== null) {
				inner.push(
					node(
						"Longitude",
						base + parse.longitudeSpan.offset,
						parse.longitudeSpan.length,
						`${p.longitudeDegrees.toFixed(7)}°`,
					),
				);
			}
			if (parse.longNameSpan && p.longName !== null) {
				inner.push(
					node(
						"Long name",
						base + parse.longNameSpan.offset,
						parse.longNameSpan.length,
						p.longName,
					),
				);
			}
			if (parse.shortNameSpan && p.shortName !== null) {
				inner.push(
					node(
						"Short name",
						base + parse.shortNameSpan.offset,
						parse.shortNameSpan.length,
						p.shortName,
					),
				);
			}
			if (parse.telemetryNodes && parse.telemetryNodes.length > 0) {
				inner.push(...parse.telemetryNodes.map((n) => offsetTree(n, base)));
			}
			if (parse.routeDiscoveryNodes && parse.routeDiscoveryNodes.length > 0) {
				inner.push(
					...parse.routeDiscoveryNodes.map((n) => offsetTree(n, base)),
				);
			}
			if (parse.routingNodes && parse.routingNodes.length > 0) {
				inner.push(...parse.routingNodes.map((n) => offsetTree(n, base)));
			}
			if (parse.neighborInfoNodes && parse.neighborInfoNodes.length > 0) {
				inner.push(...parse.neighborInfoNodes.map((n) => offsetTree(n, base)));
			}
			if (inner.length === 0) {
				inner.push(
					node(
						"Application payload",
						base + parse.payloadSpan.offset,
						parse.payloadSpan.length,
						`undecoded — ${parse.payloadSpan.length} raw bytes (port ${p.portnum})`,
						[],
						"raw",
					),
				);
			}
			children.push(
				node(
					"Application payload",
					base + parse.payloadSpan.offset,
					parse.payloadSpan.length,
					`${parse.payloadSpan.length} bytes`,
					inner,
				),
			);
		}
	}

	return [
		node(
			"Data message",
			base,
			length,
			// The default key proves the traffic was never private; a user key
			// proves only that the user knew the channel secret — the label must
			// not claim more than that.
			parse.source.kind === "default"
				? "decrypted with the published default channel key (traffic was never private)"
				: `decrypted with channel key "${parse.source.name}" (user-supplied, AES-${parse.source.bits})`,
			children,
		),
	];
}

/**
 * The outer header's destination and source node numbers as 8-character
 * lowercase hex — or null when the frame proves neither: shorter than the
 * 16-byte outer header, or a zero sender (which the official firmware
 * rejects as an altered packet, and `dissectMeshtastic` reports as
 * malformed). This is the same header arithmetic `dissectMeshtastic`
 * performs, without building a tree, for the follow-conversation filter
 * (UI-008), which reads every frame of a capture on every keystroke.
 * conversation.test.ts pins it against `dissectMeshtastic`'s own fields for
 * fixtures, every prefix of them, and random bytes, so the two cannot drift.
 */
export function meshtasticAddressHex(
	bytes: Uint8Array,
): { src: string; dst: string } | null {
	if (bytes.length < MESHTASTIC_OUTER_HEADER_LENGTH) return null;
	const destination = readLe32(bytes, 0);
	const source = readLe32(bytes, 4);
	// Official firmware rejects a zero sender as an altered packet; a frame
	// the dissector calls malformed names no conversation here either.
	if (source === 0) return null;
	const nodeHex = (value: number) => value.toString(16).padStart(8, "0");
	return { src: nodeHex(source), dst: nodeHex(destination) };
}

/**
 * Dissect one Meshtastic frame. The caller (registry.ts) is responsible for
 * profile gating: Meshtastic's outer header has no magic bytes, so the
 * firmware only runs this decoder for an explicitly identified profile.
 */
export function dissectMeshtastic(
	bytes: Uint8Array,
	opts: DissectOptions = {},
): MeshtasticDissection {
	const n = bytes.length;
	const root = node("Meshtastic", 0, n);

	if (n < MESHTASTIC_OUTER_HEADER_LENGTH) {
		root.children.push(
			node(
				"Malformed frame",
				0,
				n,
				`outer header needs ${MESHTASTIC_OUTER_HEADER_LENGTH} bytes, frame has ${n}`,
				[],
				"error",
			),
		);
		return {
			protocol: "Meshtastic",
			result: "malformed",
			state: "malformed",
			kind: "unknown",
			root,
			fields: null,
		};
	}

	// to[0..3], from[4..7], id[8..11], flags[12], channel_hash[13],
	// next_hop[14], relay_node[15] — all little-endian.
	const destination = readLe32(bytes, 0);
	const source = readLe32(bytes, 4);
	const packetId = readLe32(bytes, 8);
	const flags = bytes[12];
	const hopLimit = flags & MESHTASTIC_FLAG.hopLimitMask;
	const hopStart =
		(flags & MESHTASTIC_FLAG.hopStartMask) >>> MESHTASTIC_FLAG.hopStartShift;

	const fields: MeshtasticFields = {
		destination,
		source,
		packetId,
		flags,
		channelHash: bytes[13],
		hopLimit,
		hopStart,
		nextHop: hopStart !== 0 ? bytes[14] : null,
		relayNode: hopStart !== 0 ? bytes[15] : null,
		broadcast: destination === 0xffffffff,
		wantAck: (flags & MESHTASTIC_FLAG.wantAck) !== 0,
		viaMqtt: (flags & MESHTASTIC_FLAG.viaMqtt) !== 0,
		payloadOffset: MESHTASTIC_OUTER_HEADER_LENGTH,
		payloadLength: n - MESHTASTIC_OUTER_HEADER_LENGTH,
		defaultKeyReadable: false,
		userKey: null,
		payload: null,
	};

	const flagsNode = node("Flags", 12, 1, hex(flags, 1), [
		node("Hop limit", 12, 1, String(hopLimit)),
		node("Want ACK", 12, 1, fields.wantAck ? "yes" : "no"),
		node("Via MQTT", 12, 1, fields.viaMqtt ? "yes" : "no"),
		node("Hop start", 12, 1, String(hopStart)),
	]);
	const routingBytes =
		hopStart !== 0
			? [
					node("Next hop", 14, 1, hex(bytes[14], 1)),
					node("Relay node", 15, 1, hex(bytes[15], 1)),
				]
			: [
					node(
						"Next hop / relay node",
						14,
						2,
						"not meaningful — hop start is 0 (pre-2.3 sender)",
					),
				];
	root.children.push(
		node("Outer header", 0, MESHTASTIC_OUTER_HEADER_LENGTH, undefined, [
			node(
				"Destination",
				0,
				4,
				fields.broadcast
					? `${hex(destination, 4)} (broadcast)`
					: hex(destination, 4),
			),
			node("Source", 4, 4, hex(source, 4)),
			node("Packet ID", 8, 4, hex(packetId, 4)),
			flagsNode,
			node("Channel hash", 13, 1, hex(bytes[13], 1)),
			...routingBytes,
		]),
	);

	// Official firmware rejects a zero sender as an altered packet. Preserve
	// the parsed fields for diagnostics while reporting the frame as malformed.
	if (source === 0) {
		root.children.push(
			node(
				"Malformed frame",
				4,
				4,
				"source node 0 — official firmware rejects a zero sender as altered",
				[],
				"error",
			),
		);
		return {
			protocol: "Meshtastic",
			result: "malformed",
			state: "malformed",
			kind: "unknown",
			root,
			fields,
		};
	}

	root.children.push(...payloadNodes(bytes, fields, opts.channelKeys ?? []));

	let state: DecodeState = "header-only";
	let kind: PacketKind = "opaque-payload";
	if (fields.defaultKeyReadable || fields.userKey !== null) {
		state = "payload-decoded";
		kind = "data";
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
		protocol: "Meshtastic",
		result: "matched",
		state,
		kind,
		root,
		fields,
	};
}
