import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	useDeviceLink,
	type HeardFrame,
	type RawFrameFields,
} from "../../lib/deviceLink";
import { dissectFrame } from "../../lib/dissect/registry";
import type { FlatTreeRow } from "../../lib/dissect/tree";
import {
	byteRangeLabel,
	decodeSummary,
	deepestRowAt,
	flattenTree,
	frameProtocolHint,
	rowTrail,
	treeKeyNav,
} from "../../lib/dissect/tree";
import type { DissectNode, NodeTone } from "../../lib/dissect/types";
import {
	buildCsv,
	buildJson,
	buildLoraTapPcap,
	CSV_MIME,
	downloadFile,
	JSON_MIME,
	type LoraTapCounts,
	PCAP_MIME,
	sessionFrames,
	sessionPcapCounts,
} from "../../lib/export";
import { buildLscap } from "../../lib/lscapWrite";
import { permalinkUrl, snifferFrameHash } from "../../lib/permalink";
import {
	clearSnifferSession,
	setSnifferPaused,
	useSnifferSession,
} from "../../lib/snifferSession";
import { fmtMHz } from "../../lib/spectrum";
import {
	SPACER_CELL_STYLE,
	SPACER_ROW_STYLE,
	useRowWindow,
} from "../../lib/useRowWindow";
import { rowWindowPositions } from "../../lib/virtualRows";
import { stamp } from "../export";
import { hhmm, snrClass } from "../fmt";
import {
	type FrameLinkEvent,
	type FrameLinkState,
	frameLinkStep,
	INITIAL_FRAME_LINK,
} from "../frameLink";

const BROADCAST = 0xffffffff;

/**
 * Eight bytes to a row rather than the classic sixteen. The dump now sits
 * beside the dissection tree, and a sixteen-byte row is a fixed 74 monospace
 * columns wide — on a laptop that leaves the tree nothing to render into.
 */
const HEX_ROW_BYTES = 8;

/**
 * A tone marks a node that states a *limit* of decoding rather than a decoded
 * fact, so the colour has to read as "this is as far as anyone can see", not
 * as an accusation against the frame. Only "error" is a fault in the bytes.
 */
const TONE_COLOR: Record<NodeTone, string> = {
	error: "var(--err)",
	encrypted: "var(--warn)",
	opaque: "var(--warn)",
	raw: "var(--fg-dim)",
};

function nodeId(num: number): string {
	return `!${num.toString(16).padStart(8, "0")}`;
}

interface HexPaneProps {
	bytes: Uint8Array;
	/** The field under the cursor, or the one picked in the tree. */
	highlight: DissectNode | null;
	onHoverByte: (index: number | null) => void;
	onPickByte: (index: number) => void;
}

/**
 * The frame's bytes, with the highlighted field's range lit in both the hex
 * and the ASCII gutter.
 *
 * This does not use the shared hexDump() helper: that returns finished
 * strings, and highlighting needs every byte to be its own element. The row
 * shape is the same one hexDump() produces, at half the row width.
 *
 * The bytes are a pointing surface, not a keyboard one — the tree beside them
 * is a real ARIA tree and drives the same selection from the keyboard.
 */
function HexPane({ bytes, highlight, onHoverByte, onPickByte }: HexPaneProps) {
	const rowOffsets: number[] = [];
	for (let off = 0; off < bytes.length; off += HEX_ROW_BYTES) rowOffsets.push(off);

	const lit = (index: number): boolean =>
		highlight !== null &&
		highlight.byteLength > 0 &&
		index >= highlight.byteOffset &&
		index < highlight.byteOffset + highlight.byteLength;

	const cell = (index: number): CSSProperties =>
		lit(index)
			? { background: "var(--fg)", color: "var(--bg)", cursor: "pointer" }
			: { cursor: "pointer" };

	return (
		<div
			style={{ fontSize: 11, lineHeight: 1.7, whiteSpace: "pre" }}
			onMouseLeave={() => onHoverByte(null)}
		>
			{rowOffsets.map((off) => (
				<div key={off}>
					<span className="dim">{off.toString(16).padStart(4, "0")}</span>
					{"  "}
					{Array.from({ length: HEX_ROW_BYTES }, (_, i) => off + i).map((at) =>
						at < bytes.length ? (
							// The separator space rides inside the byte's own element so a
							// run of highlighted bytes reads as one bar, not a dotted line.
							<span
								key={`h${at}`}
								style={cell(at)}
								onMouseEnter={() => onHoverByte(at)}
								onClick={() => onPickByte(at)}
							>
								{`${bytes[at].toString(16).padStart(2, "0")} `}
							</span>
						) : (
							<span key={`h${at}`}>{"   "}</span>
						),
					)}
					{" |"}
					{Array.from({ length: HEX_ROW_BYTES }, (_, i) => off + i).map((at) =>
						at < bytes.length ? (
							<span
								key={`a${at}`}
								style={cell(at)}
								onMouseEnter={() => onHoverByte(at)}
								onClick={() => onPickByte(at)}
							>
								{bytes[at] >= 0x20 && bytes[at] < 0x7f
									? String.fromCharCode(bytes[at])
									: "."}
							</span>
						) : (
							<span key={`a${at}`}>{" "}</span>
						),
					)}
					{"|"}
				</div>
			))}
		</div>
	);
}

interface DissectTreeProps {
	rows: FlatTreeRow[];
	/** The field the user picked; its bytes stay lit while nothing is hovered. */
	selPath: string | null;
	/** Hovered if anything is, otherwise the picked field. */
	activePath: string | null;
	onSelect: (path: string) => void;
	onToggle: (path: string) => void;
	onHover: (path: string | null) => void;
}

function DissectTree({
	rows,
	selPath,
	activePath,
	onSelect,
	onToggle,
	onHover,
}: DissectTreeProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const rowRefs = useRef(new Map<string, HTMLDivElement>());
	// Roving tabindex: one stop for the whole tree, on the picked row or, with
	// nothing picked yet, on the root.
	const rovingPath = selPath ?? rows[0]?.path ?? null;

	// Follow the selection with DOM focus only while the tree already holds it,
	// so picking a field over in the hex dump never yanks focus out of the dump.
	useEffect(() => {
		const container = containerRef.current;
		if (selPath === null || container === null) return;
		if (!container.contains(document.activeElement)) return;
		rowRefs.current.get(selPath)?.focus();
	}, [selPath]);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (rovingPath === null) return;
		const move = treeKeyNav(rows, rovingPath, event.key);
		if (move === null) return;
		event.preventDefault();
		if (move.toggle) onToggle(move.path);
		onSelect(move.path);
	};

	// The rows carry aria-level/-selected/-expanded; the container is only the
	// tree's name and the one place the arrow keys are read.
	return (
		<div
			ref={containerRef}
			role="tree"
			aria-label="Protocol dissection"
			onKeyDown={onKeyDown}
			onMouseLeave={() => onHover(null)}
			style={{ fontSize: 11.5, lineHeight: 1.65 }}
		>
			{rows.map((row) => {
				const picked = row.path === selPath;
				const active = row.path === activePath;
				const tone = row.node.tone;
				return (
					<div
						key={row.path}
						ref={(element) => {
							if (element) rowRefs.current.set(row.path, element);
							else rowRefs.current.delete(row.path);
						}}
						role="treeitem"
						aria-level={row.depth + 1}
						aria-selected={picked}
						aria-expanded={row.hasChildren ? row.expanded : undefined}
						tabIndex={row.path === rovingPath ? 0 : -1}
						onClick={() => onSelect(row.path)}
						onMouseEnter={() => onHover(row.path)}
						style={{
							display: "flex",
							gap: 6,
							alignItems: "baseline",
							cursor: "pointer",
							padding: "1px 6px",
							paddingLeft: 6 + row.depth * 12,
							background: picked
								? "var(--fg)"
								: active
									? "color-mix(in srgb, var(--fg) 18%, transparent)"
									: undefined,
							color: picked ? "var(--bg)" : tone ? TONE_COLOR[tone] : undefined,
						}}
					>
						<span
							style={{
								width: 10,
								flexShrink: 0,
								// A leaf keeps the twisty's width so labels stay in a column.
								visibility: row.hasChildren ? "visible" : "hidden",
							}}
							onClick={(event) => {
								event.stopPropagation();
								if (row.hasChildren) onToggle(row.path);
							}}
						>
							{row.expanded ? "▾" : "▸"}
						</span>
						<span style={{ flexShrink: 0 }}>{row.node.label}</span>
						<span
							style={{
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								opacity: picked ? 1 : 0.72,
							}}
						>
							{row.node.value ?? ""}
						</span>
						<span style={{ flexShrink: 0, fontSize: 10, opacity: 0.7 }}>
							{byteRangeLabel(row.node)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** "1 FRAME", "2 FRAMES" — a count nobody has to squint at. */
function frameCount(n: number): string {
	return `${n} FRAME${n === 1 ? "" : "S"}`;
}

/** Columns in the live table, so a spacer row spans exactly the table. */
const TABLE_COLUMNS = 8;

interface FrameTableProps {
	/** The session's own order: oldest first. */
	frames: HeardFrame[];
	sel: HeardFrame | undefined;
	onPick: (frame: HeardFrame | undefined) => void;
}

/**
 * The live frame list, newest first.
 *
 * Only the rows the scrollport can show are mounted, with two spacers standing
 * in for the rest (lib/virtualRows.ts). The session is bounded at
 * SNIFFER_FRAME_LIMIT, so this is not the difference between working and not
 * the way it is on the TRAFFIC table — but a full ring is 500 rows of eight
 * cells rebuilt on every arriving frame, and a sniffer's whole job is to keep
 * up with the radio while someone reads it.
 *
 * The reversal is done by INDEX, not by reversing a copy of the list: position
 * 0 is the newest frame, which is `frames[frames.length - 1]`.
 */
function FrameTable({ frames, sel, onPick }: FrameTableProps) {
	const rows = useRowWindow(frames.length);
	const win = rows.win;
	const newest = frames.length - 1;

	return (
		<div className="scroll-y" ref={rows.scrollRef}>
			<table className="grid">
				<thead ref={rows.headRef}>
					<tr>
						<th>TIME</th>
						<th>FROM</th>
						<th>TO</th>
						<th>PROTOCOL</th>
						<th>TYPE</th>
						<th>RSSI</th>
						<th>SNR</th>
						<th>BYTES</th>
					</tr>
				</thead>
				<tbody>
					{win.topPadPx > 0 && (
						<tr aria-hidden="true" style={SPACER_ROW_STYLE}>
							<td
								colSpan={TABLE_COLUMNS}
								style={{ ...SPACER_CELL_STYLE, height: win.topPadPx }}
							/>
						</tr>
					)}
					{rowWindowPositions(win).map((position) => {
						const f = frames[newest - position];
						return (
							<tr
								key={`${f.atMs}:${f.src}:${position}`}
								ref={position === win.start ? rows.rowRef : undefined}
								className={f === sel ? "sel" : ""}
								onClick={() => onPick(f === sel ? undefined : f)}
							>
								<td>{hhmm(f.atMs)}</td>
								<td title={nodeId(f.src)}>{f.short ?? nodeId(f.src)}</td>
								<td>{f.dst === BROADCAST ? "ALL" : nodeId(f.dst)}</td>
								<td>{f.proto}</td>
								<td
									className={f.sim ? "warn" : ""}
									title={
										f.sim
											? "Synthetic frame from the device's simulate mode — not heard over the air"
											: undefined
									}
								>
									{f.kind}
									{f.sim && " · SYNTHETIC"}
								</td>
								<td>{(f.rssiX10 / 10).toFixed(1)}</td>
								<td className={snrClass(f.snrX10 / 10)}>
									{(f.snrX10 / 10).toFixed(1)}
								</td>
								<td className={f.raw ? "" : "dim"}>
									{f.raw ? f.raw.bytes.length : "—"}
								</td>
							</tr>
						);
					})}
					{win.bottomPadPx > 0 && (
						<tr aria-hidden="true" style={SPACER_ROW_STYLE}>
							<td
								colSpan={TABLE_COLUMNS}
								style={{ ...SPACER_CELL_STYLE, height: win.bottomPadPx }}
							/>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * What a pcap of this session will leave behind, in words, or "" when it
 * leaves nothing behind.
 *
 * Both omissions are properties of the format rather than faults in the
 * session: LoRaTap v0 has no channel to mark a frame as synthetic, and it
 * cannot encode a bandwidth that is not a whole number of 125 kHz steps —
 * MeshCore's 62.5 kHz profile is the one operators meet.
 */
function pcapOmissions(counts: LoraTapCounts): string {
	const parts: string[] = [];
	if (counts.excludedSynthetic > 0) {
		parts.push(`${counts.excludedSynthetic} SYNTHETIC`);
	}
	if (counts.excludedUnencodable > 0) {
		parts.push(`${counts.excludedUnencodable} THE FORMAT CANNOT CARRY`);
	}
	return parts.length === 0 ? "" : `PCAP LEAVES OUT ${parts.join(" AND ")}`;
}

/**
 * The three download buttons.
 *
 * Every label carries the number of frames that format will actually write,
 * so an empty or short file is visible before the click rather than after
 * opening it in Wireshark. The pcap's number is the smaller one whenever the
 * session heard something LoRaTap v0 cannot describe.
 */
function ExportButtons({
	records,
	onSaved,
}: {
	records: readonly RawFrameFields[];
	onSaved: (message: string) => void;
}) {
	// Counting goes through the same predicate the writer uses, so the number
	// on the button and the number of records in the file cannot drift apart.
	const pcap = useMemo(() => sessionPcapCounts(records), [records]);
	const omitted = pcapOmissions(pcap);

	const save = (format: "pcap" | "csv" | "json") => {
		// The session's raw records become decoded frames by way of the capture
		// format itself, so all three files describe exactly what SAVE CAPTURE
		// would have written.
		const decoded = sessionFrames(records);
		const name = `lilyshark-sniffer-${stamp()}`;
		if (format === "pcap") {
			const built = buildLoraTapPcap({ frames: decoded });
			downloadFile(`${name}.pcap`, built.bytes, PCAP_MIME);
			onSaved(`SAVED ${frameCount(built.written)} TO ${name}.pcap`);
			return;
		}
		const text =
			format === "csv"
				? buildCsv({ frames: decoded })
				: buildJson({ frames: decoded });
		downloadFile(
			`${name}.${format}`,
			text,
			format === "csv" ? CSV_MIME : JSON_MIME,
		);
		onSaved(`SAVED ${frameCount(decoded.length)} TO ${name}.${format}`);
	};

	return (
		<>
			<button
				disabled={pcap.written === 0}
				title="Download these frames as a LoRaTap pcap — the file Wireshark opens"
				onClick={() => save("pcap")}
			>
				⭳ PCAP ({frameCount(pcap.written)})
			</button>
			<button
				disabled={records.length === 0}
				title="Download one row per frame, with the columns of the table above — for a spreadsheet"
				onClick={() => save("csv")}
			>
				⭳ CSV ({frameCount(records.length)})
			</button>
			<button
				disabled={records.length === 0}
				title="Download those same columns as a JSON array — for a script"
				onClick={() => save("json")}
			>
				⭳ JSON ({frameCount(records.length)})
			</button>
			{omitted && (
				<span className="warn" style={{ fontSize: 11 }}>
					{omitted}
				</span>
			)}
		</>
	);
}

/**
 * Copy a link that reopens this screen with this frame selected.
 *
 * The address bar already holds that link, because picking the frame put it
 * there. So when the clipboard is refused — an insecure origin, or a browser
 * that wants a gesture it did not recognise — saying where the link already
 * is beats failing silently.
 */
function CopyFrameLink({ seq }: { seq: number | undefined }) {
	const [message, setMessage] = useState("");
	// The message belongs to the frame it was shown for, not to the pane.
	useEffect(() => {
		setMessage("");
	}, [seq]);

	if (seq === undefined) {
		// A dead button would say nothing about why it is dead, and the reason is
		// the frame's, not the operator's.
		return (
			<span className="dim" style={{ fontSize: 11 }}>
				This frame arrived without its raw record, so it carries no frame
				number a link could name.
			</span>
		);
	}

	const copy = async () => {
		const url = permalinkUrl(snifferFrameHash(seq), window.location.href);
		try {
			await navigator.clipboard.writeText(url);
			setMessage("LINK COPIED");
		} catch {
			setMessage("COULD NOT COPY — THE ADDRESS BAR HOLDS THE LINK");
		}
	};

	return (
		<>
			<button
				title="Copy a link that reopens this screen with this frame selected"
				style={{ fontSize: 10, letterSpacing: 1 }}
				onClick={() => void copy()}
			>
				COPY LINK
			</button>
			{message && (
				<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
					{message}
				</span>
			)}
		</>
	);
}

export default function Sniffer() {
	const link = useDeviceLink();
	const session = useSnifferSession();
	// The selected frame is held by reference, not by index: the ring shifts
	// under the table, and the detail pane should keep showing the frame that
	// was clicked even after it scrolls off the list.
	const [sel, setSel] = useState<HeardFrame | undefined>();
	const [exportMsg, setExportMsg] = useState("");
	// Dissection-pane state. Paths come from flattenTree and are stable for a
	// given dissection, so they are safe to hold across renders of one frame.
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [selPath, setSelPath] = useState<string | null>(null);
	const [hoverPath, setHoverPath] = useState<string | null>(null);

	const linked = link.status === "linked";
	const frames = session.frames;
	// Only a frame that arrived with its whole record can be written into any
	// capture format, or named by a link — the rest carry a decoded summary and
	// nothing else.
	const rawRecords = useMemo(
		() => frames.flatMap((f) => (f.raw ? [f.raw] : [])),
		[frames],
	);
	const seqs = useMemo(() => rawRecords.map((r) => r.seq), [rawRecords]);

	// The link machine's state is read by handlers and effects and rendered by
	// nothing, so it lives in a ref: keeping it in state would re-render the
	// whole table for a change no pixel depends on. These two refs let a
	// listener registered once at mount still see the current list.
	const linkRef = useRef<FrameLinkState>(INITIAL_FRAME_LINK);
	const framesRef = useRef(frames);
	framesRef.current = frames;
	const seqsRef = useRef(seqs);
	seqsRef.current = seqs;

	const dispatch = useCallback((event: FrameLinkEvent) => {
		const step = frameLinkStep(linkRef.current, event);
		linkRef.current = step.state;
		if (step.hash !== null) {
			// replaceState rather than assigning location.hash: this is the screen
			// the operator is already on, not a place to go back to, and assigning
			// would fire the hashchange the router and this screen both listen on.
			window.history.replaceState(
				null,
				"",
				permalinkUrl(step.hash, window.location.href),
			);
		}
		if (step.select !== undefined) {
			const hit = framesRef.current.find((f) => f.raw?.seq === step.select);
			if (hit) setSel(hit);
		}
	}, []);

	// Every selection the operator makes goes through here, and only these
	// reach the address bar. A frame opened by a link is set straight from
	// dispatch instead, because the hash it came from already names it.
	const pickFrame = useCallback(
		(frame: HeardFrame | undefined) => {
			setSel(frame);
			dispatch({
				kind: "pick",
				hash: window.location.hash,
				seq: frame?.raw?.seq ?? null,
			});
		},
		[dispatch],
	);

	// The hash the tab was opened with and one pasted into it later are the
	// same event, read by the same function: a permalink dropped into an
	// already-open tab changes the hash without reloading, and a screen that
	// read it only at mount would ignore it.
	useEffect(() => {
		const read = () => {
			dispatch({ kind: "url", hash: window.location.hash });
			dispatch({ kind: "frames", seqs: seqsRef.current });
		};
		read();
		window.addEventListener("hashchange", read);
		return () => window.removeEventListener("hashchange", read);
	}, [dispatch]);

	// A link opened before its frame was heard waits; this is where the wait
	// ends.
	useEffect(() => {
		dispatch({ kind: "frames", seqs });
	}, [seqs, dispatch]);

	// Every path belongs to one frame's tree; a new frame starts over.
	useEffect(() => {
		setCollapsed(new Set());
		setSelPath(null);
		setHoverPath(null);
	}, [sel]);

	const dissection = useMemo(() => {
		const raw = sel?.raw;
		if (!raw) return null;
		return dissectFrame(raw.bytes, frameProtocolHint(raw.profileId, sel.proto), {
			// The device sends how long the frame really was; a capture shorter
			// than that is one the radio cut short, and MeshCore and Reticulum
			// call such a frame malformed rather than decoding past the cut.
			truncated: raw.originalLength > raw.bytes.length,
		});
	}, [sel]);

	const treeRows = useMemo(
		() => (dissection ? flattenTree(dissection.primary.root, collapsed) : []),
		[dissection, collapsed],
	);

	const activePath = hoverPath ?? selPath;
	const activeRow =
		activePath === null
			? null
			: (treeRows.find((r) => r.path === activePath) ?? null);

	const toggleBranch = (path: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
		// Collapsing a branch hides whatever was picked inside it. The branch
		// itself becomes the pick so the dump keeps highlighting something real.
		setSelPath((prev) =>
			prev !== null && prev.startsWith(`${path}.`) ? path : prev,
		);
	};

	// Same download shape as the TRAFFIC capture: a .lscap assembled in the
	// browser, holding only the frames that carry their full record. It hands
	// the blob over through the same helper the other three formats use, whose
	// delayed revoke is what stops a browser saving an empty file.
	const onSave = () => {
		const name = `lilyshark-sniffer-${stamp()}.lscap`;
		downloadFile(name, buildLscap(rawRecords), "application/octet-stream");
		setExportMsg(`SAVED ${frameCount(rawRecords.length)} TO ${name}`);
	};

	return (
		<main style={{ flexDirection: "column" }}>
			<div
				style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					SNIFFER // EVERY FRAME THE RADIO HEARS
				</span>
				<button
					disabled={frames.length === 0 && !session.paused}
					title={
						session.paused
							? "Let new frames flow into the list again"
							: "Freeze the list — the radio keeps listening, and the counter says what arrived meanwhile"
					}
					onClick={() => setSnifferPaused(!session.paused)}
				>
					{session.paused ? "RESUME" : "PAUSE"}
				</button>
				<button
					disabled={frames.length === 0}
					title="Empty the list and start the session over"
					onClick={() => {
						clearSnifferSession();
						pickFrame(undefined);
						setExportMsg("");
					}}
				>
					CLEAR
				</button>
				{session.paused && (
					<span className="warn" style={{ fontSize: 11 }}>
						PAUSED
						{session.missedWhilePaused > 0 &&
							` · ${session.missedWhilePaused} FRAMES HEARD MEANWHILE`}
					</span>
				)}
				{!linked && frames.length > 0 && (
					<span className="dim" style={{ fontSize: 11 }}>
						T-Deck not linked — this is what was heard before the link closed.
					</span>
				)}
				<span className="spacer" />
				<span className="dim" style={{ fontSize: 11 }}>
					{`${frames.length} LISTED · ${session.totalHeard} HEARD`}
				</span>
			</div>

			{/* Exports get their own row: four buttons and their counts do not
			    belong in the same line as the controls that change what is
			    listed. */}
			<div
				style={{
					display: "flex",
					gap: 10,
					alignItems: "center",
					flexShrink: 0,
					flexWrap: "wrap",
				}}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					EXPORT //
				</span>
				<button
					disabled={rawRecords.length === 0}
					title="Save the listed frames as a .lscap capture — the TRAFFIC screen opens it, and only frames that carry their raw bytes can be written"
					onClick={onSave}
				>
					⭳ CAPTURE ({frameCount(rawRecords.length)})
				</button>
				<ExportButtons records={rawRecords} onSaved={setExportMsg} />
				{exportMsg && (
					<span className="dim" style={{ fontSize: 11 }}>
						{exportMsg}
					</span>
				)}
			</div>

			<div
				style={{ flex: 1, display: "flex", gap: 12, minHeight: 0, flexWrap: "wrap" }}
			>
				{/* The table no longer takes every spare pixel: with a frame open the
				    detail pane has to hold a dissection tree and a hex dump side by
				    side, and it can only do that with a real share of the width. */}
				<div className="panel" style={{ flex: "1 1 380px", minWidth: 0 }}>
					<div className="panel-title">
						<span>CAPTURE // LIVE TABLE</span>
						<span>CLICK A ROW TO TAKE IT APART</span>
					</div>
					{frames.length === 0 ? (
						<p className="dim" style={{ padding: 16, fontSize: 12 }}>
							{linked
								? "Listening — the next frame the radio hears lands here_"
								: "Nothing captured yet — connect a T-Deck over USB with the CONNECT button, and every frame its radio hears lands here_"}
						</p>
					) : (
						<FrameTable frames={frames} sel={sel} onPick={pickFrame} />
					)}
					<div className="panel-foot">
						<span>RSSI IN dBm · SNR IN dB</span>
						<span className="spacer" />
						{rawRecords.length < frames.length && (
							<span>
								{rawRecords.length} OF {frames.length} FRAMES CARRY THE RAW
								BYTES A CAPTURE NEEDS
							</span>
						)}
					</div>
				</div>

				{sel && (
					<div
						className="panel hot"
						style={{ flex: "1 1 460px", minWidth: 280, fontSize: 12 }}
					>
						<div className="panel-title">
							<span>FRAME // {sel.short ?? nodeId(sel.src)}</span>
							<button
								title="Close this frame"
								onClick={() => pickFrame(undefined)}
								style={{ width: 22, height: 22, padding: 0, fontSize: 12, minWidth: 22 }}
							>
								✕
							</button>
						</div>
						<div className="scroll-y" style={{ padding: "10px 12px" }}>
							{(
								[
									["FROM", `${sel.name ?? ""} ${nodeId(sel.src)}`.trim()],
									["TO", sel.dst === BROADCAST ? "ALL" : nodeId(sel.dst)],
									["PROTOCOL", `${sel.proto} · PORT ${sel.port}`],
									["TYPE", sel.kind + (sel.sim ? " · SYNTHETIC" : "")],
									[
										"SIGNAL",
										`${(sel.rssiX10 / 10).toFixed(1)} dBm · SNR ${(sel.snrX10 / 10).toFixed(1)} dB`,
									],
									["HEARD AT", hhmm(sel.atMs)],
									...(sel.hops !== undefined
										? ([["HOPS", String(sel.hops)]] as [string, string][])
										: []),
									...(sel.raw && sel.raw.centerFrequencyHz > 0
										? ([["FREQUENCY", fmtMHz(sel.raw.centerFrequencyHz)]] as [
												string,
												string,
											][])
										: []),
									...(sel.raw
										? ([
												[
													"LENGTH",
													sel.raw.originalLength > sel.raw.bytes.length
														? `${sel.raw.bytes.length} OF ${sel.raw.originalLength} BYTES KEPT`
														: `${sel.raw.bytes.length} BYTES`,
												],
											] as [string, string][])
										: []),
								] as [string, string][]
							).map(([label, value]) => (
								<div key={label} style={{ display: "flex", gap: 10, lineHeight: 1.8 }}>
									<span className="dim" style={{ width: 92, flexShrink: 0, fontSize: 10, letterSpacing: 1 }}>
										{label}
									</span>
									<span style={{ wordBreak: "break-all" }}>{value}</span>
								</div>
							))}
							{/* One more row in the same column grammar as the fields above:
							    a frame's link is part of what identifies it. */}
							<div
								style={{
									display: "flex",
									gap: 10,
									lineHeight: 1.8,
									alignItems: "center",
									flexWrap: "wrap",
								}}
							>
								<span
									className="dim"
									style={{ width: 92, flexShrink: 0, fontSize: 10, letterSpacing: 1 }}
								>
									LINK
								</span>
								<CopyFrameLink seq={sel.raw?.seq} />
							</div>
							{sel.text && (
								<div style={{ margin: "8px 0" }}>
									<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
										TEXT
									</span>
									<div style={{ wordBreak: "break-word" }}>{sel.text}</div>
								</div>
							)}
							{sel.raw && dissection ? (
								<div
									style={{
										display: "flex",
										gap: 14,
										marginTop: 10,
										alignItems: "flex-start",
										flexWrap: "wrap",
									}}
								>
									<div style={{ flex: "1 1 250px", minWidth: 0 }}>
										<div
											className="dim"
											style={{ fontSize: 10, letterSpacing: 1, marginBottom: 5 }}
										>
											DISSECTION // {dissection.primary.protocol.toUpperCase()} ·{" "}
											{decodeSummary(dissection.primary)}
										</div>
										<DissectTree
											rows={treeRows}
											selPath={selPath}
											activePath={activePath}
											onSelect={setSelPath}
											onToggle={toggleBranch}
											onHover={setHoverPath}
										/>
									</div>
									<div style={{ flex: "0 1 auto" }}>
										<div
											className="dim"
											style={{ fontSize: 10, letterSpacing: 1, marginBottom: 5 }}
										>
											BYTES
										</div>
										<HexPane
											bytes={sel.raw.bytes}
											highlight={activeRow?.node ?? null}
											onHoverByte={(index) =>
												setHoverPath(
													index === null
														? null
														: (deepestRowAt(treeRows, index)?.path ?? null),
												)
											}
											onPickByte={(index) => {
												const hit = deepestRowAt(treeRows, index);
												if (hit) setSelPath(hit.path);
											}}
										/>
									</div>
								</div>
							) : (
								<p className="dim" style={{ fontSize: 11 }}>
									This frame arrived without its raw bytes — firmware older than
									the capture link sends only the decoded summary.
								</p>
							)}
						</div>
						{sel.raw && dissection && (
							<div
								className="panel-foot"
								style={{ display: "block", maxHeight: 66, overflowY: "auto" }}
							>
								{activeRow ? (
									<>
										<span style={{ color: "var(--fg)" }}>
											{rowTrail(treeRows, activeRow)}
										</span>{" "}
										· bytes {byteRangeLabel(activeRow.node)}
										{activeRow.node.value ? ` · ${activeRow.node.value}` : ""}
									</>
								) : (
									<>
										Hover the bytes to find the field they belong to, or pick a
										field to light up its bytes. Arrow keys walk the tree.
										{dissection.shelby &&
											` · Shelby pointer embedded at byte ${dissection.shelby.offset}.`}
									</>
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</main>
	);
}
