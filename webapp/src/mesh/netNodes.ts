/**
 * The internet's view of the mesh, folded into the node store as rumour.
 *
 * A radio shows what it hears; the public MQTT map shows what every uplinked
 * radio everywhere heard. Both are true and they are not the same thing, so
 * rows arriving here are marked viaNet and the map paints them amber — the
 * same provenance rule the firmware applies to bridged frames. A node the
 * radio has actually heard is never overwritten by the rumour of it: RF
 * truth outranks the internet's memory.
 */

import { getDeviceLinkState, sendDeviceLine } from "../lib/deviceLink";
import { getSnapshot, mutate, type NodeEntry } from "./store";

export interface NetNodeRow {
	num: number;
	longName: string;
	shortName: string;
	lat: number;
	lon: number;
	updatedAt: number;
}

/** Fold fetched rows into the store. Pure over its inputs apart from the
 *  store write; returns how many rows were applied (new or refreshed rumour)
 *  versus skipped because the radio itself has heard that node. */
export function applyNetNodes(rows: NetNodeRow[]): { applied: number; radioWins: number } {
	let applied = 0;
	let radioWins = 0;
	const { myNodeNum } = getSnapshot();
	mutate((s) => {
		const next = new Map(s.nodes);
		for (const row of rows) {
			if (!row.num || row.num === myNodeNum) continue;
			const prior = next.get(row.num);
			if (prior && !prior.viaNet) {
				// The radio has genuinely heard this node; keep its truth and
				// only fill a position it never learned.
				radioWins++;
				if (prior.lat === undefined && Number.isFinite(row.lat)) {
					next.set(row.num, { ...prior, lat: row.lat, lon: row.lon });
				}
				continue;
			}
			const entry: NodeEntry = {
				num: row.num,
				longName: row.longName || `!${row.num.toString(16).padStart(8, "0")}`,
				shortName: row.shortName || row.num.toString(16).slice(-4).toUpperCase(),
				lastHeard: Math.floor(row.updatedAt / 1000),
				lat: row.lat,
				lon: row.lon,
				viaNet: true,
			};
			next.set(row.num, entry);
			applied++;
		}
		s.nodes = next;
	});
	return { applied, radioWins };
}

const REFRESH_MS = 10 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | undefined;

async function fetchOnce(): Promise<void> {
	const s = getSnapshot();
	// Centre on the connected device's own position when it has one; a Bay
	// Area default otherwise, because that is where this mesh lives today.
	const me = s.myNodeNum !== undefined ? s.nodes.get(s.myNodeNum) : undefined;
	const lat = me?.lat ?? 37.8;
	const lon = me?.lon ?? -122.2;
	const response = await fetch(`/api/net-nodes?lat=${lat}&lon=${lon}&km=80`);
	if (!response.ok) return;
	const body = (await response.json()) as { nodes?: NetNodeRow[] };
	if (!body.nodes?.length) return;
	applyNetNodes(body.nodes);
	// A T-Deck on USB gets the same rumours, so its own map and node list
	// carry the neighbourhood too. Nearest first; the deck keeps sixteen.
	if (getDeviceLinkState().status === "linked") {
		const cosLat = Math.cos((lat * Math.PI) / 180);
		const nearest = [...body.nodes]
			.sort((a, b) => {
				const da = (a.lat - lat) ** 2 + ((a.lon - lon) * cosLat) ** 2;
				const db = (b.lat - lat) ** 2 + ((b.lon - lon) * cosLat) ** 2;
				return da - db;
			})
			.slice(0, 16);
		for (const row of nearest) {
			const label =
				(row.shortName || row.num.toString(16).slice(-4)).replace(/\s+/g, "").slice(0, 8) ||
				"NODE";
			await sendDeviceLine(
				`LSK NODE ${row.num.toString(16).padStart(8, "0")} ${Math.round(row.lat * 1e7)} ${Math.round(row.lon * 1e7)} ${label}`,
			).catch(() => {});
		}
	}
}

/** Begin the rumour layer: one fetch now, then every ten minutes. Safe to
 *  call twice; there is only ever one timer. */
export function startNetNodes(): void {
	if (timer !== undefined) return;
	void fetchOnce().catch(() => {});
	timer = setInterval(() => void fetchOnce().catch(() => {}), REFRESH_MS);
}

export function stopNetNodes(): void {
	if (timer !== undefined) clearInterval(timer);
	timer = undefined;
}
