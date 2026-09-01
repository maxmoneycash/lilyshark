/**
 * CSV export of the decoded frame table — one row per frame, the same
 * columns the Traffic view shows, RFC 4180 throughout: CRLF line endings, a
 * header row, and quoting only where a field needs it.
 */
import {
	buildExportRows,
	type ExportOptions,
	type ExportRow,
	exportColumns,
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
	// Null is a field the radio did not report; undefined is a column this
	// export does not carry at all. Both are an empty cell, never a "null".
	if (value === null || value === undefined) return "";
	return csvField(String(value));
}

/**
 * Build the complete CSV document, header row included. The columns are the
 * shared set, plus `note` only when the caller supplied annotations (UI-010)
 * — an export without them is byte-identical to what this always wrote.
 */
export function buildCsv(options: ExportOptions): string {
	const columns = exportColumns(options);
	const lines = [columns.join(",")];
	for (const row of buildExportRows(options)) {
		lines.push(columns.map((column) => cell(row[column])).join(","));
	}
	return `${lines.join("\r\n")}\r\n`;
}
