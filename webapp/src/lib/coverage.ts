/**
 * Coverage cells for the COVERAGE screen (UI-016).
 *
 * Everything this module builds comes out of documents the Season 0 scorer
 * publishes or consumes — scripts/field_receipts_score.py — and nothing
 * else. There is no coverage service and no private index behind this
 * screen: the browser reads the same public JSON a disputant would re-run
 * the scorer over.
 *
 * Four document shapes are understood, each identified by its own keys:
 *
 *   score          `{method:{scorer,…}, standings:{…}, discrepancies:[…]}`
 *                  — `build_output`. Season standings per account. It
 *                  carries no cells at all, which is why it alone cannot
 *                  draw this map.
 *   most-wanted    `{method:{generator,as_of_week,…}, most_wanted:[…]}`
 *                  — `build_most_wanted`. The ranked gap list: geohash5,
 *                  band, adjacent_active_cells, last_surveyed_week.
 *   cell records   `{records:[{publisher,commitment,geohash5,band,
 *                  iso_week},…]}` — the scorer's `--cells` input, the only
 *                  published document that says which cells were surveyed.
 *   events         `{events:[…]}` — the scorer's `--events` input. Only the
 *                  CaptureRegistered events are read here, to reproduce the
 *                  scorer's anchor index: a cell record counts as verified
 *                  iff its (publisher, commitment) was anchored on chain,
 *                  exactly as `score_cells` requires. Without this document
 *                  the records are shown as UNCHECKED, never as verified.
 *
 * The ISO-week arithmetic and the most-wanted ranking are ports of
 * `_week_index` and the `rank` key inside `build_most_wanted`, so the list
 * a contributor reads here is in the order the published file already had.
 */

import { decodeGeohash, geohashNeighbors } from "./geohash.ts";

/** Season 0 window, from docs/protocol/season-0.md. Frozen; not a guess. */
export const SEASON_0 = {
	name: "Season 0",
	opensUtc: "2026-10-01",
	closesUtc: "2026-12-31",
	/** 2026-10-01T00:00:00Z. */
	opensUnix: 1_759_276_800,
} as const;

/** The scorer's own default for `--stale-after-weeks`. */
export const DEFAULT_STALE_AFTER_WEEKS = 4;

export class CoverageInputError extends Error {}

function fail(message: string): never {
	throw new CoverageInputError(message);
}

/* ── ISO weeks ───────────────────────────────────────────────────────── */

const ISO_WEEK_RE = /^\d{4}-W\d{2}$/;
const DAY_MS = 86_400_000;
/** Proleptic Gregorian ordinal of 1970-01-01, matching date.toordinal(). */
const EPOCH_ORDINAL = 719_163;

/**
 * The comparable index of an ISO week: the ordinal of its Monday divided by
 * seven, which is `_week_index` in the scorer. Consecutive weeks differ by
 * exactly one, so a difference is a count of weeks.
 */
export function isoWeekIndex(isoWeek: string): number {
	if (!ISO_WEEK_RE.test(isoWeek))
		fail(`expected an ISO week 'YYYY-Www', got ${JSON.stringify(isoWeek)}`);
	const year = Number(isoWeek.slice(0, 4));
	const week = Number(isoWeek.slice(6));
	if (week < 1 || week > 53) fail(`invalid week: ${week}`);
	// ISO week 1 is the week holding 4 January.
	const jan4 = Date.UTC(year, 0, 4);
	const jan4Dow = new Date(jan4).getUTCDay() || 7;
	const monday = jan4 - (jan4Dow - 1) * DAY_MS + (week - 1) * 7 * DAY_MS;
	// Week 53 exists only in years that have one; the Thursday of the week
	// decides which ISO year it belongs to.
	if (new Date(monday + 3 * DAY_MS).getUTCFullYear() !== year)
		fail(`invalid week: ${week}`);
	return Math.floor((Math.floor(monday / DAY_MS) + EPOCH_ORDINAL) / 7);
}

/** Weeks between two ISO weeks, `later - earlier`. */
export function isoWeeksBetween(earlier: string, later: string): number {
	return isoWeekIndex(later) - isoWeekIndex(earlier);
}

/* ── documents ───────────────────────────────────────────────────────── */

export type SourceKind = "score" | "most-wanted" | "cell-records" | "events";

export const SOURCE_LABELS: Record<SourceKind, string> = {
	score: "SCORER · score",
	"most-wanted": "SCORER · most-wanted",
	"cell-records": "SCORER INPUT · cell records",
	events: "SCORER INPUT · chain events",
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Which of the scorer's documents this is, by the keys only that document
 * has. Anything else is refused: guessing at an unknown shape is how a
 * screen ends up drawing cells nobody published.
 */
export function classifyDocument(doc: unknown): SourceKind {
	if (!isObject(doc)) fail("not a JSON object");
	if (Array.isArray(doc.most_wanted)) return "most-wanted";
	if (isObject(doc.standings) && isObject(doc.method)) return "score";
	if (Array.isArray(doc.records)) return "cell-records";
	if (Array.isArray(doc.events)) return "events";
	fail(
		"unrecognised document: expected a scorer 'score' or 'most-wanted' " +
			"output, a cell-records file, or a chain-events file",
	);
}

export interface CellRecord {
	publisher: string;
	commitment: string;
	geohash5: string;
	band: string;
	isoWeek: string;
}

function str(value: unknown, where: string): string {
	if (typeof value !== "string" || value === "")
		fail(`${where}: expected a non-empty string`);
	return value;
}

/**
 * A cell name has to be a real geohash-5, not merely five characters: the
 * screen turns it straight into a box, and a string that cannot be decoded
 * has no box to draw.
 */
function geohash5(value: unknown, where: string): string {
	const text = str(value, where);
	if (text.length !== 5)
		fail(
			`${where}: expected a 5-character geohash, got ${JSON.stringify(text)}`,
		);
	try {
		decodeGeohash(text);
	} catch (error) {
		fail(`${where}: ${error instanceof Error ? error.message : String(error)}`);
	}
	return text;
}

/** `{records:[…]}` — the scorer's `--cells` input. */
export function parseCellRecords(doc: unknown): CellRecord[] {
	if (!isObject(doc) || !Array.isArray(doc.records))
		fail("cell records: expected an object with a 'records' array");
	return doc.records.map((raw, index) => {
		const where = `records[${index}]`;
		if (!isObject(raw)) fail(`${where}: expected an object`);
		const cell = geohash5(raw.geohash5, `${where}.geohash5`);
		const isoWeek = str(raw.iso_week, `${where}.iso_week`);
		isoWeekIndex(isoWeek);
		return {
			publisher: str(raw.publisher, `${where}.publisher`).toLowerCase(),
			commitment: str(raw.commitment, `${where}.commitment`).toLowerCase(),
			geohash5: cell,
			band: str(raw.band, `${where}.band`),
			isoWeek,
		};
	});
}

/** Where a capture was anchored, in the scorer's deterministic order. */
export interface Anchor {
	txVersion: number;
	eventIndex: number;
	publisher: string;
}

/**
 * The anchor index the scorer builds in `replay_onchain`: commitment ->
 * first CaptureRegistered event for it, in (tx_version, event_index) order.
 * Witness and points events are irrelevant to cells and are skipped.
 */
export function parseAnchors(doc: unknown): Map<string, Anchor> {
	if (!isObject(doc) || !Array.isArray(doc.events))
		fail("events: expected an object with an 'events' array");
	const ordered = doc.events
		.map((raw, index) => {
			if (!isObject(raw)) fail(`events[${index}]: expected an object`);
			return raw;
		})
		.filter((raw) => raw.type === "CaptureRegistered")
		.map((raw, index) => {
			const where = `CaptureRegistered[${index}]`;
			const data = raw.data;
			if (!isObject(data)) fail(`${where}.data: expected an object`);
			if (typeof raw.tx_version !== "number")
				fail(`${where}.tx_version: expected an integer`);
			const eventIndex =
				raw.event_index === undefined ? 0 : Number(raw.event_index);
			if (!Number.isFinite(eventIndex))
				fail(`${where}.event_index: expected an integer`);
			return {
				commitment: str(
					data.commitment,
					`${where}.data.commitment`,
				).toLowerCase(),
				anchor: {
					txVersion: raw.tx_version,
					eventIndex,
					publisher: str(
						data.publisher,
						`${where}.data.publisher`,
					).toLowerCase(),
				},
			};
		})
		.sort(
			(a, b) =>
				a.anchor.txVersion - b.anchor.txVersion ||
				a.anchor.eventIndex - b.anchor.eventIndex,
		);
	const anchors = new Map<string, Anchor>();
	for (const { commitment, anchor } of ordered) {
		// setdefault: the first anchor of a commitment is the one that counts.
		if (!anchors.has(commitment)) anchors.set(commitment, anchor);
	}
	return anchors;
}

export interface MostWantedRow {
	geohash5: string;
	band: string;
	adjacentActiveCells: number;
	lastSurveyedWeek: string | null;
}

export interface MostWantedDoc {
	asOfWeek: string;
	staleAfterWeeks: number;
	activeCellCount: number;
	verifiedCellCount: number;
	rulesSeason: string | null;
	rulesSha256: string | null;
	rows: MostWantedRow[];
}

/** `{method:{…}, most_wanted:[…]}` — `build_most_wanted`'s JSON. */
export function parseMostWanted(doc: unknown): MostWantedDoc {
	if (!isObject(doc) || !Array.isArray(doc.most_wanted))
		fail("most-wanted: expected an object with a 'most_wanted' array");
	const method = isObject(doc.method) ? doc.method : {};
	const asOfWeek = str(method.as_of_week, "method.as_of_week");
	isoWeekIndex(asOfWeek);
	const rows = doc.most_wanted.map((raw, index) => {
		const where = `most_wanted[${index}]`;
		if (!isObject(raw)) fail(`${where}: expected an object`);
		const last = raw.last_surveyed_week;
		if (last !== null && last !== undefined && typeof last !== "string")
			fail(`${where}.last_surveyed_week: expected a string or null`);
		if (typeof last === "string") isoWeekIndex(last);
		if (typeof raw.adjacent_active_cells !== "number")
			fail(`${where}.adjacent_active_cells: expected an integer`);
		return {
			geohash5: geohash5(raw.geohash5, `${where}.geohash5`),
			band: str(raw.band, `${where}.band`),
			adjacentActiveCells: raw.adjacent_active_cells,
			lastSurveyedWeek: typeof last === "string" ? last : null,
		};
	});
	return {
		asOfWeek,
		staleAfterWeeks:
			typeof method.stale_after_weeks === "number"
				? method.stale_after_weeks
				: DEFAULT_STALE_AFTER_WEEKS,
		activeCellCount:
			typeof method.active_cell_count === "number"
				? method.active_cell_count
				: 0,
		verifiedCellCount:
			typeof method.verified_cell_count === "number"
				? method.verified_cell_count
				: 0,
		rulesSeason:
			typeof method.rules_season === "string" ? method.rules_season : null,
		rulesSha256:
			typeof method.rules_sha256 === "string" ? method.rules_sha256 : null,
		rows,
	};
}

export interface Standing {
	account: string;
	anchorPoints: number;
	witnessPoints: number;
	cellPoints: number;
	seasonTotal: number;
	cliqueDiscountApplied: boolean;
}

export interface ScoreDoc {
	standings: Standing[];
	discrepancyCount: number;
	rulesSeason: string | null;
	rulesSha256: string | null;
	eventCount: number;
	cellRecordCount: number;
}

function num(value: unknown, where: string): number {
	if (typeof value !== "number") fail(`${where}: expected a number`);
	return value;
}

/** `{method,standings,discrepancies}` — `build_output`'s JSON. */
export function parseScore(doc: unknown): ScoreDoc {
	if (!isObject(doc) || !isObject(doc.standings))
		fail("score: expected an object with a 'standings' object");
	const method = isObject(doc.method) ? doc.method : {};
	const standings = Object.entries(doc.standings).map(([account, raw]) => {
		const where = `standings[${account}]`;
		if (!isObject(raw)) fail(`${where}: expected an object`);
		const onchain = isObject(raw.onchain_points) ? raw.onchain_points : {};
		return {
			account,
			anchorPoints: num(onchain.anchor, `${where}.onchain_points.anchor`),
			witnessPoints: num(onchain.witness, `${where}.onchain_points.witness`),
			cellPoints: num(raw.cell_points, `${where}.cell_points`),
			seasonTotal: num(raw.season_total, `${where}.season_total`),
			cliqueDiscountApplied: raw.clique_discount_applied === true,
		};
	});
	standings.sort(
		(a, b) =>
			b.seasonTotal - a.seasonTotal || a.account.localeCompare(b.account),
	);
	return {
		standings,
		discrepancyCount: Array.isArray(doc.discrepancies)
			? doc.discrepancies.length
			: 0,
		rulesSeason:
			typeof method.rules_season === "string" ? method.rules_season : null,
		rulesSha256:
			typeof method.rules_sha256 === "string" ? method.rules_sha256 : null,
		eventCount: typeof method.event_count === "number" ? method.event_count : 0,
		cellRecordCount:
			typeof method.cell_record_count === "number"
				? method.cell_record_count
				: 0,
	};
}

/* ── ranking ─────────────────────────────────────────────────────────── */

export interface RankedWantedCell extends MostWantedRow {
	rank: number;
	/** Weeks since the last verified capture; null when never surveyed. */
	staleWeeks: number | null;
}

/**
 * The scorer's own ranking, reproduced so the browser's order is the file's
 * order whatever a hand edit did to it: most adjacent active cells first;
 * at equal adjacency a never-surveyed cell outranks a stale one; then the
 * stalest; then geohash and band, for determinism.
 */
export function rankMostWanted(
	rows: readonly MostWantedRow[],
	asOfWeek: string | null,
): RankedWantedCell[] {
	const asOfIdx = asOfWeek === null ? null : isoWeekIndex(asOfWeek);
	const age = (row: MostWantedRow): number | null =>
		row.lastSurveyedWeek === null || asOfIdx === null
			? null
			: asOfIdx - isoWeekIndex(row.lastSurveyedWeek);
	const key = (
		row: MostWantedRow,
	): [number, number, number, string, string] => {
		const surveyed = row.lastSurveyedWeek === null ? 0 : 1;
		const staleness = age(row);
		return [
			-row.adjacentActiveCells,
			surveyed,
			staleness === null ? 0 : -staleness,
			row.geohash5,
			row.band,
		];
	};
	return [...rows]
		.sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			for (let i = 0; i < ka.length; i++) {
				if (ka[i] === kb[i]) continue;
				return ka[i] < kb[i] ? -1 : 1;
			}
			return 0;
		})
		.map((row, index) => ({ ...row, rank: index + 1, staleWeeks: age(row) }));
}

/* ── colour scale ────────────────────────────────────────────────────── */

/**
 * Recency buckets, anchored on the scorer's own staleness threshold rather
 * than on a look: a cell is STALE at exactly the age the `most-wanted`
 * command stops counting it as active.
 */
export type RecencyBucket = "current" | "recent" | "aging" | "stale";

export const RECENCY_ORDER: RecencyBucket[] = [
	"current",
	"recent",
	"aging",
	"stale",
];

export function recencyBucket(
	staleWeeks: number,
	staleAfterWeeks: number,
): RecencyBucket {
	if (staleWeeks >= staleAfterWeeks) return "stale";
	if (staleWeeks <= 0) return "current";
	return staleWeeks * 2 < staleAfterWeeks ? "recent" : "aging";
}

/**
 * Density step 0-3 from the verified capture count in a cell. One capture
 * is a single visit; the steps are coarse on purpose, because the number
 * behind them is small and a smooth ramp would read as precision.
 */
export function densityStep(observations: number): 0 | 1 | 2 | 3 {
	if (observations >= 5) return 3;
	if (observations >= 3) return 2;
	if (observations >= 2) return 1;
	return 0;
}

/** Fill opacity for a density step, kept low enough to read the map under it. */
export function densityOpacity(step: 0 | 1 | 2 | 3): number {
	return [0.12, 0.24, 0.36, 0.5][step];
}

/* ── the model ───────────────────────────────────────────────────────── */

export interface CoverageCell {
	key: string;
	geohash5: string;
	band: string;
	observations: number;
	weeks: string[];
	firstWeek: string;
	lastWeek: string;
	/** The publisher the scorer credits with the cell's first week. */
	firstSurveyedBy: string | null;
	staleWeeks: number;
	active: boolean;
	recency: RecencyBucket;
	density: 0 | 1 | 2 | 3;
	adjacentActiveCells: number;
}

/** Whether the records could be checked against anchors at all. */
export type Verification = "anchored" | "unchecked";

export interface CoverageModel {
	asOfWeek: string | null;
	staleAfterWeeks: number;
	verification: Verification;
	cells: CoverageCell[];
	wanted: RankedWantedCell[];
	bands: string[];
	/** Records whose (publisher, commitment) was never anchored on chain. */
	unanchoredRecords: number;
	activeCells: number;
}

export function cellKey(geohash5: string, band: string): string {
	return `${geohash5}/${band}`;
}

export interface BuildCoverageInput {
	records?: readonly CellRecord[];
	anchors?: Map<string, Anchor>;
	mostWanted?: MostWantedDoc;
}

/**
 * Fold the loaded documents into what the map draws. A cell's first
 * surveyor is the publisher the scorer credits: the first verified capture
 * of the cell's earliest week, in (anchor tx_version, anchor event_index,
 * commitment) order — `score_cells`'s own tie-break. With no events
 * document there are no anchors, so no record can be called verified and
 * the first surveyor is left unattributed rather than guessed.
 */
export function buildCoverage(input: BuildCoverageInput): CoverageModel {
	const records = input.records ?? [];
	const anchors = input.anchors;
	const verification: Verification = anchors ? "anchored" : "unchecked";
	const staleAfterWeeks =
		input.mostWanted?.staleAfterWeeks ?? DEFAULT_STALE_AFTER_WEEKS;

	interface Bucket {
		geohash5: string;
		band: string;
		weeks: Map<
			string,
			{ order: [number, number, string]; publisher: string }[]
		>;
		observations: number;
	}
	const buckets = new Map<string, Bucket>();
	let unanchored = 0;
	const seen = new Set<string>();
	for (const record of records) {
		const dedup = [
			record.commitment,
			record.publisher,
			record.geohash5,
			record.band,
			record.isoWeek,
		].join("|");
		if (seen.has(dedup)) continue;
		seen.add(dedup);
		let order: [number, number, string] = [0, 0, record.commitment];
		if (anchors) {
			const anchor = anchors.get(record.commitment);
			if (!anchor || anchor.publisher !== record.publisher) {
				unanchored += 1;
				continue;
			}
			order = [anchor.txVersion, anchor.eventIndex, record.commitment];
		}
		const key = cellKey(record.geohash5, record.band);
		const bucket = buckets.get(key) ?? {
			geohash5: record.geohash5,
			band: record.band,
			weeks: new Map(),
			observations: 0,
		};
		const week = bucket.weeks.get(record.isoWeek) ?? [];
		week.push({ order, publisher: record.publisher });
		bucket.weeks.set(record.isoWeek, week);
		bucket.observations += 1;
		buckets.set(key, bucket);
	}

	const lastWeekOf = new Map<string, string>();
	for (const [key, bucket] of buckets) {
		const weeks = [...bucket.weeks.keys()].sort(
			(a, b) => isoWeekIndex(a) - isoWeekIndex(b),
		);
		lastWeekOf.set(key, weeks[weeks.length - 1]);
	}

	// The as-of week is the published one when a most-wanted file is loaded,
	// so the map and the list agree; otherwise the latest week in the records.
	let asOfWeek = input.mostWanted?.asOfWeek ?? null;
	if (asOfWeek === null) {
		for (const week of lastWeekOf.values()) {
			if (asOfWeek === null || isoWeekIndex(week) > isoWeekIndex(asOfWeek))
				asOfWeek = week;
		}
	}

	const staleOf = (key: string): number | null => {
		const week = lastWeekOf.get(key);
		if (week === undefined || asOfWeek === null) return null;
		return isoWeekIndex(asOfWeek) - isoWeekIndex(week);
	};
	const isActive = (key: string): boolean => {
		const stale = staleOf(key);
		return stale !== null && stale < staleAfterWeeks;
	};

	const cells: CoverageCell[] = [];
	for (const [key, bucket] of buckets) {
		const weeks = [...bucket.weeks.keys()].sort(
			(a, b) => isoWeekIndex(a) - isoWeekIndex(b),
		);
		const firstWeek = weeks[0];
		const first = [...(bucket.weeks.get(firstWeek) ?? [])].sort((a, b) => {
			for (let i = 0; i < 2; i++) {
				const left = a.order[i] as number;
				const right = b.order[i] as number;
				if (left !== right) return left - right;
			}
			return a.order[2] < b.order[2] ? -1 : a.order[2] > b.order[2] ? 1 : 0;
		})[0];
		const staleWeeks = staleOf(key) ?? 0;
		let adjacent = 0;
		for (const neighbour of geohashNeighbors(bucket.geohash5)) {
			if (isActive(cellKey(neighbour, bucket.band))) adjacent += 1;
		}
		cells.push({
			key,
			geohash5: bucket.geohash5,
			band: bucket.band,
			observations: bucket.observations,
			weeks,
			firstWeek,
			lastWeek: weeks[weeks.length - 1],
			firstSurveyedBy: anchors ? (first?.publisher ?? null) : null,
			staleWeeks,
			active: isActive(key),
			recency: recencyBucket(staleWeeks, staleAfterWeeks),
			density: densityStep(bucket.observations),
			adjacentActiveCells: adjacent,
		});
	}
	cells.sort((a, b) => a.key.localeCompare(b.key));

	const wanted = rankMostWanted(input.mostWanted?.rows ?? [], asOfWeek);
	const bands = [
		...new Set([...cells.map((c) => c.band), ...wanted.map((w) => w.band)]),
	].sort();
	return {
		asOfWeek,
		staleAfterWeeks,
		verification,
		cells,
		wanted,
		bands,
		unanchoredRecords: unanchored,
		activeCells: cells.filter((c) => c.active).length,
	};
}
