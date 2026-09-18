# Device profile proposals — batch D

Reviewed **2026-09-16**. Proposal file: `data/profile-enrichment-batch-d-2026-09-16.json`.

Seven replacement profiles add setup paths, electrical limits, recovery resources and revision distinctions. They contain **142 dated rows**, **45 resource links**, **43 distinct resource URLs**, and **34 distinct sources attached to rows**. Every row and resource has a review date. Every profile states `testedByUs: false`.

These are compact reference proposals, not claims to reproduce the devices' complete manuals. Detailed wiring, CAD and software instructions remain at their credited primary sources. No hardware was connected, firmware compiled/flashed, radio operated or app/catalog data changed during this review.

## Coverage

| Exact catalog model | Proposed rows | Resource links | Useful additions |
| --- | ---: | ---: | --- |
| Raspberry Pi 5 | 20 | 4 | USB/fan budget, camera connector size, first-boot setup, mechanical drawing |
| Raspberry Pi Zero 2 W | 19 | 5 | Distinct USB power/data ports, header option, remote setup, schematic and dimensions |
| Raspberry Pi Pico 2 W | 20 | 6 | Board-specific power/temperature, UF2 selection, SWD, silicon errata |
| Arduino UNO R4 WiFi | 21 | 10 | Correct CAN pins, 3.3 V exceptions, bridge update/recovery, library compatibility |
| PINECIL V2 | 20 | 8 | V2-only flasher/files, optional BLE, package contents, production schematic |
| GreatFET One | 22 | 6 | Actual MCU/flash, USB port roles, electrical notes, Python setup and pinouts |
| YARD Stick One | 20 | 6 | SMA polarity, antenna power limit, LED behavior, YS1 firmware target and software caveat |

Resources repeated between Pi 5 and Zero 2 W explain the difference between link count and distinct URL count. “Reviewed” means checked against primary documentation; it does not mean that a complete build or operating-system combination was tested.

## Corrections and evidence

### UNO R4 WiFi: replace D4/D5 CAN pin claim

The current manual's overview names D4/D5, but its pin table and Arduino's dedicated WiFi tutorial use **D13 receive / D10 transmit**. The replacement follows the [Arduino-authored CAN tutorial](https://github.com/arduino/docs-content/blob/main/content/hardware/02.uno/boards/uno-r4-wifi/tutorials/can/can.md), with the [full pinout](https://docs.arduino.cc/resources/pinouts/ABX00087-full-pinout.pdf) and [schematic](https://docs.arduino.cc/resources/schematics/ABX00087-schematics.pdf) available for review. An external transceiver remains required. This is a source contradiction, not a measured board test.

The separate [user manual](https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf) establishes the 8 mA per-pin limit. The Qwiic and ESP headers are 3.3 V exceptions to the main header voltage; the pinout gives the clearest warning.

Programming the main MCU differs from updating the ESP32-S3 bridge. Arduino says its [connectivity updater](https://support.arduino.cc/hc/en-us/articles/9670986058780-Update-the-connectivity-module-firmware-on-UNO-R4-WiFi) overwrites the sketch and requires a disconnect/reconnect before the next upload. A separate [bridge recovery procedure](https://support.arduino.cc/hc/en-us/articles/16379769332892-Restore-the-USB-connectivity-firmware-on-UNO-R4-WiFi-with-espflash) covers missing identification. These are links and caveats, not actions performed here.

Arduino's [wireless support list](https://support.arduino.cc/hc/en-us/articles/4407129094546-Boards-and-shields-with-wireless-connectivity) includes this model under BLE. Do not expand that into Bluetooth Classic support. Existing “separately programmable ESP32-S3” language needs the bridge caveat alongside it.

### Pico 2 W: use the board's thermal rating

Replace the generic family-page **−20 to 85 °C** row with the exact board datasheet's **−20 to 70 °C, including self-heating**. VSYS permits 1.8–5.5 V; that is separate from USB and GPIO ratings. See the [Pico 2 W datasheet, §§2.3 and 3.5](https://datasheets.raspberrypi.com/picow/pico-2-w-datasheet.pdf).

The [RP2350 errata](https://pip.raspberrypi.com/documents/RP-008373-DS) identify E9 as an A2 input-leakage issue fixed by A3. We do not know the buyer's actual stepping. The profile therefore asks for revision checking instead of claiming all currently sold boards are affected or fixed.

The [Pico documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html) distinguishes wireless and presoldered-header variants. The software resources point to the [board-specific UF2 index](https://www.raspberrypi.com/documentation/microcontrollers/micropython.html) and [C/C++ setup](https://www.raspberrypi.com/documentation/microcontrollers/c_sdk.html). No Pico 1 binary is assumed interchangeable.

### PINECIL V2: BLE exists, and V1 flashing is different

[IronOS](https://github.com/Ralim/IronOS) documents optional BLE and its disabled default from 2.23 onward. Normal soldering does not need it. The old catalog wording is technically compatible with this but hides useful hardware capability.

The [V2 flashing guide](https://ralim.github.io/IronOS/Flashing/Pinecil%20V2/) calls for BIN/BLISP, unlike V1 DFU. [PINE64's instructions](https://pine64.org/documentation/Pinecil/Firmware/) require the barrel input to remain disconnected while updating over the computer's USB connection.

The [store package](https://pine64.com/product/pinecil-smart-mini-portable-soldering-iron/) lists the iron and short tip. The [specifications](https://pine64.org/documentation/Pinecil/Further_information/Specifications/) still qualify 28 V EPR as tentative, so it is not promoted to the normal supported range. Optional Hall sensing is distinguished from factory hardware using the [component documentation](https://pine64.org/documentation/Pinecil/Further_information/Schematics_and_datasheets/).

### GreatFET One: identify the board and its two USB roles

The [Azalea repository](https://github.com/greatfet-hardware/azalea) supplies the actual MCU, flash, header and voltage information missing from the old profile. USB0 is the high-speed computer connection; USB1 is the full-speed target interface. Pin exceptions remain in the linked tables; “100 pins” must not imply 100 unrestricted GPIOs.

The [current setup guide](https://greatfet.readthedocs.io/en/latest/getting_started.html) calls for Python 3.9+ and documents host/firmware updates. The [API examples](https://greatfet.readthedocs.io/en/latest/using_greatfet_apis.html) include a four-channel 2 MSPS capture; that example is not presented as a maximum sample-rate specification. Neighbor-current limits and measured ADC performance remain gaps.

### YARD Stick One: retain official bands and qualify the software path

The [device manual](https://yardstickone.readthedocs.io/en/latest/yardstickone.html) specifies SMA female, a 3.3 V / 50 mA antenna supply and the P1 interface. The [maker overview](https://greatscottgadgets.com/yardstickone/) separates official and unofficial tuning ranges; neither indicates blanket protocol support.

The [RfCat README](https://github.com/atlas0fd00m/rfcat) still contains Python 2.7 and old distribution instructions. This proposal does not invent a tested modern Python install. It identifies the YS1 bootloader target and points to upstream instructions with an explicit caveat. The [maker FAQ](https://yardstickone.readthedocs.io/en/latest/faq.html) explains the idle LED and recovery header. The short Read the Docs firmware page contains no useful procedure, so it was not added as a setup resource.

### Raspberry Pi computers: supply and accessory specificity

The [Pi 5 product page](https://www.raspberrypi.com/products/raspberry-pi-5/) rechecks its memory options, OS generation and case/cooling requirements. [Hardware documentation](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html) supplies the aggregate USB/fan budget and connector details. The index supplies Pi 5 mechanical/STEP files, but this review did not identify a complete board schematic there.

For Zero 2 W, the [model page](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/) establishes its ports and base-board header footprint. The [current first-boot guide](https://www.raspberrypi.com/documentation/computers/getting-started.html) recommends 5 V / 2.5 A for Zero models; a separate typical-current table says 2 A for Zero 2 W. This profile labels 2.5 A as the setup recommendation, not a measured consumption figure.

## Separate core-catalog proposals

These changes are **not applied** by this batch. The profile JSON can be reviewed independently.

| Catalog field | Suggested replacement | Evidence |
| --- | --- | --- |
| `greatfet-one.specs.processor` | `LPC4330 · 2 MB flash · 100 expansion pins` | [Azalea hardware](https://github.com/greatfet-hardware/azalea) |
| `pinecil-v2.specs.radio` | `Optional Bluetooth LE via IronOS; off by default in 2.23+` | [IronOS](https://github.com/Ralim/IronOS) |
| `pinecil-v2.usage.capabilities` | Consider adding `ble` if capability filters describe installed hardware; retain the optional-firmware context | [IronOS](https://github.com/Ralim/IronOS) |
| `raspberry-pi-pico-2-w.specs.power` | `5 V micro-USB · VSYS 1.8–5.5 V · 3.3 V GPIO` | [Exact board datasheet](https://datasheets.raspberrypi.com/picow/pico-2-w-datasheet.pdf) |
| `raspberry-pi-pico-2-w.source` | Prefer the linked Pico documentation over the generic product-family page for model-specific requirements | [Pico documentation](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html) |
| `arduino-uno-r4-wifi.specs.radio` | `2.4 GHz Wi-Fi · Bluetooth LE through ESP32-S3` | [Manual](https://docs.arduino.cc/resources/datasheets/ABX00087-datasheet.pdf), [software support list](https://support.arduino.cc/hc/en-us/articles/4407129094546-Boards-and-shields-with-wireless-connectivity) |

CAN pin and Pico temperature fixes live in the proposed detail profiles; their old values are not currently separate core-catalog fields. No price, stock, affiliate, physical-testing or compatibility status change is proposed.

## Validation and limits

- The existing `validateDeviceDetails` function passes against these seven proposed profiles and their catalog entries.
- All 142 rows have review date `2026-09-16` and an HTTPS source included in that profile's resources.
- Resource URLs are unique within each profile; no affiliate URL rewriting is used.
- Two Arduino tutorial pages returned only a page shell through text extraction. Their exact Arduino-maintained Markdown source was read instead and is linked directly.
- Some download-link clicks returned tool errors. The proposal keeps verified documentation/download indexes instead of inventing release-asset filenames.
- No app build, browser session, full test suite, purchase, firmware execution or outreach was performed.
