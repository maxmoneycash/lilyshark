# Profile enrichment batch E

Reviewed 2026-09-16. Proposals for seven exact catalog models; no shared catalog or app files changed.

## Handoff

[profile-enrichment-batch-e-2026-09-16.json](../../data/profile-enrichment-batch-e-2026-09-16.json) contains complete replacement profiles in the existing device-details shape. Each profile, row and resource has a review date. All profiles explicitly set `testedByUs: false`.

| Catalog model | Existing rows | Proposed rows | Resource links |
| --- | ---: | ---: | ---: |
| HackRF One | 14 | 23 | 11 |
| HackRF Pro | 16 | 22 | 12 |
| RTL-SDR Blog V4 | 19 | 21 | 6 |
| Airspy R2 | 21 | 24 | 5 |
| Bus Pirate 5 Rev. 10 | 17 | 24 | 10 |
| Saleae Logic 8 | 19 | 22 | 7 |
| Digilent Analog Discovery 3 | 21 | 29 | 6 |
| **Total** | **127** | **165** | **57** |

There are **49 distinct resource URLs** and **42 distinct URLs attached to factual rows**. Counts describe documentation coverage; they do not measure physical verification. Resource URLs may repeat between profiles.

Validation: `validateDeviceDetails` passes for the seven catalog entries. Separate assertions verified every row/resource date, the profile dates and the false testing flags. No build, browser QA, device interaction or vendor installer execution occurred.

## Findings that affect a purchase

### HackRF One

The [One-specific reference](https://hackrf.readthedocs.io/en/latest/hackrf_one.html#maximum-input-power) supplies the missing maximum RF-input limit. [Connector guidance](https://hackrf.readthedocs.io/en/latest/hackrf_connectors.html) explains the easy-to-miss SMA/RP-SMA mismatch. These are now practical buying constraints alongside the RF headline.

[Revision documentation](https://hackrf.readthedocs.io/en/latest/list_of_hardware_revisions.html) explains identification and component changes. [Firmware instructions](https://hackrf.readthedocs.io/en/latest/updating_firmware.html) distinguish the One image from Pro and distinguish flash images from recovery images. Existing generic standalone wording is narrowed to the maker's custom-firmware use case.

### HackRF Pro

The [gateware reference](https://hackrf.readthedocs.io/en/latest/gateware.html) supports a more precise replacement for the old unconditional DC-spike statement: optional DC removal. It also explains the substantial resolution/bandwidth trade-off in extended precision. This does not establish which third-party GUI exposes every mode.

The [Pro product page](https://greatscottgadgets.com/hackrf/pro/) still says a migration guide is forthcoming. A Pro-specific maximum RF-input power remains absent from the reviewed model pages. The One rating must not silently become a Pro rating. The [dedicated hardware repository](https://github.com/greatscottgadgets/hackrf-pro) is separate from the shared firmware repository.

### RTL-SDR Blog V4

Keep the catalog model pinned to R828D V4. The [current store](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) separately describes R828S V4L and its changed filtering/software support. The old launch production forecast is unsuitable for a stock claim.

The [V4 guide](https://www.rtl-sdr.com/v4/) provides platform-specific driver and bias-tee notes. The [Windows quickstart](https://www.rtl-sdr.com/rtl-sdr-quick-start-guide/) identifies the exact USB interface rather than treating arbitrary Zadig driver replacement as a generic setup step. No absolute RF-input power limit was found in the reviewed V4 material.

### Airspy R2

[Quickstart](https://airspy.com/quickstart/) adds the previously missing bias-tee current budget and host-throughput caveats. [Current downloads](https://airspy.com/download/) separate x86-64 and ARM server packages and identify processor requirements for the Linux x86-64 build.

The old GitHub `host` and `firmware` URLs redirect to [airspyone_host](https://github.com/airspy/airspyone_host) and [airspyone_firmware](https://github.com/airspy/airspyone_firmware); the proposal uses the resolved URLs. Historical OS examples are not promoted as present support commitments. Package contents still need exact seller confirmation.

### Bus Pirate 5 Rev. 10

The [power tutorial](https://docs.buspirate.com/docs/tutorial-basics/power-supply/) resolves the apparent 300/500 mA discrepancy: output is rated 300 mA, while the protection setting has additional transient headroom. A 500 mA selectable limit is not a 500 mA continuous supply.

Use the [rev10 hardware specification](https://docs.buspirate.com/docs/hardware/bp5rev10/introduction/) for buffered operating voltage. The repository's broad introductory text uses a different lower-voltage figure; it is not used to override the model-specific 1.65 V minimum. [Firmware instructions](https://docs.buspirate.com/docs/tutorial-basics/firmware-update/) explicitly distinguish rev10, the scarce rev8 preview and RP2350-based Bus Pirate 6. The [rev10a schematic](https://docs.buspirate.com/images/docs/hw/bp5rev10/buspirate-5-rev10a-schematic.pdf) is linked for deeper review; this batch did not independently validate every circuit net.

### Saleae Logic 8

**Unresolved source contradiction:** the [May 2026 datasheet](https://downloads.saleae.com/specs/logic_8_data_sheet.pdf) says selectable thresholds, while both [electrical support](https://www.saleae.com/support/specifications-hardware/electrical-characteristics/supported-voltages) and [capture settings](https://www.saleae.com/support/logic-software/capturing-data/capture-settings) identify Logic 8 as fixed-threshold. The proposal attributes the fixed values to support and leaves an explicit purchase caveat. It does not promise Pro-style adjustment.

Current [OS support](https://www.saleae.com/support/logic-software/download-and-installation/supported-operating-systems) replaces generic cross-platform wording. The original profile's sample-rate caveats are retained. Pinout, common ground and separate analog measurement/protection limits remain visible.

### Analog Discovery 3

The [BNC adapter page](https://digilent.com/shop/bnc-adapter-for-analog-discovery/) explains the loss of differential inputs and the correct type of leads for waveform outputs. These details change which accessories someone should order.

The [versioned WaveForms manual](https://files.digilent.com/manuals/WaveForms/3.25.1/main.html) documents Adept Runtime, Linux package choices and the Apple-silicon app/runtime distinction. It is labeled as version 3.25.1, not assumed to describe every future installer. The [AD3 startup guide](https://files.digilent.com/manuals/WaveForms/3.25.1/start10.html) adds the pinout and clock setup.

The [datasheet](https://files.digilent.com/datasheets/Analog-Discovery-3-Datasheet.pdf) and startup table disagree on waveform-output protection. No external back-drive tolerance is claimed. The reference-site manual returned HTTP 403; accessible official PDF and application documentation were used instead. No complete schematic or isolation rating was established.

## Core catalog proposals — not applied

These are separate from the replacement detail profiles. Preserve existing slugs and model names.

| Model / field | Proposed change | Reason / primary source |
| --- | --- | --- |
| Bus Pirate 5 `verificationNotes[0]` | Add “300 mA rated target output; 0–500 mA configurable protection limit.” | Prevents reading the protection setting as a supply rating. [Power tutorial](https://docs.buspirate.com/docs/tutorial-basics/power-supply/). |
| Bus Pirate 5 `usage.tradeoff` | “Match the firmware to Bus Pirate model and PCB revision.” | Current text calls 5/5XL/6 different revisions; users need the actual image distinction. [Firmware guide](https://docs.buspirate.com/docs/tutorial-basics/firmware-update/). |
| Saleae Logic 8 `verificationNotes` | Add a concise threshold-documentation conflict and electrical-support source. | Avoids publishing “selectable” from the PDF without qualification. [Voltage support](https://www.saleae.com/support/specifications-hardware/electrical-characteristics/supported-voltages). |
| Analog Discovery 3 `usage.needs` | Add “adequate USB power or a 5 V auxiliary supply.” | Host power is separate from connector/data speed. [AD3 startup guide](https://files.digilent.com/manuals/WaveForms/3.25.1/start10.html). |
| HackRF Pro `extraSources` | Add the gateware reference. | Existing catalog range/sample wording is already qualified; precision modes need this deeper source. [Gateware](https://hackrf.readthedocs.io/en/latest/gateware.html). |

Other core catalog wording was not found to require a factual correction in this pass. The important HackRF DC-removal correction is in the detail profile, not a current core catalog row. Review dates may advance after a reviewed merge; they do not imply hands-on testing.

## Coverage boundaries

- Profiles paraphrase practical facts; they do not reproduce vendor manuals or claim every undocumented detail.
- All external URLs remain original vendor/project links. No affiliate transformation, partnership status, stock guarantee or promoted ranking was added.
- Primary-source inconsistencies stay in `gaps`; software paths are documentation-based and unexecuted.
- Antenna matching, host throughput and electrical limits are not blanket compatibility certifications.
