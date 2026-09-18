# CircuitMess profile enrichment — batch C

Reviewed 2026-09-16. Proposal only: `data/profile-enrichment-batch-c-2026-09-16.json` contains six complete replacement profile objects in the existing detail schema. Shared catalog, app and detail files were not edited by this task.

This is an independent source review, with no assembly, radio, battery, phone-pairing or firmware tests. `coverage: reviewed` records the review, not completeness or product endorsement. Each row includes its own review date and a source included in that profile’s resources.

## What builders gain

| Profile | Main addition |
| --- | --- |
| CircuitPet | Original kit contents, separately required tools, original Arduino setup/upload instructions, display implementation and firmware source. |
| Chatter 2.0 | Current assembly booklet, battery requirements, first connection guidance and an explicit older-library/current-board mismatch. |
| Clockstar 2.0 | Exact 2.0 booklet and drawing, revision-specific source build instructions and a stock recovery route. |
| NASA Artemis Watch 2.0 | Current ready-to-use guidance, everyday limits, source/build instructions and recovery resources. |
| ByteBoi 2.0 | Exact kit booklet and drawing, supplied parts versus separate robot, programming and stock recovery guidance. |
| MAKERphone 2.0 | Announced features remain clearly separated from unknown shipping hardware, package contents and setup documentation. |

## Revision findings that should survive the merge

### Exact guide pages replace old generic links

The maker’s resources index distinguishes original products from 2.0 products. Use the specific [Chatter 2.0](https://circuitmess.com/blogs/resources/chatter-2-0-build-guide), [Clockstar 2.0](https://circuitmess.com/blogs/resources/clockstar-2-0-build-guide), [ByteBoi 2.0](https://circuitmess.com/blogs/resources/byteboi-2-0-build-guide) and [Artemis 2.0](https://circuitmess.com/blogs/resources/artemis-watch-2-0-build-guide) landing pages. They provide direct PDF downloads.

The schematics linked there use internal board names v2.1, v2.4, v2.3 and v0.9, respectively. Those labels are retained in section headings. A store name, PCB revision and firmware version are different identifiers.

### Chatter compatibility needs the actual board

The [current drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/Chatter_2.0_schema.pdf) connects its buzzer to GPIO22. The [older Chatter2 library](https://raw.githubusercontent.com/CircuitMess/Chatter2-Library/master/src/Pins.hpp) uses GPIO19. This concrete discrepancy prevents treating the older repository as a confirmed upload target.

[Meshtastic’s primary documentation](https://meshtastic.org/docs/hardware/devices/community-supported/chatter/) describes earlier WROOM/LLCC68 hardware and includes details that differ from the current maker drawing. Keep that resource labelled for earlier boards. Neither “all Chatter 2.0 units support Meshtastic” nor “Chatter has no Meshtastic support” is an adequate summary.

### Artemis is currently sold assembled

Keep the [current product](https://circuitmess.com/products/nasa-artemis-watch-2-0) recorded as assembled. Assembly language elsewhere on that page and the guide title conflict with its explicit ready-to-use statement. The [2025 booklet](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/ArtemisWatch_2.0_Booklet_2025_120mm_PRINT.pdf) is centered on use and coding; it also supplies limitations missing from the store overview.

The product advertises compass/temperature features; the linked drawing does not identify a separate compass. The proposal keeps this unresolved instead of promoting every marketing claim into a verified sensor inventory.

### CircuitPet remains its own original kit

Use the [original build instructions](https://circuitmess.com/blogs/resources/circuitpet-build-guide), not a Codee product redirect. The [anatomy guide](https://circuitmess.com/blogs/resources/circuitpet-anatomy-guide-ch-1-circuitpets-anatomy-pg-1) and [linked drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/CircuitPet-v1.3.pdf?v=1753084006) disagree about the LED’s control arrangement. “RGB LED” is supported; an integrated controller is left unresolved.

### Download availability is not a flashing test

The maker publishes [Clockstar v2 v1.3](https://github.com/CircuitMess/Clockstar-v2-Firmware/releases/tag/v1.3) and [Artemis v2.2](https://github.com/CircuitMess/GC_Artemis-Firmware/releases/tag/v2.2). Their respective READMEs describe ESP-IDF builds, required patches and stock recovery. Release assets were verified through the public GitHub API; binaries were not executed or flashed. The [Clockstar README](https://github.com/CircuitMess/Clockstar-v2-Firmware) explicitly distinguishes v2 hardware from the original watch.

## Suggested catalog corrections — review separately

These are suggestions only; the proposal JSON does not include catalog mutations.

| Slug | Suggested summary update | Direct evidence |
| --- | --- | --- |
| `circuitpet` | Processor can use the exact ESP32-WROOM-32-N4 identifier; display can describe the 1.77-inch drawing and 128 × 160 library target with attribution. | [Drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/CircuitPet-v1.3.pdf?v=1753084006), [display source](https://raw.githubusercontent.com/CircuitMess/CircuitPet-Library/master/src/CircuitPetDisplay.cpp) |
| `chatter-2-0` | Replace unknown controller with WT32-S1 as drawn. Replace unknown battery type with 3 × AA per unit. Do not add USB charging or infer a regional band from the module name. | [v2.1 drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/Chatter_2.0_schema.pdf) |
| `clockstar-2-0` | Processor and power can identify ESP32-S3-MINI-1-N4R2 and 600 mAh LiPo, explicitly sourced to the linked drawing. | [v2.4 drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/Clockstar_2.0_schema.pdf) |
| `nasa-artemis-watch-2-0` | Add the same processor/battery identifiers with a v0.9 drawing qualifier. Retain assembled status and unresolved sensor claims. | [v0.9 drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/Artemis_Watch_2.0_schema.pdf) |
| `byteboi-2-0` | ESP32-WROOM-32-N4 and 600 mAh LiPo are now sourced. The drawing labels a 2.8-inch TFT; the library supports several display variants. | [v2.3 drawing](https://cdn.shopify.com/s/files/1/0552/3269/2430/files/ByteBoi_2.0_schema.pdf), [display source](https://raw.githubusercontent.com/CircuitMess/ByteBoi-Library/master/src/ByteBoiDisplay.cpp) |
| `makerphone-2-0` | Preserve campaign/announcement status and unknown specifications; original Ringo material cannot fill revision-2 gaps. | [Maker overview](https://circuitmess.com/products/makerphone-2-0) |

## Research limits and verification

- Maker pages and exact linked PDFs were read. Schematic pages and selected booklet pages were rendered locally and visually inspected with the PDF skill; PDF images were not edited.
- The Chatter booklet produced an internal error in the research fetch, but its exact linked CDN file downloaded successfully and its contents were read and visually inspected. The supplied link is real.
- CircuitBlocks is linked from primary guides and firmware READMEs. Its interactive workflow was not opened or tested.
- Kickstarter exposed the official MAKERphone campaign destination but not its project details to the research fetch. Delivery dates, carrier support and reward inclusions remain unconfirmed.
- No original-model schematic or third-party comment was substituted for a current kit specification. No battery/runtime estimate is presented as measured.
- Profiles use concise paraphrases and references rather than republishing manuals. The largest combined label/value extraction from one row source is 106 words; gaps and revision notes describe this review’s limitations.
- Validation: six known catalog slugs; 89 dated rows; 45 resource entries; 28 distinct row sources. Existing `validateDeviceDetails` passes on the six selected catalog devices. Every row source appears in its profile resources. No app build, shared preview restart or browser session was used.

## Merge instructions

Review the six top-level objects, then replace those same keys in `data/device-details.json`. Apply any catalog summary corrections as a separate, deliberate change. Preserve the gaps and revision notes when integrating; omitting them changes the meaning of the specifications.
