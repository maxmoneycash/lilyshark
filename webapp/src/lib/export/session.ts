/**
 * Bridge from a live listening session to the exporters.
 *
 * The device link hands the browser `RawFrameFields` — the record fields as
 * they came off the cable. The exporters want `LscapFrame`, the decoded shape
 * a parsed capture file yields. Rather than map the two across by hand, this
 * runs the session through the capture format itself: whatever SAVE CAPTURE
 * would write is exactly what the CSV, JSON and pcap then describe, and the
 * tables that turn the device's numeric direction, CRC and modulation into
 * names stay in one place (parseLscap) instead of two that can drift.
 */
import type { RawFrameFields } from "../deviceLink";
import { LSCAP_METADATA_FLAG, type LscapFrame, parseLscap } from "../lscap";
import { buildLscap } from "../lscapWrite";
import {
	countLoraTapPcap,
	type LoraTapCounts,
	type LoraTapEncodable,
} from "./loratap";

/** Decode a session's raw records into the frames every writer takes. */
export function sessionFrames(
	records: readonly RawFrameFields[],
): LscapFrame[] {
	// buildLscap sizes its output exactly, so the buffer holds the capture and
	// nothing else; the cast is the one the DOM's ArrayBufferLike forces.
	const bytes = buildLscap([...records]);
	return parseLscap(bytes.buffer as ArrayBuffer).frames;
}

/**
 * The pcap's own view of a raw record: the four fields LoRaTap's rules look
 * at, derived the same way buildLscap derives them for the file. Kept in step
 * with buildLscap by a test that compares these counts against a real build.
 */
function loraTapView(record: RawFrameFields): LoraTapEncodable {
	const captured = record.bytes.length;
	return {
		synthetic: (record.metadataFlags & LSCAP_METADATA_FLAG.synthetic) !== 0,
		bandwidthHz: record.bandwidthHz >>> 0,
		capturedLength: captured,
		originalLength: Math.min(Math.max(record.originalLength, captured), 0xffff),
	};
}

/**
 * How many of a session's frames a pcap would actually hold. The sniffer puts
 * this number on the download button, so it must be the count of records the
 * file will contain rather than the count of frames on screen.
 */
export function sessionPcapCounts(
	records: readonly RawFrameFields[],
): LoraTapCounts {
	return countLoraTapPcap(records.map(loraTapView));
}
