/**
 * Field Ranks — a progression layer over Field Receipts points.
 *
 * The idea is borrowed, openly, from LOCOSP/WatchDogsGo: turn invisible RF
 * field work into legible XP, ranks, and badges so a community grinds for
 * standing the way WiGLE's leaderboard kept people wardriving for twenty
 * years. What is *not* borrowed is its economics. WatchDogsGo scores
 * offensive actions (deauth, evil-twin credential capture) and sorts players
 * onto a white→black "hat" gradient. Lilyshark only ever listens, so there is
 * no offense axis here and nothing new is minted: **XP is exactly the
 * account's Field Receipts points, and ranks/badges/class are a presentation
 * of that one number.** No token, no transfer, no airtime — see
 * docs/protocol/field-ranks.md.
 *
 * Every weight below is the frozen weight from the on-chain module
 * (contracts/field-points/sources/field_points.move) and the season freeze
 * (docs/protocol/season-0-rules.json). The engine recomputes the credited
 * (on-chain) part of XP from those constants rather than trusting an emitted
 * `amount`, exactly as scripts/field_receipts_score.py does, and adds the
 * off-chain cell points the scorer produces. RANK-VECTOR-1 pins the whole
 * mapping the way WITNESS-VECTOR-1 pins the witness key.
 *
 * This module is pure and deterministic: no clock, no network, no storage.
 * The same stats always yield the same rank, so the leaderboard, an operator
 * profile card, and the offline showcase all agree without coordinating.
 */

/** Frozen point weights — mirror field_points.move / season-0-rules.json. */
export const POINT_WEIGHTS = {
	/** POINTS_ANCHOR: per capture anchored in capture_registry. */
	anchor: 10,
	/** POINTS_WITNESS: to each of the first two attesters of a key, in window. */
	witness: 25,
	/** POINTS_LATE_WITNESS: attesters 3..=8 of an already-corroborated key. */
	lateWitness: 5,
	/** first-verified-capture-in-cell bonus, before re-survey decay. */
	cellDiscovery: 8,
} as const;

/**
 * One account's verified field work, as the season scorer sees it. Every
 * field is a count of *credited* events, so XP is a linear combination of
 * these with POINT_WEIGHTS — never a re-scored guess.
 */
export interface OperatorStats {
	/** Captures anchored in capture_registry (each earns POINTS_ANCHOR). */
	anchors: number;
	/**
	 * Times this account was attester 1 or 2 of a key that got corroborated
	 * inside the window — the observation-tier signal, worth the most.
	 */
	witnessCorroborations: number;
	/** Credited late attestations (positions 3..=8), worth POINTS_LATE_WITNESS. */
	lateWitnesses: number;
	/**
	 * Cell points already computed by the off-chain scorer (discovery bonus
	 * minus re-survey decay, weekly-capped). Passed in rather than recomputed
	 * because decay is per-week-per-cell state the scorer owns. Defaults to 0.
	 */
	cellPoints?: number;
	/** Distinct geohash-5 × band cells this account has a verified capture in. */
	distinctCells?: number;
	/**
	 * Synthetic frames this account has ever submitted as field data. Must be
	 * 0 to earn the CLEAN HANDS badge; the protocol refuses synthetic frames
	 * for witness keys, so a healthy operator's value here is always 0.
	 */
	syntheticSubmitted?: number;
	/** Seasons in which this account earned any points. */
	seasonsActive?: number;
}

/** The XP breakdown, so a card can show where the points came from. */
export interface XpBreakdown {
	anchor: number;
	witness: number;
	lateWitness: number;
	cell: number;
	total: number;
}

/**
 * XP is Field Receipts points. Recompute the on-chain part from the frozen
 * weights (the scorer's discipline: never trust an emitted amount), add the
 * scorer's off-chain cell points. Negative or fractional inputs are clamped
 * to a non-negative integer count so a malformed row can never inflate a
 * rank.
 */
export function xpFromStats(stats: OperatorStats): XpBreakdown {
	const n = (v: number | undefined) => {
		const f = Math.floor(v ?? 0);
		return Number.isFinite(f) ? Math.max(0, f) : 0;
	};
	const anchor = n(stats.anchors) * POINT_WEIGHTS.anchor;
	const witness = n(stats.witnessCorroborations) * POINT_WEIGHTS.witness;
	const lateWitness = n(stats.lateWitnesses) * POINT_WEIGHTS.lateWitness;
	const cell = n(stats.cellPoints);
	return {
		anchor,
		witness,
		lateWitness,
		cell,
		total: anchor + witness + lateWitness + cell,
	};
}

export interface Rank {
	/** 0-based index up the ladder. */
	tier: number;
	/** Short, all-caps callsign shown on the card. */
	name: string;
	/** Cumulative XP at which this rank is reached. */
	minXp: number;
	/** One line: what earning this rank means in field terms. */
	blurb: string;
}

/**
 * Twelve ranks, listening-flavored (no offense tiers). Thresholds are a
 * roughly geometric curve tuned to Season 0's weights: the first rank lands
 * on a single corroborated frame (25) or one anchor plus a witness, and the
 * top is a full season of steady field work rather than WatchDogsGo's
 * 10,000,000-XP FINAL_BOSS. Frozen for the season; tune with real Season 0
 * distributions, never mid-season.
 *
 * MERIDIAN, the top rank, is a nod to the whitepaper's funded recommendation
 * (§19–20) — the observation network this repo studies but does not build.
 */
export const RANKS: readonly Rank[] = [
	{
		tier: 0,
		name: "UNLICENSED",
		minXp: 0,
		blurb: "No verified field work yet. The air is still noise.",
	},
	{
		tier: 1,
		name: "LISTENER",
		minXp: 25,
		blurb:
			"First corroborated frame, or a capture on chain. You are on the air.",
	},
	{
		tier: 2,
		name: "SCANNER",
		minXp: 75,
		blurb: "Sweeping bands, anchoring captures, reading the room.",
	},
	{
		tier: 3,
		name: "WARDRIVER",
		minXp: 200,
		blurb: "Moving and mapping. WiGLE's oldest rank, earned by mileage.",
	},
	{
		tier: 4,
		name: "SURVEYOR",
		minXp: 450,
		blurb: "Filling cells the map had blank. Coverage you can prove.",
	},
	{
		tier: 5,
		name: "WITNESS",
		minXp: 900,
		blurb:
			"Your receptions keep corroborating other operators. Observation tier.",
	},
	{
		tier: 6,
		name: "PATHFINDER",
		minXp: 1600,
		blurb: "First into empty cells often enough that the frontier follows you.",
	},
	{
		tier: 7,
		name: "ELMER",
		minXp: 2800,
		blurb: "The ham's word for the one who brings others onto the air.",
	},
	{
		tier: 8,
		name: "NETRUNNER",
		minXp: 4500,
		blurb: "Reading the whole mesh at once — three protocols, one screen.",
	},
	{
		tier: 9,
		name: "OPERATOR",
		minXp: 7000,
		blurb: "A standing presence in the receipts. The network expects you.",
	},
	{
		tier: 10,
		name: "SIGINT",
		minXp: 10000,
		blurb: "Signals intelligence at hobby scale, all of it published.",
	},
	{
		tier: 11,
		name: "MERIDIAN",
		minXp: 15000,
		blurb:
			"The observation network the paper wanted — you are the instrument for it.",
	},
] as const;

export interface RankProgress {
	/** The rank the operator currently holds. */
	rank: Rank;
	/** The next rank up, or null at the top of the ladder. */
	next: Rank | null;
	/** XP into the current band. */
	xpIntoRank: number;
	/** XP the current band spans (Infinity-safe: 0 at the top). */
	xpForRank: number;
	/** 0..1 progress toward `next`; 1 at the top rank. */
	progress: number;
}

/** Resolve cumulative XP to a rank and progress toward the next one. */
export function rankFor(xp: number): RankProgress {
	const x = Math.max(0, Math.floor(xp));
	let idx = 0;
	for (let i = 0; i < RANKS.length; i++) {
		if (x >= RANKS[i].minXp) idx = i;
		else break;
	}
	const rank = RANKS[idx];
	const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
	const xpIntoRank = x - rank.minXp;
	const xpForRank = next ? next.minXp - rank.minXp : 0;
	const progress = next ? xpIntoRank / xpForRank : 1;
	return { rank, next, xpIntoRank, xpForRank, progress };
}

export interface Badge {
	id: string;
	/** Short label for the badge chip. */
	name: string;
	/** What earned it, in field terms. */
	blurb: string;
	/** Whether `stats` has earned it. */
	earned: (stats: OperatorStats, xp: XpBreakdown) => boolean;
}

/**
 * Milestone badges, each anchored to a real Field Receipts event — the same
 * discipline WatchDogsGo uses (its FLIPPER/HS_HUNTER/EVIL_TWIN badges each
 * mark a first real action), reflavored to listening. CLEAN HANDS is the one
 * badge with no WatchDogsGo analog: it rewards *never* submitting a synthetic
 * frame, which is the protocol's one disqualifying offense.
 */
export const BADGES: readonly Badge[] = [
	{
		id: "first_light",
		name: "FIRST LIGHT",
		blurb: "First capture anchored on chain.",
		earned: (s) => (s.anchors ?? 0) >= 1,
	},
	{
		id: "corroborated",
		name: "CORROBORATED",
		blurb: "First transmission a second receiver confirmed with you.",
		earned: (s) => (s.witnessCorroborations ?? 0) >= 1,
	},
	{
		id: "pathfinder",
		name: "PATHFINDER",
		blurb: "First verified capture from a previously empty cell.",
		earned: (s) => (s.distinctCells ?? 0) >= 1,
	},
	{
		id: "cartographer",
		name: "CARTOGRAPHER",
		blurb: "Verified captures in 10 distinct cells.",
		earned: (s) => (s.distinctCells ?? 0) >= 10,
	},
	{
		id: "quorum",
		name: "QUORUM",
		blurb: "25 corroborations — a reliable second witness.",
		earned: (s) => (s.witnessCorroborations ?? 0) >= 25,
	},
	{
		id: "archivist",
		name: "ARCHIVIST",
		blurb: "100 captures anchored. The evidence floor holds.",
		earned: (s) => (s.anchors ?? 0) >= 100,
	},
	{
		id: "veteran",
		name: "SEASON VETERAN",
		blurb: "Earned points across two or more seasons.",
		earned: (s) => (s.seasonsActive ?? 0) >= 2,
	},
	{
		id: "clean_hands",
		name: "CLEAN HANDS",
		blurb: "Field work only — never submitted a synthetic frame.",
		earned: (s, xp) => xp.total > 0 && (s.syntheticSubmitted ?? 0) === 0,
	},
] as const;

/** The badges this operator has earned, in ladder order. */
export function badgesFor(stats: OperatorStats): Badge[] {
	const xp = xpFromStats(stats);
	return BADGES.filter((b) => b.earned(stats, xp));
}

export type OperatorClassId =
	| "recruit"
	| "surveyor"
	| "witness"
	| "archivist"
	| "field_op";

export interface OperatorClass {
	id: OperatorClassId;
	name: string;
	blurb: string;
}

/**
 * The honest analog of WatchDogsGo's hacker-hat colors. Theirs is a moral
 * gradient (white→black) keyed to how offensive the player is. Lilyshark has
 * no offense to grade, so this classifies purely by the *mix* of listening
 * work — which observation-tier activity dominates an operator's points — and
 * carries no judgment. A balanced operator is a FIELD OP; a dominant column
 * names the specialty. Ties resolve toward the higher verification tier
 * (witness > survey > anchor), and an operator with no XP is a RECRUIT.
 */
export function operatorClass(stats: OperatorStats): OperatorClass {
	const xp = xpFromStats(stats);
	if (xp.total === 0) {
		return {
			id: "recruit",
			name: "RECRUIT",
			blurb: "No verified field work on the board yet.",
		};
	}
	const witness = xp.witness + xp.lateWitness;
	const survey = xp.cell;
	const anchor = xp.anchor;
	const top = Math.max(witness, survey, anchor);
	// Balanced: no single column owns more than 55% of total XP.
	if (top / xp.total <= 0.55) {
		return {
			id: "field_op",
			name: "FIELD OP",
			blurb: "Balanced across witnessing, survey, and anchoring.",
		};
	}
	if (witness === top) {
		return {
			id: "witness",
			name: "WITNESS",
			blurb:
				"Corroboration-led. Your receipts confirm others' — observation tier.",
		};
	}
	if (survey === top) {
		return {
			id: "surveyor",
			name: "SURVEYOR",
			blurb: "Coverage-led. You fill the cells the map had blank.",
		};
	}
	return {
		id: "archivist",
		name: "ARCHIVIST",
		blurb: "Anchor-led. You keep the evidence floor stocked.",
	};
}

export interface OperatorProfile {
	xp: XpBreakdown;
	progress: RankProgress;
	operatorClass: OperatorClass;
	badges: Badge[];
}

/** One call to compute everything a rank card renders from an account's stats. */
export function operatorProfile(stats: OperatorStats): OperatorProfile {
	const xp = xpFromStats(stats);
	return {
		xp,
		progress: rankFor(xp.total),
		operatorClass: operatorClass(stats),
		badges: badgesFor(stats),
	};
}
