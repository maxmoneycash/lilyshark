/**
 * The Meshtastic client protobuf conversation, browser side.
 *
 * This is the same wire format the firmware's meshtastic_api.cpp speaks from
 * the other end: the phone (or this page) writes ToRadio, reads FromRadio
 * until config_complete echoes its nonce, then trades packets. Field numbers
 * come from meshtastic/protobufs master, and the test vectors here are the
 * same hand-computed bytes the firmware's tests pin, so the two ends cannot
 * drift apart without one of them failing.
 *
 * Pure functions over Uint8Array — no bluetooth in this file, so all of it
 * runs under node's test runner.
 */

export const MESHTASTIC_SERVICE = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
export const FROMRADIO_CHARACTERISTIC = "2c55e69e-4993-11ed-b878-0242ac120002";
export const TORADIO_CHARACTERISTIC = "f75c76d2-129e-4dad-a1dd-7866124401e7";
export const FROMNUM_CHARACTERISTIC = "ed9da18c-a800-4f66-a670-aa7547e34453";

export const BROADCAST = 0xffffffff;
const PORT_TEXT = 1;
const PORT_POSITION = 3;
const PORT_ROUTING = 5;

// ── writer ──────────────────────────────────────────────────────────────────

class Writer {
	private bytes: number[] = [];

	varint(value: number): this {
		let v = value >>> 0;
		do {
			const part = v & 0x7f;
			v >>>= 7;
			this.bytes.push(v !== 0 ? part | 0x80 : part);
		} while (v !== 0);
		return this;
	}

	tag(field: number, wire: number): this {
		return this.varint((field << 3) | wire);
	}

	uint(field: number, value: number): this {
		if (value === 0) return this;
		return this.tag(field, 0).varint(value);
	}

	fixed32(field: number, value: number): this {
		if (value === 0) return this;
		return this.fixed32Always(field, value);
	}

	fixed32Always(field: number, value: number): this {
		this.tag(field, 5);
		const v = value >>> 0;
		this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
		return this;
	}

	bytesField(field: number, value: Uint8Array): this {
		if (value.length === 0) return this;
		this.tag(field, 2).varint(value.length);
		for (const b of value) this.bytes.push(b);
		return this;
	}

	message(field: number, child: Writer): this {
		return this.bytesField(field, child.finish());
	}

	finish(): Uint8Array {
		return new Uint8Array(this.bytes);
	}
}

// ── reader ──────────────────────────────────────────────────────────────────

interface Field {
	field: number;
	wire: number;
	/** wire 0/5: the numeric value; wire 2: byte length. */
	value: number;
	/** wire 2 only. */
	bytes?: Uint8Array;
}

/** Walk one protobuf, tolerating unknown fields; null on malformed bytes. */
function readFields(data: Uint8Array): Field[] | null {
	const out: Field[] = [];
	let at = 0;
	const varint = (): number | null => {
		let value = 0;
		let shift = 0;
		while (shift < 64) {
			if (at >= data.length) return null;
			const part = data[at++];
			// Beyond 32 bits JS bitwise breaks; accumulate with multiply.
			value += (part & 0x7f) * 2 ** shift;
			if ((part & 0x80) === 0) return value;
			shift += 7;
		}
		return null;
	};
	while (at < data.length) {
		const key = varint();
		if (key === null) return null;
		const field = Math.floor(key / 8);
		const wire = key % 8;
		if (wire === 0) {
			const value = varint();
			if (value === null) return null;
			out.push({ field, wire, value });
		} else if (wire === 5) {
			if (at + 4 > data.length) return null;
			const value =
				(data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24)) >>> 0;
			at += 4;
			out.push({ field, wire, value });
		} else if (wire === 1) {
			if (at + 8 > data.length) return null;
			at += 8;
		} else if (wire === 2) {
			const length = varint();
			if (length === null || at + length > data.length) return null;
			out.push({ field, wire, value: length, bytes: data.subarray(at, at + length) });
			at += length;
		} else {
			return null;
		}
	}
	return out;
}

// ── ToRadio (page → deck) ───────────────────────────────────────────────────

export function encodeWantConfig(nonce: number): Uint8Array {
	const w = new Writer().tag(3, 0).varint(nonce >>> 0);
	return w.finish();
}

export function encodeTextPacket(input: {
	to: number;
	channel: number;
	packetId: number;
	text: string;
	wantAck: boolean;
}): Uint8Array {
	const data = new Writer()
		.uint(1, PORT_TEXT)
		.bytesField(2, new TextEncoder().encode(input.text));
	const packet = new Writer()
		.fixed32(2, input.to)
		.uint(3, input.channel)
		.message(4, data)
		.fixed32(6, input.packetId)
		.uint(10, input.wantAck ? 1 : 0);
	return new Writer().message(1, packet).finish();
}

// ── FromRadio (deck → page) ─────────────────────────────────────────────────

export type FromRadio =
	| { kind: "myInfo"; num: number }
	| { kind: "metadata"; firmware: string }
	| {
			kind: "nodeInfo";
			num: number;
			id: string;
			longName: string;
			shortName: string;
			snr?: number;
			lat?: number;
			lon?: number;
	  }
	| { kind: "configComplete"; nonce: number }
	| {
			kind: "text";
			from: number;
			to: number;
			packetId: number;
			channel: number;
			text: string;
			rxSnr?: number;
			rxRssi?: number;
	  }
	| { kind: "position"; from: number; lat: number; lon: number }
	| { kind: "routing"; requestId: number; error: number }
	| { kind: "other" };

const utf8 = new TextDecoder();

function toFloat(bits: number): number {
	const buffer = new ArrayBuffer(4);
	new DataView(buffer).setUint32(0, bits, true);
	return new DataView(buffer).getFloat32(0, true);
}

function toSigned32(value: number): number {
	return value | 0;
}

function parseNodeInfo(bytes: Uint8Array): FromRadio {
	const fields = readFields(bytes) ?? [];
	let num = 0;
	let id = "";
	let longName = "";
	let shortName = "";
	let snr: number | undefined;
	let lat: number | undefined;
	let lon: number | undefined;
	for (const f of fields) {
		if (f.field === 1 && f.wire === 0) num = f.value;
		if (f.field === 2 && f.bytes) {
			for (const u of readFields(f.bytes) ?? []) {
				if (!u.bytes) continue;
				if (u.field === 1) id = utf8.decode(u.bytes);
				if (u.field === 2) longName = utf8.decode(u.bytes);
				if (u.field === 3) shortName = utf8.decode(u.bytes);
			}
		}
		if (f.field === 3 && f.bytes) {
			for (const p of readFields(f.bytes) ?? []) {
				if (p.field === 1 && p.wire === 5) lat = toSigned32(p.value) / 1e7;
				if (p.field === 2 && p.wire === 5) lon = toSigned32(p.value) / 1e7;
			}
		}
		if (f.field === 4 && f.wire === 5) snr = toFloat(f.value);
	}
	return { kind: "nodeInfo", num, id, longName, shortName, snr, lat, lon };
}

function parsePacket(bytes: Uint8Array): FromRadio {
	const fields = readFields(bytes) ?? [];
	let from = 0;
	let to = 0;
	let packetId = 0;
	let channel = 0;
	let rxSnr: number | undefined;
	let rxRssi: number | undefined;
	let decoded: Uint8Array | undefined;
	for (const f of fields) {
		if (f.field === 1 && f.wire === 5) from = f.value;
		if (f.field === 2 && f.wire === 5) to = f.value;
		if (f.field === 3 && f.wire === 0) channel = f.value;
		if (f.field === 4 && f.bytes) decoded = f.bytes;
		if (f.field === 6 && f.wire === 5) packetId = f.value;
		if (f.field === 8 && f.wire === 5) rxSnr = toFloat(f.value);
		if (f.field === 12 && f.wire === 0) rxRssi = f.value > 2 ** 31 ? f.value - 2 ** 32 : f.value;
	}
	if (!decoded) return { kind: "other" };
	let portnum = 0;
	let payload: Uint8Array = new Uint8Array();
	let requestId = 0;
	for (const d of readFields(decoded) ?? []) {
		if (d.field === 1 && d.wire === 0) portnum = d.value;
		if (d.field === 2 && d.bytes) payload = d.bytes;
		if (d.field === 6 && d.wire === 5) requestId = d.value;
	}
	if (portnum === PORT_TEXT) {
		return { kind: "text", from, to, packetId, channel, text: utf8.decode(payload), rxSnr, rxRssi };
	}
	if (portnum === PORT_POSITION) {
		let lat = 0;
		let lon = 0;
		for (const p of readFields(payload) ?? []) {
			if (p.field === 1 && p.wire === 5) lat = toSigned32(p.value) / 1e7;
			if (p.field === 2 && p.wire === 5) lon = toSigned32(p.value) / 1e7;
		}
		return { kind: "position", from, lat, lon };
	}
	if (portnum === PORT_ROUTING) {
		let error = 0;
		for (const r of readFields(payload) ?? []) {
			if (r.field === 3 && r.wire === 0) error = r.value;
		}
		return { kind: "routing", requestId, error };
	}
	return { kind: "other" };
}

export function parseFromRadio(data: Uint8Array): FromRadio | null {
	const fields = readFields(data);
	if (fields === null) return null;
	for (const f of fields) {
		switch (f.field) {
			case 2:
				if (f.bytes) return parsePacket(f.bytes);
				break;
			case 3: {
				if (!f.bytes) break;
				for (const m of readFields(f.bytes) ?? []) {
					if (m.field === 1 && m.wire === 0) return { kind: "myInfo", num: m.value };
				}
				return { kind: "myInfo", num: 0 };
			}
			case 4:
				if (f.bytes) return parseNodeInfo(f.bytes);
				break;
			case 7:
				return { kind: "configComplete", nonce: f.value };
			case 13: {
				if (!f.bytes) break;
				for (const m of readFields(f.bytes) ?? []) {
					if (m.field === 1 && m.bytes) return { kind: "metadata", firmware: utf8.decode(m.bytes) };
				}
				return { kind: "metadata", firmware: "" };
			}
			default:
				break;
		}
	}
	return { kind: "other" };
}
