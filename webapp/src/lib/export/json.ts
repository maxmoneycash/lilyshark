/**
 * JSON export of the decoded frame table: an array of plain objects, one
 * per frame, carrying exactly the shared export columns. Fields the radio
 * did not report are `null`, never omitted, so every object has the same
 * shape and a pandas/`jq` consumer never needs per-row key checks.
 *
 * An export given annotations (UI-010) carries one more key, `note`, on every
 * object — null on a frame that has none. Without annotations the key is
 * absent everywhere, so an unannotated document is unchanged.
 */
import { buildExportRows, type ExportOptions } from "./rows";

/** Build the complete JSON document (pretty-printed, trailing newline). */
export function buildJson(options: ExportOptions): string {
	return `${JSON.stringify(buildExportRows(options), null, 2)}\n`;
}
