/**
 * Shared shapes for the browser-side exporters.
 *
 * Every writer receives the same options object and the caller passes frames
 * that are ALREADY filtered — whatever display filter or selection is active
 * on screen has been applied before export, so the writers never re-filter
 * (except for the pcap writer's synthetic exclusion, which is a format
 * limitation, not a filter — see loratap.ts).
 */
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
	 * Timestamp the `time` column is measured from. Defaults to the first
	 * frame's timestamp, matching the on-screen relative clock. Pass the
	 * unfiltered capture's first timestamp to keep exported times aligned
	 * with the full capture when the frame list is filtered.
	 */
	timeReferenceUs?: bigint;
}

/**
 * One decoded frame, as the Traffic table shows it. This is the row shape
 * both the CSV and JSON writers emit; keeping it in one place keeps the two
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
 * Protocol label for a frame, from its capture profile ID. Mirrors the
 * builtin profile table in src/core/builtin_profiles.cpp: IDs 1-5 are the
 * firmware's shipped profiles, anything else a user-defined one (the
 * firmware's ProtocolId::Custom). A frame that never reported its profile
 * stays "Unknown".
 */
export function protocolLabel(frame: LscapFrame): string {
	if (!hasField(frame, RF_FIELD.profile)) return "Unknown";
	switch (frame.profileId) {
		case 0:
			return "Unknown";
		case 1:
			return "Meshtastic";
		case 2:
		case 3:
			return "MeshCore";
		case 4:
		case 5:
			return "Reticulum";
		default:
			return "Custom";
	}
}

/** Decode the frames of an export into the shared row shape. */
export function buildExportRows(options: ExportOptions): ExportRow[] {
	const { frames } = options;
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
	}));
}
