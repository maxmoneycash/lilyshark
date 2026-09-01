/**
 * Reading `field_points` from a browser, with the failures modelled.
 *
 * Every function here returns a `ChainRead<T>` rather than throwing, and a
 * failure always carries the reason it failed, because on this deployment
 * the interesting states are the failures. `field_points` lives on Aptos
 * devnet (lib/fieldPoints.ts holds the one place that says so), devnet is
 * wiped periodically, and a wiped devnet answers "module not found" — a
 * normal weekday state that the UI must render as a normal weekday state
 * and never as a zero score or as the operator's mistake.
 *
 * What is readable, and what is not, as of this build:
 *
 *  - **Views** (`total_points`, `points_breakdown`, `witness_attesters`)
 *    over the fullnode's `/view` endpoint: readable, CORS-open. These are
 *    live chain *state* — the fastest honest answer to "is this key
 *    corroborated" and "what does this account hold".
 *  - **Module events** through the indexer's generic `events` table: the
 *    table is deprecated and the endpoint now refuses the query outright
 *    (see `fetchEventsFromIndexer`). That is reported as a named,
 *    explained degradation, not as an empty season.
 *  - **Module events** through the fullnode: `event::emit` events carry no
 *    event handle, so the events-by-handle API cannot enumerate them.
 *    What *is* enumerable is the transactions an account submitted, each
 *    carrying the events it emitted — so event history is read per
 *    account, and the leaderboard says plainly that it is only as complete
 *    as its roster of accounts.
 */

import {
	type ChainFailure,
	classifyChainFailure,
	EVENT_NAMES,
	eventsFromTransactions,
	eventTypeTag,
	FIELD_POINTS_DEPLOYMENT,
	type FieldPointsDeployment,
	type FieldPointsEvent,
	fieldPointsFunction,
	moduleUrl,
	networkFailure,
	normalizeAddress,
	normalizeWitnessKey,
	sortEvents,
} from "./fieldPoints.ts";

export type ChainRead<T> =
	| { ok: true; value: T }
	| ({ ok: false } & ChainFailure);

const fail = (failure: ChainFailure): { ok: false } & ChainFailure => ({
	ok: false,
	...failure,
});

/** Parse a response body as JSON without letting a bad body throw. */
async function bodyOf(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return undefined;
	}
}

/**
 * Is the module actually there? One cheap GET, and the answer decides how
 * the whole screen reads: present, wiped, or unreachable.
 */
export async function probeModule(
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
): Promise<ChainRead<{ bytecodeBytes: number }>> {
	let res: Response;
	try {
		res = await fetch(moduleUrl(d));
	} catch (error) {
		return fail(networkFailure(error, d));
	}
	const body = await bodyOf(res);
	if (!res.ok) return fail(classifyChainFailure(res.status, body, d));
	const bytecode =
		typeof body === "object" && body !== null && "bytecode" in body
			? String((body as { bytecode: unknown }).bytecode ?? "")
			: "";
	return {
		ok: true,
		value: { bytecodeBytes: Math.max(0, bytecode.length - 2) / 2 },
	};
}

/** POST one `#[view]` call to the fullnode. */
async function callView(
	name: string,
	args: unknown[],
	d: FieldPointsDeployment,
): Promise<ChainRead<unknown[]>> {
	let res: Response;
	try {
		res = await fetch(`${d.fullnode}/view`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				function: fieldPointsFunction(name, d),
				type_arguments: [],
				arguments: args,
			}),
		});
	} catch (error) {
		return fail(networkFailure(error, d));
	}
	const body = await bodyOf(res);
	if (!res.ok) return fail(classifyChainFailure(res.status, body, d));
	if (!Array.isArray(body)) {
		return fail({
			kind: "malformed",
			reason: `${name} returned ${JSON.stringify(body)}, not a value array`,
		});
	}
	return { ok: true, value: body };
}

export interface PointsBreakdown {
	account: string;
	total: number;
	anchor: number;
	witness: number;
	anchorsClaimed: number;
}

/**
 * `points_breakdown(account)` — live chain state for one account. Note
 * that the module returns (0, 0, 0, 0) for an account it has never seen,
 * so a zero row here means "this account holds no Points resource", which
 * the caller must not print as "this account scored nothing this season"
 * without also saying which chain it asked.
 */
export async function fetchPointsBreakdown(
	account: string,
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
): Promise<ChainRead<PointsBreakdown>> {
	const address = normalizeAddress(account);
	if (address === null) {
		return fail({
			kind: "malformed",
			reason: `${JSON.stringify(account)} is not an account address`,
		});
	}
	const read = await callView("points_breakdown", [address], d);
	if (!read.ok) return read;
	const [total, anchor, witness, claimed] = read.value.map((v) => Number(v));
	if (![total, anchor, witness, claimed].every(Number.isFinite)) {
		return fail({
			kind: "malformed",
			reason: `points_breakdown(${address}) returned ${JSON.stringify(read.value)}`,
		});
	}
	return {
		ok: true,
		value: {
			account: address,
			total,
			anchor,
			witness,
			anchorsClaimed: claimed,
		},
	};
}

/**
 * `witness_attesters(key)` — who has attested this witness key, in order.
 * An empty array is a real answer ("nobody yet"); a failure is not an
 * empty array, which is why this returns a ChainRead.
 */
export async function fetchWitnessAttesters(
	witnessKeyHex: string,
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
): Promise<ChainRead<string[]>> {
	const key = normalizeWitnessKey(witnessKeyHex);
	if (key === null) {
		return fail({
			kind: "malformed",
			reason: `${JSON.stringify(witnessKeyHex)} is not a 32-byte witness key`,
		});
	}
	const read = await callView("witness_attesters", [`0x${key}`], d);
	if (!read.ok) return read;
	const rows = Array.isArray(read.value[0]) ? read.value[0] : [];
	const attesters: string[] = [];
	for (const row of rows) {
		const address = normalizeAddress(row);
		if (address !== null) attesters.push(address);
	}
	return { ok: true, value: attesters };
}

/**
 * Module events through the indexer's GraphQL `events` table.
 *
 * This is the read UI-015 was written against, and it no longer exists:
 * Aptos deprecated the generic `events` table and the endpoint answers the
 * query with a deprecation error rather than rows. The function is kept —
 * and tried first — because the leaderboard's honesty depends on the
 * difference between "the indexer said there are no events" and "the
 * indexer will not answer this question any more", and only asking tells
 * them apart.
 *
 * Observed against the devnet endpoint: the query comes back HTTP 400 with
 * "Request for Deprecated Resource: events", and the GraphQL endpoint
 * answers without an `access-control-allow-origin` header, so from a
 * browser the fetch is refused by CORS before the body is seen. Both paths
 * end in a named degradation on the screen; neither ends in an empty
 * leaderboard.
 */
export async function fetchEventsFromIndexer(
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
): Promise<ChainRead<FieldPointsEvent[]>> {
	const query = `query($types:[String!]){events(where:{indexed_type:{_in:$types}},order_by:{transaction_version:asc},limit:1000){transaction_version event_index type data}}`;
	let res: Response;
	try {
		res = await fetch(d.indexer, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: {
					types: [
						eventTypeTag(EVENT_NAMES.witness, d),
						eventTypeTag(EVENT_NAMES.points, d),
					],
				},
			}),
		});
	} catch (error) {
		// networkFailure names the fullnode; this read is the indexer's, and
		// a reader chasing the failure needs the endpoint that actually
		// refused — CORS on this host is the usual reason.
		return fail({
			kind: "unreachable",
			reason: `${d.indexer} unreachable — ${error instanceof Error ? error.message : String(error)} (the GraphQL endpoint sends no access-control-allow-origin header, so a browser is refused before it sees a body)`,
		});
	}
	const body = (await bodyOf(res)) as
		| { errors?: { message?: string }[]; data?: { events?: unknown[] } }
		| undefined;
	const graphqlError = body?.errors?.[0]?.message;
	if (graphqlError) {
		return fail({
			kind: "http",
			reason: `indexer refused the event query — ${graphqlError}`,
		});
	}
	if (!res.ok) {
		return fail({
			kind: "http",
			reason: `indexer answered HTTP ${res.status}`,
		});
	}
	if (!Array.isArray(body?.data?.events)) {
		return fail({
			kind: "malformed",
			reason: "indexer answered without an events array",
		});
	}
	// Reachable only if an indexer somewhere still serves the table; shaped
	// back into transaction form so one parser covers both routes.
	const asTransactions = body.data.events.map((row) => {
		const r = row as Record<string, unknown>;
		return {
			version: r.transaction_version,
			timestamp: 0,
			events: [{ type: r.type, data: r.data }],
		};
	});
	return { ok: true, value: eventsFromTransactions(asTransactions, d) };
}

/**
 * Every `field_points` / `capture_registry` event emitted by transactions
 * `account` submitted. This is the event read that works on a plain
 * fullnode today. It is complete for that account and silent about every
 * other one, so a leaderboard built from it must publish its roster —
 * see the POINTS screen, which does.
 */
export async function fetchAccountEvents(
	account: string,
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
	limit = 100,
): Promise<ChainRead<FieldPointsEvent[]>> {
	const address = normalizeAddress(account);
	if (address === null) {
		return fail({
			kind: "malformed",
			reason: `${JSON.stringify(account)} is not an account address`,
		});
	}
	let res: Response;
	try {
		res = await fetch(
			`${d.fullnode}/accounts/${address}/transactions?limit=${limit}`,
		);
	} catch (error) {
		return fail(networkFailure(error, d));
	}
	const body = await bodyOf(res);
	if (!res.ok) return fail(classifyChainFailure(res.status, body, d));
	return { ok: true, value: eventsFromTransactions(body, d) };
}

/**
 * The roster read: event history for a set of accounts, merged into one
 * totally ordered log. Failures are collected rather than thrown, so one
 * unreadable account degrades one row instead of the screen.
 */
export async function fetchEventsForAccounts(
	accounts: readonly string[],
	d: FieldPointsDeployment = FIELD_POINTS_DEPLOYMENT,
): Promise<{ events: FieldPointsEvent[]; failures: ChainFailure[] }> {
	const reads = await Promise.all(
		accounts.map((a) => fetchAccountEvents(a, d)),
	);
	const events: FieldPointsEvent[] = [];
	const failures: ChainFailure[] = [];
	const seen = new Set<string>();
	for (const read of reads) {
		if (!read.ok) {
			failures.push({ kind: read.kind, reason: read.reason });
			continue;
		}
		for (const event of read.value) {
			// Two accounts in the roster can both surface the same event
			// (a corroboration credits the opener too); (tx, index) dedupes.
			const stamp = `${event.txVersion}/${event.eventIndex}`;
			if (seen.has(stamp)) continue;
			seen.add(stamp);
			events.push(event);
		}
	}
	return { events: sortEvents(events), failures };
}
