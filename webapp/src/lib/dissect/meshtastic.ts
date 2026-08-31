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
}

interface VarintResult {
	value: number;
	next: number;
}

/** Base-128 varint; null when it runs off the end or overruns 32 bits. */
function readVarint(
	bytes: Uint8Array,
	length: number,
	cursor: number,
): VarintResult | null {
	let result = 0;
	let shift = 0;
	let at = cursor;
	while (at < length) {
		const byte = bytes[at++];
		if (shift > 28) return null;
		result = (result | ((byte & 0x7f) << shift)) >>> 0;
		if ((byte & 0x80) === 0) return { value: result, next: at };
		shift += 7;
	}
	return null;
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
	if (parse.payloadSpan) {
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
