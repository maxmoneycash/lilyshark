// Tests for lilyshark::capture_registry v2 (task CO-004)
#[test_only]
module lilyshark::capture_registry_tests {
    use std::string;
    use std::vector;
    use aptos_framework::account;
    use aptos_framework::timestamp;

    use lilyshark::capture_registry;

    fun commitment(seed: u8): vector<u8> {
        let k = vector::empty<u8>();
        let i = 0;
        while (i < 32) {
            vector::push_back(&mut k, seed);
            i = i + 1;
        };
        k
    }

    fun setup(framework: &signer) {
        timestamp::set_time_has_started_for_testing(framework);
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    fun register_and_count(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);
        assert!(capture_registry::count(@0xA1) == 0, 0);

        capture_registry::register(
            user,
            commitment(1),
            string::utf8(b"captures/field-001.lscap"),
            1024,
            1893456000,
        );

        assert!(capture_registry::count(@0xA1) == 1, 1);
        let cap = capture_registry::capture_at(@0xA1, 0);
        assert!(capture_registry::commitment(&cap) == commitment(1), 2);
        assert!(capture_registry::size_bytes(&cap) == 1024, 3);
        assert!(capture_registry::expires_at_unix(&cap) == 1893456000, 4);
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    #[expected_failure(abort_code = 2, location = lilyshark::capture_registry)]
    fun duplicate_commitment_aborts(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);

        capture_registry::register(
            user,
            commitment(1),
            string::utf8(b"captures/field-001.lscap"),
            1024,
            1893456000,
        );

        // Second registration with identical 32-byte commitment must abort
        capture_registry::register(
            user,
            commitment(1),
            string::utf8(b"captures/field-001-dupe.lscap"),
            2048,
            1893456000,
        );
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    #[expected_failure(abort_code = 1, location = lilyshark::capture_registry)]
    fun short_commitment_aborts(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);
        let short = vector::empty<u8>();
        vector::push_back(&mut short, 42);

        capture_registry::register(
            user,
            short,
            string::utf8(b"captures/bad.lscap"),
            1024,
            1893456000,
        );
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    #[expected_failure(abort_code = 1, location = lilyshark::capture_registry)]
    fun long_commitment_aborts(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);
        let long = commitment(1);
        vector::push_back(&mut long, 99); // 33 bytes

        capture_registry::register(
            user,
            long,
            string::utf8(b"captures/bad.lscap"),
            1024,
            1893456000,
        );
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    fun pagination_slice(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);

        // Empty registry slice
        let empty_slice = capture_registry::captures_slice(@0xA1, 0, 10);
        assert!(vector::is_empty(&empty_slice), 0);

        // Register 5 captures
        let i = 1;
        while (i <= 5) {
            capture_registry::register(
                user,
                commitment(i),
                string::utf8(b"captures/cap.lscap"),
                1000 + (i as u64),
                1893456000,
            );
            i = i + 1;
        };
        assert!(capture_registry::count(@0xA1) == 5, 1);

        // Slice 1: start 0, limit 2 -> first 2
        let s1 = capture_registry::captures_slice(@0xA1, 0, 2);
        assert!(vector::length(&s1) == 2, 2);
        assert!(capture_registry::commitment(vector::borrow(&s1, 0)) == commitment(1), 3);
        assert!(capture_registry::commitment(vector::borrow(&s1, 1)) == commitment(2), 4);

        // Slice 2: start 2, limit 2 -> middle 2
        let s2 = capture_registry::captures_slice(@0xA1, 2, 2);
        assert!(vector::length(&s2) == 2, 5);
        assert!(capture_registry::commitment(vector::borrow(&s2, 0)) == commitment(3), 6);
        assert!(capture_registry::commitment(vector::borrow(&s2, 1)) == commitment(4), 7);

        // Slice 3: start 4, limit 2 -> last 1 (bounds clamped to total 5)
        let s3 = capture_registry::captures_slice(@0xA1, 4, 2);
        assert!(vector::length(&s3) == 1, 8);
        assert!(capture_registry::commitment(vector::borrow(&s3, 0)) == commitment(5), 9);

        // Out of bounds start: start 5, limit 2 -> empty
        let s4 = capture_registry::captures_slice(@0xA1, 5, 2);
        assert!(vector::is_empty(&s4), 10);

        // Zero limit: limit 0 -> empty
        let s5 = capture_registry::captures_slice(@0xA1, 0, 0);
        assert!(vector::is_empty(&s5), 11);
    }

    #[test(framework = @aptos_framework, user = @0xA1)]
    fun has_commitment_lookup(framework: &signer, user: &signer) {
        setup(framework);
        account::create_account_for_test(@0xA1);
        assert!(!capture_registry::has_commitment(@0xA1, commitment(1)), 0);

        capture_registry::register(
            user,
            commitment(1),
            string::utf8(b"captures/field.lscap"),
            500,
            1893456000,
        );

        assert!(capture_registry::has_commitment(@0xA1, commitment(1)), 1);
        assert!(!capture_registry::has_commitment(@0xA1, commitment(2)), 2);
    }
}
