# External projects for hardware already on the bench

Reviewed September 16, 2026. Data: [build-projects-2026-09-16.json](../../data/build-projects-2026-09-16.json).

## Scope

Eleven credited external guides cover nine catalog devices. They are candidate records for a future build finder, not new gadgets.sh tutorials, commissioned creator work or independently reproduced builds. All have `testedByUs: false`. There are no downloaded or republished guide images.

Eligibility requires the source to name the catalog model explicitly. Similar processors and related product names are insufficient. “Exact model” does not certify every memory option, PCB revision, current dependency or attached part. Each record preserves the remaining conditions in `variantNotes` and `gaps`.

`coreCatalogSlugs` identifies the catalog hardware needed. `coreQuantities` matters: the wireless light display requires two XIAO boards. `otherRequired` is a short shopping/preparation list, not an exhaustive bill of materials. `software` records the documented environment. `sourceAnchors` uses the source's visible section names; full instructions remain with the author.

The JSON object has `schemaVersion`, `sourceReviewedDate`, `scope`, and a `projects` array. Stable `id` values are suitable for future route or filter use. They do not currently create routes.

## Included guides

| Record | Credited primary guide | Review note |
| --- | --- | --- |
| `cardputer-adv-audio-generator` | [Siczkoriz's source and instructions](https://github.com/Siczkoriz/Cardputer-ADV-Function-Generator) | Explicit ADV project; treat it as an audio experiment rather than a calibrated instrument. |
| `pico-2-w-local-weather-station` | [Matthew Smith's build](https://www.microcenter.com/site/mc-news/article/diy-weather-station.aspx) | Pico 2 W is explicit, including the breakout and connection details. |
| `pi-5-case-cyberdeck` | [Brian Corteil's construction guide](https://www.raspberrypi.com/news/create-your-own-cyberdeck/) | Physical fabrication and power decisions remain part of the build. |
| `pi-5-mirrored-home-server` | [Ian Webster's server guide](https://www.ianwebster.ca/post/omv-rpi5-build-guide) | Specific SSD setup; do not generalize its power arrangement to other drives. |
| `uno-r4-wifi-weather-display` | [Visual Micro's weather project](https://projecthub.arduino.cc/visualmicro/uno-r4-wifi-weather-dashboard-30d5a0) | Exact WiFi model. Preserve the author's toolchain and external API dependency. |
| `xiao-s3-temperature-color-light` | [Seeed's temperature-color example](https://wiki.seeedstudio.com/led_driver_board/#temp-color-sync-leds) | Use this ESP32S3 section; adjacent examples use different controllers. LED variant mismatch is disclosed in data. |
| `xiao-s3-wireless-light-meter` | [Seeed's BLE sensor exchange](https://wiki.seeedstudio.com/xiao_esp32s3_bluetooth/#ble-sensor-data-exchange) | Two boards, not one; base ESP32S3 is explicitly covered. |
| `t1000-e-meshcore-companion` | [Seeed's T1000-E MeshCore guide](https://wiki.seeedstudio.com/sensecap_t1000_e_meshcore/) | Eligibility depends on the version exclusion below. |
| `wio-l1-environment-node` | [Seeed's Meshtastic sensor guide](https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/#sensor-connection) | Base L1 is expressly included, and BME280 is a listed sensor option. |
| `hackrf-one-fm-receiver` | [Michael Ossmann's first SDR lesson](https://greatscottgadgets.com/sdr/1/) | Links updated flowgraphs; original video UI is older. |
| `flipper-zero-personal-ir-remote` | [Flipper Devices' remote guide](https://docs.flipper.net/zero/infrared/read) | Restrict the outcome to compatible IR remotes the builder controls. |

## A same-name tracker that must not be matched

Seeed's [T1000-E for LoRaWAN introduction](https://wiki.seeedstudio.com/t1000e_for_lorawan_introduction/) explicitly distinguishes that version and warns against installing MeshCore or Meshtastic firmware on it. A future finder must display this condition before offering the MeshCore guide; a text match on “T1000-E” alone is insufficient. A numeric SKU was not established in this review. The finding was sent to the agent updating the catalog profile.

The eligible record concerns the catalog's Meshtastic/MeshCore-capable tracker, not A/B variants or the LoRaWAN version. Owning an entry with an ambiguous purchased variant should produce “Confirm your version,” not “You have everything.”

## Attractive sources excluded or narrowed

- **XIAO camera/voice examples:** many use the Sense expansion hardware. The base ESP32S3 catalog entry does not establish ownership of its camera and microphone. Those examples were excluded.
- **WLED ring-light tutorials:** Seeed's [support announcement](https://www.seeedstudio.com/blog/2024/05/06/exciting-update-wled-now-supports-xiao-esp32-mcus/) names ESP32S3, but its linked finished ring-light build uses C3. We chose the explicit S3 temperature-color example instead of asserting interchangeability.
- **Wio L1 custom MeshCore display:** the [source development tutorial](https://wiki.seeedstudio.com/meshcore_source_code_pratical_tutorial_l1/) frames its worked example around L1 Pro. Its build target alone does not establish that every presentation detail applies to base L1. The included Meshtastic guide explicitly covers base L1.
- **Pico W lessons inside Pico 2 W course navigation:** a matching navigation title does not prove the worked build uses Pico 2 W. The included weather build names Pico 2 W in its actual instructions.
- **Generic Cardputer projects:** base-only examples were excluded. The selected function-generator author names ADV throughout.
- **Other Heltec projects:** V3 or unspecified T114 revisions do not establish V4 or T114 Rev. 2.0 support. No inferred replacements were added just to increase the count.

## Presentation rules for a future finder

Show the creator, a direct “Open original guide” link, a compact parts shortlist and the revision condition beside each result. Label the records as external source-reviewed guides. Preserve uncertainty when a builder owns one of two required boards or has not confirmed a variant. Show catalog product photography only as a part illustration, never as a photograph of the author's completed build.

Match the named requirements; do not claim electrical compatibility, successful assembly or current code execution from a catalog selection. We did not compile these projects or run their installation instructions. Firmware versions, dependencies, APIs and links need maintenance when the records are next published or updated. No public deployment, outreach, hardware purchase or new app feature was performed by this research task.
