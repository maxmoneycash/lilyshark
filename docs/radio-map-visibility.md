# T-Deck map visibility

Engineering audit, 2026-09-08. No T-Deck was attached, and its flashed firmware,
node name, selected profile, GPS state and received packets were not available.
The findings below describe this checkout; they do not establish which cause
applies to the user's physical radio.

## What turning the radio on establishes

A public coverage map is not an inventory of every powered handheld. The
requested service plots coverage contributions and repeaters. Repeater entries
require an advertisement with coordinates to reach an accepted observer; region
approval, bounds and duplicate-ID rules can also affect visibility. A portable
companion does not become a repeater by turning on. See the official
[map troubleshooting](https://wiki.meshmapper.net/troubleshooting/) and
[coverage FAQ](https://wiki.meshmapper.net/faq/).

Handheld coverage contributions use a separate authenticated survey session,
phone location and Internet upload. A successful radio announcement alone does
not create that session or upload observations. This distinction is documented
in the service's [connection and contribution flow](https://wiki.meshmapper.net/app_getting_started/).
Lilyshark's own map uses its own interface; external data requires authorized
access and is not a substitute for a working radio link.

## Concrete firmware conditions

| Condition in this checkout | Consequence | Code reference |
| --- | --- | --- |
| With no saved profile, the first preset is Meshtastic US LongFast: 906.875 MHz, 250 kHz, SF11, CR4/5. A saved profile is restored on boot. | A fresh device is not listening to MeshCore merely because the hardware supports it. The actual profile must be read from the device. | `src/core/builtin_profiles.cpp:43`; `src/sim_main.cpp:16620` |
| MeshCore presets are 910.525 MHz / 62.5 kHz / SF7 / CR4/5 and legacy 915 MHz / 250 kHz / SF10 / CR4/5. | These are built-in choices, not proof of current Oakland network settings. The selected PHY must match nearby peers. | `src/core/builtin_profiles.cpp:48` |
| MeshCore transmission is blocked during simulation, before radio initialization, on another protocol's profile, or without a persisted identity. | A running UI and synthetic packets do not establish real transmission. Specific failure reasons appear in the event/USB path. | `src/sim_main.cpp:16787` |
| The signed advert identifies this radio as `Chat`, with its own name. | This is a companion identity, not a claim to operate as repeater infrastructure. | `src/sim_main.cpp:16817` |
| An automatic advert is zero-hop; attempts are spaced 900,000 ms apart after the first one. | Direct listeners may discover it. Repeaters do not forward a zero-hop advert across the region. An unsuccessful first attempt is also paced. | `src/sim_main.cpp:547`; search `transmit_meshcore_advert(MeshCoreAdvertReach::ZeroHop)` |
| MeshCore advert coordinates require board GPS enabled, a fix, and valid position. | Starting indoors can yield a name/key without a position. Phone GPS fallback currently serves Meshtastic transmission, not MeshCore adverts. | `src/sim_main.cpp:16826`; `src/sim_main.cpp:16891` |
| The Ed25519 key is persisted in NVS; a monotonic advert-clock floor is reserved before transmission. | A normal reboot preserves identity and replay ordering. The clock is not a verified wall-clock timestamp. Restoring an old identity/clock pair could still make adverts older than a peer's stored copy. | `src/sim_main.cpp:11085`; `src/sim_main.cpp:11141`; `src/sim_main.cpp:11179` |
| Bluetooth exposes the Meshtastic service and protobuf conversation; USB exposes Lilyshark's `LSK` analyzer protocol. | A MeshCore RF profile does not turn either link into the MeshCore companion UART protocol. A MeshCore-only client may not discover or handshake with this firmware. | `src/device/tdeck_ble.cpp:129`; `webapp/src/lib/deviceLink.ts:1` |

The zero-hop default and strict per-identity timestamp ordering are also present
in upstream [companion firmware](https://github.com/meshcore-dev/MeshCore/blob/main/examples/companion_radio/MyMesh.cpp)
and [advert reception](https://github.com/meshcore-dev/MeshCore/blob/main/src/helpers/BaseChatMesh.cpp).
No source evidence establishes that this deck's advert reached a physical peer
or an Internet observer. Do not change its role, power, network, or announcement
reach just to make a public pin appear.

## Bugs corrected during this pass

1. **BLE config always claimed US LongFast.** The encoder now receives the actual
   active profile. Supported Meshtastic settings are represented as explicit
   bandwidth, spreading factor, coding rate, TX availability and power, frequency
   override, and an explicit slot when present. MeshCore and other profiles
   finish the config dump without emitting false Meshtastic LoRa settings.
   See `src/core/meshtastic_api.cpp`, `encodeApiConfigMessage`. Field semantics
   were checked against the official
   [protobuf schema](https://github.com/meshtastic/protobufs/blob/master/meshtastic/config.proto)
   and firmware [bandwidth conversions](https://github.com/meshtastic/firmware/blob/master/src/mesh/MeshRadio.h).

2. **The phone could remain at the self position from pairing.** The firmware now
   sends local BLE self NodeInfo updates when board GPS acquires a fix or its
   coordinates change, at most every five seconds. A full queue retries without
   forgetting the unsent update. Reconnection and GPS reacquisition can send the
   current fix again. This adds no LoRa transmission. See `src/sim_main.cpp`,
   `api_self_node` and `service_ble_api`; decision tests are in
   `test/meshtastic_api/test_meshtastic_api.cpp`.

3. **Map diagnostics could label defaults as reports.** Both clients now parse
   actual Meshtastic LoRa reports and retain unknown values when a report is
   absent or unsupported. Tests share the firmware's exact default, Bay and
   custom-profile wire vectors. Native map work uses protocol-specific
   self-position presence: Meshtastic position updates come from the self
   node's explicit position record, including valid zero coordinates. Web map
   work also removes the old exclusion of valid coordinates near 0,0.

## Remaining limits and field verification

The BLE protocol path does not explicitly revoke an earlier position when
GPS loses its fix; the displayed point is the **last reported position**, not a
guarantee of a current GPS lock. USB telemetry separately reports GPS status and
omits coordinates without a fix.

The firmware has signed MeshCore advertisement support; full MeshCore companion
messaging and survey-upload integration are separate work. The current MeshCore
text encoder is still a stub (`include/lilyshark/protocols/meshcore_encode.h:37`).
External coverage credentials and authenticated contribution infrastructure were
not provided. UI and host tests cannot supply those missing services or prove
real-world reception.

For the physical check, record firmware/version, displayed name, full identity
where available, simulation state, selected profile, and GPS status first. Then
confirm a same-profile nearby peer hears its ordinary advert and inspect the
recorded role/position. Public infrastructure visibility additionally needs an
observer receipt and region acceptance. Check those independently of Lilyshark's
local pin. Connecting the USB analyzer is not entirely passive: the existing
`LSK HELLO` handler can send Meshtastic NodeInfo/position, so do not describe that
connection as a transmission-free diagnostic (`src/sim_main.cpp:17215`).

Verification for these firmware changes: the Meshtastic API host suite passed
with address/undefined-behavior sanitizers, BLE UUID consistency passed, and the
pinned PlatformIO T-Deck build passed. Tests cover exact default/Bay/custom config
bytes, omitted unsupported config, nonce completion, buffer bounds, GPS
acquisition/movement/reconnection and explicit position validity. The firmware
was built but not flashed; physical BLE delivery and radio reception remain to
be verified on the user's deck.
