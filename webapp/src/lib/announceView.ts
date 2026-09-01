/**
 * Reticulum announce aggregation for the TRAFFIC tab's ANNOUNCES panel
 * (UI-013).
 *
 * Everything here is derived from the semantic announce tier in
 * dissect/rnode.ts, which is itself a port of readReticulumAnnounce in
 * src/core/reticulum_decoder.cpp. That tier reads only what length and flag
 * arithmetic prove about a cleartext announce header and payload layout: a
 * destination hash, a hop count, which optional fields are *present*, and
 * how long the application-defined tail is. No key is held, no signature is
 * checked, and no announce payload byte is interpreted — so nothing in this
 * module may claim otherwise. app_data length is a length; it is never a
 * name, an identity, or a message.
 *
 * "Announce share" here always means a destination's share of THIS
 * CAPTURE'S ANNOUNCES — never a share of total traffic, and never a
 * duty-cycle figure. When the capture reports per-frame airtime the share
 * is computed over announce airtime; otherwise it falls back to announce
 * count and says which one it used.
 *
 * Pure arithmetic over plain data, so it runs under node:test with no DOM
 * (announceView.test.ts).
 */

import { dissectFrame } from "./dissect/registry";
import type { ReticulumFields } from "./dissect/rnode";
import { profileProtocolHint } from "./dissect/tree";
import { frameTimeS } from "./trafficView";

/** The slice of an LscapFrame announce aggregation reads. */
export interface AnnounceSourceFrame {
	timestampUs: bigint;
	bytes: Uint8Array;
	truncated: boolean;
	/** Capture profile id, or null when the frame never reported one. */
	profileId: number | null;
	/** Microseconds on air, or null when the capture omits the field. */
	airtimeUs: number | null;
}

/** One announce seen on the capture clock. */
export interface AnnounceObservation {
	/** Index into the capture's frame list — what a row click filters to. */
	frameIndex: number;
	/** Seconds from the capture's first frame. */
	timeS: number;
	destinationHashHex: string;
	hops: number;
	headerType: 1 | 2;
	/** HEADER_2 only: the transport instance the announce arrived through. */
	transportIdHex: string | null;
	hasRatchet: boolean;
	/** Length of the application-defined tail. A length, nothing more. */
	appDataLength: number;
	airtimeUs: number | null;
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
	/** How many of the announces carried each optional field. */
	ratchetCount: number;
	appDataCount: number;
	/** Announces that arrived through a transport instance (HEADER_2). */
	transportedCount: number;
	/**
	 * Consecutive announces whose observed path differed: a different hop
	 * count, or a different transport instance. This is a change in what was
	 * observed at this receiver, not a claim about the network's routing.
	 */
	pathChanges: number;
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
	 * state: no Reticulum frames means the panel has nothing to say at all.
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
 * Dissect every frame whose profile names Reticulum and collect the
 * announces among them. Frames of other protocols are not guessed at — the
 * dissector is profile-gated exactly as the firmware's registry is.
 */
export function collectAnnounces(
	frames: readonly AnnounceSourceFrame[],
	t0Us: bigint,
): { observations: AnnounceObservation[]; reticulumFrameCount: number } {
	const observations: AnnounceObservation[] = [];
	let reticulumFrameCount = 0;
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		if (profileProtocolHint(frame.profileId) !== "reticulum") continue;
		reticulumFrameCount++;
		const { primary } = dissectFrame(frame.bytes, "reticulum", {
			truncated: frame.truncated,
		});
		const announce = (primary.fields as ReticulumFields | null)?.announce;
		if (!announce) continue;
		observations.push({
			frameIndex: i,
			timeS: frameTimeS(frame, t0Us),
			destinationHashHex: announce.destinationHashHex,
			hops: announce.hops,
			headerType: announce.headerType,
			transportIdHex: announce.transportIdHex,
			hasRatchet: announce.ratchetRange !== null,
			appDataLength: announce.appDataLength,
			airtimeUs: frame.airtimeUs,
		});
	}
	return { observations, reticulumFrameCount };
}

/**
 * Roll a capture up into the ANNOUNCES panel's rows: one per unique
 * destination hash, ordered by how much of the capture's announce traffic
 * each accounts for (ties broken by who announced first, then by hash so
 * the order never wobbles).
 */
export function summarizeAnnounces(
	frames: readonly AnnounceSourceFrame[],
	t0Us: bigint,
): AnnounceOverview {
	const { observations, reticulumFrameCount } = collectAnnounces(frames, t0Us);
	if (reticulumFrameCount === 0) return EMPTY;
	if (observations.length === 0) {
		return { ...EMPTY, reticulumFrameCount, structuralOnlyCount: reticulumFrameCount };
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
		// first; sorting again would hide a caller that hands frames in a
		// different order.
		const ordered = [...list].sort((a, b) => a.timeS - b.timeS);
		const firstSeenS = ordered[0].timeS;
		const lastSeenS = ordered[ordered.length - 1].timeS;
		let pathChanges = 0;
		for (let i = 1; i < ordered.length; i++) {
			const prev = ordered[i - 1];
			const cur = ordered[i];
			if (
				prev.hops !== cur.hops ||
				prev.transportIdHex !== cur.transportIdHex
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
			minHops: Math.min(...ordered.map((o) => o.hops)),
			maxHops: Math.max(...ordered.map((o) => o.hops)),
			ratchetCount: ordered.filter((o) => o.hasRatchet).length,
			appDataCount: ordered.filter((o) => o.appDataLength > 0).length,
			transportedCount: ordered.filter((o) => o.headerType === 2).length,
			pathChanges,
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
	/** True when this announce's observed path differs from the one before. */
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
				(prev.hops !== o.hops || prev.transportIdHex !== o.transportIdHex),
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
 * The display-filter expression that shows exactly the frames addressed to
 * one destination hash — what clicking a panel row applies. It composes
 * through the ordinary filter box (frameFilter.ts's `dest` field), so it
 * can be edited, combined with `&&`, and permalinked like any other filter.
 */
export function destinationFilterExpression(
	destinationHashHex: string,
): string {
	return `dest == ${destinationHashHex}`;
}
