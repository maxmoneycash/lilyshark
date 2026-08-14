# Lilyshark capture format (`.lscap`)

`.lscap` is Lilyshark's protocol-neutral raw radio capture format. It preserves
the exact `RawFrame` metadata and captured RF bytes without forcing them into a
third-party link type. In particular, it supports bandwidths such as MeshCore's
62.5 kHz profile, which LoRaTap v0 cannot encode.

The format is not PCAP and does not claim direct Wireshark compatibility.
Lilyshark can also export standards-compatible PCAP/LoRaTap when the active PHY
settings fit that format.

## Encoding rules

- File extension: `.lscap`
- Byte order: little-endian for every multi-byte integer
- Signed integers: two's-complement in the stated field width
- Payload: the exact `captured_length` bytes received from the radio
- Unknown metadata: retain the stored value and use `present_fields` to decide
  whether it is meaningful
- Readers must use the encoded header sizes to allow later compatible extension

## File header (24 bytes)

| Offset | Size | Field | Version 1 value |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `LSCP` |
| 4 | 2 | major version | `1` |
| 6 | 2 | minor version | `0` |
| 8 | 2 | file header size | `24` |
| 10 | 2 | record header size | `80` |
| 12 | 4 | file flags | `0` |
| 16 | 4 | timestamp ticks per second | `1,000,000` |
| 20 | 4 | reserved | `0` |

## Frame record header (80 bytes)

Each record header is immediately followed by `captured_length` unmodified
payload bytes.

| Offset | Size | Field | Unit or encoding |
| ---: | ---: | --- | --- |
| 0 | 4 | magic | ASCII `LSFR` |
| 4 | 2 | record header size | `80` |
| 6 | 2 | record layout version | `1` |
| 8 | 2 | captured length | bytes following header |
| 10 | 2 | original length | RF bytes before truncation |
| 12 | 8 | sequence | `FrameRecord.sequence`; `0` for a bare `RawFrame` |
| 20 | 8 | timestamp | microseconds |
| 28 | 4 | present fields | `RfField` bit mask |
| 32 | 4 | center frequency | hertz |
| 36 | 4 | bandwidth | hertz |
| 40 | 4 | bit rate | bits per second |
| 44 | 4 | frequency deviation | hertz |
| 48 | 4 | airtime | microseconds |
| 52 | 4 | frequency error | signed hertz |
| 56 | 2 | RSSI | signed tenths of dBm |
| 58 | 2 | SNR | signed tenths of dB |
| 60 | 2 | preamble | symbols |
| 62 | 2 | sync word | raw stored value |
| 64 | 2 | profile ID | Lilyshark profile identifier |
| 66 | 2 | radio status | signed driver status |
| 68 | 1 | TX power | signed dBm |
| 69 | 1 | spreading factor | raw integer |
| 70 | 1 | coding-rate denominator | `5` means 4/5 |
| 71 | 1 | channel index | raw integer |
| 72 | 1 | radio index | raw integer |
| 73 | 1 | modulation | `Modulation` enum value |
| 74 | 1 | direction | `FrameDirection` enum value |
| 75 | 1 | CRC state | `CrcStatus` enum value |
| 76 | 1 | metadata flags | bit 0 implicit header; bit 1 inverted IQ |
| 77 | 3 | reserved | zero |

### Version 1 enum values

These values are part of the file format and do not change if internal code is
later reorganized.

| Field | Value | Meaning |
| --- | ---: | --- |
| modulation | 0 | unknown |
| modulation | 1 | LoRa |
| modulation | 2 | FSK |
| direction | 0 | unknown |
| direction | 1 | receive |
| direction | 2 | transmit |
| CRC state | 0 | unknown |
| CRC state | 1 | not present |
| CRC state | 2 | valid |
| CRC state | 3 | invalid |

### Version 1 `present_fields` bits

| Bit | Metadata field |
| ---: | --- |
| 0 | timestamp |
| 1 | center frequency |
| 2 | bandwidth |
| 3 | airtime |
| 4 | frequency error |
| 5 | RSSI |
| 6 | SNR |
| 7 | TX power |
| 8 | preamble |
| 9 | sync word |
| 10 | profile ID |
| 11 | spreading factor |
| 12 | coding rate |
| 13 | channel index |
| 14 | radio status |
| 15 | bit rate |
| 16 | frequency deviation |

A reader should reject an unknown major file version, but it may skip extra
header bytes when a future header size is larger than the version 1 minimum.
