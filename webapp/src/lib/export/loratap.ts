/**
 * Classic pcap (DLT 270, LoRaTap v0) writer.
 *
 * Byte-for-byte compatible with the firmware writer in
 * src/export/pcap_loratap.cpp — the golden bytes in export.test.ts are
 * lifted from that writer's own tests in test/pcap_export/. Keep the two in
 * step: the pcap record header is little-endian, the LoRaTap fields are
 * big-endian, and every unit conversion below mirrors the C++ exactly.
 *
 * Timestamps: `ts_sec`/`ts_usec` are the record's boot-relative monotonic
 * microsecond clock split into seconds and microseconds, exactly as the
 * firmware writes them. They are NOT Unix wall time — the T-Deck has no
 * reliable RTC (see docs/lilyshark-capture-format.md).
 *
 * Provenance: LoRaTap v0 has no standards-compatible provenance field, so
 * pcap has no channel to carry the synthetic marker. Mirroring the firmware
 * (PcapWriteResult::SyntheticFrame), synthetic frames are EXCLUDED from the
 * pcap and counted in the result so the caller can surface the omission.
 *
 * CRC state is likewise not flagged: the 15-byte LoRaTap v0 header carries
 * no CRC field, and the firmware writes valid and invalid frames alike.
 */
import { hasField, type LscapFrame, RF_FIELD } from "../lscap";
import type { ExportOptions } from "./rows";

/** DLT_LORATAP. */
export const PCAP_LORATAP_LINK_TYPE = 270;
/** kLoraTapV0HeaderSize in include/lilyshark/export/pcap_loratap.h. */
export const LORATAP_V0_HEADER_SIZE = 15;
/** kMaxFrameBytes in include/lilyshark/core/raw_frame.h. */
export const MAX_FRAME_BYTES = 255;
/** kPcapCaptureLength: LoRaTap header + max payload. Coincidentally 270. */
export const PCAP_SNAPLEN = LORATAP_V0_HEADER_SIZE + MAX_FRAME_BYTES;

const PCAP_GLOBAL_HEADER_SIZE = 24;
const PCAP_RECORD_HEADER_SIZE = 16;
const BANDWIDTH_STEP_HZ = 125_000;

export interface LoraTapPcapResult {
	bytes: Uint8Array;
	/** Frames written as pcap records. */
	written: number;
	/**
	 * Synthetic frames omitted because pcap/LoRaTap v0 has no provenance
	 * channel — surface this count next to the download.
	 */
	excludedSynthetic: number;
	/**
	 * Frames LoRaTap v0 cannot represent: bandwidth that is zero or not a
	 * multiple of 125 kHz (e.g. MeshCore's 62.5 kHz profile), a payload over
	 * 255 bytes, or an original length shorter than the captured length. The
	 * firmware rejects the same frames (InvalidBandwidth / InvalidFrame).
	 */
	excludedUnencodable: number;
}

/** C++ divideRounded: integer division, half away from zero. */
function divideRounded(numerator: number, denominator: number): number {
	const half = Math.trunc(denominator / 2);
	return Math.trunc(
		(numerator >= 0 ? numerator + half : numerator - half) / denominator,
	);
}

/**
 * LoRaTap packet_rssi: dBm + 139, clamped to 0..254; 255 means unknown.
 * Transmitted frames report no receive RSSI, so they encode as unknown —
 * same rule as encodeRssi() in pcap_loratap.cpp. The frame's dBm value is
 * first restored to the format's x10 fixed point so the rounding matches
 * the firmware bit for bit.
 */
function encodeRssi(frame: LscapFrame): number {
	if (frame.direction === "tx" || !hasField(frame, RF_FIELD.rssi)) return 255;
	const x10 = Math.round(frame.rssiDbm * 10);
	const encoded = divideRounded(x10, 10) + 139;
	return Math.max(0, Math.min(254, encoded));
}

/** LoRaTap snr: signed quarter-dB two's complement; 0 when not reported. */
function encodeSnr(frame: LscapFrame): number {
	if (!hasField(frame, RF_FIELD.snr)) return 0;
	const x10 = Math.round(frame.snrDb * 10);
	const quarterDb = Math.max(-128, Math.min(127, divideRounded(x10 * 2, 5)));
	return quarterDb & 0xff;
}

/**
 * LoRaTap has one sync byte; a two-byte sync word (SX126x style, e.g.
 * MeshCore's 0x1424) is folded to its high nibbles (0x1424 -> 0x12),
 * matching encodeSyncWord() in pcap_loratap.cpp.
 */
function encodeSyncWord(syncWord: number): number {
	if (syncWord <= 0xff) return syncWord;
	const high = (syncWord >> 8) & 0xff;
	const low = syncWord & 0xff;
	return (high & 0xf0) | ((low & 0xf0) >> 4);
}

/** Bandwidth in 125 kHz steps, or null when LoRaTap v0 cannot encode it. */
function bandwidthCode(bandwidthHz: number): number | null {
	if (bandwidthHz === 0 || bandwidthHz % BANDWIDTH_STEP_HZ !== 0) return null;
	const steps = bandwidthHz / BANDWIDTH_STEP_HZ;
	return steps > 0 && steps <= 255 ? steps : null;
}

/**
 * Build a complete pcap file from the (pre-filtered) frames. Synthetic and
 * unencodable frames are skipped and counted, never written — the returned
 * bytes always form a valid capture of the remaining frames.
 */
export function buildLoraTapPcap(options: ExportOptions): LoraTapPcapResult {
	const records: Uint8Array[] = [];
	let written = 0;
	let excludedSynthetic = 0;
	let excludedUnencodable = 0;

	for (const frame of options.frames) {
		if (frame.synthetic) {
			excludedSynthetic++;
			continue;
		}
		const bandwidth = bandwidthCode(frame.bandwidthHz);
		if (
			bandwidth === null ||
			frame.capturedLength > MAX_FRAME_BYTES ||
			frame.originalLength < frame.capturedLength
		) {
			excludedUnencodable++;
			continue;
		}

		const record = new Uint8Array(
			PCAP_RECORD_HEADER_SIZE + LORATAP_V0_HEADER_SIZE + frame.capturedLength,
		);
		const view = new DataView(record.buffer);

		// Record header, little-endian: the boot-relative clock split into
		// seconds and microseconds, then lengths including the LoRaTap header.
		const seconds = frame.timestampUs / 1_000_000n;
		view.setUint32(
			0,
			Number(seconds > 0xffff_ffffn ? 0xffff_ffffn : seconds),
			true,
		);
		view.setUint32(4, Number(frame.timestampUs % 1_000_000n), true);
		view.setUint32(8, LORATAP_V0_HEADER_SIZE + frame.capturedLength, true);
		view.setUint32(12, LORATAP_V0_HEADER_SIZE + frame.originalLength, true);

		// LoRaTap v0 header, big-endian fields.
		const lt = PCAP_RECORD_HEADER_SIZE;
		view.setUint8(lt + 0, 0); // lt_version
		view.setUint8(lt + 1, 0); // lt_padding
		view.setUint16(lt + 2, LORATAP_V0_HEADER_SIZE, false); // lt_length
		view.setUint32(lt + 4, frame.centerFrequencyHz, false);
		view.setUint8(lt + 8, bandwidth);
		view.setUint8(lt + 9, frame.spreadingFactor);
		view.setUint8(lt + 10, encodeRssi(frame));
		view.setUint8(lt + 11, 255); // max_rssi: not tracked
		view.setUint8(lt + 12, 255); // current_rssi: not tracked
		view.setUint8(lt + 13, encodeSnr(frame));
		view.setUint8(lt + 14, encodeSyncWord(frame.syncWord));

		record.set(frame.bytes, lt + LORATAP_V0_HEADER_SIZE);
		records.push(record);
		written++;
	}

	const total = records.reduce((n, r) => n + r.length, PCAP_GLOBAL_HEADER_SIZE);
	const bytes = new Uint8Array(total);
	const header = new DataView(bytes.buffer, 0, PCAP_GLOBAL_HEADER_SIZE);
	// Classic pcap, little-endian, v2.4, zone/sigfigs 0, snaplen and link 270.
	header.setUint32(0, 0xa1b2c3d4, true);
	header.setUint16(4, 2, true);
	header.setUint16(6, 4, true);
	header.setUint32(8, 0, true);
	header.setUint32(12, 0, true);
	header.setUint32(16, PCAP_SNAPLEN, true);
	header.setUint32(20, PCAP_LORATAP_LINK_TYPE, true);

	let offset = PCAP_GLOBAL_HEADER_SIZE;
	for (const record of records) {
		bytes.set(record, offset);
		offset += record.length;
	}

	return { bytes, written, excludedSynthetic, excludedUnencodable };
}
