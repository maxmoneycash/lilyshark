/// Field Receipts points: the on-chain scoreboard for verified field work.
///
/// Two primitives are credited here, both checkable on-chain:
///
/// - **Witness attestation.** A witness key identifies one over-the-air
///   transmission (see docs/protocol/field-receipts.md for the key
///   derivation). When a second, distinct account attests the same key
///   inside the attestation window, both accounts earn witness points —
///   independent corroboration is the protocol's anti-spoof primitive.
///   Later attesters earn a decaying credit, so a beacon that half the
///   city heard is not a money printer.
///
/// - **Anchor claims.** `capture_registry` already records how many
///   captures an account has anchored; `claim_anchor_points` pays the
///   delta since the last claim. Anchoring costs real Shelby storage and
///   gas, so this floor is spam-priced by construction.
///
/// Points are deliberately **non-transferable**: there is no withdraw, no
/// transfer, no supply. They are a scoreboard, not an instrument. Season
/// scoring, cell bonuses, and any future redemption read this module's
/// events and state; they never write it.
module lilyshark::field_points {
    use std::signer;
    use std::vector;
    use aptos_std::table::{Self, Table};
    use aptos_framework::event;
    use aptos_framework::timestamp;

    use lilyshark::capture_registry;

    /// Witness keys are 32 bytes (SHA-256 output), like blob commitments.
    const E_BAD_KEY: u64 = 1;
    /// An account may attest a given witness key once.
    const E_ALREADY_ATTESTED: u64 = 2;
    /// No new anchors since the last claim.
    const E_NOTHING_TO_CLAIM: u64 = 3;
    /// Module not initialized (WitnessBook missing at @lilyshark).
    const E_NOT_INITIALIZED: u64 = 4;

    /// Points per newly claimed registry anchor.
    const POINTS_ANCHOR: u64 = 10;
    /// Points to each of the first two attesters when a key becomes
    /// corroborated — the protocol's strongest signal earns the most.
    const POINTS_WITNESS: u64 = 25;
    /// Points to attesters 3..=MAX_CREDITED_ATTESTERS of an already
    /// corroborated key. Extra corroboration is useful data, worth less.
    const POINTS_LATE_WITNESS: u64 = 5;
    /// Attesters beyond this count are recorded but earn nothing.
    const MAX_CREDITED_ATTESTERS: u64 = 8;
    /// Attestations later than this after the first earn nothing: a real
    /// second receiver of the same transmission uploads within days, not
    /// months. Seven days covers the off-grid resolve pattern.
    const WITNESS_WINDOW_SECS: u64 = 7 * 24 * 60 * 60;

    /// Award kinds, for `PointsAwarded.kind`.
    const KIND_ANCHOR: u8 = 0;
    const KIND_WITNESS: u8 = 1;
    const KIND_LATE_WITNESS: u8 = 2;

    /// One witness key's attestation record.
    struct Witness has store {
        attesters: vector<address>,
        first_at_unix: u64,
    }

    /// All witness records, held under the module address.
    struct WitnessBook has key {
        witnesses: Table<vector<u8>, Witness>,
    }

    /// One account's score. Created by the account's own first call;
    /// never transferable.
    struct Points has key {
        total: u64,
        anchor: u64,
        witness: u64,
        /// Registry count already credited by `claim_anchor_points`.
        anchors_claimed: u64,
    }

    #[event]
    struct WitnessAttested has drop, store {
        key: vector<u8>,
        attester: address,
        /// 1-based position among this key's attesters.
        position: u64,
        credited: u64,
    }

    #[event]
    struct PointsAwarded has drop, store {
        account: address,
        kind: u8,
        amount: u64,
    }

    fun init_module(publisher: &signer) {
        move_to(publisher, WitnessBook { witnesses: table::new() });
    }

    /// Create the caller's Points resource if this is their first action.
    fun ensure_points(account: &signer) {
        if (!exists<Points>(signer::address_of(account))) {
            move_to(account, Points { total: 0, anchor: 0, witness: 0, anchors_claimed: 0 });
        };
    }

    /// Credit an account that is known to hold a Points resource (every
    /// attester's own call created it before they could be credited).
    fun credit(account: address, kind: u8, amount: u64) acquires Points {
        if (amount > 0) {
            let points = borrow_global_mut<Points>(account);
            points.total = points.total + amount;
            if (kind == KIND_ANCHOR) {
                points.anchor = points.anchor + amount;
            } else {
                points.witness = points.witness + amount;
            };
            event::emit(PointsAwarded { account, kind, amount });
        };
    }

    /// Attest that the caller's device captured the transmission behind
    /// `key`. The first attestation opens the record; the second distinct
    /// account inside the window corroborates it and pays both; later
    /// attesters inside the window earn a decaying credit.
    public entry fun attest_witness(account: &signer, key: vector<u8>)
    acquires WitnessBook, Points {
        assert!(vector::length(&key) == 32, E_BAD_KEY);
        assert!(exists<WitnessBook>(@lilyshark), E_NOT_INITIALIZED);
        ensure_points(account);
        let attester = signer::address_of(account);
        let now = timestamp::now_seconds();
        let book = borrow_global_mut<WitnessBook>(@lilyshark);

        if (!table::contains(&book.witnesses, key)) {
            table::add(&mut book.witnesses, copy key, Witness {
                attesters: vector::singleton(attester),
                first_at_unix: now,
            });
            event::emit(WitnessAttested { key, attester, position: 1, credited: 0 });
        } else {
            let witness = table::borrow_mut(&mut book.witnesses, copy key);
            assert!(!vector::contains(&witness.attesters, &attester), E_ALREADY_ATTESTED);
            vector::push_back(&mut witness.attesters, attester);
            let position = vector::length(&witness.attesters);
            let opener = *vector::borrow(&witness.attesters, 0);
            let in_window = now <= witness.first_at_unix + WITNESS_WINDOW_SECS;

            let credited = if (!in_window || position > MAX_CREDITED_ATTESTERS) {
                0
            } else if (position == 2) {
                // Corroborated: the opener earns the same as the corroborator.
                credit(opener, KIND_WITNESS, POINTS_WITNESS);
                credit(attester, KIND_WITNESS, POINTS_WITNESS);
                POINTS_WITNESS
            } else {
                credit(attester, KIND_LATE_WITNESS, POINTS_LATE_WITNESS);
                POINTS_LATE_WITNESS
            };
            event::emit(WitnessAttested { key, attester, position, credited });
        };
    }

    /// Pay anchor points for registry entries not yet credited. Anyone can
    /// claim for themselves at any cadence; the registry count is the
    /// source of truth, so double-claiming is impossible.
    public entry fun claim_anchor_points(account: &signer) acquires Points {
        ensure_points(account);
        let addr = signer::address_of(account);
        let anchored = capture_registry::count(addr);
        let points = borrow_global<Points>(addr);
        assert!(anchored > points.anchors_claimed, E_NOTHING_TO_CLAIM);
        let delta = anchored - points.anchors_claimed;
        let awarded = delta * POINTS_ANCHOR;
        // Reborrow mutably after the read; update the claim watermark
        // before crediting so the event stream orders cleanly.
        let points = borrow_global_mut<Points>(addr);
        points.anchors_claimed = anchored;
        credit(addr, KIND_ANCHOR, awarded);
    }

    #[view]
    public fun total_points(account: address): u64 acquires Points {
        if (exists<Points>(account)) borrow_global<Points>(account).total else 0
    }

    #[view]
    /// (total, anchor points, witness points, anchors claimed)
    public fun points_breakdown(account: address): (u64, u64, u64, u64) acquires Points {
        if (!exists<Points>(account)) return (0, 0, 0, 0);
        let p = borrow_global<Points>(account);
        (p.total, p.anchor, p.witness, p.anchors_claimed)
    }

    #[view]
    public fun witness_attesters(key: vector<u8>): vector<address> acquires WitnessBook {
        assert!(exists<WitnessBook>(@lilyshark), E_NOT_INITIALIZED);
        let book = borrow_global<WitnessBook>(@lilyshark);
        if (table::contains(&book.witnesses, key)) {
            *&table::borrow(&book.witnesses, key).attesters
        } else {
            vector::empty()
        }
    }

    #[test_only]
    public fun init_for_test(publisher: &signer) {
        init_module(publisher);
    }
}
