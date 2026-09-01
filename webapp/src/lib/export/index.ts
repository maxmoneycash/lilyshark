/**
 * Browser-side exporters (UI-006). All three writers take the same
 * ExportOptions whose frame array is already filtered by the caller.
 *
 *   buildLoraTapPcap — classic pcap, DLT 270 LoRaTap v0, byte-compatible
 *                      with the firmware writer (synthetic frames excluded
 *                      and counted: pcap has no provenance channel, and none
 *                      for annotations either — they are simply not written)
 *   buildCsv         — decoded columns, RFC 4180
 *   buildJson        — the same columns as an array of objects
 *
 * CSV and JSON also carry frame annotations (UI-010) when the caller passes
 * `annotations`; without them both formats are byte-identical to what they
 * wrote before, so nothing downstream sees a column it did not ask for.
 */
export { buildCsv, csvField } from "./csv";
export { buildJson } from "./json";
export {
	buildLoraTapPcap,
	LORATAP_V0_HEADER_SIZE,
	type LoraTapPcapResult,
	MAX_FRAME_BYTES,
	PCAP_LORATAP_LINK_TYPE,
	PCAP_SNAPLEN,
} from "./loratap";
export {
	ANNOTATED_EXPORT_COLUMNS,
	buildExportRows,
	EXPORT_COLUMNS,
	type ExportOptions,
	type ExportRow,
	exportColumns,
	protocolLabel,
} from "./rows";
