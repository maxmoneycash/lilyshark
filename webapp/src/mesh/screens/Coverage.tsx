import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
	type Anchor,
	buildCoverage,
	type CellRecord,
	cellKey,
	classifyDocument,
	densityOpacity,
	type MostWantedDoc,
	parseAnchors,
	parseCellRecords,
	parseMostWanted,
	parseScore,
	type RecencyBucket,
	type ScoreDoc,
	SEASON_0,
	SOURCE_LABELS,
	type SourceKind,
} from "../../lib/coverage.ts";
import { EXAMPLE_DOCUMENTS, EXAMPLE_LABEL } from "../../lib/coverageExample.ts";
import { decodeGeohash, geohashSpanKm } from "../../lib/geohash.ts";
import { accent, fg, useThemeTick } from "../theme";

/**
 * COVERAGE — where the season has been surveyed, and where it has not.
 *
 * Hivemapper's gap map and Flightradar24's most-wanted receiver list are the
 * same mechanism: publish the holes so effort goes to them. This screen is
 * that for Field Receipts, and it runs entirely on documents the season
 * scorer publishes — scripts/field_receipts_score.py `score` and
 * `most-wanted`, plus the two public input files they are run over. There
 * is no coverage backend: whatever this screen shows, a reader can re-derive
 * by running the same script over the same JSON.
 *
 * Two things this screen refuses to do. It does not invent cells — Season 0
 * opens 2026-10-01, so with nothing loaded it says exactly that instead of
 * drawing a plausible map. And it never presents the bundled example as
 * season data: EXAMPLE_LABEL rides on the map, the list and the source
 * table for as long as a synthetic byte is loaded.
 */

/** Cell outline per recency bucket. The colour is the theme's; the dash is not. */
const DASH: Record<RecencyBucket, string | undefined> = {
	current: undefined,
	recent: undefined,
	aging: "5 4",
	stale: "2 5",
};
const STROKE_ALPHA: Record<RecencyBucket, string> = {
	current: "",
	recent: "cc",
	aging: "99",
	stale: "77",
};
const RECENCY_LABEL: Record<RecencyBucket, string> = {
	current: "THIS WEEK",
	recent: "RECENT",
	aging: "AGING",
	stale: "STALE",
};

interface LoadedSource {
	kind: SourceKind;
	name: string;
	detail: string;
	synthetic: boolean;
}

const shortAddr = (a: string) =>
	a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a;

/** Popups are built as HTML and every value in them came out of a loaded
 *  file, so nothing reaches innerHTML unescaped. */
const esc = (value: string | number) =>
	String(value).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c] ?? c,
	);

export default function Coverage() {
	const themeTick = useThemeTick();
	const divRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<L.Map | null>(null);
	const layerRef = useRef<L.LayerGroup | null>(null);
	const fittedRef = useRef(false);

	const [sources, setSources] = useState<LoadedSource[]>([]);
	const [records, setRecords] = useState<CellRecord[] | undefined>();
	const [anchors, setAnchors] = useState<Map<string, Anchor> | undefined>();
	const [mostWanted, setMostWanted] = useState<MostWantedDoc | undefined>();
	const [score, setScore] = useState<ScoreDoc | undefined>();
	const [band, setBand] = useState("ALL");
	const [selected, setSelected] = useState<string | undefined>();
	const [err, setErr] = useState("");
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);

	const synthetic = sources.some((s) => s.synthetic);
	const model = useMemo(
		() => buildCoverage({ records, anchors, mostWanted }),
		[records, anchors, mostWanted],
	);
	const cells = useMemo(
		() => model.cells.filter((c) => band === "ALL" || c.band === band),
		[model, band],
	);
	const wanted = useMemo(
		() => model.wanted.filter((w) => band === "ALL" || w.band === band),
		[model, band],
	);
	const empty = model.cells.length === 0 && model.wanted.length === 0;
	const selectedCell = model.cells.find((c) => c.key === selected);
	const selectedWanted = model.wanted.find(
		(w) => cellKey(w.geohash5, w.band) === selected,
	);

	/** One document in, classified by shape and parsed, or a named error out. */
	const ingest = (name: string, doc: unknown, isSynthetic: boolean) => {
		const kind = classifyDocument(doc);
		let detail = "";
		if (kind === "cell-records") {
			const parsed = parseCellRecords(doc);
			setRecords(parsed);
			detail = `${parsed.length} records`;
		} else if (kind === "events") {
			const parsed = parseAnchors(doc);
			setAnchors(parsed);
			detail = `${parsed.size} anchored captures`;
		} else if (kind === "most-wanted") {
			const parsed = parseMostWanted(doc);
			setMostWanted(parsed);
			detail = `${parsed.rows.length} cells · week ${parsed.asOfWeek}`;
		} else {
			const parsed = parseScore(doc);
			setScore(parsed);
			detail = `${parsed.standings.length} accounts · ${parsed.discrepancyCount} discrepancies`;
		}
		setSources((prev) => [
			...prev.filter((s) => s.kind !== kind),
			{ kind, name, detail, synthetic: isSynthetic },
		]);
	};

	const ingestAll = (
		documents: { name: string; doc: unknown }[],
		isSynthetic: boolean,
	) => {
		for (const { name, doc } of documents) {
			try {
				ingest(name, doc, isSynthetic);
			} catch (e) {
				setErr(`${name}: ${e instanceof Error ? e.message : String(e)}`);
				return false;
			}
		}
		return true;
	};

	const onFiles = async (list: FileList | null) => {
		if (!list || list.length === 0) return;
		setErr("");
		setBusy(true);
		try {
			const documents: { name: string; doc: unknown }[] = [];
			for (const file of Array.from(list)) {
				try {
					documents.push({
						name: file.name,
						doc: JSON.parse(await file.text()),
					});
				} catch (e) {
					setErr(`${file.name}: not JSON — ${String(e)}`);
					return;
				}
			}
			if (ingestAll(documents, false)) setErr("");
		} finally {
			setBusy(false);
		}
	};

	const onFetch = async () => {
		const target = url.trim();
		if (!target) return;
		setErr("");
		setBusy(true);
		try {
			const res = await fetch(target);
			if (!res.ok) {
				setErr(`${target}: HTTP ${res.status}`);
				return;
			}
			if (ingestAll([{ name: target, doc: await res.json() }], false))
				setErr("");
		} catch (e) {
			setErr(`${target}: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const loadExample = () => {
		setErr("");
		fittedRef.current = false;
		ingestAll([...EXAMPLE_DOCUMENTS], true);
	};

	const clearAll = () => {
		setSources([]);
		setRecords(undefined);
		setAnchors(undefined);
		setMostWanted(undefined);
		setScore(undefined);
		setSelected(undefined);
		setBand("ALL");
		setErr("");
		fittedRef.current = false;
	};

	// The map itself, created once. Same construction as the TACTICAL MAP
	// screen: OSM tiles recoloured by the theme, and a ResizeObserver because
	// Leaflet caches the container size at creation.
	useEffect(() => {
		if (!divRef.current || mapRef.current) return;
		const map = L.map(divRef.current, { zoomControl: true }).setView(
			[20, 0],
			2,
		);
		L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
			attribution: "© OpenStreetMap",
		}).addTo(map);
		layerRef.current = L.layerGroup().addTo(map);
		mapRef.current = map;
		const ro = new ResizeObserver(() => map.invalidateSize());
		ro.observe(divRef.current);
		return () => {
			ro.disconnect();
			map.remove();
			mapRef.current = null;
			layerRef.current = null;
			fittedRef.current = false;
		};
	}, []);

	// Cells. Surveyed cells are boxes in the theme colour, their fill rising
	// with how many verified captures the cell holds and their outline fading
	// and breaking as the last survey recedes. Most-wanted cells are drawn in
	// the second colour, dashed and unfilled, with their rank on the box —
	// they are a gap, not a measurement, and must not look like one.
	// fg()/accent() read the theme through globals rather than props, so
	// themeTick is what tells this pass a repaint is due: Leaflet paths do not
	// restyle themselves when the CSS variables change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: themeTick is the repaint signal, not a value read
	useEffect(() => {
		const layer = layerRef.current;
		const map = mapRef.current;
		if (!layer || !map) return;
		layer.clearLayers();
		const ink = fg();
		const mark = accent();

		const boxOf = (geohash5: string) => {
			const b = decodeGeohash(geohash5);
			return L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax]);
		};

		for (const cell of cells) {
			const colour = ink + STROKE_ALPHA[cell.recency];
			const rect = L.rectangle(boxOf(cell.geohash5), {
				color: colour,
				weight: cell.key === selected ? 3 : 1.5,
				dashArray: DASH[cell.recency],
				fillColor: ink,
				fillOpacity: densityOpacity(cell.density),
			}).addTo(layer);
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">CELL ${esc(cell.geohash5)} · ${esc(cell.band)}</div>` +
				`<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin-top:4px;">` +
				`<span style="opacity:.85;">SURVEYS</span><span>${cell.observations} verified · ${cell.weeks.length} weeks</span>` +
				`<span style="opacity:.85;">LAST</span><span>${esc(cell.lastWeek)} · ${RECENCY_LABEL[cell.recency]}</span>` +
				`<span style="opacity:.85;">FIRST</span><span>${esc(cell.firstWeek)}${
					cell.firstSurveyedBy
						? ` · ${esc(cell.firstSurveyedBy)}`
						: " · unattributed"
				}</span>` +
				`<span style="opacity:.85;">ADJACENT</span><span>${cell.adjacentActiveCells} active neighbours</span>` +
				`</div>` +
				(synthetic
					? `<div style="margin-top:6px;letter-spacing:1px;">${EXAMPLE_LABEL}</div>`
					: "");
			rect.bindPopup(box);
			rect.on("click", () => setSelected(cell.key));
		}

		for (const cell of wanted) {
			const rect = L.rectangle(boxOf(cell.geohash5), {
				color: mark,
				weight: cellKey(cell.geohash5, cell.band) === selected ? 3 : 2,
				dashArray: "6 4",
				fillColor: mark,
				fillOpacity: 0.06,
			}).addTo(layer);
			rect.bindTooltip(`#${cell.rank}`, {
				permanent: cell.rank <= 5,
				direction: "center",
			});
			const box = document.createElement("div");
			box.innerHTML =
				`<div style="font-size:10px;letter-spacing:2px;opacity:.85;">MOST WANTED #${cell.rank}</div>` +
				`<div style="font-weight:700;margin:4px 0;">${esc(cell.geohash5)} · ${esc(cell.band)}</div>` +
				`<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px;">` +
				`<span style="opacity:.85;">ADJACENT</span><span>${cell.adjacentActiveCells} active neighbours</span>` +
				`<span style="opacity:.85;">LAST</span><span>${
					cell.lastSurveyedWeek
						? `${esc(cell.lastSurveyedWeek)} · ${cell.staleWeeks} weeks ago`
						: "never surveyed"
				}</span>` +
				`</div>` +
				(synthetic
					? `<div style="margin-top:6px;letter-spacing:1px;">${EXAMPLE_LABEL}</div>`
					: "");
			rect.bindPopup(box);
			rect.on("click", () => setSelected(cellKey(cell.geohash5, cell.band)));
		}

		const all = [
			...cells.map((c) => c.geohash5),
			...wanted.map((w) => w.geohash5),
		];
		if (!fittedRef.current && all.length > 0) {
			let bounds = boxOf(all[0]);
			for (const geohash5 of all.slice(1))
				bounds = bounds.extend(boxOf(geohash5));
			map.fitBounds(bounds.pad(0.25));
			fittedRef.current = true;
		}
	}, [cells, wanted, selected, synthetic, themeTick]);

	// Picking a row centres its cell without refitting everything else.
	useEffect(() => {
		const map = mapRef.current;
		if (!map || !selected) return;
		const geohash5 = selected.split("/")[0];
		const b = decodeGeohash(geohash5);
		map.setView(
			[(b.latMin + b.latMax) / 2, (b.lonMin + b.lonMax) / 2],
			Math.max(map.getZoom(), 10),
		);
	}, [selected]);

	const spanned = selectedCell ?? selectedWanted;
	const span = spanned ? geohashSpanKm(spanned.geohash5) : undefined;

	return (
		<main className="map-main">
			<div className="panel" style={{ flex: 1 }}>
				<div className="panel-title">
					<span>
						{"PANEL // COVERAGE CELLS"}
						{model.asOfWeek ? ` · WEEK ${model.asOfWeek}` : ""} ·{" "}
						{model.cells.length} SURVEYED · {model.activeCells} ACTIVE ·{" "}
						{model.wanted.length} MOST WANTED
					</span>
					<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
						{synthetic && <span className="sim-badge">{EXAMPLE_LABEL}</span>}
						{model.bands.length > 1 && (
							<select
								value={band}
								onChange={(e) => setBand(e.target.value)}
								style={{ fontSize: 10 }}
							>
								<option value="ALL">ALL BANDS</option>
								{model.bands.map((b) => (
									<option key={b} value={b}>
										{b}
									</option>
								))}
							</select>
						)}
					</span>
				</div>
				<div className="map-wrap">
					<div ref={divRef} style={{ height: "100%" }} />
					{empty && sources.length > 0 && (
						<div className="panel map-wait">
							<div className="panel-title">NO CELLS IN THESE DOCUMENTS</div>
							<div className="map-wait-body">
								<p>
									What is loaded carries no cells. The <code>score</code> output
									is standings per account — it has no geohash in it at all. The
									cells come from the <code>--cells</code> records file, and the
									gap list from the <code>most-wanted</code> output; load those
									alongside it.
								</p>
							</div>
						</div>
					)}
					{empty && sources.length === 0 && (
						<div className="panel map-wait">
							<div className="panel-title">NO SEASON DATA</div>
							<div className="map-wait-body">
								<p>
									Season 0 opens <strong>{SEASON_0.opensUtc} 00:00 UTC</strong>{" "}
									and closes {SEASON_0.closesUtc}. No season has been scored
									yet, so there is no coverage to draw. This screen does not
									invent cells and will stay empty until a scorer output is
									loaded.
								</p>
								<p>
									Load one on the right: the <code>most-wanted</code> JSON for
									the gap list, the <code>--cells</code> records file for
									surveyed cells, and the <code>--events</code> file so each
									record can be checked against the anchor that pays for it.
									Everything is parsed in this browser; nothing is uploaded.
								</p>
								<p>
									To see the shape of the screen before then, load the bundled
									example. It is invented data run through the real scorer, and
									it is labelled {EXAMPLE_LABEL} wherever it appears.
								</p>
							</div>
						</div>
					)}
					<div className="map-hud" style={{ right: 10, top: 8 }}>
						{model.cells.length > 0 && (
							<>
								FILL = VERIFIED CAPTURES · OUTLINE = RECENCY ·{" "}
								<span style={{ color: accent() }}>DASHED = MOST WANTED</span> ·{" "}
							</>
						)}
						TILES © OSM
					</div>
					<div
						className="map-hud"
						style={{ left: 10, bottom: 10, maxWidth: 520 }}
					>
						Cells are geohash-5, about {span ? span.widthKm.toFixed(1) : "5"} ×{" "}
						{span ? span.heightKm.toFixed(1) : "4.9"} km. That coarseness is the
						privacy feature: no per-frame GPS is published, only the cell.
					</div>
				</div>
			</div>

			<div className="panel" style={{ width: 380, flexShrink: 0 }}>
				<div className="panel-title">
					<span>SOURCES</span>
					{sources.length > 0 && (
						<button
							type="button"
							style={{ fontSize: 10, padding: "0 6px" }}
							onClick={clearAll}
						>
							[ CLEAR ]
						</button>
					)}
				</div>
				<div className="scroll-y">
					<div style={{ padding: "8px 12px", display: "grid", gap: 8 }}>
						<span className="dim" style={{ fontSize: 11 }}>
							Published scorer JSON only. Files are read in this browser.
						</span>
						<input
							type="file"
							accept="application/json,.json"
							multiple
							disabled={busy}
							onChange={(e) => {
								void onFiles(e.target.files);
								e.target.value = "";
							}}
							style={{ fontSize: 11 }}
						/>
						<div style={{ display: "flex", gap: 6 }}>
							<input
								placeholder="https://… or /path/to/most-wanted.json"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void onFetch();
								}}
								style={{ flex: 1, fontSize: 11, minWidth: 0 }}
							/>
							<button
								type="button"
								disabled={busy || !url.trim()}
								onClick={() => void onFetch()}
							>
								[ FETCH ]
							</button>
						</div>
						<button type="button" onClick={loadExample} disabled={busy}>
							[ LOAD BUNDLED EXAMPLE ]
						</button>
						{err && <span className="err">{err}</span>}
					</div>

					{sources.length > 0 && (
						<div className="kv">
							{sources.map((s) => (
								<SourceRow key={s.kind} source={s} />
							))}
							{records && (
								<>
									<span
										className={
											model.verification === "anchored" ? "k" : "k warn"
										}
									>
										CELLS
									</span>
									<span
										className={
											model.verification === "anchored" ? "v" : "v warn"
										}
									>
										{model.verification === "anchored"
											? `anchor-checked · ${model.unanchoredRecords} record(s) refused`
											: "UNCHECKED — load the events file to check each record against its anchor"}
									</span>
								</>
							)}
							{score && (
								<>
									<span className="k">STANDINGS</span>
									<span className="v">
										{score.standings.length} accounts · {score.discrepancyCount}{" "}
										discrepancies
										{score.rulesSeason ? ` · ${score.rulesSeason}` : ""}
									</span>
								</>
							)}
							{mostWanted?.rulesSha256 && (
								<>
									<span className="k">RULES</span>
									<span className="v" style={{ wordBreak: "break-all" }}>
										{mostWanted.rulesSha256.slice(0, 16)}…
									</span>
								</>
							)}
						</div>
					)}

					<div className="panel-title">
						<span>MOST WANTED</span>
						{synthetic && <span className="sim-badge">{EXAMPLE_LABEL}</span>}
					</div>
					{wanted.length === 0 ? (
						<div className="panel-foot dim">
							{sources.length === 0
								? "nothing loaded yet"
								: "no most-wanted output loaded — run the scorer's most-wanted command over the same inputs"}
						</div>
					) : (
						<table className="grid">
							<thead>
								<tr>
									<th>#</th>
									<th>CELL</th>
									<th>BAND</th>
									<th style={{ textAlign: "right" }}>ADJ</th>
									<th>LAST</th>
								</tr>
							</thead>
							<tbody>
								{wanted.map((w) => {
									const key = cellKey(w.geohash5, w.band);
									return (
										<tr
											key={key}
											tabIndex={0}
											aria-selected={key === selected}
											className={key === selected ? "sel" : undefined}
											onClick={() => setSelected(key)}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault();
													setSelected(key);
												}
											}}
										>
											<td>{w.rank}</td>
											<td>{w.geohash5}</td>
											<td>{w.band}</td>
											<td style={{ textAlign: "right" }}>
												{w.adjacentActiveCells}
											</td>
											<td className={w.lastSurveyedWeek ? "warn" : "dim"}>
												{w.lastSurveyedWeek ?? "never"}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}

					{(selectedCell || selectedWanted) && (
						<>
							<div className="panel-title">
								<span>CELL DETAIL</span>
								{synthetic && (
									<span className="sim-badge">{EXAMPLE_LABEL}</span>
								)}
							</div>
							<div className="kv">
								<span className="k">CELL</span>
								<span className="v">
									{spanned?.geohash5} · {spanned?.band}
								</span>
								{selectedCell ? (
									<>
										<span className="k">FIRST SURVEYED</span>
										<span className="v">
											{selectedCell.firstWeek}
											{selectedCell.firstSurveyedBy ? (
												<>
													{" by "}
													<span title={selectedCell.firstSurveyedBy}>
														{shortAddr(selectedCell.firstSurveyedBy)}
													</span>
												</>
											) : (
												<span className="warn">
													{" "}
													· unattributed without the events file
												</span>
											)}
										</span>
										<span className="k">LAST SURVEYED</span>
										<span className="v">
											{selectedCell.lastWeek} ·{" "}
											{RECENCY_LABEL[selectedCell.recency]}
											{selectedCell.staleWeeks > 0
												? ` · ${selectedCell.staleWeeks} weeks ago`
												: ""}
										</span>
										<span className="k">VERIFIED CAPTURES</span>
										<span className="v">
											{selectedCell.observations} over{" "}
											{selectedCell.weeks.length} week(s):{" "}
											{selectedCell.weeks.join(", ")}
										</span>
										<span className="k">ADJACENCY</span>
										<span className="v">
											{selectedCell.adjacentActiveCells} active neighbours
										</span>
									</>
								) : (
									<>
										<span className="k warn">STATUS</span>
										<span className="v warn">
											most wanted #{selectedWanted?.rank} ·{" "}
											{selectedWanted?.lastSurveyedWeek
												? `stale since ${selectedWanted.lastSurveyedWeek}`
												: "never surveyed"}
										</span>
										<span className="k">ADJACENCY</span>
										<span className="v">
											{selectedWanted?.adjacentActiveCells} active neighbours
										</span>
									</>
								)}
								<span className="k">BOX</span>
								<span className="v">
									{span
										? `${span.widthKm.toFixed(1)} × ${span.heightKm.toFixed(1)} km`
										: "—"}
								</span>
							</div>
						</>
					)}

					<div className="panel-title">WHY THE CELLS ARE COARSE</div>
					<div className="map-wait-body">
						<p>
							A cell is geohash-5 × band × ISO week (docs/protocol/season-0.md).
							Geohash-5 is about 5 km across, and that is the point: a receipt
							says a band was heard somewhere in a 5 km box in a given week, not
							where the receiver stood. No per-frame GPS is published — the
							capture's position context never leaves the blob at finer
							resolution than the cell.
						</p>
						<p>
							Coarse cells still support the scoring they need to: first survey
							in a cell, re-survey decay, and the adjacency that makes a
							neighbouring gap most wanted. They do not support following a
							contributor around, which is the trade this protocol picks on
							purpose.
						</p>
					</div>
				</div>
			</div>
		</main>
	);
}

/** One loaded document, as a key/value row pair in the sources block. */
function SourceRow({ source }: { source: LoadedSource }) {
	return (
		<>
			<span className="k">{SOURCE_LABELS[source.kind]}</span>
			<span className="v">
				<span style={{ wordBreak: "break-all" }}>{source.name}</span>
				<span className="dim"> · {source.detail}</span>
				{source.synthetic && (
					<>
						{" "}
						<span className="sim-badge">{EXAMPLE_LABEL}</span>
					</>
				)}
			</span>
		</>
	);
}
