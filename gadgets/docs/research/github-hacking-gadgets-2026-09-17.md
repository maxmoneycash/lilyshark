# GitHub sweep: hacking gadgets (2026-09-17)

Direct `gh search repos` over ten queries (flipper alternative, esp32 pentest, pwnagotchi, wifi deauther, meshtastic board, sub-ghz, rfid cloner, handheld, cyberdeck, marauder), filtered to ≥40 stars and pushed since mid-2024. Most high-star results are **firmware or plugins, not distinct hardware** — those are build guides at most, not catalog devices.

## Hardware worth a catalog entry (build-it projects)
- **Willy Firmware** (h-RAT/Willy_Firmware_V2, ★660) — Flipper-style tool on ESP32 T-Display-S3 + CC1101 + touch. Reference hardware is buildable. → candidate
- **minigotchi-ESP32** (dj1ch/minigotchi-ESP32, ★292) — pwnagotchi on a bare ESP32; a build, not a product.
- **ESP32Berry** (0015/ESP32Berry, ★248) — ESP32 + BlackBerry keyboard handheld. → candidate
- **cyber-controller** (LxveAce, ★149) — already in the scout backlog.
- **MicroHydra** (echo-lalia, ★316) — an app launcher OS for ESP32 devices, not hardware. Skip.

## Cyberdecks (DIY CAD/build projects — borderline, large not pocket)
RPI DEV (★1722), framedeck (★1102), DFCD (★719), bumble-berry-pi (★343), Pelican-Deck (★308), Mu_Cyberdeck (★165). These are one-off builds with CAD files, not products; out of the "pocket hardware" scope. Note as a possible future "cyberdecks" section, not individual entries.

## Software/firmware only (NOT hardware — do not list)
pwnagotchi (evilsocket ★9204, jayofelony ★2918), Netgotchi, Fancygotchi, marauder-ui, custom-faces mods, plugin repos, guerilla guides.

## Better source than keyword search
GitHub **topic** pages give cleaner hardware hits and are already watched by `scripts/scout.mjs` (topics: flipper-zero, meshtastic, meshcore, lora, open-source-hardware, wifi-security, sdr, rfid). Keyword repo search is noisy with firmware. Recommend adding topics: `hardware-hacking`, `pentest-hardware`, `cyberdeck`, `badusb` to the scout.
