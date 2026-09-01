import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ChainFailure,
	CHAIN_CAVEAT,
	explorerAccount,
	explorerTxn,
	type FieldPointsEvent,
	FIELD_POINTS_DEPLOYMENT as CHAIN,
	FieldPointsInputError,
	fieldPointsModule,
	moduleUrl,
	normalizeAddress,
	parseEventsDocument,
	POINTS,
	reduceStandings,
	SEASON,
	shortAddress,
	type Standings,
} from "../../lib/fieldPoints.ts";
import {
	fetchEventsForAccounts,
	fetchEventsFromIndexer,
	probeModule,
} from "../../lib/fieldPointsChain.ts";
import {
	EXAMPLE_EVENTS_DOCUMENT,
	EXAMPLE_LABEL,
	EXAMPLE_SOURCE_NAME,
} from "../../lib/fieldPointsExample.ts";

/**
 * POINTS — the Season 0 leaderboard, read from `field_points` events.
 *
 * WiGLE ran two decades on rank alone, so this is the cheapest useful
 * surface Field Receipts has. It is also the surface where it would be
 * easiest to lie, so the rules this screen holds itself to are explicit:
 *
 *  - **Every number says which chain it came from.** `field_points` is on
 *    Aptos devnet, which is periodically wiped, and the durable home is
 *    Aptos testnet (task CO-002, blocked on a web-gated faucet). A devnet
 *    total is never presented as a permanent score.
 *  - **A dead endpoint dims the panel and says why** — the way the SHELBY
 *    screen reports an unreachable fullnode. It never renders a zero.
 *  - **A wiped devnet is a normal state**, not an error the reader caused,
 *    and reads as one.
 *  - **The standings are recomputed, not mirrored.** Every credit is
 *    replayed from the frozen schedule (lib/fieldPoints.ts) exactly as
 *    scripts/field_receipts_score.py replays it, so the table the analyzer
 *    draws is the table a dispute would be settled with. Disagreements
 *    between the chain's own `credited`/`amount` fields and the replay are
 *    shown as discrepancies rather than smoothed over.
 *  - **Nothing is invented.** The bundled example is invented and says so
 *    on every row, with the COVERAGE screen's label.
 *
 * On the event read itself: module events (`event::emit`) carry no event
 * handle, so a fullnode cannot enumerate them globally, and the indexer's
 * generic `events` table has been deprecated. The indexer is still asked
 * first — and its refusal is printed — after which history is read per
 * account from the transactions each roster account submitted. That makes
 * the leaderboard's completeness exactly as good as its published roster,
 * which is stated on the screen rather than hidden.
 */

type SourceKind = "chain" | "extract" | "example";

interface LoadedEvents {
	kind: SourceKind;
	name: string;
	events: FieldPointsEvent[];
}

const SCHEDULE: [string, string, string][] = [
	[
		"Witness corroboration",
		`${POINTS.corroboration} each`,
		"to the opener and the second distinct account attesting one witness key, inside the 7-day window",
	],
	[
		"Late witness",
		`${POINTS.lateWitness}`,
		`attesters 3–${POINTS.maxCreditedAttesters} of an already-corroborated key, inside the window`,
	],
	[
		"Beyond the cap, or late",
		"0",
		"recorded — the corroboration count is useful data — but never credited",
	],
	[
		"Anchor claim",
		`${POINTS.anchor}`,
		"per capture anchored in capture_registry and claimed with claim_anchor_points",
	],
];

const utcDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** One failure, rendered the way SHELBY renders an unreachable fullnode. */
function FailureNote({ failure }: { failure: ChainFailure }) {
	return (
		<div className="panel-foot" style={{ alignItems: "baseline" }}>
			<span className={failure.kind === "module-not-found" ? "warn" : "err"}>
				{failure.kind === "module-not-found"
					? "MODULE NOT FOUND ON THIS NETWORK"
					: failure.kind === "unreachable"
						? "ENDPOINT UNREACHABLE"
						: "CHAIN READ REFUSED"}
			</span>
			<span className="dim" style={{ wordBreak: "break-word" }}>
				{failure.reason}
			</span>
		</div>
	);
}

export default function Points() {
	const [probe, setProbe] = useState<ChainFailure | "ok" | null>(null);
	const [roster, setRoster] = useState<string[]>([CHAIN.moduleAddress]);
	const [addressDraft, setAddressDraft] = useState("");
	const [loaded, setLoaded] = useState<LoadedEvents | null>(null);
	const [readFailures, setReadFailures] = useState<ChainFailure[]>([]);
	const [indexerFailure, setIndexerFailure] = useState<ChainFailure | null>(
		null,
	);
	const [reading, setReading] = useState(false);
	const [err, setErr] = useState("");
	const alive = useRef(true);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	/**
	 * One pass over the chain: is the module there, will the indexer answer,
	 * and what did the roster's own transactions emit. Every step's failure
	 * is kept and shown; none of them turns into an empty table pretending
	 * to be a finished season.
	 */
	const readChain = useCallback(async () => {
		setReading(true);
		setErr("");
		try {
			const found = await probeModule();
			if (!alive.current) return;
			if (!found.ok) {
				setProbe({ kind: found.kind, reason: found.reason });
				setReadFailures([]);
				setIndexerFailure(null);
				setLoaded((prev) => (prev?.kind === "chain" ? null : prev));
				return;
			}
			setProbe("ok");
			const viaIndexer = await fetchEventsFromIndexer();
			if (!alive.current) return;
			setIndexerFailure(
				viaIndexer.ok ? null : { kind: viaIndexer.kind, reason: viaIndexer.reason },
			);
			const viaAccounts = await fetchEventsForAccounts(roster);
			if (!alive.current) return;
			setReadFailures(viaAccounts.failures);
			const merged = viaIndexer.ok
				? [...viaIndexer.value, ...viaAccounts.events]
				: viaAccounts.events;
			const seen = new Set<string>();
			const events = merged.filter((e) => {
				const stamp = `${e.txVersion}/${e.eventIndex}`;
				if (seen.has(stamp)) return false;
				seen.add(stamp);
				return true;
			});
			setLoaded({
				kind: "chain",
				name: `${CHAIN.chainLabel} · ${roster.length} account(s) in the roster`,
				events,
			});
		} catch (error) {
			if (alive.current) {
				setErr(error instanceof Error ? error.message : String(error));
			}
		} finally {
			if (alive.current) setReading(false);
		}
	}, [roster]);

	useEffect(() => {
		void readChain();
	}, [readChain]);

	const standings: Standings | null = useMemo(
		() => (loaded ? reduceStandings(loaded.events) : null),
		[loaded],
	);
	const isExample = loaded?.kind === "example";

	const onFile = async (files: FileList | null) => {
		const file = files?.[0];
		if (!file) return;
		setErr("");
		try {
			const doc = JSON.parse(await file.text());
			setLoaded({
				kind: "extract",
				name: file.name,
				events: parseEventsDocument(doc),
			});
		} catch (error) {
			setErr(
				`${file.name}: ${
					error instanceof FieldPointsInputError || error instanceof Error
						? error.message
						: String(error)
				}`,
			);
		}
	};

	const addAddress = () => {
		const address = normalizeAddress(addressDraft.trim());
		if (address === null) {
			setErr(`${addressDraft.trim() || "(empty)"} is not an account address`);
			return;
		}
		setErr("");
		setAddressDraft("");
		setRoster((prev) => (prev.includes(address) ? prev : [...prev, address]));
	};

	const status =
		probe === null
			? { text: "READING…", className: "dim" }
			: probe === "ok"
				? { text: "MODULE LIVE", className: "ok" }
				: probe.kind === "module-not-found"
					? { text: "MODULE NOT FOUND", className: "warn" }
					: { text: "FULLNODE UNREACHABLE", className: "err" };

	return (
		<main>
			<div className="panel" style={{ flex: 1 }}>
				<div className="panel-title">
					PANEL // {SEASON.name.toUpperCase()} LEADERBOARD
					<span className="spacer" />
					{isExample && <span className="sim-badge">{EXAMPLE_LABEL}</span>}
					<span className={status.className}>{status.text}</span>
				</div>

				<div className="scroll-y">
					<div className="prose">
						<p>
							Season standings, replayed from <code>field_points</code> events.
							Every credit here is recomputed from the frozen schedule rather
							than copied out of the event — the same replay
							<code> scripts/field_receipts_score.py</code> performs — so what
							this table shows is what a dispute would be settled with. Where
							the chain's own <code>credited</code> or <code>amount</code>{" "}
							disagrees with the replay, the disagreement is listed below the
							table and the recomputed value is the one ranked.
						</p>
						<p className="warn">
							This reads <strong>{CHAIN_CAVEAT}</strong>. Points shown here are
							a live demonstration of the loop, not a permanent score. The
							durable home for the scoreboard is Aptos testnet — task CO-002,
							which needs one human step at a web-gated faucet (see{" "}
							<code>contracts/field-points/README.md</code>).
						</p>
					</div>

					{probe !== null && probe !== "ok" && (
						<div style={{ opacity: 0.62 }}>
							<div className="panel-title">CHAIN READ DEGRADED</div>
							<FailureNote failure={probe} />
							{probe.kind === "module-not-found" && (
								<div className="prose">
									<p>
										That is a normal state on this network and nothing you did:{" "}
										{CHAIN.chainLabel} is wiped periodically, and the deployment
										dated {CHAIN.publishedOnUtc} (publish tx{" "}
										<a
											href={explorerTxn(CHAIN.publishTxHash)}
											target="_blank"
											rel="noreferrer"
										>
											{shortAddress(CHAIN.publishTxHash)}
										</a>
										) is gone with it. The module itself is unit-tested and
										Move-Prover-checked in the repository; what is missing is a
										durable network to publish it to.
									</p>
									<p>
										Until then this screen has nothing on-chain to rank. Load a
										published event extract on the right — the same JSON schema
										the season scorer consumes — or the bundled example to see
										the shape of the table.
									</p>
								</div>
							)}
						</div>
					)}

					{indexerFailure && (
						<>
							<div className="panel-title">INDEXER</div>
							<FailureNote failure={indexerFailure} />
							<div className="panel-foot dim">
								Module events (<code>event::emit</code>) carry no event handle,
								so a fullnode cannot enumerate them network-wide either. History
								below is therefore read per account, from the transactions each
								roster account submitted — complete for those accounts and
								silent about every other one.
							</div>
						</>
					)}

					<div className="panel-title">
						<span>
							STANDINGS
							{standings ? ` · ${standings.rows.length} ACCOUNT(S)` : ""}
						</span>
						<span className="spacer" />
						{isExample && <span className="sim-badge">{EXAMPLE_LABEL}</span>}
						{loaded && !isExample && (
							<span className="dim" style={{ fontSize: 10 }}>
								{loaded.kind === "chain" ? CHAIN.chainLabel : loaded.name}
							</span>
						)}
					</div>

					{!standings ? (
						<div className="panel-foot dim">
							{reading ? "reading the chain…" : "no events read"}
						</div>
					) : standings.rows.length === 0 ? (
						<div className="panel-foot dim">
							{loaded?.kind === "chain"
								? `no ${fieldPointsModule()} events in the transactions submitted by the ${roster.length} roster account(s) — that is an empty roster answer, not a score of zero for anyone`
								: "this extract holds no events"}
						</div>
					) : (
						<div className="scroll-x">
							<table className="grid">
								<thead>
									<tr>
										<th>#</th>
										<th>ACCOUNT</th>
										<th style={{ textAlign: "right" }}>TOTAL</th>
										<th style={{ textAlign: "right" }}>ANCHOR</th>
										<th style={{ textAlign: "right" }}>WITNESS</th>
										<th style={{ textAlign: "right" }}>ANCHORS</th>
										<th style={{ textAlign: "right" }}>ATTESTS</th>
										<th style={{ textAlign: "right" }}>CORROB.</th>
									</tr>
								</thead>
								<tbody>
									{standings.rows.map((row) => (
										<tr key={row.account}>
											<td>{row.rank}</td>
											<td title={row.account}>
												{isExample ? (
													shortAddress(row.account)
												) : (
													<a
														href={explorerAccount(row.account)}
														target="_blank"
														rel="noreferrer"
													>
														{shortAddress(row.account)}
													</a>
												)}
											</td>
											<td style={{ textAlign: "right" }}>{row.total}</td>
											<td style={{ textAlign: "right" }}>{row.anchorPoints}</td>
											<td style={{ textAlign: "right" }}>
												{row.witnessPoints}
											</td>
											<td style={{ textAlign: "right" }} className="dim">
												{row.anchorsRegistered}
											</td>
											<td style={{ textAlign: "right" }} className="dim">
												{row.attestations}
											</td>
											<td style={{ textAlign: "right" }} className="dim">
												{row.corroborations}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{standings && standings.rows.length > 0 && (
						<div className="panel-foot">
							<span className="dim">
								{standings.eventCount} event(s) ·{" "}
								{standings.witnessKeyCount} witness key(s)
								{standings.txVersionRange
									? ` · tx ${standings.txVersionRange[0]}–${standings.txVersionRange[1]}`
									: ""}
								{standings.timeRangeUnix
									? ` · ${utcDay(standings.timeRangeUnix[0])} → ${utcDay(standings.timeRangeUnix[1])}`
									: ""}
							</span>
							{isExample && <span className="sim-badge">{EXAMPLE_LABEL}</span>}
						</div>
					)}

					{standings && standings.discrepancies.length > 0 && (
						<>
							<div className="panel-title">
								DISCREPANCIES · {standings.discrepancies.length}
							</div>
							<div className="panel-foot dim">
								The chain emitted something the frozen schedule does not imply.
								Standings use the recomputed value; this is the audit trail for
								why they differ from a naive sum of the events.
							</div>
							<div className="scroll-x">
								<table className="grid">
									<thead>
										<tr>
											<th>KIND</th>
											<th>DETAIL</th>
										</tr>
									</thead>
									<tbody>
										{standings.discrepancies.map((d) => (
											<tr key={`${d.type}·${d.detail}`}>
												<td className="warn">{d.type}</td>
												<td>{d.detail}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					)}

					{readFailures.length > 0 && (
						<>
							<div className="panel-title">ROSTER READS THAT FAILED</div>
							{readFailures.map((f) => (
								<FailureNote key={f.reason} failure={f} />
							))}
						</>
					)}
				</div>
			</div>

			<div className="panel" style={{ width: 380, flexShrink: 0 }}>
				<div className="panel-title">
					<span>SOURCE</span>
					<span className="spacer" />
					<button type="button" disabled={reading} onClick={() => void readChain()}>
						{reading ? "READING…" : "↻ RE-READ"}
					</button>
				</div>
				<div className="scroll-y">
					<div className="kv">
						<span className="k warn">CHAIN</span>
						<span className="v warn">{CHAIN_CAVEAT}</span>
						<span className="k">MODULE</span>
						<span className="v" style={{ wordBreak: "break-all" }}>
							<a href={moduleUrl()} target="_blank" rel="noreferrer">
								{fieldPointsModule()}
							</a>
						</span>
						<span className="k">FULLNODE</span>
						<span className="v" style={{ wordBreak: "break-all" }}>
							{CHAIN.fullnode}
						</span>
						<span className="k">INDEXER</span>
						<span className="v" style={{ wordBreak: "break-all" }}>
							{CHAIN.indexer}
						</span>
						<span className="k">SEASON</span>
						<span className="v">
							{SEASON.name} · {SEASON.opensUtc} → {SEASON.closesUtc}
						</span>
						<span className="k">RULES</span>
						<span className="v">
							<code>{SEASON.rulesDoc}</code>, frozen in{" "}
							<code>{SEASON.rulesJson}</code>
						</span>
					</div>

					<div className="panel-title">POINT SCHEDULE · ON-CHAIN</div>
					<div className="scroll-x">
						<table className="grid">
							<thead>
								<tr>
									<th>ACTION</th>
									<th style={{ textAlign: "right" }}>POINTS</th>
									<th>CONDITION</th>
								</tr>
							</thead>
							<tbody>
								{SCHEDULE.map(([action, points, condition]) => (
									<tr key={action}>
										<td>{action}</td>
										<td style={{ textAlign: "right" }}>{points}</td>
										<td className="dim">{condition}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="panel-foot dim">
						These are the module's own constants — the chain enforces them. The
						browser keeps a copy only to check what the chain emitted.
					</div>

					<div className="panel-title">ROSTER · {roster.length}</div>
					<div className="panel-foot dim">
						Whose transactions are read for events. The leaderboard is exactly
						as complete as this list, and says so.
					</div>
					<div className="kv">
						{roster.map((address) => (
							<span key={address} className="k" style={{ gridColumn: "1 / -1" }}>
								<span
									className="v"
									style={{ wordBreak: "break-all", display: "inline" }}
									title={address}
								>
									{shortAddress(address)}
								</span>
								{address !== CHAIN.moduleAddress && (
									<button
										type="button"
										style={{ fontSize: 10, marginLeft: 8 }}
										onClick={() =>
											setRoster((prev) => prev.filter((a) => a !== address))
										}
									>
										[ REMOVE ]
									</button>
								)}
							</span>
						))}
					</div>
					<div style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
						<input
							placeholder="0x… account to include"
							value={addressDraft}
							spellCheck={false}
							onChange={(e) => setAddressDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") addAddress();
							}}
							style={{ flex: 1, minWidth: 0, fontSize: 11 }}
						/>
						<button type="button" onClick={addAddress}>
							[ ADD ]
						</button>
					</div>

					<div className="panel-title">EVENT EXTRACT</div>
					<div style={{ padding: "8px 12px", display: "grid", gap: 8 }}>
						<span className="dim" style={{ fontSize: 11 }}>
							A published event extract in the season scorer's schema
							(<code>score --events</code>). Read in this browser; nothing is
							uploaded.
						</span>
						<input
							type="file"
							accept="application/json,.json"
							onChange={(e) => {
								void onFile(e.target.files);
								e.target.value = "";
							}}
							style={{ fontSize: 11 }}
						/>
						<button
							type="button"
							onClick={() =>
								setLoaded({
									kind: "example",
									name: EXAMPLE_SOURCE_NAME,
									events: parseEventsDocument(EXAMPLE_EVENTS_DOCUMENT),
								})
							}
						>
							[ LOAD BUNDLED EXAMPLE ]
						</button>
						{loaded && loaded.kind !== "chain" && (
							<button type="button" onClick={() => void readChain()}>
								[ BACK TO THE CHAIN ]
							</button>
						)}
						{err && <span className="err">{err}</span>}
					</div>

					<div className="panel-title">WHAT THIS RANK IS WORTH</div>
					<div className="map-wait-body">
						<p>
							Season 0 points are non-transferable on-chain, there is no
							Lilyshark token, and none is promised. What rank buys is rank —
							the leaderboard, per-cell "first surveyed by" credit on COVERAGE,
							and premium analyzer features for contributors when those exist.
							Anyone selling Season 0 points is selling nothing.
						</p>
						<p>
							The cell bonuses and the closed-witness-clique discount in{" "}
							<code>{SEASON.rulesDoc}</code> are <em>not</em> applied here.
							They need capture blobs and season policy, so they belong to the
							published scorer; this table is the on-chain half only, which is
							why it is labelled STANDINGS and not FINAL.
						</p>
					</div>
				</div>
			</div>
		</main>
	);
}
