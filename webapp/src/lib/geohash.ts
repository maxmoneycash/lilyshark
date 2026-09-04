/**
 * Geohash base-32, the cell grid the coverage layer buckets into.
 *
 * A geohash cell is exact in degrees: bisect longitude and latitude
 * alternately, one bit at a time, five bits per character. That is what
 * makes it the right grid here — a cell has hard edges that can be drawn as
 * a rectangle without a projection, and two implementations that walk the
 * same bisection land on bit-identical doubles rather than on values that
 * merely round the same way.
 *
 * This is a straight port of `geohash_decode`, `geohash_encode` and
 * `geohash_neighbors` in scripts/field_receipts_score.py — the same
 * bisection in the same order, including the edge cases — so a cell named
 * in either place means the same box. geohash.test.ts pins the port against
 * values read out of that script.
 *
 * Nothing here is a projection or a rounding: the decode returns a box's
 * edges, not its centre, and `geohashSpanKm` is the only function that
 * leaves degrees, which is why it is documented as approximate.
 */

/** Base-32 alphabet of the geohash encoding: no a, i, l or o. */
export const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Degrees box of a geohash cell. */
export interface GeohashBox {
	latMin: number;
	latMax: number;
	lonMin: number;
	lonMax: number;
}

/**
 * The cross-implementation vector. 57.64911 N, 10.40744 E (Skagen, Denmark)
 * encodes to `u4pru` at length 5 in scripts/field_receipts_score.py; the
 * box is what that script's `geohash_decode("u4pru")` returns.
 */
export const GEOHASH5_VECTOR = {
	geohash5: "u4pru",
	lat: 57.64911,
	lon: 10.40744,
	box: {
		latMin: 57.6123046875,
		latMax: 57.65625,
		lonMin: 10.37109375,
		lonMax: 10.4150390625,
	} as GeohashBox,
} as const;

export class GeohashError extends Error {}

/** The (latMin, latMax, lonMin, lonMax) box a geohash string names. */
export function decodeGeohash(geohash: string): GeohashBox {
	if (geohash.length === 0) throw new GeohashError("empty geohash");
	const lat = [-90, 90];
	const lon = [-180, 180];
	let even = true;
	for (const ch of geohash) {
		const idx = GEOHASH_BASE32.indexOf(ch);
		if (idx < 0)
			throw new GeohashError(
				`invalid geohash character ${JSON.stringify(ch)} in ${JSON.stringify(geohash)}`,
			);
		for (const bit of [16, 8, 4, 2, 1]) {
			const range = even ? lon : lat;
			const mid = (range[0] + range[1]) / 2;
			if (idx & bit) range[0] = mid;
			else range[1] = mid;
			even = !even;
		}
	}
	return { latMin: lat[0], latMax: lat[1], lonMin: lon[0], lonMax: lon[1] };
}

/**
 * The geohash of a coordinate at the requested length.
 *
 * The non-finite guard is the one place this diverges from the Python: a
 * NaN fails every `value >= mid` test and would encode silently to
 * `00000…`, a real cell at the south-west corner of the grid. Refusing is
 * the only safe answer for a coordinate that does not exist.
 */
export function encodeGeohash(
	lat: number,
	lon: number,
	length: number,
): string {
	if (!Number.isInteger(length) || length < 1)
		throw new GeohashError(
			`geohash length must be a positive integer, got ${length}`,
		);
	if (!Number.isFinite(lat) || !Number.isFinite(lon))
		throw new GeohashError(`geohash of a non-finite coordinate: ${lat},${lon}`);
	const out: string[] = [];
	const latRange = [-90, 90];
	const lonRange = [-180, 180];
	let even = true;
	let idx = 0;
	let bits = 0;
	while (out.length < length) {
		const range = even ? lonRange : latRange;
		const value = even ? lon : lat;
		const mid = (range[0] + range[1]) / 2;
		idx <<= 1;
		if (value >= mid) {
			idx |= 1;
			range[0] = mid;
		} else {
			range[1] = mid;
		}
		even = !even;
		bits += 1;
		if (bits === 5) {
			out.push(GEOHASH_BASE32[idx]);
			idx = 0;
			bits = 0;
		}
	}
	return out.join("");
}

/** Centre of a geohash box, for a label or a map fit. */
export function geohashCenter(geohash: string): { lat: number; lon: number } {
	const box = decodeGeohash(geohash);
	return {
		lat: (box.latMin + box.latMax) / 2,
		lon: (box.lonMin + box.lonMax) / 2,
	};
}

/**
 * The up-to-8 same-length neighbours, by centre-shift re-encoding — the
 * method `geohash_neighbors` uses in the scorer, including its edge cases:
 * longitude wraps at the antimeridian, and a shift past a pole is dropped
 * rather than clamped, so polar cells report fewer than eight neighbours.
 */
export function geohashNeighbors(geohash: string): string[] {
	const box = decodeGeohash(geohash);
	const latC = (box.latMin + box.latMax) / 2;
	const lonC = (box.lonMin + box.lonMax) / 2;
	const dLat = box.latMax - box.latMin;
	const dLon = box.lonMax - box.lonMin;
	const found = new Set<string>();
	for (const stepLat of [-dLat, 0, dLat]) {
		for (const stepLon of [-dLon, 0, dLon]) {
			if (stepLat === 0 && stepLon === 0) continue;
			const lat = latC + stepLat;
			if (!(lat > -90 && lat < 90)) continue;
			let lon = lonC + stepLon;
			if (lon >= 180) lon -= 360;
			else if (lon < -180) lon += 360;
			const candidate = encodeGeohash(lat, lon, geohash.length);
			if (candidate !== geohash) found.add(candidate);
		}
	}
	return [...found].sort();
}

/**
 * Rough metres per degree of latitude, used only to state a cell's size on
 * screen. A geohash-5 box is 4.9 km tall everywhere and 4.9 km wide at the
 * equator, narrowing with the cosine of the latitude.
 */
const METRES_PER_DEGREE_LAT = 111_320;

/** Approximate width x height of a geohash box in kilometres, at its centre. */
export function geohashSpanKm(geohash: string): {
	widthKm: number;
	heightKm: number;
} {
	const box = decodeGeohash(geohash);
	const latC = (box.latMin + box.latMax) / 2;
	return {
		widthKm:
			((box.lonMax - box.lonMin) *
				METRES_PER_DEGREE_LAT *
				Math.cos((latC * Math.PI) / 180)) /
			1000,
		heightKm: ((box.latMax - box.latMin) * METRES_PER_DEGREE_LAT) / 1000,
	};
}
