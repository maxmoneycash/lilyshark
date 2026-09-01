// Self-check: node --import tsx --test src/lib/fieldPoints.test.ts
//
// Two things are pinned here.
//
// 1. The browser's replay of `field_points` agrees with the published
//    season scorer. The bundled example (fieldPointsExample.ts) is a
//    scorer-schema event extract; running
//
//      python3 scripts/field_receipts_score.py score \
//        --events <that document>
//
//    prints the standings recorded in EXAMPLE_SCORER_ONCHAIN, and the
//    reduction in fieldPoints.ts has to reproduce them account for
//    account. Disputes in this protocol are settled by re-running the
//    scorer, so a leaderboard that scores differently is a bug however
//    pretty it is.
//
// 2. The honest-degradation contract: an unread chain is never a zero, a
//    wiped devnet is classified as a wiped devnet, and a synthetic frame
//    can never reach an attest command.

import assert from "node:assert/strict";
import test from "node:test";

import {
	attestCommand,
	attestCommands,
	classifyChainFailure,
	creditForPosition,
	eventsFromTransactions,
	EVENT_NAMES,
	eventTypeTag,
	FIELD_POINTS_DEPLOYMENT,
	FieldPointsInputError,
	fieldPointsFunction,
	hexOfBytes,
	indexWitnesses,
	networkFailure,
	normalizeAddress,
	normalizeWitnessKey,
	parseEventsDocument,
	POINTS,
	reduceStandings,
	registryEventTypeTag,
	witnessStateLabel,
	witnessStateOf,
	witnessStateOfAttesters,
} from "./fieldPoints.ts";
import {
	EXAMPLE_EVENTS_DOCUMENT,
	EXAMPLE_SCORER_ONCHAIN,
} from "./fieldPointsExample.ts";

const KEY_A =
	"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01";
const KEY_B =
	"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb02";

const long = (short: string) => normalizeAddress(short) as string;

/* ── addresses and keys ────────────────────────────────────────────────── */

test("addresses fold to lowercase long form, however they were printed", () => {
	const canonical = `0x${"0".repeat(60)}a1fa`;
	assert.equal(normalizeAddress("0xa1fa"), canonical);
	assert.equal(normalizeAddress("0xA1FA"), canonical);
	assert.equal(normalizeAddress("a1fa"), canonical);
	assert.equal(normalizeAddress(canonical), canonical);
});

test("a non-address is null, not a phantom account", () => {
	assert.equal(normalizeAddress(""), null);
	assert.equal(normalizeAddress("0x"), null);
	assert.equal(normalizeAddress("0xzz"), null);
	assert.equal(normalizeAddress(`0x${"1".repeat(65)}`), null);
	assert.equal(normalizeAddress(42), null);
	assert.equal(normalizeAddress(null), null);
});

test("witness keys are exactly 32 bytes of hex, with or without 0x", () => {
	assert.equal(normalizeWitnessKey(`0x${KEY_A}`), KEY_A);
	assert.equal(normalizeWitnessKey(KEY_A.toUpperCase()), KEY_A);
	assert.equal(normalizeWitnessKey(KEY_A.slice(0, 62)), null);
	assert.equal(normalizeWitnessKey(`${KEY_A}ff`), null);
});

test("hexOfBytes pads every byte", () => {
	assert.equal(hexOfBytes(new Uint8Array([0, 1, 0x0f, 0xff])), "00010fff");
});

/* ── the frozen schedule ───────────────────────────────────────────────── */

test("the point schedule matches field_points.move and season-0-rules.json", () => {
	assert.deepEqual(
		{ ...POINTS },
		{
			anchor: 10,
			corroboration: 25,
			lateWitness: 5,
			maxCreditedAttesters: 8,
			windowSecs: 604800,
		},
	);
});

test("creditForPosition replays the module's schedule, window and cap", () => {
	const t0 = 1_759_300_000;
	assert.equal(creditForPosition(1, t0, t0), 0, "the opener is unpaid");
	assert.equal(creditForPosition(2, t0, t0 + 60), POINTS.corroboration);
	assert.equal(creditForPosition(3, t0, t0 + 60), POINTS.lateWitness);
	assert.equal(creditForPosition(8, t0, t0 + 60), POINTS.lateWitness);
	assert.equal(creditForPosition(9, t0, t0 + 60), 0, "past the cap");
	assert.equal(
		creditForPosition(2, t0, t0 + POINTS.windowSecs),
		POINTS.corroboration,
		"the last second of the window still pays",
	);
	assert.equal(
		creditForPosition(2, t0, t0 + POINTS.windowSecs + 1),
		0,
		"one second late pays nothing",
	);
});

/* ── parsing the scorer's extract ──────────────────────────────────────── */

test("the bundled example parses as the scorer's own schema", () => {
	const events = parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT);
	assert.equal(events.length, EXAMPLE_EVENTS_DOCUMENT.events.length);
	for (let i = 1; i < events.length; i++) {
		const before = events[i - 1];
		const after = events[i];
		assert.ok(
			before.txVersion < after.txVersion ||
				(before.txVersion === after.txVersion &&
					before.eventIndex < after.eventIndex),
			"events come back in (tx_version, event_index) order",
		);
	}
});

test("a duplicate (tx_version, event_index) is refused, not silently kept", () => {
	const doc = {
		events: [
			{
				type: "PointsAwarded",
				tx_version: 1,
				event_index: 0,
				timestamp_unix: 10,
				data: { account: "0xa1fa", kind: 0, amount: 10 },
			},
			{
				type: "PointsAwarded",
				tx_version: 1,
				event_index: 0,
				timestamp_unix: 10,
				data: { account: "0xb4a0", kind: 0, amount: 10 },
			},
		],
	};
	assert.throws(() => parseEventsDocument(doc), FieldPointsInputError);
});

test("a malformed event names the field that broke", () => {
	assert.throws(
		() =>
			parseEventsDocument({
				events: [
					{
						type: "WitnessAttested",
						tx_version: 1,
						event_index: 0,
						timestamp_unix: 10,
						data: { key: "ff", attester: "0xa1fa", position: 1, credited: 0 },
					},
				],
			}),
		/events\[0\]\.data\.key/,
	);
	assert.throws(() => parseEventsDocument({ events: {} }), /'events' array/);
	assert.throws(
		() =>
			parseEventsDocument({
				events: [
					{ type: "Nope", tx_version: 1, event_index: 0, timestamp_unix: 1, data: {} },
				],
			}),
		/events\[0\]\.type/,
	);
});

/* ── events out of fullnode transactions ───────────────────────────────── */

test("module events are lifted out of fullnode transactions, others ignored", () => {
	const d = FIELD_POINTS_DEPLOYMENT;
	const transactions = [
		{
			version: "512",
			timestamp: "1759300600000000",
			events: [
				{ type: "0x1::coin::WithdrawEvent", data: { amount: "17" } },
				{
					type: eventTypeTag(EVENT_NAMES.points, d),
					data: { account: "0xa1fa", kind: "1", amount: "25" },
				},
				{
					type: eventTypeTag(EVENT_NAMES.witness, d),
					data: {
						key: `0x${KEY_A}`,
						attester: "0xb4a0",
						position: "2",
						credited: "25",
					},
				},
			],
		},
		{
			version: "500",
			timestamp: "1759300000000000",
			events: [
				{
					type: registryEventTypeTag(EVENT_NAMES.capture, d),
					data: {
						publisher: "0xa1fa",
						commitment: `0x${"c0ffee".padEnd(64, "0")}`,
					},
				},
			],
		},
	];
	const events = eventsFromTransactions(transactions, d);
	assert.equal(events.length, 3, "the coin event is not ours and is skipped");
	assert.equal(events[0].type, "CaptureRegistered");
	assert.equal(events[0].txVersion, 500);
	assert.equal(
		events[0].timestampUnix,
		1_759_300_000,
		"microsecond chain time becomes unix seconds",
	);
	assert.equal(events[1].type, "PointsAwarded");
	assert.equal(events[2].type, "WitnessAttested");
	assert.equal(
		(events[2] as { key: string }).key,
		KEY_A,
		"a 0x-prefixed key is stored bare",
	);
});

test("garbage in, nothing out — never a throw that loses the whole read", () => {
	assert.deepEqual(eventsFromTransactions(undefined), []);
	assert.deepEqual(eventsFromTransactions([{ version: "x" }]), []);
	assert.deepEqual(
		eventsFromTransactions([
			{
				version: "1",
				timestamp: "1000000",
				events: [
					{
						type: eventTypeTag(EVENT_NAMES.witness),
						data: { key: "nonsense", attester: "0xa1fa", position: 1, credited: 0 },
					},
				],
			},
		]),
		[],
		"an unparseable event from our module is dropped, not thrown",
	);
});

/* ── standings: agreement with the published scorer ────────────────────── */

test("the reduction reproduces the scorer's on-chain standings exactly", () => {
	const standings = reduceStandings(
		parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT),
	);
	assert.deepEqual(standings.discrepancies, [], "the example is self-consistent");
	assert.equal(standings.rows.length, 4);
	for (const [short, expected] of Object.entries(EXAMPLE_SCORER_ONCHAIN)) {
		const row = standings.rows.find((r) => r.account === long(short));
		assert.ok(row, `${short} has a standings row`);
		assert.equal(row.anchorPoints, expected.anchor, `${short} anchor points`);
		assert.equal(row.witnessPoints, expected.witness, `${short} witness points`);
		assert.equal(row.total, expected.total, `${short} total`);
	}
});

test("standings rank by total, break ties by address, and keep the zeroes", () => {
	const standings = reduceStandings(
		parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT),
	);
	assert.deepEqual(
		standings.rows.map((r) => [r.rank, r.total]),
		[
			[1, 80],
			[2, 70],
			[3, 5],
			[4, 0],
		],
	);
	const zero = standings.rows[3];
	assert.equal(zero.account, long("0xd0d0"));
	assert.equal(
		zero.attestations,
		1,
		"an uncorroborated attestation is recorded and paid nothing",
	);
	assert.equal(zero.corroborations, 0);
});

test("tied accounts share a rank", () => {
	const events = parseEventsDocument({
		events: [
			{
				type: "CaptureRegistered",
				tx_version: 1,
				event_index: 0,
				timestamp_unix: 10,
				data: { publisher: "0xaaaa", commitment: KEY_A },
			},
			{
				type: "PointsAwarded",
				tx_version: 2,
				event_index: 0,
				timestamp_unix: 11,
				data: { account: "0xaaaa", kind: 0, amount: 10 },
			},
			{
				type: "CaptureRegistered",
				tx_version: 3,
				event_index: 0,
				timestamp_unix: 12,
				data: { publisher: "0xbbbb", commitment: KEY_B },
			},
			{
				type: "PointsAwarded",
				tx_version: 4,
				event_index: 0,
				timestamp_unix: 13,
				data: { account: "0xbbbb", kind: 0, amount: 10 },
			},
		],
	});
	assert.deepEqual(
		reduceStandings(events).rows.map((r) => [r.rank, r.account]),
		[
			[1, long("0xaaaa")],
			[1, long("0xbbbb")],
		],
	);
});

test("an empty log is an empty table with no range, not a table of zeroes", () => {
	const standings = reduceStandings([]);
	assert.deepEqual(standings.rows, []);
	assert.equal(standings.eventCount, 0);
	assert.equal(standings.witnessKeyCount, 0);
	assert.equal(standings.txVersionRange, null);
	assert.equal(standings.timeRangeUnix, null);
});

test("an anchor overclaim is capped and reported, never paid", () => {
	const standings = reduceStandings(
		parseEventsDocument({
			events: [
				{
					type: "CaptureRegistered",
					tx_version: 1,
					event_index: 0,
					timestamp_unix: 10,
					data: { publisher: "0xa1fa", commitment: KEY_A },
				},
				{
					type: "PointsAwarded",
					tx_version: 2,
					event_index: 0,
					timestamp_unix: 11,
					data: { account: "0xa1fa", kind: 0, amount: 90 },
				},
			],
		}),
	);
	assert.equal(standings.rows[0].anchorPoints, 10, "one anchor pays ten");
	assert.equal(
		standings.discrepancies.filter((d) => d.type === "anchor_overclaim").length,
		1,
	);
});

test("a chain that lies about `credited` is contradicted, not believed", () => {
	const standings = reduceStandings(
		parseEventsDocument({
			events: [
				{
					type: "WitnessAttested",
					tx_version: 1,
					event_index: 0,
					timestamp_unix: 100,
					data: { key: KEY_A, attester: "0xa1fa", position: 1, credited: 9999 },
				},
			],
		}),
	);
	assert.equal(standings.rows[0].witnessPoints, 0);
	assert.equal(standings.discrepancies[0].type, "witness_credited_mismatch");
});

test("a repeat attester in the log is a discrepancy, and credits nothing twice", () => {
	const witness = (tx: number, attester: string, position: number, credited: number) => ({
		type: "WitnessAttested",
		tx_version: tx,
		event_index: 0,
		timestamp_unix: 100 + tx,
		data: { key: KEY_A, attester, position, credited },
	});
	const standings = reduceStandings(
		parseEventsDocument({
			events: [
				witness(1, "0xa1fa", 1, 0),
				witness(2, "0xb4a0", 2, 25),
				witness(3, "0xb4a0", 3, 5),
			],
		}),
	);
	assert.equal(
		standings.rows.find((r) => r.account === long("0xb4a0"))?.witnessPoints,
		25,
		"the duplicate earns nothing on top",
	);
	assert.ok(
		standings.discrepancies.some(
			(d) => d.type === "witness_duplicate_attester",
		),
	);
});

test("an attestation outside the seven-day window is recorded and unpaid", () => {
	const standings = reduceStandings(
		parseEventsDocument({
			events: [
				{
					type: "WitnessAttested",
					tx_version: 1,
					event_index: 0,
					timestamp_unix: 1_000_000,
					data: { key: KEY_A, attester: "0xa1fa", position: 1, credited: 0 },
				},
				{
					type: "WitnessAttested",
					tx_version: 2,
					event_index: 0,
					timestamp_unix: 1_000_000 + POINTS.windowSecs + 1,
					data: { key: KEY_A, attester: "0xb4a0", position: 2, credited: 0 },
				},
			],
		}),
	);
	assert.equal(standings.rows.every((r) => r.total === 0), true);
	assert.equal(
		standings.rows.find((r) => r.account === long("0xb4a0"))?.attestations,
		1,
		"still recorded — the corroboration count is useful data",
	);
	assert.deepEqual(standings.discrepancies, []);
});

/* ── witness state, as TRAFFIC renders it ──────────────────────────────── */

test("the witness index replays positions and credits per key", () => {
	const book = indexWitnesses(parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT));
	assert.deepEqual([...book.keys()].sort(), [
		KEY_A,
		KEY_B,
		"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc03",
	]);
	const a = book.get(KEY_A);
	assert.deepEqual(
		a?.attestations.map((x) => [x.position, x.credited]),
		[
			[1, 0],
			[2, 25],
			[3, 5],
		],
	);
});

test("an unread chain is `unknown`, never `not-attested`", () => {
	assert.deepEqual(witnessStateOfAttesters(undefined, null), {
		kind: "unknown",
	});
	assert.equal(witnessStateLabel({ kind: "unknown" }), "CHAIN NOT READ");
	assert.deepEqual(witnessStateOfAttesters([], null), { kind: "not-attested" });
});

test("witness states name who is in them", () => {
	const me = long("0xa1fa");
	const them = long("0xb4a0");
	assert.deepEqual(witnessStateOfAttesters([me], me), {
		kind: "attested",
		count: 1,
		byYou: true,
	});
	assert.deepEqual(witnessStateOfAttesters([them], me), {
		kind: "attested",
		count: 1,
		byYou: false,
	});
	assert.deepEqual(witnessStateOfAttesters([them, me], me), {
		kind: "corroborated",
		count: 2,
		byYou: true,
	});
	assert.equal(
		witnessStateLabel(witnessStateOfAttesters([them, me], me)),
		"CORROBORATED ×2 · INCLUDING YOU",
	);
	assert.equal(
		witnessStateLabel(witnessStateOfAttesters([them, me], null)),
		"CORROBORATED ×2",
		"without an account of your own, no claim about you is made",
	);
});

test("the state folded from the event index agrees with the view's answer", () => {
	const book = indexWitnesses(parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT));
	const me = long("0xc0c0");
	assert.deepEqual(witnessStateOf(book.get(KEY_A), me), {
		kind: "corroborated",
		count: 3,
		byYou: true,
	});
	assert.deepEqual(witnessStateOf(book.get("00".repeat(32)), me), {
		kind: "not-attested",
	});
});

test("an ineligible frame's state carries the library's reason", () => {
	assert.equal(
		witnessStateLabel({ kind: "ineligible", reason: "synthetic" }),
		"NO KEY · SYNTHETIC",
	);
});

/* ── the attest command ────────────────────────────────────────────────── */

test("the attest command names the module, the key and the chain", () => {
	const command = attestCommand(KEY_A, "lilyshark-devnet");
	assert.match(
		command,
		new RegExp(fieldPointsFunction("attest_witness").replace(/\$/g, "\\$")),
	);
	assert.match(command, new RegExp(`--args hex:0x${KEY_A}`));
	assert.match(command, new RegExp(FIELD_POINTS_DEPLOYMENT.fullnode));
	assert.match(command, /--profile lilyshark-devnet/);
});

test("without a profile the placeholder is obviously a placeholder", () => {
	assert.match(attestCommand(KEY_A), /<your-aptos-profile>/);
});

test("a key that is not 32 bytes can never become a command", () => {
	assert.throws(() => attestCommand("deadbeef"), RangeError);
	assert.throws(() => attestCommand(""), RangeError);
});

test("one command per key — attest_witness takes exactly one", () => {
	const block = attestCommands([KEY_A, KEY_B]);
	assert.equal(block.split("aptos move run").length - 1, 2);
	assert.ok(block.includes(`hex:0x${KEY_A}`));
	assert.ok(block.includes(`hex:0x${KEY_B}`));
});

/* ── degraded reads ────────────────────────────────────────────────────── */

test("a wiped devnet is classified as a wiped devnet, not an error", () => {
	const byCode = classifyChainFailure(404, {
		message: "Module not found by Address(0xbc7b…)",
		error_code: "module_not_found",
	});
	assert.equal(byCode.kind, "module-not-found");
	assert.match(byCode.reason, /periodically wiped/);
	assert.match(byCode.reason, /CO-002/);

	// The /view endpoint says the same thing with a 400 and no error_code.
	const byMessage = classifyChainFailure(400, {
		message:
			'Module ModuleId { address: bc7b…, name: Identifier("field_points") } can\'t be found',
		error_code: "invalid_input",
	});
	assert.equal(byMessage.kind, "module-not-found");
});

test("any other HTTP answer is reported as itself", () => {
	const failure = classifyChainFailure(503, { message: "overloaded" });
	assert.equal(failure.kind, "http");
	assert.match(failure.reason, /HTTP 503/);
	assert.match(failure.reason, /overloaded/);
});

test("a thrown fetch is unreachable, and names the endpoint", () => {
	const failure = networkFailure(new TypeError("Failed to fetch"));
	assert.equal(failure.kind, "unreachable");
	assert.match(failure.reason, /api\.devnet\.aptoslabs\.com/);
	assert.match(failure.reason, /Failed to fetch/);
});

test("the deployment is labelled devnet, and says so in one place", () => {
	assert.equal(FIELD_POINTS_DEPLOYMENT.chainLabel, "Aptos devnet");
	assert.match(FIELD_POINTS_DEPLOYMENT.caveat, /periodically wiped/);
	assert.match(FIELD_POINTS_DEPLOYMENT.fullnode, /^https:\/\/api\.devnet\./);
	assert.equal(
		fieldPointsFunction("attest_witness"),
		`${FIELD_POINTS_DEPLOYMENT.moduleAddress}::field_points::attest_witness`,
	);
});
