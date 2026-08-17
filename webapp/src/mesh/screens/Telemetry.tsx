import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { listMetrics, listTelemetryNodes, loadTelemetry } from "../db";
import { demoTelemetry, demoTelemetryMetrics, demoTelemetryNodes } from "../demo";
import { saveText, stamp } from "../export";
import { t, useLangTick } from "../i18n";
import { useDeviceLink, type DeviceTelemetry } from "../../lib/deviceLink";
import { getSnapshot, subscribe } from "../store";
import { ThisDevicePanel } from "../ThisDevice";
import { accent, fg, isLight, useThemeTick } from "../theme";

type DeckMetric = {
	id: string;
	label: string;
	pick: (sample: DeviceTelemetry) => number | undefined;
};

const DECK_METRICS: DeckMetric[] = [
	{
		id: "voltage",
		label: "BATTERY VOLTAGE (V)",
		pick: (s) => (s.mv !== undefined ? s.mv / 1000 : undefined),
	},
	{
		id: "battery",
		label: "BATTERY (%)",
		pick: (s) => {
			if (s.pct !== undefined) return s.pct;
			const m = s.bat.match(/(\d+)\s*%/);
			return m ? Number(m[1]) : undefined;
		},
	},
	{
		id: "sats",
		label: "GPS SATELLITES",
		pick: (s) => s.sat,
	},
	{
		id: "rx",
		label: "FRAMES HEARD",
		pick: (s) => s.rx,
	},
	{
		id: "rssi",
		label: "LAST PACKET RSSI (dBm)",
		pick: (s) => ((s.rx ?? 0) > 0 || s.frames > 0 ? s.rssiX10 / 10 : undefined),
	},
	{
		id: "snr",
		label: "LAST PACKET SNR (dB)",
		pick: (s) => ((s.rx ?? 0) > 0 || s.frames > 0 ? s.snrX10 / 10 : undefined),
	},
];

function DeckTrend() {
	const link = useDeviceLink();
	const tema = useThemeTick();
	const [metricId, setMetricId] = useState("voltage");
	const plotDiv = useRef<HTMLDivElement>(null);
	const plotRef = useRef<uPlot | null>(null);
	const metric = DECK_METRICS.find((m) => m.id === metricId) ?? DECK_METRICS[0];
	const rows = link.history
		.map((sample) => {
			const value = metric.pick(sample);
			return value === undefined ? null : { ts: sample.atMs, value };
		})
		.filter((row): row is { ts: number; value: number } => row !== null);

	useEffect(() => {
		const box = plotDiv.current;
		if (!box) return;
		plotRef.current?.destroy();
		plotRef.current = null;
		if (rows.length === 0) return;
		let min = Infinity;
		let max = -Infinity;
		let sum = 0;
		for (const row of rows) {
			if (row.value < min) min = row.value;
			if (row.value > max) max = row.value;
			sum += row.value;
		}
		plotRef.current = new uPlot(
			{
				...plotSize(box),
				series: [
					{},
					{
						label: metric.label,
						stroke: fg(),
						width: 2,
						points: { show: rows.length < 3 },
						spanGaps: true,
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
						stroke: fg("88"),
						grid: { stroke: fg("22"), dash: [2, 6] },
						ticks: { stroke: fg("44") },
						font: "11px JetBrains Mono",
					},
				],
				legend: { show: false },
			},
			[rows.map((r) => r.ts / 1000), rows.map((r) => r.value)],
			box,
		);
		return () => {
			plotRef.current?.destroy();
			plotRef.current = null;
		};
	}, [rows.length, metric.id, tema, link.history[link.history.length - 1]?.atMs]);

	useEffect(() => {
		const box = plotDiv.current;
		if (!box || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			plotRef.current?.setSize(plotSize(box));
		});
		ro.observe(box);
		return () => ro.disconnect();
	}, []);

	const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3));
	let min = Infinity;
	let max = -Infinity;
	let sum = 0;
	for (const row of rows) {
		if (row.value < min) min = row.value;
		if (row.value > max) max = row.value;
		sum += row.value;
	}

	return (
		<>
			<div
				style={{
					display: "flex",
					gap: 10,
					alignItems: "center",
					flexShrink: 0,
				}}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					T-DECK // LIVE
				</span>
				<select value={metric.id} onChange={(e) => setMetricId(e.target.value)}>
					{DECK_METRICS.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
				<span className="spacer" />
				<span className="dim" style={{ fontSize: 11 }}>
					{rows.length} SAMPLES · EVERY 2s
				</span>
			</div>
			<div
				style={{
					flex: 1,
					display: "flex",
					gap: 12,
					minHeight: 0,
					flexWrap: "wrap",
				}}
			>
				<div className="panel" style={{ flex: "999 1 320px", minWidth: 0 }}>
					<div className="panel-title">
						CHART // T-DECK · {metric.label}
					</div>
					<div className="scroll-y" style={{ padding: 14, position: "relative" }}>
						{rows.length === 0 && (
							<p className="dim" style={{ position: "absolute" }}>
								Waiting for the next USB sample_
							</p>
						)}
						<div
							ref={plotDiv}
							style={{ width: "100%", height: "100%", minHeight: 248 }}
						/>
					</div>
				</div>
				<div
					style={{
						flex: "1 1 200px",
						minWidth: 200,
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					{(
						[
							["MIN", rows.length ? min : undefined],
							["MAX", rows.length ? max : undefined],
							["AVG", rows.length ? sum / rows.length : undefined],
						] as [string, number | undefined][]
					).map(([label, v]) => (
						<div key={label} className="panel stat-tile">
							<div className="label">{label}</div>
							<div className="value">{v !== undefined ? fmt(v) : "—"}</div>
						</div>
					))}
					<div
						style={{
							flex: 1,
							border: "1px dashed var(--border)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 12,
							textAlign: "center",
						}}
					>
						<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
							USB SAMPLES FROM THIS T-DECK
							<br />
							HEARD-NODE TRENDS APPEAR
							<br />
							WHEN THE AIR IS BUSY
						</span>
					</div>
				</div>
			</div>
		</>
	);
}

// The database is the source of truth; the demo mesh rides on top of it the
// same way it does on the node list, so this screen is never empty on a first
// visit. Real rows always win — the demo only fills where the DB has nothing.
const teleNodes = async (): Promise<number[]> => [
	...new Set([...(await listTelemetryNodes()), ...demoTelemetryNodes()]),
];
const teleMetrics = async (node: number): Promise<string[]> => {
	const real = await listMetrics(node);
	return real.length ? real : demoTelemetryMetrics(node);
};
const teleLoad = async (
	node: number,
	metric: string,
	since: number,
): Promise<{ ts: number; value: number }[]> => {
	const real = await loadTelemetry(node, metric, since);
	return real.length ? real : demoTelemetry(node, metric, since);
};

// pseudo-metric: ChUtil + AirUtilTx on the same chart
const CHANNEL = "__canal";

// A function, not a constant: at module scope the labels would be translated
// once, on first import, and a language switch would leave them in the old one.
const metricLabels = (): Record<string, string> => ({
	[CHANNEL]: t("CANAL OCUPADO (%)"),
	batteryLevel: t("NIVEL BATERÍA (%)"),
	voltage: t("TENSIÓN BATERÍA (V)"),
	channelUtilization: t("UTIL. CANAL (%)"),
	airUtilTx: t("AIRE TX (%)"),
	temperature: t("TEMPERATURA (°C)"),
	relativeHumidity: t("HUMEDAD (%)"),
	barometricPressure: t("PRESIÓN (hPa)"),
});

const RANGES: [string, number][] = [
	["6 H", 0.25],
	["24 H", 1],
	["7 D", 7],
	["30 D", 30],
];

// Colors of the compared series. The first comes from the theme; the rest are
// fixed, in a bright set for the dark themes and a darkened one for the light.
const SERIES_MAX = 4;
const seriesColors = (): string[] => [
	accent(),
	...(isLight()
		? ["#9a6a00", "#0f6f86", "#54459c"]
		: ["#ffb000", "#5ccfe6", "#b3a5e3"]),
];

// uPlot wants pixels, so the box has to be measured. One helper for both the
// first build and every later resize, so the two can never disagree and fight
// each other through the ResizeObserver.
const plotSize = (box: HTMLElement) => ({
	width: Math.max(100, box.clientWidth - 28),
	height: Math.max(220, box.clientHeight - 28),
});

export default function Telemetry() {
	const link = useDeviceLink();
	const s = useSyncExternalStore(subscribe, getSnapshot);
	// uPlot draws on canvas with fg(): the chart is rebuilt on a theme change
	const tema = useThemeTick();
	const idioma = useLangTick();
	const [node, setNode] = useState<number | undefined>();
	const [compare, setCompare] = useState<number[]>([]);
	const [csvMsg, setCsvMsg] = useState("");
	const [exporting, setExporting] = useState(false);
	const [metrics, setMetrics] = useState<string[]>([]);
	const [metric, setMetric] = useState("");
	const [days, setDays] = useState(1);
	const [stats, setStats] = useState<{
		min: number;
		max: number;
		avg: number;
		n: number;
	} | null>(null);
	const plotDiv = useRef<HTMLDivElement>(null);
	const plotRef = useRef<uPlot | null>(null);
	const [withData, setWithData] = useState<Set<number>>(new Set());
	// ponytail: periodic refresh instead of reacting to s.version — the mesh
	// mutates dozens of times/s and rebuilding the chart each time hangs the webview
	const [tick, setTick] = useState(0);
	// re-read on every language change, so a switch relabels the axes and the
	// metric picker without a reload
	const LABELS = metricLabels();

	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 10_000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		let alive = true;
		teleNodes().then((ns) => {
			if (alive) setWithData(new Set(ns));
		});
		return () => {
			alive = false;
		};
	}, [tick]);

	const shortName = (num?: number) =>
		num === undefined
			? "—"
			: (s.nodes.get(num)?.shortName ?? `!${num.toString(16)}`);

	const nodes = [...s.nodes.values()]
		.filter((n) => withData.has(n.num))
		.sort((a, b) => (a.longName ?? "").localeCompare(b.longName ?? ""));
	const effectiveNode =
		node !== undefined && withData.has(node) ? node : nodes[0]?.num;

	useEffect(() => {
		if (effectiveNode === undefined) return;
		teleMetrics(effectiveNode).then((raw) => {
			const m =
				raw.includes("channelUtilization") && raw.includes("airUtilTx")
					? [CHANNEL, ...raw]
					: raw;
			setMetrics(m);
			setMetric((cur) => (m.includes(cur) ? cur : (m[0] ?? "")));
		});
	}, [effectiveNode, tick]);

	// when the main node changes, stop comparing it against itself
	useEffect(() => {
		setCompare((c) => c.filter((n) => n !== effectiveNode));
	}, [effectiveNode]);

	useEffect(() => {
		if (effectiveNode === undefined || !metric || !plotDiv.current) return;
		const since = Date.now() - days * 86_400_000;
		let cancelled = false;
		// CHANNEL (two metrics of one node) and comparing (one metric of several
		// nodes) don't mix: while comparing, CHANNEL means channel utilization.
		const dual = metric === CHANNEL && compare.length === 0;
		const realMetric = metric === CHANNEL ? "channelUtilization" : metric;
		const load = dual
			? Promise.all([
					teleLoad(effectiveNode, "channelUtilization", since),
					teleLoad(effectiveNode, "airUtilTx", since),
				])
			: Promise.all([
					teleLoad(effectiveNode, realMetric, since),
					...compare.map((n) => teleLoad(n, realMetric, since)),
				]);
		load.then(([rows, ...extra]) => {
			const rows2 = dual ? extra[0] : undefined;
			if (cancelled || !plotDiv.current) return;
			plotRef.current?.destroy();
			plotRef.current = null;
			if (rows.length > 0) {
				// ponytail: a loop instead of Math.min(...vals) — the spread blows up
				// with large arrays (RangeError: Maximum call stack size exceeded)
				let min = Infinity;
				let max = -Infinity;
				let sum = 0;
				for (const r of rows) {
					if (r.value < min) min = r.value;
					if (r.value > max) max = r.value;
					sum += r.value;
				}
				setStats({ min, max, avg: sum / rows.length, n: rows.length });
			} else {
				setStats(null);
				return;
			}
			let data: uPlot.AlignedData;
			if (dual) {
				// both metrics arrive in the same packet ⇒ same ts, direct join
				const byTs = new Map((rows2 ?? []).map((r) => [r.ts, r.value]));
				data = [
					rows.map((r) => r.ts / 1000),
					rows.map((r) => r.value),
					rows.map((r) => byTs.get(r.ts) ?? null),
				];
			} else if (compare.length === 0) {
				data = [rows.map((r) => r.ts / 1000), rows.map((r) => r.value)];
			} else {
				// Each node transmits when it feels like it, so timestamps don't line
				// up: the X axis is the union of all of them, with a null gap where a
				// node didn't measure. spanGaps joins the gaps so lines aren't shredded.
				const all = [rows, ...extra];
				const xs = [...new Set(all.flatMap((rs) => rs.map((r) => r.ts)))].sort(
					(a, b) => a - b,
				);
				data = [
					xs.map((ts) => ts / 1000),
					...all.map((rs) => {
						const byTs = new Map(rs.map((r) => [r.ts, r.value]));
						return xs.map((ts) => byTs.get(ts) ?? null);
					}),
				] as uPlot.AlignedData;
			}
			plotRef.current = new uPlot(
				{
					...plotSize(plotDiv.current),
					series: [
						{},
						{
							label: dual
								? t("UTIL. CANAL (%)")
								: compare.length > 0
									? shortName(effectiveNode)
									: (LABELS[metric] ?? metric),
							stroke: fg(),
							width: 2,
							points: { show: false },
							spanGaps: true,
						},
						...(dual
							? [
									{
										label: t("AIRE TX (%)"),
										stroke: accent(),
										width: 2,
										points: { show: false },
									},
								]
							: compare.map((n, i) => ({
									label: shortName(n),
									stroke: seriesColors()[i % SERIES_MAX],
									width: 2,
									points: { show: false },
									spanGaps: true,
								}))),
					],
					axes: [
						{
							stroke: fg("88"),
							grid: { stroke: fg("22"), dash: [2, 6] },
							ticks: { stroke: fg("44") },
							font: "11px JetBrains Mono",
						},
						{
							stroke: fg("88"),
							grid: { stroke: fg("22"), dash: [2, 6] },
							ticks: { stroke: fg("44") },
							font: "11px JetBrains Mono",
						},
					],
					legend: { show: dual || compare.length > 0 },
				},
				data,
				plotDiv.current,
			);
		});
		return () => {
			cancelled = true;
		};
		// `tick` is deliberately absent: it fires every 10 s and rebuilding the
		// plot on it threw away the reader's cursor and zoom four times a minute.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [effectiveNode, metric, days, compare, tema, idioma]);

	// The plot is a canvas: it is sized in pixels once and would otherwise keep
	// its first size through a window resize, an orientation change, or the
	// panel next to it wrapping away on a phone.
	useEffect(() => {
		const box = plotDiv.current;
		if (!box || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			plotRef.current?.setSize(plotSize(box));
		});
		ro.observe(box);
		return () => ro.disconnect();
	}, []);

	useEffect(() => () => plotRef.current?.destroy(), []);

	// CSV in long format (one row per sample) instead of one column per node:
	// nodes don't share timestamps, so the wide format would be full of holes.
	// Any spreadsheet can pivot it if needed.
	const onExportCsv = async () => {
		if (effectiveNode === undefined || !metric) return;
		setExporting(true);
		setCsvMsg("");
		try {
			const since = Date.now() - days * 86_400_000;
			const realMetric = metric === CHANNEL ? "channelUtilization" : metric;
			const targets = [effectiveNode, ...compare];
			const series = await Promise.all(
				targets.map((n) => teleLoad(n, realMetric, since)),
			);
			const rows = ["iso_date,epoch_ms,node,node_id,metric,value"];
			targets.forEach((num, i) => {
				// quote the name: it could contain commas and break the CSV
				const name = `"${shortName(num).replace(/"/g, '""')}"`;
				for (const r of series[i]) {
					rows.push(
						`${new Date(r.ts).toISOString()},${r.ts},${name},!${num.toString(16)},${realMetric},${r.value}`,
					);
				}
			});
			const path = await saveText(
				`meshcore-${realMetric}-${stamp()}.csv`,
				rows.join("\n"),
			);
			setCsvMsg(path ? t("EXPORTADO → {0}", path) : "");
		} catch (e) {
			setCsvMsg(t("ERROR: {0}", String(e)));
		} finally {
			setExporting(false);
		}
	};

	const nodeLabel =
		effectiveNode !== undefined
			? (s.nodes.get(effectiveNode)?.shortName ?? effectiveNode)
			: "—";
	const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

	if (link.status === "linked") {
		return (
			<main style={{ flexDirection: "column" }}>
				<ThisDevicePanel />
				<DeckTrend />
			</main>
		);
	}

	return (
		<main style={{ flexDirection: "column" }}>
			<ThisDevicePanel />
			<div
				style={{
					display: "flex",
					gap: 10,
					alignItems: "center",
					flexShrink: 0,
				}}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					{t("TELEMETRÍA //")}
				</span>
				<select
					value={effectiveNode ?? ""}
					onChange={(e) => setNode(Number(e.target.value))}
				>
					{nodes.length === 0 && (
						<option value="">{t("SIN DATOS DE TELEMETRÍA")}</option>
					)}
					{nodes.map((n) => (
						<option key={n.num} value={n.num}>
							{n.shortName} · !{n.num.toString(16)}
						</option>
					))}
				</select>
				<select value={metric} onChange={(e) => setMetric(e.target.value)}>
					{metrics.length === 0 && (
						<option value="">{t("SIN MÉTRICAS")}</option>
					)}
					{metrics.map((m) => (
						<option key={m} value={m}>
							{LABELS[m] ?? m.toUpperCase()}
						</option>
					))}
				</select>

				<select
					value=""
					title={t("Añadir otro nodo a la misma gráfica")}
					disabled={compare.length >= SERIES_MAX}
					onChange={(e) => {
						const n = Number(e.target.value);
						if (n) setCompare((c) => (c.includes(n) ? c : [...c, n]));
					}}
				>
					<option value="">
						{compare.length >= SERIES_MAX
							? t("MÁXIMO {0}", SERIES_MAX)
							: t("+ COMPARAR")}
					</option>
					{nodes
						.filter((n) => n.num !== effectiveNode && !compare.includes(n.num))
						.map((n) => (
							<option key={n.num} value={n.num}>
								{n.shortName} · !{n.num.toString(16)}
							</option>
						))}
				</select>
				{compare.map((n, i) => (
					<button
						key={n}
						style={{
							fontSize: 10,
							padding: "0 6px",
							borderColor: seriesColors()[i % SERIES_MAX],
							color: seriesColors()[i % SERIES_MAX],
						}}
						title={t("Quitar de la comparación")}
						onClick={() => setCompare((c) => c.filter((x) => x !== n))}
					>
						{shortName(n)} ✕
					</button>
				))}
				<div style={{ display: "flex", gap: 4 }}>
					{RANGES.map(([label, d]) => (
						<button
							key={label}
							className={days === d ? "tab active" : "tab"}
							onClick={() => setDays(d)}
						>
							{label}
						</button>
					))}
				</div>
				<span className="spacer" />
				<button
					style={{ fontSize: 10, padding: "0 6px" }}
					title={t("Exportar a CSV lo que se ve en la gráfica")}
					disabled={!stats || exporting}
					onClick={onExportCsv}
				>
					{t("⭳ CSV")}
				</button>
				<span
					className={csvMsg.startsWith("ERROR") ? "err" : "dim"}
					style={{ fontSize: 11 }}
				>
					{csvMsg || (stats ? t("{0} MUESTRAS", stats.n) : t("SIN DATOS"))}
				</span>
			</div>

			{/* wraps on a phone: a 200 px stats column beside the chart leaves the
			    chart a sliver, and neither is readable */}
			<div
				style={{
					flex: 1,
					display: "flex",
					gap: 12,
					minHeight: 0,
					flexWrap: "wrap",
				}}
			>
				{/* the chart absorbs all the free width, so the stats column stays at
				    its 200 px basis on desktop and only widens once it has wrapped */}
				<div className="panel" style={{ flex: "999 1 320px", minWidth: 0 }}>
					<div className="panel-title">
						{t("GRÁFICA")} // {nodeLabel}
						{compare.length > 0 && ` + ${compare.map(shortName).join(" + ")}`} ·{" "}
						{LABELS[metric] ?? (metric || "—")}
					</div>
					<div
						className="scroll-y"
						style={{
							padding: 14,
							position: "relative",
						}}
					>
						{!stats && (
							<p className="dim" style={{ position: "absolute" }}>
								{t(
									"NO DATA — la telemetría se acumula mientras la app está conectada_",
								)}
							</p>
						)}
						{/* ponytail: div dedicado a uPlot, SIN hijos de React — si React
                y uPlot comparten contenedor, removeChild casca y tumba la app.
                minHeight: once the panes have stacked on a phone the parent's
                height comes from its content, so a bare height:100% would
                resolve to whatever the canvas already is and the observer
                would walk the plot down to nothing. */}
						<div
							ref={plotDiv}
							style={{ width: "100%", height: "100%", minHeight: 248 }}
						/>
					</div>
				</div>

				<div
					style={{
						flex: "1 1 200px",
						minWidth: 200,
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					{compare.length > 0 && (
						<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
							{t("SOLO DE {0}", nodeLabel)}
						</span>
					)}
					{(
						[
							["MIN", stats?.min],
							["MAX", stats?.max],
							["AVG", stats?.avg],
						] as [string, number | undefined][]
					).map(([label, v]) => (
						<div key={label} className="panel stat-tile">
							<div className="label">{label}</div>
							<div className="value">{v !== undefined ? fmt(v) : "—"}</div>
						</div>
					))}
					<div
						style={{
							flex: 1,
							border: "1px dashed var(--border)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 12,
							textAlign: "center",
						}}
					>
						<span className="dim" style={{ fontSize: 10, letterSpacing: 1 }}>
							{t("MUESTREO PASIVO —")}
							<br />
							{t("SE GUARDA TODO LO")}
							<br />
							{t("QUE EMITE LA MALLA")}
						</span>
					</div>
				</div>
			</div>
		</main>
	);
}
