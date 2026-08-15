# Integration brief — for the firmware workstream

Goal, in one sentence: **a T-Deck running Lilyshark should appear to the
Lilyshark web analyzer as a MeshCore companion radio**, so CONNECT on
lilyshark.com talks to our own firmware over USB or BLE — the same protocol
the webapp already speaks via `@liamcottle/meshcore.js`.

## Port order (dependency-safe)

1. `hal/prefs` + `hal/atomic_file` — the bridge persists bonds/settings
   through these. Map onto our Preferences usage or adapt directly.
2. `mesh/path_codec` — small, standalone.
3. `comms/transport_iface` + `companion_bridge` core — start with the USB
   CDC path (no BLE stack risk, easiest to hardware-test): frame parser,
   command dispatch, 58-command surface per their COMPANION_SUPPORT.md.
4. BLE last (`observed_ble_interface`, bonding, auth throttle) — it drags
   in NimBLE config and their security model; USB alone already unlocks
   the webapp connection.

## Wiring points on our side

- RX path: bridge "heard packet" events ← our capture engine's decoded
  frames (we already have every frame with RSSI/SNR — richer than theirs).
- TX path: bridge send commands → our radio service.
- Contacts/adverts: back the companion contact list with our node tracker.
- Keep the bridge OFF by default; a Settings toggle enables "Companion
  mode" and shows link state on the Device Status screen.

## Cautions carried over from studying their tree

- Their code targets the base T-Deck; verify every pin/peripheral against
  our T-Deck Plus table before trusting `tdeck_pins.h`.
- Their own changelog is dense with LVGL lifetime fixes; nothing in this
  import touches LVGL, keep it that way.
- Their known interop gaps (device-authored messages not pushed to the
  phone app, `CMD_SEND_RAW_PACKET` refused) are places we can be better,
  not patterns to copy.
- Shared-SPI: their `spi_shared` arbitration addresses the same SD/display
  contention our capture writer has; compare against our tdeck_sd_sink
  before inventing a third scheme.
