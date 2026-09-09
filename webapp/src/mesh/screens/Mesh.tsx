import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { activityGrid } from "../activityGrid";
import { loadActivity, loadAllTraceroutes, loadNeighbors } from "../db";
import { demoNeighbors } from "../demo";
import { ago, dateTime } from "../fmt";
import { t } from "../i18n";
import { buildEdges, type Edge, edgeKey as key, summarize } from "../mesh";
import { getSnapshot, subscribe } from "../store";
import { accent, fg, useThemeTick } from "../theme";
import "./radio-analysis.css";

/** Fruchterman-Reingold layout, fixed iterations (no animation).
 *  ponytail: O(n²) per iteration; with ~100 nodes that's fine and avoids a quadtree.
 *
 *  Both forces must be on the same scale: k²/d repulsion between every pair
 *  and d²/k attraction per link. With a weaker attraction (proportional to d,
 *  say) the repulsion of 90 nodes always wins and the graph unfolds against
 *  the edges of the canvas. */
function layout(
	ids: number[],
	edges: Edge[],
	w: number,
	h: number,
): Map<number, { x: number; y: number }> {
	const pos = new Map<number, { x: number; y: number }>();
	const idx = new Map<number, number>();
	ids.forEach((id, i) => {
		idx.set(id, i);
		// spiral start: spreads better than a circle when there are many nodes
		const ang = i * 2.399963; // golden angle
		const rad = (Math.min(w, h) / 2.5) * Math.sqrt(i / Math.max(1, ids.length));
		pos.set(id, {
			x: w / 2 + Math.cos(ang) * rad,
			y: h / 2 + Math.sin(ang) * rad,
		});
	});
	const links = edges
		.map((e) => [idx.get(e.a), idx.get(e.b)] as [number?, number?])
		.filter(
			(l): l is [number, number] => l[0] !== undefined && l[1] !== undefined,
		);
	const arr = ids.map((id) => pos.get(id)!);
	const n = arr.length;
	if (n === 0) return pos;
	const k = Math.sqrt((w * h) / Math.max(1, n)); // ideal distance between nodes
	const ITERS = 400;
	let temp = w / 8; // max displacement per iteration, cools down to 0

	for (let iter = 0; iter < ITERS; iter++) {
		const dx = new Float64Array(n);
		const dy = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let vx = arr[i].x - arr[j].x;
				let vy = arr[i].y - arr[j].y;
				let d = Math.hypot(vx, vy);
				if (d < 0.01) {
					// overlapping: separate them along a stable direction, not a random
					// one, so the drawing stays the same on every render
					vx = ((i * 37 + j) % 17) - 8;
					vy = ((i * 53 + j) % 13) - 6;
					d = Math.hypot(vx, vy) || 1;
				}
				const rep = (k * k) / d; // magnitude
				dx[i] += (vx / d) * rep;
				dy[i] += (vy / d) * rep;
				dx[j] -= (vx / d) * rep;
				dy[j] -= (vy / d) * rep;
			}
		}
		for (const [i, j] of links) {
			const vx = arr[i].x - arr[j].x;
			const vy = arr[i].y - arr[j].y;
			const d = Math.hypot(vx, vy) || 0.01;
			const att = (d * d) / k; // magnitude
			dx[i] -= (vx / d) * att;
			dy[i] -= (vy / d) * att;
			dx[j] += (vx / d) * att;
			dy[j] += (vy / d) * att;
		}
		for (let i = 0; i < n; i++) {
			// gravity towards the center: keeps subgraphs with no links together
			dx[i] += (w / 2 - arr[i].x) * 0.03;
			dy[i] += (h / 2 - arr[i].y) * 0.03;
			const d = Math.hypot(dx[i], dy[i]) || 1;
			const step = Math.min(d, temp);
			arr[i].x += (dx[i] / d) * step;
			arr[i].y += (dy[i] / d) * step;
		}
		temp = (w / 8) * (1 - (iter + 1) / ITERS);
	}

	// Fit the result into the canvas by scaling instead of clamping against the
	// edge: clamping piles nodes up on the sides and lies about the shape.
	let minX = Infinity,
		maxX = -Infinity,
		minY = Infinity,
		maxY = -Infinity;
	for (const p of arr) {
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}
	// Labels sit to the right of each node. Extra right pad keeps short names
	// inside the pane once the cluster is scaled to fit; equal padding clipped
	// the last column of names against overflow:hidden.
	const padL = Math.min(40, Math.max(22, Math.round(w * 0.06)));
	const padR = Math.min(88, Math.max(52, Math.round(w * 0.14)));
	const padY = Math.min(52, Math.max(28, Math.round(h * 0.1)));
	const sc = Math.min(
		(w - padL - padR) / Math.max(1, maxX - minX),
		(h - padY * 2) / Math.max(1, maxY - minY),
	);
	const usedW = (maxX - minX) * sc;
	const usedH = (maxY - minY) * sc;
	const offX = padL + (w - padL - padR - usedW) / 2 - minX * sc;
	const offY = padY + (h - padY * 2 - usedH) / 2 - minY * sc;
	for (const p of arr) {
		p.x = p.x * sc + offX;
		p.y = p.y * sc + offY;
	}
	return pos;
}

const W = 1200;
const H = 800;

export default function Mesh() {
	const s = useSyncExternalStore(subscribe, getSnapshot);
	// the SVG uses fg()/accent(), which no CSS var repaints
	useThemeTick();
	const [neighbors, setNeighbors] = useState<
		{ node: number; neighbor: number; snr: number }[]
	>([]);
	const [traces, setTraces] = useState<
		{ node: number; route: number[]; snr: number[] }[]
	>([]);
	const [sel, setSel] = useState<number | undefined>();
	const [reload, setReload] = useState(0);
	const [view, setView] = useState<"graph" | "activity">("graph");
	const graphViewport = useRef<HTMLDivElement>(null);
	const nodeDetail = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (sel !== undefined && window.matchMedia("(max-width: 860px)").matches) {
			nodeDetail.current?.scrollIntoView({ block: "nearest" });
		}
	}, [sel]);
	// `hourBucket`, spelled the way loadActivity and the sightings store spell
	// it. This was declared as `hhmm` and the grid below read `r.hhmm`, which
	// is not a field any row has: every count landed under the single key
	// `undefined`, and the render, which looks a row up by hour, found nothing
	// there and drew 0. The heatmap said no node had been heard in any hour
	// while the totals beside it -- summed from the map's values, not its keys
	// -- were right, so it looked like a mesh nobody was talking on.
	const [act, setAct] = useState<
		{ node: number; hourBucket: number; n: number }[]
	>([]);
	const [actHours, setActHours] = useState(() =>
		window.matchMedia("(max-width: 860px)").matches ? 24 : 48,
	);
	const [graphSize, setGraphSize] = useState({ w: W, h: H });

	useEffect(() => {
		if (view !== "activity") return;
		loadActivity(Date.now() - actHours * 3_600_000)
			.then(setAct)
			.catch(() => {});
	}, [view, actHours, reload]);

	useEffect(() => {
		loadNeighbors()
			.then(setNeighbors)
			.catch(() => {});
		loadAllTraceroutes()
			.then(setTraces)
			.catch(() => {});
	}, [reload]);

	const edges = useMemo(
		// The demo mesh has no NeighborInfo rows in the database, so its links
		// come straight from the seeded topology; real rows always ride along.
		() => buildEdges([...neighbors, ...demoNeighbors()], traces, s.myNodeNum),
		[neighbors, traces, s.myNodeNum],
	);

	const ids = useMemo(() => {
		const set = new Set<number>();
		// NodeInfo arrives before NeighborInfo. Drawing only the linked pair
		// left a blank graph under a summary that already counted the mesh.
		for (const [id] of s.nodes) set.add(id);
		if (s.myNodeNum !== undefined) set.add(s.myNodeNum);
		for (const e of edges) {
			set.add(e.a);
			set.add(e.b);
		}
		return [...set].sort((a, b) => a - b);
	}, [edges, s.nodes.size, s.myNodeNum]);

	const pos = useMemo(
		() => layout(ids, edges, graphSize.w, graphSize.h),
		[ids, edges, graphSize],
	);

	useEffect(() => {
		if (view !== "graph" || ids.length === 0) return;
		const viewport = graphViewport.current;
		if (!viewport || typeof ResizeObserver === "undefined") return;
		const measure = () => {
			const w = Math.max(240, Math.round(viewport.clientWidth));
			const h = Math.max(220, Math.round(viewport.clientHeight));
			setGraphSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [view, ids.length]);

	const short = (num: number) =>
		s.nodes.get(num)?.shortName ?? num.toString(16).slice(-4);
	const long = (num: number) =>
		s.nodes.get(num)?.longName ?? `!${num.toString(16)}`;

	// Width and opacity by SNR: a strong link is a bolder line. The floor is
	// 0.5 — below that a hairline over the pale theme's background is simply
	// not there, so the weak links read as missing rather than weak. Width is
	// what still separates the four bands.
	const edgeStyle = (snr?: number) => {
		if (snr === undefined) return { w: 1, o: 0.5 };
		if (snr >= 5) return { w: 2, o: 0.85 };
		if (snr >= 0) return { w: 1.5, o: 0.75 };
		return { w: 1, o: 0.7 };
	};

	const selEdges =
		sel !== undefined ? edges.filter((e) => e.a === sel || e.b === sel) : [];
	const neighborSel = new Set(selEdges.map((e) => (e.a === sel ? e.b : e.a)));

	// s.version changes with every packet: recomputing the snapshot is cheap
	const sum = useMemo(() => summarize(s.nodes.values()), [s]);

	// activity grid: rows = nodes, columns = hours. The binning lives in
	// activityGrid.ts so it can be tested against a total; it used to be here,
	// and a wrong bin key drew an empty heatmap for months.
	const grid = useMemo(
		() => activityGrid(act, actHours, Math.floor(Date.now() / 3_600_000)),
		[act, actHours],
	);

	const tile = (label: string, value: string | number, cls = "") => (
		<div key={label} className="panel stat-tile" style={{ minWidth: 96 }}>
			<div className="label">{label}</div>
			<div className={`value ${cls}`} style={{ fontSize: 20 }}>
				{value}
			</div>
		</div>
	);

	// hops sorted, with the unknown bucket last
	const hops = [...sum.hops.entries()].sort((a, b) =>
		a[0] === "?" ? 1 : b[0] === "?" ? -1 : Number(a[0]) - Number(b[0]),
	);

	return (
		<main className="mesh-screen" style={{ flexDirection: "column" }}>
			<div className="panel mesh-summary" style={{ flexShrink: 0 }}>
				<div className="panel-title">{t("SUMMARY // MESH")}</div>
				<div
					className="mesh-summary-values"
					style={{
						display: "flex",
						gap: 10,
						padding: 12,
						flexWrap: "wrap",
						alignItems: "stretch",
					}}
				>
					{tile(t("NODES"), sum.total)}
					{tile(t("ACTIVE 1 H"), sum.active1h)}
					{tile(t("ACTIVE 24 H"), sum.active24h)}
					{tile(t("WITH POSITION"), sum.withPosition)}
					{tile(t("REPEATERS"), sum.repeaters)}
					{tile(t("WITH PKI"), sum.withPki)}
					{tile(
						t("LOW BATTERY"),
						sum.lowBattery,
						sum.lowBattery > 0 ? "err" : "",
					)}
					{tile(t("NEVER HEARD"), sum.neverHeard, "dim")}

					<div
						className="panel mesh-hop-distribution"
						style={{ padding: "8px 12px", minWidth: 190 }}
					>
						<div
							className="dim"
							style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
						>
							{t("HOPS")}
						</div>
						{hops.map(([k, n]) => (
							<div
								key={String(k)}
								className="mesh-hop-row"
								style={{ display: "flex", gap: 8, fontSize: 12 }}
							>
								<span style={{ width: 70 }} className={k === "?" ? "dim" : ""}>
									{k === "?"
										? t("UNKNOWN")
										: k === 0
											? t("DIRECT")
											: `${k} ${k === 1 ? t("HOP") : t("HOPS")}`}
								</span>
								<span style={{ flex: 1 }}>
									{"█".repeat(Math.min(12, Math.ceil((n / sum.total) * 24)))}
								</span>
								<span className="dim">{n}</span>
							</div>
						))}
					</div>

					{sum.silent.length > 0 && (
						<div
							className="panel mesh-silent-nodes"
							style={{ padding: "8px 12px", minWidth: 200 }}
						>
							<div
								className="warn"
								style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
							>
								{t("SILENT FAVORITES")}
							</div>
							<div style={{ maxHeight: 92, overflowY: "auto" }}>
								{sum.silent.map((n) => (
									<div
										key={n.num}
										style={{ display: "flex", gap: 10, fontSize: 12 }}
									>
										<span style={{ flex: 1 }}>{n.shortName}</span>
										<span className="dim" title={dateTime(n.lastHeard * 1000)}>
											{t("{0} ago", ago(n.lastHeard))}
										</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>

			<div className="panel mesh-topology" style={{ flex: 1, minWidth: 0 }}>
				<div className="panel-title mesh-topology-toolbar">
					<span className="mesh-toolbar-cluster">
						<button
							className={view === "graph" ? "tab active" : "tab"}
							aria-pressed={view === "graph"}
							onClick={() => setView("graph")}
						>
							{t("GRAPH")}
						</button>
						<button
							className={view === "activity" ? "tab active" : "tab"}
							aria-pressed={view === "activity"}
							onClick={() => setView("activity")}
						>
							{t("ACTIVITY")}
						</button>
						<span className="mesh-count">
							{view === "graph"
								? `${t("{0} NODES", ids.length)} · ${t("{0} LINKS", edges.length)}`
								: t("{0} NODES HEARD", grid.rows.length)}
						</span>
					</span>
					<span className="mesh-toolbar-cluster">
						{view === "activity" &&
							[24, 48, 168].map((h) => (
								<button
									key={h}
									className={actHours === h ? "tab active" : "tab"}
									aria-pressed={actHours === h}
									onClick={() => setActHours(h)}
								>
									{h === 168 ? t("7 D") : `${h} H`}
								</button>
							))}
						<button
							title={t("Reload neighbors and traceroutes from the database")}
							onClick={() => setReload((v) => v + 1)}
						>
							⟳ {t("RELOAD")}
						</button>
						{view === "graph" && (
							<span className="dim" style={{ fontSize: 11 }}>
								{t(
									"{0} FROM NEIGHBORS",
									edges.filter((e) => e.src === "neighbors").length,
								)}
							</span>
						)}
					</span>
				</div>

				{view === "activity" ? (
					grid.rows.length === 0 ? (
						<div className="mesh-empty" role="status">
							<h2>{t("No sightings in this range.")}</h2>
							<p>
								{t(
									"Connect a radio to record activity by node and hour. Each cell is one hour; a darker cell is a node that was heard more often.",
								)}
							</p>
						</div>
					) : (
						<div
							className="mesh-activity"
							tabIndex={0}
							role="region"
							aria-label={t("Activity by node and hour")}
						>
							<table className="mesh-activity-table">
								<tbody>
									{grid.rows.map((f) => (
										<tr key={f.node}>
											<td className="mesh-activity-node">
												{short(f.node)}
												{f.node === s.myNodeNum && ` (${t("ME")})`}
											</td>
											{grid.hours.map((h) => {
												const n = f.cells.get(h) ?? 0;
												// intensity relative to the max, with a visible floor
												const op = n === 0 ? 0 : 0.25 + 0.75 * (n / grid.max);
												const d = new Date(h * 3_600_000);
												return (
													<td
														key={h}
														className="mesh-activity-cell"
														title={`${short(f.node)} · ${dateTime(d.getTime())} · ${t("{0} packets", n)}`}
														style={{
															background: n === 0 ? "transparent" : fg(),
															opacity: n === 0 ? 0.25 : op,
														}}
													/>
												);
											})}
											<td className="dim mesh-activity-total">
												{f.total}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				) : ids.length === 0 ? (
					<div className="mesh-empty" role="status">
						<h2>{t("No links recorded.")}</h2>
						<p>
							{t(
								"Connect a T-Deck to hear neighbors. Neighbor Info draws the solid links; a traceroute from Nodes fills the dashed hops.",
							)}
						</p>
					</div>
				) : (
					<div className="scroll-y mesh-graph-layout">
						<div
							ref={graphViewport}
							className="mesh-graph-viewport"
							role="region"
							aria-label={t("Radio mesh topology")}
							tabIndex={0}
						>
							<svg
								viewBox={`0 0 ${graphSize.w} ${graphSize.h}`}
								role="group"
								aria-label={t("Radio nodes and links")}
							>
								{edges.map((e) => {
									const pa = pos.get(e.a);
									const pb = pos.get(e.b);
									if (!pa || !pb) return null;
									const st = edgeStyle(e.snr);
									const dim =
										sel !== undefined && e.a !== sel && e.b !== sel ? 0.15 : 1;
									return (
										<line
											key={key(e.a, e.b)}
											x1={pa.x}
											y1={pa.y}
											x2={pb.x}
											y2={pb.y}
											stroke={fg()}
											strokeWidth={st.w}
											strokeOpacity={st.o * dim}
											strokeDasharray={
												e.src === "traceroute" ? "4 4" : undefined
											}
										/>
									);
								})}
								{ids.map((id) => {
									const p = pos.get(id);
									if (!p) return null;
									const isMe = id === s.myNodeNum;
									const dim = sel !== undefined && id !== sel ? 0.35 : 1;
									// with many nodes the labels overlap: only our own node,
									// the selected one and its neighbors get a name
									const label =
										ids.length <= 45 ||
										isMe ||
										id === sel ||
										neighborSel.has(id);
									return (
										<g
											key={id}
											role="button"
											tabIndex={0}
											aria-label={long(id)}
											aria-pressed={sel === id}
											opacity={dim}
											style={{ cursor: "pointer" }}
											onClick={() => setSel(sel === id ? undefined : id)}
											onKeyDown={(event) => {
												if (event.key === "Enter" || event.key === " ") {
													event.preventDefault();
													setSel(sel === id ? undefined : id);
												}
											}}
										>
											<circle
												cx={p.x}
												cy={p.y}
												r={26}
												fill="transparent"
												aria-hidden="true"
											/>
											<circle
												cx={p.x}
												cy={p.y}
												r={isMe ? 9 : 6}
												fill={isMe ? accent() : fg()}
												stroke={id === sel ? accent() : "none"}
												strokeWidth={2}
											/>
											{label && (
												<text
													x={p.x + 11}
													y={p.y + 4}
													fill={fg()}
													fontSize={12}
													fontFamily="JetBrains Mono, monospace"
												>
													{short(id)}
												</text>
											)}
										</g>
									);
								})}
							</svg>
						</div>

						{sel !== undefined && (
							<div
								ref={nodeDetail}
								className="panel hot mesh-node-detail"
								style={{ fontSize: 12 }}
							>
								<div className="panel-title">
									<span>{short(sel)}</span>
									<button
										onClick={() => setSel(undefined)}
										aria-label={t("Close node details")}
										style={{
											flex: "none",
											width: 44,
											height: 44,
											minWidth: 44,
											padding: 0,
											fontSize: 22,
										}}
									>
										<span aria-hidden="true">×</span>
									</button>
								</div>
								<div style={{ padding: "10px 12px" }}>
									<div style={{ fontWeight: 700 }}>{long(sel)}</div>
									<div
										className="dim"
										style={{ fontSize: 11, marginBottom: 8 }}
									>
										!{sel.toString(16)}
										{sel === s.myNodeNum && ` · (${t("ME")})`}
									</div>
									<div
										className="dim"
										style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
									>
										{t("LINKS")} ({selEdges.length})
									</div>
									<div style={{ maxHeight: 320, overflowY: "auto" }}>
										{selEdges
											.slice()
											.sort((x, y) => (y.snr ?? -99) - (x.snr ?? -99))
											.map((e) => {
												const other = e.a === sel ? e.b : e.a;
												return (
													<button
														key={key(e.a, e.b)}
														className="mesh-neighbor"
														onClick={() => setSel(other)}
														aria-label={t("Inspect {0}", long(other))}
													>
														<span>{short(other)}</span>
														<span className="dim">
															{e.snr !== undefined
																? `${e.snr.toFixed(1)} dB`
																: "—"}
														</span>
													</button>
												);
											})}
									</div>
								</div>
							</div>
						)}
					</div>
				)}

				<div className="panel-foot mesh-legend">
					{view === "graph" ? (
						<>
							{ids.length > 0 && edges.length === 0 && (
								<span>{t("NO LINKS YET")}</span>
							)}
							<span>{t("SOLID = NEIGHBOR")}</span>
							<span>{t("DASHED = TRACEROUTE")}</span>
							{ids.length > 45 && (
								<span className="dim">{t("TAP A NODE FOR NAMES")}</span>
							)}
						</>
					) : (
						<span>{t("ONE CELL = ONE HOUR")}</span>
					)}
				</div>
			</div>
		</main>
	);
}
