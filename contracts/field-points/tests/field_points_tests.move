// Intended semantics for lilyshark::field_points, stated as tests.
//
// DRAFT alongside the module (see README): authored without the Aptos CLI,
// so these have not been run. They are the acceptance criteria for task
// CO-001 — the module is correct when these pass as written (modulo
// mechanical compile fixes that do not change the asserted behavior).
#[test_only]
module lilyshark::field_points_tests {
    use std::string;
    use std::vector;
    use aptos_framework::account;
    use aptos_framework::timestamp;

    use lilyshark::capture_registry;
    use lilyshark::field_points;

    const WEEK_SECS: u64 = 7 * 24 * 60 * 60;

    fun key(seed: u8): vector<u8> {
        let k = vector::empty<u8>();
        let i = 0;
        while (i < 32) {
            vector::push_back(&mut k, seed);
            i = i + 1;
        };
        k
    }

    fun setup(framework: &signer, publisher: &signer) {
        timestamp::set_time_has_started_for_testing(framework);
        account::create_account_for_test(@lilyshark);
        field_points::init_for_test(publisher);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA, b = @0xB)]
    fun corroboration_pays_both(framework: &signer, lily: &signer, a: &signer, b: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        account::create_account_for_test(@0xB);
        field_points::attest_witness(a, key(1));
        assert!(field_points::total_points(@0xA) == 0, 0); // opener unpaid until corroborated
        field_points::attest_witness(b, key(1));
        assert!(field_points::total_points(@0xA) == 25, 1);
        assert!(field_points::total_points(@0xB) == 25, 2);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA)]
    #[expected_failure(abort_code = 2, location = lilyshark::field_points)]
    fun duplicate_attester_aborts(framework: &signer, lily: &signer, a: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        field_points::attest_witness(a, key(1));
        field_points::attest_witness(a, key(1));
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA, b = @0xB, c = @0xC)]
    fun third_attester_earns_late_credit(framework: &signer, lily: &signer, a: &signer, b: &signer, c: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        account::create_account_for_test(@0xB);
        account::create_account_for_test(@0xC);
        field_points::attest_witness(a, key(1));
        field_points::attest_witness(b, key(1));
        field_points::attest_witness(c, key(1));
        assert!(field_points::total_points(@0xC) == 5, 0);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA, b = @0xB)]
    fun out_of_window_attestation_earns_nothing(framework: &signer, lily: &signer, a: &signer, b: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        account::create_account_for_test(@0xB);
        field_points::attest_witness(a, key(1));
        timestamp::fast_forward_seconds(WEEK_SECS + 1);
        field_points::attest_witness(b, key(1));
        assert!(field_points::total_points(@0xA) == 0, 0);
        assert!(field_points::total_points(@0xB) == 0, 1);
        // Still recorded: corroboration count is data even when unpaid.
        assert!(vector::length(&field_points::witness_attesters(key(1))) == 2, 2);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA)]
    #[expected_failure(abort_code = 1, location = lilyshark::field_points)]
    fun short_key_aborts(framework: &signer, lily: &signer, a: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        let k = vector::empty<u8>();
        vector::push_back(&mut k, 7);
        field_points::attest_witness(a, k);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA)]
    fun anchor_claim_pays_delta_once(framework: &signer, lily: &signer, a: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        capture_registry::register(a, key(9), string::utf8(b"cap-0"), 4096, 1893456000);
        capture_registry::register(a, key(8), string::utf8(b"cap-1"), 4096, 1893456000);
        field_points::claim_anchor_points(a);
        assert!(field_points::total_points(@0xA) == 20, 0);
        capture_registry::register(a, key(7), string::utf8(b"cap-2"), 4096, 1893456000);
        field_points::claim_anchor_points(a);
        assert!(field_points::total_points(@0xA) == 30, 1);
    }

    #[test(framework = @aptos_framework, lily = @lilyshark, a = @0xA)]
    #[expected_failure(abort_code = 3, location = lilyshark::field_points)]
    fun empty_claim_aborts(framework: &signer, lily: &signer, a: &signer) {
        setup(framework, lily);
        account::create_account_for_test(@0xA);
        field_points::claim_anchor_points(a);
    }
}
