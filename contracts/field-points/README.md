# Lilyshark field points

The on-chain scoreboard for [Field Receipts](../../docs/protocol/field-receipts.md):
non-transferable points for verified field work.

- `attest_witness(key)` — record that the caller captured the transmission
  behind a 32-byte witness key. The second distinct account inside the
  7-day window corroborates the key and both accounts earn 25 points;
  attesters 3–8 earn 5; later or out-of-window attesters are recorded but
  earn nothing. One attestation per account per key, enforced.
- `claim_anchor_points()` — pay 10 points per capture anchored in
  [`capture_registry`](../capture-registry/) since the caller's last
  claim. The registry count is the watermark, so double-claiming is
  impossible.
- Views: `total_points`, `points_breakdown`, `witness_attesters`.

Points have no transfer, no withdraw, and no supply — a scoreboard, not an
instrument. Season scoring and any redemption read this module's events;
they never write it. The design rationale, point schedule, and threat
model live in the protocol doc.

## Status: tested, proven on devnet, awaiting a durable testnet deployment

`aptos move test` (CLI 9.0.0, framework `aptos-release-v1.27`) passes all
seven unit tests in `tests/field_points_tests.move`: pair corroboration
pays both, duplicate attesters abort, late attesters decay, the window
expires credit, anchor claims pay the delta exactly once, and short keys
abort.

The full loop has run end-to-end on **Aptos devnet** (2026-08-20, account
`0xbc7bb07ff506b1b78567db545ecd4492cc94ca42315eb018e6885ef6b6002e2b`),
attesting the witness key from `WITNESS-VECTOR-1` in the protocol spec:

| Step | Tx |
| --- | --- |
| Publish `capture_registry` | `0x…` (see note) |
| Publish `field_points` | `0xdea76b510474c1364aad0a8d4868132e9f077d1105b8414e2918b90f43e8349d` |
| `capture_registry::register` (one anchor) | `0x3537f1e96ba7e2decbb567b1b10bc0790f59a4c6223b5babab7d959a6af41284` |
| `claim_anchor_points` → 10 points | `0x2a447b1d27f4951b689acae3b6d9f4a7427d996bd28e60efd8929e0112769c70` |
| `attest_witness` (opener, unpaid) | `0xed3ecd46520d070726cc695536fcce9121feffafde021929033558d8758aec25` |
| `attest_witness` (second account → both paid 25) | `0x731b8bd50bf589baab622293a2d85711ea1e1456bf4e7973386f486c3012e772` |
| `points_breakdown(opener)` | `(35, 10, 25, 1)` — total, anchor, witness, anchors claimed |

Devnet is wiped periodically, so these transactions are a dated proof of
the path, not a durable deployment.

## Where this deploys (task CO-002)

Not shelbynet — that prototype chain is wiped roughly weekly; it is the
blobs' home, not the scoreboard's. And not devnet, for the same reason.
The durable home is **Aptos testnet**, which requires one human step: the
testnet faucet is web-gated. To complete CO-002:

1. `aptos init --profile lilyshark-testnet --network testnet --skip-faucet`
2. Fund the printed address at https://aptos.dev/network/faucet
3. `cd contracts/capture-registry && aptos move publish --profile lilyshark-testnet --named-addresses lilyshark=<addr>`
4. `cd contracts/field-points && aptos move publish --profile lilyshark-testnet --named-addresses lilyshark=<addr>`
5. Exercise one anchor + claim + witness pair as above; record the
   addresses and txs here.

## Reproduce

```sh
cd contracts/field-points
aptos move test --named-addresses lilyshark=0xA11CE
```
