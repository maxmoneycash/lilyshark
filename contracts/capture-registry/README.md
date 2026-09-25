# Lilyshark capture registry

A Move module that anchors Lilyshark field captures on-chain. A capture file
lives on [Shelby](https://shelby.xyz); this registry records, on the network
that coordinates those blobs, who published a capture, its 32-byte blob
commitment, its size, and when its lease expires. Anyone can then fetch the
blob and verify the bytes against the anchored commitment without trusting the
publisher or the LoRa mesh that relayed the pointer.

## Where this is deployed, and which deployment to trust

**Shelbynet (demo).** The analyzer's live registry panel reads:

```
0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728::capture_registry
```

- Deployment tx: `0x09dab1e8f99df0feed757503c8e89179d80db2bd861ce8d81348c137b81ec904`
- First anchor (field-capture-0846): `0x5c56d7bfce7c45a7d16c242a45e9d7f9711511fd4b3fd8f1f152dfaac1a73aee`

> [!WARNING]
> Shelbynet is a developer prototype network that is **wiped roughly weekly**
> ([Shelby networks doc](https://docs.shelby.xyz/protocol/architecture/networks)).
> This deployment and every anchor in it evaporate on each wipe. It is a live
> demonstration that the path works — it is not a durable record, and nothing
> that must survive should be anchored only here.

**Aptos devnet (proof of the full path, 2026-08-20).** Both this module and
[`field_points`](../field-points/) were published to devnet under
`0xbc7bb07ff506b1b78567db545ecd4492cc94ca42315eb018e6885ef6b6002e2b` and the
whole loop was exercised: anchor
`0x3537f1e96ba7e2decbb567b1b10bc0790f59a4c6223b5babab7d959a6af41284`, then
`claim_anchor_points` and a witness pair paying both accounts. Devnet is also
wiped periodically — this is dated evidence, not a home.

**And it is already gone.** Re-checked later the same week, that deployment
returns `404 module_not_found`; the account still exists with
`sequence_number: 0`. The wipe warning above is not a hypothetical, and it
is the whole argument for putting the durable score on testnet or mainnet
rather than leaving it on a prototype chain. The analyzer's POINTS screen
reads this exact state and says so, rather than showing a zero score.

One related finding worth recording: the Aptos **indexer `events` GraphQL
table is deprecated** on devnet, testnet, and mainnet, and serves no
CORS header, so a browser cannot use it. Event history therefore has to be
read per account from submitted transactions until a supported indexer
route exists.

**Aptos testnet (the durable target).** Anchors and the
points ledger belong on Aptos, with Shelby holding the blobs: the pointer
format is backend-agnostic and unchanged either way. The testnet faucet is
web-gated, so completing it takes one human step:

1. `aptos init --profile lilyshark-testnet --network testnet --skip-faucet`
2. Fund the printed address at <https://aptos.dev/network/faucet>
3. Publish this package, then `field-points`, with
   `--named-addresses lilyshark=<addr>`
4. Record the addresses and transaction hashes here, and point the analyzer's
   anchor reads at them.

## Interface (Registry v2)

- `register(publisher, commitment, blob_name, size_bytes, expires_at_unix)` —
  entry function; anchors one capture under the caller and emits
  `CaptureRegistered`. Rejects commitments that are not exactly 32 bytes (`E_BAD_COMMITMENT = 1`)
  and duplicate commitments already anchored by this publisher (`E_DUPLICATE_COMMITMENT = 2`).
- `count(publisher): u64` — view; number of captures a publisher has anchored.
- `capture_at(publisher, index): Capture` — view; one anchored capture.
- `captures_slice(publisher, start, limit): vector<Capture>` — view; ranged slice of
  up to `limit` captures starting at `start`, bounds-clamped to available total.
  Eliminates whole-vector fullnode downloads in the analyzer.
- `has_commitment(publisher, commitment): bool` — view; returns true if the publisher
  has registered this 32-byte commitment.

## Migration and v1 Compatibility

- **v1 data**: The original v1 contract was deployed strictly to ephemeral prototype
  environments (`shelbynet` and `aptos devnet`), which wipe state periodically.
  No production migrations are required ("v1 is demo").
- **Binary & ABI compatibility**: The `Capture` struct layout and `CaptureRegistered`
  event fields are preserved verbatim. Existing readers like `field_points` and
  indexer watchers continue reading `count` and events unchanged.
- **Client fallback**: In `webapp/src/lib/shelby.ts`, `fetchRegistrySlice` queries
  `captures_slice` on v2 nodes and gracefully falls back to resource reads on legacy nodes.
- **Self-serve anchoring**: In addition to the server-side share service, users with
  Aptos browser wallets can invoke `anchorWithWallet` directly via `window.aptos`.

## Reproduce

```sh
aptos move test \
  --named-addresses lilyshark=0xA11CE \
  --skip-fetch-latest-git-deps
```

Query the live deployment without any setup:

```sh
aptos move view \
  --url https://api.shelbynet.aptoslabs.com/v1 \
  --function-id 0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728::capture_registry::capture_at \
  --args address:0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728 u64:0
```
