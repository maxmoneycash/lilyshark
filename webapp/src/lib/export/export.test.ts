// Self-check: node --import tsx --test src/lib/export/export.test.ts
//
// The pcap golden bytes below are copied from the firmware writer's own
// tests in test/pcap_export/test_pcap_export.cpp, so the TypeScript and C++
// writers are pinned to the same output. If either changes shape, one of
// these fixtures breaks first.
import assert from "node:assert";
import test from "node:test";
import type { RawFrameFields } from "../deviceLink.ts";
import {
	LSCAP_METADATA_FLAG,
	type LscapFrame,
	RF_FIELD,
	SHELBY_POINTER_SIZE,
} from "../lscap.ts";
import {
	ANNOTATED_EXPORT_COLUMNS,
	buildCsv,
	buildExportRows,
	buildJson,
	buildLoraTapPcap,
	countLoraTapPcap,
	csvField,
	EXPORT_COLUMNS,
	exportColumns,
	loraTapExclusion,
	protocolLabel,
	sessionFrames,
	sessionPcapCounts,
} from "./index.ts";

/**
 * The same frame test_pcap_export.cpp builds in makeFrame(): 3 payload
 * bytes, boot clock 1.234567 s, 915 MHz, BW 250 kHz, SF10, RSSI -100 dBm,
 * SNR -7 dB, sync 0x2b, received over the air.
 */
function frame(over: Partial<LscapFrame> = {}): LscapFrame {
	return {
		sequence: 1n,
		timestampUs: 1_234_567n,
		capturedLength: 3,
		originalLength: 3,
		truncated: false,
		presentFields:
			RF_FIELD.timestamp |
			RF_FIELD.frequency |
			RF_FIELD.bandwidth |
			RF_FIELD.spreadingFactor |
			RF_FIELD.rssi |
			RF_FIELD.snr |
			RF_FIELD.syncWord |
			RF_FIELD.profile,
		centerFrequencyHz: 915_000_000,
		bandwidthHz: 250_000,
		bitRateBps: 0,
		frequencyDeviationHz: 0,
		airtimeUs: 0,
		frequencyErrorHz: 0,
		rssiDbm: -100,
		snrDb: -7,
		preambleSymbols: 8,
		syncWord: 0x2b,
		profileId: 1,
		radioStatus: 0,
		txPowerDbm: 0,
		spreadingFactor: 10,
		codingRateDenominator: 5,
		channelIndex: 0,
		radioIndex: 0,
		modulation: "lora",
		direction: "rx",
		crc: "valid",
		metadataFlags: 0,
		synthetic: false,
		bytes: Uint8Array.from([0xde, 0xad, 0xbe]),
		...over,
	};
}

/** The same frame as the device puts it on the USB link, before any decode. */
function record(over: Partial<RawFrameFields> = {}): RawFrameFields {
	return {
		seq: 1,
		timestampUs: 1_234_567n,
		rssiX10: -1000,
		snrX10: -70,
		presentFields: frame().presentFields,
		centerFrequencyHz: 915_000_000,
		bandwidthHz: 250_000,
		bitRateBps: 0,
		frequencyDeviationHz: 0,
		airtimeUs: 0,
		frequencyErrorHz: 0,
		preambleSymbols: 8,
		syncWord: 0x2b,
		profileId: 1,
		radioStatus: 0,
		txPowerDbm: 0,
		spreadingFactor: 10,
		codingRateDenominator: 5,
		channelIndex: 0,
		radioIndex: 0,
		modulation: 1, // lora
		direction: 1, // rx
		crc: 2, // valid
		metadataFlags: 0,
		originalLength: 3,
		bytes: Uint8Array.from([0xde, 0xad, 0xbe]),
		...over,
	};
}

/** A byte-valid Shelby pointer, as decodeShelbyPointer() accepts it. */
function shelbyPointerBytes(): Uint8Array {
	const p = new Uint8Array(SHELBY_POINTER_SIZE);
	p.set([0x53, 0x48, 0x4c, 0x42], 0); // "SHLB"
	p[4] = 1; // version
	p[5] = 0; // flags: not chunked
	p.fill(0xab, 6, 38); // commitment
	p.fill(0xcd, 38, 70); // owner
	new DataView(p.buffer).setUint32(70, 1234, true); // size
	new DataView(p.buffer).setUint16(78, 0, true); // chunk index
	new DataView(p.buffer).setUint16(80, 1, true); // chunk count
	return p;
}

/** The exact bytes testExactGlobalHeaderAndPacketBytes() pins in C++. */
const GOLDEN_PCAP = [
	// Classic PCAP, little endian, v2.4, snaplen 270, DLT_LORATAP 270.
	0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x0e, 0x01, 0x00, 0x00, 0x0e, 0x01, 0x00, 0x00,
	// Record header: 1.234567 seconds; 18 captured/original bytes.
	0x01, 0x00, 0x00, 0x00, 0x47, 0x94, 0x03, 0x00, 0x12, 0x00, 0x00, 0x00, 0x12,
	0x00, 0x00, 0x00,
	// LoRaTap v0, big endian fields: 915 MHz, BW 250k, SF10.
	0x00, 0x00, 0x00, 0x0f, 0x36, 0x89, 0xca, 0xc0, 0x02, 0x0a, 0x27, 0xff, 0xff,
	0xe4, 0x2b,
	// Original RF payload, unchanged.
	0xde, 0xad, 0xbe,
];

// ── pcap / LoRaTap ──────────────────────────────────────────────────────

test("pcap header and one record match the firmware writer byte for byte", () => {
	const res = buildLoraTapPcap({ frames: [frame()] });
	assert.deepEqual([...res.bytes], GOLDEN_PCAP);
	assert.equal(res.written, 1);
	assert.equal(res.excludedSynthetic, 0);
	assert.equal(res.excludedUnencodable, 0);
});

test("a truncated frame keeps both pcap lengths, like the firmware", () => {
	// Mirrors testFrameRecordAndOriginalLength(): captured 2 of 5 bytes.
	const res = buildLoraTapPcap({
		frames: [
			frame({
				capturedLength: 2,
				originalLength: 5,
				truncated: true,
				bytes: Uint8Array.from([0xde, 0xad]),
			}),
		],
	});
	assert.equal(res.bytes.length, 24 + 16 + 15 + 2);
	assert.equal(res.bytes[24 + 8], 17); // incl_len = 15 + 2
	assert.equal(res.bytes[24 + 12], 20); // orig_len = 15 + 5
	assert.equal(res.bytes[res.bytes.length - 2], 0xde);
	assert.equal(res.bytes[res.bytes.length - 1], 0xad);
});

test("unknown RSSI, sync-word folding and SNR clamps match the firmware", () => {
	// Mirrors testUnknownRssiNormalizedSyncAndSnrClamping().
	const res = buildLoraTapPcap({
		frames: [
			frame({
				presentFields: frame().presentFields & ~RF_FIELD.rssi,
				snrDb: 100,
				syncWord: 0x1424,
			}),
			frame({ rssiDbm: 200, snrDb: -100 }),
		],
	});
	const first = 24 + 16;
	assert.equal(res.bytes[first + 10], 255, "missing RSSI encodes as unknown");
	assert.equal(res.bytes[first + 13], 0x7f, "SNR clamps at +127 quarter-dB");
	assert.equal(res.bytes[first + 14], 0x12, "0x1424 folds to high nibbles");
	const second = 24 + (16 + 15 + 3) + 16;
	assert.equal(res.bytes[second + 10], 254, "RSSI clamps at 254");
	assert.equal(res.bytes[second + 13], 0x80, "SNR clamps at -128 quarter-dB");
});

test("a transmitted frame has no receive RSSI in the LoRaTap header", () => {
	const res = buildLoraTapPcap({ frames: [frame({ direction: "tx" })] });
	assert.equal(res.bytes[24 + 16 + 10], 255);
});

test("synthetic frames never reach the pcap and are counted", () => {
	// pcap/LoRaTap v0 has no provenance channel, so exclusion is the only
	// way the marker survives: the count lets the caller say so on screen.
	const res = buildLoraTapPcap({
		frames: [
			frame({ sequence: 1n }),
			frame({ sequence: 2n, synthetic: true }),
			frame({ sequence: 3n }),
			frame({ sequence: 4n, synthetic: true }),
		],
	});
	assert.equal(res.written, 2);
	assert.equal(res.excludedSynthetic, 2);
	assert.equal(res.bytes.length, 24 + 2 * (16 + 15 + 3));
});

test("frames LoRaTap v0 cannot encode are skipped and counted", () => {
	// Same rejections as the firmware: MeshCore's 62.5 kHz bandwidth, a zero
	// bandwidth, and an original length shorter than the captured length.
	const res = buildLoraTapPcap({
		frames: [
			frame({ bandwidthHz: 62_500 }),
			frame({ bandwidthHz: 0 }),
			frame({ originalLength: 2 }),
			frame(),
		],
	});
	assert.equal(res.written, 1);
	assert.equal(res.excludedUnencodable, 3);
	assert.equal(res.excludedSynthetic, 0);
});

test("an empty export is a bare, valid pcap header", () => {
	const res = buildLoraTapPcap({ frames: [] });
	assert.equal(res.bytes.length, 24);
	assert.equal(res.written, 0);
});

test("a boot clock past the u32 second range clamps like the firmware", () => {
	const res = buildLoraTapPcap({
		frames: [frame({ timestampUs: 0x1_0000_0000n * 1_000_000n + 7n })],
	});
	const view = new DataView(res.bytes.buffer);
	assert.equal(view.getUint32(24, true), 0xffff_ffff);
	assert.equal(view.getUint32(28, true), 7);
});

// ── counting without building ───────────────────────────────────────────

test("the pcap count promises exactly what the pcap then holds", () => {
	// The download button's label comes from the count, the file from the
	// writer; a mismatch would let someone save an empty capture believing
	// it held frames.
	const frames = [
		frame(),
		frame({ sequence: 2n, synthetic: true }),
		frame({ sequence: 3n, bandwidthHz: 62_500 }),
		frame({ sequence: 4n }),
		frame({ sequence: 5n, bandwidthHz: 0 }),
		frame({ sequence: 6n, synthetic: true, bandwidthHz: 0 }),
	];
	const built = buildLoraTapPcap({ frames });
	assert.deepEqual(countLoraTapPcap(frames), {
		written: built.written,
		excludedSynthetic: built.excludedSynthetic,
		excludedUnencodable: built.excludedUnencodable,
	});
	assert.equal(built.written, 2);
	// A synthetic frame is reported as synthetic even when it is also
	// unencodable: provenance is the more useful thing to say.
	assert.equal(built.excludedSynthetic, 2);
	assert.equal(built.excludedUnencodable, 2);
});

test("loraTapExclusion names the one reason a frame is left out", () => {
	assert.equal(loraTapExclusion(frame()), null);
	assert.equal(loraTapExclusion(frame({ synthetic: true })), "synthetic");
	assert.equal(loraTapExclusion(frame({ bandwidthHz: 62_500 })), "unencodable");
	assert.equal(loraTapExclusion(frame({ bandwidthHz: 0 })), "unencodable");
	assert.equal(loraTapExclusion(frame({ capturedLength: 256 })), "unencodable");
	assert.equal(loraTapExclusion(frame({ originalLength: 2 })), "unencodable");
	// 125 kHz steps up to the byte's limit are all fine.
	assert.equal(loraTapExclusion(frame({ bandwidthHz: 125_000 })), null);
	assert.equal(loraTapExclusion(frame({ bandwidthHz: 500_000 })), null);
	assert.equal(
		loraTapExclusion(frame({ bandwidthHz: 256 * 125_000 })),
		"unencodable",
	);
});

// ── a live session's raw records ────────────────────────────────────────

test("a device record exports to the same pcap bytes as a decoded frame", () => {
	// The whole path an operator uses: bytes off the USB link, through the
	// capture format, out as the file Wireshark opens.
	const res = buildLoraTapPcap({ frames: sessionFrames([record()]) });
	assert.deepEqual([...res.bytes], GOLDEN_PCAP);
});

test("decoding a session names the device's numeric enums", () => {
	const [f] = sessionFrames([
		record({ metadataFlags: LSCAP_METADATA_FLAG.synthetic }),
	]);
	assert.equal(f.sequence, 1n);
	assert.equal(f.direction, "rx");
	assert.equal(f.crc, "valid");
	assert.equal(f.modulation, "lora");
	assert.equal(f.rssiDbm, -100, "x10 fixed point comes back as dBm");
	assert.equal(f.snrDb, -7);
	assert.equal(f.synthetic, true, "the device's provenance flag survives");
	assert.deepEqual([...f.bytes], [0xde, 0xad, 0xbe]);
});

test("a session's pcap count matches what building it would write", () => {
	// sessionPcapCounts reads the raw records directly so a live table can be
	// relabelled on every frame; this pins it to the writer's own verdict.
	const records = [
		record({ seq: 1 }),
		record({ seq: 2, metadataFlags: LSCAP_METADATA_FLAG.synthetic }),
		record({ seq: 3, bandwidthHz: 62_500 }),
		record({ seq: 4, bandwidthHz: 0 }),
		record({ seq: 5 }),
		// The device reports a shorter on-air length than it kept; buildLscap
		// raises it to the captured length, so this stays encodable.
		record({ seq: 6, originalLength: 1 }),
	];
	const built = buildLoraTapPcap({ frames: sessionFrames(records) });
	assert.deepEqual(sessionPcapCounts(records), {
		written: built.written,
		excludedSynthetic: built.excludedSynthetic,
		excludedUnencodable: built.excludedUnencodable,
	});
	assert.equal(built.written, 3);
	assert.equal(built.excludedSynthetic, 1);
	assert.equal(built.excludedUnencodable, 2);
});

test("an empty session still counts to zero rather than throwing", () => {
	assert.deepEqual(sessionPcapCounts([]), {
		written: 0,
		excludedSynthetic: 0,
		excludedUnencodable: 0,
	});
	assert.deepEqual(sessionFrames([]), []);
});

// ── shared rows ─────────────────────────────────────────────────────────

test("rows decode the on-screen columns, nulling unreported fields", () => {
	const rows = buildExportRows({
		frames: [
			frame({
				bytes: shelbyPointerBytes(),
				capturedLength: SHELBY_POINTER_SIZE,
				originalLength: SHELBY_POINTER_SIZE,
			}),
			frame({
				sequence: 2n,
				timestampUs: 3_734_567n,
				presentFields: RF_FIELD.timestamp,
				synthetic: true,
				crc: "invalid",
			}),
		],
	});
	assert.equal(rows.length, 2);
	assert.equal(rows[0].seq, 1);
	assert.equal(rows[0].time, 0, "time is measured from the first frame");
	assert.equal(rows[0].dir, "rx");
	assert.equal(rows[0].len, SHELBY_POINTER_SIZE);
	assert.equal(rows[0].freq, 915_000_000);
	assert.equal(rows[0].bw, 250_000);
	assert.equal(rows[0].sf, 10);
	assert.equal(rows[0].cr, 5);
	assert.equal(rows[0].rssi, -100);
	assert.equal(rows[0].snr, -7);
	assert.equal(rows[0].crc, "valid");
	assert.equal(rows[0].protocol, "Meshtastic");
	assert.equal(rows[0].pointer, true, "embedded Shelby pointer is flagged");
	assert.equal(rows[0].synthetic, false);

	assert.equal(rows[1].time, 2.5);
	assert.equal(rows[1].freq, null, "unreported frequency stays null");
	assert.equal(rows[1].rssi, null);
	assert.equal(rows[1].snr, null);
	assert.equal(rows[1].protocol, "Unknown", "no profile field, no label");
	assert.equal(rows[1].pointer, false);
	assert.equal(rows[1].synthetic, true, "provenance survives the row");
});

test("protocol labels mirror the firmware's builtin profile table", () => {
	const label = (profileId: number) => protocolLabel(frame({ profileId }));
	assert.equal(label(1), "Meshtastic");
	assert.equal(label(2), "MeshCore");
	assert.equal(label(3), "MeshCore");
	// Profile 4 is MESHTASTIC BAY MF on this firmware, not the RNode
	// example it was upstream. An export carries these labels into a file
	// somebody keeps, so a wrong one outlives the session that wrote it.
	assert.equal(label(4), "Meshtastic");
	assert.equal(label(5), "Reticulum");
	assert.equal(label(0), "Unknown");
	assert.equal(label(9), "Custom");
});

test("an explicit time reference keeps filtered exports on one clock", () => {
	const rows = buildExportRows({
		frames: [frame({ timestampUs: 5_000_000n })],
		timeReferenceUs: 1_000_000n,
	});
	assert.equal(rows[0].time, 4);
});

// ── CSV ─────────────────────────────────────────────────────────────────

test("CSV carries a header row and one line per frame, CRLF-terminated", () => {
	const csv = buildCsv({
		frames: [
			frame(),
			frame({ sequence: 2n, synthetic: true, presentFields: 0 }),
		],
	});
	const lines = csv.split("\r\n");
	assert.equal(lines[0], EXPORT_COLUMNS.join(","));
	assert.equal(
		lines[0],
		"seq,time,dir,len,freq,bw,sf,cr,rssi,snr,crc,protocol,pointer,synthetic",
	);
	assert.equal(
		lines[1],
		"1,0,rx,3,915000000,250000,10,5,-100,-7,valid,Meshtastic,false,false",
	);
	// Unreported fields are empty cells; the synthetic flag still reads true.
	assert.equal(lines[2], "2,0,rx,3,,,10,5,,,valid,Unknown,false,true");
	assert.equal(lines[3], "", "document ends with a final CRLF");
	assert.equal(lines.length, 4);
});

test("CSV quoting follows RFC 4180 on every edge", () => {
	assert.equal(csvField("plain"), "plain");
	assert.equal(csvField(""), "");
	assert.equal(csvField("a,b"), '"a,b"');
	assert.equal(csvField('say "hi"'), '"say ""hi"""');
	assert.equal(csvField("line\nbreak"), '"line\nbreak"');
	assert.equal(csvField("line\r\nbreak"), '"line\r\nbreak"');
	assert.equal(csvField('",\n'), '""",\n"');
});

// ── JSON ────────────────────────────────────────────────────────────────

test("JSON rows carry every column on every object", () => {
	const parsed = JSON.parse(
		buildJson({
			frames: [
				frame(),
				frame({ sequence: 2n, synthetic: true, presentFields: 0 }),
			],
		}),
	) as Record<string, unknown>[];
	assert.equal(parsed.length, 2);
	for (const row of parsed) {
		assert.deepEqual(
			Object.keys(row).sort(),
			[...EXPORT_COLUMNS].sort(),
			"same shape on every row, nulls instead of missing keys",
		);
	}
	assert.equal(parsed[0].synthetic, false);
	assert.equal(parsed[1].synthetic, true, "provenance survives JSON");
	assert.equal(parsed[1].freq, null);
	assert.equal(parsed[1].rssi, null);
});

// ── per-frame notes ─────────────────────────────────────────────────────

test("without annotations the CSV and JSON are exactly what they always were", () => {
	// The note column is additive by construction: an export that was never
	// handed annotations must not grow a column of empty cells.
	const frames = [frame(), frame({ sequence: 2n })];
	assert.equal(buildCsv({ frames }).split("\r\n")[0], EXPORT_COLUMNS.join(","));
	const parsed = JSON.parse(buildJson({ frames })) as Record<string, unknown>[];
	for (const row of parsed) {
		assert.ok(!("note" in row), "no note key without annotations");
	}
	assert.deepEqual(exportColumns({ frames }), EXPORT_COLUMNS);
});

test("annotations add one column, keyed by the frame itself", () => {
	const frames = [frame(), frame({ sequence: 2n })];
	const annotations = new Map([[frames[0], 'interferer starts, "loud"']]);
	assert.deepEqual(
		exportColumns({ frames, annotations }),
		ANNOTATED_EXPORT_COLUMNS,
	);

	const lines = buildCsv({ frames, annotations }).split("\r\n");
	assert.equal(lines[0], `${EXPORT_COLUMNS.join(",")},note`);
	assert.ok(
		lines[1].endsWith(',"interferer starts, ""loud"""'),
		`annotated row quotes its note: ${lines[1]}`,
	);
	// A frame with no note gets an empty cell, not the word "null".
	assert.ok(lines[2].endsWith(",false,"), `unannotated row: ${lines[2]}`);

	const parsed = JSON.parse(buildJson({ frames, annotations })) as Record<
		string,
		unknown
	>[];
	assert.equal(parsed[0].note, 'interferer starts, "loud"');
	assert.equal(parsed[1].note, null, "unannotated frames carry null, not ''");
	for (const row of parsed) {
		assert.deepEqual(
			Object.keys(row).sort(),
			[...ANNOTATED_EXPORT_COLUMNS].sort(),
		);
	}
});

test("a note for a frame outside the export simply does not appear", () => {
	// A note held against a frame that is not being exported. Keyed by object,
	// "not being exported" is simply "not a key anything looks up".
	const absent = frame({ sequence: 999n });
	const rows = buildExportRows({
		frames: [frame()],
		annotations: new Map([[absent, "about a frame that is not here"]]),
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0].note, null);
});

test("pcap carries no note channel, so annotations change nothing", () => {
	// LoRaTap v0 has no field for a note, exactly as it has none for
	// provenance; the writer must not invent one.
	const frames = [frame()];
	const plain = buildLoraTapPcap({ frames });
	const annotated = buildLoraTapPcap({
		frames,
		annotations: new Map([[frames[0], "interferer starts"]]),
	});
	assert.deepEqual(annotated.bytes, plain.bytes);
	assert.equal(annotated.written, plain.written);
});
