/// Move Prover specification for `lilyshark::field_points` (task CO-005).
///
/// The scoreboard is the one part of Field Receipts that anyone has an
/// incentive to attack, so the properties that make it a scoreboard rather
/// than an instrument are stated here as machine-checked obligations rather
/// than as prose in the protocol doc. Run with:
///
/// ```sh
/// cd contracts/field-points
/// aptos move prove --named-addresses lilyshark=0xA11CE
/// ```
spec lilyshark::field_points {
    /// <high-level-req>
    /// No.: 1
    /// Requirement: Points never decrease. Every field of an account's `Points`
    /// resource (`total`, `anchor`, `witness`, and the `anchors_claimed`
    /// watermark) is monotonically non-decreasing, and once created a `Points`
    /// resource is never destroyed. There is no burn, no withdraw, no transfer.
    /// Criticality: Critical
    /// Implementation: `credit` only ever adds to `total` and to exactly one of
    /// `anchor`/`witness`; `claim_anchor_points` only ever raises
    /// `anchors_claimed` to the registry count, which it has already checked is
    /// strictly greater. No function contains a subtraction from, or a
    /// `move_from` of, a `Points` resource.
    /// Enforcement: Formally verified via the `invariant update` in
    /// [high-level-req-1](module).
    ///
    /// No.: 2
    /// Requirement: `anchors_claimed` never exceeds the caller's
    /// `capture_registry` count, so an account can never be paid anchor points
    /// for anchors it did not register.
    /// Criticality: Critical
    /// Implementation: `claim_anchor_points` reads the registry count and
    /// assigns it verbatim to the watermark; nothing else writes the field.
    /// Enforcement: Formally verified via the global invariant in
    /// [high-level-req-2](module), the post-condition on
    /// [high-level-req-2.1](claim_anchor_points), and the frame condition on
    /// [high-level-req-2.2](attest_witness).
    ///
    /// No.: 3
    /// Requirement: An attester appears at most once per witness key, so a
    /// single account cannot corroborate itself or farm late-witness credit by
    /// re-attesting a key it already attested.
    /// Criticality: Critical
    /// Implementation: `attest_witness` asserts the attester is not already in
    /// `Witness.attesters` before pushing, and the opening attestation seeds the
    /// vector with a single address.
    /// Enforcement: Formally verified via the data invariant on
    /// [high-level-req-3](Witness), which the prover discharges at every point
    /// where a `Witness` value is created or mutated.
    ///
    /// No.: 4
    /// Requirement: Credited amounts match the constant schedule. A witness
    /// attestation pays `POINTS_WITNESS` to the opener and the corroborator at
    /// position 2, `POINTS_LATE_WITNESS` to positions 3..=`MAX_CREDITED_ATTESTERS`,
    /// and nothing at all outside `WITNESS_WINDOW_SECS` or past the credited
    /// cap. An anchor claim pays exactly `POINTS_ANCHOR` per newly claimed
    /// registry entry. No other amount is ever credited, to anyone.
    /// Criticality: Critical
    /// Implementation: The credited amount in `attest_witness` is a single `if`
    /// chain over the three named constants, and `claim_anchor_points` awards
    /// `delta * POINTS_ANCHOR`.
    /// Enforcement: Formally verified via the post-conditions on
    /// [high-level-req-4.1](attest_witness) and
    /// [high-level-req-4.2](claim_anchor_points).
    /// </high-level-req>
    ///
    spec module {
        pragma verify = true;

        /// Abort behaviour is specified where an abort *is* the property being
        /// asserted (a short key, an unknown book, a repeat attester, an empty
        /// claim). The arithmetic-overflow aborts that `u64` addition in
        /// `credit` and the `delta * POINTS_ANCHOR` multiplication can raise are
        /// deliberately not enumerated, so every `aborts_if` below is a
        /// condition that does hold, not an exhaustive list of them.
        pragma aborts_if_is_partial = true;

        /// [high-level-req-1]
        /// Points are a scoreboard, not an instrument: a `Points` resource is
        /// never removed, and none of its four counters ever moves down.
        invariant update forall a: address where old(exists<Points>(a)):
            exists<Points>(a)
                && global<Points>(a).total >= old(global<Points>(a).total)
                && global<Points>(a).anchor >= old(global<Points>(a).anchor)
                && global<Points>(a).witness >= old(global<Points>(a).witness)
                && global<Points>(a).anchors_claimed >= old(global<Points>(a).anchors_claimed);

        /// [high-level-req-2]
        /// The registry is the source of truth for anchor credit: the watermark
        /// can never run ahead of the number of captures the account actually
        /// anchored.
        invariant forall a: address where exists<Points>(a):
            global<Points>(a).anchors_claimed <= capture_registry::count(a);
    }

    /// [high-level-req-3]
    /// A witness key's attester list carries each account at most once. Stated
    /// as a data invariant on the struct so the prover re-checks it wherever a
    /// `Witness` is built or its `attesters` vector is mutated, rather than only
    /// at the one call site we happened to think of.
    spec Witness {
        invariant forall i: u64, j: u64 where i < len(attesters) && j < len(attesters):
            attesters[i] == attesters[j] ==> i == j;
    }

    /// Total points held by `a`, treating "no resource yet" as zero exactly as
    /// the `total_points` view does.
    spec fun spec_total(a: address): u64 {
        if (exists<Points>(a)) global<Points>(a).total else 0
    }

    spec fun spec_anchor(a: address): u64 {
        if (exists<Points>(a)) global<Points>(a).anchor else 0
    }

    spec fun spec_witness(a: address): u64 {
        if (exists<Points>(a)) global<Points>(a).witness else 0
    }

    spec fun spec_claimed(a: address): u64 {
        if (exists<Points>(a)) global<Points>(a).anchors_claimed else 0
    }

    spec fun spec_book(): Table<vector<u8>, Witness> {
        global<WitnessBook>(@lilyshark).witnesses
    }

    spec fun spec_key_known(k: vector<u8>): bool {
        exists<WitnessBook>(@lilyshark) && table::spec_contains(spec_book(), k)
    }

    spec fun spec_attesters(k: vector<u8>): vector<address> {
        table::spec_get(spec_book(), k).attesters
    }

    spec fun spec_first_at(k: vector<u8>): u64 {
        table::spec_get(spec_book(), k).first_at_unix
    }

    spec ensure_points {
        ensures exists<Points>(signer::address_of(account));
        /// A freshly created scoreboard starts at zero on every axis.
        ensures !old(exists<Points>(signer::address_of(account))) ==>
            (global<Points>(signer::address_of(account)).total == 0
                && global<Points>(signer::address_of(account)).anchor == 0
                && global<Points>(signer::address_of(account)).witness == 0
                && global<Points>(signer::address_of(account)).anchors_claimed == 0);
        /// An existing scoreboard is left exactly as it was.
        ensures old(exists<Points>(signer::address_of(account))) ==>
            global<Points>(signer::address_of(account))
                == old(global<Points>(signer::address_of(account)));
        /// Nobody else is touched.
        ensures forall a: address where a != signer::address_of(account):
            spec_total(a) == old(spec_total(a))
                && spec_claimed(a) == old(spec_claimed(a));
    }

    spec credit {
        aborts_if amount > 0 && !exists<Points>(account);

        /// A zero award is a no-op, not a zero-valued event.
        ensures amount == 0 ==> (forall a: address:
            spec_total(a) == old(spec_total(a)));
        /// `total` is the sum of the two buckets' movements: the award lands in
        /// `anchor` or in `witness`, never in both and never in neither.
        ensures amount > 0 ==>
            (global<Points>(account).total == old(global<Points>(account).total) + amount
                && (if (kind == KIND_ANCHOR) {
                        global<Points>(account).anchor == old(global<Points>(account).anchor) + amount
                            && global<Points>(account).witness == old(global<Points>(account).witness)
                    } else {
                        global<Points>(account).witness == old(global<Points>(account).witness) + amount
                            && global<Points>(account).anchor == old(global<Points>(account).anchor)
                    }));
        /// Crediting never moves the anchor watermark, for anyone.
        ensures forall a: address: spec_claimed(a) == old(spec_claimed(a));
        /// No other account's score moves.
        ensures forall a: address where a != account:
            spec_total(a) == old(spec_total(a));
    }

    spec attest_witness {
        let attester = signer::address_of(account);
        let known = spec_key_known(key);
        let attesters_before = spec_attesters(key);
        /// 1-based position this call will occupy; opening a key is position 1.
        let position = if (known) len(attesters_before) + 1 else 1;
        let opener = attesters_before[0];
        let in_window =
            timestamp::spec_now_seconds() <= spec_first_at(key) + WITNESS_WINDOW_SECS;
        let paid = known && in_window && position <= MAX_CREDITED_ATTESTERS;

        /// Witness keys are SHA-256 outputs; anything else is not a key.
        aborts_if len(key) != 32;
        /// The book has to exist before it can be written.
        aborts_if !exists<WitnessBook>(@lilyshark);
        /// [high-level-req-3] one attestation per account per key, enforced.
        aborts_if known && contains(attesters_before, attester);

        ensures exists<Points>(attester);
        ensures spec_key_known(key);

        /// The attester is appended to this key's list; the list grows by one
        /// and every earlier attester keeps its position.
        ensures len(spec_attesters(key)) == position;
        ensures spec_attesters(key)[position - 1] == attester;
        ensures forall i: u64 where known && i < len(attesters_before):
            spec_attesters(key)[i] == attesters_before[i];

        /// [high-level-req-4.1]
        /// Opening a key pays nobody: an uncorroborated claim is worth zero.
        ensures !known ==> (forall a: address: spec_total(a) == old(spec_total(a)));
        /// Position 2 inside the window is the corroboration event, and it pays
        /// the opener and the corroborator the same `POINTS_WITNESS`.
        ensures paid && position == 2 ==>
            (spec_total(attester) == old(spec_total(attester)) + POINTS_WITNESS
                && spec_witness(attester) == old(spec_witness(attester)) + POINTS_WITNESS
                && spec_total(opener) == old(spec_total(opener)) + POINTS_WITNESS
                && spec_witness(opener) == old(spec_witness(opener)) + POINTS_WITNESS);
        /// Positions 3..=MAX_CREDITED_ATTESTERS inside the window decay to
        /// `POINTS_LATE_WITNESS`, and pay only the newcomer.
        ensures paid && position > 2 ==>
            (spec_total(attester) == old(spec_total(attester)) + POINTS_LATE_WITNESS
                && spec_witness(attester) == old(spec_witness(attester)) + POINTS_LATE_WITNESS);
        /// Out of window, or past the credited cap, the attestation is recorded
        /// but nobody is paid a thing.
        ensures known && !paid ==>
            (forall a: address: spec_total(a) == old(spec_total(a)));
        /// Nothing outside the schedule is ever credited to anyone, on any path.
        ensures forall a: address:
            spec_total(a) == old(spec_total(a))
                || spec_total(a) == old(spec_total(a)) + POINTS_WITNESS
                || spec_total(a) == old(spec_total(a)) + POINTS_LATE_WITNESS;
        /// Witness attestation pays out of the witness bucket only.
        ensures forall a: address: spec_anchor(a) == old(spec_anchor(a));

        /// [high-level-req-2.2] attesting never advances an anchor watermark.
        ensures forall a: address: spec_claimed(a) == old(spec_claimed(a));
    }

    spec claim_anchor_points {
        let addr = signer::address_of(account);
        let anchored = capture_registry::count(addr);
        let claimed_before = spec_claimed(addr);
        let delta = anchored - claimed_before;

        /// Claiming with nothing new to claim is an abort, not a zero payout —
        /// which is what makes double-claiming impossible rather than merely
        /// unprofitable.
        aborts_if anchored <= claimed_before;

        ensures exists<Points>(addr);
        /// [high-level-req-2.1] the watermark is *set to* the registry count, so
        /// it lands exactly on it and can never overshoot it.
        ensures global<Points>(addr).anchors_claimed == anchored;
        /// [high-level-req-4.2] exactly `POINTS_ANCHOR` per newly claimed anchor.
        ensures spec_total(addr) == old(spec_total(addr)) + delta * POINTS_ANCHOR;
        ensures spec_anchor(addr) == old(spec_anchor(addr)) + delta * POINTS_ANCHOR;
        /// Anchor claims pay out of the anchor bucket only.
        ensures spec_witness(addr) == old(spec_witness(addr));
        /// A claim is a purely self-serve operation: no other account's score or
        /// watermark moves.
        ensures forall a: address where a != addr:
            spec_total(a) == old(spec_total(a))
                && spec_claimed(a) == old(spec_claimed(a));
    }

    spec total_points {
        aborts_if false;
        ensures result == spec_total(account);
    }

    spec points_breakdown {
        aborts_if false;
        ensures result_1 == spec_total(account);
        ensures result_2 == spec_anchor(account);
        ensures result_3 == spec_witness(account);
        ensures result_4 == spec_claimed(account);
    }

    spec witness_attesters {
        aborts_if !exists<WitnessBook>(@lilyshark);
        ensures spec_key_known(key) ==> result == spec_attesters(key);
        ensures !spec_key_known(key) ==> len(result) == 0;
        /// [high-level-req-3] the view inherits the no-duplicates guarantee.
        ensures forall i: u64, j: u64 where i < len(result) && j < len(result):
            result[i] == result[j] ==> i == j;
    }
}
