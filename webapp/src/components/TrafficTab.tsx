import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
	captureByteLength,
	captureElapsedMs,
	captureFileName,
	captureToLscap,
	clearCapture,
	startCapture,
	stopCapture,
	useCaptureSession,
} from "../lib/captureSession";
import {
	connectDeviceLink,
	disconnectDeviceLink,
	useDeviceLink,
} from "../lib/deviceLink";
import type { FrameDissection } from "../lib/dissect/registry";
import { dissectFrame } from "../lib/dissect/registry";
import {
	deepestRowAt,
	flattenTree,
	profileProtocolHint,
	treeKeyNav,
} from "../lib/dissect/tree";
import type { NodeTone } from "../lib/dissect/types";
import { buildCsv, buildJson, buildLoraTapPcap } from "../lib/export";
import { type FramePredicate, parseFrameFilter } from "../lib/frameFilter";
import {
	findShelbyPointer,
	hasField,
	hexDump,
	type LscapCapture,
	type LscapFrame,
	LscapParseError,
	parseLscap,
	RF_FIELD,
	summarize,
} from "../lib/lscap";
import {
	type CaptureRef,
	permalinkHash,
	readPermalink,
	splitHash,
	updateHashParams,
} from "../lib/permalink";
import {
	APTOS_EXPLORER_ACCOUNT,
	aptosExplorerAccount,
	aptosExplorerTxn,
	CAPTURE_REGISTRY,
	CAPTURE_REGISTRY_URL,
	DEMO_BLOB,
	fetchAnchor,
	fetchBlob as fetchBlobBytes,
	fetchUploadInfo,
	type PublishAnchor,
	type PublishResult,
	publishCapture,
	resolveByCommitment,
	type UploadServiceInfo,
} from "../lib/shelby";
import {
	applyBrush,
	assembleExportView,
	type BrushRange,
	brushLabel,
	buildIoSeries,
	exportFileName,
	normalizeBrush,
	pcapExclusionNote,
} from "../lib/trafficView";
import { demoNextFrame, isDemo } from "../mesh/demo";
import { fg, useThemeTick } from "../mesh/theme";
import { startTrafficDemoInterval } from "./trafficDemo";

/** The live table stops growing here; old frames age out on the left. */
const LIVE_CAP = 250;

/**
 * TRAFFIC — the analyzer. Opens a .lscap capture written by the T-Deck
 * firmware, either from disk or by Shelby blob name.
 *
 * Laid out the way the rest of the terminal is: a `main` holding a list pane
 * and a detail pane, each scrolling inside itself on desktop and stacking into
 * one scrolling column on a phone. `main` is the element the shell gives its
 * spare height to, so it has to be the root here.
 */

const fmtFreq = (hz: number) =>
	hz >= 1_000_000
		? `${(hz / 1_000_000).toFixed(3)} MHz`
		: `${(hz / 1000).toFixed(1)} kHz`;

const crcClass = (c: LscapFrame["crc"]) =>
	c === "valid" ? "ok" : c === "invalid" ? "err" : "dim";

/** Canvas height of the IO graph strip, in CSS pixels. */
const IO_GRAPH_HEIGHT = 140;

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The on-chain anchor outcome of a publish, one honest line per state
 * (.wave-notes/ui-002-integration.md). A failed or skipped anchor is NOT a
 * publish error — the blob is on Shelby either way — so it renders here as
 * a not-anchored state and never routes through publishError.
 */
function AnchorStatus({ anchor }: { anchor: PublishAnchor | undefined }) {
	if (anchor === undefined)
		// Server predates anchoring: unknown is the only honest word.
		return <span className="dim">anchor status unknown</span>;
	if (anchor.status === "anchored") {
		if (anchor.txHash)
			return (
				<span className="ok">
					anchored on-chain by {shortAddr(anchor.publisher)} ·{" "}
					<a
						href={aptosExplorerTxn(anchor.txHash)}
						target="_blank"
						rel="noreferrer"
					>
						TXN {anchor.txHash.slice(0, 10)}… ON EXPLORER
					</a>
				</span>
			);
		// txHash is null only when the service found this commitment already in
		// its registry; the original tx hash is not retained, so the link goes
		// to the publisher account instead.
		return (
			<span className="ok">
				already anchored (earlier publish of the same capture) ·{" "}
				<a
					href={aptosExplorerAccount(anchor.publisher)}
					target="_blank"
					rel="noreferrer"
				>
					PUBLISHER ON EXPLORER
				</a>
			</span>
		);
	}
	if (anchor.status === "failed")
		return <span className="warn">not anchored — {anchor.reason}</span>;
	return <span className="dim">not anchored ({anchor.reason})</span>;
}

/**
 * Copy-a-permalink affordance (UI-007): one button that copies the link and
 * says so. Where the clipboard is unavailable (permissions, older WebViews)
 * the link itself appears in a selectable input instead — never a dead end.
 */
function PermalinkAction({ url }: { url: string }) {
	const [state, setState] = useState<"idle" | "copied" | "shown">("idle");
	useEffect(() => {
		if (state !== "copied") return;
		const id = setTimeout(() => setState("idle"), 2000);
		return () => clearTimeout(id);
	}, [state]);
	return (
		<>
			<button
				type="button"
				title={url}
				onClick={() => {
					if (navigator.clipboard?.writeText) {
						navigator.clipboard.writeText(url).then(
							() => setState("copied"),
							() => setState("shown"),
						);
					} else {
						setState("shown");
					}
				}}
			>
				{state === "copied" ? "✓ LINK COPIED" : "⧉ PERMALINK"}
			</button>
			{state === "shown" && (
				<input
					readOnly
					value={url}
					style={{ width: 220 }}
					onFocus={(e) => e.currentTarget.select()}
				/>
			)}
		</>
	);
}

/* ── dissection tree pane (UI-004) ──────────────────────────────────────
 * The selected frame's dissectFrame tree, one node per line, over an
 * interactive hex dump. Hover or select a node and its byte range lights
 * up in the hex; hover a hex byte and the deepest visible node covering it
 * lights up in the tree. All pure tree logic lives in lib/dissect/tree. */

interface ByteRange {
	offset: number;
	length: number;
}

/** Tones mark limits of decoding (types.ts); map them to the terminal ink. */
const toneClass = (tone: NodeTone | undefined): string =>
	tone === "error"
		? "err"
		: tone === "encrypted"
			? "warn"
			: tone !== undefined
				? "dim"
				: "";

const inRange = (r: ByteRange | null, i: number): boolean =>
	r !== null && i >= r.offset && i < r.offset + r.length;

/** Above this size the hex pane drops per-byte spans and interactivity. */
const HEX_INTERACTIVE_LIMIT = 4096;

/**
 * Hex dump with per-byte highlight, 8 bytes per row (the 360px detail pane
 * fits it without a horizontal scrollbar, where the classic 16 did not).
 */
function HexPane({
	bytes,
	highlight,
	onHoverByte,
}: {
	bytes: Uint8Array;
	highlight: ByteRange | null;
	onHoverByte: (i: number | null) => void;
}) {
	const [hot, setHot] = useState<number | null>(null);
	if (bytes.length === 0)
		return <pre style={{ margin: 0 }}>no payload captured</pre>;
	if (bytes.length > HEX_INTERACTIVE_LIMIT)
		return <pre style={{ margin: 0 }}>{hexDump(bytes, 8)}</pre>;

	const mark = (i: number) => ({
		...(inRange(highlight, i)
			? { background: "var(--fg)", color: "var(--bg)" }
			: null),
		...(hot === i ? { textDecoration: "underline" } : null),
	});
	const rows: ReactNode[] = [];
	for (let off = 0; off < bytes.length; off += 8) {
		const n = Math.min(8, bytes.length - off);
		const cells: ReactNode[] = [];
		const ascii: ReactNode[] = [];
		for (let j = 0; j < n; j++) {
			const i = off + j;
			const b = bytes[i];
			cells.push(
				// biome-ignore lint/a11y/noStaticElementInteractions: hover-only hex inspection; the tree rows are the accessible path to the same byte ranges
				<span
					key={i}
					style={mark(i)}
					onMouseEnter={() => {
						setHot(i);
						onHoverByte(i);
					}}
				>
					{b.toString(16).padStart(2, "0")}
				</span>,
			);
			if (j < n - 1) cells.push(" ");
			ascii.push(
				<span key={i} style={mark(i)}>
					{b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."}
				</span>,
			);
		}
		rows.push(
			<div key={off}>
				<span className="dim">{off.toString(16).padStart(6, "0")}</span>
				{"  "}
				{cells}
				{" ".repeat((8 - n) * 3)}
				{"  "}
				{ascii}
			</div>,
		);
	}
	return (
		<pre
			style={{ margin: 0 }}
			onMouseLeave={() => {
				setHot(null);
				onHoverByte(null);
			}}
		>
			{rows}
		</pre>
	);
}

/**
 * The dissection pane: decrypt state (UI-011), the expandable tree, and the
 * hex dump it highlights. Mounted with a key per frame so expand/collapse
 * and selection state reset with the frame they describe.
 */
function DissectPane({
	bytes,
	dissection,
}: {
	bytes: Uint8Array;
	dissection: FrameDissection;
}) {
	const primary = dissection.primary;
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	// Roving tab stop and pinned hex highlight; always a visible row.
	const [activePath, setActivePath] = useState("0");
	const [hoverPath, setHoverPath] = useState<string | null>(null);
	const [hoverByte, setHoverByte] = useState<number | null>(null);
	const treeRef = useRef<HTMLDivElement>(null);

	const rows = useMemo(
		() => flattenTree(primary.root, collapsed),
		[primary, collapsed],
	);
	const activeRow = rows.find((r) => r.path === activePath) ?? rows[0];

	const toggle = (path: string, dir?: "expand" | "collapse") => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			const want = dir ?? (next.has(path) ? "expand" : "collapse");
			if (want === "expand") next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const focusRow = (path: string) => {
		setActivePath(path);
		requestAnimationFrame(() => {
			treeRef.current
				?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
				?.focus();
		});
	};

	const onRowKeyDown = (e: ReactKeyboardEvent, path: string) => {
		const nav = treeKeyNav(rows, path, e.key);
		if (!nav) return;
		e.preventDefault();
		if (nav.toggle) toggle(nav.path, nav.toggle);
		if (nav.path !== path) focusRow(nav.path);
		else setActivePath(nav.path);
	};

	// Hex hover lights the deepest visible node covering that byte.
	const hexHitPath =
		hoverByte !== null ? (deepestRowAt(rows, hoverByte)?.path ?? null) : null;

	// Tree hover is a transient highlight over the pinned selection.
	const hoverRow =
		hoverPath !== null ? rows.find((r) => r.path === hoverPath) : undefined;
	const rangeOf = (row: typeof activeRow): ByteRange | null =>
		row && row.node.byteLength > 0
			? { offset: row.node.byteOffset, length: row.node.byteLength }
			: null;
	const highlight = rangeOf(hoverRow ?? activeRow);

	// Decrypt state, said out loud (UI-011). Only Meshtastic frames attempt
	// decryption here, and only with the published default channel PSK; the
	// tree's own node labels carry the same words.
	const meshtasticPayload =
		primary.protocol === "Meshtastic" &&
		primary.fields !== null &&
		primary.fields.payloadLength > 0
			? primary.fields
			: null;

	return (
		<>
			<div className="panel-title">
				DISSECTION · {primary.protocol.toUpperCase()}
				<span className="spacer" />
				<span className={primary.result === "malformed" ? "err" : "dim"}>
					{primary.state}
				</span>
			</div>
			{meshtasticPayload && (
				<div style={{ padding: "6px 12px 0", fontSize: 11 }}>
					{meshtasticPayload.defaultKeyReadable ? (
						<span className="ok">
							DECRYPTED · AES-128-CTR under the published Meshtastic default
							channel PSK — this traffic was never private
						</span>
					) : (
						<span className="warn">
							CIPHERTEXT · not readable with the published default channel PSK
							(private key or non-default traffic) — payload stays raw bytes
						</span>
					)}
				</div>
			)}
			<div
				role="tree"
				aria-label="protocol dissection"
				ref={treeRef}
				style={{ padding: "6px 0" }}
			>
				{rows.map((row) => {
					const active = row.path === activeRow?.path;
					const hexHit = row.path === hexHitPath;
					return (
						<div
							key={row.path}
							role="treeitem"
							aria-level={row.depth + 1}
							aria-expanded={row.hasChildren ? row.expanded : undefined}
							aria-selected={active}
							data-path={row.path}
							tabIndex={active ? 0 : -1}
							title={
								row.node.byteLength > 0
									? `bytes ${row.node.byteOffset}–${row.node.byteOffset + row.node.byteLength - 1}`
									: undefined
							}
							onClick={() => setActivePath(row.path)}
							onKeyDown={(e) => onRowKeyDown(e, row.path)}
							onMouseEnter={() => setHoverPath(row.path)}
							onMouseLeave={() =>
								setHoverPath((p) => (p === row.path ? null : p))
							}
							style={{
								display: "flex",
								gap: 6,
								alignItems: "baseline",
								padding: `2px 12px 2px ${12 + row.depth * 14}px`,
								cursor: "pointer",
								fontSize: 12,
								lineHeight: "16px",
								...(active
									? { background: "var(--fg)", color: "var(--bg)" }
									: hexHit
										? { background: "var(--border)" }
										: null),
							}}
						>
							<span
								aria-hidden
								style={{ width: 10, flexShrink: 0 }}
								onClick={(e) => {
									// The glyph is a pointer shortcut; ArrowLeft/Right and
									// Enter are the accessible way to the same toggle.
									if (!row.hasChildren) return;
									e.stopPropagation();
									setActivePath(row.path);
									toggle(row.path);
								}}
							>
								{row.hasChildren ? (row.expanded ? "▾" : "▸") : ""}
							</span>
							<span className={active ? undefined : toneClass(row.node.tone)}>
								{row.node.label}
								{row.node.value !== undefined && (
									<span className={active ? undefined : "dim"}>
										{" "}
										· {row.node.value}
									</span>
								)}
							</span>
						</div>
					);
				})}
			</div>

			<div className="panel-title">RAW BYTES</div>
			<div style={{ padding: "8px 12px", overflowX: "auto" }}>
				<HexPane
					bytes={bytes}
					highlight={highlight}
					onHoverByte={setHoverByte}
				/>
			</div>
		</>
	);
}

/* ── URL hash query bag ────────────────────────────────────────────────
 * The view's shareable state lives in the hash: `filter=` (UI-003) plus
 * the permalink params `blob=` / `commit=` / `owner=` / `frame=` (UI-007).
 * TerminalApp's deep links are plain `#traffic` / `#resolve` tokens, so
 * the base token is kept verbatim and only the query part after `?`
 * belongs to us — non-destructive in both directions (lib/permalink owns
 * the arithmetic). Written with replaceState: typing a filter or clicking
 * a frame is not a navigation, and must not scroll or grow history. */

function readHashFilter(): string {
	return splitHash(window.location.hash).params.get("filter") ?? "";
}

/** Apply `updates` to the hash's query bag in place; null deletes a param. */
function writeHashParams(updates: Record<string, string | null>): void {
	const h = window.location.hash;
	const next = updateHashParams(h, updates);
	if (next === h) return;
	history.replaceState(
		null,
		"",
		`${window.location.pathname}${window.location.search}${next}`,
	);
}

interface AppliedFilter {
	/** The text that compiled; what the table is actually showing. */
	text: string;
	predicate: FramePredicate;
}

interface TrafficTabProps {
	/** True only while TerminalApp is showing its synthetic demo state. */
	demoActive: boolean;
}

export function TrafficTab({ demoActive }: TrafficTabProps) {
	const [capture, setCapture] = useState<LscapCapture | null>(null);
	const [name, setName] = useState("");
	const [selected, setSelected] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [blob, setBlob] = useState("");
	const [busy, setBusy] = useState(false);
	// Live demo mode adds synthetic frames at a configured cadence. It is
	// available only while TerminalApp is showing the demo mesh. Opening a file
	// pauses it.
	const [live, setLive] = useState(() => demoActive && isDemo());
	const liveSeq = useRef(1000);
	const fileRef = useRef<HTMLInputElement>(null);
	const tableRef = useRef<HTMLDivElement>(null);
	const demoActiveRef = useRef(demoActive);
	demoActiveRef.current = demoActive;
	const simulatedLive = live && demoActive;

	useEffect(() => {
		if (!demoActive) setLive(false);
	}, [demoActive]);

	// ── permalinks (UI-007) ───────────────────────────────────────────────
	// The hash a visitor arrived with, read once: a capture reference decides
	// what the boot effect opens, and `frame=` names the frame to land on
	// (consumed by the first load that can honor it).
	const bootPermalink = useRef(
		readPermalink(window.location.hash, DEMO_BLOB.owner),
	);
	const pendingFrame = useRef<number | null>(bootPermalink.current.frame);
	const scrollToSelected = useRef(false);
	/** Where the open capture lives on Shelby — null for a local, unpublished
	 *  capture, which therefore has no permalink until it is published. */
	const [captureRef, setCaptureRef] = useState<CaptureRef | null>(
		bootPermalink.current.ref,
	);

	const load = (
		buf: ArrayBuffer,
		from: string,
		ref: CaptureRef | null = null,
	) => {
		try {
			const c = parseLscap(buf);
			setCapture(c);
			setName(from);
			setCaptureRef(ref);
			// A new capture is a new clock: a brush or export note from the old
			// one would describe frames that are no longer on screen.
			setBrush(null);
			setExportNote(null);
			// A permalink names its frame by sequence number; otherwise land on
			// the most interesting frame — the first one carrying a Shelby
			// pointer, so the decoded pointer detail is on screen from the start.
			const want = pendingFrame.current;
			pendingFrame.current = null;
			const wantIdx =
				want !== null
					? c.frames.findIndex((fr) => Number(fr.sequence) === want)
					: -1;
			if (wantIdx >= 0) {
				setSelected(wantIdx);
				scrollToSelected.current = true;
			} else {
				const ptrIdx = c.frames.findIndex((fr) => findShelbyPointer(fr.bytes));
				setSelected(ptrIdx >= 0 ? ptrIdx : 0);
			}
			// The frame param survives only when this load honored it; any other
			// load would leave a stale frame= describing the previous capture.
			writeHashParams({ frame: wantIdx >= 0 ? String(want) : null });
			// Live frames continue the capture's own numbering; a jump from 23 to
			// 1000 read as a glitch, not a stream.
			liveSeq.current =
				Number(c.frames[c.frames.length - 1]?.sequence ?? -1n) + 1;
			setError(
				c.trailingBytes > 0
					? `${c.trailingBytes} trailing byte(s) were not a complete record`
					: null,
			);
		} catch (e) {
			setCapture(null);
			setCaptureRef(null);
			setError(
				e instanceof LscapParseError ? e.message : "not a .lscap capture",
			);
		}
	};

	// The address bar itself carries the capture reference, so the URL of a
	// resolved or published capture IS its permalink; a local capture clears
	// the ref rather than leaving a stale link in the bar. The owner is
	// omitted when it is the demo account — readPermalink fills it back in.
	useEffect(() => {
		if (!captureRef) {
			writeHashParams({ blob: null, commit: null, owner: null });
			return;
		}
		const defaultOwner =
			captureRef.owner.toLowerCase() === DEMO_BLOB.owner.toLowerCase();
		if (captureRef.kind === "commit") {
			writeHashParams({
				commit: captureRef.commitment,
				owner: defaultOwner ? null : captureRef.owner,
				blob: null,
			});
		} else {
			writeHashParams({
				blob: defaultOwner
					? captureRef.name
					: `${captureRef.owner}/${captureRef.name}`,
				commit: null,
				owner: null,
			});
		}
	}, [captureRef]);

	const openFile = async (f: File) => {
		setBusy(true);
		setLive(false); // the user's own capture is a document, not a stream
		try {
			load(await f.arrayBuffer(), f.name);
		} finally {
			setBusy(false);
		}
	};

	// ── capture session ───────────────────────────────────────────────────
	// Recording keeps the full record of every frame the device streams; on
	// stop the session becomes a real .lscap and opens in this same viewer,
	// so the capture is analyzed where it was made.
	const session = useCaptureSession();
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!session.recording) return;
		const id = setInterval(() => setTick((v) => v + 1), 500);
		return () => clearInterval(id);
	}, [session.recording]);

	const onStopCapture = () => {
		const done = stopCapture();
		setLive(false);
		if (done.frames.length === 0) {
			setError(
				"capture stopped with no frames — nothing was heard on this channel",
			);
			return;
		}
		const bytes = captureToLscap(done);
		// Copied into a standalone buffer: load() keeps views onto it for the
		// lifetime of the capture.
		load(bytes.slice().buffer, captureFileName(done));
	};

	const onDownloadCapture = () => {
		const bytes = captureToLscap(session);
		const url = URL.createObjectURL(
			new Blob([bytes.slice().buffer as ArrayBuffer], {
				type: "application/octet-stream",
			}),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = captureFileName(session);
		a.click();
		URL.revokeObjectURL(url);
	};

	const recSeconds = Math.floor(captureElapsedMs(session) / 1000);

	// Asked once, when there is a capture to publish. The answer decides whether
	// PUBLISH is an action or an explanation.
	const [uploadInfo, setUploadInfo] = useState<UploadServiceInfo | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [publishError, setPublishError] = useState<string | null>(null);
	const [published, setPublished] = useState<{
		publish: PublishResult;
		/** 'pending' while the read-back runs; 'ok' or the mismatch reason after. */
		verified: "pending" | "ok" | string;
	} | null>(null);

	// A new recording is a new artifact; the previous publish no longer
	// describes what is on screen.
	const sessionStart = session.startedAtMs;
	// biome-ignore lint/correctness/useExhaustiveDependencies: sessionStart is the trigger, not a value the effect reads
	useEffect(() => {
		setPublished(null);
		setPublishError(null);
	}, [sessionStart]);

	const onPublish = async () => {
		setPublishing(true);
		setPublishError(null);
		try {
			const bytes = captureToLscap(session);
			const res = await publishCapture(bytes, captureFileName(session));
			setPublished({ publish: res, verified: "pending" });
			// The capture opened at STOP now has an address on Shelby — carry it
			// as the permalink, but only while the viewer still shows this
			// session's capture (the user may have opened another file since).
			if (name === captureFileName(session) && res.owner) {
				setCaptureRef(
					res.commitment
						? { kind: "commit", owner: res.owner, commitment: res.commitment }
						: { kind: "blob", owner: res.owner, name: res.blobName },
				);
			}
			// Prove the loop instead of asserting it: read the blob back from the
			// Shelby RPC and compare every byte with what was just sent.
			try {
				const back = new Uint8Array(
					await fetchBlobBytes(res.owner, res.blobName),
				);
				const same =
					back.length === bytes.length && back.every((b, i) => b === bytes[i]);
				setPublished({
					publish: res,
					verified: same
						? "ok"
						: `Shelby served ${back.length} bytes, we sent ${bytes.length}`,
				});
			} catch (e) {
				setPublished({
					publish: res,
					verified: `read-back failed: ${e instanceof Error ? e.message : e}`,
				});
			}
		} catch (e) {
			setPublishError(e instanceof Error ? e.message : String(e));
		} finally {
			setPublishing(false);
		}
	};
	const haveCapture = !session.recording && session.frames.length > 0;
	useEffect(() => {
		if (!haveCapture || uploadInfo) return;
		void fetchUploadInfo().then(setUploadInfo);
	}, [haveCapture, uploadInfo]);

	/**
	 * Fetch a capture straight from the Shelby RPC by owner + object name —
	 * the FETCH button and the `blob=` permalink share this one path, so a
	 * link opens exactly the way a typed name does.
	 */
	const openBlobRef = async (owner: string, name: string) => {
		setBusy(true);
		setError(null);
		setLive(false);
		try {
			load(await fetchBlobBytes(owner, name), name, {
				kind: "blob",
				owner,
				name,
			});
		} catch (e) {
			setCapture(null);
			setError(e instanceof Error ? e.message : "fetch failed");
		} finally {
			setBusy(false);
		}
	};

	/** The FETCH input: "0x<owner>/<name>" or a bare name on the demo account. */
	const fetchBlob = async () => {
		const n = blob.trim();
		if (!n) return;
		const slash = n.indexOf("/");
		const [owner, name] =
			n.startsWith("0x") && slash > 0
				? [n.slice(0, slash), n.slice(slash + 1)]
				: [DEMO_BLOB.owner, n];
		await openBlobRef(owner, name);
	};

	/**
	 * The full off-grid loop, in one click — and narrated on screen while it
	 * happens, because to a viewer a bare button press followed by a table
	 * reload explains nothing. Each step lands in the trace with its real
	 * timing: the indexer lookup that turns a commitment into an object name,
	 * the RPC fetch, the size check against what the pointer promised, the
	 * on-chain anchor check against the capture registry, and the open. The
	 * trace stays up afterward so the story can be read back.
	 */
	interface TraceStep {
		label: string;
		detail: string;
		state: "run" | "ok" | "err";
	}
	const [trace, setTrace] = useState<TraceStep[] | null>(null);
	const resolving = trace?.some((t) => t.state === "run") ?? false;
	const link = useDeviceLink();
	/** Capturing needs a device on the cable; there is nothing else to record. */
	const canCapture = link.status === "linked";

	// TerminalApp already auto-links a granted T-Deck once for the whole
	// session. A second attempt here raced the header CONNECT button and
	// held the USB CDC port while the board was rebooting.

	// Shared by the selected frame's RESOLVE, the device link's pointer
	// hand-off, and the `commit=` permalink: all are the same walk from
	// coordinates to opened capture. A pointer knows the blob size it
	// promised; a permalink does not, so the size check falls back to the
	// indexer's own record and the trace says which it used.
	const runResolve = async (p: {
		owner: string;
		commitment: string;
		sizeBytes?: number;
	}) => {
		setLive(false);
		const steps: TraceStep[] = [
			p.sizeBytes !== undefined
				? {
						label: "POINTER",
						detail: `82 B decoded from the frame`,
						state: "ok",
					}
				: {
						label: "PERMALINK",
						detail: "capture reference from the link",
						state: "ok",
					},
			{ label: "INDEXER", detail: "commitment → object name…", state: "run" },
		];
		const show = () => setTrace([...steps]);
		show();
		try {
			let t0 = performance.now();
			const found = await resolveByCommitment(p.owner, p.commitment);
			if (!found)
				throw new Error("no blob with this commitment under that owner");
			steps[1] = {
				label: "INDEXER",
				detail: `${found.name} · ${Math.round(performance.now() - t0)} ms`,
				state: "ok",
			};
			steps.push({
				label: "SHELBY RPC",
				detail: "fetching the bytes…",
				state: "run",
			});
			show();

			t0 = performance.now();
			const bytes = await fetchBlobBytes(
				p.owner,
				found.name,
				(attempt, waitMs) => {
					steps[2] = {
						label: "SHELBY RPC",
						detail: `rate-limited — retrying in ${Math.round(waitMs / 1000)} s (${attempt}/2)…`,
						state: "run",
					};
					show();
				},
			);
			steps[2] = {
				label: "SHELBY RPC",
				detail: `${bytes.byteLength.toLocaleString()} B · ${Math.round(performance.now() - t0)} ms`,
				state: "ok",
			};
			const expectedSize = p.sizeBytes ?? found.sizeBytes;
			const sizeSource =
				p.sizeBytes !== undefined ? "pointer" : "indexer record";
			const sizeOk = bytes.byteLength === expectedSize;
			steps.push({
				label: "VERIFY",
				detail: sizeOk
					? `size matches the ${sizeSource}: ${expectedSize.toLocaleString()} B`
					: `size mismatch: ${sizeSource} said ${expectedSize.toLocaleString()} B`,
				state: sizeOk ? "ok" : "err",
			});
			steps.push({
				label: "ANCHOR",
				detail: "checking the on-chain registry…",
				state: "run",
			});
			show();

			// The chain check must never block the open: a dead fullnode leaves the
			// anchor unverified, not the capture unreadable.
			t0 = performance.now();
			try {
				const anchor = await fetchAnchor(p.owner, p.commitment);
				steps[steps.length - 1] = anchor
					? {
							label: "ANCHOR",
							detail: `vouched on-chain by ${p.owner.slice(0, 6)}…${p.owner.slice(-4)} on ${new Date(anchor.registeredAtUnix * 1000).toISOString().slice(0, 10)} · ${Math.round(performance.now() - t0)} ms`,
							state: "ok",
						}
					: {
							label: "ANCHOR",
							detail: "no on-chain anchor for this commitment",
							state: "err",
						};
			} catch {
				steps[steps.length - 1] = {
					label: "ANCHOR",
					detail: "registry unreachable — anchor unverified",
					state: "err",
				};
			}
			show();

			keepTrace.current = true;
			load(bytes, found.name, {
				kind: "commit",
				owner: p.owner,
				commitment: p.commitment,
			});
			steps.push({ label: "OPENED", detail: `${found.name}`, state: "ok" });
			show();
		} catch (e) {
			const running = steps.findIndex((s) => s.state === "run");
			if (running >= 0)
				steps[running] = {
					...steps[running],
					detail: e instanceof Error ? e.message : "failed",
					state: "err",
				};
			show();
		}
	};

	const resolvePointer = () => {
		if (!ptr) return;
		void runResolve(ptr.pointer);
	};

	// A new frame selection is a new story; the old trace would misattribute —
	// except for the load the resolve itself performs, which must keep its
	// trace on screen so the finished story can be read back.
	const keepTrace = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: selected/capture are triggers; the effect only clears state
	useEffect(() => {
		if (keepTrace.current) {
			keepTrace.current = false;
			return;
		}
		setTrace(null);
	}, [selected, capture]);

	// The #resolve deep link plays the whole loop unattended: TerminalApp opened
	// this tab for it, the sample opens itself below, and the first capture to
	// land gets its pointer frame resolved as if the user had pressed SAMPLE and
	// then RESOLVE. Armed by a ref rather than state because it must fire exactly
	// once: StrictMode runs mount effects twice in dev, and the resolve's own
	// load() makes this capture effect fire again. Declared after the trace
	// reset above so that the reset cannot wipe the trace's opening steps.
	const autoResolveRef = useRef(
		// The entry token is whatever precedes the filter query, if any.
		window.location.hash.toLowerCase().split("?")[0] === "#resolve",
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: must fire once per capture; runResolve is stable in practice
	useEffect(() => {
		if (!autoResolveRef.current || !capture) return;
		autoResolveRef.current = false;
		const hit = capture.frames
			.map((fr) => findShelbyPointer(fr.bytes))
			.find(Boolean);
		if (hit) void runResolve(hit.pointer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [capture]);

	/** Bundled synthetic capture: 24 frames with a Shelby pointer at sequence 9. */
	const openSample = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/sample-mesh-traffic.lscap");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			load(await res.arrayBuffer(), "sample-mesh-traffic.lscap");
		} catch (e) {
			setError(e instanceof Error ? e.message : "sample unavailable");
		} finally {
			setBusy(false);
		}
	};

	// Boot: a permalink's capture reference opens through the exact path a
	// user would drive by hand — `commit=` runs the full resolve trace,
	// `blob=` the plain RPC fetch. Without one, the bundled capture opens
	// itself: an analyzer that lands on an empty panel shows nothing about
	// what it does, and the sample costs one small fetch. Anything the user
	// opens afterwards replaces it as usual. Guarded by a ref because
	// StrictMode runs mount effects twice in dev and a resolve must not
	// double-trace.
	const bootRan = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — the boot capture opens exactly once
	useEffect(() => {
		if (bootRan.current) return;
		bootRan.current = true;
		const ref = bootPermalink.current.ref;
		if (ref) {
			// The link says exactly what to open; the #resolve token's auto-play
			// must not fire a second resolve on top of it.
			autoResolveRef.current = false;
		}
		if (ref?.kind === "commit") {
			void runResolve({ owner: ref.owner, commitment: ref.commitment });
		} else if (ref?.kind === "blob") {
			void openBlobRef(ref.owner, ref.name);
		} else {
			void openSample();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Synthetic demo traffic: a frame lands every few seconds.
	// The table follows the newest frame unless the user has scrolled back up
	// to study something — the same follow rule every log viewer uses.
	// Follow from the start — but only once the capture exists; scrolling the
	// still-empty table was a no-op and the live screen opened looking frozen,
	// with every arrival landing below the fold.
	const followInit = useRef(false);
	useEffect(() => {
		if (!simulatedLive) {
			followInit.current = false;
			return;
		}
		if (!capture || followInit.current) return;
		followInit.current = true;
		requestAnimationFrame(() => {
			const el = tableRef.current;
			if (el) el.scrollTop = el.scrollHeight;
		});
	}, [simulatedLive, capture]);

	useEffect(() => {
		return startTrafficDemoInterval(
			simulatedLive,
			() => demoActiveRef.current,
			() => {
				setCapture((c) => {
					if (!c) return c;
					const last = c.frames[c.frames.length - 1];
					const seq = liveSeq.current++;
					const f = demoNextFrame(
						seq,
						Number(last ? last.timestampUs : 0n) +
							2_400_000 +
							(seq % 5) * 640_000,
					);
					return { ...c, frames: [...c.frames.slice(-(LIVE_CAP - 1)), f] };
				});
				const el = tableRef.current;
				if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
					requestAnimationFrame(() => {
						el.scrollTop = el.scrollHeight;
					});
				}
			},
		);
	}, [simulatedLive]);

	const frames = capture?.frames ?? [];
	// A pointer rides behind whatever protocol header enclosed it, so every
	// payload is scanned once rather than only at a fixed offset.
	const pointers = useMemo(
		() => frames.map((f) => findShelbyPointer(f.bytes)),
		[frames],
	);

	// ── display filter ─────────────────────────────────────────────────
	// The text is parsed on every keystroke; only a parse that succeeds is
	// APPLIED. While the text is broken the table keeps the last valid
	// result and the error is pointed out inline — it never silently shows
	// wrong rows.
	const [filterText, setFilterText] = useState<string>(readHashFilter);
	const filterParse = useMemo(() => parseFrameFilter(filterText), [filterText]);
	const [applied, setApplied] = useState<AppliedFilter | null>(() => {
		const text = readHashFilter();
		const r = parseFrameFilter(text);
		return r.ok && !r.empty ? { text, predicate: r.predicate } : null;
	});
	useEffect(() => {
		if (!filterParse.ok) return; // keep the last valid filter on screen
		setApplied(
			filterParse.empty
				? null
				: { text: filterText, predicate: filterParse.predicate },
		);
	}, [filterParse, filterText]);
	useEffect(() => {
		writeHashParams({ filter: filterText || null });
	}, [filterText]);
	const filterError = filterParse.ok ? null : filterParse.error;

	/** Indices into `frames` that pass the applied text filter. */
	const filterShown = useMemo(() => {
		if (!applied) return frames.map((_, i) => i);
		const idx: number[] = [];
		for (let i = 0; i < frames.length; i++) {
			if (applied.predicate(frames[i], pointers[i] !== null)) idx.push(i);
		}
		return idx;
	}, [frames, pointers, applied]);

	// ── time brush ─────────────────────────────────────────────────────
	// A range brushed on the IO graph is one more predicate over the text
	// filter's output: the graph plots the FILTERED set, the table shows the
	// filtered-and-brushed set, and clearing the brush restores the filter's
	// rows exactly. Times are seconds on the capture clock (first frame = 0),
	// the same clock the table's TIME column reads.
	const [brush, setBrush] = useState<BrushRange | null>(null);
	const t0 = frames.length ? frames[0].timestampUs : 0n;

	/** The table rows: text filter ∘ brush. */
	const shown = useMemo(
		() => applyBrush(filterShown, frames, t0, brush),
		[filterShown, frames, t0, brush],
	);
	const shownFrames = useMemo(
		() => shown.map((i) => frames[i]),
		[shown, frames],
	);
	// The strip reads over what the table shows, not over the whole capture.
	const stats = useMemo(() => summarize(shownFrames), [shownFrames]);
	const shownPointerCount = useMemo(
		() => shown.filter((i) => pointers[i]).length,
		[shown, pointers],
	);

	// A filter change may hide the selected row; selection snaps to the first
	// visible frame so the detail pane always describes a row that is on
	// screen (or to none when nothing matches), and the roving tabIndex (the
	// selected row is the table's tab stop) keeps keyboard reach on the table
	// through selecting, filtering and clearing.
	const selectedVisible = shown.includes(selected);
	useEffect(() => {
		if (selectedVisible) return;
		const next = shown[0] ?? -1;
		setSelected(next);
		// A URL already naming a frame keeps naming the one on screen; a URL
		// that never carried frame= is not grown by a passive snap.
		if (splitHash(window.location.hash).params.has("frame")) {
			const fr = next >= 0 ? frames[next] : undefined;
			writeHashParams({ frame: fr ? String(Number(fr.sequence)) : null });
		}
	}, [selectedVisible, shown, frames]);

	/** User-driven selection: the row and the URL's `frame=` move together. */
	const selectFrame = (i: number) => {
		setSelected(i);
		const fr = frames[i];
		writeHashParams({ frame: fr ? String(Number(fr.sequence)) : null });
	};

	// A permalink's frame must land on screen, not just be selected: scroll
	// the row into view once, after the load that consumed `frame=`.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selected is the trigger; the effect only reads refs
	useEffect(() => {
		if (!scrollToSelected.current) return;
		scrollToSelected.current = false;
		requestAnimationFrame(() => {
			tableRef.current
				?.querySelector("tr.sel")
				?.scrollIntoView({ block: "center" });
		});
	}, [selected]);

	// ── IO graph (UI-005) ──────────────────────────────────────────────
	// One strip over the capture clock: packet rate, mean SNR, CRC-failure
	// marks, fed from the FILTERED frame set so it re-renders with the
	// display filter. Binned in lib/trafficView so 5,000 frames collapse to
	// a few hundred plotted points. Nothing here animates — uPlot draws each
	// state directly and the collapse is instant — so prefers-reduced-motion
	// is honored by construction.
	const [ioOpen, setIoOpen] = useState(true);
	const ioDiv = useRef<HTMLDivElement>(null);
	const ioPlot = useRef<uPlot | null>(null);
	const themeTick = useThemeTick();
	const ioFrames = useMemo(
		() => filterShown.map((i) => frames[i]),
		[filterShown, frames],
	);
	const ioSeries = useMemo(() => buildIoSeries(ioFrames, t0), [ioFrames, t0]);
	// The brush survives a plot rebuild (live frames, theme change) but must
	// not itself rebuild the plot — read through a ref, redrawn after build.
	const brushRef = useRef(brush);
	brushRef.current = brush;

	const clearBrush = () => {
		setBrush(null);
		ioPlot.current?.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: themeTick is the repaint trigger — the canvas paints with fg(), which reads the theme imperatively
	useEffect(() => {
		const box = ioDiv.current;
		ioPlot.current?.destroy();
		ioPlot.current = null;
		if (!box || !ioOpen || ioSeries.xs.length === 0) return;
		// Semantic colors come from the theme's CSS vars; the canvas cannot
		// read them, so they are resolved here from the box itself.
		const errColor =
			getComputedStyle(box).getPropertyValue("--err").trim() || "#ff3b30";
		const u = new uPlot(
			{
				width: Math.max(100, box.clientWidth),
				height: IO_GRAPH_HEIGHT,
				// Dragging brushes — it must never zoom, or "clear" could not
				// honestly promise to restore the table.
				cursor: { drag: { x: true, y: false, setScale: false }, y: false },
				scales: { x: { time: false }, rate: {}, snr: {} },
				series: [
					{},
					{
						label: "FRAMES/S",
						scale: "rate",
						stroke: fg(),
						width: 1.5,
						points: { show: false },
					},
					{
						label: "SNR dB",
						scale: "snr",
						stroke: fg("77"),
						width: 1,
						points: { show: false },
						spanGaps: true,
					},
					{
						label: "CRC FAIL/S",
						scale: "rate",
						stroke: errColor,
						// Marks, not a line: a failure is an event on the clock.
						paths: () => null,
						points: { show: true, size: 6, fill: errColor },
					},
				],
				axes: [
					{
						stroke: fg("88"),
						grid: { stroke: fg("22"), dash: [2, 6] },
						ticks: { stroke: fg("44") },
						font: "11px JetBrains Mono",
					},
					{
						scale: "rate",
						stroke: fg("88"),
						grid: { stroke: fg("22"), dash: [2, 6] },
						ticks: { stroke: fg("44") },
						font: "11px JetBrains Mono",
						size: 40,
					},
					{
						scale: "snr",
						side: 1,
						stroke: fg("77"),
						grid: { show: false },
						ticks: { stroke: fg("44") },
						font: "11px JetBrains Mono",
						size: 40,
					},
				],
				legend: { show: false },
				hooks: {
					setSelect: [
						(self) => {
							// A drag with width brushes; a bare click clears.
							const a = self.posToVal(self.select.left, "x");
							const b = self.posToVal(
								self.select.left + self.select.width,
								"x",
							);
							setBrush(self.select.width > 0 ? normalizeBrush(a, b) : null);
						},
					],
				},
			},
			[ioSeries.xs, ioSeries.rate, ioSeries.snr, ioSeries.crcFail],
			box,
		);
		// uPlot's stock selection overlay is a light-theme gray; repaint it in
		// the theme's own ink so the brushed range is visible on dark ground.
		const sel = u.root.querySelector<HTMLElement>(".u-select");
		if (sel) sel.style.background = fg("2e");
		// Redraw the standing brush onto the fresh canvas without re-firing
		// the hook (the second argument), or every rebuild would loop.
		const b = brushRef.current;
		if (b) {
			const left = u.valToPos(b.startS, "x");
			const right = u.valToPos(b.endS, "x");
			u.setSelect(
				{
					left,
					width: Math.max(0, right - left),
					top: 0,
					height: u.bbox.height / devicePixelRatio,
				},
				false,
			);
		}
		ioPlot.current = u;
		return () => {
			ioPlot.current?.destroy();
			ioPlot.current = null;
		};
	}, [ioSeries, ioOpen, themeTick]);

	// Canvas is sized in pixels once; follow the panel through resizes.
	useEffect(() => {
		const box = ioDiv.current;
		if (!box || !ioOpen || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			ioPlot.current?.setSize({
				width: Math.max(100, box.clientWidth),
				height: IO_GRAPH_HEIGHT,
			});
		});
		ro.observe(box);
		return () => ro.disconnect();
	}, [ioOpen]);

	// ── export of the current view (UI-006) ────────────────────────────
	// pcap/CSV/JSON of exactly what the table shows: text filter ∘ brush.
	// Saved through the same object-URL mechanism as the .lscap download.
	const [exportNote, setExportNote] = useState<{
		text: string;
		warn: boolean;
	} | null>(null);

	const saveFile = (part: BlobPart, fileName: string, type: string) => {
		const url = URL.createObjectURL(new Blob([part], { type }));
		const a = document.createElement("a");
		a.href = url;
		a.download = fileName;
		a.click();
		URL.revokeObjectURL(url);
	};

	const onExport = (kind: "pcap" | "csv" | "json") => {
		if (!capture) return;
		const view = assembleExportView(frames, shown);
		const fileName = exportFileName(
			name,
			{ filtered: applied !== null, brushed: brush !== null },
			kind,
		);
		if (kind === "pcap") {
			const res = buildLoraTapPcap(view);
			saveFile(
				res.bytes.slice().buffer as ArrayBuffer,
				fileName,
				"application/vnd.tcpdump.pcap",
			);
			// The counts are surfaced whether or not anything was excluded —
			// a pcap silently missing frames would be a lie about the air.
			setExportNote({
				text: `${fileName} · ${pcapExclusionNote(res)}`,
				warn: res.excludedSynthetic + res.excludedUnencodable > 0,
			});
		} else {
			const body = kind === "csv" ? buildCsv(view) : buildJson(view);
			saveFile(
				body,
				fileName,
				kind === "csv" ? "text/csv" : "application/json",
			);
			setExportNote({
				text: `${fileName} · ${view.frames.length} frame(s) written`,
				warn: false,
			});
		}
	};

	const f = frames[selected];
	const ptr = f ? pointers[selected] : null;

	// ── dissection tree (UI-004) ───────────────────────────────────────
	// The selected frame through the registry's profile-gated dissectors.
	// The hint comes from the frame's own capture profile — the dissector
	// never guesses a protocol the radio did not name.
	const dissection = useMemo(
		() =>
			f
				? dissectFrame(
						f.bytes,
						profileProtocolHint(
							hasField(f, RF_FIELD.profile) ? f.profileId : null,
						),
						{ truncated: f.truncated },
					)
				: null,
		[f],
	);

	// The permalink for exactly what is on screen: capture reference plus the
	// selected frame and the applied filter (UI-007). Null while the open
	// capture has no address on Shelby.
	const permalinkUrl = useMemo(
		() =>
			captureRef
				? `${window.location.origin}${window.location.pathname}${permalinkHash(
						captureRef,
						{
							frame: f ? Number(f.sequence) : null,
							filter: applied?.text,
							defaultOwner: DEMO_BLOB.owner,
						},
					)}`
				: null,
		[captureRef, f, applied],
	);

	// The published capture's own permalink, shown beside the publish result —
	// prefer the commitment (what the on-chain anchor vouches for) over the
	// blob name. Null while nothing is published or the owner never parsed.
	const publishedPermalink = useMemo(() => {
		if (!published || !published.publish.owner) return null;
		const p = published.publish;
		const ref: CaptureRef = p.commitment
			? { kind: "commit", owner: p.owner, commitment: p.commitment }
			: { kind: "blob", owner: p.owner, name: p.blobName };
		return `${window.location.origin}${window.location.pathname}${permalinkHash(
			ref,
			{ defaultOwner: DEMO_BLOB.owner },
		)}`;
	}, [published]);

	return (
		<main>
			<div className="panel" style={{ flex: 1 }}>
				<div className="panel-title">
					{`PANEL // TRAFFIC${name ? ` · ${name}` : ""}`}
					<span className="spacer" />
					<button
						type="button"
						onClick={() => fileRef.current?.click()}
						disabled={busy}
					>
						OPEN
					</button>
					<button
						type="button"
						onClick={() => void openSample()}
						disabled={busy}
					>
						SAMPLE
					</button>
					{/* Record what the linked radio hears, then open it right here. */}
					{session.recording ? (
						<button
							type="button"
							className="primary"
							onClick={onStopCapture}
							title="Stop and open the capture"
						>
							■ STOP · {session.frames.length}f · {recSeconds}s
						</button>
					) : (
						<button
							type="button"
							onClick={() => {
								clearCapture();
								startCapture();
								setLive(false);
							}}
							disabled={!canCapture || busy}
							title={
								canCapture
									? "Record every frame the linked device hears"
									: "Connect a Lilyshark device to capture"
							}
						>
							● CAPTURE
						</button>
					)}
					{!session.recording && session.frames.length > 0 && (
						<button
							type="button"
							onClick={onDownloadCapture}
							title="Save the .lscap file"
						>
							⭳ {(captureByteLength(session) / 1024).toFixed(1)} kB
						</button>
					)}
					<button
						type="button"
						className={simulatedLive ? "primary" : ""}
						title={
							demoActive
								? "synthetic LongFast demo, timed like the configured channel"
								: "synthetic Traffic demo is disabled while a device is connected"
						}
						disabled={!demoActive}
						onClick={() => setLive((v) => !v)}
					>
						{/* Glyphs the bundled mono actually has. The pause glyph rendered as tofu. */}
						{!demoActive
							? "SIM DISABLED"
							: simulatedLive
								? "● SIM LIVE"
								: "▶ SIM LIVE"}
					</button>
					<input
						ref={fileRef}
						type="file"
						accept=".lscap,application/octet-stream"
						hidden
						onChange={(e) => {
							const x = e.target.files?.[0];
							if (x) void openFile(x);
						}}
					/>
					{/* Export the CURRENT VIEW — text filter ∘ brush — not the file. */}
					{capture && (
						<>
							<button
								type="button"
								onClick={() => onExport("pcap")}
								disabled={busy || shown.length === 0}
								title="LoRaTap DLT-270 pcap of the shown frames (synthetic frames cannot ride along)"
							>
								⭳ PCAP
							</button>
							<button
								type="button"
								onClick={() => onExport("csv")}
								disabled={busy || shown.length === 0}
								title="Decoded columns of the shown frames, RFC 4180"
							>
								⭳ CSV
							</button>
							<button
								type="button"
								onClick={() => onExport("json")}
								disabled={busy || shown.length === 0}
								title="Decoded columns of the shown frames, one object per frame"
							>
								⭳ JSON
							</button>
						</>
					)}
					<input
						placeholder="shelby blob name_"
						value={blob}
						style={{ width: 160 }}
						onChange={(e) => setBlob(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void fetchBlob()}
					/>
					<button
						type="button"
						onClick={() => void fetchBlob()}
						disabled={busy || !blob.trim()}
					>
						FETCH
					</button>
				</div>

				{error && <div className="panel-foot err">{error}</div>}

				{/* What the last export actually wrote — including, honestly, what
				    pcap had to leave out. */}
				{exportNote && (
					<div className="panel-foot">
						<span className={exportNote.warn ? "warn" : "ok"}>
							EXPORT · {exportNote.text}
						</span>
						<span className="spacer" />
						<button type="button" onClick={() => setExportNote(null)}>
							DISMISS
						</button>
					</div>
				)}

				{/* What the capture is, and where its chain of custody would live. */}
				{haveCapture && (
					<div className="panel-foot cap-chain">
						<span className="k">CAPTURE</span>
						<span className="v">
							{session.frames.length} frames ·{" "}
							{(captureByteLength(session) / 1024).toFixed(1)} kB · {recSeconds}
							s
							{session.containsSynthetic && (
								<span className="warn"> · CONTAINS SIMULATE-MODE FRAMES</span>
							)}
							{session.skippedNoPayload > 0 && (
								<span className="warn">
									{" "}
									· {session.skippedNoPayload} frame(s) had no payload to store
								</span>
							)}
						</span>
						<span className="k">ON CHAIN</span>
						<span className="v">
							<a href={CAPTURE_REGISTRY_URL} target="_blank" rel="noreferrer">
								{CAPTURE_REGISTRY.split("::")[1]}
							</a>{" "}
							is deployed on shelbynet ·{" "}
							<a href={APTOS_EXPLORER_ACCOUNT} target="_blank" rel="noreferrer">
								APTOS EXPLORER
							</a>
						</span>
						<span className="k">PUBLISH</span>
						<span className="v">
							{uploadInfo === null ? (
								<span className="dim">checking the share service…</span>
							) : !uploadInfo.available ? (
								<span className="warn">
									unavailable — the share service holds no Shelby signing key,
									so this capture cannot be uploaded or anchored from the
									browser. Download the .lscap and publish it with{" "}
									<code>webapp/scripts/shelby-put.ts</code>.
								</span>
							) : published ? (
								<>
									<a
										href={published.publish.url}
										target="_blank"
										rel="noreferrer"
									>
										{published.publish.blobName}
									</a>{" "}
									· {published.publish.size.toLocaleString()} B on Shelby ·{" "}
									{published.verified === "ok" ? (
										<span className="ok">
											served back byte-identical — the network holds exactly
											this capture
										</span>
									) : published.verified === "pending" ? (
										<span className="dim">reading it back from Shelby…</span>
									) : (
										<span className="warn">
											read-back mismatch: {published.verified}
										</span>
									)}{" "}
									·{" "}
									<a
										href={aptosExplorerAccount(published.publish.owner)}
										target="_blank"
										rel="noreferrer"
									>
										OWNER ON APTOS EXPLORER
									</a>
									{publishedPermalink && (
										<>
											{" · "}
											<PermalinkAction url={publishedPermalink} />
										</>
									)}
								</>
							) : (
								<>
									<button
										type="button"
										disabled={publishing}
										onClick={() => void onPublish()}
									>
										{publishing ? "PUBLISHING…" : "⇡ PUBLISH TO SHELBY"}
									</button>{" "}
									signs as{" "}
									<code>{uploadInfo.uploaderAddress?.slice(0, 10)}…</code> · the
									upload registers the blob on shelbynet under that account
									{publishError && (
										<span className="err"> · {publishError}</span>
									)}
								</>
							)}
						</span>
						{/* The anchor is the publish's second half: did the service
						    also register this capture's commitment on-chain? Rendered
						    per state (see AnchorStatus) — a publish with a failed
						    anchor is still a successful publish. */}
						{published && (
							<>
								<span className="k">ANCHOR</span>
								<span className="v">
									<AnchorStatus anchor={published.publish.anchor} />
									{published.publish.commitment && (
										<>
											{" "}
											<button
												type="button"
												disabled={resolving}
												title="Run the full resolve trace on the capture just published"
												onClick={() => {
													const p = published.publish;
													if (p.commitment)
														void runResolve({
															owner: p.owner,
															commitment: p.commitment,
															sizeBytes: p.size,
														});
												}}
											>
												{resolving ? "RESOLVING…" : "⇓ RESOLVE THIS PUBLISH"}
											</button>
										</>
									)}
								</span>
							</>
						)}
					</div>
				)}

				{link.status !== "off" && (
					<div className="kv">
						<span className="k">T-DECK LINK</span>
						{link.status === "connecting" && (
							<span className="v dim">
								connecting… (a reboot on first contact is normal; this waits it
								out)
							</span>
						)}
						{link.status === "error" && (
							<span className="v err">
								{link.error}{" "}
								<button type="button" onClick={() => void connectDeviceLink()}>
									RETRY
								</button>{" "}
								{link.canPick && (
									<button
										type="button"
										onClick={() => void connectDeviceLink({ picker: true })}
									>
										CHOOSE PORT
									</button>
								)}
							</span>
						)}
						{link.status === "linked" && (
							<span className="v ok">
								Lilyshark {link.firmware} over USB{" "}
								{link.telemetry?.sim ? (
									<span className="sim-badge">SIMULATE MODE · SYNTHETIC</span>
								) : null}{" "}
								<button
									type="button"
									onClick={() => void disconnectDeviceLink()}
								>
									UNLINK
								</button>
							</span>
						)}
						{link.status === "linked" && link.telemetry && (
							<>
								<span className="k">DEVICE</span>
								<span className="v">
									{link.telemetry.bat} · {link.telemetry.gps} ·{" "}
									{link.telemetry.profile} · frame #{link.telemetry.frames} ·
									RSSI {(link.telemetry.rssiX10 / 10).toFixed(1)} dBm · SNR{" "}
									{(link.telemetry.snrX10 / 10).toFixed(1)} dB
								</span>
							</>
						)}
						{link.status === "linked" && link.pointer && (
							<>
								<span className="k">POINTER RX</span>
								<span className="v">
									{link.pointer.sizeBytes.toLocaleString()} B blob · commit{" "}
									{link.pointer.commitment.slice(0, 10)}…
									{link.pointer.commitment.slice(-4)}{" "}
									<button
										type="button"
										disabled={resolving}
										onClick={() => {
											const p = link.pointer;
											if (p)
												void runResolve({
													owner: p.owner,
													commitment: p.commitment,
													sizeBytes: p.sizeBytes,
												});
										}}
									>
										RESOLVE
									</button>
								</span>
							</>
						)}
					</div>
				)}

				{!capture && (
					<div className="kv">
						<span className="k">CAPTURE</span>
						<span className="v dim">
							{busy
								? "reading…"
								: "none open. The T-Deck writes .lscap to microSD. Load the bundled sample to inspect 24 synthetic LongFast frames, including one Shelby pointer."}
						</span>
					</div>
				)}

				{capture && (
					<>
						{/* One horizontal strip: as a two-column kv this stretched seven
                short readouts down half the panel with the right side empty. */}
						<div className="stat-strip">
							{(
								[
									[
										"FRAMES",
										applied || brush ? (
											// The strip must say it is reading a subset, or its
											// numbers would quietly stop describing the capture.
											<span className="ok" key="filtered">
												FILTERED {shown.length}/{frames.length}
											</span>
										) : (
											stats.frames
										),
									],
									// The brushed range reads in the same seconds as the
									// TIME column; ✕ restores the un-brushed table.
									...((brush
										? [
												[
													"TIME BRUSH",
													<span className="ok" key="brush">
														{brushLabel(brush)}{" "}
														<button
															type="button"
															onClick={clearBrush}
															title="Clear the brushed time range"
														>
															✕
														</button>
													</span>,
												],
											]
										: []) as [string, ReactNode][]),
									["PAYLOAD", <>{stats.bytes.toLocaleString()} B</>],
									[
										"CRC",
										<>
											<span className="ok">{stats.crcValid} OK</span>
											{" · "}
											<span className={stats.crcInvalid ? "err" : "dim"}>
												{stats.crcInvalid} BAD
											</span>
										</>,
									],
									["BEST SNR", <>{stats.bestSnrDb?.toFixed(1) ?? "—"} dB</>],
									[
										"MEDIAN RSSI",
										<>{stats.medianRssiDbm?.toFixed(1) ?? "—"} dBm</>,
									],
									["AIRTIME", <>{stats.airtimeMs.toFixed(0)} ms</>],
									[
										"SHELBY PTRS",
										<span
											className={shownPointerCount ? "ok" : "dim"}
											key="ptrs"
										>
											{shownPointerCount}
										</span>,
									],
								] as [string, ReactNode][]
							).map(([k, v]) => (
								<span className="stat" key={k}>
									<span className="k">{k}</span>
									<span className="v">{v}</span>
								</span>
							))}
						</div>

						{/* Display filter: same row grammar as the blob input above —
                monospace input on the terminal grid, buttons to its right. */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "8px 12px",
								borderBottom: "1px solid var(--border)",
								flexShrink: 0,
							}}
						>
							<label
								htmlFor="traffic-filter"
								style={{
									fontSize: 10,
									letterSpacing: 1,
									color: "var(--fg-dim)",
								}}
							>
								FILTER
							</label>
							<input
								id="traffic-filter"
								placeholder="proto == meshtastic && snr > -5 && has:pointer_"
								value={filterText}
								spellCheck={false}
								autoComplete="off"
								aria-invalid={!filterParse.ok}
								aria-describedby={
									filterError ? "traffic-filter-error" : undefined
								}
								style={{
									flex: 1,
									minWidth: 0,
									...(filterError ? { borderColor: "var(--err)" } : null),
								}}
								onChange={(e) => setFilterText(e.target.value)}
								onKeyDown={(e) => {
									// ESC clears; focus stays here, and Tab reaches the table.
									if (e.key === "Escape") setFilterText("");
								}}
							/>
							{filterText !== "" && (
								<button type="button" onClick={() => setFilterText("")}>
									CLEAR
								</button>
							)}
						</div>
						{filterError && (
							// The broken text is echoed with the offending token in coral,
							// so the eye lands on the exact characters to fix. The table
							// beneath still shows the last valid result.
							<div
								className="panel-foot"
								id="traffic-filter-error"
								role="alert"
								style={{
									borderTop: "none",
									alignItems: "baseline",
									flexWrap: "wrap",
									gap: 12,
								}}
							>
								<pre style={{ margin: 0, fontSize: 11 }}>
									{filterText.slice(0, filterError.start)}
									<span className="err" style={{ textDecoration: "underline" }}>
										{filterError.start === filterError.end
											? "_"
											: filterText.slice(filterError.start, filterError.end)}
									</span>
									{filterText.slice(filterError.end)}
								</pre>
								<span className="warn">
									{filterError.message}
									{applied
										? ` — showing the last valid filter: ${applied.text}`
										: ""}
								</span>
							</div>
						)}

						{/* IO graph: the (filtered) capture on one clock. Fixed height,
						    canvas clipped inside its box — no scrollbars ever. Drag on
						    the plot to brush a time range into the table. */}
						<div
							style={{
								borderBottom: "1px solid var(--border)",
								flexShrink: 0,
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "4px 12px",
								}}
							>
								<span
									className="dim"
									style={{ fontSize: 10, letterSpacing: 1 }}
								>
									IO GRAPH{applied ? " · FILTERED SET" : ""}
								</span>
								{ioOpen && (
									<span className="dim" style={{ fontSize: 10 }}>
										FRAMES/S · <span style={{ opacity: 0.6 }}>SNR dB</span> ·{" "}
										<span className="err">● CRC FAIL</span> · drag to brush
									</span>
								)}
								<span className="spacer" />
								<button
									type="button"
									onClick={() => setIoOpen((v) => !v)}
									title={ioOpen ? "Collapse the IO graph" : "Show the IO graph"}
								>
									{ioOpen ? "▾ HIDE" : "▸ IO GRAPH"}
								</button>
							</div>
							{ioOpen &&
								(ioSeries.xs.length > 0 ? (
									<div
										ref={ioDiv}
										style={{
											height: IO_GRAPH_HEIGHT,
											overflow: "hidden",
											padding: "0 8px",
										}}
									/>
								) : (
									<div
										className="dim"
										style={{ padding: "4px 12px 8px", fontSize: 11 }}
									>
										nothing to plot — no frames pass the filter
									</div>
								))}
						</div>

						<div className="scroll-y" ref={tableRef}>
							<div className="scroll-x">
								<table className="grid">
									<thead>
										<tr>
											<th>#</th>
											<th>TIME</th>
											<th>DIR</th>
											<th>LEN</th>
											<th>FREQUENCY</th>
											<th>SF/CR</th>
											<th>RSSI</th>
											<th>SNR</th>
											<th>ORIGIN</th>
											<th>CRC</th>
										</tr>
									</thead>
									<tbody>
										{shown.map((i) => {
											const fr = frames[i];
											return (
												<tr
													key={i}
													className={i === selected ? "sel" : undefined}
													onClick={() => selectFrame(i)}
													// Roving tabIndex: the selected row is the table's one
													// tab stop, arrows walk the *visible* rows. Filtering
													// or clearing never drops the table out of the tab
													// order (PRODUCT.md: full keyboard reach).
													tabIndex={
														i === selected ||
														(!selectedVisible && i === shown[0])
															? 0
															: -1
													}
													onKeyDown={(e) => {
														if (e.key === "ArrowDown" || e.key === "ArrowUp") {
															e.preventDefault();
															const sib =
																e.key === "ArrowDown"
																	? e.currentTarget.nextElementSibling
																	: e.currentTarget.previousElementSibling;
															const pos = shown.indexOf(i);
															const next =
																shown[pos + (e.key === "ArrowDown" ? 1 : -1)];
															if (
																next !== undefined &&
																sib instanceof HTMLTableRowElement
															) {
																selectFrame(next);
																sib.focus();
															}
														} else if (e.key === "Enter" || e.key === " ") {
															e.preventDefault();
															selectFrame(i);
														}
													}}
													style={{ cursor: "pointer" }}
												>
													<td>
														{Number(fr.sequence)}
														{pointers[i] && (
															<span
																className="ok"
																title="carries a Shelby pointer"
															>
																{" "}
																◆
															</span>
														)}
													</td>
													<td>
														{(Number(fr.timestampUs - t0) / 1e6).toFixed(3)}
													</td>
													<td>{fr.direction.toUpperCase()}</td>
													<td>
														{fr.capturedLength}
														{fr.truncated && <span className="warn">*</span>}
													</td>
													<td>
														{hasField(fr, RF_FIELD.frequency)
															? fmtFreq(fr.centerFrequencyHz)
															: "—"}
													</td>
													<td>
														{fr.spreadingFactor}/{fr.codingRateDenominator}
													</td>
													<td>
														{hasField(fr, RF_FIELD.rssi)
															? fr.rssiDbm.toFixed(1)
															: "—"}
													</td>
													<td>
														{hasField(fr, RF_FIELD.snr)
															? fr.snrDb.toFixed(1)
															: "—"}
													</td>
													<td className={fr.synthetic ? "warn" : "dim"}>
														{fr.synthetic ? "SIM" : "UNMARKED"}
													</td>
													<td className={crcClass(fr.crc)}>{fr.crc}</td>
												</tr>
											);
										})}
										{(applied || brush) && shown.length === 0 && (
											<tr>
												<td colSpan={10} className="dim">
													no frames match the{" "}
													{applied && brush
														? "filter and time range"
														: applied
															? "filter"
															: "brushed time range"}{" "}
													— {frames.length} hidden
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</div>

						<div className="panel-foot">
							{applied || brush ? (
								<span className="ok">
									FILTERED {shown.length}/{frames.length} FRAMES
									{brush && ` · ${brushLabel(brush)}`}
								</span>
							) : (
								<>{frames.length} FRAMES</>
							)}
							{" · "}
							{shownPointerCount} SHELBY POINTER(S)
							{shownFrames.some((fr) => fr.synthetic) && (
								<span className="warn">
									{shownFrames.filter((fr) => fr.synthetic).length} SYNTHETIC ·
									NOT OTA
								</span>
							)}
							{shownFrames.some((fr) => fr.truncated) && (
								<span className="dim">* = FRAME TRUNCATED AT CAPTURE</span>
							)}
							<span className="spacer" />
							{/* One link to exactly this view (UI-007) — or the honest
							    alternative: a local capture has no address to link to. */}
							{permalinkUrl ? (
								<PermalinkAction url={permalinkUrl} />
							) : (
								<span
									className="dim"
									title="A permalink needs an address on Shelby — publish this capture (or open one by blob name or pointer) and the link appears here"
								>
									NO PERMALINK — PUBLISH TO GET A LINK
								</span>
							)}
						</div>
					</>
				)}
			</div>

			{f && (
				<div className="panel" style={{ width: 360, flexShrink: 0 }}>
					<div className="panel-title">FRAME {Number(f.sequence)}</div>

					<div className="scroll-y">
						<div className="kv">
							<span className="k">MODULATION</span>
							<span className="v">{f.modulation.toUpperCase()}</span>
							<span className="k">CAPTURED</span>
							<span className="v">
								{f.capturedLength} / {f.originalLength} B
							</span>
							<span className="k">FREQUENCY</span>
							<span className="v">
								{hasField(f, RF_FIELD.frequency)
									? fmtFreq(f.centerFrequencyHz)
									: "n/r"}
							</span>
							<span className="k">BANDWIDTH</span>
							<span className="v">
								{hasField(f, RF_FIELD.bandwidth)
									? fmtFreq(f.bandwidthHz)
									: "n/r"}
							</span>
							<span className="k">SF / CR</span>
							<span className="v">
								SF{f.spreadingFactor} · 4/{f.codingRateDenominator}
							</span>
							<span className="k">RSSI</span>
							<span className="v">
								{hasField(f, RF_FIELD.rssi)
									? `${f.rssiDbm.toFixed(1)} dBm`
									: "n/r"}
							</span>
							<span className="k">SNR</span>
							<span className="v">
								{hasField(f, RF_FIELD.snr) ? `${f.snrDb.toFixed(1)} dB` : "n/r"}
							</span>
							<span className="k">AIRTIME</span>
							<span className="v">
								{hasField(f, RF_FIELD.airtime)
									? `${(f.airtimeUs / 1000).toFixed(1)} ms`
									: "n/r"}
							</span>
							<span className="k">INTEGRITY</span>
							<span className={`v ${crcClass(f.crc)}`}>{f.crc}</span>
							<span className="k">ORIGIN</span>
							<span className={`v ${f.synthetic ? "warn" : "dim"}`}>
								{f.synthetic ? "SYNTHETIC · NOT OTA" : "UNMARKED"}
							</span>
						</div>

						{ptr && (
							<>
								<div className="panel-title">
									SHELBY POINTER · OFFSET {ptr.offset}
									<span className="spacer" />
									<button
										type="button"
										onClick={() => void resolvePointer()}
										disabled={resolving}
									>
										{resolving ? "RESOLVING…" : "⇓ RESOLVE"}
									</button>
								</div>
								<div className="kv">
									<span className="k">COMMITMENT</span>
									<span className="v">{ptr.pointer.commitment}</span>
									<span className="k">OWNER</span>
									<span className="v">{ptr.pointer.owner}</span>
									<span className="k">BLOB SIZE</span>
									<span className="v">
										{ptr.pointer.sizeBytes.toLocaleString()} B
									</span>
									<span className="k">CHUNK</span>
									<span className="v">
										{ptr.pointer.chunkIndex + 1} / {ptr.pointer.chunkCount}
									</span>
								</div>
							</>
						)}

						{trace && (
							<>
								<div className="panel-title">
									SHELBY RESOLVE
									<span className="spacer" />
									{!resolving && (
										<button type="button" onClick={() => setTrace(null)}>
											DISMISS
										</button>
									)}
								</div>
								<div className="trace">
									{trace.map((t) => (
										<div className={`trace-step ${t.state}`} key={t.label}>
											<span className="trace-glyph">
												{t.state === "ok" ? "✓" : t.state === "err" ? "✕" : "▸"}
											</span>
											<span className="trace-label">{t.label}</span>
											<span className="trace-detail">{t.detail}</span>
										</div>
									))}
								</div>
							</>
						)}

						{dissection && (
							// Keyed per frame so tree expansion, node selection and hex
							// hover always describe the frame on screen.
							<DissectPane
								key={`${selected}·${Number(f.sequence)}`}
								bytes={f.bytes}
								dissection={dissection}
							/>
						)}
					</div>
				</div>
			)}
		</main>
	);
}
