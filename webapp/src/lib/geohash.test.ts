/**
 * geohash.ts against the Python side.
 *
 * Every expectation here was read out of scripts/field_receipts_score.py
 * itself, e.g.
 *
 *   python3 -c "import sys; sys.path.insert(0,'scripts'); \
 *     import field_receipts_score as f; print(f.geohash_decode('u4pru'))"
 *   -> (57.6123046875, 57.65625, 10.37109375, 10.4150390625)
 *
 * so a divergence between the browser's boxes and the scorer's cells fails
 * here rather than by drawing a rectangle in the wrong place. Geohash edges
 * are exact binary fractions of the degree ranges, so both sides land on
 * bit-identical doubles and the comparisons are exact, not approximate.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
	decodeGeohash,
	encodeGeohash,
	GEOHASH_BASE32,
	GEOHASH5_VECTOR,
	GeohashError,
	geohashCenter,
	geohashNeighbors,
	geohashSpanKm,
} from "./geohash";

/** f.geohash_decode(<key>) for each cell. */
const DECODED: Record<string, [number, number, number, number]> = {
	u4pru: [57.6123046875, 57.65625, 10.37109375, 10.4150390625],
	u4prt: [57.568359375, 57.6123046875, 10.4150390625, 10.458984375],
	u4r2h: [57.65625, 57.7001953125, 10.37109375, 10.4150390625],
	ezs42: [42.5830078125, 42.626953125, -5.625, -5.5810546875],
	gcpvj: [51.50390625, 51.5478515625, -0.1318359375, -0.087890625],
	xn774: [35.68359375, 35.7275390625, 139.658203125, 139.7021484375],
	s0000: [0, 0.0439453125, 0, 0.0439453125],
	zzzzz: [89.9560546875, 90, 179.9560546875, 180],
	"00000": [-90, -89.9560546875, -180, -179.9560546875],
};

test("the published vector decodes to the scorer's box", () => {
	assert.deepEqual(
		decodeGeohash(GEOHASH5_VECTOR.geohash5),
		GEOHASH5_VECTOR.box,
	);
	const box = GEOHASH5_VECTOR.box;
	assert.ok(
		GEOHASH5_VECTOR.lat > box.latMin &&
			GEOHASH5_VECTOR.lat < box.latMax &&
			GEOHASH5_VECTOR.lon > box.lonMin &&
			GEOHASH5_VECTOR.lon < box.lonMax,
		"the vector coordinate has to sit inside the box it encodes to",
	);
});

test("the published vector encodes the way the scorer encodes it", () => {
	assert.equal(
		encodeGeohash(GEOHASH5_VECTOR.lat, GEOHASH5_VECTOR.lon, 5),
		GEOHASH5_VECTOR.geohash5,
	);
	// f.geohash_encode(57.64911, 10.40744, 7) -> 'u4pruyd'
	assert.equal(
		encodeGeohash(GEOHASH5_VECTOR.lat, GEOHASH5_VECTOR.lon, 7),
		"u4pruyd",
	);
});

test("decode matches the Python boxes, corners included", () => {
	for (const [geohash, [latMin, latMax, lonMin, lonMax]] of Object.entries(
		DECODED,
	)) {
		assert.deepEqual(
			decodeGeohash(geohash),
			{ latMin, latMax, lonMin, lonMax },
			geohash,
		);
	}
});

test("encode matches the Python encoder", () => {
	// f.geohash_encode(51.5074, -0.1278, 5) etc.
	assert.equal(encodeGeohash(51.5074, -0.1278, 5), "gcpvj");
	assert.equal(encodeGeohash(35.6895, 139.6917, 5), "xn774");
	assert.equal(encodeGeohash(-33.8688, 151.2093, 6), "r3gx2f");
	assert.equal(encodeGeohash(0, 0, 5), "s0000");
	assert.equal(encodeGeohash(-90, -180, 5), "00000");
	assert.equal(encodeGeohash(90, 180, 5), "zzzzz");
});

test("a box centre re-encodes to the same cell", () => {
	for (const geohash of Object.keys(DECODED)) {
		const centre = geohashCenter(geohash);
		assert.equal(encodeGeohash(centre.lat, centre.lon, 5), geohash, geohash);
	}
});

test("neighbours match the scorer, wrap and pole cases included", () => {
	// f.geohash_neighbors(...) for each of these.
	assert.deepEqual(geohashNeighbors("u4pru"), [
		"u4pre",
		"u4prg",
		"u4prs",
		"u4prt",
		"u4prv",
		"u4r25",
		"u4r2h",
		"u4r2j",
	]);
	assert.deepEqual(geohashNeighbors("u000h"), [
		"spbpg",
		"spbpu",
		"spbpv",
		"u0005",
		"u0007",
		"u000j",
		"u000k",
		"u000m",
	]);
	assert.deepEqual(geohashNeighbors("s0000"), [
		"7zzzz",
		"ebpbp",
		"ebpbr",
		"kpbpb",
		"kpbpc",
		"s0001",
		"s0002",
		"s0003",
	]);
	// The pole drops three of the eight, and the antimeridian wraps the rest.
	assert.deepEqual(geohashNeighbors("zzzzz"), [
		"bpbp8",
		"bpbpb",
		"zzzzw",
		"zzzzx",
		"zzzzy",
	]);
	assert.deepEqual(geohashNeighbors("00000"), [
		"00001",
		"00002",
		"00003",
		"pbpbp",
		"pbpbr",
	]);
});

test("neighbourhood is symmetric across a cell pair", () => {
	for (const neighbour of geohashNeighbors("u4pru")) {
		assert.ok(
			geohashNeighbors(neighbour).includes("u4pru"),
			`${neighbour} must have u4pru back`,
		);
	}
});

test("the alphabet is the geohash alphabet", () => {
	assert.equal(GEOHASH_BASE32.length, 32);
	for (const forbidden of ["a", "i", "l", "o"]) {
		assert.ok(!GEOHASH_BASE32.includes(forbidden), forbidden);
	}
});

test("a cell that is not a geohash is refused, not guessed", () => {
	assert.throws(() => decodeGeohash("u4pra"), GeohashError);
	assert.throws(() => decodeGeohash(""), GeohashError);
	assert.throws(() => encodeGeohash(0, 0, 0), GeohashError);
});

test("a geohash-5 cell is about five kilometres across", () => {
	const span = geohashSpanKm(GEOHASH5_VECTOR.geohash5);
	assert.ok(Math.abs(span.heightKm - 4.9) < 0.1, `${span.heightKm} km tall`);
	// 10.4 E at 57.6 N: the box narrows with the cosine of the latitude.
	assert.ok(span.widthKm > 2.5 && span.widthKm < 3, `${span.widthKm} km wide`);
	const equator = geohashSpanKm("s0000");
	assert.ok(
		Math.abs(equator.widthKm - 4.9) < 0.1,
		`${equator.widthKm} km wide`,
	);
});
