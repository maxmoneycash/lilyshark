import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
	fieldChartRgb,
	latLonToEastNorth,
	mapGridDistance,
	mapHash2,
	mapRound,
	mapValueNoise,
	contourIntervalForZoom,
	paintDarkContourPixels,
	paintFieldChartPixels,
	paintTerrariumContourPixels,
	terrariumMeters,
	tilePixelToLatLon,
} from "./fieldChart.ts";

assert.equal(mapHash2(0, 0), 0x92e15423);
assert.equal(mapHash2(1, 0), 0x7b353ad0);
assert.equal(mapHash2(-1, 2), 0x71972406);
assert.equal(mapHash2(37, -122), 0x7907182c);

assert.equal(mapRound(1.5), 2);
assert.equal(mapRound(-1.5), -2);
assert.equal(mapRound(-0.5), -1);

assert.ok(mapGridDistance(120, 120) < 1e-9);
assert.ok(mapGridDistance(123.4, 120) < 4);

const n0 = mapValueNoise(0, 0, 220);
assert.ok(n0 >= 0 && n0 <= 1);

const water = fieldChartRgb(-13635000, 4175000);
assert.deepEqual(water, [8, 16, 30]);

const road = fieldChartRgb(0, 0);
assert.deepEqual([...road], [78, 88, 104]);

const land = fieldChartRgb(37, 41);
assert.deepEqual([...land], [12, 18, 28]);

const satLand = fieldChartRgb(37, 41, "sat");
assert.ok(satLand[0] > land[0], "sat land is warmer than the night chart");

const { lat, lon } = tilePixelToLatLon(5242, 12664, 15, 0, 0);
assert.ok(lat > 37.7 && lat < 37.8);
assert.ok(lon < -122.3 && lon > -122.5);

const en = latLonToEastNorth(37.7749, -122.4194);
assert.ok(en.east < 0 && en.north > 0);

const size = 32;
const pixels = new Uint8ClampedArray(size * size * 4);
paintFieldChartPixels(pixels, 5242, 12664, 15, size);

const colors = new Set<string>();
let waterPx = 0;
let roadPx = 0;
let contourPx = 0;
for (let i = 0; i < pixels.length; i += 4) {
	const r = pixels[i];
	const g = pixels[i + 1];
	const b = pixels[i + 2];
	assert.equal(pixels[i + 3], 255);
	colors.add(`${r},${g},${b}`);
	if (r === 8 && g === 16 && b === 30) waterPx++;
	if (r === 78 && g === 88 && b === 104) roadPx++;
	if (r === 28 && g === 52 && b === 62) contourPx++;
}
assert.ok(colors.size >= 8, `chart tile too flat: ${colors.size} colors`);
assert.ok(roadPx > 0, "street cells missing");
assert.ok(waterPx + contourPx + roadPx < size * size, "need land besides roads");

const src = readFileSync(new URL("./fieldChart.ts", import.meta.url), "utf8");
assert.match(src, /paint_field_pixels/);
assert.match(src, /120 m street/);
assert.doesNotMatch(src, /for \(let i = 0; i < 256; i \+= 32\)/);

const contour = new Uint8ClampedArray(size * size * 4);
paintDarkContourPixels(contour, 5242, 12664, 15, size);
let gold = 0;
let clear = 0;
for (let i = 0; i < contour.length; i += 4) {
	if (contour[i + 3] === 0) clear++;
	else gold++;
}
assert.ok(gold > 0 && clear > gold, "dark overlay must be sparse gold contours");

assert.equal(contourIntervalForZoom(16), 10);
assert.equal(contourIntervalForZoom(12), 20);
assert.equal(terrariumMeters(128, 0, 0), 0);

const ramp = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y++) {
	for (let x = 0; x < size; x++) {
		const meters = x * 4;
		const packed = meters + 32768;
		const i = (y * size + x) * 4;
		ramp[i] = (packed >> 8) & 255;
		ramp[i + 1] = packed & 255;
		ramp[i + 2] = 0;
		ramp[i + 3] = 255;
	}
}
const terra = new Uint8ClampedArray(size * size * 4);
paintTerrariumContourPixels(terra, ramp, size, 10);
let terraGold = 0;
for (let i = 0; i < terra.length; i += 4) {
	if (terra[i + 3] > 160 && terra[i] > 200) terraGold++;
}
assert.ok(terraGold > 0, "terrarium ramp must draw gold index lines");

console.log("fieldChart.test.ts OK");
