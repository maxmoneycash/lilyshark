import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadActividad, loadAllTraceroutes, loadNeighbors } from "../db";
import { ago, fechaHora } from "../fmt";
import { t } from "../i18n";
import { buildEdges, type Edge, edgeKey as key, summarize } from "../mesh";
import { getSnapshot, subscribe } from "../store";
import { accent, fg, useThemeTick } from "../theme";

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
	const k = Math.sqrt((w * h) / Math.max(1, n)); // distancia ideal entre nodos
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
				const rep = (k * k) / d; // magnitud
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
			const att = (d * d) / k; // magnitud
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
	const pad = 60; // room for the labels, which sit to the right of the node
	const sc = Math.min(
		(w - pad * 2) / Math.max(1, maxX - minX),
		(h - pad * 2) / Math.max(1, maxY - minY),
	);
	const offX = (w - (maxX - minX) * sc) / 2 - minX * sc;
	const offY = (h - (maxY - minY) * sc) / 2 - minY * sc;
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
	const [vista, setVista] = useState<"grafo" | "actividad">("grafo");
	const [act, setAct] = useState<{ node: number; hora: number; n: number }[]>(
		[],
	);
	const [actHoras, setActHoras] = useState(48);

	useEffect(() => {
		if (vista !== "actividad") return;
		loadActividad(Date.now() - actHoras * 3_600_000)
			.then(setAct)
			.catch(() => {});
	}, [vista, actHoras, reload]);

	useEffect(() => {
		loadNeighbors()
			.then(setNeighbors)
			.catch(() => {});
		loadAllTraceroutes()
			.then(setTraces)
			.catch(() => {});
	}, [reload]);

	const edges = useMemo(
		() => buildEdges(neighbors, traces, s.myNodeNum),
		[neighbors, traces, s.myNodeNum],
	);

	const ids = useMemo(() => {
		const set = new Set<number>();
		for (const e of edges) {
			set.add(e.a);
			set.add(e.b);
		}
		return [...set];
	}, [edges]);

	const pos = useMemo(() => layout(ids, edges, W, H), [ids, edges]);

	const short = (num: number) =>
		s.nodes.get(num)?.shortName ?? num.toString(16).slice(-4);
	const long = (num: number) =>
		s.nodes.get(num)?.longName ?? `!${num.toString(16)}`;

	// width/opacity by SNR: a strong link is a bolder line
	const edgeStyle = (snr?: number) => {
		if (snr === undefined) return { w: 1, o: 0.25 };
		if (snr >= 5) return { w: 2, o: 0.85 };
		if (snr >= 0) return { w: 1.5, o: 0.55 };
		return { w: 1, o: 0.35 };
	};

	const selEdges =
		sel !== undefined ? edges.filter((e) => e.a === sel || e.b === sel) : [];
	const vecinosSel = new Set(selEdges.map((e) => (e.a === sel ? e.b : e.a)));

	// s.version changes with every packet: recomputing the snapshot is cheap
	const sum = useMemo(() => summarize(s.nodes.values()), [s]);

	// activity grid: rows = nodes, columns = hours
	const rejilla = useMemo(() => {
		const ahora = Math.floor(Date.now() / 3_600_000);
		const horas = Array.from(
			{ length: actHoras },
			(_, i) => ahora - actHoras + 1 + i,
		);
		const porNodo = new Map<number, Map<number, number>>();
		let max = 1;
		for (const r of act) {
			const m = porNodo.get(r.node) ?? new Map<number, number>();
			m.set(r.hora, (m.get(r.hora) ?? 0) + r.n);
			porNodo.set(r.node, m);
			if (r.n > max) max = r.n;
		}
		const filas = [...porNodo.entries()]
			.map(([node, m]) => ({
				node,
				celdas: m,
				total: [...m.values()].reduce((a, b) => a + b, 0),
			}))
			.sort((a, b) => b.total - a.total);
		return { horas, filas, max };
	}, [act, actHoras]);

	const tile = (label: string, value: string | number, cls = "") => (
		<div key={label} className="panel stat-tile" style={{ minWidth: 96 }}>
			<div className="label">{label}</div>
			<div className={`value ${cls}`} style={{ fontSize: 20 }}>
				{value}
			</div>
		</div>
	);

	// hops sorted, with the unknown bucket last
	const saltos = [...sum.saltos.entries()].sort((a, b) =>
		a[0] === "?" ? 1 : b[0] === "?" ? -1 : Number(a[0]) - Number(b[0]),
	);

	return (
		<main style={{ flexDirection: "column" }}>
			<div className="panel" style={{ flexShrink: 0 }}>
				<div className="panel-title">{t("RESUMEN // MALLA")}</div>
				<div
					style={{
						display: "flex",
						gap: 10,
						padding: 12,
						flexWrap: "wrap",
						alignItems: "stretch",
					}}
				>
					{tile(t("NODOS"), sum.total)}
					{tile(t("ACTIVOS 1 H"), sum.activos1h)}
					{tile(t("ACTIVOS 24 H"), sum.activos24h)}
					{tile(t("CON POSICIÓN"), sum.conPosicion)}
					{tile(t("REPETIDORES"), sum.repetidores)}
					{tile(t("CON PKI"), sum.conPki)}
					{tile(
						t("BATERÍA BAJA"),
						sum.bateriaBaja,
						sum.bateriaBaja > 0 ? "err" : "",
					)}
					{tile(t("NUNCA OÍDOS"), sum.nuncaOidos, "dim")}

					<div className="panel" style={{ padding: "8px 12px", minWidth: 190 }}>
						<div
							className="dim"
							style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
						>
							{t("SALTOS")}
						</div>
						{saltos.map(([k, n]) => (
							<div
								key={String(k)}
								style={{ display: "flex", gap: 8, fontSize: 12 }}
							>
								<span style={{ width: 70 }} className={k === "?" ? "dim" : ""}>
									{k === "?"
										? t("DESCONOCIDO")
										: k === 0
											? t("DIRECTO")
											: `${k}`}
								</span>
								<span style={{ flex: 1 }}>
									{"█".repeat(Math.min(12, Math.ceil((n / sum.total) * 24)))}
								</span>
								<span className="dim">{n}</span>
							</div>
						))}
					</div>

					{sum.mudos.length > 0 && (
						<div
							className="panel"
							style={{ padding: "8px 12px", minWidth: 200 }}
						>
							<div
								className="warn"
								style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
							>
								{t("★ FAVORITOS CALLADOS")}
							</div>
							<div style={{ maxHeight: 92, overflowY: "auto" }}>
								{sum.mudos.map((n) => (
									<div
										key={n.num}
										style={{ display: "flex", gap: 10, fontSize: 12 }}
									>
										<span style={{ flex: 1 }}>{n.shortName}</span>
										<span className="dim" title={fechaHora(n.lastHeard * 1000)}>
											{t("hace {0}", ago(n.lastHeard))}
										</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>

			<div className="panel" style={{ flex: 1, minWidth: 0 }}>
				<div className="panel-title">
					<span style={{ display: "flex", gap: 10, alignItems: "center" }}>
						<button
							className={vista === "grafo" ? "tab active" : "tab"}
							style={{ fontSize: 10 }}
							onClick={() => setVista("grafo")}
						>
							{t("GRAFO")}
						</button>
						<button
							className={vista === "actividad" ? "tab active" : "tab"}
							style={{ fontSize: 10 }}
							onClick={() => setVista("actividad")}
						>
							{t("ACTIVIDAD")}
						</button>
						{vista === "grafo"
							? `${t("{0} NODOS", ids.length)} · ${t("{0} ENLACES", edges.length)}`
							: t("{0} NODOS OÍDOS", rejilla.filas.length)}
					</span>
					<span style={{ display: "flex", gap: 10, alignItems: "center" }}>
						{vista === "actividad" &&
							[24, 48, 168].map((h) => (
								<button
									key={h}
									className={actHoras === h ? "tab active" : "tab"}
									style={{ fontSize: 10 }}
									onClick={() => setActHoras(h)}
								>
									{h === 168 ? t("7 D") : `${h} H`}
								</button>
							))}
						<button
							style={{ fontSize: 10, padding: "0 6px" }}
							title={t("Releer vecinos y traceroutes de la base de datos")}
							onClick={() => setReload((v) => v + 1)}
						>
							⟳ {t("RECARGAR")}
						</button>
						<span className="dim" style={{ fontSize: 11 }}>
							{vista === "actividad"
								? t("UNA CELDA = UNA HORA")
								: t(
										"{0} POR VECINOS",
										edges.filter((e) => e.src === "vecinos").length,
									)}
						</span>
					</span>
				</div>

				{vista === "actividad" ? (
					rejilla.filas.length === 0 ? (
						<p className="dim" style={{ padding: 16, fontSize: 12 }}>
							{t(
								"SIN ESCUCHAS REGISTRADAS — el historial empieza a llenarse ahora, con la app conectada_",
							)}
						</p>
					) : (
						<div style={{ flex: 1, overflow: "auto", padding: 12 }}>
							<table style={{ borderCollapse: "collapse", fontSize: 11 }}>
								<tbody>
									{rejilla.filas.map((f) => (
										<tr key={f.node}>
											<td
												style={{
													paddingRight: 10,
													whiteSpace: "nowrap",
													position: "sticky",
													left: 0,
													background: "var(--panel)",
												}}
											>
												{short(f.node)}
												{f.node === s.myNodeNum && ` (${t("YO")})`}
											</td>
											{rejilla.horas.map((h) => {
												const n = f.celdas.get(h) ?? 0;
												// intensity relative to the max, with a visible floor
												const op =
													n === 0 ? 0 : 0.25 + 0.75 * (n / rejilla.max);
												const d = new Date(h * 3_600_000);
												return (
													<td
														key={h}
														title={`${short(f.node)} · ${fechaHora(d.getTime())} · ${t("{0} paquetes", n)}`}
														style={{
															width: 9,
															height: 14,
															padding: 0,
															border: "1px solid var(--border)",
															background: n === 0 ? "transparent" : fg(),
															opacity: n === 0 ? 0.25 : op,
														}}
													/>
												);
											})}
											<td
												className="dim"
												style={{ paddingLeft: 10, whiteSpace: "nowrap" }}
											>
												{f.total}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				) : ids.length === 0 ? (
					<p className="dim" style={{ padding: 16, fontSize: 12 }}>
						{t(
							"SIN ENLACES — activa NEIGHBOR INFO en CONFIG o lanza traceroutes desde NODOS_",
						)}
					</p>
				) : (
					<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
						<div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
							<svg
								viewBox={`0 0 ${W} ${H}`}
								style={{ width: "100%", height: "100%" }}
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
										vecinosSel.has(id);
									return (
										<g
											key={id}
											opacity={dim}
											style={{ cursor: "pointer" }}
											onClick={() => setSel(sel === id ? undefined : id)}
										>
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
								className="panel hot"
								style={{ width: 260, flexShrink: 0, fontSize: 12 }}
							>
								<div className="panel-title">
									<span>{short(sel)}</span>
									<button
										onClick={() => setSel(undefined)}
										style={{ width: 22, height: 22, padding: 0, fontSize: 12 }}
									>
										✕
									</button>
								</div>
								<div style={{ padding: "10px 12px" }}>
									<div style={{ fontWeight: 700 }}>{long(sel)}</div>
									<div
										className="dim"
										style={{ fontSize: 11, marginBottom: 8 }}
									>
										!{sel.toString(16)}
										{sel === s.myNodeNum && ` · (${t("YO")})`}
									</div>
									<div
										className="dim"
										style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
									>
										{t("ENLACES")} ({selEdges.length})
									</div>
									<div style={{ maxHeight: 320, overflowY: "auto" }}>
										{selEdges
											.slice()
											.sort((x, y) => (y.snr ?? -99) - (x.snr ?? -99))
											.map((e) => {
												const other = e.a === sel ? e.b : e.a;
												return (
													<div
														key={key(e.a, e.b)}
														style={{ display: "flex", gap: 8, lineHeight: 1.7 }}
													>
														<span
															style={{ flex: 1, cursor: "pointer" }}
															onClick={() => setSel(other)}
														>
															{short(other)}
														</span>
														<span className="dim">
															{e.snr !== undefined
																? `${e.snr.toFixed(1)} dB`
																: "—"}
														</span>
													</div>
												);
											})}
									</div>
								</div>
							</div>
						)}
					</div>
				)}

				<div className="panel-foot">
					<span>{t("LÍNEA CONTINUA = VECINO DIRECTO")}</span>
					<span style={{ flex: 1 }} />
					{ids.length > 45 && (
						<span className="dim">
							{t("CLIC EN UN NODO PARA VER NOMBRES")} ·{" "}
						</span>
					)}
					<span>{t("DISCONTINUA = TRAMO DE TRACEROUTE")}</span>
				</div>
			</div>
		</main>
	);
}
