/**
 * Structural MessagePack reader and dissector for Reticulum announce app_data.
 *
 * Traverses MessagePack primitives and containers (maps, arrays, strings, binary,
 * numbers) and yields DissectNode trees with byte-accurate ranges.
 * Fully bounded against infinite recursion and buffer overruns.
 */

import { hexBytes, node, type DissectNode } from "./types";

export interface MsgpackValue {
	offset: number;
	length: number;
	kind: "nil" | "boolean" | "number" | "string" | "binary" | "array" | "map";
	display: string;
	children: MsgpackValue[];
	/** For map entries: string or numeric key representation */
	keyText?: string;
}

export class MsgpackReader {
	offset: number;
	readonly end: number;

	constructor(readonly bytes: Uint8Array, start = 0, length?: number) {
		this.offset = start;
		this.end = length !== undefined ? start + length : bytes.length;
		if (this.end > bytes.length) this.end = bytes.length;
	}

	remaining(): number {
		return this.end - this.offset;
	}

	take(count: number): number {
		if (count > this.remaining()) throw new Error("Truncated MessagePack");
		const at = this.offset;
		this.offset += count;
		return at;
	}

	uint(width: number): number {
		const at = this.take(width);
		let val = 0;
		for (let i = 0; i < width; i++) {
			val = val * 256 + this.bytes[at + i];
		}
		return val;
	}

	read(depth = 0): MsgpackValue {
		if (depth > 16) throw new Error("Nesting limit exceeded");
		if (this.remaining() <= 0) throw new Error("Unexpected end of bytes");

		const startOffset = this.offset;
		const tag = this.uint(1);

		// Positive fixint: 0x00 .. 0x7f
		if (tag <= 0x7f) {
			return {
				offset: startOffset,
				length: 1,
				kind: "number",
				display: String(tag),
				children: [],
			};
		}

		// Negative fixint: 0xe0 .. 0xff (-32 .. -1)
		if (tag >= 0xe0) {
			const val = tag - 256;
			return {
				offset: startOffset,
				length: 1,
				kind: "number",
				display: String(val),
				children: [],
			};
		}

		// Fixstr: 0xa0 .. 0xbf (length up to 31)
		if ((tag & 0xe0) === 0xa0) {
			const strLen = tag & 0x1f;
			const bodyOffset = this.take(strLen);
			const str = this.decodeUtf8(bodyOffset, strLen);
			return {
				offset: startOffset,
				length: this.offset - startOffset,
				kind: "string",
				display: JSON.stringify(str),
				children: [],
			};
		}

		// Fixarray: 0x90 .. 0x9f
		if ((tag & 0xf0) === 0x90) {
			const count = tag & 0x0f;
			return this.readArray(startOffset, count, depth);
		}

		// Fixmap: 0x80 .. 0x8f
		if ((tag & 0xf0) === 0x80) {
			const count = tag & 0x0f;
			return this.readMap(startOffset, count, depth);
		}

		// Primitives & variable widths
		switch (tag) {
			case 0xc0: // nil
				return {
					offset: startOffset,
					length: 1,
					kind: "nil",
					display: "nil",
					children: [],
				};

			case 0xc2: // false
				return {
					offset: startOffset,
					length: 1,
					kind: "boolean",
					display: "false",
					children: [],
				};

			case 0xc3: // true
				return {
					offset: startOffset,
					length: 1,
					kind: "boolean",
					display: "true",
					children: [],
				};

			// bin 8, 16, 32
			case 0xc4:
			case 0xc5:
			case 0xc6: {
				const lenBytes = tag === 0xc4 ? 1 : tag === 0xc5 ? 2 : 4;
				const binLen = this.uint(lenBytes);
				const bodyAt = this.take(binLen);
				const hex = hexBytes(this.bytes, bodyAt, Math.min(binLen, 16)) + (binLen > 16 ? "…" : "");
				return {
					offset: startOffset,
					length: this.offset - startOffset,
					kind: "binary",
					display: `${binLen} byte(s) binary [${hex}]`,
					children: [],
				};
			}

			// float 32 / 64
			case 0xca:
			case 0xcb: {
				const width = tag === 0xca ? 4 : 8;
				const at = this.take(width);
				const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + at, width);
				const num = tag === 0xca ? view.getFloat32(0) : view.getFloat64(0);
				return {
					offset: startOffset,
					length: this.offset - startOffset,
					kind: "number",
					display: Number.isInteger(num) ? `${num}.0` : String(num),
					children: [],
				};
			}

			// uint 8, 16, 32, 64
			case 0xcc:
			case 0xcd:
			case 0xce:
			case 0xcf: {
				const width = [1, 2, 4, 8][tag - 0xcc];
				const at = this.take(width);
				const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + at, width);
				const val =
					width === 1
						? view.getUint8(0)
						: width === 2
							? view.getUint16(0)
							: width === 4
								? view.getUint32(0)
								: view.getBigUint64(0);
				return {
					offset: startOffset,
					length: this.offset - startOffset,
					kind: "number",
					display: String(val),
					children: [],
				};
			}

			// int 8, 16, 32, 64
			case 0xd0:
			case 0xd1:
			case 0xd2:
			case 0xd3: {
				const width = [1, 2, 4, 8][tag - 0xd0];
				const at = this.take(width);
				const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + at, width);
				const val =
					width === 1
						? view.getInt8(0)
						: width === 2
							? view.getInt16(0)
							: width === 4
								? view.getInt32(0)
								: view.getBigInt64(0);
				return {
					offset: startOffset,
					length: this.offset - startOffset,
					kind: "number",
					display: String(val),
					children: [],
				};
			}

			// str 8, 16, 32
			case 0xd9:
			case 0xda:
			case 0xdb: {
				const lenBytes = tag === 0xd9 ? 1 : tag === 0xda ? 2 : 4;
				const strLen = this.uint(lenBytes);
				const bodyAt = this.take(strLen);
				const str = this.decodeUtf8(bodyAt, strLen);
				return {
					offset: startOffset,
					length: this.offset - startOffset,
					kind: "string",
					display: JSON.stringify(str),
					children: [],
				};
			}

			// array 16, 32
			case 0xdc:
			case 0xdd: {
				const count = this.uint(tag === 0xdc ? 2 : 4);
				return this.readArray(startOffset, count, depth);
			}

			// map 16, 32
			case 0xde:
			case 0xdf: {
				const count = this.uint(tag === 0xde ? 2 : 4);
				return this.readMap(startOffset, count, depth);
			}

			default:
				throw new Error(`Unsupported tag 0x${tag.toString(16)}`);
		}
	}

	private readArray(startOffset: number, count: number, depth: number): MsgpackValue {
		const children: MsgpackValue[] = [];
		for (let i = 0; i < count; i++) {
			const item = this.read(depth + 1);
			item.keyText = `[${i}]`;
			children.push(item);
		}
		return {
			offset: startOffset,
			length: this.offset - startOffset,
			kind: "array",
			display: `array · ${count} element${count === 1 ? "" : "s"}`,
			children,
		};
	}

	private readMap(startOffset: number, count: number, depth: number): MsgpackValue {
		const children: MsgpackValue[] = [];
		for (let i = 0; i < count; i++) {
			const key = this.read(depth + 1);
			const val = this.read(depth + 1);
			const keyLabel = key.kind === "string" ? key.display.slice(1, -1) : key.display;
			val.keyText = keyLabel;
			// Expand range of the value entry to span the key + value pair
			const entryValue: MsgpackValue = {
				offset: key.offset,
				length: val.offset + val.length - key.offset,
				kind: val.kind,
				display: val.display,
				children: val.children,
				keyText: keyLabel,
			};
			children.push(entryValue);
		}
		return {
			offset: startOffset,
			length: this.offset - startOffset,
			kind: "map",
			display: `map · ${count} pair${count === 1 ? "" : "s"}`,
			children,
		};
	}

	private decodeUtf8(offset: number, length: number): string {
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(
				this.bytes.subarray(offset, offset + length),
			);
		} catch {
			return hexBytes(this.bytes, offset, length);
		}
	}
}

/** Convert a MsgpackValue hierarchy into DissectNode hierarchy for tree rendering */
export function msgpackValueToNodes(val: MsgpackValue): DissectNode[] {
	if (val.children.length === 0) {
		const label = val.keyText ? `${val.keyText}` : val.kind;
		return [node(label, val.offset, val.length, val.display)];
	}

	const childNodes: DissectNode[] = [];
	for (const child of val.children) {
		const label = child.keyText ?? child.kind;
		if (child.children.length > 0) {
			childNodes.push(
				node(
					label,
					child.offset,
					child.length,
					child.display,
					msgpackValueToNodes(child),
				),
			);
		} else {
			childNodes.push(node(label, child.offset, child.length, child.display));
		}
	}
	return childNodes;
}

/**
 * Attempt to dissect raw bytes as MessagePack.
 * Returns array of DissectNodes if successful, or null if the bytes are not valid MessagePack.
 */
export function dissectMsgpack(
	bytes: Uint8Array,
	offset: number,
	length: number,
): DissectNode[] | null {
	if (length <= 0) return null;
	try {
		const reader = new MsgpackReader(bytes, offset, length);
		const rootVal = reader.read(0);
		// Must consume the full app_data slice
		if (reader.offset !== offset + length) return null;

		const rootLabel =
			rootVal.kind === "map"
				? `MessagePack map (${rootVal.children.length} keys)`
				: rootVal.kind === "array"
					? `MessagePack array (${rootVal.children.length} items)`
					: `MessagePack ${rootVal.kind}`;

		return [
			node(
				"MessagePack",
				rootVal.offset,
				rootVal.length,
				`${rootLabel} · ${length} bytes decoded`,
				msgpackValueToNodes(rootVal),
			),
		];
	} catch {
		return null;
	}
}
