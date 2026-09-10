import assert from "node:assert/strict";
import test from "node:test";
import {
	BADGES,
	badgesFor,
	operatorClass,
	operatorProfile,
	POINT_WEIGHTS,
	RANKS,
	rankFor,
	xpFromStats,
} from "./fieldRanks";

// The weights are the contract's authority, not this file's convenience.
// If field_points.move changes a constant, this vector must be re-frozen with
// it — the same rule WITNESS-VECTOR-1 enforces for the witness key.
test("point weights match the frozen on-chain / season-0 constants", () => {
	assert.equal(POINT_WEIGHTS.anchor, 10); // POINTS_ANCHOR
	assert.equal(POINT_WEIGHTS.witness, 25); // POINTS_WITNESS
	assert.equal(POINT_WEIGHTS.lateWitness, 5); // POINTS_LATE_WITNESS
	assert.equal(POINT_WEIGHTS.cellDiscovery, 8); // first_discovery_bonus
});

test("the rank ladder is well-formed: sequential tiers, strictly rising XP", () => {
	assert.equal(RANKS[0].minXp, 0, "the first rank must start at zero XP");
	for (let i = 0; i < RANKS.length; i++) {
		assert.equal(RANKS[i].tier, i, `tier ${i} out of order`);
		if (i > 0) {
			assert.ok(
				RANKS[i].minXp > RANKS[i - 1].minXp,
				`rank ${RANKS[i].name} does not rise above ${RANKS[i - 1].name}`,
			);
		}
	}
});

test("rankFor lands on the right band at the boundaries", () => {
	assert.equal(rankFor(0).rank.name, "UNLICENSED");
	assert.equal(rankFor(24).rank.name, "UNLICENSED");
	assert.equal(rankFor(25).rank.name, "LISTENER"); // exactly one corroboration short-hand
	assert.equal(rankFor(199).rank.name, "SCANNER");
	assert.equal(rankFor(200).rank.name, "WARDRIVER");
	// Negative and fractional XP are clamped, never crash or promote.
	assert.equal(rankFor(-500).rank.name, "UNLICENSED");
	assert.equal(rankFor(74.9).rank.name, "LISTENER"); // floor(74.9)=74, below SCANNER's 75
});

test("rankFor caps cleanly at the top of the ladder", () => {
	const top = RANKS[RANKS.length - 1];
	const at = rankFor(top.minXp);
	assert.equal(at.rank.name, top.name);
	assert.equal(at.next, null);
	assert.equal(at.progress, 1);
	const beyond = rankFor(top.minXp * 100);
	assert.equal(beyond.rank.name, top.name);
	assert.equal(beyond.progress, 1);
});

// RANK-VECTOR-1 — the frozen mapping. Any change to weights, thresholds, or
// badge triggers must update this vector deliberately, so a silent economics
// drift fails CI.
const RANK_VECTOR_1 = {
	anchors: 12,
	witnessCorroborations: 30,
	lateWitnesses: 14,
	cellPoints: 60,
	distinctCells: 11,
	syntheticSubmitted: 0,
	seasonsActive: 2,
};

test("RANK-VECTOR-1: XP breakdown is the linear combination of weights", () => {
	const xp = xpFromStats(RANK_VECTOR_1);
	assert.deepEqual(xp, {
		anchor: 120, // 12 * 10
		witness: 750, // 30 * 25
		lateWitness: 70, // 14 * 5
		cell: 60,
		total: 1000,
	});
});

test("RANK-VECTOR-1: 1000 XP is WITNESS, ~14% toward PATHFINDER", () => {
	const p = rankFor(1000);
	assert.equal(p.rank.name, "WITNESS");
	assert.equal(p.next?.name, "PATHFINDER");
	assert.equal(p.xpIntoRank, 100);
	assert.equal(p.xpForRank, 700);
	assert.ok(Math.abs(p.progress - 100 / 700) < 1e-9);
});

test("RANK-VECTOR-1: corroboration-led operator classifies as WITNESS", () => {
	assert.equal(operatorClass(RANK_VECTOR_1).id, "witness");
});

test("RANK-VECTOR-1: earns every badge except ARCHIVIST", () => {
	const earned = badgesFor(RANK_VECTOR_1).map((b) => b.id);
	const expected = BADGES.map((b) => b.id).filter((id) => id !== "archivist");
	assert.deepEqual(earned.sort(), expected.sort());
});

test("xpFromStats clamps garbage inputs to a non-negative integer floor", () => {
	const xp = xpFromStats({
		anchors: -5,
		witnessCorroborations: 2.9,
		lateWitnesses: Number.NaN as unknown as number,
		cellPoints: -1,
	});
	assert.equal(xp.anchor, 0);
	assert.equal(xp.witness, 50); // floor(2.9) * 25
	assert.equal(xp.lateWitness, 0);
	assert.equal(xp.cell, 0);
	assert.equal(xp.total, 50);
});

test("operator class covers each specialty and the empty board", () => {
	assert.equal(
		operatorClass({ anchors: 0, witnessCorroborations: 0, lateWitnesses: 0 })
			.id,
		"recruit",
	);
	// Anchor-dominant.
	assert.equal(
		operatorClass({ anchors: 100, witnessCorroborations: 0, lateWitnesses: 0 })
			.id,
		"archivist",
	);
	// Survey-dominant.
	assert.equal(
		operatorClass({
			anchors: 0,
			witnessCorroborations: 0,
			lateWitnesses: 0,
			cellPoints: 500,
		}).id,
		"surveyor",
	);
	// Balanced (no column over 55%): 10 anchors=100, 4 witness=100, 100 cell.
	assert.equal(
		operatorClass({
			anchors: 10,
			witnessCorroborations: 4,
			lateWitnesses: 0,
			cellPoints: 100,
		}).id,
		"field_op",
	);
});

test("CLEAN HANDS requires real XP and zero synthetic frames", () => {
	// Synthetic submitter with points: no badge.
	assert.ok(
		!badgesFor({
			anchors: 5,
			witnessCorroborations: 0,
			lateWitnesses: 0,
			syntheticSubmitted: 1,
		}).some((b) => b.id === "clean_hands"),
	);
	// Clean but empty board: not earned (nothing to be clean about yet).
	assert.ok(
		!badgesFor({ anchors: 0, witnessCorroborations: 0, lateWitnesses: 0 }).some(
			(b) => b.id === "clean_hands",
		),
	);
	// Clean with points: earned.
	assert.ok(
		badgesFor({ anchors: 5, witnessCorroborations: 0, lateWitnesses: 0 }).some(
			(b) => b.id === "clean_hands",
		),
	);
});

test("operatorProfile bundles xp, rank, class, and badges consistently", () => {
	const prof = operatorProfile(RANK_VECTOR_1);
	assert.equal(prof.xp.total, 1000);
	assert.equal(prof.progress.rank.name, "WITNESS");
	assert.equal(prof.operatorClass.id, "witness");
	assert.equal(prof.badges.length, BADGES.length - 1);
});
