/**
 * Hand a finished export to the browser as a file download.
 *
 * A web page never learns where the file landed, so the filename it asked
 * for is the only confirmation a caller can report back to the operator.
 */

/** What tcpdump, Wireshark and the IANA registry agree a .pcap is. */
export const PCAP_MIME = "application/vnd.tcpdump.pcap";
export const CSV_MIME = "text/csv;charset=utf-8";
export const JSON_MIME = "application/json;charset=utf-8";

export function downloadFile(
	filename: string,
	data: string | Uint8Array,
	mimeType: string,
): void {
	// The DOM lib types a Blob part's array view as ArrayBuffer-backed while a
	// plain Uint8Array is typed over ArrayBufferLike, so the two only differ
	// for a SharedArrayBuffer — which nothing here can produce. Blob itself
	// takes the array at runtime either way.
	const url = URL.createObjectURL(
		new Blob([data as BlobPart], { type: mimeType }),
	);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	// Firefox only follows the click when the anchor is in the document.
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoking in the same tick races the download the click just started, and
	// the browser then saves an empty file.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
