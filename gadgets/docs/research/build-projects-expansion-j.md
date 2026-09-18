# Build-finder expansion J

Reviewed 16 September 2026. Three proposals for the three candidate catalog models, with exact-model evidence and `testedByUs: false`. Data: [build-projects-expansion-j-2026-09-16.json](../../data/build-projects-expansion-j-2026-09-16.json).

## Model and guide decisions

| Model | Accepted source and scope | Decision |
| --- | --- | --- |
| NanoRFE NanoVNA V2 Plus4 Pro | [Operation manual](https://nanorfe.com/nanovna-v2-user-manual.html), credited to OwOTech and cho45, hosted by NanoRFE | Its model table explicitly includes Plus4 Pro; the [product page](https://nanorfe.com/nanovna-v2.html) identifies this as the manual for all V2 versions. This establishes the common measurement procedure more concretely than a generic compatibility claim. |
| Seeed reTerminal E1001 | [Seeed's ESPHome display cookbook](https://wiki.seeedstudio.com/reterminal_e10xx_with_esphome/) | The weather section contains an E1001-specific configuration, not merely a supported-model list. The proposal uses that branch. |
| DFRobot HUSKYLENS 2 | [DFRobot's Self-Learning Classifier guide](https://wiki.dfrobot.com/sen0638/docs/22617) | Direct standalone workflow for this device, including named objects and model-file export. The record does not rely on generic controller compatibility. |

Each requires one unit of its core device. Required hosts, cables, software, source limitations and variant exclusions are in the JSON. They must remain visible when these records are merged.

### NanoRFE scope

The [antenna article](https://nanorfe.com/nanovna-antenna-tuning-swr.html) supplies application context and accessories, but is too broad to establish the Pro model by itself. The main guide is therefore the operation manual, with the [software page](https://nanorfe.com/nanovna-software.html) supporting data export. The manual's older revision label and conflicting frequency limits remain explicit. A passive antenna is the target; the VNA itself generates a test signal. No trace, antenna-range improvement or instrument accuracy has been measured here.

The [shop](https://www.nanorfe.com/shop) lists calibration standards and cables in the bundle, but the record still requires them explicitly: catalog ownership does not prove an owner's kit is complete.

### E1001 scope

This is a weather display for a workshop, not a ready-made workshop-control system. No specific catalog computer is declared a compatible Home Assistant host merely because it runs Linux. The source's prerequisite is retained without inventing that match.

The [advanced cookbook's comprehensive example](https://wiki.seeedstudio.com/reterminal_e10xx_with_esphome_advanced/) was not selected: its E1001 code shows onboard indoor climate/time, despite the broader weather description. Combining it with the weather example would be our own untested adaptation. The proposal links the concrete base example instead.

The older `/reterminal_e10xx_esphome/` URL returned an empty HTTP 200 body during one fetch. The current `/reterminal_e10xx_with_esphome/` route returned the readable guide and is used in the proposal.

### HUSKYLENS scope

The proposed artifact is a backup from one camera. Demonstrating transfer to another device would require a second camera and a separate validation step. No wireless accessory, controller, cloud model service or second device is silently included. The [getting-started guide](https://wiki.dfrobot.com/sen0638/docs/22599) confirms direct USB-powered operation; the [product page](https://www.dfrobot.com/product-2995.html) establishes SEN0638 identity. No recognition accuracy is claimed.

## Validation

Validated the union of current records, G and J against the union of current catalog and the three candidate entries. Root had already merged all five G records and all three candidate slugs at validation time, so the union retained current entries by ID/slug rather than duplicating them.

- Current catalog: **70 entries**, including all three candidates.
- Current guides: **16**, including all five G entries.
- Proposed J: **3**.
- Combined result: **19 accepted guides, 17 distinct core models, zero validation errors**.
- Additional assertions verified each J record's one-unit match and its explicit untested status.

Only the existing pure validator/matching functions were run. No application build, browser, firmware, vendor script or installer was executed; no binary, image or project archive was downloaded. No shared data or code was edited.

## Source budgets and remaining checks

Original short summaries and prerequisites only; no copied tutorial code, images or full procedures. Conservative maximum source-derived word allocations across these two artifacts:

| Source | Maximum words |
| --- | ---: |
| [NanoRFE operation manual](https://nanorfe.com/nanovna-v2-user-manual.html) | 185 |
| [NanoRFE product/manual mapping](https://nanorfe.com/nanovna-v2.html) | 55 |
| [NanoRFE antenna guide](https://nanorfe.com/nanovna-antenna-tuning-swr.html) | 100 |
| [NanoRFE software](https://nanorfe.com/nanovna-software.html) | 65 |
| [NanoRFE shop](https://www.nanorfe.com/shop) | 65 |
| [Seeed display cookbook](https://wiki.seeedstudio.com/reterminal_e10xx_with_esphome/) | 195 |
| [E1001 setup](https://wiki.seeedstudio.com/getting_started_with_reterminal_e1001/) | 55 |
| [Seeed advanced cookbook](https://wiki.seeedstudio.com/reterminal_e10xx_with_esphome_advanced/) | 60 |
| [DFRobot classifier guide](https://wiki.dfrobot.com/sen0638/docs/22617) | 190 |
| [DFRobot setup](https://wiki.dfrobot.com/sen0638/docs/22599) | 40 |
| [DFRobot product identity](https://www.dfrobot.com/product-2995.html) | 40 |

The allocations remain below each retrieved page's 200-word limit. Runtime behavior, firmware combinations, host support, calibration quality and recognition results remain untested. Root review and page QA are still required after integration; passing the data validator establishes neither compatibility beyond the documented scope nor a reproduced hardware result.

## Root integration — 16 September 2026

Accepted records are merged into the live local data. With batches G and J, the finder contains 19 guides covering 17 exact catalog models. All 91 automated checks pass after the 70-entry catalog merge. Source-based prerequisites and unresolved revision/firmware limits remain in the rendered cards; no physical build was performed.
