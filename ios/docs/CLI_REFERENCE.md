# MeshCore CLI Command Reference

Used for USB CLI mode (repeater/room/sensor firmware) and BLE remote admin sessions.

---

## Serial-Only Commands (won't work over BLE remote management)
- `get acl`, `log` (dump), `get prv.key`, `poweroff`/`shutdown`, `erase`

## Advert Commands
- `advert` — sends flood advert (1500ms delay). NOT "advert flood".
- `advert.zerohop` — sends zero-hop (local only) advert
- `advert.interval`: min 60, max 240 minutes (0 = disabled)
- `flood.advert.interval`: min 3, max 168 hours (0 = disabled)

## Key Values
- **Loop detection:** `off`, `minimal`, `moderate`, `strict` (NOT on/off)
- **Path hash mode:** 0 (1-byte), 1 (2-byte), 2 (4-byte)
- **Owner info:** pipe-delimited (| becomes newline), max 120 chars
- **Reboot:** works over BLE CLI

## Parameter Ranges (from NodePrefs sanitization)
- rx_delay_base: 0.0–20.0, airtime_factor: 0.0–9.0
- tx_delay_factor: 0.0–2.0, direct_tx_delay_factor: 0.0–2.0
- freq: 400–2500 MHz, bw: 7.8–500 kHz
- sf: 5–12, cr: 5–8, tx_power: -9 to 30 dBm
- flood_max: 0–64 hops (repeater/room/sensor only)
- name: no `[]:\,?*` characters

## Device-Type-Specific CLI Commands

| Feature | Repeater | Room Server | Sensor |
|---------|----------|-------------|--------|
| `discover.neighbors` | Yes | No | No |
| `region` commands | Yes | No | No |
| `setperm <pubkey> <level>` | No | Yes | Yes |
| `allow.read.only` | No | Yes | No |
| `guest_password` | No | Yes | No |
| `io` GPIO commands | No | No | Yes |
| Guest login | No | Yes (read-only) | No (rejected) |
| Alert permission bits | No | No | Yes (bit 6/7) |

**Room server permissions:** 0=Guest (read-only), 2=Read-Write (can post), 3=Admin
**Sensor permissions:** 0=Guest (rejected), 1=Read-Only, 3=Admin + optional alert bits

All three types inherit the full 40+ CommonCLI command set.

## USB CLI Mode in App
- Infrastructure device — text CLI commands only, no binary protocol
- `onUSBCLIReady()` creates synthetic Contact + RemoteDeviceSession with admin
- Auto-syncs clock, then fetches 29 settings via sequential CLI commands
- All setter functions check `isUSBCLIConnected` and route through CLI:
  - `setAdvertName` → `set name`, `setRadioParams` → `set radio freq,bw,sf,cr`
  - `setRadioTXPower` → `set tx`, `setTuningParams` → `set rxdelay` + `set af`
  - `setAdvertLatLon` → `set lat` + `set lon`, `sendAdvertise` → `advert`/`advert.zerohop`
  - `rebootDevice` → `reboot`, `factoryReset` → `erase`
- Sidebar shows RemoteManagementView (settings) + USB Terminal (raw CLI)
