# Lilyshark capture registry

A Move module that anchors Lilyshark field captures on-chain. A capture file
lives on [Shelby](https://shelby.xyz); this registry records, on the network
that coordinates those blobs, who published a capture, its 32-byte blob
commitment, its size, and when its lease expires. Anyone can then fetch the
blob and verify the bytes against the anchored commitment without trusting the
publisher or the LoRa mesh that relayed the pointer.

Deployed on shelbynet at:

```
0x34946d19fb18115046c807b8f48845a515efe107892bb9cc49c6f197a6998728::capture_registry
```

- Deployment tx: `0x09dab1e8f99df0feed757503c8e89179d80db2bd861ce8d81348c137b81ec904`
- First anchor (field-capture-0846): `0x5c56d7bfce7c45a7d16c242a45e9d7f9711511fd4b3fd8f1f152dfaac1a73aee`

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
