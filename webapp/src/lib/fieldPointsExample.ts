/**
 * The POINTS screen's bundled example — SYNTHETIC, not season data.
 *
 * Season 0 opens 2026-10-01 (docs/protocol/season-0.md) and `field_points`
 * is not on durable rails, so no real standings exist. This is an invented
 * eighteen-event season written in the exact schema the published scorer
 * consumes (`scripts/field_receipts_score.py score --events`), so the same
 * bytes that draw this screen can be handed to the scorer and checked:
 *
 *   python3 scripts/field_receipts_score.py score --events example.json
 *
 * prints the standings this file's own test asserts the browser reduction
 * reproduces. What is invented is only the events: no account here exists,
 * no capture here was ever anchored, no transmission was ever witnessed.
 *
 * It is labelled with the COVERAGE screen's label — imported, not retyped,
 * so the two screens can never drift — and the label rides on every row it
 * produces. The example exists to make an empty screen explicable, not to
 * stand in for a season.
 */

import { EXAMPLE_LABEL } from "./coverageExample.ts";

export { EXAMPLE_LABEL };

/** File name shown as the source when the example is loaded. */
export const EXAMPLE_SOURCE_NAME = "bundled-example-events.json";

/**
 * Four invented accounts:
 *   0x…a1fa  three anchors, corroborates two keys      → 30 anchor + 50 witness
 *   0x…b4a0  two anchors, the other half of both pairs → 20 anchor + 50 witness
 *   0x…c0c0  a third attester on one key (position 3)  →  5 late-witness
 *   0x…d0d0  opens a key nobody ever corroborates      →  0, and still listed
 *
 * The last row is the point of the example: the module records an
 * uncorroborated attestation and pays nothing for it, and the table shows
 * that account rather than hiding a zero.
 */
export const EXAMPLE_EVENTS_DOCUMENT = {
	events: [
		{
			type: "CaptureRegistered",
			tx_version: 2001,
			event_index: 0,
			timestamp_unix: 1759280000,
			data: {
				publisher: "0xa1fa",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee01",
				blob_name: "captures/example-0001.lscap",
				size_bytes: 120000,
				expires_at_unix: 1767052800,
			},
		},
		{
			type: "CaptureRegistered",
			tx_version: 2002,
			event_index: 0,
			timestamp_unix: 1759281000,
			data: {
				publisher: "0xa1fa",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee02",
				blob_name: "captures/example-0002.lscap",
				size_bytes: 118400,
				expires_at_unix: 1767052800,
			},
		},
		{
			type: "CaptureRegistered",
			tx_version: 2003,
			event_index: 0,
			timestamp_unix: 1759282000,
			data: {
				publisher: "0xa1fa",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee03",
				blob_name: "captures/example-0003.lscap",
				size_bytes: 131900,
				expires_at_unix: 1767052800,
			},
		},
		{
			type: "CaptureRegistered",
			tx_version: 2004,
			event_index: 0,
			timestamp_unix: 1759283000,
			data: {
				publisher: "0xb4a0",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee04",
				blob_name: "captures/example-0004.lscap",
				size_bytes: 99200,
				expires_at_unix: 1767052800,
			},
		},
		{
			type: "CaptureRegistered",
			tx_version: 2005,
			event_index: 0,
			timestamp_unix: 1759284000,
			data: {
				publisher: "0xb4a0",
				commitment:
					"00000000000000000000000000000000000000000000000000000000c0ffee05",
				blob_name: "captures/example-0005.lscap",
				size_bytes: 101300,
				expires_at_unix: 1767052800,
			},
		},
		{
			type: "PointsAwarded",
			tx_version: 2010,
			event_index: 0,
			timestamp_unix: 1759290000,
			data: { account: "0xa1fa", kind: 0, amount: 30 },
		},
		{
			type: "PointsAwarded",
			tx_version: 2011,
			event_index: 0,
			timestamp_unix: 1759291000,
			data: { account: "0xb4a0", kind: 0, amount: 20 },
		},
		{
			type: "WitnessAttested",
			tx_version: 2020,
			event_index: 0,
			timestamp_unix: 1759300000,
			data: {
				key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
				attester: "0xa1fa",
				position: 1,
				credited: 0,
			},
		},
		{
			type: "PointsAwarded",
			tx_version: 2021,
			event_index: 0,
			timestamp_unix: 1759300600,
			data: { account: "0xa1fa", kind: 1, amount: 25 },
		},
		{
			type: "PointsAwarded",
			tx_version: 2021,
			event_index: 1,
			timestamp_unix: 1759300600,
			data: { account: "0xb4a0", kind: 1, amount: 25 },
		},
		{
			type: "WitnessAttested",
			tx_version: 2021,
			event_index: 2,
			timestamp_unix: 1759300600,
			data: {
				key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
				attester: "0xb4a0",
				position: 2,
				credited: 25,
			},
		},
		{
			type: "PointsAwarded",
			tx_version: 2022,
			event_index: 0,
			timestamp_unix: 1759301000,
			data: { account: "0xc0c0", kind: 2, amount: 5 },
		},
		{
			type: "WitnessAttested",
			tx_version: 2022,
			event_index: 1,
			timestamp_unix: 1759301000,
			data: {
				key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
				attester: "0xc0c0",
				position: 3,
				credited: 5,
			},
		},
		{
			type: "WitnessAttested",
			tx_version: 2030,
			event_index: 0,
			timestamp_unix: 1759400000,
			data: {
				key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02",
				attester: "0xb4a0",
				position: 1,
				credited: 0,
			},
		},
		{
			type: "PointsAwarded",
			tx_version: 2031,
			event_index: 0,
			timestamp_unix: 1759400900,
			data: { account: "0xb4a0", kind: 1, amount: 25 },
		},
		{
			type: "PointsAwarded",
			tx_version: 2031,
			event_index: 1,
			timestamp_unix: 1759400900,
			data: { account: "0xa1fa", kind: 1, amount: 25 },
		},
		{
			type: "WitnessAttested",
			tx_version: 2031,
			event_index: 2,
			timestamp_unix: 1759400900,
			data: {
				key: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02",
				attester: "0xa1fa",
				position: 2,
				credited: 25,
			},
		},
		{
			type: "WitnessAttested",
			tx_version: 2040,
			event_index: 0,
			timestamp_unix: 1759500000,
			data: {
				key: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc03",
				attester: "0xd0d0",
				position: 1,
				credited: 0,
			},
		},
	],
};

/**
 * What `scripts/field_receipts_score.py score --events` prints for the
 * document above, as its `standings[account].onchain_points` block. The
 * test asserts the browser reduction reproduces these exactly — the
 * scoreboard the analyzer draws and the scoreboard a dispute is settled
 * with have to be the same arithmetic.
 */
export const EXAMPLE_SCORER_ONCHAIN: Record<
	string,
	{ anchor: number; witness: number; total: number }
> = {
	"0xa1fa": { anchor: 30, witness: 50, total: 80 },
	"0xb4a0": { anchor: 20, witness: 50, total: 70 },
	"0xc0c0": { anchor: 0, witness: 5, total: 5 },
	"0xd0d0": { anchor: 0, witness: 0, total: 0 },
};
