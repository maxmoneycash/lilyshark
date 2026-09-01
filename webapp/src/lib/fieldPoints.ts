/**
 * Field Receipts points — the browser's model of the `field_points` module.
 *
 * Three things live here, and nothing that touches the network:
 *
 *  1. **Where the module is** (`FIELD_POINTS_DEPLOYMENT`). One place, on
 *     purpose. `field_points` is not on durable rails yet: it is published
 *     and exercised on **Aptos devnet**, which is periodically wiped, and
 *     the durable home is Aptos testnet (task CO-002, blocked on a
 *     web-gated faucet — contracts/field-points/README.md). Every screen
 *     that shows a number read through this module also shows
 *     `CHAIN_CAVEAT`; a devnet point total is never a permanent score.
 *
 *  2. **The frozen point schedule** (`POINTS`), mirroring the constants in
 *     contracts/field-points/sources/field_points.move and the
 *     machine-readable freeze in docs/protocol/season-0-rules.json. The
 *     chain is the authority; this copy exists so the browser can *check*
 *     what the chain emitted rather than believe it.
 *
 *  3. **The reductions** — event log → season standings, and event log →
 *     per-witness-key attestation state. Both replay the module's logic
 *     exactly the way scripts/field_receipts_score.py does (its
 *     `replay_onchain`), so the emitted `credited`/`amount` fields are
 *     cross-checked, never trusted: a disagreement becomes a discrepancy
 *     and the recomputed value is the one shown.
 *
 * Nothing here invents a row. An account with no events has no standing,
 * and a witness key nobody attested has no attesters — which is a
 * different thing from a chain that could not be read, and is modelled as
 * a different thing (see `WitnessState` and lib/fieldPointsChain.ts).
 */

/** The chain this build reads points from, and its honest label. */
export interface FieldPointsDeployment {
	/** Machine name, for keys and query params. */
	network: string;
	/** What to print wherever a number from this chain is shown. */
	chainLabel: string;
	/** The sentence that must ride along with the label. */
	caveat: string;
	fullnode: string;
	/** Indexer GraphQL endpoint, for module-event queries. */
	indexer: string;
	/** Account the modules are published under. */
	moduleAddress: string;
	moduleName: string;
	registryModuleName: string;
	/** Explorer `network` parameter for this chain. */
	explorerNetwork: string;
	/** Publish transaction recorded in contracts/field-points/README.md. */
	publishTxHash: string;
	/** UTC date that publish ran — devnet may have been wiped since. */
	publishedOnUtc: string;
}

/**
 * The deployment every screen reads. Change this one object to point the
 * analyzer at the durable testnet deployment when CO-002 lands; the label
 * and the caveat travel with it, so nothing has to be corrected screen by
 * screen.
 */
export const FIELD_POINTS_DEPLOYMENT: FieldPointsDeployment = {
	network: "aptos-devnet",
	chainLabel: "Aptos devnet",
	caveat:
		"a development network that is periodically wiped; not a durable record",
	fullnode: "https://api.devnet.aptoslabs.com/v1",
	indexer: "https://api.devnet.aptoslabs.com/v1/graphql",
	moduleAddress:
		"0xbc7bb07ff506b1b78567db545ecd4492cc94ca42315eb018e6885ef6b6002e2b",
	moduleName: "field_points",
	registryModuleName: "capture_registry",
	explorerNetwork: "devnet",
	publishTxHash:
		"0xdea76b510474c1364aad0a8d4868132e9f077d1105b8414e2918b90f43e8349d",
	publishedOnUtc: "2026-08-20",
};

/** One line, used verbatim wherever devnet numbers reach the screen. */
export const CHAIN_CAVEAT = `${FIELD_POINTS_DEPLOYMENT.chainLabel} — ${FIELD_POINTS_DEPLOYMENT.caveat}`;

/** Season 0's window, from docs/protocol/season-0.md. */
export const SEASON = {
	name: "Season 0",
	opensUtc: "2026-10-01T00:00:00Z",
	closesUtc: "2026-12-31T23:59:59Z",
	rulesDoc: "docs/protocol/season-0.md",
	rulesJson: "docs/protocol/season-0-rules.json",
} as const;

/**
 * The frozen schedule. These are the module's own constants — the chain
 * enforces them, this copy only audits.
 */
export const POINTS = {
	/** POINTS_ANCHOR — per capture anchored in capture_registry. */
	anchor: 10,
	/** POINTS_WITNESS — to both attesters when a key becomes corroborated. */
	corroboration: 25,
	/** POINTS_LATE_WITNESS — to attesters 3..=maxCreditedAttesters. */
	lateWitness: 5,
	/** MAX_CREDITED_ATTESTERS — later attesters are recorded, never paid. */
	maxCreditedAttesters: 8,
	/** WITNESS_WINDOW_SECS — 7 days after the key was opened. */
	windowSecs: 7 * 24 * 60 * 60,
} as const;

/** PointsAwarded.kind values, from field_points.move. */
export const KIND = { anchor: 0, witness: 1, lateWitness: 2 } as const;

export const EVENT_NAMES = {
	witness: "WitnessAttested",
	points: "PointsAwarded",
	capture: "CaptureRegistered",
} as const;

/* ── addresses ─────────────────────────────────────────────────────────── */

const HEX_ADDRESS = /^0x[0-9a-f]+$/;

/**
 * Aptos prints the same account several ways — `0xa1fa`, `0xA1FA`, and the
 * 64-nibble long form all name one account — so every address is folded to
 * lowercase long form before it is used as a map key or compared. Returns
 * null for anything that is not an address at all, so a malformed field
 * drops the row instead of creating a phantom account.
 */
export function normalizeAddress(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = (value.startsWith("0x") ? value : `0x${value}`).toLowerCase();
	if (!HEX_ADDRESS.test(text)) return null;
	const body = text.slice(2);
	if (body.length === 0 || body.length > 64) return null;
	return `0x${body.padStart(64, "0")}`;
}

/** Short display form, e.g. `0xbc7bb0…02e2b`. Never used for comparison. */
export function shortAddress(address: string): string {
	return address.length > 16
		? `${address.slice(0, 8)}…${address.slice(-5)}`
		: address;
}

/** Lowercase hex of a byte string, no `0x`. Witness keys are stored this way. */
export function hexOfBytes(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

const HEX32 = /^[0-9a-f]{64}$/;

/** A 32-byte witness key as bare lowercase hex, or null if it is not one. */
export function normalizeWitnessKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = (value.startsWith("0x") ? value.slice(2) : value).toLowerCase();
	return HEX32.test(text) ? text : null;
}

/* ── URLs ──────────────────────────────────────────────────────────────── */

const D = FIELD_POINTS_DEPLOYMENT;

/** `<addr>::field_points` — the module id the chain answers to. */
export function fieldPointsModule(d: FieldPointsDeployment = D): string {
	return `${d.moduleAddress}::${d.moduleName}`;
}

/** Fully-qualified name of one entry or view function. */
export function fieldPointsFunction(
	name: string,
	d: FieldPointsDeployment = D,
): string {
	return `${fieldPointsModule(d)}::${name}`;
}

/** The type tag an emitted module event carries, e.g. `…::WitnessAttested`. */
export function eventTypeTag(
	name: string,
	d: FieldPointsDeployment = D,
): string {
	return `${fieldPointsModule(d)}::${name}`;
}

/** `…::capture_registry::CaptureRegistered`. */
export function registryEventTypeTag(
	name: string,
	d: FieldPointsDeployment = D,
): string {
	return `${d.moduleAddress}::${d.registryModuleName}::${name}`;
}

/** The plainest "it is really on chain": the fullnode's bytecode endpoint. */
export function moduleUrl(d: FieldPointsDeployment = D): string {
	return `${d.fullnode}/accounts/${d.moduleAddress}/module/${d.moduleName}`;
}

export function explorerAccount(
	address: string,
	d: FieldPointsDeployment = D,
): string {
	return `https://explorer.aptoslabs.com/account/${address}?network=${d.explorerNetwork}`;
}

export function explorerTxn(
	txHash: string,
	d: FieldPointsDeployment = D,
): string {
	return `https://explorer.aptoslabs.com/txn/${txHash}?network=${d.explorerNetwork}`;
}

/* ── the attest command ────────────────────────────────────────────────── */

/**
 * The browser holds no Aptos key and this app has no wallet adapter (check
 * webapp/package.json — there is no `@aptos-labs/wallet-adapter`, and
 * adding wallet infrastructure is not in scope for these tasks), so an
 * attestation is not something this page can submit. What it can do
 * honestly is compute the key and hand over the exact command that submits
 * it, which the operator runs against their own funded profile.
 *
 * `profile` names an `aptos init` profile; the caller passes whatever the
 * operator typed, defaulting to a placeholder that is obviously a
 * placeholder.
 */
export function attestCommand(
	witnessKeyHex: string,
	profile = "<your-aptos-profile>",
	d: FieldPointsDeployment = D,
): string {
	const key = normalizeWitnessKey(witnessKeyHex);
	if (key === null) {
		throw new RangeError(
			`witness key must be 32 bytes of hex, got ${JSON.stringify(witnessKeyHex)}`,
		);
	}
	return [
		"aptos move run \\",
		`  --function-id ${fieldPointsFunction("attest_witness", d)} \\`,
		`  --args hex:0x${key} \\`,
		`  --url ${d.fullnode} \\`,
		`  --profile ${profile}`,
	].join("\n");
}

/** One command per key — `attest_witness` takes exactly one key per call. */
export function attestCommands(
	witnessKeyHexes: readonly string[],
	profile?: string,
	d: FieldPointsDeployment = D,
): string {
	return witnessKeyHexes.map((k) => attestCommand(k, profile, d)).join("\n\n");
}

/* ── events ────────────────────────────────────────────────────────────── */

export interface EventOrder {
	/** Transaction version on chain — the outer sort key. */
	txVersion: number;
	/** Position within the transaction — the inner sort key. */
	eventIndex: number;
	/** Chain time of the transaction, in unix seconds. */
	timestampUnix: number;
}

export interface WitnessAttestedEvent extends EventOrder {
	type: "WitnessAttested";
	/** 32-byte key as bare lowercase hex. */
	key: string;
	attester: string;
	/** 1-based position the chain claimed — cross-checked, never trusted. */
	position: number;
	/** Points the chain claimed to credit — cross-checked, never trusted. */
	credited: number;
}

export interface PointsAwardedEvent extends EventOrder {
	type: "PointsAwarded";
	account: string;
	kind: number;
	amount: number;
}

export interface CaptureRegisteredEvent extends EventOrder {
	type: "CaptureRegistered";
	publisher: string;
	commitment: string;
}

export type FieldPointsEvent =
	| WitnessAttestedEvent
	| PointsAwardedEvent
	| CaptureRegisteredEvent;

export class FieldPointsInputError extends Error {}

function fail(message: string): never {
	throw new FieldPointsInputError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An integer, however the JSON spelled it — Move renders u64 as a string. */
function intOf(value: unknown, where: string): number {
	const n =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(n)) {
		fail(`${where}: expected an integer, got ${JSON.stringify(value)}`);
	}
	return n;
}

function addressOf(value: unknown, where: string): string {
	const address = normalizeAddress(value);
	if (address === null) {
		fail(`${where}: expected an account address, got ${JSON.stringify(value)}`);
	}
	return address;
}

function keyOf(value: unknown, where: string): string {
	const key = normalizeWitnessKey(value);
	if (key === null) {
		fail(
			`${where}: expected 32 bytes of hex (a witness key), got ${JSON.stringify(value)}`,
		);
	}
	return key;
}

/** Total order on the log: (tx_version, event_index), exactly the scorer's. */
export function sortEvents(events: FieldPointsEvent[]): FieldPointsEvent[] {
	return events
		.slice()
		.sort(
			(a, b) => a.txVersion - b.txVersion || a.eventIndex - b.eventIndex,
		);
}

/**
 * Parse the season scorer's event-extract schema — the one documented in
 * scripts/field_receipts_score.py and produced for it — so an extract that
 * feeds the published scorer feeds this screen unchanged, and the two can
 * be compared line for line.
 *
 * Duplicate (tx_version, event_index) pairs are rejected for the same
 * reason the scorer rejects them: they would break the total order the
 * replay depends on.
 */
export function parseEventsDocument(doc: unknown): FieldPointsEvent[] {
	if (!isObject(doc) || !Array.isArray(doc.events)) {
		fail("events file must be an object with an 'events' array");
	}
	const out: FieldPointsEvent[] = [];
	const seen = new Set<string>();
	doc.events.forEach((raw, index) => {
		const where = `events[${index}]`;
		if (!isObject(raw)) fail(`${where}: expected an object`);
		const order: EventOrder = {
			txVersion: intOf(raw.tx_version, `${where}.tx_version`),
			eventIndex: intOf(raw.event_index ?? 0, `${where}.event_index`),
			timestampUnix: intOf(raw.timestamp_unix, `${where}.timestamp_unix`),
		};
		const stamp = `${order.txVersion}/${order.eventIndex}`;
		if (seen.has(stamp)) {
			fail(
				`${where}: duplicate (tx_version, event_index) ${stamp} breaks the total order`,
			);
		}
		seen.add(stamp);
		const data = raw.data;
		if (!isObject(data)) fail(`${where}.data: expected an object`);
		if (raw.type === EVENT_NAMES.witness) {
			out.push({
				...order,
				type: "WitnessAttested",
				key: keyOf(data.key, `${where}.data.key`),
				attester: addressOf(data.attester, `${where}.data.attester`),
				position: intOf(data.position, `${where}.data.position`),
				credited: intOf(data.credited, `${where}.data.credited`),
			});
		} else if (raw.type === EVENT_NAMES.points) {
			out.push({
				...order,
				type: "PointsAwarded",
				account: addressOf(data.account, `${where}.data.account`),
				kind: intOf(data.kind, `${where}.data.kind`),
				amount: intOf(data.amount, `${where}.data.amount`),
			});
		} else if (raw.type === EVENT_NAMES.capture) {
			out.push({
				...order,
				type: "CaptureRegistered",
				publisher: addressOf(data.publisher, `${where}.data.publisher`),
				commitment: keyOf(data.commitment, `${where}.data.commitment`),
			});
		} else {
			fail(
				`${where}.type: expected one of ${Object.values(EVENT_NAMES).join(", ")}, got ${JSON.stringify(raw.type)}`,
			);
		}
	});
	return sortEvents(out);
}

/**
 * The same events as the fullnode hands them back inside user
 * transactions: `GET /v1/accounts/<addr>/transactions` returns every
 * transaction an account *submitted*, each carrying the events it emitted,
 * with the module's fully-qualified type tag on each one.
 *
 * This is the read that works today. Module events (`event::emit`) have no
 * event handle, so the fullnode's events-by-handle API cannot list them,
 * and the indexer's generic `events` table has been deprecated — see
 * lib/fieldPointsChain.ts, which reports that plainly rather than showing
 * an empty leaderboard as if it were a finished season.
 *
 * Anything that is not one of this module's events is skipped silently:
 * a transaction that also transferred gas coin is not a parse failure.
 */
export function eventsFromTransactions(
	transactions: unknown,
	d: FieldPointsDeployment = D,
): FieldPointsEvent[] {
	if (!Array.isArray(transactions)) return [];
	const witnessTag = eventTypeTag(EVENT_NAMES.witness, d);
	const pointsTag = eventTypeTag(EVENT_NAMES.points, d);
	const captureTag = registryEventTypeTag(EVENT_NAMES.capture, d);
	const out: FieldPointsEvent[] = [];
	for (const txn of transactions) {
		if (!isObject(txn) || !Array.isArray(txn.events)) continue;
		const txVersion = Number(txn.version);
		// Aptos transaction timestamps are microseconds since the epoch.
		const micros = Number(txn.timestamp);
		if (!Number.isFinite(txVersion) || !Number.isFinite(micros)) continue;
		const order = {
			txVersion,
			timestampUnix: Math.floor(micros / 1e6),
		};
		txn.events.forEach((raw, eventIndex) => {
			if (!isObject(raw) || !isObject(raw.data)) return;
			const data = raw.data;
			try {
				if (raw.type === witnessTag) {
					out.push({
						...order,
						eventIndex,
						type: "WitnessAttested",
						key: keyOf(data.key, "event.data.key"),
						attester: addressOf(data.attester, "event.data.attester"),
						position: intOf(data.position, "event.data.position"),
						credited: intOf(data.credited, "event.data.credited"),
					});
				} else if (raw.type === pointsTag) {
					out.push({
						...order,
						eventIndex,
						type: "PointsAwarded",
						account: addressOf(data.account, "event.data.account"),
						kind: intOf(data.kind, "event.data.kind"),
						amount: intOf(data.amount, "event.data.amount"),
					});
				} else if (raw.type === captureTag) {
					out.push({
						...order,
						eventIndex,
						type: "CaptureRegistered",
						publisher: addressOf(data.publisher, "event.data.publisher"),
						commitment: keyOf(data.commitment, "event.data.commitment"),
					});
				}
			} catch (error) {
				if (!(error instanceof FieldPointsInputError)) throw error;
				// A malformed event from this module is a discrepancy in the
				// chain data, not a reason to drop the whole transaction —
				// but it is also not a row we can score, so it is skipped.
			}
		});
	}
	return sortEvents(out);
}

/* ── witness-key indexing (UI-014) ─────────────────────────────────────── */

export interface WitnessAttestation {
	attester: string;
	/** Recomputed position, 1-based — not the chain's claim. */
	position: number;
	/** Recomputed credit under the frozen schedule. */
	credited: number;
	timestampUnix: number;
	txVersion: number;
}

export interface WitnessRecord {
	key: string;
	firstAtUnix: number;
	attestations: WitnessAttestation[];
}

/** What one attester earns at `position`, replaying field_points::attest_witness. */
export function creditForPosition(
	position: number,
	firstAtUnix: number,
	atUnix: number,
): number {
	if (position <= 1) return 0;
	const inWindow = atUnix <= firstAtUnix + POINTS.windowSecs;
	if (!inWindow || position > POINTS.maxCreditedAttesters) return 0;
	return position === 2 ? POINTS.corroboration : POINTS.lateWitness;
}

/**
 * Every witness key the log mentions, keyed by bare lowercase hex. A key
 * absent from this map was never attested *in the events that were read* —
 * which is why the caller must know whether the read succeeded before it
 * renders "not attested". See `WitnessState`.
 */
export function indexWitnesses(
	events: readonly FieldPointsEvent[],
): Map<string, WitnessRecord> {
	const book = new Map<string, WitnessRecord>();
	for (const event of sortEvents(events as FieldPointsEvent[])) {
		if (event.type !== "WitnessAttested") continue;
		let record = book.get(event.key);
		if (!record) {
			record = {
				key: event.key,
				firstAtUnix: event.timestampUnix,
				attestations: [],
			};
			book.set(event.key, record);
		}
		// attest_witness aborts on a repeat attester, so a duplicate in the
		// log is data the module could not have produced. Keep the first.
		if (record.attestations.some((a) => a.attester === event.attester)) continue;
		const position = record.attestations.length + 1;
		record.attestations.push({
			attester: event.attester,
			position,
			credited: creditForPosition(
				position,
				record.firstAtUnix,
				event.timestampUnix,
			),
			timestampUnix: event.timestampUnix,
			txVersion: event.txVersion,
		});
	}
	return book;
}

/**
 * A frame's witness state, as TRAFFIC shows it.
 *
 * `unknown` is a first-class state and never collapses into
 * `not-attested`: a chain that could not be read has not told us that
 * nobody attested, and rendering an unread chain as an empty one would be
 * the fake zero this protocol's whole trust model is built to avoid.
 * `ineligible` is the library's refusal (a synthetic frame, a missing
 * clock anchor) and carries no chain claim at all.
 */
export type WitnessState =
	| { kind: "ineligible"; reason: string }
	| { kind: "unknown" }
	| { kind: "not-attested" }
	| { kind: "attested"; count: 1; byYou: boolean }
	| { kind: "corroborated"; count: number; byYou: boolean };

/**
 * Fold one key's attesters into the state TRAFFIC renders. `self` is the
 * operator's own account when they have told the analyzer what it is —
 * without it "attested by you" cannot be claimed, so it is not.
 */
export function witnessStateOf(
	record: WitnessRecord | undefined,
	self: string | null,
): WitnessState {
	if (!record) return { kind: "not-attested" };
	const count = record.attestations.length;
	if (count === 0) return { kind: "not-attested" };
	const byYou =
		self !== null && record.attestations.some((a) => a.attester === self);
	return count === 1
		? { kind: "attested", count: 1, byYou }
		: { kind: "corroborated", count, byYou };
}

/** The same fold from a bare attester list — what `witness_attesters` returns. */
export function witnessStateOfAttesters(
	attesters: readonly string[] | undefined,
	self: string | null,
): WitnessState {
	if (attesters === undefined) return { kind: "unknown" };
	if (attesters.length === 0) return { kind: "not-attested" };
	const byYou = self !== null && attesters.includes(self);
	return attesters.length === 1
		? { kind: "attested", count: 1, byYou }
		: { kind: "corroborated", count: attesters.length, byYou };
}

/** Short label for a witness state — the table cell and the badge agree. */
export function witnessStateLabel(state: WitnessState): string {
	switch (state.kind) {
		case "ineligible":
			return `NO KEY · ${state.reason.toUpperCase()}`;
		case "unknown":
			return "CHAIN NOT READ";
		case "not-attested":
			return "NOT ATTESTED";
		case "attested":
			return state.byYou ? "ATTESTED BY YOU" : "ATTESTED ×1";
		case "corroborated":
			return state.byYou
				? `CORROBORATED ×${state.count} · INCLUDING YOU`
				: `CORROBORATED ×${state.count}`;
	}
}

/* ── standings (UI-015) ────────────────────────────────────────────────── */

export interface Discrepancy {
	type:
		| "witness_duplicate_attester"
		| "witness_position_mismatch"
		| "witness_credited_mismatch"
		| "witness_points_awarded_mismatch"
		| "anchor_overclaim"
		| "anchor_amount_not_multiple"
		| "unknown_points_kind";
	detail: string;
}

export interface AccountStanding {
	account: string;
	/** Rank by total, 1-based; ties share a rank. */
	rank: number;
	/** min(claimed, 10 × anchors registered) — an overclaim never counts. */
	anchorPoints: number;
	/** Recomputed corroboration + late-witness points. */
	witnessPoints: number;
	total: number;
	anchorsRegistered: number;
	/** Attestations this account submitted, whatever they earned. */
	attestations: number;
	/** In-window position-2 pairings — the protocol's strongest signal. */
	corroborations: number;
}

export interface Standings {
	rows: AccountStanding[];
	discrepancies: Discrepancy[];
	eventCount: number;
	witnessKeyCount: number;
	/** null when the log is empty — never [0, 0]. */
	txVersionRange: [number, number] | null;
	timeRangeUnix: [number, number] | null;
}

/**
 * Event log → season standings, recomputing every credit from the frozen
 * schedule rather than summing what the chain said it paid. This is
 * scripts/field_receipts_score.py's `replay_onchain` in TypeScript, minus
 * the parts that need capture blobs (cell bonuses) or season policy
 * (clique down-weighting) — those belong to the published scorer, which
 * runs over the same extract and whose output the COVERAGE screen loads.
 *
 * Every address that appears in any event gets a row, including one whose
 * activity recomputes to zero: a participant who earned nothing is a fact,
 * and dropping them would quietly flatter the table.
 */
export function reduceStandings(
	events: readonly FieldPointsEvent[],
): Standings {
	const ordered = sortEvents(events as FieldPointsEvent[]);
	const discrepancies: Discrepancy[] = [];
	const participants = new Set<string>();
	const registered = new Map<string, number>();
	const awarded = new Map<string, Map<number, number>>();
	const witnessPoints = new Map<string, number>();
	const attestationCount = new Map<string, number>();
	const corroborationCount = new Map<string, number>();
	const book = new Map<string, WitnessRecord>();

	const bump = (map: Map<string, number>, key: string, by: number) =>
		map.set(key, (map.get(key) ?? 0) + by);

	for (const event of ordered) {
		if (event.type === "CaptureRegistered") {
			participants.add(event.publisher);
			bump(registered, event.publisher, 1);
			continue;
		}
		if (event.type === "PointsAwarded") {
			participants.add(event.account);
			if (
				event.kind !== KIND.anchor &&
				event.kind !== KIND.witness &&
				event.kind !== KIND.lateWitness
			) {
				discrepancies.push({
					type: "unknown_points_kind",
					detail: `${shortAddress(event.account)} was awarded kind ${event.kind} at tx ${event.txVersion} — the module emits 0, 1 or 2`,
				});
				continue;
			}
			if (event.kind === KIND.anchor && event.amount % POINTS.anchor !== 0) {
				discrepancies.push({
					type: "anchor_amount_not_multiple",
					detail: `${shortAddress(event.account)} claimed ${event.amount} anchor points at tx ${event.txVersion}, not a multiple of ${POINTS.anchor}`,
				});
			}
			const kinds = awarded.get(event.account) ?? new Map<number, number>();
			kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + event.amount);
			awarded.set(event.account, kinds);
			continue;
		}

		participants.add(event.attester);
		bump(attestationCount, event.attester, 1);
		let record = book.get(event.key);
		if (!record) {
			record = {
				key: event.key,
				firstAtUnix: event.timestampUnix,
				attestations: [],
			};
			book.set(event.key, record);
		}
		if (record.attestations.some((a) => a.attester === event.attester)) {
			discrepancies.push({
				type: "witness_duplicate_attester",
				detail: `${shortAddress(event.attester)} attested key ${event.key.slice(0, 12)}… twice (tx ${event.txVersion}) — attest_witness aborts on that`,
			});
			continue;
		}
		const position = record.attestations.length + 1;
		const credited = creditForPosition(
			position,
			record.firstAtUnix,
			event.timestampUnix,
		);
		record.attestations.push({
			attester: event.attester,
			position,
			credited,
			timestampUnix: event.timestampUnix,
			txVersion: event.txVersion,
		});
		if (position === 2 && credited > 0) {
			const opener = record.attestations[0].attester;
			bump(witnessPoints, opener, POINTS.corroboration);
			bump(witnessPoints, event.attester, POINTS.corroboration);
			bump(corroborationCount, opener, 1);
			bump(corroborationCount, event.attester, 1);
		} else if (credited > 0) {
			bump(witnessPoints, event.attester, credited);
		}
		if (event.position !== position) {
			discrepancies.push({
				type: "witness_position_mismatch",
				detail: `key ${event.key.slice(0, 12)}… at tx ${event.txVersion}: chain said position ${event.position}, replay says ${position}`,
			});
		}
		if (event.credited !== credited) {
			discrepancies.push({
				type: "witness_credited_mismatch",
				detail: `key ${event.key.slice(0, 12)}… at tx ${event.txVersion}: chain said ${event.credited} credited, replay says ${credited}`,
			});
		}
	}

	const accounts = new Set<string>([
		...participants,
		...witnessPoints.keys(),
		...awarded.keys(),
		...registered.keys(),
	]);
	const rows: AccountStanding[] = [];
	for (const account of Array.from(accounts).sort()) {
		const kinds = awarded.get(account);
		const emittedWitness =
			(kinds?.get(KIND.witness) ?? 0) + (kinds?.get(KIND.lateWitness) ?? 0);
		const recomputedWitness = witnessPoints.get(account) ?? 0;
		if (emittedWitness !== recomputedWitness) {
			discrepancies.push({
				type: "witness_points_awarded_mismatch",
				detail: `${shortAddress(account)}: PointsAwarded sums to ${emittedWitness} witness points, replay says ${recomputedWitness}`,
			});
		}
		const claimed = kinds?.get(KIND.anchor) ?? 0;
		const anchors = registered.get(account) ?? 0;
		const maxClaimable = anchors * POINTS.anchor;
		if (claimed > maxClaimable) {
			discrepancies.push({
				type: "anchor_overclaim",
				detail: `${shortAddress(account)} claimed ${claimed} anchor points against ${anchors} anchor(s) — at most ${maxClaimable} is claimable`,
			});
		}
		const anchorPoints = Math.min(claimed, maxClaimable);
		rows.push({
			account,
			rank: 0,
			anchorPoints,
			witnessPoints: recomputedWitness,
			total: anchorPoints + recomputedWitness,
			anchorsRegistered: anchors,
			attestations: attestationCount.get(account) ?? 0,
			corroborations: corroborationCount.get(account) ?? 0,
		});
	}

	// Highest total first; ties broken by address so two runs over the same
	// log print the same table, and tied accounts share a rank.
	rows.sort((a, b) => b.total - a.total || a.account.localeCompare(b.account));
	let rank = 0;
	let previous: number | null = null;
	rows.forEach((row, index) => {
		if (previous === null || row.total !== previous) rank = index + 1;
		row.rank = rank;
		previous = row.total;
	});

	return {
		rows,
		discrepancies,
		eventCount: ordered.length,
		witnessKeyCount: book.size,
		txVersionRange:
			ordered.length === 0
				? null
				: [
						ordered[0].txVersion,
						ordered[ordered.length - 1].txVersion,
					],
		timeRangeUnix:
			ordered.length === 0
				? null
				: [
						Math.min(...ordered.map((e) => e.timestampUnix)),
						Math.max(...ordered.map((e) => e.timestampUnix)),
					],
	};
}

/* ── degraded chain reads ──────────────────────────────────────────────── */

/**
 * Why a chain read produced nothing. `module-not-found` is deliberately
 * separate from `error`: on a network that is periodically wiped, a
 * missing module is the expected weekday state, not a failure the operator
 * caused, and it must read that way.
 */
export type ChainFailureKind =
	| "module-not-found"
	| "unreachable"
	| "http"
	| "malformed";

export interface ChainFailure {
	kind: ChainFailureKind;
	/** One sentence, already fit to show a user. */
	reason: string;
}

/**
 * Classify a fullnode response. The REST API answers a missing module with
 * 404 + `module_not_found`, and the `/view` endpoint with 400 and a message
 * naming the module — both mean the same thing on a wiped devnet, so both
 * land on `module-not-found`.
 */
export function classifyChainFailure(
	status: number,
	body: unknown,
	d: FieldPointsDeployment = D,
): ChainFailure {
	const message =
		isObject(body) && typeof body.message === "string" ? body.message : "";
	const code =
		isObject(body) && typeof body.error_code === "string" ? body.error_code : "";
	const missing =
		code === "module_not_found" ||
		/module.*(can't be found|not found)/i.test(message);
	if (missing) {
		return {
			kind: "module-not-found",
			reason: `${fieldPointsModule(d)} is not published on ${d.chainLabel} right now — ${d.caveat}. Nothing was lost by you: the deployment dated ${d.publishedOnUtc} has been wiped, and the durable home is Aptos testnet (task CO-002).`,
		};
	}
	return {
		kind: "http",
		reason: `${d.chainLabel} answered HTTP ${status}${message ? ` — ${message}` : ""}`,
	};
}

/** A thrown fetch (DNS, CORS, offline) rather than an HTTP answer. */
export function networkFailure(
	error: unknown,
	d: FieldPointsDeployment = D,
): ChainFailure {
	return {
		kind: "unreachable",
		reason: `${d.fullnode} unreachable — ${error instanceof Error ? error.message : String(error)}`,
	};
}
