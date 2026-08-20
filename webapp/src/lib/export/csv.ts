/**
 * CSV export of the decoded frame table — one row per frame, the same
 * columns the Traffic view shows, RFC 4180 throughout: CRLF line endings, a
 * header row, and quoting only where a field needs it.
 */
import {
	buildExportRows,
	EXPORT_COLUMNS,
	type ExportOptions,
	type ExportRow,
} from "./rows";

/**
 * RFC 4180 field encoding: fields containing a comma, a double quote, or a
 * line break are wrapped in double quotes, and embedded double quotes are
 * doubled. Everything else passes through unquoted.
 */
export function csvField(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function cell(value: ExportRow[keyof ExportRow]): string {
	if (value === null) return ""; // field not reported by the radio
	return csvField(String(value));
}

/** Build the complete CSV document, header row included. */
export function buildCsv(options: ExportOptions): string {
	const lines = [EXPORT_COLUMNS.join(",")];
	for (const row of buildExportRows(options)) {
		lines.push(EXPORT_COLUMNS.map((column) => cell(row[column])).join(","));
	}
	return `${lines.join("\r\n")}\r\n`;
}
