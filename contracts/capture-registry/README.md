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

**Aptos testnet (the durable target, task CO-003/CO-002).** Anchors and the
points ledger belong on Aptos, with Shelby holding the blobs: the pointer
format is backend-agnostic and unchanged either way. The testnet faucet is
web-gated, so completing it takes one human step:

1. `aptos init --profile lilyshark-testnet --network testnet --skip-faucet`
2. Fund the printed address at <https://aptos.dev/network/faucet>
3. Publish this package, then `field-points`, with
   `--named-addresses lilyshark=<addr>`
4. Record the addresses and transaction hashes here, and point the analyzer's
   anchor reads at them.

## Interface

- `register(publisher, commitment, blob_name, size_bytes, expires_at_unix)` —
  entry function; anchors one capture under the caller and emits
  `CaptureRegistered`. Rejects commitments that are not exactly 32 bytes.
- `count(publisher): u64` — view; number of captures a publisher has anchored.
- `capture_at(publisher, index): Capture` — view; one anchored capture.

## Reproduce

```sh
aptos move compile \
  --named-addresses lilyshark=<your-address>

aptos move publish \
  --url https://api.shelbynet.aptoslabs.com/v1 \
  --named-addresses lilyshark=<your-address>
```

Query the live deployment without any setup:

```sh
aptos move view \
  --url https://api.shelbynet.aptoslabs.com/v1 \
  --function-id 0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728::capture_registry::capture_at \
  --args address:0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728 u64:0
```
