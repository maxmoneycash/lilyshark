# Mesh profile enrichment — batch F

Reviewed **2026-09-16**. Proposal only; shared catalog and device-detail files were not edited.

## Deliverable

[Proposed replacement profiles](../../data/profile-enrichment-batch-f-2026-09-16.json) contains five complete objects in the existing profile schema. Every factual row has a primary-source link, a review date, and a matching resource entry. Existing useful resources are retained; retaining an older certification/download link does not mean its contents were independently recertified.

| Slug | Rows | What the review adds |
| --- | ---: | --- |
| `thinknode-m1` | 27 | UF2 upload, exact display, debugging connection, documented operating-condition differences |
| `thinknode-m2` | 23 | Display-driver correction, upstream GNSS configuration, programming controls, battery and measurement scope |
| `heltec-lora32-v4` | 30 | Separate R2/R8 display and firmware references, power-input limits, revision-specific pin changes |
| `heltec-mesh-node-t114` | 24 | Hardware revision history, UF2 drive procedure, accessory and enclosure constraints |
| `rak-wisblock-meshtastic-starter-kit` | 31 | Base-specific battery/solar connections, module assembly, exact bundle selections, firmware/bootloader distinction |

**135 rows.** `coverage: reviewed` means source review, not completeness, interoperability certification, or hands-on testing. No new price, stock, runtime, or range measurement is asserted.

## Material findings

- **ThinkNode M1:** The [manual](https://www.elecrow.com/download/product/CIL12901M/ThinkNode-M1_User_Manual.pdf) and [datasheet](https://www.elecrow.com/download/product/CIL12901M/ThinkNode%20M1_LoRa_Meshtastic_Transceiver_DataSheet.pdf) disagree on several operating and physical details. The proposal labels each document’s figures. Its existing unqualified current maximum should not survive the merge.
- **ThinkNode M2:** [The datasheet](https://www.elecrow.com/download/product/CIL13002M/ThinkNode_M2_Meshtastic_Signal_Transceiver_DataSheet.pdf) resolves the display driver. [Upstream configuration](https://github.com/meshtastic/firmware/blob/6d41e279f1f51bd59f687b9d441c1bf47b1594fc/variants/esp32s3/ELECROW-ThinkNode-M2/variant.h) does not enable GNSS. App location features are insufficient evidence of a built-in receiver.
- **Heltec V4:** The [store](https://heltec.org/project/wifi-lora-32-v4/) and [R2 electrical table](https://resource.heltec.cn/download/WiFi_LoRa_32_V4/datasheet/WiFi_LoRa_32_V4.2.0.pdf) disagree on battery maximum. The [R8 datasheet](https://resource.heltec.cn/download/WiFi_LoRa_32_V4-R8/datasheet/WiFi_LoRa_32_V4R8.pdf) agrees with the lower electrical limit but carries mixed revision labels. These are unresolved documentation differences.
- **Heltec T114:** The [hardware log](https://wiki.heltec.org/docs/devices/open-source-hardware/nrf52840-series/mesh-node-t114/hardware_update_log) extends beyond the shop title’s revision. That does not identify the revision of a unit a customer will receive.
- **RAK kit:** [RAK19001](https://docs.rakwireless.com/product-categories/wisblock/rak19001/quickstart/) has a distinct non-rechargeable-battery input. The other reviewed bases’ LiPo instructions must not be generalized to every connector. [Current official option data](https://store.rakwireless.com/products/wisblock-meshtastic-starter-kit.js) establishes which accessories belong to each selectable bundle; it is not a stock claim.

## Catalog proposals — separate from profile merge

These are review suggestions, not changes applied to `catalog.json`.

| Slug / field | Proposed change | Reason / evidence |
| --- | --- | --- |
| `thinknode-m1` → `specs.processor` | `nRF52840 · Bluetooth LE` | Avoid choosing a disputed Bluetooth minor version; see manual/datasheet above. |
| `thinknode-m1` → `specs.display` | `1.54″ e-paper · 200 × 200` | Exact resolution is documented in the datasheet. |
| `thinknode-m1` → runtime verification note | `Maker runtime estimates vary by document and operating mode; no runtime was measured.` | Preserve uncertainty without presenting one marketing estimate as authoritative. |
| `thinknode-m2` → `specs.display` | `1.3″ OLED · 128 × 64 · SH1106` | Datasheet and pinned upstream configuration agree. |
| `thinknode-m2` → verification notes | Add that the reviewed upstream target disables GPS. Keep the battery-package qualifier. | Avoid reading phone-app location sharing as hardware capability. |
| `heltec-lora32-v4` → `specs.display` | `0.96″ OLED · 128 × 64; display-free option` | Both model datasheets document OLED; shop also lists a display-free selection. |
| `heltec-lora32-v4` → verification notes | Name `heltec-v4` and `heltec-v4-r8-oled` as the reviewed OLED source targets; state release/board matching still matters. | [Pinned R2](https://github.com/meshtastic/firmware/blob/6d41e279f1f51bd59f687b9d441c1bf47b1594fc/variants/esp32s3/heltec_v4/platformio.ini) and [R8](https://github.com/meshtastic/firmware/blob/6d41e279f1f51bd59f687b9d441c1bf47b1594fc/variants/esp32s3/heltec_v4_r8/platformio.ini) build definitions distinguish OLED/TFT targets. |
| `heltec-mesh-node-t114` → revision note | Keep the current listing scope; add that the hardware log includes V2.1 and buyers should confirm PCB revision. | Do not rename all listed units as V2.1 without shipment evidence. |
| `rak-wisblock-meshtastic-starter-kit` → `usage.needs` | `Band-matched antenna, power source and configuration for the selected kit.` | The selected base is already included; current wording can imply an extra base purchase. See the [kit quick start](https://docs.rakwireless.com/product-categories/meshtastic/wismesh-starter-kit/quickstart/). |

Do not toggle verification flags or move catalog dates automatically because a profile was merged. Root should review the exact summary claims it retains.

## Evidence and method

- Read maker PDFs, hardware/update guides, product option data and Meshtastic source. Sources are attached to individual rows; public firmware downloads and web-flasher links are included as resources.
- Meshtastic source is pinned to commit `6d41e279f1f51bd59f687b9d441c1bf47b1594fc`, retrieved during this review. A build definition is not proof that a particular release or shipped unit contains that build.
- Elecrow product/wiki direct access sometimes returned a challenge or 403. Official PDFs and cached primary-site results supplied the useful facts; this limitation prevents treating the review as a live inventory check. The M2 wiki’s legacy URL mentions nRF52840 while its body describes ESP32-S3.
- Kept text as concise paraphrase. No source PDFs, schematics or product images were copied into the repository. Source links remain with the original publishers.
- Deliberately left missing replacement-cell specifications, exact shipped revisions and unresolved accessory/firmware combinations as gaps. Generic sensor, GNSS, MeshCore or LoRaWAN support was not inferred from a connector or related device.

## Validation and merge handoff

Validation passed: five expected keys; all profile/row dates; nonempty sections and rows; unique resource URLs within each profile; and every row citation present in resources. There are **59 resource entries, 49 distinct resource URLs and 32 directly cited sources**. The largest combined row text attributed to one source is **135 words**; the short notes/report were also reviewed for source budget and no long copied passages are present.

Merge the five reviewed objects by slug when shared catalog writers have finished. No app build, UI check, firmware installation or outreach was performed for this batch. The proposal does not change media rights or authorize publication of retained product photos.

## Root integration

Merged September 16 after row review and independent checks of the M2 display/electrical table, Heltec battery table/revision log and RAK19001 power guide. Applied the listed summary corrections without changing prices, stock dates or T114’s Rev. 2.0 listing scope. Totals after merge: 67 profiles, 1,324 rows and 405 resource links. Pre-merge data backups remain in `/tmp/gadgets-before-batch-f-{profiles,catalog}.json`. Main build and browser checks follow the integrated sharing changes.
