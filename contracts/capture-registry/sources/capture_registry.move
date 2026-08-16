/// On-chain anchor for Lilyshark field captures.
///
/// A capture file lives on Shelby; this registry lives on the chain that
/// coordinates it. Registering a capture records who published it, the
/// 32-byte blob commitment, its size, and when the blob lease expires —
/// enough for anyone to later fetch the blob from Shelby and verify that
/// the bytes they received are the bytes that were anchored, without
/// trusting the publisher or the transport that carried the pointer.
///
/// The 82-byte pointer a Lilyshark device broadcasts over LoRa carries the
/// same commitment, so the chain of custody reads: RF capture -> Shelby
/// blob -> on-chain anchor, each step checkable against the last.
module lilyshark::capture_registry {
    use std::signer;
    use std::string::String;
    use std::vector;
    use aptos_framework::event;
    use aptos_framework::timestamp;

    /// Commitment must be exactly 32 bytes (a Shelby blob commitment).
    const E_BAD_COMMITMENT: u64 = 1;

    /// One anchored capture.
    struct Capture has store, copy, drop {
        /// Shelby blob commitment; verifiable against the fetched bytes.
        commitment: vector<u8>,
        /// Blob name under the publisher's Shelby account.
        blob_name: String,
        /// Size the publisher claims; a fetch that disagrees is a red flag.
        size_bytes: u64,
        /// When the Shelby lease lapses and the blob may disappear.
        expires_at_unix: u64,
        /// Chain time at registration.
        registered_at_unix: u64,
    }

    /// All captures a publisher has anchored, in registration order.
    struct Registry has key {
        captures: vector<Capture>,
    }

    #[event]
    struct CaptureRegistered has drop, store {
        publisher: address,
        commitment: vector<u8>,
        blob_name: String,
        size_bytes: u64,
        expires_at_unix: u64,
    }

    /// Anchor a capture under the caller's address. First call creates the
    /// caller's registry.
    public entry fun register(
        publisher: &signer,
        commitment: vector<u8>,
        blob_name: String,
        size_bytes: u64,
        expires_at_unix: u64,
    ) acquires Registry {
        assert!(vector::length(&commitment) == 32, E_BAD_COMMITMENT);
        let addr = signer::address_of(publisher);
        if (!exists<Registry>(addr)) {
            move_to(publisher, Registry { captures: vector::empty() });
        };
        event::emit(CaptureRegistered {
            publisher: addr,
            commitment: copy commitment,
            blob_name: copy blob_name,
            size_bytes,
            expires_at_unix,
        });
        let registry = borrow_global_mut<Registry>(addr);
        vector::push_back(&mut registry.captures, Capture {
            commitment,
            blob_name,
            size_bytes,
            expires_at_unix,
            registered_at_unix: timestamp::now_seconds(),
        });
    }

    #[view]
    public fun count(publisher: address): u64 acquires Registry {
        if (exists<Registry>(publisher)) {
            vector::length(&borrow_global<Registry>(publisher).captures)
        } else {
            0
        }
    }

    #[view]
    public fun capture_at(publisher: address, index: u64): Capture acquires Registry {
        *vector::borrow(&borrow_global<Registry>(publisher).captures, index)
    }
}
