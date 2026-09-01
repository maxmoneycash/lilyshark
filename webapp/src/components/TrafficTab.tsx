import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode,
} from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
	type AnnotationSidecar,
	annotatedSequences,
	describeCapture,
	emptySidecar,
	noteFor,
	noteMap,
	parseSidecar,
	serializeSidecar,
	setNote,
	sidecarFileName,
	sidecarMismatches,
	sidecarSummary,
} from "../lib/annotations";
import {
	type AnnounceDestination,
	type AnnounceOverview,
	announceTicks,
	destinationFilterExpression,
	hopRangeLabel,
	summarizeAnnounces,
} from "../lib/announceView";
import {
	type CaptureDiff,
	type DiffRow,
	diffCaptures,
	diffRows,
	diffSummaryNote,
	witnessSummary,
} from "../lib/captureDiff";
import {
	captureByteLength,
	captureElapsedMs,
	captureFileName,
	captureToLscap,
	clearCapture,
	getCaptureSession,
	sessionCapture,
	startCapture,
	stopCapture,
	useCaptureSession,
} from "../lib/captureSession";
import {
	activeSlot,
	type CaptureSlot,
	emptySlots,
	MAX_OPEN_CAPTURES,
	type SlotAction,
	type SlotOrigin,
	type SlotState,
	slotBadges,
	slotsReducer,
	slotTitle,
} from "../lib/captureSlots";
import {
	conversationCoverage,
	conversationExpression,
	conversationLabel,
	coverageNote,
	frameAddressing,
	parseConversationExpression,
} from "../lib/conversation";
import {
	connectDeviceLink,
	disconnectDeviceLink,
	useDeviceLink,
} from "../lib/deviceLink";
import type { FrameDissection } from "../lib/dissect/registry";
import { dissectFrame } from "../lib/dissect/registry";
import { reticulumDestinationHashHex } from "../lib/dissect/rnode";
import {
	deepestRowAt,
	flattenTree,
	profileProtocolHint,
	treeKeyNav,
} from "../lib/dissect/tree";
import type { ChannelKey, NodeTone } from "../lib/dissect/types";
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
import {
	computeRowWindow,
	DEFAULT_ROW_HEIGHT_PX,
	rowInWindow,
	rowsPerPage,
	scrollTopForRow,
	tableKeyNav,
	visibleSpan,
} from "../lib/virtualRows";
import { demoNextFrame, isDemo } from "../mesh/demo";
import { fg, useThemeTick } from "../mesh/theme";
import { startTrafficDemoInterval } from "./trafficDemo";

/**
 * The synthetic SIM stream stops growing here; old frames age out on the left.
 *
 * It was 250 because the table rendered every row it held. The table is
 * windowed now (lib/virtualRows), so the bound is memory, not the DOM:
 * 50,000 × ~594 B for a 40 B-payload frame ≈ 29 MB, well inside the per-slot
 * budget whose arithmetic lives in lib/captureSlots.
 */
const LIVE_CAP = 50_000;

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
 * The capture profile a frame actually reported, or null when it reported
 * none. The dissector never guesses a protocol the radio did not name, and
 * neither does the announce panel or the `dest` display filter.
 */
const profileOf = (fr: LscapFrame): number | null =>
	hasField(fr, RF_FIELD.profile) ? fr.profileId : null;

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

/* ── user-supplied channel keys (UI-011) ────────────────────────────────
 * Keys live ONLY in React state: never localStorage, never the URL hash,
 * never any request. A reload clears them, and the panel says so. */

/** Parse a channel key typed as hex (32/64 digits) or base64 (16/32 bytes). */
function parseKeyText(raw: string): { key: Uint8Array } | { error: string } {
	const text = raw.trim();
	if (text === "") return { error: "enter the key as hex or base64" };
	const need = "need 16 bytes (AES-128) or 32 (AES-256)";
	if (/^(?:0x)?[0-9a-fA-F\s]+$/.test(text)) {
		const digits = text.replace(/^0x/, "").replace(/\s+/g, "");
		if (digits.length % 2 === 0) {
			const bytes = new Uint8Array(digits.length / 2);
			for (let i = 0; i < bytes.length; i++)
				bytes[i] = Number.parseInt(digits.slice(i * 2, i * 2 + 2), 16);
			if (bytes.length === 16 || bytes.length === 32) return { key: bytes };
			return { error: `hex key is ${bytes.length} bytes — ${need}` };
		}
		// Odd digit count cannot be hex; fall through and try base64.
	}
	try {
		const bin = atob(text);
		const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
		if (bytes.length === 16 || bytes.length === 32) return { key: bytes };
		return { error: `base64 key is ${bytes.length} bytes — ${need}` };
	} catch {
		return { error: "not valid hex or base64" };
	}
}

/**
 * Compact key manager for the dissection pane: add (name + hex/base64,
 * validated inline like the filter row), list, remove. Hoisted state — the
 * parent owns the list so a frame change never drops the keys.
 */
function ChannelKeysPanel({
	keys,
	onAdd,
	onRemove,
}: {
	keys: readonly ChannelKey[];
	onAdd: (key: ChannelKey) => void;
	onRemove: (index: number) => void;
}) {
	const [name, setName] = useState("");
	const [keyText, setKeyText] = useState("");
	const [error, setError] = useState<string | null>(null);

	const add = () => {
		const label = name.trim();
		if (!label) {
			setError("name the key — decodes report which key read the frame");
			return;
		}
		if (keys.some((k) => k.name === label)) {
			setError(`a key named "${label}" is already listed`);
			return;
		}
		const parsed = parseKeyText(keyText);
		if ("error" in parsed) {
			setError(parsed.error);
			return;
		}
		onAdd({ name: label, key: parsed.key });
		setName("");
		setKeyText("");
		setError(null);
	};

	return (
		<>
			<div className="panel-title">
				CHANNEL KEYS{keys.length > 0 ? ` · ${keys.length}` : ""}
			</div>
			<div
				style={{
					padding: "6px 12px 8px",
					fontSize: 11,
					display: "flex",
					flexDirection: "column",
					gap: 6,
				}}
			>
				<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
					<input
						placeholder="name_"
						aria-label="channel key name"
						value={name}
						spellCheck={false}
						autoComplete="off"
						style={{ width: 90, flexShrink: 0 }}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && add()}
					/>
					<input
						placeholder="hex or base64 key_"
						aria-label="channel key (hex or base64)"
						value={keyText}
						spellCheck={false}
						autoComplete="off"
						aria-invalid={error !== null}
						aria-describedby={error ? "channel-key-error" : undefined}
						style={{
							flex: 1,
							minWidth: 0,
							...(error ? { borderColor: "var(--err)" } : null),
						}}
						onChange={(e) => setKeyText(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && add()}
					/>
					<button type="button" onClick={add}>
						ADD
					</button>
				</div>
				{error && (
					// The filter row's error idiom: the offense pointed out inline,
					// in warn ink, right under the input that caused it.
					<div id="channel-key-error" role="alert" className="warn">
						{error}
					</div>
				)}
				{keys.map((k, i) => (
					<div
						key={k.name}
						style={{ display: "flex", gap: 6, alignItems: "center" }}
					>
						<span className="ok">◆</span>
						<span>{k.name}</span>
						<span className="dim">
							AES-{k.key.length === 32 ? 256 : 128} · tried after the default
							PSK
						</span>
						<span className="spacer" />
						<button
							type="button"
							title={`Forget channel key "${k.name}"`}
							onClick={() => onRemove(i)}
						>
							✕
						</button>
					</div>
				))}
				<div className="dim">
					keys stay in this tab — memory only, never stored or uploaded; reload
					clears them
				</div>
			</div>
		</>
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
	userKeyCount,
}: {
	bytes: Uint8Array;
	dissection: FrameDissection;
	/** How many user channel keys were tried — the ciphertext line says so. */
	userKeyCount: number;
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
					) : meshtasticPayload.userKey ? (
						// A user key does NOT get the "never private" phrasing: it only
						// proves this tab was handed the channel secret.
						<span className="ok">
							DECRYPTED · AES-{meshtasticPayload.userKey.bits}-CTR under channel
							key "{meshtasticPayload.userKey.name}" — supplied in this tab,
							held in memory only
						</span>
					) : (
						<span className="warn">
							CIPHERTEXT · not readable with the published default channel PSK
							{userKeyCount > 0 &&
								` or any of the ${userKeyCount} channel key(s) supplied here`}{" "}
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

/* ── ANNOUNCES panel (UI-013) ──────────────────────────────────────────
 * The first Reticulum announce view: one row per destination hash the
 * capture heard announce, over the same capture clock the table and the IO
 * graph read. Every figure comes from the semantic announce tier in
 * dissect/rnode.ts — a port of readReticulumAnnounce — which reads only
 * what length and flag arithmetic prove about a cleartext announce. No key
 * is held here, no signature is checked, and no announce payload byte is
 * interpreted, so nothing on this panel may say otherwise: app_data is a
 * length, the ratchet and public key are presence, and SHARE is a share of
 * this capture's ANNOUNCES, never of its total traffic.
 *
 * Clicking a row writes `dest == <hash>` into the ordinary display filter,
 * so it composes with everything else the operator has typed and lands in
 * the permalink like any other filter. */

const TIMELINE_WIDTH = 160;
const TIMELINE_HEIGHT = 14;

/** One destination's announces drawn on the capture's announce span. */
function AnnounceTimeline({
	destination,
	overview,
}: {
	destination: AnnounceDestination;
	overview: AnnounceOverview;
}) {
	const ticks = announceTicks(destination, overview);
	const inset = 2;
	const usable = TIMELINE_WIDTH - inset * 2;
	return (
		<svg
			width={TIMELINE_WIDTH}
			height={TIMELINE_HEIGHT}
			viewBox={`0 0 ${TIMELINE_WIDTH} ${TIMELINE_HEIGHT}`}
			role="img"
			aria-label={`${destination.count} announce(s) between ${destination.firstSeenS.toFixed(3)} and ${destination.lastSeenS.toFixed(3)} seconds, ${destination.pathChanges} observed path change(s)`}
			style={{ display: "block" }}
		>
			<title>
				{`${destination.count} announce(s) on the capture clock · ${destination.pathChanges} observed path change(s)`}
			</title>
			<line
				x1={inset}
				y1={TIMELINE_HEIGHT / 2}
				x2={TIMELINE_WIDTH - inset}
				y2={TIMELINE_HEIGHT / 2}
				stroke="currentColor"
				strokeOpacity={0.22}
			/>
			{ticks.map((tick) => (
				<line
					key={tick.frameIndex}
					x1={inset + tick.x * usable}
					x2={inset + tick.x * usable}
					y1={tick.pathChange ? 0 : 3}
					y2={tick.pathChange ? TIMELINE_HEIGHT : TIMELINE_HEIGHT - 3}
					// Shape, not colour: a path change is the taller, heavier mark,
					// so it survives the inverted palette of a selected row and
					// reads without colour vision.
					stroke="currentColor"
					strokeWidth={tick.pathChange ? 2 : 1}
					strokeOpacity={tick.pathChange ? 1 : 0.6}
				/>
			))}
		</svg>
	);
}

function AnnouncesPanel({
	overview,
	activeDestination,
	onToggleDestination,
}: {
	overview: AnnounceOverview;
	/** The destination hash the applied filter currently isolates, if any. */
	activeDestination: string | null;
	onToggleDestination: (destinationHashHex: string) => void;
}) {
	const [open, setOpen] = useState(true);
	// Nothing to say about a capture that carries no Reticulum traffic at
	// all — an empty panel would be a claim of its own.
	if (overview.reticulumFrameCount === 0) return null;

	const shareLabel = overview.shareIsAirtime
		? "ANNOUNCE AIRTIME SHARE"
		: "ANNOUNCE SHARE";
	const shareTitle = overview.shareIsAirtime
		? "Share of this capture's ANNOUNCE airtime — not of total traffic, and not a duty cycle."
		: "Share of this capture's announces, by count — not of total traffic. This capture reports no per-frame airtime.";

	return (
		<div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "4px 12px",
				}}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
					ANNOUNCES
				</span>
				<span className="dim" style={{ fontSize: 10 }}>
					{overview.announceCount > 0 ? (
						<>
							{overview.announceCount} from {overview.destinations.length}{" "}
							destination(s) · structure only, no keys held
						</>
					) : (
						"no announces in this capture"
					)}
				</span>
				<span className="spacer" />
				{overview.announceCount > 0 && (
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						title={
							open ? "Collapse the announce table" : "Show the announce table"
						}
					>
						{open ? "▾ HIDE" : "▸ ANNOUNCES"}
					</button>
				)}
			</div>
			{overview.announceCount === 0 ? (
				<div className="dim" style={{ padding: "0 12px 8px", fontSize: 11 }}>
					{overview.reticulumFrameCount} Reticulum frame(s) present; none
					carried a payload that provably held the fixed announce fields.
				</div>
			) : (
				open && (
					<div className="scroll-x" style={{ padding: "0 8px 8px" }}>
						<table className="grid">
							<thead>
								<tr>
									<th>DESTINATION</th>
									<th>ANNOUNCES</th>
									<th>FIRST</th>
									<th>LAST</th>
									<th>CADENCE</th>
									<th>HOPS</th>
									<th>MARKERS</th>
									<th title={shareTitle}>{shareLabel}</th>
									<th>TIMELINE · ▮ PATH CHANGE</th>
								</tr>
							</thead>
							<tbody>
								{overview.destinations.map((d) => {
									const active = d.destinationHashHex === activeDestination;
									const share = overview.shareIsAirtime
										? (d.airtimeSharePercent ?? d.countSharePercent)
										: d.countSharePercent;
									return (
										<tr
											key={d.destinationHashHex}
											className={active ? "sel" : undefined}
											tabIndex={0}
											aria-selected={active}
											style={{ cursor: "pointer" }}
											title={
												active
													? "Showing only this destination — click to clear the filter"
													: `Filter the table to ${d.destinationHashHex}`
											}
											onClick={() => onToggleDestination(d.destinationHashHex)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													onToggleDestination(d.destinationHashHex);
												}
											}}
										>
											<td title={d.destinationHashHex}>
												{d.prefix}
												<span className="dim">…</span>
											</td>
											<td>{d.count}</td>
											<td>{d.firstSeenS.toFixed(3)}</td>
											<td>{d.lastSeenS.toFixed(3)}</td>
											<td className={d.meanIntervalS === null ? "dim" : ""}>
												{d.meanIntervalS === null
													? "—"
													: `${d.meanIntervalS.toFixed(1)} s`}
											</td>
											<td>{hopRangeLabel(d)}</td>
											<td>
												{d.ratchetCount > 0 && (
													<span
														className="ok"
														title={`${d.ratchetCount} announce(s) carried the 32 ratchet bytes the context flag promised — presence only, never validated`}
													>
														RATCHET {d.ratchetCount}
													</span>
												)}
												{d.ratchetCount > 0 && d.appDataCount > 0 && " · "}
												{d.appDataCount > 0 && (
													<span
														title={`${d.appDataCount} announce(s) carried an application-defined tail — a length only; the bytes are never interpreted`}
													>
														APP DATA {d.appDataCount}
													</span>
												)}
												{(d.ratchetCount > 0 || d.appDataCount > 0) &&
													d.transportedCount > 0 &&
													" · "}
												{d.transportedCount > 0 && (
													<span
														className="dim"
														title={`${d.transportedCount} announce(s) arrived through a transport instance (HEADER_2)`}
													>
														VIA {d.transportedCount}
													</span>
												)}
												{d.ratchetCount === 0 &&
													d.appDataCount === 0 &&
													d.transportedCount === 0 && (
														<span className="dim">—</span>
													)}
											</td>
											<td title={shareTitle}>{share.toFixed(1)}%</td>
											<td>
												<AnnounceTimeline destination={d} overview={overview} />
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)
			)}
		</div>
	);
}

/* ── frame note (UI-010) ───────────────────────────────────────────────
 * One frame's field note. It attaches to the frame's SEQUENCE NUMBER and is
 * stored in a JSON sidecar (lib/annotations) — never in the .lscap, whose
 * bytes must stay byte-identical to the commitment that was published and
 * anchored. Mounted with a key per frame so the draft belongs to the frame
 * on screen and never leaks onto the next one. */

function FrameNotePanel({
	sequence,
	saved,
	onSave,
}: {
	sequence: number;
	/** The note this frame already carries, or "" for none. */
	saved: string;
	/** Writes the note; returns an error to show, or null on success. */
	onSave: (text: string) => string | null;
}) {
	const [draft, setDraft] = useState(saved);
	const [error, setError] = useState<string | null>(null);
	const [savedAt, setSavedAt] = useState(false);
	const dirty = draft.trim() !== saved.trim();

	const commit = () => {
		const failure = onSave(draft);
		setError(failure);
		setSavedAt(failure === null);
	};

	return (
		<>
			<div className="panel-title">
				NOTE · FRAME {sequence}
				<span className="spacer" />
				{saved !== "" && (
					<span className="ok" title="This frame carries a note">
						✎
					</span>
				)}
			</div>
			<div
				style={{
					padding: "6px 12px 8px",
					fontSize: 11,
					display: "flex",
					flexDirection: "column",
					gap: 6,
				}}
			>
				<textarea
					aria-label={`note on frame ${sequence}`}
					placeholder="what happened here_"
					value={draft}
					rows={2}
					spellCheck={false}
					aria-invalid={error !== null}
					aria-describedby={error ? "frame-note-error" : undefined}
					style={{
						width: "100%",
						resize: "vertical",
						font: "inherit",
						...(error ? { borderColor: "var(--err)" } : null),
					}}
					onChange={(e) => {
						setDraft(e.target.value);
						setError(null);
						setSavedAt(false);
					}}
					onKeyDown={(e) => {
						// Enter saves; Shift+Enter is a line break, as in every
						// comment box. ESC restores what is stored.
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							commit();
						}
						if (e.key === "Escape") {
							setDraft(saved);
							setError(null);
						}
					}}
				/>
				<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
					<button type="button" onClick={commit} disabled={!dirty}>
						{saved === "" ? "SAVE NOTE" : "UPDATE NOTE"}
					</button>
					{saved !== "" && (
						<button
							type="button"
							title="Remove this frame's note"
							onClick={() => {
								setDraft("");
								setError(onSave(""));
								setSavedAt(true);
							}}
						>
							✕ REMOVE
						</button>
					)}
					{savedAt && !dirty && <span className="ok">saved</span>}
				</div>
				{error && (
					<div id="frame-note-error" role="alert" className="warn">
						{error}
					</div>
				)}
				<div className="dim">
					kept in a JSON sidecar beside the capture, keyed by sequence number —
					the .lscap bytes never change, so its commitment stays valid
				</div>
			</div>
		</>
	);
}

/* ── DIFF panel (UI-009) ───────────────────────────────────────────────
 * Two open captures side by side. Two T-Decks in the field produce two
 * captures of one RF event, and comparing them is how a coverage or witness
 * claim gets checked by hand: the same transmission, heard twice, with each
 * device's own RSSI and SNR next to each other.
 *
 * All the matching lives in lib/captureDiff — identical payloads, confirmed
 * byte for byte, paired one-to-one within a tolerance around an estimated
 * clock offset (two devices' boot clocks are unrelated numbers). This is the
 * view: one row per transmission on the common clock, unmatched frames
 * marked per side, and the alignment's own provenance said out loud above
 * the table. Nothing here decides which capture is right. */

/** Rows rendered before the table stops and says how many it left. */
const DIFF_ROW_LIMIT = 500;

const dbCell = (value: number | null, digits = 1) =>
	value === null ? <span className="dim">n/r</span> : value.toFixed(digits);

/** A signed difference, where "signed" is the point: +3.0 dB, −7.5 dB. */
const deltaCell = (value: number | null) =>
	value === null ? (
		<span className="dim">—</span>
	) : (
		<span className={value === 0 ? "dim" : ""}>
			{value > 0 ? "+" : value < 0 ? "−" : ""}
			{Math.abs(value).toFixed(1)}
		</span>
	);

function DiffPanel({
	nameA,
	nameB,
	framesA,
	framesB,
	diff,
	rows,
	onSelectA,
	onClose,
}: {
	nameA: string;
	nameB: string;
	framesA: LscapFrame[];
	framesB: LscapFrame[];
	diff: CaptureDiff;
	rows: DiffRow[];
	/** Select a frame of the ACTIVE capture (side A) from a diff row. */
	onSelectA: (index: number) => void;
	onClose: () => void;
}) {
	const [open, setOpen] = useState(true);
	const summary = witnessSummary(diff);
	const shownRows = rows.slice(0, DIFF_ROW_LIMIT);

	return (
		<div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "4px 12px",
					flexWrap: "wrap",
				}}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
					DIFF
				</span>
				<span style={{ fontSize: 11 }}>
					<span className="ok">A</span> {nameA} · <span className="ok">B</span>{" "}
					{nameB}
				</span>
				<span className="dim" style={{ fontSize: 10 }}>
					{diffSummaryNote(diff)}
				</span>
				<span className="spacer" />
				<button type="button" onClick={() => setOpen((v) => !v)}>
					{open ? "▾ HIDE" : "▸ DIFF"}
				</button>
				<button type="button" onClick={onClose} title="Stop comparing">
					✕
				</button>
			</div>
			{open && (
				<>
					<div style={{ padding: "0 12px 6px", fontSize: 11 }}>
						{summary.bothHeard === 0 ? (
							<span className="warn">
								no transmission appears in both captures — nothing here
								corroborates anything
							</span>
						) : (
							<>
								<span className="ok">
									{summary.bothHeard} transmission(s) heard by both devices
								</span>
								{" · "}
								<span className={summary.onlyA > 0 ? "warn" : "dim"}>
									{summary.onlyA} only in A
								</span>
								{" · "}
								<span className={summary.onlyB > 0 ? "warn" : "dim"}>
									{summary.onlyB} only in B
								</span>
								{summary.meanRssiDeltaDb !== null && (
									<span
										className="dim"
										title={`Mean of B − A over the ${summary.rssiPairs} matched pair(s) where BOTH radios reported RSSI`}
									>
										{" · "}B heard them{" "}
										{Math.abs(summary.meanRssiDeltaDb).toFixed(1)} dB{" "}
										{summary.meanRssiDeltaDb >= 0 ? "stronger" : "weaker"} on
										average ({summary.rssiPairs} pair(s))
									</span>
								)}
								{summary.meanSnrDeltaDb !== null && (
									<span
										className="dim"
										title={`Mean of B − A over the ${summary.snrPairs} matched pair(s) where BOTH radios reported SNR`}
									>
										{" · "}ΔSNR {summary.meanSnrDeltaDb >= 0 ? "+" : "−"}
										{Math.abs(summary.meanSnrDeltaDb).toFixed(1)} dB mean
									</span>
								)}
							</>
						)}
					</div>
					<div className="scroll-x" style={{ padding: "0 8px 8px" }}>
						<table className="grid">
							<thead>
								<tr>
									<th title="Seconds on the common clock, measured from A's first frame">
										TIME
									</th>
									<th>HEARD</th>
									<th>A #</th>
									<th>B #</th>
									<th>LEN</th>
									<th>RSSI A</th>
									<th>RSSI B</th>
									<th>Δ dB</th>
									<th>SNR A</th>
									<th>SNR B</th>
									<th>Δ dB</th>
									<th title="B's clock minus A's, less the estimated offset">
										Δt ms
									</th>
								</tr>
							</thead>
							<tbody>
								{shownRows.map((row) => {
									const frameA =
										row.aIndex !== null ? framesA[row.aIndex] : null;
									const frameB =
										row.bIndex !== null ? framesB[row.bIndex] : null;
									const pair = row.pair;
									return (
										<tr
											key={`${row.kind}:${row.aIndex ?? "-"}:${row.bIndex ?? "-"}`}
											tabIndex={frameA ? 0 : -1}
											style={frameA ? { cursor: "pointer" } : undefined}
											title={
												frameA
													? "Select this frame in the open capture (A)"
													: "This frame is in capture B, which is not the one on screen"
											}
											onClick={() =>
												row.aIndex !== null && onSelectA(row.aIndex)
											}
											onKeyDown={(e) => {
												if (
													row.aIndex !== null &&
													(e.key === "Enter" || e.key === " ")
												) {
													e.preventDefault();
													onSelectA(row.aIndex);
												}
											}}
										>
											<td>{row.timeS.toFixed(3)}</td>
											<td
												className={row.kind === "both" ? "ok" : "warn"}
												title={
													row.kind === "both"
														? "Both devices heard this transmission"
														: `Only capture ${row.kind === "a-only" ? "A" : "B"} holds this frame`
												}
											>
												{row.kind === "both"
													? "A+B"
													: row.kind === "a-only"
														? "A ONLY"
														: "B ONLY"}
											</td>
											<td className={frameA ? "" : "dim"}>
												{frameA ? Number(frameA.sequence) : "—"}
											</td>
											<td className={frameB ? "" : "dim"}>
												{frameB ? Number(frameB.sequence) : "—"}
											</td>
											<td>{(frameA ?? frameB)?.capturedLength ?? 0}</td>
											<td>
												{frameA
													? dbCell(
															hasField(frameA, RF_FIELD.rssi)
																? frameA.rssiDbm
																: null,
														)
													: "—"}
											</td>
											<td>
												{frameB
													? dbCell(
															hasField(frameB, RF_FIELD.rssi)
																? frameB.rssiDbm
																: null,
														)
													: "—"}
											</td>
											<td>{pair ? deltaCell(pair.rssiDeltaDb) : "—"}</td>
											<td>
												{frameA
													? dbCell(
															hasField(frameA, RF_FIELD.snr)
																? frameA.snrDb
																: null,
														)
													: "—"}
											</td>
											<td>
												{frameB
													? dbCell(
															hasField(frameB, RF_FIELD.snr)
																? frameB.snrDb
																: null,
														)
													: "—"}
											</td>
											<td>{pair ? deltaCell(pair.snrDeltaDb) : "—"}</td>
											<td className="dim">
												{pair ? (pair.residualUs / 1000).toFixed(1) : "—"}
											</td>
										</tr>
									);
								})}
								{rows.length === 0 && (
									<tr>
										<td colSpan={12} className="dim">
											both captures are empty
										</td>
									</tr>
								)}
							</tbody>
						</table>
						{rows.length > shownRows.length && (
							<div className="dim" style={{ paddingTop: 6, fontSize: 11 }}>
								showing the first {shownRows.length} of{" "}
								{rows.length.toLocaleString()} rows on the common clock
							</div>
						)}
					</div>
				</>
			)}
		</div>
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

/**
 * One step of the resolve trace — the walk from Shelby coordinates to an
 * opened capture, narrated on screen while it happens.
 */
interface TraceStep {
	label: string;
	detail: string;
	state: "run" | "ok" | "err";
}

/* ── capture slots (UI-012) ────────────────────────────────────────────
 * Everything below belongs to ONE open capture. The tab holds several, and
 * switching slots swaps the whole lot at once — table, stats, IO strip,
 * announces, dissection, resolve trace, publish result — because every one
 * of them is derived from these fields and nothing else. lib/captureSlots
 * owns the identity, ordering, capacity and labels; this is the payload it
 * carries around. */

interface CaptureView {
	capture: LscapCapture | null;
	/** Where this capture lives on Shelby — null for a local, unpublished one. */
	ref: CaptureRef | null;
	/** Index into `capture.frames` of the frame the detail pane describes. */
	selected: number;
	filterText: string;
	applied: AppliedFilter | null;
	brush: BrushRange | null;
	/** A note about this capture (trailing bytes), not an open failure. */
	note: string | null;
	exportNote: { text: string; warn: boolean } | null;
	published: {
		publish: PublishResult;
		/** 'pending' while the read-back runs; 'ok' or the mismatch reason after. */
		verified: "pending" | "ok" | string;
	} | null;
	publishError: string | null;
	/** Next sequence number the synthetic SIM stream will use here. */
	liveSeq: number;
	/** True when any frame in it was generated rather than heard. */
	containsSynthetic: boolean;
	/**
	 * This capture's field notes (UI-010). It belongs to the slot, so switching
	 * captures switches notes with everything else, and it is never written
	 * into the .lscap — the sidecar is a separate document, downloadable and
	 * uploadable beside the capture.
	 */
	annotations: AnnotationSidecar;
}

const BLANK_VIEW: CaptureView = {
	capture: null,
	ref: null,
	selected: 0,
	filterText: "",
	applied: null,
	brush: null,
	note: null,
	exportNote: null,
	published: null,
	publishError: null,
	liveSeq: 1000,
	containsSynthetic: false,
	annotations: emptySidecar(),
};

/** The one slot the capture session records into; reused every recording. */
const LIVE_SLOT_KEY = "live-capture-session";

/** A stable empty frame list, so "no capture" does not churn every memo. */
const NO_FRAMES: LscapFrame[] = [];

/**
 * The two spacer rows that stand in for the frames outside the window. They
 * are structure, not content: the grid's hover ink, its pointer cursor and
 * the row-landing animation it plays on the last row all belong to real
 * frames, so they are switched off here rather than flashing over a gap.
 */
const SPACER_ROW: CSSProperties = {
	background: "transparent",
	cursor: "default",
	animation: "none",
};
const SPACER_CELL: CSSProperties = {
	padding: 0,
	border: 0,
};

/** slotsReducer bound to this tab's view payload (useReducer wants a value). */
function reduceSlots(
	state: SlotState<CaptureView>,
	action: SlotAction<CaptureView>,
): SlotState<CaptureView> {
	return slotsReducer(state, action);
}

interface TrafficTabProps {
	/** True only while TerminalApp is showing its synthetic demo state. */
	demoActive: boolean;
}

export function TrafficTab({ demoActive }: TrafficTabProps) {
	// ── open captures (UI-012) ────────────────────────────────────────────
	// Several captures are open at once; `view` is whichever one the slot bar
	// has active, and every derived value below reads from it and nothing else,
	// so switching slots swaps the whole dependent view in one render.
	const [slotState, dispatch] = useReducer(
		reduceSlots,
		emptySlots<CaptureView>(),
	);
	const slot = activeSlot(slotState);
	const view = slot?.view ?? BLANK_VIEW;
	const capture = view.capture;
	const name = slot?.name ?? "";
	const selected = view.selected;
	/** Merge into the active capture's view state; no other slot sees it. */
	const patch = useCallback(
		(next: Partial<CaptureView>) => dispatch({ type: "patch", view: next }),
		[],
	);
	// The synthetic ticker and the capture-session effect fire outside render
	// and must reach whatever slot is active when they fire.
	const slotRef = useRef<CaptureSlot<CaptureView> | null>(slot);
	slotRef.current = slot;

	/** A failed open. It never clears the capture already on screen. */
	const [openError, setOpenError] = useState<string | null>(null);
	const error = openError ?? view.note;
	const [blob, setBlob] = useState("");
	const [busy, setBusy] = useState(false);
	// Live demo mode adds synthetic frames at a configured cadence. It is
	// available only while TerminalApp is showing the demo mesh. Opening a file
	// pauses it.
	const [live, setLive] = useState(() => demoActive && isDemo());
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
	/** `filter=` from the URL, handed to the first capture that opens. */
	const bootFilter = useRef(readHashFilter());
	const scrollToSelected = useRef(false);
	/** Where the active capture lives on Shelby — null for a local, unpublished
	 *  capture, which therefore has no permalink until it is published. */
	const captureRef = view.ref;

	/**
	 * Open a parsed capture into a slot: the same source (blob, commitment,
	 * file name, the sample) reuses its slot rather than stacking duplicates,
	 * anything else takes a new one.
	 */
	const load = (
		buf: ArrayBuffer,
		from: string,
		opts: { ref?: CaptureRef | null; origin?: SlotOrigin; key?: string } = {},
	) => {
		try {
			const c = parseLscap(buf);
			const ref = opts.ref ?? null;
			// A permalink names its frame by sequence number; otherwise land on
			// the most interesting frame — the first one carrying a Shelby
			// pointer, so the decoded pointer detail is on screen from the start.
			const want = pendingFrame.current;
			pendingFrame.current = null;
			const wantIdx =
				want !== null
					? c.frames.findIndex((fr) => Number(fr.sequence) === want)
					: -1;
			if (wantIdx >= 0) scrollToSelected.current = true;
			const ptrIdx =
				wantIdx >= 0
					? -1
					: c.frames.findIndex((fr) => findShelbyPointer(fr.bytes));
			// The boot permalink's filter belongs to the capture the link named,
			// and to that one only — a later open starts with a clean filter
			// rather than inheriting a predicate written for other frames.
			const filterText = bootFilter.current;
			bootFilter.current = "";
			const parsed = parseFrameFilter(filterText);
			dispatch({
				type: "open",
				key: opts.key ?? `file:${from}`,
				origin: opts.origin ?? "file",
				name: from,
				view: {
					...BLANK_VIEW,
					capture: c,
					ref,
					selected: wantIdx >= 0 ? wantIdx : ptrIdx >= 0 ? ptrIdx : 0,
					filterText,
					applied:
						parsed.ok && !parsed.empty
							? { text: filterText, predicate: parsed.predicate }
							: null,
					// Live frames continue the capture's own numbering; a jump from
					// 23 to 1000 read as a glitch, not a stream.
					liveSeq: Number(c.frames[c.frames.length - 1]?.sequence ?? -1n) + 1,
					containsSynthetic: c.frames.some((fr) => fr.synthetic),
					// A fresh, empty sidecar that knows which capture it describes;
					// an existing one is uploaded onto it (⭱ NOTES).
					annotations: emptySidecar({
						name: from,
						frameCount: c.frames.length,
						commitment: ref?.kind === "commit" ? ref.commitment : null,
					}),
					note:
						c.trailingBytes > 0
							? `${c.trailingBytes} trailing byte(s) were not a complete record`
							: null,
				},
			});
			// The frame param survives only when this load honored it; any other
			// load would leave a stale frame= describing the previous capture.
			writeHashParams({ frame: wantIdx >= 0 ? String(want) : null });
			setOpenError(null);
		} catch (e) {
			setOpenError(
				e instanceof LscapParseError ? e.message : "not a .lscap capture",
			);
		}
	};

	// The address bar itself carries the ACTIVE capture's reference, so the URL
	// of a resolved or published capture IS its permalink; a local capture
	// clears the ref rather than leaving a stale link in the bar. The owner is
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
			load(await f.arrayBuffer(), f.name, { origin: "file" });
		} finally {
			setBusy(false);
		}
	};

	/**
	 * Switch the whole view to another open capture. The address bar follows:
	 * the filter and capture reference through their own effects below, the
	 * frame only where the URL already named one — a switch is not a reason to
	 * start pinning a frame that was never linked.
	 */
	const activateSlot = (id: string) => {
		const target = slotState.slots.find((s) => s.id === id);
		if (!target || id === slotState.activeId) return;
		dispatch({ type: "activate", id });
		// A failed open belonged to the attempt, not to this capture.
		setOpenError(null);
		// The table is one scrolling element shared by every slot, so a switch
		// starts it at the top and then reveals that capture's selected frame —
		// rather than keeping an offset measured against other frames.
		const el = tableRef.current;
		if (el) el.scrollTop = 0;
		setScrollport((prev) =>
			prev.scrollTopPx === 0 ? prev : { ...prev, scrollTopPx: 0 },
		);
		scrollToSelected.current = true;
		if (!splitHash(window.location.hash).params.has("frame")) return;
		const fr = target.view.capture?.frames[target.view.selected];
		writeHashParams({ frame: fr ? String(Number(fr.sequence)) : null });
	};

	const closeSlot = (id: string) => {
		dispatch({ type: "close", id });
		setOpenError(null);
	};

	// ── capture session ───────────────────────────────────────────────────
	// Recording keeps the full record of every frame the device streams. The
	// session is one of the open captures while it runs (UI-012), so the
	// frames land in a slot of their own and whatever else is open stays open
	// — starting or stopping a recording no longer throws away the capture
	// being read. On stop the same slot becomes the finished .lscap.
	const session = useCaptureSession();
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!session.recording) return;
		const id = setInterval(() => setTick((v) => v + 1), 500);
		return () => clearInterval(id);
	}, [session.recording]);

	/** Frames already converted for the live slot — see sessionCapture. */
	const liveCache = useRef<LscapFrame[]>([]);
	const livePatchedVersion = useRef(-1);
	const liveSlot = slotState.slots.find((s) => s.key === LIVE_SLOT_KEY) ?? null;
	const liveSlotId = liveSlot?.id ?? null;

	const onStartCapture = () => {
		clearCapture();
		startCapture();
		setLive(false);
		setOpenError(null);
		liveCache.current = [];
		livePatchedVersion.current = -1;
		dispatch({
			type: "open",
			key: LIVE_SLOT_KEY,
			origin: "live",
			name: "recording…",
			view: {
				...BLANK_VIEW,
				capture: sessionCapture(getCaptureSession(), liveCache.current),
			},
		});
	};

	// Every frame the device streams lands in the live slot as it arrives, so
	// the recording is readable — filtered, dissected, plotted — while it runs.
	// Only the new records are converted (sessionCapture appends into the
	// cache), which is what keeps a long recording linear rather than square.
	useEffect(() => {
		if (!liveSlotId) return;
		if (livePatchedVersion.current === session.framesVersion) return;
		livePatchedVersion.current = session.framesVersion;
		dispatch({
			type: "patch",
			id: liveSlotId,
			view: {
				capture: sessionCapture(session, liveCache.current),
				containsSynthetic: session.containsSynthetic,
			},
		});
		// Follow the newest frame while the recording is the capture on screen,
		// unless the operator has scrolled back to study something — the same
		// follow rule the synthetic stream uses.
		const el = tableRef.current;
		if (
			el &&
			slotRef.current?.id === liveSlotId &&
			el.scrollHeight - el.scrollTop - el.clientHeight < 120
		)
			requestAnimationFrame(() => {
				el.scrollTop = el.scrollHeight;
			});
	}, [session, liveSlotId]);

	const onStopCapture = () => {
		const done = stopCapture();
		setLive(false);
		if (done.frames.length === 0) {
			setOpenError(
				"capture stopped with no frames — nothing was heard on this channel",
			);
			return;
		}
		// The slot the frames were recorded into becomes the finished capture,
		// under the name the .lscap will carry.
		const fileName = captureFileName(done);
		if (liveSlotId) {
			dispatch({ type: "rename", id: liveSlotId, name: fileName });
			dispatch({
				type: "patch",
				id: liveSlotId,
				view: { capture: sessionCapture(done, liveCache.current) },
			});
			dispatch({ type: "activate", id: liveSlotId });
			return;
		}
		// No live slot (a recording started before this tab mounted): open the
		// finished capture the ordinary way.
		const bytes = captureToLscap(done);
		load(bytes.slice().buffer, fileName, {
			origin: "live",
			key: LIVE_SLOT_KEY,
		});
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
	// The publish belongs to the recorded session, so its result lives in that
	// session's slot: switching to another capture takes the publish panel with
	// it, and a new recording opens a slot that has never been published.
	const published = view.published;
	const publishError = view.publishError;

	const onPublish = async () => {
		const target = liveSlotId ?? slotState.activeId;
		const write = (next: Partial<CaptureView>) =>
			dispatch({ type: "patch", id: target, view: next });
		setPublishing(true);
		write({ publishError: null });
		try {
			const bytes = captureToLscap(session);
			const res = await publishCapture(bytes, captureFileName(session));
			// The capture recorded here now has an address on Shelby — carry it as
			// that slot's permalink.
			write({
				published: { publish: res, verified: "pending" },
				ref: res.owner
					? res.commitment
						? { kind: "commit", owner: res.owner, commitment: res.commitment }
						: { kind: "blob", owner: res.owner, name: res.blobName }
					: null,
			});
			// Prove the loop instead of asserting it: read the blob back from the
			// Shelby RPC and compare every byte with what was just sent.
			try {
				const back = new Uint8Array(
					await fetchBlobBytes(res.owner, res.blobName),
				);
				const same =
					back.length === bytes.length && back.every((b, i) => b === bytes[i]);
				write({
					published: {
						publish: res,
						verified: same
							? "ok"
							: `Shelby served ${back.length} bytes, we sent ${bytes.length}`,
					},
				});
			} catch (e) {
				write({
					published: {
						publish: res,
						verified: `read-back failed: ${e instanceof Error ? e.message : e}`,
					},
				});
			}
		} catch (e) {
			write({ publishError: e instanceof Error ? e.message : String(e) });
		} finally {
			setPublishing(false);
		}
	};
	// The capture chain-of-custody block describes the recorded session, so it
	// is shown with that session's slot and not over some other capture.
	const haveCapture =
		!session.recording &&
		session.frames.length > 0 &&
		liveSlotId !== null &&
		slotState.activeId === liveSlotId;
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
		setOpenError(null);
		setLive(false);
		try {
			load(await fetchBlobBytes(owner, name), name, {
				ref: { kind: "blob", owner, name },
				origin: "shelby",
				key: `blob:${owner.toLowerCase()}/${name}`,
			});
		} catch (e) {
			setOpenError(e instanceof Error ? e.message : "fetch failed");
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
	 * trace stays up afterward so the story can be read back. It narrates an
	 * operation rather than describing a capture, so it lives here and not in a
	 * slot — and the effect below drops it the moment the view moves on.
	 */
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
				ref: { kind: "commit", owner: p.owner, commitment: p.commitment },
				origin: "shelby",
				key: `commit:${p.owner.toLowerCase()}/${p.commitment.toLowerCase()}`,
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
		setOpenError(null);
		try {
			const res = await fetch("/sample-mesh-traffic.lscap");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			load(await res.arrayBuffer(), "sample-mesh-traffic.lscap", {
				origin: "sample",
				key: "sample",
			});
		} catch (e) {
			setOpenError(e instanceof Error ? e.message : "sample unavailable");
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
		// A recording survives this tab being closed and reopened — the session
		// store outlives the component — so it gets its slot back before
		// anything else opens, rather than the frames streaming into nothing.
		const running = getCaptureSession();
		if (running.recording || running.frames.length > 0) {
			liveCache.current = [];
			livePatchedVersion.current = running.framesVersion;
			dispatch({
				type: "open",
				key: LIVE_SLOT_KEY,
				origin: "live",
				name: running.recording ? "recording…" : captureFileName(running),
				view: {
					...BLANK_VIEW,
					capture: sessionCapture(running, liveCache.current),
					containsSynthetic: running.containsSynthetic,
				},
			});
		}
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
				// Into whichever capture is on screen, never into the others.
				const into = slotRef.current;
				const c = into?.view.capture;
				if (!into || !c) return;
				const last = c.frames[c.frames.length - 1];
				const seq = into.view.liveSeq;
				const f = demoNextFrame(
					seq,
					Number(last ? last.timestampUs : 0n) +
						2_400_000 +
						(seq % 5) * 640_000,
				);
				dispatch({
					type: "patch",
					id: into.id,
					view: {
						capture: { ...c, frames: [...c.frames.slice(-(LIVE_CAP - 1)), f] },
						liveSeq: seq + 1,
					},
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

	const frames = capture?.frames ?? NO_FRAMES;
	// A pointer rides behind whatever protocol header enclosed it, so every
	// payload is scanned once rather than only at a fixed offset.
	const pointers = useMemo(
		() => frames.map((f) => findShelbyPointer(f.bytes)),
		[frames],
	);
	// Every frame's Reticulum destination hash, read once from its clear RNS
	// header. The `dest ==` filter would otherwise re-read every header on
	// every keystroke; frames that carry no readable hash are null.
	const destHashes = useMemo(
		() =>
			frames.map((fr) =>
				profileProtocolHint(profileOf(fr)) === "reticulum"
					? reticulumDestinationHashHex(fr.bytes)
					: null,
			),
		[frames],
	);

	// Every frame's addressing (UI-008), read once from its own protocol's
	// header: the follow-conversation filter would otherwise re-read every
	// header on every keystroke. Frames whose protocol proves no address carry
	// the reason why, which is what the panel and the footer say out loud.
	const addressings = useMemo(
		() => frames.map((fr) => frameAddressing(fr.bytes, profileOf(fr))),
		[frames],
	);

	// ── display filter ─────────────────────────────────────────────────
	// The text is parsed on every keystroke; only a parse that succeeds is
	// APPLIED. While the text is broken the table keeps the last valid
	// result and the error is pointed out inline — it never silently shows
	// wrong rows.
	// Filter text and applied filter belong to the capture they describe, so a
	// second capture opens with its own (empty) filter rather than inheriting a
	// predicate written for other frames.
	const filterText = view.filterText;
	const applied = view.applied;
	const setFilterText = (next: string | ((current: string) => string)) =>
		patch({
			filterText: typeof next === "function" ? next(view.filterText) : next,
		});
	const filterParse = useMemo(() => parseFrameFilter(filterText), [filterText]);
	useEffect(() => {
		if (!filterParse.ok) return; // keep the last valid filter on screen
		const next: AppliedFilter | null = filterParse.empty
			? null
			: { text: filterText, predicate: filterParse.predicate };
		// Only when it actually moved: patching on every render would loop.
		if ((next?.text ?? null) === (applied?.text ?? null)) return;
		patch({ applied: next });
	}, [filterParse, filterText, applied, patch]);
	useEffect(() => {
		writeHashParams({ filter: filterText || null });
	}, [filterText]);
	const filterError = filterParse.ok ? null : filterParse.error;

	/** Indices into `frames` that pass the applied text filter. */
	const filterShown = useMemo(() => {
		if (!applied) return frames.map((_, i) => i);
		const idx: number[] = [];
		for (let i = 0; i < frames.length; i++) {
			if (
				applied.predicate(
					frames[i],
					pointers[i] !== null,
					destHashes[i],
					addressings[i],
				)
			)
				idx.push(i);
		}
		return idx;
	}, [frames, pointers, destHashes, addressings, applied]);

	// ── time brush ─────────────────────────────────────────────────────
	// A range brushed on the IO graph is one more predicate over the text
	// filter's output: the graph plots the FILTERED set, the table shows the
	// filtered-and-brushed set, and clearing the brush restores the filter's
	// rows exactly. Times are seconds on the capture clock (first frame = 0),
	// the same clock the table's TIME column reads.
	const brush = view.brush;
	const setBrush = (next: BrushRange | null) => patch({ brush: next });
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
	// The footer's provenance line, counted once per view rather than three
	// times per render — at six figures of frames that difference is felt.
	const shownFlags = useMemo(() => {
		let synthetic = 0;
		let truncated = false;
		for (const i of shown) {
			if (frames[i].synthetic) synthetic++;
			if (frames[i].truncated) truncated = true;
		}
		return { synthetic, truncated };
	}, [shown, frames]);

	// ── Reticulum announces (UI-013) ───────────────────────────────────
	// Read over the WHOLE capture, never the filtered set: the panel is how
	// an operator finds a destination worth filtering to, so filtering to one
	// row must not erase the rows beside it.
	const announceOverview = useMemo(
		() =>
			summarizeAnnounces(
				frames.map((fr) => ({
					timestampUs: fr.timestampUs,
					bytes: fr.bytes,
					truncated: fr.truncated,
					profileId: profileOf(fr),
					airtimeUs: hasField(fr, RF_FIELD.airtime) ? fr.airtimeUs : null,
				})),
				t0,
			),
		[frames, t0],
	);
	/** The destination a row-click filter is currently isolating, if any. */
	const activeDestination = useMemo(() => {
		const text = applied?.text.trim();
		if (!text) return null;
		const match = announceOverview.destinations.find(
			(d) => destinationFilterExpression(d.destinationHashHex) === text,
		);
		return match?.destinationHashHex ?? null;
	}, [announceOverview, applied]);
	// Clicking a row writes an ordinary display filter — the same box, the
	// same grammar, the same permalink. Clicking the isolated row clears it.
	const toggleDestinationFilter = (destinationHashHex: string) => {
		const expression = destinationFilterExpression(destinationHashHex);
		setFilterText((current) =>
			current.trim() === expression ? "" : expression,
		);
	};

	// ── follow conversation (UI-008) ───────────────────────────────────
	// The analyzer's follow-stream gesture, composed as an ORDINARY display
	// filter (lib/conversation) exactly the way the ANNOUNCES panel writes
	// `dest ==`: it lands in the same box, stays editable, composes with what
	// is already typed, and rides along in the permalink. The rows it leaves
	// are in capture order, which is the capture clock.
	const selectedAddress = addressings[selected] ?? null;
	const followExpression = selectedAddress
		? conversationExpression(selectedAddress)
		: null;
	/** The conversation the applied filter is following, if it is one. */
	const following = useMemo(
		() => (applied ? parseConversationExpression(applied.text) : null),
		[applied],
	);
	const followingSelected =
		followExpression !== null && applied?.text.trim() === followExpression;
	// What a conversation filter can reach at all — and, explicitly, what it
	// cannot: frames whose protocol proves no addressing are excluded from
	// every conversation, and the footer below says so rather than dropping
	// them silently.
	const addressCoverage = useMemo(
		() => conversationCoverage(addressings),
		[addressings],
	);
	const followConversation = () => {
		if (!followExpression) return;
		setFilterText((current) =>
			current.trim() === followExpression ? "" : followExpression,
		);
	};

	// ── frame annotations (UI-010) ─────────────────────────────────────
	// Notes belong to the capture (so they switch with the slot) and live in a
	// sidecar keyed by sequence number. Nothing here writes a byte into the
	// .lscap: the capture's commitment has to stay valid, which is the whole
	// reason the notes are a separate document.
	const annotations = view.annotations;
	const noteBySequence = useMemo(() => noteMap(annotations), [annotations]);
	const annotatedSeqs = useMemo(
		() => annotatedSequences(annotations),
		[annotations],
	);
	const notesFileRef = useRef<HTMLInputElement>(null);

	/** Write one frame's note; returns an error to show, or null. */
	const writeNote = (sequence: number, text: string): string | null => {
		const result = setNote(annotations, sequence, text);
		if (!result.ok) return result.error;
		patch({ annotations: result.sidecar });
		return null;
	};

	const onDownloadNotes = () => {
		const fileName = sidecarFileName(name);
		saveFile(
			serializeSidecar(
				describeCapture(annotations, {
					name,
					frameCount: frames.length,
					commitment:
						captureRef?.kind === "commit" ? captureRef.commitment : null,
				}),
			),
			fileName,
			"application/json",
		);
		setExportNote({
			text: `${fileName} · ${annotations.notes.length} note(s) — a sidecar, not part of the capture's committed bytes`,
			warn: false,
		});
	};

	const onUploadNotes = async (file: File) => {
		const parsed = parseSidecar(await file.text());
		if (!parsed.ok) {
			setExportNote({ text: `${file.name} · ${parsed.error}`, warn: true });
			return;
		}
		const mismatches = sidecarMismatches(parsed.sidecar, {
			name,
			sequences: new Set(frames.map((fr) => Number(fr.sequence))),
		});
		patch({
			annotations: describeCapture(parsed.sidecar, {
				name,
				frameCount: frames.length,
			}),
		});
		const problems = [...parsed.skipped, ...mismatches];
		setExportNote({
			text: `${file.name} · ${parsed.sidecar.notes.length} note(s) loaded${
				problems.length > 0 ? ` · ${problems.join(" · ")}` : ""
			}`,
			warn: problems.length > 0,
		});
	};

	// ── diff two captures (UI-009) ─────────────────────────────────────
	// The capture on screen is side A; the operator picks any other open slot
	// as side B. The comparison belongs to the pair, not to either capture, so
	// it lives here rather than in a slot's view — and it is computed only
	// while a comparison is actually open, because matching two 100,000-frame
	// captures is not something to do on every keystroke of a filter.
	const [diffAgainstId, setDiffAgainstId] = useState<string | null>(null);
	const diffSlot =
		diffAgainstId && diffAgainstId !== slotState.activeId
			? (slotState.slots.find((s) => s.id === diffAgainstId) ?? null)
			: null;
	const diffFrames = diffSlot?.view.capture?.frames ?? NO_FRAMES;
	const diff = useMemo(
		() => (diffSlot ? diffCaptures(frames, diffFrames) : null),
		[diffSlot, frames, diffFrames],
	);
	const diffViewRows = useMemo(
		() => (diff ? diffRows(frames, diffFrames, diff) : null),
		[diff, frames, diffFrames],
	);
	/** Frames of the capture on screen that the other capture never heard. */
	const diffUnmatchedHere = useMemo(
		() => (diff ? new Set(diff.unmatchedA) : null),
		[diff],
	);
	// A slot that closes, or becomes the active one, is no longer a side B.
	useEffect(() => {
		if (!diffAgainstId) return;
		if (
			diffAgainstId === slotState.activeId ||
			!slotState.slots.some((s) => s.id === diffAgainstId)
		)
			setDiffAgainstId(null);
	}, [diffAgainstId, slotState]);

	// ── the virtualized frame table (UI-012) ───────────────────────────
	// The table renders only the rows the scrollport can show; two spacer
	// rows stand in for everything above and below, so the scrollbar still
	// describes the whole capture. Selection, the roving tab stop and the
	// arrow keys all work on POSITIONS in `shown` — the logical list — so a
	// 200,000-frame capture navigates exactly like a 24-frame one. All the
	// arithmetic is in lib/virtualRows.
	const [scrollport, setScrollport] = useState({
		scrollTopPx: 0,
		viewportPx: 0,
	});
	const [rowHeightPx, setRowHeightPx] = useState(DEFAULT_ROW_HEIGHT_PX);
	const [headerPx, setHeaderPx] = useState(0);
	/** A row waiting to be mounted so it can take the focus. */
	const pendingFocus = useRef<number | null>(null);

	const measureScrollport = useCallback(() => {
		const el = tableRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const next = visibleSpan({
			scrollTopPx: el.scrollTop,
			clientHeightPx: el.clientHeight,
			scrollHeightPx: el.scrollHeight,
			rectTopPx: rect.top,
			rectHeightPx: rect.height,
			windowHeightPx: window.innerHeight,
		});
		setScrollport((prev) =>
			prev.scrollTopPx === next.scrollTopPx &&
			prev.viewportPx === next.viewportPx
				? prev
				: next,
		);
	}, []);

	// The pane scrolls itself on desktop and hands scrolling to the page on a
	// phone, so both are watched; ResizeObserver catches the panel growing.
	// biome-ignore lint/correctness/useExhaustiveDependencies: capture is the trigger — the scrolling element mounts with it
	useEffect(() => {
		const el = tableRef.current;
		if (!el) return;
		measureScrollport();
		const onMove = () => measureScrollport();
		el.addEventListener("scroll", onMove, { passive: true });
		window.addEventListener("scroll", onMove, { passive: true });
		window.addEventListener("resize", onMove);
		const ro =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(onMove) : null;
		ro?.observe(el);
		return () => {
			el.removeEventListener("scroll", onMove);
			window.removeEventListener("scroll", onMove);
			window.removeEventListener("resize", onMove);
			ro?.disconnect();
		};
	}, [measureScrollport, capture]);

	// Row height is measured, not assumed: it moves with the theme's font and
	// with the phone layout, and the spacers have to match it exactly or the
	// scrollbar lies. Runs after every render, cheap, and settles immediately.
	useEffect(() => {
		const el = tableRef.current;
		if (!el) return;
		const head = el.querySelector<HTMLElement>("thead");
		if (head && Math.abs(head.offsetHeight - headerPx) > 0.5)
			setHeaderPx(head.offsetHeight);
		const row = el.querySelector<HTMLElement>("tr[data-row]");
		if (
			row &&
			row.offsetHeight > 0 &&
			Math.abs(row.offsetHeight - rowHeightPx) > 0.5
		)
			setRowHeightPx(row.offsetHeight);
	});

	const rowWindow = useMemo(
		() =>
			computeRowWindow({
				rowCount: shown.length,
				rowHeightPx,
				scrollTopPx: scrollport.scrollTopPx,
				viewportPx: scrollport.viewportPx,
			}),
		[shown.length, rowHeightPx, scrollport],
	);

	/** Bring a logical row onto the screen, and hand it the focus if asked. */
	const revealRow = useCallback(
		(position: number, focus: boolean) => {
			if (focus) pendingFocus.current = position;
			const el = tableRef.current;
			if (!el) return;
			if (el.scrollHeight - el.clientHeight > 1) {
				const next = scrollTopForRow({
					position,
					rowHeightPx,
					headerPx,
					scrollTopPx: el.scrollTop,
					viewportPx: el.clientHeight,
				});
				if (next === el.scrollTop) return;
				el.scrollTop = next;
				// Mount the window for the new offset in this same render rather
				// than waiting for the scroll event, so the focus lands at once.
				setScrollport((prev) => ({ ...prev, scrollTopPx: next }));
				return;
			}
			// Phone layout: the page is what scrolls.
			const top =
				el.getBoundingClientRect().top +
				window.scrollY +
				headerPx +
				position * rowHeightPx;
			if (
				top < window.scrollY ||
				top + rowHeightPx > window.scrollY + window.innerHeight
			)
				window.scrollTo({ top: Math.max(0, top - window.innerHeight / 2) });
		},
		[rowHeightPx, headerPx],
	);

	// A row asked for the focus while it was outside the window; take it as
	// soon as it mounts (the scroll above is what mounts it).
	useEffect(() => {
		const position = pendingFocus.current;
		if (position === null) return;
		const row = tableRef.current?.querySelector<HTMLElement>(
			`tr[data-row="${position}"]`,
		);
		if (!row) return;
		pendingFocus.current = null;
		row.focus({ preventScroll: true });
	});

	// A filter change may hide the selected row; selection snaps to the first
	// visible frame so the detail pane always describes a row that is on
	// screen (or to none when nothing matches), and the roving tabIndex (the
	// selected row is the table's tab stop) keeps keyboard reach on the table
	// through selecting, filtering and clearing.
	const selectedPosition = useMemo(
		() => shown.indexOf(selected),
		[shown, selected],
	);
	const selectedVisible = selectedPosition >= 0;
	useEffect(() => {
		if (selectedVisible || !capture) return;
		const next = shown[0] ?? -1;
		if (next === selected) return; // nothing to snap to, and no patch to loop on
		patch({ selected: next });
		// A URL already naming a frame keeps naming the one on screen; a URL
		// that never carried frame= is not grown by a passive snap.
		if (splitHash(window.location.hash).params.has("frame")) {
			const fr = next >= 0 ? frames[next] : undefined;
			writeHashParams({ frame: fr ? String(Number(fr.sequence)) : null });
		}
	}, [selectedVisible, selected, shown, frames, capture, patch]);

	/** User-driven selection: the row and the URL's `frame=` move together. */
	const selectFrame = (i: number) => {
		patch({ selected: i });
		const fr = frames[i];
		writeHashParams({ frame: fr ? String(Number(fr.sequence)) : null });
	};

	/**
	 * Keyboard navigation over the LOGICAL list: arrows, Page Up/Down, Home
	 * and End move the selection through `shown` whether or not the next row
	 * happens to be mounted, scrolling the window to it and carrying the focus
	 * along (PRODUCT.md: full keyboard reach on the frame table).
	 */
	const onRowKeyDown = (e: ReactKeyboardEvent, position: number) => {
		const nav = tableKeyNav(
			position,
			shown.length,
			e.key,
			rowsPerPage(scrollport.viewportPx, rowHeightPx),
		);
		if (!nav) return;
		e.preventDefault();
		const index = shown[nav.position];
		if (index === undefined) return;
		selectFrame(index);
		if (!nav.activate) revealRow(nav.position, true);
	};

	// A permalink's frame must land on screen, not just be selected: scroll
	// the row into view once, after the load that consumed `frame=`.
	useEffect(() => {
		if (!scrollToSelected.current) return;
		const position = shown.indexOf(selected);
		if (position < 0) return;
		scrollToSelected.current = false;
		requestAnimationFrame(() => revealRow(position, false));
	}, [selected, shown, revealRow]);

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
	const exportNote = view.exportNote;
	const setExportNote = (next: { text: string; warn: boolean } | null) =>
		patch({ exportNote: next });

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
		const exported = assembleExportView(frames, shown);
		const fileName = exportFileName(
			name,
			{ filtered: applied !== null, brushed: brush !== null },
			kind,
		);
		// Notes ride along in CSV and JSON, and only when there are notes —
		// an unannotated capture must not export a column of empty cells.
		const annotationsForExport =
			noteBySequence.size > 0 ? noteBySequence : undefined;
		if (kind === "pcap") {
			const res = buildLoraTapPcap(exported);
			saveFile(
				res.bytes.slice().buffer as ArrayBuffer,
				fileName,
				"application/vnd.tcpdump.pcap",
			);
			// pcap has no annotation channel any more than it has a provenance
			// one, so the notes on the exported frames are counted and named
			// rather than quietly dropped.
			const annotationsOmitted = exported.frames.filter((fr) =>
				noteBySequence.has(Number(fr.sequence)),
			).length;
			// The counts are surfaced whether or not anything was excluded —
			// a pcap silently missing frames would be a lie about the air.
			setExportNote({
				text: `${fileName} · ${pcapExclusionNote({ ...res, annotationsOmitted })}`,
				warn:
					res.excludedSynthetic + res.excludedUnencodable + annotationsOmitted >
					0,
			});
		} else {
			const options = { ...exported, annotations: annotationsForExport };
			const body = kind === "csv" ? buildCsv(options) : buildJson(options);
			saveFile(
				body,
				fileName,
				kind === "csv" ? "text/csv" : "application/json",
			);
			const annotated = annotationsForExport
				? exported.frames.filter((fr) =>
						noteBySequence.has(Number(fr.sequence)),
					).length
				: 0;
			setExportNote({
				text: `${fileName} · ${exported.frames.length} frame(s) written${
					annotationsForExport
						? ` · note column included (${annotated} annotated)`
						: ""
				}`,
				warn: false,
			});
		}
	};

	const f = frames[selected];
	const ptr = f ? pointers[selected] : null;

	// ── user channel keys (UI-011) ─────────────────────────────────────
	// React state only — never persisted, never in the URL, never uploaded;
	// a reload clears them. A change re-dissects the selected frame via the
	// memo below.
	const [channelKeys, setChannelKeys] = useState<readonly ChannelKey[]>([]);

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
						{ truncated: f.truncated, channelKeys },
					)
				: null,
		[f, channelKeys],
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
							onClick={onStartCapture}
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
							{/* The notes sidecar (UI-010): a separate JSON document,
							    downloadable and uploadable beside the capture. The
							    .lscap itself is never rewritten. */}
							<button
								type="button"
								onClick={onDownloadNotes}
								disabled={annotations.notes.length === 0}
								title={
									annotations.notes.length === 0
										? "No notes yet — select a frame and write one"
										: `Save ${sidecarFileName(name)} — ${annotations.notes.length} note(s), stored beside the capture and never inside it`
								}
							>
								⭳ NOTES
							</button>
							<button
								type="button"
								onClick={() => notesFileRef.current?.click()}
								title="Load a notes sidecar written for this capture"
							>
								⭱ NOTES
							</button>
							<input
								ref={notesFileRef}
								type="file"
								accept=".json,application/json"
								hidden
								onChange={(e) => {
									const picked = e.target.files?.[0];
									e.target.value = "";
									if (picked) void onUploadNotes(picked);
								}}
							/>
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

				{/* ── capture slots (UI-012) ────────────────────────────────────
				    One tab per open capture, with the honest word for what each
				    one is: the recording in progress, a capture that came off the
				    radio, synthetic frames, published to Shelby. Clicking one
				    swaps the entire view below; ✕ closes it. */}
				{slotState.slots.length > 0 && (
					<div
						className="scroll-x"
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "4px 12px",
							borderBottom: "1px solid var(--border)",
							flexShrink: 0,
						}}
					>
						<span
							className="dim"
							style={{ fontSize: 10, letterSpacing: 1, flexShrink: 0 }}
						>
							CAPTURES {slotState.slots.length}/{MAX_OPEN_CAPTURES}
						</span>
						{slotState.slots.map((s) => {
							const active = s.id === slotState.activeId;
							const facts = {
								origin: s.origin,
								recording: s.key === LIVE_SLOT_KEY && session.recording,
								synthetic: s.view.containsSynthetic,
								published: s.view.ref !== null,
								frameCount: s.view.capture?.frames.length ?? 0,
							};
							const badges = slotBadges(facts);
							return (
								<span
									key={s.id}
									style={{ display: "flex", gap: 2, flexShrink: 0 }}
								>
									<button
										type="button"
										className={active ? "primary" : ""}
										aria-pressed={active}
										title={slotTitle(s.name, facts)}
										onClick={() => activateSlot(s.id)}
									>
										{s.name}
										<span className="dim">
											{" "}
											· {facts.frameCount.toLocaleString()}f
										</span>
										{badges.length > 0 && ` · ${badges.join(" · ")}`}
									</button>
									<button
										type="button"
										title={`Close ${s.name}${
											facts.recording
												? " — this stops nothing; the recording keeps running"
												: ""
										}`}
										onClick={() => closeSlot(s.id)}
										style={{ minWidth: 0 }}
									>
										✕
									</button>
								</span>
							);
						})}
						{/* Compare the capture on screen against another open one
						    (UI-009): two devices, one RF event. */}
						{slotState.slots.length > 1 && (
							<span
								style={{
									display: "flex",
									gap: 6,
									alignItems: "center",
									flexShrink: 0,
								}}
							>
								<label
									className="dim"
									htmlFor="traffic-diff-against"
									style={{ fontSize: 10, letterSpacing: 1 }}
								>
									DIFF VS
								</label>
								<select
									id="traffic-diff-against"
									value={diffAgainstId ?? ""}
									title="Match this capture against another open one, frame by frame"
									onChange={(e) => setDiffAgainstId(e.target.value || null)}
								>
									<option value="">none</option>
									{slotState.slots
										.filter((s) => s.id !== slotState.activeId)
										.map((s) => (
											<option key={s.id} value={s.id}>
												{s.name}
											</option>
										))}
								</select>
							</span>
						)}
					</div>
				)}

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

						{/* Following a conversation (UI-008): what is being followed, how
						    much of the capture it left, and — explicitly — how many
						    frames carry no decodable addressing at all and can never
						    join any conversation. */}
						{following && (
							<div
								className="panel-foot"
								style={{
									borderTop: "none",
									alignItems: "baseline",
									flexWrap: "wrap",
									gap: 10,
								}}
							>
								<span className="ok">
									FOLLOWING {conversationLabel(following)}
								</span>
								<span>
									{shown.length}/{frames.length} frame(s), in capture-clock
									order
								</span>
								<span
									className={addressCoverage.undecodable > 0 ? "warn" : "dim"}
									title="A conversation filter can only match frames whose own protocol proves an address. Nothing is guessed for the rest."
								>
									{coverageNote(addressCoverage)}
								</span>
								<span className="spacer" />
								<button type="button" onClick={() => setFilterText("")}>
									CLEAR
								</button>
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

						{/* ANNOUNCES: the Reticulum destinations this capture heard,
						    over the same clock. Absent entirely when no Reticulum
						    frame is present — there is nothing honest to say. */}
						<AnnouncesPanel
							overview={announceOverview}
							activeDestination={activeDestination}
							onToggleDestination={toggleDestinationFilter}
						/>

						{/* DIFF: this capture against another open one, matched by
						    payload and an estimated clock offset (UI-009). */}
						{diffSlot && diff && diffViewRows && (
							<DiffPanel
								nameA={name}
								nameB={diffSlot.name}
								framesA={frames}
								framesB={diffFrames}
								diff={diff}
								rows={diffViewRows}
								onSelectA={selectFrame}
								onClose={() => setDiffAgainstId(null)}
							/>
						)}

						<div className="scroll-y" ref={tableRef}>
							<div className="scroll-x">
								{/* Windowed: only the rows in view are in the DOM, and the
								    two spacer rows hold the height of everything else, so
								    the scrollbar still measures the whole capture.
								    aria-rowcount/aria-rowindex tell assistive tech the same
								    thing the scrollbar does — the row on screen is row
								    12,000 of 50,000, not row 3 of 400. */}
								<table
									className="grid"
									aria-rowcount={shown.length + 1}
									aria-label="captured frames"
								>
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
										{rowWindow.topPadPx > 0 && (
											<tr
												aria-hidden
												style={{ ...SPACER_ROW, height: rowWindow.topPadPx }}
											>
												<td
													colSpan={10}
													style={{
														...SPACER_CELL,
														height: rowWindow.topPadPx,
													}}
												/>
											</tr>
										)}
										{shown.slice(rowWindow.start, rowWindow.end).map((i, k) => {
											const fr = frames[i];
											const position = rowWindow.start + k;
											return (
												<tr
													key={i}
													data-row={position}
													aria-rowindex={position + 2}
													aria-selected={i === selected}
													className={i === selected ? "sel" : undefined}
													onClick={() => selectFrame(i)}
													// Roving tabIndex: the selected row is the table's
													// one tab stop — or, when the selection has scrolled
													// out of the window (or the filter hid it), the first
													// row that IS mounted, so the table never drops out
													// of the tab order (PRODUCT.md: full keyboard reach).
													tabIndex={
														position ===
														(selectedVisible &&
														rowInWindow(rowWindow, selectedPosition)
															? selectedPosition
															: rowWindow.start)
															? 0
															: -1
													}
													onKeyDown={(e) => onRowKeyDown(e, position)}
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
														{/* An annotated frame is marked by SHAPE, so it
														    survives the inverted ink of a selected row
														    and reads without colour vision. */}
														{annotatedSeqs.has(Number(fr.sequence)) && (
															<span
																title={`note: ${noteBySequence.get(Number(fr.sequence))}`}
															>
																{" "}
																✎
															</span>
														)}
														{/* While a diff is open (UI-009), a frame the other
														    capture never heard is marked here too — not only
														    in the diff table. */}
														{diffUnmatchedHere?.has(i) && (
															<span
																className="warn"
																title={`not in ${diffSlot?.name ?? "the other capture"} — no matching payload within the aligned clock`}
															>
																{" "}
																△
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
										{rowWindow.bottomPadPx > 0 && (
											<tr
												aria-hidden
												style={{ ...SPACER_ROW, height: rowWindow.bottomPadPx }}
											>
												<td
													colSpan={10}
													style={{
														...SPACER_CELL,
														height: rowWindow.bottomPadPx,
													}}
												/>
											</tr>
										)}
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
							{annotations.notes.length > 0 && (
								<span title={sidecarSummary(annotations)}>
									{" · "}✎ {annotations.notes.length} ANNOTATED
								</span>
							)}
							{shownFlags.synthetic > 0 && (
								<span className="warn">
									{shownFlags.synthetic} SYNTHETIC · NOT OTA
								</span>
							)}
							{shownFlags.truncated && (
								<span className="dim">* = FRAME TRUNCATED AT CAPTURE</span>
							)}
							{diffSlot && diffUnmatchedHere && (
								<span className="dim">
									△ = NOT IN {diffSlot.name} ({diffUnmatchedHere.size} HERE)
								</span>
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
							{/* Follow conversation (UI-008): one action, filtering the
							    table to this frame's src/dst pair — where the protocol
							    proves one. Where it does not, the frame says so instead
							    of offering an action that would quietly do nothing. */}
							<span className="k">CONVERSATION</span>
							<span className="v">
								{followExpression && selectedAddress ? (
									<>
										<button
											type="button"
											onClick={followConversation}
											title={
												followingSelected
													? "Clear the display filter and show every frame again"
													: `Filter the table to this conversation: ${followExpression}`
											}
										>
											{followingSelected
												? "✕ CLEAR FOLLOW"
												: `⇄ FOLLOW ${conversationLabel(selectedAddress)}`}
										</button>
										{selectedAddress.reason && (
											<span className="dim"> · {selectedAddress.reason}</span>
										)}
									</>
								) : (
									<span className="warn">
										not addressable — {selectedAddress?.reason ?? "unknown"}
									</span>
								)}
							</span>
						</div>

						{/* The frame's field note (UI-010). Keyed per frame so the
						    draft always belongs to the frame on screen. */}
						<FrameNotePanel
							key={`note·${Number(f.sequence)}`}
							sequence={Number(f.sequence)}
							saved={noteFor(annotations, Number(f.sequence))?.text ?? ""}
							onSave={(text) => writeNote(Number(f.sequence), text)}
						/>

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

						{/* Channel keys apply to Meshtastic decryption only, so the
						    manager appears with a Meshtastic dissection — hoisted state,
						    NOT keyed per frame, so keys and half-typed input survive
						    frame switches. */}
						{dissection && dissection.primary.protocol === "Meshtastic" && (
							<ChannelKeysPanel
								keys={channelKeys}
								onAdd={(k) => setChannelKeys((prev) => [...prev, k])}
								onRemove={(i) =>
									setChannelKeys((prev) => prev.filter((_, at) => at !== i))
								}
							/>
						)}
						{dissection && (
							// Keyed per frame so tree expansion, node selection and hex
							// hover always describe the frame on screen.
							<DissectPane
								key={`${selected}·${Number(f.sequence)}`}
								bytes={f.bytes}
								dissection={dissection}
								userKeyCount={channelKeys.length}
							/>
						)}
					</div>
				</div>
			)}
		</main>
	);
}
