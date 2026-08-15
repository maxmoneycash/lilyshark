import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type Prevision, preverBateria, textoPrevision } from "../battery";
import { loadHopChanges, loadTelemetry, loadTraceroutes } from "../db";
import {
	ago,
	asciiBattery,
	distKm,
	fechaHora,
	fmtDist,
	hwName,
	snrClass,
} from "../fmt";
import { t } from "../i18n";
import {
	deleteNode,
	requestTelemetry,
	resetPath,
	runTraceroute,
	shareContact,
	toggleFav,
	toggleIgnored,
} from "../radio";
import {
	ContactType,
	getSnapshot,
	type NodeEntry,
	subscribe,
	type Traceroute,
} from "../store";

// Click to copy the underlying text; a ✓ flashes for ~1 s. The visible label
// and the copied value can differ (coords show 4 decimals, copy full precision).
function Copy({ text, children }: { text: string; children: React.ReactNode }) {
	const [done, setDone] = useState(false);
	return (
		<span
			title={t("Clic para copiar")}
			style={{ cursor: "pointer" }}
			onClick={() => {
				navigator.clipboard?.writeText(text).then(
					() => {
						setDone(true);
						setTimeout(() => setDone(false), 1200);
					},
					() => {},
				);
			}}
		>
			{children}
			{done && <span className="dim"> ✓</span>}
		</span>
	);
}

type SortKey =
	| "visto"
	| "nombre"
	| "corto"
	| "saltos"
	| "snr"
	| "bateria"
	| "pos";

// default direction the first time each column is clicked
const DEFAULT_DIR: Record<SortKey, 1 | -1> = {
	visto: -1,
	nombre: 1,
	corto: 1,
	saltos: 1,
	snr: -1,
	bateria: -1,
	pos: 1,
};

// Distance from my node, ready to append after the coordinates. Empty when
// there's no fix on either side or the node is mine.
function distDesde(
	n: NodeEntry,
	me: NodeEntry | undefined,
	isMe: boolean,
): string {
	if (isMe || n.lat === undefined || n.lon === undefined) return "";
	if (me?.lat === undefined || me.lon === undefined) return "";
	return ` · ${fmtDist(distKm(me.lat, me.lon, n.lat, n.lon))}`;
}

// undefined always last
function cmpOpt(a: number | undefined, b: number | undefined, dir: 1 | -1) {
	if (a === undefined && b === undefined) return 0;
	if (a === undefined) return 1;
	if (b === undefined) return -1;
	return (a - b) * dir;
}

function sortNodes(
	nodes: NodeEntry[],
	key: SortKey,
	dir: 1 | -1,
	me?: NodeEntry,
) {
	const base = sortNodesBy(nodes, key, dir, me);
	// favorites always on top, keeping the chosen order within each group
	return base.sort((a, b) => Number(!!b.fav) - Number(!!a.fav));
}

function sortNodesBy(
	nodes: NodeEntry[],
	key: SortKey,
	dir: 1 | -1,
	me?: NodeEntry,
) {
	const s = [...nodes];
	switch (key) {
		case "nombre":
			return s.sort(
				(a, b) => (a.longName ?? "").localeCompare(b.longName ?? "") * dir,
			);
		case "corto":
			return s.sort(
				(a, b) => (a.shortName ?? "").localeCompare(b.shortName ?? "") * dir,
			);
		case "saltos":
			return s.sort((a, b) => cmpOpt(a.hopsAway, b.hopsAway, dir));
		case "snr":
			return s.sort((a, b) => cmpOpt(a.snr, b.snr, dir));
		case "bateria":
			return s.sort((a, b) => cmpOpt(a.batteryLevel, b.batteryLevel, dir));
		case "pos": {
			const d = (n: NodeEntry) =>
				n.lat !== undefined &&
				n.lon !== undefined &&
				me?.lat !== undefined &&
				me?.lon !== undefined
					? distKm(me.lat, me.lon, n.lat, n.lon)
					: undefined;
			return s.sort(
				(a, b) =>
					cmpOpt(d(a), d(b), dir) ||
					Number(b.lat !== undefined) - Number(a.lat !== undefined) ||
					b.lastHeard - a.lastHeard,
			);
		}
		default:
			return s.sort((a, b) => (a.lastHeard - b.lastHeard) * dir);
	}
}

function Th(props: {
	label: string;
	k: SortKey;
	sort: { key: SortKey; dir: 1 | -1 };
	onSort: (k: SortKey) => void;
}) {
	const active = props.sort.key === props.k;
	return (
		<th
			onClick={() => props.onSort(props.k)}
			style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
		>
			{props.label}{" "}
			<span style={{ fontSize: 9, letterSpacing: 0 }}>
				<span style={{ opacity: active && props.sort.dir === 1 ? 1 : 0.3 }}>
					▲
				</span>
				<span style={{ opacity: active && props.sort.dir === -1 ? 1 : 0.3 }}>
					▼
				</span>
			</span>
		</th>
	);
}

function RouteLine(props: {
	label: string;
	hops: number[]; // nodos intermedios
	snrs: number[]; // dB ×4, one value per segment (receiving node)
	from: string;
	to: string;
	short: (num: number) => string;
}) {
	// full sequence of nodes and arrows with the SNR of each segment
	const nodes = [props.from, ...props.hops.map(props.short), props.to];
	const arrow = (snr: number | undefined) =>
		snr !== undefined ? ` ─(${(snr / 4).toFixed(1)} dB)→ ` : " → ";
	return (
		<div style={{ fontSize: 11, lineHeight: 1.6 }}>
			<span className="dim">{props.label}: </span>
			{nodes
				.map((name, i) => (i === 0 ? name : arrow(props.snrs[i - 1]) + name))
				.join("")}
		</div>
	);
}

function Detail(props: {
	node: NodeEntry;
	isMe: boolean;
	me?: NodeEntry; // my node, to measure distance from
	trace?: Traceroute;
	posTs?: number; // ts of the last PositionPacket received from this node
	short: (num: number) => string;
	onOpenDm: (num: number) => void;
	onClose: () => void;
}) {
	const { node: n } = props;
	const [tracing, setTracing] = useState(false);
	const [traceErr, setTraceErr] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// "" | "waiting" | "ok" | "timeout" | error message
	const [posState, setPosState] = useState("");
	const [confirmDel, setConfirmDel] = useState(false);
	// result line of the last contact action (reset path / share)
	const [adminMsg, setAdminMsg] = useState("");
	const posTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const posBase = useRef<number | undefined>(undefined);
	const [history, setHistory] = useState<Traceroute[]>([]);
	const [showHistory, setShowHistory] = useState(false);
	const [bat, setBat] = useState<Prevision>();
	const [hops, setHops] = useState<
		{ ts: number; hops: number; antes?: number }[]
	>([]);

	useEffect(() => {
		let cancelled = false;
		loadHopChanges(n.num)
			.then((h) => {
				if (!cancelled) setHops(h);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [n.num, n.hopsAway]);

	// runtime forecast from the battery history in SQLite
	useEffect(() => {
		let cancelled = false;
		setBat(undefined);
		loadTelemetry(n.num, "batteryLevel", Date.now() - 6 * 3_600_000)
			.then((rows) => {
				if (!cancelled) setBat(preverBateria(rows));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [n.num, n.batteryLevel]);

	useEffect(() => {
		let cancelled = false;
		loadTraceroutes(n.num).then((h) => {
			if (!cancelled) setHistory(h);
		});
		return () => {
			cancelled = true;
		};
	}, [n.num, props.trace]);

	useEffect(
		() => () => {
			clearTimeout(timer.current);
			clearTimeout(posTimer.current);
		},
		[],
	);
	useEffect(() => {
		if (props.trace) {
			setTracing(false);
			clearTimeout(timer.current);
		}
	}, [props.trace]);
	useEffect(() => {
		if (posState === "waiting" && props.posTs !== posBase.current) {
			setPosState("ok");
			clearTimeout(posTimer.current);
		}
	}, [props.posTs, posState]);
	useEffect(() => {
		setTracing(false);
		setTraceErr("");
		setPosState("");
		setConfirmDel(false);
		setAdminMsg("");
		setShowHistory(false);
		clearTimeout(timer.current);
		clearTimeout(posTimer.current);
	}, [n.num]);

	const onResetPath = () => {
		setAdminMsg("");
		resetPath(n.num)
			.then(() => setAdminMsg(t("Ruta reiniciada ✓")))
			.catch((e: unknown) => setAdminMsg(`ERROR: ${e}`));
	};

	const onShare = () => {
		setAdminMsg("");
		shareContact(n.num)
			.then(() => setAdminMsg(t("Contacto compartido en la malla ✓")))
			.catch((e: unknown) => setAdminMsg(`ERROR: ${e}`));
	};

	const onAskTelem = () => {
		clearTimeout(posTimer.current);
		posBase.current = props.posTs;
		requestTelemetry(n.num).catch((e: unknown) => setPosState(String(e)));
		setPosState("waiting");
		posTimer.current = setTimeout(() => {
			setPosState((cur) => (cur === "waiting" ? "timeout" : cur));
		}, 60_000);
	};

	const onTrace = async () => {
		setTraceErr("");
		setTracing(true);
		clearTimeout(timer.current);
		// the reply arrives by event; we wait up to 60 s whatever the ack does
		timer.current = setTimeout(() => {
			setTracing(false);
			setTraceErr(t("SIN RESPUESTA (60 s)"));
		}, 60_000);
		try {
			await runTraceroute(n.num);
		} catch (e) {
			setTracing(false);
			setTraceErr(e instanceof Error ? e.message : "ERROR");
			clearTimeout(timer.current);
		}
	};

	const rows: [string, React.ReactNode][] = [
		[
			"ID",
			<Copy text={`!${n.num.toString(16)}`}>{`!${n.num.toString(16)}`}</Copy>,
		],
		[t("TIPO"), hwName(n.type)],
		...(n.publicKey
			? ([
					[
						t("CLAVE"),
						<Copy text={n.publicKey}>
							<span title={n.publicKey}>{`${n.publicKey.slice(0, 16)}…`}</span>
						</Copy>,
					],
				] as [string, React.ReactNode][])
			: []),
		[
			"SNR",
			<span className={snrClass(n.snr)}>
				{n.snr !== undefined ? `${n.snr.toFixed(2)} dB` : "—"}
			</span>,
		],
		[
			t("BATERÍA"),
			<>
				{asciiBattery(n.batteryLevel)}
				{bat && (
					<div
						className={
							bat.horasRestantes !== undefined && bat.horasRestantes < 24
								? "warn"
								: "dim"
						}
						style={{ fontSize: 10, letterSpacing: 0 }}
						title={t(
							"Estimado con los últimos {0} puntos de batería · ajuste {1}",
							bat.muestras,
							bat.ajuste.toFixed(2),
						)}
					>
						{t(...textoPrevision(bat))}
					</div>
				)}
			</>,
		],
		[t("VOLTAJE"), n.voltage !== undefined ? `${n.voltage.toFixed(2)} V` : "—"],
		[
			t("SALTOS"),
			<>
				{n.hopsAway !== undefined ? String(n.hopsAway) : "—"}
				{hops[0] && (
					<span
						className="dim"
						style={{ fontSize: 10 }}
						title={hops
							.map((h) => `${fechaHora(h.ts)} · ${h.antes ?? "?"} → ${h.hops}`)
							.join("\n")}
					>
						{" "}
						{t(
							"· cambió hace {0} (antes {1})",
							ago(hops[0].ts / 1000),
							hops[0].antes ?? "?",
						)}
					</span>
				)}
			</>,
		],
		...(n.outPath?.length
			? ([
					[
						t("RUTA"),
						<span className="dim" style={{ fontSize: 11 }}>
							{n.outPath
								.map((h) => h.toString(16).padStart(2, "0"))
								.join(" → ")}
						</span>,
					],
				] as [string, React.ReactNode][])
			: []),
		[t("CIFRADO DM"), n.publicKey ? "PKI 🔒" : t("sólo PSK del canal")],
		[
			t("POSICIÓN"),
			n.lat !== undefined && n.lon !== undefined ? (
				<>
					<Copy text={`${n.lat}, ${n.lon}`}>
						{`${n.lat.toFixed(4)}N ${n.lon.toFixed(4)}E`}
					</Copy>
					{distDesde(n, props.me, props.isMe)}
				</>
			) : (
				t("SIN GPS FIX")
			),
		],
		[
			t("VISTO HACE"),
			<span title={fechaHora(n.lastHeard * 1000)}>{ago(n.lastHeard)}</span>,
		],
	];
	return (
		<div className="panel hot" style={{ width: 300, flexShrink: 0 }}>
			<div className="panel-title">
				<span>
					{t("DETALLE // NODO")} {n.shortName}
				</span>
				<button
					onClick={props.onClose}
					style={{
						width: 22,
						height: 22,
						padding: 0,
						fontSize: 12,
						lineHeight: 1,
					}}
				>
					✕
				</button>
			</div>
			<div
				style={{
					padding: "12px 12px 4px",
					fontSize: 16,
					fontWeight: 700,
					textShadow: "0 0 8px var(--glow)",
				}}
			>
				{n.longName}
				{props.isMe && ` · (${t("YO")})`}
			</div>
			<div
				className="dim"
				style={{ padding: "2px 12px 12px", fontSize: 11 }}
				title={fechaHora(n.lastHeard * 1000)}
			>
				{t("ÚLTIMO PAQUETE HACE {0}", ago(n.lastHeard))}
			</div>
			<div className="kv" style={{ borderTop: "1px solid var(--border)" }}>
				{rows.map(([k, v]) => (
					<span key={k} style={{ display: "contents" }}>
						<span className="k">{k}</span>
						<span>{v}</span>
					</span>
				))}
			</div>
			{(props.trace || tracing || traceErr || history.length > 0) && (
				<div
					style={{
						padding: "10px 12px",
						borderTop: "1px solid var(--border)",
						wordBreak: "break-word",
					}}
				>
					<div
						className="dim"
						style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
					>
						TRACEROUTE
					</div>
					{tracing && (
						<span className="warn" style={{ fontSize: 11 }}>
							{t("EN CURSO_")}
						</span>
					)}
					{traceErr && (
						<span className="err" style={{ fontSize: 11 }}>
							{traceErr}
						</span>
					)}
					{props.trace && (
						<>
							<RouteLine
								label={t("IDA")}
								hops={props.trace.route}
								snrs={props.trace.snrTowards}
								from={t("YO")}
								to={n.shortName}
								short={props.short}
							/>
							<RouteLine
								label={t("VUELTA")}
								hops={props.trace.routeBack}
								snrs={props.trace.snrBack}
								from={n.shortName}
								to={t("YO")}
								short={props.short}
							/>
						</>
					)}
					{history.length > 0 && (
						<>
							<button
								style={{ fontSize: 10, padding: "2px 6px", marginTop: 8 }}
								onClick={() => setShowHistory((v) => !v)}
							>
								{showHistory ? "▼" : "▶"} {t("HISTORIAL")} ({history.length})
							</button>
							{showHistory && (
								<div
									style={{ maxHeight: 160, overflowY: "auto", marginTop: 6 }}
								>
									{history.map((h) => (
										<div key={h.ts} style={{ marginBottom: 6 }}>
											<div className="dim" style={{ fontSize: 10 }}>
												{fechaHora(h.ts)} ·{" "}
												{t("{0} saltos", h.route.length + 1)}
											</div>
											<RouteLine
												label={t("IDA")}
												hops={h.route}
												snrs={h.snrTowards}
												from={t("YO")}
												to={n.shortName}
												short={props.short}
											/>
										</div>
									))}
								</div>
							)}
						</>
					)}
				</div>
			)}
			{posState && (
				<div
					style={{
						padding: "10px 12px",
						borderTop: "1px solid var(--border)",
					}}
				>
					<div
						className="dim"
						style={{ fontSize: 10, letterSpacing: 2, marginBottom: 4 }}
					>
						{t("PETICIÓN DE TELEMETRÍA")}
					</div>
					{posState === "waiting" && (
						<span className="warn" style={{ fontSize: 11 }}>
							{t("EN CURSO_")}
						</span>
					)}
					{posState === "ok" && (
						<span style={{ fontSize: 11 }}>
							{t("RECIBIDA ✓ · ver pestaña TELEMETRÍA")}
						</span>
					)}
					{posState === "timeout" && (
						<span className="err" style={{ fontSize: 11 }}>
							{t("SIN RESPUESTA (60 s)")}
						</span>
					)}
					{!["waiting", "ok", "timeout"].includes(posState) && (
						<span className="err" style={{ fontSize: 11 }}>
							{posState}
						</span>
					)}
				</div>
			)}
			<div style={{ flex: 1 }} />
			{!props.isMe && (
				<div
					style={{
						padding: "8px 12px",
						borderTop: "1px solid var(--border)",
						display: "flex",
						gap: 8,
					}}
				>
					<button
						style={{ flex: 1, padding: "6px 0" }}
						className={n.fav ? "primary" : ""}
						title={
							n.fav
								? t("Quitar de favoritos")
								: t("Marcar favorito (arriba en la lista)")
						}
						onClick={() => toggleFav(n.num)}
					>
						{n.fav ? "★ FAV" : "☆ FAV"}
					</button>
					<button
						style={{ flex: 1, padding: "6px 0" }}
						title={
							n.ignored
								? t("Dejar de ignorar")
								: t("Ignorar: descartar sus mensajes")
						}
						onClick={() => toggleIgnored(n.num)}
					>
						{n.ignored ? t("🚫 IGNORADO") : t("IGNORAR")}
					</button>
					<button
						className="danger"
						style={{ flex: 1, padding: "6px 0" }}
						title={t("Borrar de la radio y de la BD local")}
						onClick={() => {
							if (confirmDel) {
								deleteNode(n.num).catch(() => {});
								props.onClose();
							} else {
								setConfirmDel(true);
								setTimeout(() => setConfirmDel(false), 3000);
							}
						}}
					>
						{confirmDel ? t("¿SEGURO?") : t("BORRAR")}
					</button>
				</div>
			)}
			{!props.isMe && (
				<div
					style={{
						padding: "8px 12px",
						borderTop: "1px solid var(--border)",
						display: "flex",
						flexDirection: "column",
						gap: 6,
					}}
				>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							style={{ flex: 1, padding: "6px 0" }}
							title={t(
								"Olvidar la ruta guardada: el siguiente intercambio la reaprende",
							)}
							onClick={onResetPath}
						>
							{t("RESET RUTA")}
						</button>
						<button
							style={{ flex: 1, padding: "6px 0" }}
							title={t("Difundir la tarjeta de este contacto a la malla")}
							onClick={onShare}
						>
							{t("COMPARTIR")}
						</button>
					</div>
					{adminMsg && (
						<span
							className={adminMsg.startsWith("ERROR") ? "err" : "dim"}
							style={{ fontSize: 10 }}
						>
							{adminMsg}
						</span>
					)}
				</div>
			)}
			{!props.isMe && (
				<div
					style={{
						padding: 12,
						borderTop: "1px solid var(--border)",
						display: "flex",
						gap: 8,
					}}
				>
					<button
						className="primary"
						style={{ flex: 1, padding: "8px 0" }}
						onClick={() => props.onOpenDm(n.num)}
					>
						[ DM ]
					</button>
					<button
						style={{ flex: 1, padding: "8px 0", minWidth: 0 }}
						title={t("Traceroute: trazar ruta de saltos hasta el nodo")}
						disabled={tracing}
						onClick={onTrace}
					>
						[ TRACE ]
					</button>
					<button
						style={{ flex: 1, padding: "8px 0", minWidth: 0 }}
						title={t("Pedir telemetría de sensores al nodo")}
						disabled={posState === "waiting"}
						onClick={onAskTelem}
					>
						[ TELEM ]
					</button>
				</div>
			)}
		</div>
	);
}

export default function Nodes({
	onOpenDm,
	initialSelected,
}: {
	onOpenDm: (num: number) => void;
	initialSelected?: number;
}) {
	const s = useSyncExternalStore(subscribe, getSnapshot);
	const [selected, setSelected] = useState<number | undefined>(initialSelected);

	// When arriving from the map with a preselected node, scroll its row into view
	useEffect(() => {
		document.querySelector("tbody tr.sel")?.scrollIntoView({ block: "center" });
	}, []);
	const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
		key: "visto",
		dir: -1,
	});
	const onSort = (key: SortKey) =>
		setSort((prev) =>
			prev.key === key
				? { key, dir: (prev.dir * -1) as 1 | -1 }
				: { key, dir: DEFAULT_DIR[key] },
		);
	const [filter, setFilter] = useState("");
	const me = s.myNodeNum !== undefined ? s.nodes.get(s.myNodeNum) : undefined;
	const q = filter.trim().toLowerCase().replace(/^!/, "");
	const all = [...s.nodes.values()];
	const matching = q
		? all.filter(
				(n) =>
					n.longName?.toLowerCase().includes(q) ||
					n.shortName?.toLowerCase().includes(q) ||
					n.num.toString(16).includes(q),
			)
		: all;
	const nodes = sortNodes(matching, sort.key, sort.dir, me);
	const selectedNode =
		selected !== undefined ? s.nodes.get(selected) : undefined;
	const short = (num: number) =>
		s.nodes.get(num)?.shortName ?? `!${num.toString(16)}`;

	return (
		<main>
			<div className="panel" style={{ flex: 1, minWidth: 0 }}>
				<div className="panel-title">
					<span>
						{t("PANEL // NODOS")} · {nodes.length}
						{q ? t(" DE {0}", all.length) : ""} {t("DETECTADOS")}
					</span>
					<input
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder={t("filtrar nombre / id_")}
						style={{ width: 180, fontSize: 11 }}
					/>
				</div>
				<div style={{ overflowY: "auto", flex: 1 }}>
					<table className="grid">
						<thead>
							<tr>
								<Th label={t("NODO")} k="nombre" sort={sort} onSort={onSort} />
								<Th label={t("CORTO")} k="corto" sort={sort} onSort={onSort} />
								<Th label="SNR" k="snr" sort={sort} onSort={onSort} />
								<Th
									label={t("BATERÍA")}
									k="bateria"
									sort={sort}
									onSort={onSort}
								/>
								<Th
									label={t("SALTOS")}
									k="saltos"
									sort={sort}
									onSort={onSort}
								/>
								<Th label={t("POSICIÓN")} k="pos" sort={sort} onSort={onSort} />
								<Th
									label={t("VISTO HACE")}
									k="visto"
									sort={sort}
									onSort={onSort}
								/>
							</tr>
						</thead>
						<tbody>
							{nodes.map((n) => (
								<tr
									key={n.num}
									className={selected === n.num ? "sel" : ""}
									onClick={() =>
										setSelected(selected === n.num ? undefined : n.num)
									}
								>
									<td style={n.ignored ? { opacity: 0.4 } : undefined}>
										{n.fav && <span className="warn">★ </span>}!
										{n.num.toString(16)} · {n.longName}
										{n.num === s.myNodeNum && ` (${t("YO")})`}
										{n.type === ContactType.Repeater && " ⇄"}
										{n.publicKey && " 🔒"}
										{n.ignored && " 🚫"}
									</td>
									<td style={{ fontWeight: 700 }}>{n.shortName}</td>
									<td className={snrClass(n.snr)}>
										{n.snr !== undefined ? `${n.snr.toFixed(2)} dB` : "—"}
									</td>
									<td
										className={
											n.batteryLevel !== undefined && n.batteryLevel <= 20
												? "err"
												: n.batteryLevel !== undefined && n.batteryLevel <= 40
													? "warn"
													: ""
										}
									>
										{asciiBattery(n.batteryLevel)}
									</td>
									<td>{n.hopsAway ?? "—"}</td>
									<td>
										{n.lat !== undefined && n.lon !== undefined ? (
											<>
												{`${n.lat.toFixed(4)}N ${n.lon.toFixed(4)}E`}
												<span className="dim">
													{distDesde(n, me, n.num === s.myNodeNum)}
												</span>
											</>
										) : (
											t("SIN GPS FIX")
										)}
									</td>
									<td title={fechaHora(n.lastHeard * 1000)}>
										{ago(n.lastHeard)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{nodes.length === 0 && (
						<p className="dim" style={{ padding: 12 }}>
							{q
								? t('SIN COINCIDENCIAS PARA "{0}"_', filter)
								: "NO NODES DETECTED — AWAITING SIGNAL_"}
						</p>
					)}
				</div>
				<div className="panel-foot">
					<span>{t("{0} NODOS EN BD", all.length)}</span>
					<span style={{ flex: 1 }} />
					<span>
						SNR: <span className="ok">≥5 dB OK</span> ·{" "}
						<span className="warn">{t("0–5 dB REG")}</span> ·{" "}
						<span className="err">{t("<0 dB MAL")}</span>
					</span>
				</div>
			</div>

			{selectedNode && (
				<Detail
					node={selectedNode}
					isMe={selectedNode.num === s.myNodeNum}
					me={me}
					trace={s.traceroutes.get(selectedNode.num)}
					posTs={s.posUpdates.get(selectedNode.num)}
					short={short}
					onOpenDm={onOpenDm}
					onClose={() => setSelected(undefined)}
				/>
			)}
		</main>
	);
}
