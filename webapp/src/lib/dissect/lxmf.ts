/** Structural LXMF reader. The reference-generated vectors in test/lxmf pin
 * [timestamp, title, content, fields, optional stamp] and both framing forms.
 * Opportunistic packets omit the destination hash carried by Reticulum.
 * Signature and stamp presence is reported without claiming verification. */
import { hexBytes, node, type DissectNode } from "./types";

type Range = { offset: number; length: number };
type Value = Range & {
	kind: "nil" | "number" | "bytes" | "array" | "map" | "boolean";
	value?: number | bigint;
	count?: number;
	body?: Range;
};

/** Walk fields without materializing their contents. Each item consumes at
 * least one byte; nesting is bounded before it can exhaust the JS stack. */
class Reader {
	offset: number;
	constructor(readonly bytes: Uint8Array, offset: number) { this.offset = offset; }
	take(length: number): number {
		if (length > this.bytes.length - this.offset) throw new Error("Truncated MessagePack value");
		const at = this.offset;
		this.offset += length;
		return at;
	}
	uint(width: number): number {
		const at = this.take(width);
		let value = 0;
		for (let i = 0; i < width; i++) value = value * 256 + this.bytes[at + i];
		return value;
	}
	arrayHeader(): number {
		const tag = this.uint(1);
		if ((tag & 0xf0) === 0x90) return tag & 0xf;
		if (tag === 0xdc) return this.uint(2);
		if (tag === 0xdd) return this.uint(4);
		throw new Error("Expected an array");
	}
	read(depth = 0): Value {
		if (depth > 16) throw new Error("MessagePack nesting limit exceeded");
		const offset = this.offset;
		const tag = this.uint(1);
		let kind: Value["kind"];
		let value: Value["value"];
		let count: number | undefined;
		let body: Range | undefined;
		if (tag <= 0x7f || tag >= 0xe0) {
			kind = "number";
			value = tag <= 0x7f ? tag : tag - 256;
		} else if (tag === 0xc0) {
			kind = "nil";
		} else if (tag === 0xc2 || tag === 0xc3) {
			kind = "boolean";
		} else if ((tag & 0xe0) === 0xa0 || [0xc4, 0xc5, 0xc6, 0xd9, 0xda, 0xdb].includes(tag)) {
			kind = "bytes";
			const length = (tag & 0xe0) === 0xa0 ? tag & 0x1f
				: this.uint(tag === 0xc4 || tag === 0xd9 ? 1 : tag === 0xc5 || tag === 0xda ? 2 : 4);
			body = { offset: this.take(length), length };
		} else if (tag >= 0xca && tag <= 0xd3) {
			kind = "number";
			const width = [4, 8, 1, 2, 4, 8, 1, 2, 4, 8][tag - 0xca];
			const at = this.take(width);
			const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + at, width);
			if (tag === 0xca) value = view.getFloat32(0);
			else if (tag === 0xcb) value = view.getFloat64(0);
			else if (tag === 0xcf) value = view.getBigUint64(0);
			else if (tag === 0xd3) value = view.getBigInt64(0);
			else if (tag === 0xd0) value = view.getInt8(0);
			else if (tag === 0xd1) value = view.getInt16(0);
			else if (tag === 0xd2) value = view.getInt32(0);
			else value = width === 1 ? view.getUint8(0) : width === 2 ? view.getUint16(0) : view.getUint32(0);
		} else {
			if ((tag & 0xf0) === 0x90) { kind = "array"; count = tag & 0xf; }
			else if ((tag & 0xf0) === 0x80) { kind = "map"; count = tag & 0xf; }
			else if (tag === 0xdc || tag === 0xdd) { kind = "array"; count = this.uint(tag === 0xdc ? 2 : 4); }
			else if (tag === 0xde || tag === 0xdf) { kind = "map"; count = this.uint(tag === 0xde ? 2 : 4); }
			else throw new Error("Unsupported MessagePack type");
			const items = count * (kind === "map" ? 2 : 1);
			if (items > this.bytes.length - this.offset) throw new Error("Truncated MessagePack container");
			for (let i = 0; i < items; i++) this.read(depth + 1);
		}
		return { kind, offset, length: this.offset - offset, value, count, body };
	}
}

export interface LxmfText extends Range {
	/** Null is nil; an empty string is a present, empty part. */
	text: string | null;
	byteLength: number;
	truncated: boolean;
}

export interface LxmfMessage {
	destination: (Range & { hex: string }) | null;
	source: Range & { hex: string };
	signature: Range;
	array: Range & { count: number };
	timestamp: Range & { seconds: number | null };
	title: LxmfText;
	content: LxmfText;
	fields: Range & { count: number | null };
	stamp: (Range & { byteLength: number | null }) | null;
}

function textPart(bytes: Uint8Array, value: Value, limit: number): LxmfText {
	if (value.kind !== "nil" && value.kind !== "bytes") throw new Error("Expected text bytes or nil");
	const body = value.body;
	const truncated = (body?.length ?? 0) > limit;
	const text = body ? new TextDecoder().decode(
		bytes.subarray(body.offset, body.offset + Math.min(limit, body.length)),
		{ stream: truncated },
	).replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => /[\r\n\t]/.test(c) ? " " : "·") : null;
	return { offset: value.offset, length: value.length, text, byteLength: body?.length ?? 0, truncated };
}

export function readLxmfMessage(
	bytes: Uint8Array,
	framing: "stored" | "opportunistic" = "stored",
): LxmfMessage | null {
	const sourceOffset = framing === "stored" ? 16 : 0;
	const headerLength = sourceOffset + 80;
	if (bytes.length <= headerLength) return null;
	try {
		const reader = new Reader(bytes, headerLength);
		const count = reader.arrayHeader();
		if (count !== 4 && count !== 5) return null;
		const array = { offset: headerLength, length: reader.offset - headerLength, count };
		const timestamp = reader.read();
		if (timestamp.kind !== "nil" && timestamp.kind !== "number") return null;
		const seconds = timestamp.kind === "nil" ? null : Number(timestamp.value);
		if (seconds !== null && (!Number.isFinite(seconds) ||
			(typeof timestamp.value === "bigint" && !Number.isSafeInteger(seconds)))) return null;
		const title = textPart(bytes, reader.read(), 64);
		const content = textPart(bytes, reader.read(), 192);
		const fields = reader.read();
		if (fields.kind !== "map" && fields.kind !== "nil") return null;
		const stamp = count === 5 ? reader.read() : null;
		if (stamp && stamp.kind !== "bytes" && stamp.kind !== "nil") return null;
		if (reader.offset !== bytes.length) return null;
		return {
			destination: framing === "stored" ? { offset: 0, length: 16, hex: hexBytes(bytes, 0, 16) } : null,
			source: { offset: sourceOffset, length: 16, hex: hexBytes(bytes, sourceOffset, 16) },
			signature: { offset: sourceOffset + 16, length: 64 },
			array,
			timestamp: { offset: timestamp.offset, length: timestamp.length, seconds },
			title,
			content,
			fields: { offset: fields.offset, length: fields.length, count: fields.count ?? null },
			stamp: stamp ? { offset: stamp.offset, length: stamp.length, byteLength: stamp.body?.length ?? null } : null,
		};
	} catch {
		return null;
	}
}

export function lxmfSubtree(message: LxmfMessage, base: number): DissectNode[] {
	const row = (label: string, range: Range, value: string) => node(label, base + range.offset, range.length, value);
	const text = (part: LxmfText) => part.text === null ? "Not included (nil)"
		: part.byteLength === 0 ? "Empty (0 bytes)"
		: `${JSON.stringify(part.text)} · ${part.byteLength} bytes${part.truncated ? " · preview truncated" : ""}`;
	const seconds = message.timestamp.seconds;
	const time = seconds === null ? "Not included (nil)"
		: Math.abs(seconds * 1000) > 8.64e15 ? `${seconds} seconds · outside the date range`
		: `${seconds} seconds · ${new Date(seconds * 1000).toISOString()}`;
	return [
		...(message.destination ? [row("Destination hash", message.destination, message.destination.hex)] : []),
		row("Source hash", message.source, message.source.hex),
		row("Signature", message.signature, "64 bytes present · signature not verified"),
		row("LXMF array", message.array, `${message.array.count} elements · timestamp, title, content, fields${message.stamp ? ", stamp" : ""}`),
		row("Timestamp", message.timestamp, time),
		row("Title", message.title, text(message.title)),
		row("Content", message.content, text(message.content)),
		row("Fields", message.fields, message.fields.count === null ? "Not included (nil)" : `${message.fields.count} entries · contents not interpreted`),
		...(message.stamp ? [row("Stamp", message.stamp, message.stamp.byteLength === null ? "Not included (nil)" : `${message.stamp.byteLength} bytes present · stamp not verified`)] : []),
	];
}
