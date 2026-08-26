/** T-Deck field chart: streets, parks, water, contours on #07100F.
 *
 *  Pixel-faithful port of `paint_field_pixels` in src/sim_main.cpp. Web CHART
 *  tiles use the same east/north hash, 120 m street cells, and dark-chart
 *  colors as the device painter when Esri tiles are missing.
 */

export type FieldChartMode = "chart" | "sat";

export type FieldRgb = readonly [number, number, number];

const DEG2RAD = 0.017453292519943295;
const METERS_PER_LAT = 110540.0;
const METERS_PER_LON = 111320.0;
const CELL_M = 120.0;

export function mapHash2(x: number, y: number): number {
	let h =
		(Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x9e3779b9) >>> 0;
	h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
	return (h ^ (h >>> 16)) >>> 0;
}

export function mapValueNoise(
	worldX: number,
	worldY: number,
	cell: number,
): number {
	const gx = worldX / cell;
	const gy = worldY / cell;
	const x0 = Math.floor(gx);
	const y0 = Math.floor(gy);
	const fx = gx - x0;
	const fy = gy - y0;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const sample = (x: number, y: number) => (mapHash2(x, y) & 1023) / 1023;
	const a = sample(x0, y0);
	const b = sample(x0 + 1, y0);
	const c = sample(x0, y0 + 1);
	const d = sample(x0 + 1, y0 + 1);
	return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** C++ std::round: halves away from zero. JS Math.round halves toward +inf. */
export function mapRound(value: number): number {
	return value >= 0 ? Math.round(value) : -Math.round(-value);
}

export function mapGridDistance(value: number, step: number): number {
	const nearest = mapRound(value / step) * step;
	return Math.abs(value - nearest);
}

export function latLonToEastNorth(
	lat: number,
	lon: number,
): { east: number; north: number } {
	return {
		east: lon * METERS_PER_LON * Math.cos(lat * DEG2RAD),
		north: lat * METERS_PER_LAT,
	};
}

export function tilePixelToLatLon(
	tileX: number,
	tileY: number,
	zoom: number,
	px: number,
	py: number,
	size = 256,
): { lat: number; lon: number } {
	const n = 2 ** zoom;
	const x = (tileX + px / size) / n;
	const y = (tileY + py / size) / n;
	const lon = x * 360 - 180;
	const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
	return { lat, lon };
}

export function fieldChartRgb(
	east: number,
	north: number,
	mode: FieldChartMode = "chart",
): FieldRgb {
	const hills =
		mapValueNoise(east, north, 220.0) * 0.55 +
		mapValueNoise(east, north, 78.0) * 0.3 +
		mapValueNoise(east, north, 26.0) * 0.15;
	const water = mapValueNoise(east + 400.0, north - 180.0, 340.0);
	const cellX = Math.floor(east / CELL_M);
	const cellY = Math.floor(north / CELL_M);
	const cell = mapHash2(cellX, cellY);
	const nsRoad = (cell & 3) !== 0;
	const ewRoad = (cell & 12) !== 0;
	const park = ((cell >>> 4) % 11) === 0 && hills > 0.34 && hills < 0.62;
	const road = Math.min(
		nsRoad ? mapGridDistance(east, CELL_M) : 1e9,
		ewRoad ? mapGridDistance(north, CELL_M) : 1e9,
	);
	const alley = Math.min(
		mapGridDistance(east, 40.0),
		mapGridDistance(north, 40.0),
	);

	let red: number;
	let green: number;
	let blue: number;
	if (mode === "sat") {
		if (water < 0.31) {
			red = 18;
			green = 42;
			blue = 52;
		} else if (park) {
			red = 46;
			green = 78;
			blue = 36;
		} else if (hills < 0.4) {
			red = 58;
			green = 82;
			blue = 38;
		} else if (hills < 0.62) {
			red = 92;
			green = 88;
			blue = 48;
		} else {
			red = 132;
			green = 112;
			blue = 72;
		}
		if (road < 7.0) {
			red = 52;
			green = 50;
			blue = 46;
		} else if (alley < 3.5 && ((cell >>> 8) & 1) !== 0) {
			red = Math.trunc((red * 3) / 4);
			green = Math.trunc((green * 3) / 4);
			blue = Math.trunc((blue * 3) / 4);
		}
	} else {
		if (water < 0.31) {
			red = 8;
			green = 16;
			blue = 30;
		} else if (park) {
			red = 10;
			green = 28;
			blue = 20;
		} else {
			const band = Math.trunc(hills * 8.0);
			red = 10 + band;
			green = 16 + band;
			blue = 24 + band * 2;
		}
		if (road < 7.0) {
			red = 78;
			green = 88;
			blue = 104;
		} else if (alley < 3.5 && ((cell >>> 8) & 1) !== 0) {
			red = 36;
			green = 44;
			blue = 56;
		}
		const contour = Math.trunc(hills * 18.0);
		if (Math.abs(hills * 18.0 - contour) < 0.08 && road >= 7.0) {
			red = 28;
			green = 52;
			blue = 62;
		}
	}
	return [red, green, blue];
}

export function paintFieldChartPixels(
	pixels: Uint8ClampedArray,
	tileX: number,
	tileY: number,
	zoom: number,
	size = 256,
	mode: FieldChartMode = "chart",
): void {
	let offset = 0;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const { lat, lon } = tilePixelToLatLon(tileX, tileY, zoom, px, py, size);
			const { east, north } = latLonToEastNorth(lat, lon);
			const [r, g, b] = fieldChartRgb(east, north, mode);
			pixels[offset] = r;
			pixels[offset + 1] = g;
			pixels[offset + 2] = b;
			pixels[offset + 3] = 255;
			offset += 4;
		}
	}
}

export function paintFieldChartTile(
	ctx: CanvasRenderingContext2D,
	tileX: number,
	tileY: number,
	zoom: number,
	size = 256,
	mode: FieldChartMode = "chart",
): void {
	const image = ctx.createImageData(size, size);
	paintFieldChartPixels(image.data, tileX, tileY, zoom, size, mode);
	ctx.putImageData(image, 0, 0);
}

export function paintDarkContourPixels(
	pixels: Uint8ClampedArray,
	tileX: number,
	tileY: number,
	zoom: number,
	size = 256,
): void {
	let offset = 0;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			const { lat, lon } = tilePixelToLatLon(tileX, tileY, zoom, px, py, size);
			const { east, north } = latLonToEastNorth(lat, lon);
			const hills =
				mapValueNoise(east, north, 220.0) * 0.55 +
				mapValueNoise(east, north, 78.0) * 0.3 +
				mapValueNoise(east, north, 26.0) * 0.15;
			const contour = Math.trunc(hills * 18.0);
			const onLine = Math.abs(hills * 18.0 - contour) < 0.08;
			const major = contour % 5 === 0;
			pixels[offset] = major ? 255 : 214;
			pixels[offset + 1] = major ? 224 : 190;
			pixels[offset + 2] = major ? 140 : 118;
			pixels[offset + 3] = onLine ? (major ? 230 : 170) : 0;
			offset += 4;
		}
	}
}

/** Gold contours from the same hills as `paint_field_pixels`, for the web MAP
 *  chip. Device dark rgb565 is Carto streets plus these index lines. */
export function paintDarkContourTile(
	ctx: CanvasRenderingContext2D,
	tileX: number,
	tileY: number,
	zoom: number,
	size = 256,
): void {
	const image = ctx.createImageData(size, size);
	paintDarkContourPixels(image.data, tileX, tileY, zoom, size);
	ctx.putImageData(image, 0, 0);
}

export function contourIntervalForZoom(zoom: number): number {
	if (zoom >= 15) return 10;
	if (zoom >= 12) return 20;
	return 50;
}

export function terrariumMeters(red: number, green: number, blue: number): number {
	return red * 256 + green + blue / 256 - 32768;
}

/** Gold index lines from Mapzen terrarium RGB, matching scripts/fetch_satellite_map.py. */
export function paintTerrariumContourPixels(
	pixels: Uint8ClampedArray,
	rgba: Uint8ClampedArray,
	size: number,
	interval: number,
): void {
	const elev = new Float32Array(size * size);
	for (let i = 0; i < size * size; i++) {
		const o = i * 4;
		elev[i] = terrariumMeters(rgba[o], rgba[o + 1], rgba[o + 2]);
	}
	const marks = new Uint8Array(size * size);
	const crosses = (a: number, b: number) => {
		if (a < 2 || b < 2) return false;
		return Math.floor(a / interval) !== Math.floor(b / interval);
	};
	const majorBetween = (a: number, b: number) => {
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		const step = interval * 5;
		const level = Math.ceil(lo / step) * step;
		return level < hi - 1e-6;
	};
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const here = elev[y * size + x];
			let hit = false;
			let major = false;
			if (x + 1 < size && crosses(here, elev[y * size + x + 1])) {
				hit = true;
				major = majorBetween(here, elev[y * size + x + 1]);
			}
			if (y + 1 < size && crosses(here, elev[(y + 1) * size + x])) {
				hit = true;
				major = major || majorBetween(here, elev[(y + 1) * size + x]);
			}
			if (hit) marks[y * size + x] = major ? 2 : 1;
		}
	}
	pixels.fill(0);
	const put = (i: number, r: number, g: number, b: number, a: number) => {
		const o = i * 4;
		pixels[o] = r;
		pixels[o + 1] = g;
		pixels[o + 2] = b;
		pixels[o + 3] = a;
	};
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (marks[y * size + x] === 0) continue;
			for (const [nx, ny] of [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1],
			] as const) {
				if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
				if (marks[ny * size + nx] !== 0) continue;
				put(ny * size + nx, 0, 0, 0, 140);
			}
		}
	}
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const mark = marks[y * size + x];
			if (mark === 2) put(y * size + x, 255, 224, 140, 234);
			else if (mark === 1) put(y * size + x, 214, 190, 118, 178);
		}
	}
}
