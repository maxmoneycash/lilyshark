/**
 * The ACTIVITY heatmap: rows are nodes, columns are hours.
 *
 * This is out here rather than inside a `useMemo` because of how it failed.
 * The rows come from the `sightings` store, whose records are
 * `{node, hourBucket, n}` — but the screen declared its state as
 * `{node, hhmm, n}` and binned with `r.hhmm`. No row has an `hhmm`, so every
 * count in every node's map went under the single key `undefined`, and the
 * render — which looks each hour up by its bucket number — found nothing and
 * drew 0. The grid showed a mesh where nobody had been heard in any hour,
 * while the TOTAL column beside it was correct, because a total sums the
 * map's values and never looks at its keys. A wrong bin key is invisible
 * until you check a cell against a total, and nothing did.
 *
 * A function with no React in it can be checked against exactly that: given
 * rows, does a cell agree with the total beside it.
 */

/** One row of the sightings store, spelled the way the store spells it. */
export interface Sighting {
	node: number;
	/** Whole hours since the epoch — `Math.floor(ms / 3_600_000)`. */
	hourBucket: number;
	n: number;
}

export interface ActivityRow {
	node: number;
	/** Hour bucket to count. Absent means zero, and means it: see below. */
	cells: Map<number, number>;
	total: number;
}

export interface ActivityGrid {
	/** The columns, oldest first, one per hour in the window. */
	hours: number[];
	/** Rows, busiest first. */
	rows: ActivityRow[];
	/** The busiest single cell, for scaling the shading. Never below 1. */
	max: number;
}

/**
 * Bin sightings into the grid.
 *
 * `nowHour` is passed in rather than read from the clock so this is a pure
 * function of its inputs — a grid that depends on when it ran cannot be
 * checked, and the bug above is exactly the kind that hides there.
 *
 * A node heard zero times in an hour has no entry for it. That is a real
 * zero, not a missing measurement: the sightings store counts everything the
 * radio decoded, so an hour with no row is an hour with nothing heard. The
 * grid renders a 0 for it, which is the truth and not an absence.
 */
export function activityGrid(
	sightings: readonly Sighting[],
	hoursWide: number,
	nowHour: number,
): ActivityGrid {
	const hours = Array.from({ length: hoursWide }, (_, i) => nowHour - hoursWide + 1 + i);
	const byNode = new Map<number, Map<number, number>>();
	let max = 1;
	for (const r of sightings) {
		const m = byNode.get(r.node) ?? new Map<number, number>();
		const binned = (m.get(r.hourBucket) ?? 0) + r.n;
		m.set(r.hourBucket, binned);
		byNode.set(r.node, m);
		// Scale on the BINNED total, not the raw row. Two rows for the same
		// node and hour add up in one cell, and shading against the larger
		// row alone would draw that cell past full.
		if (binned > max) max = binned;
	}
	const rows = [...byNode.entries()]
		.map(([node, cells]) => ({
			node,
			cells,
			total: [...cells.values()].reduce((a, b) => a + b, 0),
		}))
		.sort((a, b) => b.total - a.total || a.node - b.node);
	return { hours, rows, max };
}
