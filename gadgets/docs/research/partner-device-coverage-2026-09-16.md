# Partner-device source coverage — 16 September 2026

## Result

Expanded seven existing LILYGO and Seeed profiles from **113 to 216 specification rows** and **36 to 57 resource links**. Added 104 rows, corrected or strengthened 18 existing rows, and moved one project-ownership statement out of the manufacturer-sourced specifications. The catalog still has 67 entries.

This pass focused on the information that changes a build decision: available connections, power behavior, firmware targets, component variants and recovery resources. It does not establish that every manufacturer claim or every shipping configuration has been verified. Unresolved conflicts remain visible in each profile.

Only these seven entries changed in `data/catalog.json` and `data/device-details.json`. No affiliate links, discount codes, applications, purchases or external messages were created. No app code or generated site files were changed.

## Coverage counts

| Slug | Rows before → after | Resources before → after | Added / revised / removed rows |
| --- | ---: | ---: | ---: |
| `lilygo-t-deck-plus` | 17 → 32 | 8 → 11 | 16 / 2 / 1 |
| `t-embed-cc1101` | 13 → 31 | 2 → 6 | 18 / 1 / 0 |
| `lilygo-t-echo` | 12 → 27 | 5 → 11 | 15 / 2 / 0 |
| `lilygo-t-beam-supreme` | 10 → 30 | 3 → 8 | 20 / 3 / 0 |
| `seeed-wio-tracker-l1` | 19 → 32 | 4 → 5 | 13 / 3 / 0 |
| `sensecap-t1000-e` | 22 → 33 | 3 → 5 | 11 / 4 / 0 |
| `seeed-xiao-esp32s3` | 20 → 31 | 11 → 11 | 11 / 3 / 0 |
| **Total** | **113 → 216** | **36 → 57** | **104 / 18 / 1** |

“Revised” counts a changed value or citation, excluding review-date metadata. Resources are counted per profile, so the same chip reference can appear in more than one profile.

## Findings by device

### T-Deck Plus

The build guidance now exposes the occupied Grove connection and the shared SPI/power initialization requirements. Added component and GPIO references, keyboard programming and recovery information. Primary references: [hardware repository](https://github.com/Xinyuan-LilyGO/T-Deck), [factory pin definitions](https://github.com/Xinyuan-LilyGO/T-Deck/blob/master/examples/UnitTest/utilities.h), [maker wiki](https://wiki.lilygo.cc/products/t-deck-series/t-deck-plus/).

The [quick-start GPS snippet](https://wiki.lilygo.cc/products/t-deck-series/t-deck-plus/quick-start.html) differs from the [repository GPS example](https://github.com/Xinyuan-LilyGO/T-Deck/blob/master/examples/GPSShield/GPSShield.ino). The profile follows the repository and records the conflict. Assembled dimensions and SKU-specific box contents remain unresolved.

The LilyShark statement is now explicitly first-party project context in `notes`. It no longer cites a LILYGO sales page as evidence of Max’s ownership or firmware compatibility. LILYGO hardware, LilyShark firmware and the gadgets.sh catalog retain separate identities.

### T-Embed CC1101

Corrected the catalog’s unknown battery capacity and the profile’s misleading IO04 battery reading. The maker documents a **1300 mAh** cell and **BQ27220** gauge; its [schematic](https://github.com/Xinyuan-LilyGO/T-Embed-CC1101/blob/master/hardware/T-Embed-CC1101%20V1.0%2024-07-29.pdf) assigns GPIO4 to the encoder. Added hardware connections, storage and firmware limits from the [repository](https://github.com/Xinyuan-LilyGO/T-Embed-CC1101) and [wiki](https://wiki.lilygo.cc/products/t-embed-series/t-embed-cc1101/).

The README hardware label and schematic date differ. Weight and full package contents remain unconfirmed. Tested-card guidance is not presented as an absolute SD capacity ceiling; the base device is not assigned Plus accessories.

### T-Echo

Resolved internal memory using [Nordic’s specification](https://www.nordicsemi.com/Products/nRF52840). The external flash row now cites [Macronix’s part table](https://www.macronix.com/en-us/products/NOR-Flash/Pages/Ultra-Low-Power-Flash.aspx) and is scoped to the named chip option. Added power, SDK, pin and recovery constraints from [LILYGO’s current repository](https://github.com/Xinyuan-LilyGO/T-Echo).

The store’s RAM error remains documented. Nordic port names avoid the repository’s inconsistent Arduino numbering for a display pin. The Plus comparison remains explicit; its additions are not inherited by the base device. Dimensions, weight and package contents still need a selected SKU.

### T-Beam Supreme

The catalog now identifies the screen and power hardware, with radio/GNSS variants called out. The [board-specific reference](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam_supreme/t_beam_supreme_hw.md) supplies revision and build details; the [V3.1 schematic](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/schematic/T-Beam-S3-Supreme/T-Beam-S3-Supreme-V3.1.pdf) resolves the wiki’s RTC naming conflict. The [generic overview](https://wiki.lilygo.cc/products/t-beam-series/t-beam-supreme/) supplies display and body specifications.

The separate [144 MHz hardware reference](https://github.com/Xinyuan-LilyGO/LilyGo-LoRa-Series/blob/master/docs/en/t_beam_supreme/t_beam_supreme_144_hw.md) is linked. Generic radio tables are not proof that every SKU operates on every listed band. Conflicting rate labels and package dependencies remain noted.

### Wio Tracker L1

Distinguished internal MCU memory from the **2 MB external QSPI flash** in [Seeed’s block diagram](https://files.seeedstudio.com/wiki/SenseCAP/wio_tracker/L1%20Diagram.png). Added selected expansion and power connections. The [setup guide](https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/) resolves the OLED driver and provides model-specific firmware, sensors and first-use guidance.

The shared diagram includes multiple models and reused GPIO labels; it is not a universal wiring plan. Battery connector disagreement remains visible. The guide’s reversed written buzzer steps are flagged, not repeated as instructions. L1, Lite, Pro and E-Ink remain distinct in the [model table](https://wiki.seeedstudio.com/wio_tracker_l1_node/).

### SenseCAP T1000-E for Meshtastic

Expanded practical controls and update guidance from the [Meshtastic setup page](https://wiki.seeedstudio.com/sensecap_t1000_e/), while preserving the E-model-only hardware values from [page 3 of the datasheet](https://files.seeedstudio.com/products/SenseCAP/SenseCAP_Tracker_T1000_Datasheet.pdf). Installed sensors remain separate from supported app features.

**A/B versus E is no longer a sufficient model check.** Seeed also sells a same-name [T1000-E for LoRaWAN](https://wiki.seeedstudio.com/t1000e_for_lorawan_introduction/), whose guide warns against Meshtastic or MeshCore firmware. Added a dedicated row, catalog warning, resource and compatibility note. The catalog’s selected product remains the Meshtastic version; no purchased unit’s numeric SKU has been established.

### XIAO ESP32-S3

Added the base board’s battery-monitoring and 5 V output limitations, power figures, recovery and reset-sensitive pins from [Seeed’s guide](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/). Revision-specific power components cite the [V1.4 schematic](https://files.seeedstudio.com/wiki/SeeedStudio-XIAO-ESP32S3/new-res/202003751_XIAO%20ESP32S3_v1.4_SCH_260226.pdf.pdf).

The profile keeps base, Sense and Plus distinctions. Typical electrical figures are not complete-build runtime predictions. Older dimension files and newer schematics retain their revision labels.

## Review dates and source discipline

- New or corrected rows have `reviewed: 2026-09-16`.
- Unchanged rows retain their previous review date, now recorded explicitly per row.
- Each of these seven profile-level dates indicates the latest partial review. It does not silently refresh every older row.
- Catalog summary dates were advanced only for these seven entries after reviewing their summary fields and variant notes.
- Every factual specification row has a directly relevant HTTPS citation also present in that profile’s resources. First-party ownership is a note, not a falsely cited hardware fact.
- This report and the profile additions use short factual summaries and link to the full manuals, schematics and code. They do not reproduce manufacturers’ manuals wholesale.

## Validation

- `validateDeviceDetails` passes for all 67 catalog entries and 67 detail profiles.
- Structural comparison against the pre-edit snapshot confirms that only the seven assigned entries changed in either data file.
- Of 20 distinct newly added resource URLs, 19 returned HTTP 200 in direct checks. Nordic returned HTTP 403 to the script, but its official nRF52840 page was successfully retrieved and inspected through the web research tool; it is retained as the primary chip source.
- No build, full test suite or browser session was run, preserving the main agent’s active preview and generated files.

## Next useful coverage pass

Collect exact order SKUs and PCB photographs for unresolved package, connector and revision questions. Prioritize device-specific firmware and accessory compatibility over copying additional marketing text. These profiles now provide more useful evidence for a setup guide, while retaining the limits a builder needs to see before buying or flashing.
