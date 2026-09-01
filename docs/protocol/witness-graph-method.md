# Witness graph method

[Field Receipts](field-receipts.md) v0 does not claim sybil-proofness. Its
[threat model](field-receipts.md#threat-model-honestly) says something
narrower and checkable: every farming path either costs real money or is
*visible in public data that the published scorer penalizes*. For the
self-witnessing attack — two funded accounts, one transmitter, witnessing
each other forever — the penalty is the [Season 0 clique
rule](season-0.md#closed-witness-cliques-are-down-weighted), frozen before
the season opened:

> an account with ≥ 10 corroborations whose top ≤ 3 partners hold ≥ 80% of
> them has its witness points multiplied by 0.25 **in standings only**.

That rule is one threshold over one statistic, chosen with no usage data.
This document describes the measurement that says whether it was the right
one: `scripts/witness_graph_analysis.py`, its statistics, what each can
and cannot prove, and the shape of the Season 1 recommendation it is meant
to feed.

Nothing here changes Season 0. The rules are frozen, the scorer
(`scripts/field_receipts_score.py`) is the authority on standings, and
this tool computes no points. It is evidence for the next rule-writing,
not an appeals process for this one.

## Running it

```
python3 scripts/witness_graph_analysis.py analyze --events events.json
python3 scripts/witness_graph_analysis.py analyze --events events.json --markdown
```

It reads the same events JSON as the scorer (schema in the scorer's module
docstring), reuses the scorer's loader, and pins the same
[season-0-rules.json](season-0-rules.json) by SHA-256 in its `method`
block — the rule-vs-statistics delta is only meaningful against a named
rule. Like the scorer, it is deterministic: same inputs, same bytes, no
timestamps or paths in the output, and every threshold comparison is exact
`Fraction` arithmetic so no float decides a flag.

## The graph

Nodes are accounts that appear in at least one `WitnessAttested` event. An
edge joins two accounts that attested the same witness key, and its weight
is the number of keys they share.

This is deliberately **wider than what the frozen rule sees**. A
*corroboration* — the rule's unit — is only an in-window position-2
attestation. Co-attestation also counts:

- accounts piling onto positions 3–8 of the same key;
- attestations after the 7-day window closes, which pay nothing;
- pairs whose credited corroborations sit just under the rule's floor of 10.

Every one of those is free to an attacker and invisible to the rule, and
all of them are edges here.

## What each statistic measures

| Statistic | What it measures | What it cannot show |
| --- | --- | --- |
| **Degree** (distinct partners) and **weighted degree** (shared keys) | How many independent parties an account's evidence rests on | Nothing about who those parties are; a farmer with 20 accounts has high degree |
| **Degree distribution / histogram** | The population shape — whether corroboration is concentrated in a few hubs or spread | Its own baseline. A first season has nothing to compare against |
| **Connected components** | Which operators can possibly corroborate each other at all; an isolated component is a self-contained radio neighbourhood *or* a self-contained farm | Which of those two it is |
| **Clustering coefficient** (local, and global transitivity) | Whether an account's partners also witness each other — the difference between a hub with ten neighbours and a ring where everyone hears everyone | Nothing causal: dense mesh coverage in a town centre produces high clustering honestly |
| **Maximal cliques**, ranked by size and internal weight | Groups that all mutually co-attest — the literal shape of the priced attack | Which cliques are real. Every dense neighbourhood contains cliques |
| **Clique closure** (share of the members' incident edge weight staying inside the group; 1 = *mutual-only*) | Whether a group ever witnesses anyone outside itself | Whether it *could* have. A lone valley with three operators has closure 1 for physical reasons |
| **Densest subgraph** (greedy peeling, Charikar) | The heaviest near-clique, including groups with a few honest-looking outside edges that exact clique enumeration would split | An exact optimum — greedy peeling is a 1/2-approximation, and on a disconnected graph it can return the union of several equally dense components |
| **Partner concentration**, `corroboration_top_share` | Exactly the statistic Season 0 thresholds on: the top ≤ 3 partners' share of the account's corroborations | Group structure. It is a property of one account's outbound edges only |
| Partner concentration, `coattestation_top_share` | The same statistic computed over shared keys instead of credited corroborations | Anything the first misses structurally — on an evenly-used ring it reports the same number |
| Partner concentration, `neighborhood_closure` | Share of the edge weight touching {account} ∪ its partners that stays inside that group | The difference between a star and a ring: an isolated hub's neighbourhood is closed too |
| Partner concentration, `neighborhood_density` | Edge density of that same closed neighbourhood — do the partners witness *each other*? | Whether density is geographic or manufactured |
| **Inter-arrival timing** per account (median gap, modal gap and its share, coefficient of variation) | Whether an account's attestations arrive on a human's ragged schedule or a scheduler's | Intent. A disciplined operator with a nightly sync job looks automated and is not farming |
| **Pair latency** per edge (min/median/max, distinct latencies, lead share) | Whether two accounts always answer each other within seconds, or always with the *same* latency | Colocation. Two receivers on one roof, uploading through one script, are legitimately synchronized |

## What gets flagged, and by what

Two independent verdicts are computed over the same event log, and the
output's `rule_vs_statistics` block is the diff.

**`rule_discounted`** is the frozen Season 0 rule. The tool *imports*
`field_receipts_score.detect_cliques` rather than reimplementing it, so
the measured rule can never drift from the scored rule (a test asserts the
identity).

**`statistics_flagged`** is this tool's method. It is a stated method, not
a finding. An account is flagged when it carries at least `--min-signals`
(default 2) of four signals:

| Signal | Fires when | Kind |
| --- | --- | --- |
| `closed_neighborhood` | weighted degree ≥ the rule's `min_corroborations`, **and** both the closure and the edge density of the account's closed neighbourhood are ≥ `--closure-threshold` (default 0.8) | structural |
| `mutual_only_clique` | the account belongs to a maximal clique of size ≥ 2 whose closure is exactly 1 and whose internal weight ≥ `min_corroborations` | structural |
| `automated_interarrival` | ≥ `--min-deltas` (5) gaps between the account's attestations, and either the modal gap holds ≥ `--regularity-threshold` (0.8) of them or their coefficient of variation is ≤ `--cv-threshold` (0.05) | behavioural |
| `synchronized_pair` | some partner shares ≥ `--min-shared-keys` (5) keys with every latency ≤ `--pair-window-secs` (30), or with an identical latency every single time | behavioural |

Closure and density are required *together* because neither alone
separates the honest cases: closure alone calls an isolated hub-and-spokes
neighbourhood closed, and density alone calls a genuinely dense town
centre a clique. Requiring two signals of four means a group must look
wrong both structurally and behaviourally — or be unambiguous on one axis
and corroborated on the other — before it is named.

These thresholds are **tool parameters, not protocol parameters**. They
are CLI arguments precisely so a reviewer can move them and watch the
delta move, which is the honest way to present a classifier nobody has
validated against ground truth.

## The delta, which is the point

| Bucket | Meaning |
| --- | --- |
| `agreement` | the frozen rule and the statistics both say "discount" |
| `rule_only` | the rule discounts, the statistics say the account looks organic — **candidate false positives** of the frozen threshold |
| `statistics_only` | the statistics flag, the rule missed it — **candidate false negatives** |

"Candidate" is load-bearing. Neither bucket is a verdict about an
operator, and neither can be, because there is no ground truth: nobody can
prove from a public event log that two accounts belong to one person.

The tool is validated against synthetic populations with known structure
(`test/witness_graph/`), where ground truth exists by construction. On the
mixed synthetic population the current parameters produce:

| Population (built to be) | Rule | Statistics | Bucket |
| --- | --- | --- | --- |
| Honest hub: 10 corroborations, 10 partners, ragged timing | no | no | — |
| Closed sybil pair: 10 mutual corroborations, 10 s apart on a 600 s timer | yes | yes | agreement |
| 3-account sybil ring, 5 corroborations per pair | yes | yes | agreement |
| 5-account sybil ring, 3 corroborations per pair | **no** | yes | `statistics_only` |
| Sybil pair one corroboration under the floor, topped up with out-of-window co-attestation | **no** | yes | `statistics_only` |
| Small town: one operator, three regular partners who each also work with passers-through | **yes** | no | `rule_only` |

Two structural blind spots of the frozen rule show up immediately in
synthetic data, before any real season has run:

1. **The partner-set size is the weak parameter.** A ring of five accounts
   spreads each member's corroborations over four partners, so the top ≤ 3
   hold 75% — under the frozen 80% — and the rule never fires. Computing
   the *same* statistic over co-attestation instead of corroborations does
   not help: it reports 75% too. Only the group-level view (closure and
   density over the whole neighbourhood) sees the ring. Sybil groups scale
   past `max_partner_set` at no cost; the concentration threshold does
   not scale with them.
2. **The rule counts only what it pays for.** Corroborations are in-window
   position-2 attestations, so a pair can sit at nine corroborations and
   any amount of uncredited co-attestation and never be tested at all. The
   volume floor is evaded from below, not defeated head-on.

And one direction of harm the rule can do on its own: an operator in a
genuinely small radio neighbourhood has few partners for physical reasons,
trips the concentration threshold, and is discounted — while the graph
around them is open and their timing is human.

## Known limits

These are limits of the method, not bugs to fix later:

- **A real dense neighbourhood looks like a clique.** In a small town, or
  a valley, or a single conference hall, everyone hears everyone. High
  clustering, closure 1, and a mutual-only clique are all *expected* there.
  The statistics cannot distinguish that from a farm, and neither can the
  frozen rule.
- **Two roommates with two devices are legitimately a mutual pair.** They
  are also, structurally, exactly the priced attack. If the protocol wants
  to pay them, that is a policy choice about how much independence a
  corroboration must represent — not something a graph statistic can
  settle.
- **Timing signals are the easiest to evade and the easiest to trip
  accidentally.** Adding jitter to a farming script costs an attacker
  nothing; a well-run honest node with a cron-driven upload trips
  `automated_interarrival` for free. Timing is corroborating evidence
  only, which is why a flag needs two signals.
- **There is no ground truth, so there is no measurable false-positive
  rate.** Everything above is structure and behaviour, never identity.
  Reported numbers are counts of accounts matching a stated pattern.
- **Attestation timestamps are chain time, not observation time.** An
  operator who batches a week of attestations into one session looks
  synchronized with themself; latency between two accounts measures when
  they *submitted*, not when they *heard*.
- **The graph only sees accounts that attested.** Anchor-only publishers
  and pure receivers are not nodes here.
- **Clique enumeration is exponential in the worst case**, so it is
  budgeted; a truncated run says so in
  `dense_subgraphs.enumeration_truncated`, and the greedy densest-subgraph
  result stays valid regardless.
- **`--markdown` is a report, not a publication.** Naming accounts as
  "candidate false negatives" in public is an accusation the data cannot
  support; the delta is an input to rule-writing, and rule changes apply
  to everyone rather than to a list of addresses.

## Findings: awaiting Season 0 data

**Season 0 runs 2026-10-01 → 2026-12-31 and has not run. There are no
findings.** Everything above is tooling and method, validated against
synthetic graphs whose structure we chose. No claim in this document is
about any real operator, and the synthetic table above is a statement
about the *rule*, not about the network.

This section will be filled in after the season closes
([timeline](season-0.md#timeline): the final scorer run and this analysis
are both January 2027 work), with, at minimum:

- the real degree distribution, component sizes, and clustering — the
  first numbers the protocol has ever had about how corroboration is
  actually distributed;
- how many accounts the frozen rule discounted, what fraction of witness
  points that moved in standings, and how the leaderboard changed with and
  without the discount;
- the `rule_only` and `statistics_only` lists, with the parameter sweep
  (`--min-signals`, `--closure-threshold`, `--pair-window-secs`) that
  shows how sensitive each bucket is to a threshold nobody validated;
- whether the two synthetic blind spots above — rings larger than
  `max_partner_set`, and pairs sitting under the volume floor — appear in
  real data at all, and at what scale;
- how much of the population is too small to test (accounts under 10
  corroborations), because a rule that never fires is a different failure
  from a rule that fires wrongly.

## Season 1 recommendation: the method, not the conclusion

The recommendation for Season 1's rules is deliberately **not written
here**, because writing it now would mean guessing. What is fixed now is
how it will be derived, so that the derivation cannot be reverse-engineered
from whatever the season happens to produce:

1. **Publish the measurement before the recommendation.** The full
   analysis output (JSON and the markdown report), the pinned rules hash,
   and the event extract go out first, so anyone can re-run the tool and
   reach their own reading. The [strategy
   memo](../strategy/2026-q3-direction.md) §3 argument about retroactive
   changes applies to the evidence as much as to the rules.
2. **Test each frozen parameter against the season's own distribution.**
   `min_corroborations` (10), `max_partner_set` (3),
   `concentration_threshold` (0.8) and `witness_discount` (0.25) were
   chosen with no data. Each gets re-derived from the observed
   distribution — e.g. what share of honest-looking accounts sit under the
   volume floor, and where the concentration histogram actually separates,
   if it separates at all.
3. **Prefer a group statistic to an account statistic where the delta
   shows the account statistic failing.** The synthetic 5-ring is the
   argument, not the proof: if real data shows rings above
   `max_partner_set`, the Season 1 rule should threshold on closed-group
   structure (closure and density over a neighbourhood) rather than on one
   account's top-3 share. If real data shows no such rings, that change
   costs complexity for nothing and should not be made.
4. **Treat timing as corroborating evidence only, never as a sole
   trigger.** It is cheap to evade and easy to trip honestly. If any
   timing signal enters the Season 1 rules, it enters as a second required
   signal, never a first.
5. **Prefer graduated to binary, and be able to say why.** A cliff at
   exactly 80% turns a small-town operator into a discounted one on their
   tenth corroboration. A continuous discount in the concentration
   statistic is the obvious alternative, and Season 0's data is what says
   whether the cliff actually hurt anyone.
6. **Publish what the change would have done to Season 0's standings** —
   as a counterfactual, never as a re-score. Season 0 results are
   permanent; the counterfactual is how a proposed rule is argued for
   rather than asserted.
7. **Say what is still unsolved.** Whatever Season 1 adopts, closed
   cliques stay *priced, not prevented*, and the honest-dense-neighbourhood
   case above stays unresolvable from public data alone. Stake-weighting
   and hardware attestation are the v1 questions the threat model already
   flags, and no amount of graph statistics substitutes for them.
