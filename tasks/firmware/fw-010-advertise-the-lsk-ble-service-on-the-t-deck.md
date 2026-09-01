---
id: FW-010
title: Advertise the LSK Bluetooth service on the T-Deck
area: firmware
size: L
priority: P2
status: todo
depends_on: [UI-017]
eval:
  auto:
  - grep -rq "6c736b00" src/ include/
  rubric:
  - The firmware advertises the service, RX, and TX UUIDs exactly as docs/lsk-ble-contract.md specifies, with the Lilyshark name prefix.
  - LSK lines framed on \n in both directions, chunked to the 20-byte ATT floor, with analyzer_link_active cleared on disconnect.
  - The analyzer connects over Bluetooth with the same handshake, telemetry, and frame streaming it gets over USB — verified on hardware, with the session recorded like the other field reports.
  - Power cost of advertising is measured and stated; if it materially shortens a field session, advertising is opt-in from Settings.
---

The auto check greps the firmware sources for the service UUID, not the
contract doc: the doc exists already, so checking it reported this task
green while no firmware had been written. Same trap as PA-006.

Why: UI-017 built the browser half of the Bluetooth link — the transport
interface, the BLE transport, the framing, and the tests — but the
T-Deck firmware has no BLE stack at all (no NimBLE, no BLEDevice, no
Bluetooth entry in `platformio.ini`'s `lib_deps`; the LSK link is
`Serial.printf` over USB CDC). The analyzer therefore shows the
Bluetooth option disabled and says the firmware does not advertise the
service yet, rather than offering a button that always fails.

What: Implement the device side of
[docs/lsk-ble-contract.md](../../docs/lsk-ble-contract.md) — service
`6c736b00-9c1d-4b7a-b3f2-1d0e5a7c4e10`, RX write-without-response
`…6c736b01…`, TX notify `…6c736b02…` — reusing the existing
`handle_analyzer_link_command` dispatch so USB and BLE share one command
path rather than growing a second one. Then flip
`LSK_BLE_FIRMWARE_STATUS` in the webapp from `absent` to available; the
browser side needs no other change, which is the point of the contract.

Out of scope: bonding and pairing security (v0 of the contract is
explicit that there is none) — that is its own task if the link ever
carries anything but analyzer telemetry.
