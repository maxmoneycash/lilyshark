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

> [!WARNING]
> **Draft — not compiled, not tested, not deployed.** This module was
> authored in an environment without the Aptos CLI. Until task **CO-001**
> (compile + unit tests) and **CO-002** (Aptos testnet deployment) on the
> [task board](../../tasks/README.md) are done, treat every line as a
> specification of intent, not working code. `tests/field_points_tests.move`
> states the intended semantics and must pass unchanged in spirit — if
> making it compile changes behavior, the protocol doc is the arbiter.

## Where this deploys

Not shelbynet. Shelbynet is a prototype chain wiped roughly weekly — the
blobs' home, not the scoreboard's. `field_points` and a durable
`capture_registry` deployment belong on Aptos testnet now (CO-002/CO-003)
and mainnet only when the score is worth its gas.

## Reproduce (once CO-001 lands)

```sh
aptos move test    --package-dir contracts/field-points --named-addresses lilyshark=0xA11CE
aptos move compile --package-dir contracts/field-points --named-addresses lilyshark=<your-address>
```
