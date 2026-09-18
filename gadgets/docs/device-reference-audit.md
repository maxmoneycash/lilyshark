# Device reference audit — 15 September 2026

Every one of the 67 catalog entries has a dated detail profile. The 65 reviewed product profiles contain manufacturer/project claims; CyperPRO remains unconfirmed and LilyShark is an original concept. None is represented as hands-on tested.

## Coverage

1051 structured fields and 240 resource links. Facts cover compute, memory, radios, displays, connectors, power, enclosure, included parts, firmware and revision limitations wherever established by the cited source. Values are paraphrased and linked per row.

This is a curated reference, not a claim to have copied or exhaustively verified every page of every manufacturer's website. Full manuals, pin diagrams, CAD files, schematics and firmware remain available through official resource links. Unknowns and source conflicts appear under **What still needs checking** on the corresponding device page.

Initial research retrieved 94 catalog references into a private cache. The follow-up resource audit checked 232 unique URLs. Four returning 404 were removed; the current Marauder release page replaces two stale C5 paths. Some sites block direct automated retrieval with 403, including Raspberry Pi, Kickstarter and Digilent. Raspberry Pi and Digilent facts were additionally read through the web tool's official-page/PDF results. A 403 does not establish that a URL is dead. CyperPRO's full primary technical documentation remains unavailable.

## Maintenance

- `data/device-details.json` is the curated source of truth; `data/catalog.json` holds concise carousel/comparison summaries.
- `src/device-details.mjs` validates coverage and requires each fact's HTTPS citation to appear in that profile's resources before building.
- Details are rendered into individual HTML pages and are not added to the carousel's catalog payload.
- `scripts/audit-device-sources.py` fetches references into `/tmp` for human review. Install `requests` and `beautifulsoup4` in a virtual environment. PDFs are retained as PDFs for separate review. Never auto-publish scraped text or equate an HTTP 200 with a verified fact.
- The dated JSON audit records link transport results, not a certification of product accuracy or future availability.

## Per-device coverage

| Device | Fields | Resources | Coverage | Open notes |
| --- | ---: | ---: | --- | ---: |
| Flipper Zero | 27 | 4 | reviewed | 1 |
| The Hacker Pager | 22 | 3 | reviewed | 0 |
| LilyGO T-Deck Plus | 17 | 8 | reviewed | 1 |
| Biscuit Ultra | 19 | 1 | reviewed | 1 |
| PocketMage | 19 | 7 | reviewed | 0 |
| CatSniffer v3 | 17 | 6 | reviewed | 2 |
| Flipper One | 25 | 7 | reviewed | 1 |
| M1 | 14 | 2 | reviewed | 1 |
| Interrupt | 11 | 2 | reviewed | 1 |
| CyperPRO | 3 | 1 | unconfirmed | 1 |
| Kode Dot | 24 | 2 | reviewed | 1 |
| CardputerZero | 27 | 7 | reviewed | 1 |
| Mecha Comet | 23 | 9 | reviewed | 2 |
| High Boy | 22 | 1 | reviewed | 2 |
| MeowKit | 24 | 2 | reviewed | 0 |
| POOM | 14 | 1 | reviewed | 1 |
| BLEShark Nano | 12 | 1 | reviewed | 1 |
| Scout Lite | 20 | 6 | reviewed | 0 |
| Rabbit-Labs C5 | 7 | 1 | reviewed | 1 |
| T-Embed CC1101 | 13 | 2 | reviewed | 1 |
| OUI SPY | 13 | 7 | reviewed | 1 |
| mesh-detect v2 | 11 | 6 | reviewed | 2 |
| Radiacode 110 | 15 | 2 | reviewed | 0 |
| YARD Stick One | 12 | 5 | reviewed | 1 |
| Proxmark3 RDV4 | 10 | 1 | reviewed | 1 |
| Chameleon Ultra | 13 | 7 | reviewed | 1 |
| Sensor Watch Pro | 19 | 2 | reviewed | 1 |
| GGtag | 13 | 5 | reviewed | 2 |
| TICKEY | 16 | 2 | reviewed | 1 |
| SenseCAP T1000-E | 22 | 3 | reviewed | 0 |
| M5Shark Manta C5 | 8 | 1 | reviewed | 1 |
| M5Shark V8 2.4G/5G | 15 | 1 | reviewed | 1 |
| Apex 5 | 15 | 2 | reviewed | 2 |
| MAKERphone 2.0 | 11 | 1 | reviewed | 1 |
| Chatter 2.0 | 10 | 3 | reviewed | 1 |
| Clockstar 2.0 | 10 | 3 | reviewed | 1 |
| NASA Artemis Watch 2.0 | 10 | 2 | reviewed | 1 |
| ByteBoi 2.0 | 10 | 3 | reviewed | 1 |
| CircuitPet | 8 | 3 | reviewed | 1 |
| Nibble | 13 | 1 | reviewed | 1 |
| SLIM Signal Sleuth v1.1 | 11 | 2 | reviewed | 1 |
| Cerberus Development Board | 11 | 1 | reviewed | 1 |
| ThinkNode M1 | 18 | 5 | reviewed | 1 |
| ThinkNode M2 | 17 | 4 | reviewed | 1 |
| Heltec WiFi LoRa 32 V4 | 21 | 4 | reviewed | 1 |
| Heltec Mesh Node T114 Rev. 2.0 | 20 | 5 | reviewed | 1 |
| RAK WisBlock Meshtastic Starter Kit | 14 | 7 | reviewed | 1 |
| LILYGO T-Echo | 12 | 5 | reviewed | 1 |
| LILYGO T-Beam SUPREME | 10 | 3 | reviewed | 1 |
| Seeed Wio Tracker L1 | 19 | 4 | reviewed | 1 |
| HackRF One | 14 | 4 | reviewed | 0 |
| HackRF Pro | 16 | 4 | reviewed | 0 |
| RTL-SDR Blog V4 | 19 | 3 | reviewed | 1 |
| Airspy R2 | 21 | 3 | reviewed | 1 |
| Raspberry Pi 5 | 18 | 2 | reviewed | 1 |
| Raspberry Pi Zero 2 W | 14 | 1 | reviewed | 1 |
| Raspberry Pi Pico 2 W | 15 | 1 | reviewed | 1 |
| Arduino UNO R4 WiFi | 17 | 4 | reviewed | 1 |
| Espressif ESP32-S3-DevKitC-1 v1.1 | 16 | 9 | reviewed | 0 |
| M5Stack Cardputer-Adv | 23 | 8 | reviewed | 0 |
| Seeed XIAO ESP32-S3 | 20 | 11 | reviewed | 1 |
| Saleae Logic 8 | 19 | 2 | reviewed | 0 |
| Digilent Analog Discovery 3 | 21 | 2 | reviewed | 0 |
| Bus Pirate 5 Rev. 10 | 17 | 6 | reviewed | 0 |
| GreatFET One | 13 | 4 | reviewed | 1 |
| PINECIL V2 | 13 | 3 | reviewed | 0 |
| LilyShark | 8 | 0 | concept | 1 |
