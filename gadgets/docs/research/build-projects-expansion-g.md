# Build-finder expansion G

Reviewed 16 September 2026. **Proposal only:** five external guides, five previously uncovered catalog models. The combined directory would contain **16 guides covering 14 models**, up from 11 guides and nine models. Every proposed record has `testedByUs: false` and requires one unit of its named core device.

Data: [build-projects-expansion-g-2026-09-16.json](../../data/build-projects-expansion-g-2026-09-16.json). No shared data, application code or rendered pages were changed.

## Selection

| Proposed entry | Primary guide and credit | Why it qualifies |
| --- | --- | --- |
| Airspy LAN receiver | [Airspy quickstart](https://airspy.com/quickstart/) | A concrete receiver workflow; the [current download page](https://airspy.com/download/) explicitly names R2. |
| Bus Pirate sensor bench | [Bus Pirate documentation team](https://docs.buspirate.com/docs/devices/sht40-sht41-sht43-sht45/) | Wiring, transactions and observable measurements. The maker's [hardware guide](https://docs.buspirate.com/docs/overview/hardware/) establishes Bus Pirate 5 applicability. |
| Heltec enclosed companion | [AJ Quick's V4 build](https://www.ajquick.com/guides/build-a-heltec-v4-meshcore-companion) | An authored assembly with parts, enclosure downloads and functional checks. Variant exclusions remain prominent. |
| GreatFET SPI exercise | [Great Scott Gadgets](https://greatscottgadgets.github.io/greatfet-tutorials/spi.html) | Names GreatFET One and demonstrates a visible output from the serial interface. |
| Pi USB webcam | [elcalzado's Webcam Pi](https://github.com/elcalzado/webcampi) | Exact-model installation and usage instructions, backed by a [versioned image release](https://github.com/elcalzado/webcampi/releases/tag/v1.1.1). |

All links preserve their original destinations. No shopping-only page serves as the main guide. No media, firmware, installers or project archives were downloaded; no source commands were executed. Manufacturer reference pages support accessory/model boundaries rather than replacing the actual build guide.

## Boundaries that must survive integration

The JSON contains the parts, software and limitations; do not drop those fields when merging.

- **Airspy:** the proposed path uses the current Windows package. The manufacturer's quickstart contains older Linux installation examples, so the record points to current architecture requirements. This is a LAN example, not a public receiver deployment. [Quickstart](https://airspy.com/quickstart/), [downloads](https://airspy.com/download/).
- **Bus Pirate:** the sensor guide has a conflicting read-address value in prose; its example transaction uses a different value. The record flags this rather than silently correcting third-party instructions. Firmware selection remains tied to the catalog's Rev. 10. [Sensor guide](https://docs.buspirate.com/docs/devices/sht40-sht41-sht43-sht45/), [Rev. 10 documentation](https://docs.buspirate.com/docs/hardware/bp5rev10/introduction/).
- **Heltec:** this is the author's OLED build. The source does not establish every PCB subrevision or R8 case/firmware combination. The record excludes unestablished variants and links the [author's firmware discussion](https://www.ajquick.com/articles/meshcore-firmware-what-i-run-instead-of-stock) plus [Heltec's variant distinctions](https://heltec.org/project/wifi-lora-32-v4/). Do not turn the catalog-level match into a blanket fit claim.
- **GreatFET:** the source does not establish the power budget for an arbitrary strip. That unresolved electrical check stays in the card's limitations. It is not permission to extrapolate the example to a larger load. [SPI tutorial](https://greatscottgadgets.github.io/greatfet-tutorials/spi.html).
- **Webcam Pi:** release notes update the README's older test matrix; the record follows the explicit v1.1.1 pairing and attributes the test to the maintainer. This provides source evidence, not independent hardware validation. The release API returned HTTP 200 and listed one image asset; its binary was not fetched. [README](https://github.com/elcalzado/webcampi), [release](https://github.com/elcalzado/webcampi/releases/tag/v1.1.1).

Core matching cannot establish accessory ownership, safe wiring, PCB identity, firmware success or a reachable mesh peer. No hands-on outcomes are claimed.

## Rejected candidates

- The [Digilent AD3 RC-filter article](https://digilent.com/blog/verifying-multisim-live-simulations-with-the-analog-discovery-3/) uses a separate ADP3450 to generate the signal. That unlisted bench instrument is a material dependency; replacing it with AD3's generator would create our own untested adaptation.
- Raspberry Pi's [older USB-webcam tutorial](https://www.raspberrypi.com/tutorials/plug-and-play-raspberry-pi-usb-webcam/) explicitly requires its legacy Bullseye path. The versioned maintainer project above gives a clearer bounded record for this batch.
- The [GreatFET tutorial index](https://greatscottgadgets.github.io/greatfet-tutorials/) labels its logic-analysis tutorial unfinished. The completed SPI tutorial is the stronger entry.

Five supported additions are preferable to a sixth weak match. No generic RTL-SDR, original Cardputer or unspecified Heltec board tutorial was mapped onto a different catalog revision.

## Source word budgets

All wording is concise paraphrase; no third-party code, instructions, diagrams or photographs are reproduced. Technical part names and short section titles are retained for attribution. The following conservative source-derived ceilings cover the proposal JSON and this note together, below the web sources' 200-word limits. Counts include repeated supporting facts; ceilings are not permission to expand the public cards.

| Source | Reserved maximum words |
| --- | ---: |
| [Airspy quickstart](https://airspy.com/quickstart/) | 150 |
| [Airspy downloads](https://airspy.com/download/) | 90 |
| [Airspy R2 reference](https://airspy.com/airspy-r2/) | 35 |
| [Bus Pirate sensor guide](https://docs.buspirate.com/docs/devices/sht40-sht41-sht43-sht45/) | 170 |
| [Bus Pirate hardware overview](https://docs.buspirate.com/docs/overview/hardware/) | 65 |
| [Bus Pirate terminal setup](https://docs.buspirate.com/docs/tutorial-basics/quick-setup/) | 35 |
| [Bus Pirate Rev. 10](https://docs.buspirate.com/docs/hardware/bp5rev10/introduction/) | 30 |
| [AJ Quick assembly](https://www.ajquick.com/guides/build-a-heltec-v4-meshcore-companion) | 180 |
| [AJ Quick firmware](https://www.ajquick.com/articles/meshcore-firmware-what-i-run-instead-of-stock) | 85 |
| [Heltec V4 variants](https://heltec.org/project/wifi-lora-32-v4/) | 65 |
| [GreatFET SPI tutorial](https://greatscottgadgets.github.io/greatfet-tutorials/spi.html) | 170 |
| [GreatFET setup](https://greatscottgadgets.github.io/greatfet-tutorials/getting-started.html) | 55 |
| [Webcam Pi README](https://github.com/elcalzado/webcampi) | 150 |
| [Webcam Pi v1.1.1](https://github.com/elcalzado/webcampi/releases/tag/v1.1.1) | 120 |
| [Raspberry Pi camera cable reference](https://www.raspberrypi.com/documentation/accessories/camera.html) | 40 |
| Each rejected candidate's linked source | 70 |

As an additional conservative check, all non-URL string values in each JSON record total 146, 172, 184, 130 and 170 whitespace-delimited words respectively, including attribution and schema strings. The records draw on multiple separate primary pages, with supporting-page allocations shown above.

## Validation and remaining work

Ran the existing pure `validateBuildProjects` against current plus proposed data: **16 accepted, zero errors**. Additional assertions confirmed all five slugs were previously uncovered and each guide matches a quantity of one of its named device. Current multi-unit requirements were preserved by validating the unchanged original entries alongside the proposal.

This validates data shape and matching, not the source authors' technical results. Remaining work is root review and merge, then normal page QA; no application build or browser session was run here. The limitations above are explicit, unresolved source or hardware boundaries—not claims that they have been tested away.

## Root integration — 16 September 2026

Accepted records are merged into the live local data. With batches G and J, the finder contains 19 guides covering 17 exact catalog models. All 91 automated checks pass after the 70-entry catalog merge. Source-based prerequisites and unresolved revision/firmware limits remain in the rendered cards; no physical build was performed.
