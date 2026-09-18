# Device profile enrichment — batch B

Reviewed 16 September 2026. Proposal only: `data/profile-enrichment-batch-b-2026-09-16.json` contains six complete replacement profile objects. It does not patch the live catalog or live detail profiles.

## What is ready

| Catalog key | Rows | Main improvement |
| --- | ---: | --- |
| `slim-signal-sleuth-v1-1` | 15 | CAD and upstream firmware context, with explicit revision boundaries. |
| `cerberus-development-board` | 11 | More precise distinction between published facts, promised documentation and proposed modules. |
| `proxmark3-rdv4` | 15 | Matching client/firmware, build target and an explicitly separate wireless accessory. |
| `rabbit-labs-c5` | 9 | Exact seller identity, availability observation and missing board-specific downloads. |
| `m5shark-c5-marauder` | 8 | Protect the current C5 variant from older Manta specifications. |
| `m5shark-v8-2-4g-5g` | 21 | SHARK source, pinned release, update boundary and enclosure files. |

All 79 rows have `reviewed: "2026-09-16"`. Every row source appears in that profile’s resources. Existing useful facts and gaps are retained, sometimes shortened or qualified. `coverage: "reviewed"` means sources were reviewed; it does not mean hardware-tested or exhaustive.

## Corrections proposed for the catalog summaries

These are review suggestions, separate from the profile JSON.

### Rabbit-Labs C5

Change `status` from `listed` to `soldout`, with review date 16 September. The [exact seller listing](https://www.tindie.com/products/sometoms/flipper-zero-esp32-c5-multi-board/) reports that state. Avoid borrowing the antenna tuning, memory or supported protocol details of another Rabbit-Labs model.

### Proxmark3 RDV4

Replace the radio summary’s `optional BLE / Wi-Fi expansion` with `optional Bluetooth/battery add-on`. The [Blue Shark manual](https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/bt_manual_v10.md) specifies Bluetooth 2.0 + EDR; the [USART notes](https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/uart_notes.md) describe Wi-Fi bridging as a possible future connection. The broader [hardware overview](https://proxmark.com/proxmark-3-hardware/proxmark-3-rdv4/) is retained as a documented source conflict, not silently ignored.

The client and device images should come from matching source versions; the [compilation instructions](https://github.com/RfidResearchGroup/proxmark3/blob/master/doc/md/Use_of_Proxmark/0_Compilation-Instructions.md) are now linked directly.

### SLIM Signal Sleuth

Qualify `specs.power: "USB-C"` to `Power requirements unconfirmed; BW16 module has USB-C`. The [kit listing](https://463n7.io/products/slim-signal-sleuth-kit) identifies that connector on one included module; it does not document the complete board power path. Retain the existing enclosure conflict.

The [upstream release history](https://github.com/JosephHewitt/wardriver_rev3/releases) is useful because it identifies BW16 support and stable/beta branches. It does not resolve the SLIM board’s exact configuration. The [SignalSleuth CAD directory](https://github.com/463N7/SignalSleuth/tree/main/STEP) is labeled as a fit-check resource, not a guaranteed SLIM enclosure.

### M5Shark Manta C5

Keep the current name and conservative hardware summary. The [general maker guide](https://m5shark.com/pages/esp32-marauder-compatible-devices-m5shark) describes Manta with GPS, 433 MHz and a 2.8-inch display while linking to the [current C5 product](https://m5shark.com/products/esp32-c5-marauder-working-with-flipper-zero). These are not sufficient grounds to add those features to this exact variant. No verified Manta C5 download was found.

### M5Shark V8

Keep catalog memory unspecified for now. The [SHARK R150 release](https://github.com/M5Shark/M5Shark/releases/tag/v150.0.0) provides a firmware target and downloads; the [store page](https://m5shark.com/products/m5shark-marauder-v8) does not tie every production revision to that target. The proposed profile makes this distinction explicit.

The [repository](https://github.com/M5Shark/M5Shark) links the exact V8 product and its account links the maker’s website and social channels. The reviewed store pages did not provide a reciprocal GitHub link. Resources are therefore labeled as SHARK project materials, with no claim that a purchased unit ships with R150. Release asset names were confirmed through GitHub’s public API; no binary or archive was executed.

The README’s GPL-3.0 statement conflicts with the [LICENSE file](https://github.com/M5Shark/M5Shark/blob/main/LICENSE), which contains MIT text. The profile records the conflict without selecting a definitive license. The firmware’s Chameleon integration requires separate RFID hardware; it is not a built-in V8 radio.

### Cerberus

Keep preorder status and the narrow base-device radio description. The [maker listing](https://463n7.io/products/cerberus-development-board) does not supply a usable public firmware link or a dated delivery commitment. No unrelated project with the same name was used to fill those gaps.

## Verification and remaining work

- Used primary maker listings, project repositories, public release metadata and project documentation. Secondary search results served only to locate primary sources; their hardware expansions were not imported.
- Tindie failed through the search tool but its original HTTPS page loaded through a normal read-only HTTP fetch. No mirror or lookalike store was substituted.
- The linked Printables enclosure was retained from the maker’s listing; its page did not load during this review, so fit or files were not newly asserted.
- Row prose is compact: the largest total attributed to one source is 100 words before notes. The report adds only the specific corrections needed for review rather than duplicating specification tables.
- Schema and row-date validation are performed directly on the six proposed profiles. Root should merge only these six keys after concurrent profile edits finish, then run the normal full data/build checks.
- No live app files, browser sessions, builds, outreach, applications or purchases were changed by this batch.
