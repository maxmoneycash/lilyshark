/**
 * Coverage cells: where this mesh has actually been heard, and where
 * nobody has listened yet.
 *
 * A coverage cell is a geohash box (geohash.ts) holding every reception
 * that carried a position inside it, plus the signal statistics of those
 * receptions. That is the whole claim the map is allowed to make: a shaded
 * cell means "a frame from inside this box reached a receiver at this
 * strength", not "a radio here will work".
 *
 * PROVENANCE IS THE POINT OF THIS FILE. Three kinds of evidence reach the
 * map and they are not interchangeable:
 *
 *   radio  this deck's own receiver demodulated the frame. The only
 *          evidence that carries a measured dB figure, and the only
 *          evidence a signal statistic is ever computed from.
 *   net    the row arrived over the internet bridge (store `viaNet`,
 *          netNodes.ts). Somebody's radio somewhere heard it; this one did
 *          not. It has no SNR of ours and never gains one.
 *   sim    invented — the demo mesh, or a deck running SIMULATE. Real
 *          shapes, no radio behind them.
 *
 * A cell keeps all three counts separately and grades only on radio
 * samples, so a cell can never be shaded by strength it did not measure.
 * `cellProvenance` picks the label the map paints with, and a cell holding
 * any invented sample can never be labelled `measured` on that evidence
 * alone. The screen still has to draw the three labels differently — this
 * module only guarantees it can tell them apart.
 *
 * What this file cannot know, and so never claims: whether anyone ever
 * listened in a cell that has no samples. `coverageGaps` returns the
 * unheard neighbours of measured cells and calls them exactly that — no
 * evidence — never "no coverage".
 */

import {
	decodeGeohash,
	encodeGeohash,
	type GeohashBox,
	geohashCenter,
	geohashNeighbors,
	geohashSpanKm,
} from "./geohash.ts";

/** Where one observation came from. See the module comment. */
export type Provenance = "radio" | "net" | "sim";

/** What a whole cell may be called, given the mix of evidence inside it. */
export type CellProvenance = "measured" | "synthetic" | "reported";

/**
 * One reception with a position: a heard frame, or a node entry whose last
 * known fix and signal the store still holds. `atMs` is when it was heard,
 * `id` is the node it came from, so several samples from one node count as
 * one source in a cell.
 */
export interface CoverageObservation {
	lat: number;
	lon: number;
	atMs: number;
	provenance: Provenance;
	/** dB. Only ever set on a radio sample; a net row has no SNR of ours. */
	snrDb?: number;
	/** dBm. Same rule as snrDb. */
	rssiDbm?: number;
	/** Hops the frame travelled to reach us; 0 = straight off the air. */
	hops?: number;
	/** Node number or other stable identity of whatever was heard. */
	id?: string | number;
}

/**
 * A position at the null island is what a GPS reports when it has no fix,
 * and the map has always discarded it rather than drawing Africa's corner.
 * The rule lives here so the marker pass and the coverage pass cannot drift
 * apart about which fixes are real.
 */
export function isPlausibleFix(lat?: number, lon?: number): boolean {
	if (lat === undefined || lon === undefined) return false;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
	if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
	return Math.abs(lat) > 0.1 || Math.abs(lon) > 0.1;
}

/* ── signal statistics ───────────────────────────────────────────────── */

export interface SignalStats {
	count: number;
	min: number;
	max: number;
	mean: number;
	/** Even counts average the two middle samples. */
	median: number;
}

/** Statistics of a list of dB figures, or null when there are none. */
export function signalStats(samples: readonly number[]): SignalStats | null {
	const values = samples.filter((v) => Number.isFinite(v));
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return {
		count: sorted.length,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
		median:
			sorted.length % 2 === 1
				? sorted[mid]
				: (sorted[mid - 1] + sorted[mid]) / 2,
	};
}

/* ── grades ──────────────────────────────────────────────────────────── */

export type CoverageGrade = "strong" | "fair" | "weak" | "marginal";

/**
 * Grade floors in dB SNR, anchored on the SX1262's demodulation floors per
 * spreading factor (Semtech: about -7.5 dB at SF7, -15 dB at SF10, -20 dB
 * at SF12) rather than on a look. A grade therefore answers a physical
 * question — which presets can still decode a signal this weak — and the
 * legend states the numbers so the reader can check it.
 *
 * This is deliberately not fmt.ts's `snrClass`, which colours one link's
 * SNR in a table on a three-way good/marginal/bad scale. That question is
 * "is this link healthy"; this one is "does anything reach here at all",
 * and the two scales must not be conflated.
 */
export const GRADE_FLOOR_DB: Record<CoverageGrade, number> = {
	strong: 0,
	fair: -7.5,
	weak: -15,
	marginal: Number.NEGATIVE_INFINITY,
};

/** Best first, so a legend or a summary can iterate in reading order. */
export const GRADE_ORDER: readonly CoverageGrade[] = [
	"strong",
	"fair",
	"weak",
	"marginal",
];

/** What each grade means, in the units it is measured in. */
export const GRADE_LEGEND: Record<CoverageGrade, string> = {
	strong: "≥ 0 dB SNR · above the noise floor, every preset decodes",
	fair: "-7.5 to 0 dB · under the noise, still above the SF7 floor",
	weak: "-15 to -7.5 dB · only the slower presets (SF10 and up) decode",
	marginal: "< -15 dB · at the SF11/SF12 floor, decoding is luck",
};

export function gradeForSnr(snrDb: number): CoverageGrade {
	for (const grade of GRADE_ORDER) {
		if (snrDb >= GRADE_FLOOR_DB[grade]) return grade;
	}
	return "marginal";
}

/**
 * Fill opacity per grade. Kept under a half so the basemap, the contours
 * and every node marker stay readable through a shaded cell — the layer
 * annotates the map, it does not replace it.
 */
export function gradeFillOpacity(grade: CoverageGrade): number {
	return { strong: 0.42, fair: 0.3, weak: 0.19, marginal: 0.1 }[grade];
}

/* ── cells ───────────────────────────────────────────────────────────── */

export interface CoverageCell {
	geohash: string;
	box: GeohashBox;
	center: { lat: number; lon: number };
	/** Every sample that landed in the box, of any provenance. */
	observations: number;
	radioObservations: number;
	netObservations: number;
	simObservations: number;
	/** Radio samples that arrived with hops === 0: straight off the air. */
	directObservations: number;
	/** Distinct `id`s heard in the box, of any provenance. */
	sources: number;
	/** dB, radio samples only. Null when no radio sample carried an SNR. */
	snrDb: SignalStats | null;
	/** dBm, radio samples only. */
	rssiDbm: SignalStats | null;
	/** The shading figure: the best SNR measured in the box, in dB. */
	bestSnrDb: number | null;
	/** Null exactly when `bestSnrDb` is null — heard, but never with a figure. */
	grade: CoverageGrade | null;
	firstHeardMs: number;
	lastHeardMs: number;
	provenance: CellProvenance;
}

export interface CoverageGap {
	geohash: string;
	box: GeohashBox;
	center: { lat: number; lon: number };
	/** How many of its neighbours this radio has measured. */
	adjacentMeasured: number;
}

export interface CoverageSummary {
	/** Geohash length every cell in this model was cut at. */
	precision: number;
	/**
	 * Approximate size of one cell, measured at the busiest one — a
	 * geohash box is a fixed number of degrees, so its height is the same
	 * everywhere and only its width narrows with latitude.
	 */
	cellSpanKm: { widthKm: number; heightKm: number } | null;
	cells: CoverageCell[];
	gaps: CoverageGap[];
	measuredCells: number;
	reportedCells: number;
	syntheticCells: number;
	observations: number;
	radioObservations: number;
	netObservations: number;
	simObservations: number;
	/** Observations dropped for having no plausible fix (null island, NaN). */
	discarded: number;
	byGrade: Record<CoverageGrade, number>;
	/** Measured cells whose radio samples never carried an SNR figure. */
	ungradedMeasuredCells: number;
	bestSnrDb: number | null;
	firstHeardMs: number | null;
	lastHeardMs: number | null;
}

/**
 * The label the map paints a cell with. Radio evidence outranks everything
 * — this deck really did hear inside the box, whatever else also landed
 * there. Failing that, an invented sample outranks an internet row: it is
 * the louder warning, because a synthetic sample is one we made up, and a
 * cell part-built from fiction must not be shown as somebody's real report.
 */
export function cellProvenance(counts: {
	radioObservations: number;
	simObservations: number;
	netObservations: number;
}): CellProvenance {
	if (counts.radioObservations > 0) return "measured";
	if (counts.simObservations > 0) return "synthetic";
	return "reported";
}

/**
 * Geohash length for a map zoom, chosen so a cell stays between roughly a
 * fifth and a whole screen: geohash-4 is 39 km, 5 is 4.9 km, 6 is 1.2 km,
 * 7 is 153 m. Coarser than the zoom would allow is the safe direction —
 * a cell finer than the position precision the firmware transmits would
 * draw detail the data does not have.
 */
export function geohashLengthForZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 5;
	if (zoom < 6) return 3;
	if (zoom < 10) return 4;
	if (zoom < 13) return 5;
	if (zoom < 16) return 6;
	return 7;
}

export interface BuildCoverageOptions {
	/** Geohash length. Defaults to 5 (a 4.9 km box). */
	precision?: number;
	/**
	 * Whether to look for unheard neighbours of measured cells. Off by
	 * default because a gap is a claim about listening, and the caller has
	 * to opt into making it.
	 */
	gaps?: boolean;
}

interface Bucket {
	geohash: string;
	observations: number;
	radioObservations: number;
	netObservations: number;
	simObservations: number;
	directObservations: number;
	sources: Set<string>;
	snr: number[];
	rssi: number[];
	firstHeardMs: number;
	lastHeardMs: number;
}

/**
 * Fold observations into cells. Signal statistics come from radio samples
 * only: a net row has no SNR of ours to average, and a sim sample's numbers
 * are invented, so letting either into the statistics would put a measured
 * dB figure on a cell nothing measured.
 */
export function buildCoverage(
	observations: readonly CoverageObservation[],
	options: BuildCoverageOptions = {},
): CoverageSummary {
	const precision = options.precision ?? 5;
	const buckets = new Map<string, Bucket>();
	let discarded = 0;
	let radioObservations = 0;
	let netObservations = 0;
	let simObservations = 0;
	let firstHeardMs: number | null = null;
	let lastHeardMs: number | null = null;

	for (const observation of observations) {
		if (!isPlausibleFix(observation.lat, observation.lon)) {
			discarded += 1;
			continue;
		}
		const geohash = encodeGeohash(observation.lat, observation.lon, precision);
		const bucket = buckets.get(geohash) ?? {
			geohash,
			observations: 0,
			radioObservations: 0,
			netObservations: 0,
			simObservations: 0,
			directObservations: 0,
			sources: new Set<string>(),
			snr: [],
			rssi: [],
			firstHeardMs: observation.atMs,
			lastHeardMs: observation.atMs,
		};
		bucket.observations += 1;
		if (observation.id !== undefined)
			bucket.sources.add(String(observation.id));
		if (Number.isFinite(observation.atMs)) {
			bucket.firstHeardMs = Math.min(bucket.firstHeardMs, observation.atMs);
			bucket.lastHeardMs = Math.max(bucket.lastHeardMs, observation.atMs);
			firstHeardMs =
				firstHeardMs === null
					? observation.atMs
					: Math.min(firstHeardMs, observation.atMs);
			lastHeardMs =
				lastHeardMs === null
					? observation.atMs
					: Math.max(lastHeardMs, observation.atMs);
		}
		if (observation.provenance === "radio") {
			bucket.radioObservations += 1;
			radioObservations += 1;
			if (observation.hops === 0) bucket.directObservations += 1;
			if (observation.snrDb !== undefined && Number.isFinite(observation.snrDb))
				bucket.snr.push(observation.snrDb);
			if (
				observation.rssiDbm !== undefined &&
				Number.isFinite(observation.rssiDbm)
			)
				bucket.rssi.push(observation.rssiDbm);
		} else if (observation.provenance === "sim") {
			bucket.simObservations += 1;
			simObservations += 1;
		} else {
			bucket.netObservations += 1;
			netObservations += 1;
		}
		buckets.set(geohash, bucket);
	}

	const byGrade: Record<CoverageGrade, number> = {
		strong: 0,
		fair: 0,
		weak: 0,
		marginal: 0,
	};
	let measuredCells = 0;
	let reportedCells = 0;
	let syntheticCells = 0;
	let ungradedMeasuredCells = 0;
	let bestSnrDb: number | null = null;

	const cells: CoverageCell[] = [];
	for (const bucket of buckets.values()) {
		const snrDb = signalStats(bucket.snr);
		const provenance = cellProvenance(bucket);
		const grade = snrDb === null ? null : gradeForSnr(snrDb.max);
		if (provenance === "measured") {
			measuredCells += 1;
			if (grade === null) ungradedMeasuredCells += 1;
		} else if (provenance === "synthetic") syntheticCells += 1;
		else reportedCells += 1;
		if (grade !== null) byGrade[grade] += 1;
		if (snrDb !== null)
			bestSnrDb =
				bestSnrDb === null ? snrDb.max : Math.max(bestSnrDb, snrDb.max);
		cells.push({
			geohash: bucket.geohash,
			box: decodeGeohash(bucket.geohash),
			center: geohashCenter(bucket.geohash),
			observations: bucket.observations,
			radioObservations: bucket.radioObservations,
			netObservations: bucket.netObservations,
			simObservations: bucket.simObservations,
			directObservations: bucket.directObservations,
			sources: bucket.sources.size,
			snrDb,
			rssiDbm: signalStats(bucket.rssi),
			bestSnrDb: snrDb === null ? null : snrDb.max,
			grade,
			firstHeardMs: bucket.firstHeardMs,
			lastHeardMs: bucket.lastHeardMs,
			provenance,
		});
	}
	// Sorted by cell name so two runs over the same observations draw the
	// same layer in the same order, whatever order the samples arrived in.
	cells.sort((a, b) =>
		a.geohash < b.geohash ? -1 : a.geohash > b.geohash ? 1 : 0,
	);

	const busiest = cells.reduce<CoverageCell | null>(
		(best, cell) =>
			best === null || cell.observations > best.observations ? cell : best,
		null,
	);

	return {
		precision,
		cellSpanKm: busiest === null ? null : geohashSpanKm(busiest.geohash),
		cells,
		gaps: options.gaps ? coverageGaps(cells) : [],
		measuredCells,
		reportedCells,
		syntheticCells,
		observations: radioObservations + netObservations + simObservations,
		radioObservations,
		netObservations,
		simObservations,
		discarded,
		byGrade,
		ungradedMeasuredCells,
		bestSnrDb,
		firstHeardMs,
		lastHeardMs,
	};
}

/**
 * The unheard neighbours of the measured cells: boxes touching somewhere
 * this radio has heard the mesh, from which it has heard nothing.
 *
 * Only measured cells seed a gap. A box next to an internet row is not a
 * place this radio failed to hear — nothing here was ever listening for it
 * — and a box next to a synthetic cell is next to fiction. Neither is
 * evidence of a gap, so neither may draw one.
 *
 * This is an absence of evidence, not evidence of absence: nobody may have
 * transmitted from that box at all. The screen has to say so.
 */
export function coverageGaps(cells: readonly CoverageCell[]): CoverageGap[] {
	const occupied = new Set(cells.map((cell) => cell.geohash));
	const counts = new Map<string, number>();
	for (const cell of cells) {
		if (cell.provenance !== "measured") continue;
		for (const neighbour of geohashNeighbors(cell.geohash)) {
			if (occupied.has(neighbour)) continue;
			counts.set(neighbour, (counts.get(neighbour) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([geohash, adjacentMeasured]) => ({
			geohash,
			box: decodeGeohash(geohash),
			center: geohashCenter(geohash),
			adjacentMeasured,
		}))
		.sort((a, b) =>
			a.geohash < b.geohash ? -1 : a.geohash > b.geohash ? 1 : 0,
		);
}
