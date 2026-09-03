# MeshCore Binary Protocol Reference

**Protocol Version:** FIRMWARE_VER_CODE = 11 (app sends 0x03 for v3+ in CMD_DEVICE_QUERY)

All uint32 values are **Little Endian**.

---

## FRAME TRANSPORT

### BLE (iOS/macOS)
- Service UUID: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` (Nordic UART)
- TX Characteristic (radio→app): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` (notify)
- RX Characteristic (app→radio): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` (write)
- Frame = single characteristic value (BLE link layer handles integrity)
- MAX_FRAME_SIZE = 255 bytes

### USB Serial (macOS) / WiFi/TCP
- Outbound (radio→app): `0x3E` (`>`) + 2 bytes frame length (LE) + frame
- Inbound (app→radio): `0x3C` (`<`) + 2 bytes frame length (LE) + frame

---

## CONNECTION SEQUENCE

```
1. App → CMD_DEVICE_QUERY (0x16) + app_target_ver(1 byte, value=3)
   Radio → RESP_CODE_DEVICE_INFO (0x0D)

2. App → CMD_APP_START (0x01) + app_ver(1) + reserved(6) + app_name(varchar)
   Radio → RESP_CODE_SELF_INFO (0x05)

3. App → CMD_GET_CONTACTS (0x04) + optional since(uint32 LE)
   Radio → RESP_CODE_CONTACTS_START(0x02) + RESP_CODE_CONTACT(0x03)... + RESP_CODE_END_OF_CONTACTS(0x04)

4. App → CMD_GET_CHANNEL (0x1F) + index(byte)  [repeat for 0..max_channels]
   Radio → RESP_CODE_CHANNEL_INFO (0x12)

5. App → CMD_SYNC_NEXT_MESSAGE (0x0A)  [repeat until RESP_CODE_NO_MORE_MESSAGES]
```

---

## COMMAND FRAMES — COMPLETE REFERENCE

### CMD_DEVICE_QUERY (22 / 0x16)
```
[0x16] [app_target_ver: byte]  // send 0x03 for v3+
→ RESP_CODE_DEVICE_INFO (0x0D)
```

### CMD_APP_START (1 / 0x01)
```
[0x01] [app_ver: byte] [reserved: 6 bytes] [app_name: varchar]
→ RESP_CODE_SELF_INFO (0x05)
```

### CMD_SEND_TXT_MSG (2 / 0x02) — Direct Message
```
[0x02] [txt_type: byte] [attempt: byte 0-3] [sender_timestamp: uint32 LE] [pubkey_prefix: 6 bytes] [text: varchar]
→ RESP_CODE_SENT (0x06) or RESP_CODE_ERR (0x01)
```
- txt_type: 0=plain, 1=CLI_DATA
- attempt: 0-1 = direct routing, 2-3 = flood routing
- pubkey_prefix: first 6 bytes of recipient's public key
- text max: 160 bytes

### CMD_SEND_CHANNEL_TXT_MSG (3 / 0x03) — Channel Message
```
[0x03] [txt_type: byte] [channel_idx: byte] [sender_timestamp: uint32 LE] [text: varchar]
→ RESP_CODE_OK (0x00) or RESP_CODE_ERR (0x01)
```
- channel_idx: 0 = public channel, 1-7 = group channels
- text max: 160 - len(advert_name) - 2
- **No RESP_CODE_SENT — channels are fire-and-forget. No ACK/delivery confirmation.**

### CMD_GET_CONTACTS (4 / 0x04)
```
[0x04] [optional since: uint32 LE]
→ RESP_CODE_CONTACTS_START (0x02) → RESP_CODE_CONTACT (0x03)... → RESP_CODE_END_OF_CONTACTS (0x04)
```

### CMD_ADD_UPDATE_CONTACT (9 / 0x09)
```
[0x09] [pub_key: 32 bytes] [type: byte] [flags: byte] [out_path_len: signed byte] [out_path: 64 bytes] [adv_name: 32 bytes null-terminated] [last_advert: uint32 LE] [optional adv_lat: int32 LE] [optional adv_lon: int32 LE]
→ RESP_CODE_OK or RESP_CODE_ERR
```
- flags bit 0 = favourite
- **out_path_len byte encoding:**
  - `0x00` = direct (no hops, within radio range)
  - `0xFF` = `OUT_PATH_UNKNOWN` — forces flood routing. Set by CMD_RESET_PATH.
  - `1-63` (lower 6 bits) = hop count
  - Upper 2 bits = hash_mode: `byte = (hash_mode << 6) | (hop_count & 0x3F)`
  - hash_mode 0 = 1-byte hashes, 1 = 2-byte, 2 = 4-byte, 3 = 8-byte
  - Firmware decodes: `hash_count = byte & 63; hash_size = (byte >> 6) + 1`
  - out_path contains `hash_count * hash_size` bytes of repeater hashes
- **Display:** Use `outPathLen & 0x3F` for hop count display (strip hash_mode bits)

### CMD_SET_RADIO_PARAMS (11 / 0x0B)
```
[0x0B] [freq: uint32 LE Hz] [bw: uint32 LE Hz] [sf: byte 5-12] [cr: byte 5-8] [repeat: byte 0/1 (v9+, optional)]
→ RESP_CODE_OK or RESP_CODE_ERR
```
- freq/bw are uint32 in Hz (NOT float). Firmware divides by 1000 internally.
- freq valid: 300,000-2,500,000 Hz. bw valid: 7,000-500,000 Hz.
- Requires reboot to take effect

### CMD_SET_TUNING_PARAMS (21 / 0x15)
```
[0x15] [rx_delay_base: uint32 LE, value*1000] [airtime_factor: uint32 LE, value*1000] [padding: 2 bytes]
→ RESP_CODE_OK
```
- **flood_max_hops is NOT in this command and does NOT exist on companion radios.**
- Companion NodePrefs has no flood_max field. Only repeaters/rooms/sensors have it via CLI.

### CMD_SET_OTHER_PARAMS (38 / 0x26)
```
[0x26] [manual_add_contacts: byte] [telemetry_mode: byte bitpacked] [adv_loc_policy: byte] [multi_acks: byte]
→ RESP_CODE_OK
```
- telemetry_mode: bits 0-1 = base mode, bits 2-3 = location mode, bits 4-5 = env mode
- **Does NOT contain flood_max_hops.**

### CMD_SET_CHANNEL (32 / 0x20)
```
[0x20] [channel_idx: byte] [name: 32 bytes null-padded] [secret: 16 bytes]
→ RESP_CODE_OK or RESP_CODE_ERR
```
- PSK is 16 bytes (128-bit).

### CMD_EXPORT_CONTACT (17 / 0x11)
```
[0x11] [optional pub_key: 32 bytes]  // omit for self
→ RESP_CODE_EXPORT_CONTACT (0x0B)
```
- For self export: frame is just `[0x11]` (1 byte)
- For contact: `[0x11] + [32 byte pubkey]` (33 bytes)

### CMD_SEND_LOGIN (26 / 0x1A)
```
[0x1A] [pub_key: 32 bytes] [password: varchar null-terminated]
→ RESP_CODE_SENT (0x06) then later PUSH_CODE_LOGIN_SUCCESS (0x85) or PUSH_CODE_LOGIN_FAIL (0x86)
```

### CMD_SEND_TELEMETRY_REQ (39 / 0x27)
```
[0x27] [reserved: 3 bytes] [pub_key: 32 bytes]
→ RESP_CODE_SENT (0x06) then later PUSH_CODE_TELEMETRY_RESPONSE (0x8B)
Self telemetry: [0x27] [reserved: 3 bytes] (4 bytes total, no pubkey)
```

### CMD_SET_AUTOADD_CONFIG (58 / 0x3A) / CMD_GET_AUTOADD_CONFIG (59 / 0x3B)
```
SET: [0x3A] [bitmask: byte] [optional max_hops: byte] → RESP_CODE_OK
GET: [0x3B] → RESP_CODE_AUTOADD_CONFIG (0x19): [bitmask: byte] [max_hops: byte]
```
- Bitmask: bit0=overwrite_oldest, bit1=chat, bit2=repeater, bit3=room, bit4=sensor
- **CRITICAL: GET is command 59 (0x3B), NOT 58. Sending SET (58) with no payload corrupts device config.**

### Simple Commands (code → payload → response)

| Cmd | Code | Payload | Response |
|-----|------|---------|----------|
| CMD_GET_DEVICE_TIME | 0x05 | (none) | RESP_CODE_CURR_TIME (0x09) + epoch(u32) |
| CMD_SET_DEVICE_TIME | 0x06 | epoch_secs(u32) | OK/ERR |
| CMD_SEND_SELF_ADVERT | 0x07 | optional type(1): 1=flood, 0=zero-hop | OK/ERR |
| CMD_SET_ADVERT_NAME | 0x08 | name(varchar) | OK |
| CMD_SYNC_NEXT_MESSAGE | 0x0A | (none) | 0x10 or 0x11 or NO_MORE(0x0A) |
| CMD_SET_RADIO_TX_POWER | 0x0C | tx_power(byte dBm) | OK/ERR |
| CMD_RESET_PATH | 0x0D | pub_key(32) | OK/ERR |
| CMD_SET_ADVERT_LATLON | 0x0E | lat(i32) + lon(i32) + optional alt(i32) microdegrees | OK/ERR |
| CMD_REMOVE_CONTACT | 0x0F | pub_key(32) | OK/ERR |
| CMD_SHARE_CONTACT | 0x10 | pub_key(32) | OK/ERR |
| CMD_IMPORT_CONTACT | 0x12 | card_data(remainder) | OK/ERR |
| CMD_REBOOT | 0x13 | ASCII "reboot" | (device reboots) |
| CMD_GET_BATT_AND_STORAGE | 0x14 | (none) | RESP_BATT_AND_STORAGE (0x0C) |
| CMD_SEND_RAW_DATA | 0x19 | payload + path | OK/ERR |
| CMD_SEND_STATUS_REQ | 0x1B | pub_key(32) | SENT(0x06) then PUSH 0x87 |
| CMD_GET_CHANNEL | 0x1F | channel_idx(byte) | RESP_CHANNEL_INFO (0x12) |
| CMD_SEND_TRACE_PATH | 0x24 | tag(u32 random) + path_data | SENT(0x06) then PUSH 0x89 |
| CMD_SET_DEVICE_PIN | 0x25 | pin(u32): 0=random, 1=device RNG | OK/ERR |
| CMD_GET_CUSTOM_VARS | 0x28 | (none) | RESP_CUSTOM_VARS (0x15) csv text |
| CMD_SET_CUSTOM_VAR | 0x29 | name:value text | OK/ERR_ILLEGAL_ARG |
| CMD_GET_ADVERT_PATH | 0x2A | reserved(0x00) + pub_key(32) | RESP_ADVERT_PATH (0x16) or ERR |
| CMD_GET_TUNING_PARAMS | 0x2B | (none) | RESP_TUNING_PARAMS (0x17) |
| CMD_SEND_BINARY_REQ | 0x32 | payload | SENT(0x06)+TAG then PUSH 0x8C |
| CMD_FACTORY_RESET | 0x33 | ASCII "reset" | (erases flash) |
| CMD_SEND_CONTROL_DATA | 0x37 | payload | OK/ERR |
| CMD_GET_STATS | 0x38 | sub_type(byte): 0=CORE,1=RADIO,2=PACKETS | RESP_STATS (0x18) |
| CMD_GET_ALLOWED_REPEAT_FREQ | 0x3C | (none) | RESP 0x1A: pairs of u32 (min,max) Hz |

---

## RESPONSE FRAMES

### RESP_CODE_DEVICE_INFO (0x0D)
```
Byte 0: 0x0D
Byte 1: FIRMWARE_VER_CODE (8)
Byte 2: MAX_CONTACTS / 2
Byte 3: MAX_GROUP_CHANNELS
Bytes 4-7: BLE PIN (uint32 LE) — 0 means device generates random PIN on screen
Bytes 8-19: Build date string (null-terminated)
Bytes 20-59: Manufacturer/model (40 bytes null-terminated)
Bytes 60-79: Semantic version (20 bytes null-terminated)
```

### RESP_CODE_SELF_INFO (0x05)
```
Byte 0: 0x05
Byte 1: node type (1=chat, 2=repeater, 3=room, 4=sensor)
Byte 2: TX power (dBm)
Byte 3: Max TX power (dBm)
Bytes 4-35: Public key (32 bytes)
Bytes 36-39: Latitude (int32 LE, microdegrees = value * 1,000,000)
Bytes 40-43: Longitude (int32 LE, microdegrees)
Byte 44: Multi-acks count
Byte 45: Advert location policy (0=don't share, 1=share)
Byte 46: Telemetry mode flags (bits 0-1=base mode, bits 2-3=location mode; 0=deny, 1=per-contact, 2=allow all)
Byte 47: Manual add contacts (0 or 1)
Bytes 48-51: Frequency (uint32 LE, Hz * 1000)
Bytes 52-55: Bandwidth (uint32 LE, kHz * 1000)
Byte 56: Spreading factor
Byte 57: Coding rate
Bytes 58+: Node name (varchar)
```

### RESP_CODE_CONTACT (0x03)
```
Byte 0: 0x03
Bytes 1-32: Public key (32 bytes)
Byte 33: Type (1=chat, 2=repeater, 3=room, 4=sensor)
Byte 34: Flags (bit 0 = favourite)
Byte 35: Path length (signed byte; 0=direct, -1/0xFF=flood, 1-63=hops)
Bytes 36-99: Out path (64 bytes)
Bytes 100-131: Name (32 bytes null-terminated)
Bytes 132-135: Last advert timestamp (uint32 LE)
Bytes 136-139: Advert latitude (int32 LE, microdegrees)
Bytes 140-143: Advert longitude (int32 LE, microdegrees)
Bytes 144-147: Last modified timestamp (uint32 LE)
```
- adv_lat: byte 136, adv_lon: byte 140. Conversion: `Double(rawInt32) / 1_000_000.0`

### RESP_CODE_SENT (0x06)
```
Byte 0: 0x06
Byte 1: type (0=direct, 1=flood)
Bytes 2-5: expected_ack_or_tag (uint32 LE)
Bytes 6-9: suggested_timeout (uint32 LE, milliseconds)
```

### RESP_CODE_CONTACT_MSG_RECV_V3 (0x10)
```
Byte 0: 0x10
Byte 1: SNR * 4 (int8)
Bytes 2-3: Reserved
Bytes 4-9: Sender pubkey prefix (6 bytes)
Byte 10: Path length (0xFF = direct routed)
Byte 11: Text type (0=plain, 1=signed, 2=CLI data)
Bytes 12-15: Sender timestamp (uint32 LE)
Bytes 16+: Message text (UTF-8)
```

### RESP_CODE_CHANNEL_MSG_RECV_V3 (0x11)
```
Byte 0: 0x11
Byte 1: SNR * 4 (int8)
Bytes 2-3: Reserved (2 bytes — NOT channel_idx)
Byte 4: Channel index
Byte 5: Path length (0xFF = direct)
Byte 6: Text type (0=plain)
Bytes 7-10: Sender timestamp (uint32 LE)
Bytes 11+: Text as "SenderName: message" (UTF-8, split on ": " to extract sender)
```

### RESP_CODE_CHANNEL_MSG_RECV (0x08) — V1 legacy (ver < 3)
```
Byte 0: 0x08
Byte 1: Channel index
Byte 2: Path length
Byte 3: Text type (0=plain)
Bytes 4-7: Sender timestamp (uint32 LE)
Bytes 8+: Text as "SenderName: message" (UTF-8)
```

### RESP_CODE_CHANNEL_INFO (0x12)
```
Byte 0: 0x12
Byte 1: Channel index
Bytes 2-33: Channel name (32 bytes null-terminated)
Bytes 34-49: Channel secret/PSK (16 bytes)
```
- Firmware returns the 16-byte PSK. There is NO flags byte.

### RESP_CODE_STATS (0x18)
```
Byte 0: 0x18
Byte 1: Stats type

Core (type 0):
  Bytes 2-3: Battery mV (uint16 LE)
  Bytes 4-7: Uptime seconds (uint32 LE)
  Bytes 8-9: Error flags (uint16 LE)
  Byte 10: Queue length (uint8)

Radio (type 1):
  Bytes 2-3: Noise floor (int16 LE)
  Byte 4: Last RSSI (int8)
  Byte 5: Last SNR * 4 (int8)
  Bytes 6-9: TX airtime seconds (uint32 LE)
  Bytes 10-13: RX airtime seconds (uint32 LE)

Packets (type 2):
  Bytes 2-5: Packets received (uint32 LE)
  Bytes 6-9: Packets sent (uint32 LE)
  Bytes 10-13: Flood sent (uint32 LE)
  Bytes 14-17: Direct sent (uint32 LE)
  Bytes 18-21: Flood received (uint32 LE)
  Bytes 22-25: Direct received (uint32 LE)
  Bytes 26-29: Receive errors (uint32 LE)
```

---

## PUSH NOTIFICATIONS (0x80+)

| Code | Name | Payload |
|------|------|---------|
| 0x80 | PUSH_CODE_ADVERT | pub_key(32) — known contact advertised |
| 0x81 | PUSH_CODE_PATH_UPDATED | pub_key(32) — contact path changed |
| 0x82 | PUSH_CODE_SEND_CONFIRMED | ack_code(4) + round_trip_ms(4) |
| 0x83 | PUSH_CODE_MSG_WAITING | (empty) — sync next message immediately |
| 0x84 | PUSH_CODE_RAW_DATA | payload (direct custom packet) |
| 0x85 | PUSH_CODE_LOGIN_SUCCESS | permissions(1) — bit0=isAdmin |
| 0x86 | PUSH_CODE_LOGIN_FAIL | (timeout/bad password) |
| 0x87 | PUSH_CODE_STATUS_RESPONSE | reserved(1) + pubkey_prefix(6) + status_data |
| 0x88 | PUSH_CODE_LOG_RX_DATA | SNR*4(int8) + RSSI(int8) + raw_encrypted_LoRa_bytes |
| 0x89 | PUSH_CODE_TRACE_DATA | reserved(1) + path_len(1) + flags(1) + tag(4) + auth(4) + hashes(N) + SNRs(N+1) |
| 0x8A | PUSH_CODE_NEW_ADVERT | same format as RESP_CODE_CONTACT |
| 0x8B | PUSH_CODE_TELEMETRY_RESPONSE | reserved(1) + pubkey_prefix(6) + LPP_data |
| 0x8C | PUSH_CODE_BINARY_RESPONSE | matched by TAG |
| 0x8D | PUSH_CODE_PATH_DISCOVERY_RESPONSE | path discovery result |
| 0x8E | PUSH_CODE_CONTROL_DATA | control packet received |
| 0x8F | PUSH_CODE_CONTACT_DELETED | contact evicted — pub_key(32) |
| 0x90 | PUSH_CODE_CONTACTS_FULL | no payload |
| 0x91+ | GROUP_DATA (binary) | Added in firmware 1.15.0. Binary data packets over channels. Format: channel_hash(1) + cipher_mac(2) + ciphertext(rest). Decrypted: data_type(2) + data_len(1) + data(N). App handles as `unknown(type:payload:)` — no crash, silently ignored. |

**Echo/repeat detection:** 0x88 LOG_RX_DATA fires when a repeater forwards a packet after a channel send.
Arms `pendingChannelEcho` on channel send; if 0x88 arrives within 30s, sets message status to `.repeated`.
The raw LoRa bytes are encrypted — use timing correlation only, not content.

---

## ERROR CODES

| Code | Name | Meaning |
|------|------|---------|
| 0x01 | ERR_CODE_UNSUPPORTED_CMD | Command not recognized |
| 0x02 | ERR_CODE_NOT_FOUND | Entity not found |
| 0x03 | ERR_CODE_TABLE_FULL | Storage full |
| 0x04 | ERR_CODE_BAD_STATE | Invalid state |
| 0x05 | ERR_CODE_FILE_IO_ERROR | Flash error |
| 0x06 | ERR_CODE_ILLEGAL_ARG | Bad parameter |

---

## FIRMWARE 1.15.0 ADDITIONS

### CMD_GET_DEFAULT_FLOOD_SCOPE / CMD_SET_DEFAULT_FLOOD_SCOPE
Binary commands for default flood scope region name. Implemented in app as of v26.04.10.
- `CMD_SET_DEFAULT_FLOOD_SCOPE` = `0x3F` (63) — payload: region name as null-terminated UTF-8 string. Empty (just `\0`) clears the scope.
- `CMD_GET_DEFAULT_FLOOD_SCOPE` = `0x40` (64) — no payload.
- `RESP_CODE_DEFAULT_FLOOD_SCOPE` = `0x1C` (28) — payload: name(31 bytes, null-terminated) + key(16 bytes) if configured; empty payload if not configured.
- CLI equivalent: `region default [name]` — Repeater only. Bare `region default` returns current value; `region default <name>` sets it.
- UI: Settings → Device → Flood Scope (binary, companion); Remote Management → Advanced Routing → Default Flood Scope (CLI, repeater).

### CLI: `get/set dutycycle` (replaces deprecated `get/set af`)
`af` (airtime fraction) renamed to `dutycycle` in 1.15.0. `af` still works as deprecated alias.
**App pattern:** fetch both `get dutycycle` and `get af`; display `dutycycle ?? af`; set via `set dutycycle` if device responded to it, else `set af`.

---

## CONTACT TYPES / TEXT TYPES

| Value | ADV_TYPE | Description |
|-------|----------|-------------|
| 1 | ADV_TYPE_CHAT | Companion/client radio |
| 2 | ADV_TYPE_REPEATER | Repeater node |
| 3 | ADV_TYPE_ROOM | Room server |
| 4 | ADV_TYPE_SENSOR | Sensor node |

| Value | TXT_TYPE | Usage |
|-------|----------|-------|
| 0 | TXT_TYPE_PLAIN | Normal text message |
| 1 | TXT_TYPE_CLI_DATA | CLI command (remote management) |
| 2 | TXT_TYPE_SIGNED | Signed/verified message |

---

## KNOWN FIRMWARE ISSUES (v1.14.0)

1. CMD_GET_ADVERT_PATH (0x2A) — not supported, returns ERR_CODE_UNSUPPORTED_CMD
2. CMD_SEND_CONTROL_DATA (0x37) — not supported on BLE companion
3. flood_max does NOT exist on companion radios. Only repeaters/rooms/sensors have it via CLI (default 64, range 0-64).
4. RESP_CODE_EXPORT_CONTACT may arrive as 0x0B (wiki) or 0x14 — handle both.
5. BLE GAP advertisement name only updates after device reboot. `setAdvertName()` calls `sendAdvertise()` after to propagate to mesh contacts immediately.
