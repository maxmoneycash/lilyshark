import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDeviceLink, type HeardFrame } from "../../lib/deviceLink";
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
import { buildLscap } from "../../lib/lscapWrite";
import {
	clearSnifferSession,
	setSnifferPaused,
	useSnifferSession,
} from "../../lib/snifferSession";
import { fmtMHz } from "../../lib/spectrum";
import { stamp } from "../export";
import { hhmm, snrClass } from "../fmt";

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
	const rawRecords = frames.flatMap((f) => (f.raw ? [f.raw] : []));

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
	// browser, holding only the frames that carry their full record.
	const onSave = () => {
		const bytes = buildLscap(rawRecords);
		const url = URL.createObjectURL(
			new Blob([bytes.slice().buffer as ArrayBuffer], {
				type: "application/octet-stream",
			}),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = `lilyshark-sniffer-${stamp()}.lscap`;
		a.click();
		URL.revokeObjectURL(url);
		setExportMsg(`SAVED ${rawRecords.length} FRAMES`);
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
						setSel(undefined);
						setExportMsg("");
					}}
				>
					CLEAR
				</button>
				<button
					disabled={rawRecords.length === 0}
					title="Save the listed frames as a .lscap capture — the TRAFFIC screen opens it, and only frames that carry their raw bytes can be written"
					onClick={onSave}
				>
					⭳ SAVE CAPTURE
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
				{exportMsg && (
					<span className="dim" style={{ fontSize: 11 }}>
						{exportMsg}
					</span>
				)}
				<span className="spacer" />
				<span className="dim" style={{ fontSize: 11 }}>
					{`${frames.length} LISTED · ${session.totalHeard} HEARD`}
				</span>
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
						<div className="scroll-y">
							<table className="grid">
								<thead>
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
									{/* Newest first: a sniffer is read from the top. */}
									{frames
										.slice()
										.reverse()
										.map((f, i) => (
											<tr
												key={`${f.atMs}:${f.src}:${i}`}
												className={f === sel ? "sel" : ""}
												onClick={() => setSel(f === sel ? undefined : f)}
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
										))}
								</tbody>
							</table>
						</div>
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
								onClick={() => setSel(undefined)}
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
