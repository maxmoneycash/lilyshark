/**
 * Pure view logic for the TRAFFIC tab: the IO graph's time-bucketed series,
 * the time-brush that composes with the display filter, and the assembly of
 * the "current view" the export buttons write out.
 *
 * Everything here is arithmetic over plain data — no DOM, no uPlot — so it
 * runs under node:test (trafficView.test.ts). The types are structural
 * subsets of LscapFrame, the same trick frameFilter.ts uses, so tests build
 * frames without the full 30-field record.
 */

import { RF_FIELD } from "./lscap";

/** The slice of a frame the view logic reads. */
export interface ViewFrame {
	timestampUs: bigint;
}

/** What the IO graph needs on top of the timestamp. */
export interface IoFrame extends ViewFrame {
	presentFields: number;
	snrDb: number;
	crc: string;
}

/** A frame's position on the capture clock, in seconds from `t0Us`. */
export function frameTimeS(frame: ViewFrame, t0Us: bigint): number {
	return Number(frame.timestampUs - t0Us) / 1e6;
}

/* ── time brush ──────────────────────────────────────────────────────── */

/** A brushed time range on the capture clock, seconds, start <= end. */
export interface BrushRange {
	startS: number;
	endS: number;
}

/**
 * Turn a raw drag's two edge times into a range, or null when the drag
 * carries no width (a click, not a brush) or a non-finite value.
 */
export function normalizeBrush(aS: number, bS: number): BrushRange | null {
	if (!Number.isFinite(aS) || !Number.isFinite(bS)) return null;
	const startS = Math.min(aS, bS);
	const endS = Math.max(aS, bS);
	return endS > startS ? { startS, endS } : null;
}

/**
 * Compose the brush with the display filter's output: `shown` is the index
 * set the text filter produced, and the brush is one more predicate over
 * it — both edges inclusive, so brushing exactly onto a frame keeps it.
 * A null brush changes nothing, which is also how clearing restores.
 */
export function applyBrush<F extends ViewFrame>(
	shown: number[],
	frames: F[],
	t0Us: bigint,
	brush: BrushRange | null,
): number[] {
	if (!brush) return shown;
	return shown.filter((i) => {
		const t = frameTimeS(frames[i], t0Us);
		return t >= brush.startS && t <= brush.endS;
	});
}

/** The stat strip's wording for an active brush: "1.200–3.450 s". */
export function brushLabel(brush: BrushRange): string {
	return `${brush.startS.toFixed(3)}–${brush.endS.toFixed(3)} s`;
}

/* ── IO graph series ─────────────────────────────────────────────────── */

/**
 * Bucket widths the graph may pick from, in seconds — the "nice" steps a
 * scope would use. Above the largest step the width grows in whole minutes.
 */
const BUCKET_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];

/**
 * Upper bound on bucket count. 5,000 frames collapse to at most this many
 * plotted points, which is what keeps the strip smooth: uPlot redraws a
 * few hundred points regardless of capture size.
 */
export const IO_MAX_BUCKETS = 240;

/** Smallest nice bucket width that fits the span into IO_MAX_BUCKETS. */
export function chooseBucketS(spanS: number): number {
	for (const s of BUCKET_STEPS) {
		if (spanS / s < IO_MAX_BUCKETS) return s;
	}
	return Math.ceil(spanS / IO_MAX_BUCKETS / 60) * 60;
}

/**
 * The IO graph's aligned series. One x per bucket (bucket centers, seconds
 * on the capture clock), and per bucket:
 *
 *   rate     frames per second — 0 for a silent bucket, a real reading
 *   snr      mean reported SNR in dB, null where no frame reported SNR
 *            (absence of a measurement, not a zero)
 *   crcFail  CRC failures per second, null where there were none, so the
 *            failure marks draw only where failures happened
 */
export interface IoSeries {
	bucketS: number;
	xs: number[];
	rate: number[];
	snr: (number | null)[];
	crcFail: (number | null)[];
}

/**
 * Bin the (already display-filtered) frames onto the capture clock. `t0Us`
 * is the FULL capture's first timestamp, so the graph's x axis agrees with
 * the table's TIME column even when the filter hides the first frames.
 */
export function buildIoSeries(frames: IoFrame[], t0Us: bigint): IoSeries {
	if (frames.length === 0)
		return { bucketS: 1, xs: [], rate: [], snr: [], crcFail: [] };

	let minT = Infinity;
	let maxT = -Infinity;
	for (const f of frames) {
		const t = frameTimeS(f, t0Us);
		if (t < minT) minT = t;
		if (t > maxT) maxT = t;
	}
	const bucketS = chooseBucketS(maxT - minT);
	const first = Math.floor(minT / bucketS);
	const count = Math.floor(maxT / bucketS) - first + 1;

	const frameCount = new Array<number>(count).fill(0);
	const snrSum = new Array<number>(count).fill(0);
	const snrCount = new Array<number>(count).fill(0);
	const failCount = new Array<number>(count).fill(0);
	for (const f of frames) {
		const b = Math.floor(frameTimeS(f, t0Us) / bucketS) - first;
		frameCount[b]++;
		if ((f.presentFields & RF_FIELD.snr) !== 0) {
			snrSum[b] += f.snrDb;
			snrCount[b]++;
		}
		if (f.crc === "invalid") failCount[b]++;
	}

	const xs: number[] = [];
	const rate: number[] = [];
	const snr: (number | null)[] = [];
	const crcFail: (number | null)[] = [];
	for (let b = 0; b < count; b++) {
		xs.push((first + b + 0.5) * bucketS);
		rate.push(frameCount[b] / bucketS);
		snr.push(snrCount[b] > 0 ? snrSum[b] / snrCount[b] : null);
		crcFail.push(failCount[b] > 0 ? failCount[b] / bucketS : null);
	}
	return { bucketS, xs, rate, snr, crcFail };
}

/* ── export-view assembly ────────────────────────────────────────────── */

/**
 * The current view, shaped for the export writers: the frames the table is
 * showing (text filter ∘ brush, via the composed `shown` index set), with
 * times measured from the FULL capture's first frame so exported times
 * match the on-screen TIME column whatever the filter hides.
 * Structurally identical to ExportOptions in lib/export.
 */
export function assembleExportView<F extends ViewFrame>(
	frames: F[],
	shown: number[],
): { frames: F[]; timeReferenceUs: bigint } {
	return {
		frames: shown.map((i) => frames[i]),
		timeReferenceUs: frames[0]?.timestampUs ?? 0n,
	};
}

/**
 * Name for an exported file: the capture's own name with the extension
 * swapped, and `-view` marking any export that is a subset of the capture
 * — a file named exactly like the capture but missing frames would lie.
 */
export function exportFileName(
	captureName: string,
	view: { filtered: boolean; brushed: boolean },
	ext: string,
): string {
	const base = (captureName || "capture").replace(/\.lscap$/i, "");
	return `${base}${view.filtered || view.brushed ? "-view" : ""}.${ext}`;
}

/**
 * The honest line shown after a pcap export: what was written and, when
 * pcap could not carry everything, exactly what was left out and why.
 * Mirrors the counts buildLoraTapPcap returns.
 */
export function pcapExclusionNote(result: {
	written: number;
	excludedSynthetic: number;
	excludedUnencodable: number;
	/**
	 * Annotations (UI-010) the export was carrying and pcap could not: the
	 * LoRaTap v0 header has no annotation channel, exactly as it has none for
	 * provenance. Omitted when there were none to leave out.
	 */
	annotationsOmitted?: number;
}): string {
	const parts = [`${result.written} frame(s) written`];
	if (result.excludedSynthetic > 0)
		parts.push(
			`${result.excludedSynthetic} synthetic frame(s) excluded — LoRaTap has no provenance channel`,
		);
	if (result.excludedUnencodable > 0)
		parts.push(
			`${result.excludedUnencodable} frame(s) LoRaTap v0 cannot encode`,
		);
	if ((result.annotationsOmitted ?? 0) > 0)
		parts.push(
			`${result.annotationsOmitted} annotation(s) not written — LoRaTap has no annotation channel; export CSV or JSON, or download the sidecar`,
		);
	return parts.join(" · ");
}
