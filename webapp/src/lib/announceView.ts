/**
 * Reading Reticulum announces off a capture, and rolling them up per
 * destination: who announced, what identity they announced, and the path
 * each announce travelled to reach this receiver.
 *
 * Everything here is derived from the semantic announce tier in
 * dissect/rnode.ts, which is itself a port of readReticulumAnnounce in
 * src/core/reticulum_decoder.cpp. That tier reads only what length and flag
 * arithmetic prove about a cleartext announce header and payload layout. No
 * key is held, no signature is checked, and no application payload byte is
 * interpreted — so nothing in this module may claim otherwise. The announced
 * identity is the key and hashes AS SENT, never a confirmed identity, and
 * app_data is a length here: it is never a name, a message, or a node.
 *
 * "Path" means exactly what RETICULUM_PATH_CAVEAT says: a hop count and, in
 * a HEADER_2 frame, one transport instance. Everything this module says about
 * routes is that pair, observed at this receiver, over time. A destination
 * heard on two different paths is a fact about this capture, not a claim
 * about how the network routes.
 *
 * "Announce share" always means a destination's share of THIS CAPTURE'S
 * ANNOUNCES — never a share of total traffic, and never a duty cycle. When
 * the capture reports per-frame airtime the share is computed over announce
 * airtime; otherwise it falls back to announce count and says which one it
 * used.
 *
 * Pure arithmetic over plain data, so it runs under node:test with no DOM
 * (announceView.test.ts).
 */

import { dissectFrame } from "./dissect/registry";
import type { ReticulumPath } from "./dissect/rnode";
import { reticulumPathKey, reticulumPathLabel } from "./dissect/rnode";
import { hexBytes } from "./dissect/types";
import { profileProtocol } from "./profileProtocol";
import { frameTimeS } from "./trafficView";

/** The slice of an LscapFrame announce reading needs. */
export interface AnnounceSourceFrame {
	timestampUs: bigint;
	bytes: Uint8Array;
	truncated: boolean;
	/** Capture profile id, or null when the frame never reported one. */
	profileId: number | null;
	/** Microseconds on air, or null when the capture omits the field. */
	airtimeUs: number | null;
}

/**
 * What an announce says about the identity behind its destination hash: a
 * 64-byte public key, the 10-byte name hash, the 10-byte random hash, and the
 * ratchet key when the header's context flag promised one — all as announced.
 *
 * RNS derives a destination hash from this key and the name hash, so checking
 * that this identity is really the one addressed means hashing the announced
 * key. No crypto runs here, so that check is not made and these bytes stay
 * what the sender said, not what anything confirmed.
 */
export interface AnnounceIdentity {
	/** 64 bytes: 32B X25519 + 32B Ed25519, lowercase hex. */
	publicKeyHex: string;
	nameHashHex: string;
	randomHashHex: string;
	/** Present only where the context flag promised a ratchet. */
	ratchetHex: string | null;
}

/** One announce, read from one frame. */
export interface AnnounceReading {
	/** Full 16-byte destination hash the announce is for, lowercase hex. */
	destinationHashHex: string;
	headerType: 1 | 2;
	/** Hop count and, on a HEADER_2 frame, the transport instance named. */
	path: ReticulumPath;
	identity: AnnounceIdentity;
	/** Length of the application-defined tail. A length, nothing more. */
	appDataLength: number;
}

/**
 * Read one frame's announce, or null when the frame carries none that length
 * and flag arithmetic can prove — which is every non-announce Reticulum
 * frame, every truncated capture of one, and every frame the C++ reader would
 * refuse. The caller has already decided this frame is Reticulum; this
 * function never guesses a protocol.
 */
export function readAnnounce(
	bytes: Uint8Array,
	opts: { truncated?: boolean } = {},
): AnnounceReading | null {
	const { primary } = dissectFrame(bytes, "reticulum", opts);
	if (primary.protocol !== "Reticulum") return null;
	const announce = primary.fields?.announce;
	if (!announce) return null;
	// Every hex below is sliced at a range the dissector placed, so the field
	// layout is stated in exactly one place — dissect/rnode.ts — and this
	// module cannot drift from it.
	return {
		destinationHashHex: announce.destinationHashHex,
		headerType: announce.headerType,
		path: { hops: announce.hops, transportIdHex: announce.transportIdHex },
		identity: {
			publicKeyHex: hexBytes(
				bytes,
				announce.publicKeyRange.offset,
				announce.publicKeyRange.length,
			),
			nameHashHex: announce.nameHashHex,
			randomHashHex: announce.randomHashHex,
			ratchetHex: announce.ratchetRange
				? hexBytes(
						bytes,
						announce.ratchetRange.offset,
						announce.ratchetRange.length,
					)
				: null,
		},
		appDataLength: announce.appDataLength,
	};
}

/** One announce placed on the capture clock. */
export interface AnnounceObservation extends AnnounceReading {
	/** Index into the capture's frame list — what a row click filters to. */
	frameIndex: number;
	/** Seconds from the capture's first frame. */
	timeS: number;
	airtimeUs: number | null;
}

/** One path a destination was heard on, and how often. */
export interface AnnouncePathObservation {
	path: ReticulumPath;
	/** reticulumPathKey — the identity of this path as one string. */
	key: string;
	/** reticulumPathLabel — the path in words. */
	label: string;
	count: number;
	firstSeenS: number;
	lastSeenS: number;
}

/** Every announce one destination hash made, rolled up. */
export interface AnnounceDestination {
	destinationHashHex: string;
	/** First 8 hex characters — how a row names the destination at a glance. */
	prefix: string;
	count: number;
	firstSeenS: number;
	lastSeenS: number;
	/**
	 * Mean gap between consecutive announces, seconds — the cadence. Null
	 * with a single announce: one observation is not a cadence.
	 */
	meanIntervalS: number | null;
	minHops: number;
	maxHops: number;
	/**
	 * The distinct paths this destination was heard on, most-heard first.
	 * More than one means this receiver heard the same destination arrive
	 * differently during the capture; which of them the network "prefers" is
	 * not something a passive capture can say.
	 */
	paths: AnnouncePathObservation[];
	/**
	 * Consecutive announces whose path differed. This is a change in what was
	 * observed at this receiver, not a claim about the network's routing.
	 */
	pathChanges: number;
	/**
	 * Distinct public keys announced for this destination hash. One is the
	 * ordinary case. More than one is worth showing and not worth explaining:
	 * a re-keyed identity and two things announcing one hash look identical
	 * from outside.
	 */
	distinctIdentityCount: number;
	/** How many of the announces carried each optional field. */
	ratchetCount: number;
	appDataCount: number;
	/** Announces that arrived on a HEADER_2 frame naming a transport instance. */
	transportedCount: number;
	/** This destination's announces, oldest first. */
	observations: AnnounceObservation[];
	/** Share of the capture's announces, by count, 0–100. */
	countSharePercent: number;
	/**
	 * Share of the capture's announce airtime, 0–100 — null when the capture
	 * does not report airtime for every announce frame.
	 */
	airtimeSharePercent: number | null;
}

export interface AnnounceOverview {
	/**
	 * Frames whose capture profile named Reticulum. Drives the honest empty
	 * state: no Reticulum frames means there is nothing to say at all.
	 */
	reticulumFrameCount: number;
	announceCount: number;
	/** Reticulum frames that carried no provable announce. */
	structuralOnlyCount: number;
	destinations: AnnounceDestination[];
	/** Capture-clock span the per-destination timelines are drawn over. */
	firstSeenS: number;
	lastSeenS: number;
	/** True when the share figures above are airtime rather than count. */
	shareIsAirtime: boolean;
}

/** The empty overview — a capture with no Reticulum frames at all. */
const EMPTY: AnnounceOverview = {
	reticulumFrameCount: 0,
	announceCount: 0,
	structuralOnlyCount: 0,
	destinations: [],
	firstSeenS: 0,
	lastSeenS: 0,
	shareIsAirtime: false,
};

/**
 * Read every frame whose capture profile names Reticulum and collect the
 * announces among them. Frames of other protocols are not guessed at — the
 * profile decides, exactly as the firmware's registry is profile-gated, and
 * the profile table itself lives in lib/profileProtocol.ts.
 */
export function collectAnnounces(
	frames: readonly AnnounceSourceFrame[],
	t0Us: bigint,
): { observations: AnnounceObservation[]; reticulumFrameCount: number } {
	const observations: AnnounceObservation[] = [];
	let reticulumFrameCount = 0;
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		if (profileProtocol(frame.profileId) !== "reticulum") continue;
		reticulumFrameCount++;
		const reading = readAnnounce(frame.bytes, { truncated: frame.truncated });
		if (!reading) continue;
		observations.push({
			...reading,
			frameIndex: i,
			timeS: frameTimeS(frame, t0Us),
			airtimeUs: frame.airtimeUs,
		});
	}
	return { observations, reticulumFrameCount };
}

/** The distinct paths a destination's announces arrived on, most-heard first. */
function rollUpPaths(
	observations: readonly AnnounceObservation[],
): AnnouncePathObservation[] {
	const byKey = new Map<string, AnnouncePathObservation>();
	for (const o of observations) {
		const key = reticulumPathKey(o.path);
		const seen = byKey.get(key);
		if (seen) {
			seen.count++;
			seen.lastSeenS = Math.max(seen.lastSeenS, o.timeS);
			seen.firstSeenS = Math.min(seen.firstSeenS, o.timeS);
		} else {
			byKey.set(key, {
				path: o.path,
				key,
				label: reticulumPathLabel(o.path),
				count: 1,
				firstSeenS: o.timeS,
				lastSeenS: o.timeS,
			});
		}
	}
	return [...byKey.values()].sort(
		(a, b) =>
			b.count - a.count ||
			a.firstSeenS - b.firstSeenS ||
			a.key.localeCompare(b.key),
	);
}

/**
 * Roll a capture up into one row per destination hash, ordered by how much of
 * the capture's announce traffic each accounts for (ties broken by who
 * announced first, then by hash so the order never wobbles).
 */
export function summarizeAnnounces(
	frames: readonly AnnounceSourceFrame[],
	t0Us: bigint,
): AnnounceOverview {
	const { observations, reticulumFrameCount } = collectAnnounces(frames, t0Us);
	if (reticulumFrameCount === 0) return EMPTY;
	if (observations.length === 0) {
		return {
			...EMPTY,
			reticulumFrameCount,
			structuralOnlyCount: reticulumFrameCount,
		};
	}

	// Airtime shares are only offered when every announce frame reports one;
	// a partial sum would quietly under-count somebody.
	const totalAirtimeUs = observations.reduce(
		(sum, o) => sum + (o.airtimeUs ?? 0),
		0,
	);
	const shareIsAirtime =
		totalAirtimeUs > 0 && observations.every((o) => o.airtimeUs !== null);

	const groups = new Map<string, AnnounceObservation[]>();
	for (const o of observations) {
		const list = groups.get(o.destinationHashHex);
		if (list) list.push(o);
		else groups.set(o.destinationHashHex, [o]);
	}

	const destinations: AnnounceDestination[] = [];
	for (const [destinationHashHex, list] of groups) {
		// collectAnnounces walks frames in order, so `list` is already oldest
		// first; sorting again is what keeps a caller that hands frames in a
		// different order from silently reordering a timeline.
		const ordered = [...list].sort((a, b) => a.timeS - b.timeS);
		const firstSeenS = ordered[0].timeS;
		const lastSeenS = ordered[ordered.length - 1].timeS;
		let pathChanges = 0;
		for (let i = 1; i < ordered.length; i++) {
			if (
				reticulumPathKey(ordered[i - 1].path) !==
				reticulumPathKey(ordered[i].path)
			) {
				pathChanges++;
			}
		}
		const airtimeUs = ordered.reduce((sum, o) => sum + (o.airtimeUs ?? 0), 0);
		destinations.push({
			destinationHashHex,
			prefix: destinationHashHex.slice(0, 8),
			count: ordered.length,
			firstSeenS,
			lastSeenS,
			meanIntervalS:
				ordered.length > 1
					? (lastSeenS - firstSeenS) / (ordered.length - 1)
					: null,
			minHops: Math.min(...ordered.map((o) => o.path.hops)),
			maxHops: Math.max(...ordered.map((o) => o.path.hops)),
			paths: rollUpPaths(ordered),
			pathChanges,
			distinctIdentityCount: new Set(
				ordered.map((o) => o.identity.publicKeyHex),
			).size,
			ratchetCount: ordered.filter((o) => o.identity.ratchetHex !== null)
				.length,
			appDataCount: ordered.filter((o) => o.appDataLength > 0).length,
			transportedCount: ordered.filter((o) => o.headerType === 2).length,
			observations: ordered,
			countSharePercent: (ordered.length / observations.length) * 100,
			airtimeSharePercent: shareIsAirtime
				? (airtimeUs / totalAirtimeUs) * 100
				: null,
		});
	}

	const rank = (d: AnnounceDestination) =>
		shareIsAirtime ? (d.airtimeSharePercent ?? 0) : d.countSharePercent;
	destinations.sort(
		(a, b) =>
			rank(b) - rank(a) ||
			a.firstSeenS - b.firstSeenS ||
			a.destinationHashHex.localeCompare(b.destinationHashHex),
	);

	return {
		reticulumFrameCount,
		announceCount: observations.length,
		structuralOnlyCount: reticulumFrameCount - observations.length,
		destinations,
		firstSeenS: Math.min(...observations.map((o) => o.timeS)),
		lastSeenS: Math.max(...observations.map((o) => o.timeS)),
		shareIsAirtime,
	};
}

/** One mark on a per-destination timeline. */
export interface AnnounceTick {
	/** Position across the capture's announce span, 0–1. */
	x: number;
	timeS: number;
	/** True when this announce's path differs from the one before it. */
	pathChange: boolean;
	frameIndex: number;
}

/**
 * A destination's announces placed on the capture's announce span — the
 * cadence, with the path changes marked. A zero-width span (every announce
 * at the same instant, or a single announce in the capture) puts every mark
 * at the left edge rather than dividing by zero.
 */
export function announceTicks(
	destination: AnnounceDestination,
	overview: Pick<AnnounceOverview, "firstSeenS" | "lastSeenS">,
): AnnounceTick[] {
	const span = overview.lastSeenS - overview.firstSeenS;
	return destination.observations.map((o, i) => {
		const prev = destination.observations[i - 1];
		return {
			x: span > 0 ? (o.timeS - overview.firstSeenS) / span : 0,
			timeS: o.timeS,
			pathChange:
				prev !== undefined &&
				reticulumPathKey(prev.path) !== reticulumPathKey(o.path),
			frameIndex: o.frameIndex,
		};
	});
}

/** "3" for a single hop count, "1–4" for a range. */
export function hopRangeLabel(destination: AnnounceDestination): string {
	return destination.minHops === destination.maxHops
		? String(destination.minHops)
		: `${destination.minHops}–${destination.maxHops}`;
}

/**
 * The paths a destination was heard on, in one line: the words for each,
 * with how many announces arrived that way when there was more than one.
 */
export function pathSummaryLabel(destination: AnnounceDestination): string {
	if (destination.paths.length === 1) return destination.paths[0].label;
	return destination.paths.map((p) => `${p.label} (${p.count}×)`).join(" · ");
}

/**
 * The display-filter expression that shows exactly the frames addressed to
 * one destination hash — what clicking a row applies. It composes through the
 * ordinary filter box (frameFilter.ts's `dest` field), so it can be edited,
 * combined with `&&`, and permalinked like any other filter.
 */
export function destinationFilterExpression(
	destinationHashHex: string,
): string {
	return `dest == ${destinationHashHex}`;
}
