/**
 * Shared shapes for the browser-side exporters.
 *
 * Every writer receives the same options object and the caller passes frames
 * that are ALREADY filtered — whatever display filter or selection is active
 * on screen has been applied before export, so the writers never re-filter
 * (except for the pcap writer's synthetic exclusion, which is a format
 * limitation, not a filter — see loratap.ts).
 */
import { profileProtocol, type ProfileProtocol } from "../profileProtocol";
import {
	findShelbyPointer,
	hasField,
	type LscapFrame,
	RF_FIELD,
} from "../lscap";

export interface ExportOptions {
	/** Frames to export, already filtered by the caller. */
	frames: LscapFrame[];
	/**
	 * Per-frame notes, keyed by the FRAME OBJECT being exported.
	 *
	 * Not by sequence number. A sequence number is unique only within one run
	 * of one radio, and the sniffer ring deliberately survives unplugging the
	 * deck, so two frames in one export can carry the same sequence and be
	 * entirely different bytes. Keyed by sequence, a note written on the first
	 * was written into BOTH rows -- an operator's words exported against bytes
	 * they never saw, which is the one thing an evidence export must not do.
	 * annotations.ts checks each frame's witness; an object key is what makes
	 * that check survive to here.
	 *
	 * Supplying this adds one `note` column to the CSV and
	 * JSON; omitting it leaves both formats byte-identical to what they wrote
	 * without notes, so an un-annotated export never grows a column of empty
	 * cells. pcap takes no notes at all: LoRaTap v0 has no channel to carry
	 * one, exactly as it has none for the synthetic marker (see loratap.ts),
	 * and inventing one would break the format.
	 */
	annotations?: ReadonlyMap<LscapFrame, string>;
	/**
	 * Timestamp the `time` column is measured from. Defaults to the first
	 * frame's timestamp, matching the on-screen relative clock. Pass the
	 * unfiltered capture's first timestamp to keep exported times aligned
	 * with the full capture when the frame list is filtered.
	 */
	timeReferenceUs?: bigint;
}

/**
 * One decoded frame, as the frame table shows it. This is the row shape both
 * the CSV and JSON writers emit; keeping it in one place keeps the two
 * formats carrying identical columns.
 *
 * `null` means the radio did not report the field (its RF_FIELD bit is
 * clear) — CSV renders that as an empty cell, JSON keeps the null.
 */
export interface ExportRow {
	seq: number;
	/** Seconds since the time reference (capture start by default). */
	time: number;
	dir: "unknown" | "rx" | "tx";
	/** Captured payload length in bytes. */
	len: number;
	/** Center frequency in Hz, or null when not reported. */
	freq: number | null;
	/** Bandwidth in Hz, or null when not reported. */
	bw: number | null;
	sf: number;
	cr: number;
	/** RSSI in dBm, or null when not reported. */
	rssi: number | null;
	/** SNR in dB, or null when not reported. */
	snr: number | null;
	crc: "unknown" | "absent" | "valid" | "invalid";
	/** Protocol label derived from the capture profile. */
	protocol: string;
	/** True when the payload carries an embedded Shelby pointer. */
	pointer: boolean;
	/** Provenance: true when the frame was generated, not received OTA. */
	synthetic: boolean;
	/**
	 * The frame's note — present only when the export was given annotations,
	 * `null` on an unannotated frame of an annotated export.
	 */
	note?: string | null;
}

/** Column order shared by the CSV header and the JSON objects. */
export const EXPORT_COLUMNS: readonly (keyof ExportRow)[] = [
	"seq",
	"time",
	"dir",
	"len",
	"freq",
	"bw",
	"sf",
	"cr",
	"rssi",
	"snr",
	"crc",
	"protocol",
	"pointer",
	"synthetic",
] as const;

/**
 * The same columns plus the note, used only when the caller supplies
 * annotations. Additive by construction: an export without them writes
 * EXPORT_COLUMNS and nothing else, so every existing consumer's column list
 * is unchanged.
 */
export const ANNOTATED_EXPORT_COLUMNS: readonly (keyof ExportRow)[] = [
	...EXPORT_COLUMNS,
	"note",
] as const;

/** Which columns this export writes — the note one only if asked. */
export function exportColumns(
	options: ExportOptions,
): readonly (keyof ExportRow)[] {
	return options.annotations !== undefined
		? ANNOTATED_EXPORT_COLUMNS
		: EXPORT_COLUMNS;
}

/**
 * Protocol label for a frame, from its capture profile ID. Mirrors the
 * builtin profile table in src/core/builtin_profiles.cpp: IDs 1-5 are the
 * firmware's shipped profiles, anything else a user-defined one (the
 * firmware's ProtocolId::Custom). A frame that never reported its profile
 * stays "Unknown".
 */
export function protocolLabel(frame: LscapFrame): string {
	if (!hasField(frame, RF_FIELD.profile)) return "Unknown";
	// Derived, never re-tabulated. This was the fourth hand-written copy of
	// the profile table, and like the other three it said profile 4 was
	// Reticulum -- true of the firmware it was written against, false here,
	// where profile 4 is MESHTASTIC BAY MF. Exports carry these labels into
	// files people keep, so a wrong one outlives the session that made it.
	const display: Record<ProfileProtocol, string> = {
		meshtastic: "Meshtastic",
		meshcore: "MeshCore",
		reticulum: "Reticulum",
		custom: "Custom",
		unknown: "Unknown",
	};
	return display[profileProtocol(frame.profileId)];
}

/** Decode the frames of an export into the shared row shape. */
export function buildExportRows(options: ExportOptions): ExportRow[] {
	const { frames, annotations } = options;
	const referenceUs = options.timeReferenceUs ?? frames[0]?.timestampUs ?? 0n;
	return frames.map((f) => ({
		seq: Number(f.sequence),
		time: Number(f.timestampUs - referenceUs) / 1e6,
		dir: f.direction,
		len: f.capturedLength,
		freq: hasField(f, RF_FIELD.frequency) ? f.centerFrequencyHz : null,
		bw: hasField(f, RF_FIELD.bandwidth) ? f.bandwidthHz : null,
		sf: f.spreadingFactor,
		cr: f.codingRateDenominator,
		rssi: hasField(f, RF_FIELD.rssi) ? f.rssiDbm : null,
		snr: hasField(f, RF_FIELD.snr) ? f.snrDb : null,
		crc: f.crc,
		protocol: protocolLabel(f),
		pointer: findShelbyPointer(f.bytes) !== null,
		synthetic: f.synthetic,
		// Present only in an annotated export, and null — never "" — on a frame
		// that carries no note, the same way an unreported radio field is null.
		...(annotations !== undefined
			? { note: annotations.get(f) ?? null }
			: null),
	}));
}
