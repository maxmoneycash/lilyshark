import { useEffect, useRef, useState } from "react";
import {
	setSweeping,
	useDeviceLink,
} from "../../lib/deviceLink";
import {
	binCenterHz,
	dbRange,
	fmtMHz,
	freqTicks,
	hexToRgb,
	peakBin,
	powerToUnit,
	SPECTRUM_HISTORY_LIMIT,
	updatePeakHold,
} from "../../lib/spectrum";
import { accent, fg, useThemeTick } from "../theme";

/** A sweep line landed this recently ⇒ the deck is sweeping right now. The
 *  button and the notes derive from real data flow, not from what we asked
 *  for, so a firmware that ignored the command cannot leave the screen lying. */
const SWEEP_FRESH_MS = 3000;
/** How long after START before "nothing arrived" is worth saying. */
const SWEEP_SILENT_MS = 5000;

const TRACE_HEIGHT = 150;

export default function Spectrum() {
	const link = useDeviceLink();
	// Both canvases paint with fg()/accent(), which no CSS var repaints.
	const themeTick = useThemeTick();
	const traceRef = useRef<HTMLCanvasElement>(null);
	const waterRef = useRef<HTMLCanvasElement>(null);
	const waterBoxRef = useRef<HTMLDivElement>(null);
	// Peak hold lives in a ref: it must survive re-renders without triggering
	// them. `uptoMs` marks how far into the ring the trace has folded, so
	// CLEAR PEAKS truly forgets — a redraw that refolded the whole ring would
	// resurrect every burst still in the waterfall history.
	const peakRef = useRef<{ db?: number[]; uptoMs: number }>({ uptoMs: 0 });
	const [peakEpoch, setPeakEpoch] = useState(0);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState("");
	// When START was pressed, so silence afterwards can be reported.
	const [startedAt, setStartedAt] = useState<number | undefined>();
	const [size, setSize] = useState({ w: 0, h: 0 });
	const [, setTick] = useState(0);

	const linked = link.status === "linked";
	const sweeps = link.sweeps;
	const latest = sweeps[sweeps.length - 1];
	const active = latest !== undefined && Date.now() - latest.atMs < SWEEP_FRESH_MS;

	// One tick a second while linked: freshness (`active`) and the silence note
	// are clock-driven, and nothing else re-renders this screen between lines.
	useEffect(() => {
		if (!linked) return;
		const id = setInterval(() => setTick((v) => v + 1), 1000);
		return () => clearInterval(id);
	}, [linked]);

	// A drop clears the sweeps in the link store; the peak trace and the
	// pressed-START marker refer to that same data and go with it.
	useEffect(() => {
		if (!linked) {
			peakRef.current = { uptoMs: 0 };
			setStartedAt(undefined);
		}
	}, [linked]);

	useEffect(() => {
		const box = waterBoxRef.current;
		if (!box || typeof ResizeObserver === "undefined") return;
		const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(box);
		return () => ro.disconnect();
	}, []);

	// Redraw both canvases from the ring. Full redraws keep the code obvious;
	// at 240 rows the ImageData build is far below one frame.
	useEffect(() => {
		const trace = traceRef.current;
		const water = waterRef.current;
		if (!trace || !water || size.w === 0) return;
		trace.width = size.w;
		trace.height = TRACE_HEIGHT;
		water.width = size.w;
		water.height = Math.max(1, size.h);
		const tctx = trace.getContext("2d");
		const wctx = water.getContext("2d");
		if (!tctx || !wctx) return;
		tctx.clearRect(0, 0, trace.width, trace.height);
		wctx.clearRect(0, 0, water.width, water.height);
		if (sweeps.length === 0) return;

		// Fold the ring's unseen tail into the peak trace. On first mount
		// uptoMs is 0, so sweeps that arrived while this screen was unmounted
		// are caught up in one pass.
		const bins = sweeps[sweeps.length - 1].db.length;
		let peak = peakRef.current.db;
		if (peak && peak.length !== bins) peak = undefined;
		for (const s of sweeps) {
			if (s.atMs <= peakRef.current.uptoMs) continue;
			peak = updatePeakHold(peak, s.db);
		}
		peakRef.current = { db: peak, uptoMs: sweeps[sweeps.length - 1].atMs };

		const { minDb, maxDb } = dbRange(sweeps);
		const rgb = hexToRgb(fg());

		// ── top: the latest pass and the peak hold as lines ──
		const w = trace.width;
		const h = trace.height;
		const pad = 4;
		const y = (db: number) => h - pad - powerToUnit(db, minDb, maxDb) * (h - pad * 2);
		const x = (i: number) => ((i + 0.5) / bins) * w;
		tctx.strokeStyle = fg("22");
		tctx.setLineDash([2, 6]);
		tctx.lineWidth = 1;
		for (const frac of [0.25, 0.5, 0.75]) {
			tctx.beginPath();
			tctx.moveTo(0, h * frac);
			tctx.lineTo(w, h * frac);
			tctx.stroke();
		}
		tctx.setLineDash([]);
		if (peak && peak.length === bins) {
			tctx.strokeStyle = accent();
			tctx.setLineDash([3, 3]);
			tctx.beginPath();
			peak.forEach((db, i) => {
				if (i === 0) tctx.moveTo(x(i), y(db));
				else tctx.lineTo(x(i), y(db));
			});
			tctx.stroke();
			tctx.setLineDash([]);
		}
		tctx.strokeStyle = fg();
		tctx.lineWidth = 1.5;
		tctx.beginPath();
		sweeps[sweeps.length - 1].db.forEach((db, i) => {
			if (i === 0) tctx.moveTo(x(i), y(db));
			else tctx.lineTo(x(i), y(db));
		});
		tctx.stroke();
		tctx.fillStyle = fg("88");
		tctx.font = "10px JetBrains Mono, monospace";
		tctx.fillText(`${maxDb} dBm`, 6, 12);
		tctx.fillText(`${minDb} dBm`, 6, h - 5);

		// ── bottom: the waterfall, newest row on top ──
		// Painted bin-by-row into an offscreen buffer, then stretched: alpha is
		// the power, so the canvas stays transparent and the panel shows
		// through as the noise floor in every theme.
		const rows = sweeps.length;
		const img = wctx.createImageData(bins, rows);
		for (let r = 0; r < rows; r++) {
			const sweep = sweeps[rows - 1 - r];
			for (let i = 0; i < bins; i++) {
				const o = (r * bins + i) * 4;
				img.data[o] = rgb.r;
				img.data[o + 1] = rgb.g;
				img.data[o + 2] = rgb.b;
				img.data[o + 3] = Math.round(
					powerToUnit(sweep.db[i], minDb, maxDb) * 255,
				);
			}
		}
		const off = document.createElement("canvas");
		off.width = bins;
		off.height = rows;
		off.getContext("2d")?.putImageData(img, 0, 0);
		wctx.imageSmoothingEnabled = false;
		// A partial history fills from the top at the same per-row height a
		// full one would have, so time never stretches to fit the box.
		const drawH = (rows / SPECTRUM_HISTORY_LIMIT) * water.height;
		wctx.drawImage(off, 0, 0, bins, rows, 0, 0, water.width, drawH);
	}, [sweeps, themeTick, size, peakEpoch]);

	const onToggle = async () => {
		setNote("");
		setBusy(true);
		try {
			await setSweeping(!active);
			setStartedAt(active ? undefined : Date.now());
		} catch (e) {
			setNote(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const peak = peakRef.current.db;
	const peakIdx = peak ? peakBin(peak) : -1;
	const silentTooLong =
		startedAt !== undefined && !active && Date.now() - startedAt > SWEEP_SILENT_MS;

	return (
		<main style={{ flexDirection: "column" }}>
			<div
				style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}
			>
				<span className="dim" style={{ fontSize: 10, letterSpacing: 2 }}>
					SPECTRUM // BAND SWEEP
				</span>
				<button
					className="primary"
					disabled={!linked || busy}
					title={
						linked
							? active
								? "Tell the T-Deck to stop sweeping and go back to listening for packets"
								: "Tell the T-Deck to sweep its band and stream the power it measures"
							: "Needs a T-Deck on the cable — use the CONNECT button in the header"
					}
					onClick={() => void onToggle()}
				>
					{active ? "STOP SWEEPING" : "START SWEEPING"}
				</button>
				<button
					disabled={!peak}
					title="Forget the loudest-seen trace and let it rebuild from the next pass"
					onClick={() => {
						// uptoMs stays: the ring rows already seen must not fold back in.
						peakRef.current = { uptoMs: peakRef.current.uptoMs };
						setPeakEpoch((v) => v + 1);
					}}
				>
					CLEAR PEAKS
				</button>
				{!linked && (
					<span className="dim" style={{ fontSize: 11 }}>
						No radio linked — connect a T-Deck over USB and the sweep runs on
						its radio.
					</span>
				)}
				{linked && active && (
					<span className="dim" style={{ fontSize: 11 }}>
						While it sweeps, the radio measures power instead of decoding
						packets.
					</span>
				)}
				{note && (
					<span className="err" style={{ fontSize: 11 }}>
						{note}
					</span>
				)}
				{!note && silentTooLong && (
					<span className="warn" style={{ fontSize: 11 }}>
						No sweep data arrived — the firmware on this deck may not have the
						spectrum link yet.
					</span>
				)}
				<span className="spacer" />
				<span className="dim" style={{ fontSize: 11 }}>
					{latest
						? `${sweeps.length} PASSES · ${latest.db.length} BINS`
						: "NO PASSES YET"}
				</span>
			</div>

			<div className="panel" style={{ flex: 1, minWidth: 0 }}>
				<div className="panel-title">
					<span>
						WATERFALL //{" "}
						{latest
							? `${fmtMHz(latest.f0Hz)} – ${fmtMHz(latest.f1Hz)}`
							: "WAITING FOR THE FIRST PASS"}
					</span>
					{latest && (
						<span>
							{(() => {
								const { minDb, maxDb } = dbRange(sweeps);
								return `SHADE SPANS ${minDb} TO ${maxDb} dBm`;
							})()}
						</span>
					)}
				</div>
				<div
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						minHeight: 0,
						padding: 14,
						gap: 6,
					}}
				>
					<canvas
						ref={traceRef}
						style={{ width: "100%", height: TRACE_HEIGHT, flexShrink: 0 }}
					/>
					<div
						ref={waterBoxRef}
						style={{ flex: 1, minHeight: 160, position: "relative" }}
					>
						{sweeps.length === 0 && (
							<p className="dim" style={{ position: "absolute", margin: 0 }}>
								{linked
									? "Press START SWEEPING — each pass across the band paints one row here_"
									: "The waterfall paints itself while a linked T-Deck sweeps the band_"}
							</p>
						)}
						<canvas
							ref={waterRef}
							style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
						/>
					</div>
					{latest && (
						<div
							className="dim"
							style={{
								display: "flex",
								justifyContent: "space-between",
								fontSize: 10,
								letterSpacing: 1,
								flexShrink: 0,
							}}
						>
							{freqTicks(latest.f0Hz, latest.f1Hz).map((tk) => (
								<span key={tk.frac}>{fmtMHz(tk.hz)}</span>
							))}
						</div>
					)}
				</div>
				<div className="panel-foot">
					<span>BRIGHT = LOUD · ONE ROW = ONE PASS, NEWEST ON TOP</span>
					<span>SOLID LINE = LATEST PASS · DASHED = LOUDEST SEEN</span>
					<span className="spacer" />
					{peak && peakIdx >= 0 && latest && (
						<span>
							LOUDEST SO FAR:{" "}
							{fmtMHz(binCenterHz(latest.f0Hz, latest.f1Hz, peak.length, peakIdx))} ·{" "}
							{Math.round(peak[peakIdx])} dBm
						</span>
					)}
				</div>
			</div>
		</main>
	);
}
