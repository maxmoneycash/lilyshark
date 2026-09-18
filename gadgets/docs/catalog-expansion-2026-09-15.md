# Catalog expansion — September 15, 2026

## Why the catalog was small

The first catalog mirrored the user's 44-entry archive, with one separate LilyShark concept. It was not a systematic inventory of radio and maker hardware. It contained nine Wi-Fi products and seven CircuitMess products, while missing common single-board computers, wideband SDRs and general bench tools.

This pass adds **22 devices**, bringing the catalog to **67 entries: 66 devices and one concept**. The original archive remains intact. There are now 63 source-checked devices, three partial reviews and the original hardware concept. A source check is a comparison with maker documentation, not a physical test or a stock guarantee.

## Added devices and setup requirements

The primary source for each entry is linked below. Device pages include additional sources, exact-model caveats and dated review notes. Prices remain unset where a current, comparable price was not established.

| Device | Role in a setup | Requirements | Primary source |
|---|---|---|---|
| [Heltec WiFi LoRa 32 V4](http://127.0.0.1:54644/devices/heltec-lora32-v4/) | Build a USB-powered mesh node or an ESP32 radio experiment. | Band-matched antenna, USB data cable and matching firmware target. | [Heltec](https://heltec.org/project/wifi-lora-32-v4/) |
| [Heltec Mesh Node T114 Rev. 2.0](http://127.0.0.1:54644/devices/heltec-mesh-node-t114/) | Assemble a Bluetooth-connected LoRa node with optional display and GPS. | Correct regional antenna, power source and Meshtastic client. | [Heltec](https://heltec.org/project/mesh-node-t114/) |
| [RAK WisBlock Meshtastic Starter Kit](http://127.0.0.1:54644/devices/rak-wisblock-meshtastic-starter-kit/) | Choose a modular base for a custom mesh node. | Selected base board, regional radio version and a power source. | [RAKwireless](https://store.rakwireless.com/products/wisblock-meshtastic-starter-kit) |
| [LILYGO T-Echo](http://127.0.0.1:54644/devices/lilygo-t-echo/) | Carry an e-paper mesh companion with built-in positioning. | A matching regional radio band and a phone/client for text entry. | [LILYGO](https://lilygo.cc/products/t-echo-lilygo) |
| [LILYGO T-Beam SUPREME](http://127.0.0.1:54644/devices/lilygo-t-beam-supreme/) | Build a LoRa tracking node around an ESP32-S3 and GNSS. | Band-matched antenna, suitable battery and revision-matched firmware. | [LILYGO](https://lilygo.cc/products/t-beam-supreme) |
| [Seeed Wio Tracker L1](http://127.0.0.1:54644/devices/seeed-wio-tracker-l1/) | Build a mesh tracker with GNSS, OLED and Grove expansion. | Regional antenna, power source and matching L1 firmware. | [Seeed Studio](https://wiki.seeedstudio.com/wio_tracker_l1_node/) |
| [HackRF One](http://127.0.0.1:54644/devices/hackrf-one/) | Explore wideband radio with a USB SDR that can receive or transmit. | Host software, USB cable and antenna suited to the band. | [Great Scott Gadgets](https://greatscottgadgets.com/hackrf/one/) |
| [HackRF Pro](http://127.0.0.1:54644/devices/hackrf-pro/) | Use the newer HackRF platform for wideband RF development. | Host software, USB-C data cable and a suitable antenna. | [Great Scott Gadgets](https://greatscottgadgets.com/hackrf/pro/) |
| [RTL-SDR Blog V4](http://127.0.0.1:54644/devices/rtl-sdr-blog-v4/) | Start a receive-only software-defined radio setup over USB. | Compatible V4 driver, receiver software and a band-appropriate antenna. | [RTL-SDR Blog](https://www.rtl-sdr.com/buy-rtl-sdr-dvb-t-dongles/) |
| [Airspy R2](http://127.0.0.1:54644/devices/airspy-r2/) | Monitor VHF and UHF signals with a USB SDR receiver. | Compatible host software and an SMA-connected receive antenna. | [Airspy](https://airspy.com/airspy-r2/) |
| [Raspberry Pi 5](http://127.0.0.1:54644/devices/raspberry-pi-5/) | Give a workbench, controller or custom computer a Linux host. | Boot storage, suitable power supply and cooling appropriate to the workload. | [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-5/) |
| [Raspberry Pi Zero 2 W](http://127.0.0.1:54644/devices/raspberry-pi-zero-2-w/) | Put a small Linux computer inside a custom portable build. | microSD boot card, power and adapters for the required USB/display connections. | [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/) |
| [Raspberry Pi Pico 2 W](http://127.0.0.1:54644/devices/raspberry-pi-pico-2-w/) | Program a compact wireless controller in C/C++ or MicroPython. | USB data cable, development tools and your sensors or actuators. | [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-pico-2/) |
| [Arduino UNO R4 WiFi](http://127.0.0.1:54644/devices/arduino-uno-r4-wifi/) | Prototype controls, sensors and small connected displays. | USB data cable, Arduino tools and voltage-compatible components. | [Arduino](https://docs.arduino.cc/hardware/uno-r4-wifi/) |
| [Espressif ESP32-S3-DevKitC-1 v1.1](http://127.0.0.1:54644/devices/esp32-s3-devkitc-1/) | Develop an ESP32-S3 application with exposed GPIO and USB. | USB data cable, matching module configuration and development tools. | [Espressif](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html) |
| [M5Stack Cardputer-Adv](http://127.0.0.1:54644/devices/m5stack-cardputer-adv/) | Build a handheld interface with a keyboard, screen and audio. | USB data cable and firmware for the functions you want. | [M5Stack](https://docs.m5stack.com/en/core/Cardputer-Adv) |
| [Seeed XIAO ESP32-S3](http://127.0.0.1:54644/devices/seeed-xiao-esp32s3/) | Fit Wi-Fi and Bluetooth control into a small custom board. | USB cable, antenna and the peripherals required by your firmware. | [Seeed Studio](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/) |
| [Saleae Logic 8](http://127.0.0.1:54644/devices/saleae-logic-8/) | Record and inspect digital buses from a host computer. | Supported host, Logic 2 software and correctly connected probes. | [Saleae](https://www.saleae.com/logic) |
| [Digilent Analog Discovery 3](http://127.0.0.1:54644/devices/digilent-analog-discovery-3/) | Add oscilloscope, waveform generation and logic tools to a laptop. | Supported host, WaveForms and the leads/adapters required for the measurement. | [Digilent](https://digilent.com/shop/analog-discovery-3/) |
| [Bus Pirate 5 Rev. 10](http://127.0.0.1:54644/devices/bus-pirate-5/) | Talk to chips over serial buses before writing a full application. | USB host with a terminal, probe leads and a compatible target circuit. | [Dangerous Prototypes](https://docs.buspirate.com/docs/hardware/bp5rev10/introduction/) |
| [GreatFET One](http://127.0.0.1:54644/devices/greatfet-one/) | Connect Python tools to digital buses, GPIO and custom USB experiments. | Host software, USB cable, test leads and any required neighbor board. | [Great Scott Gadgets](https://greatscottgadgets.com/greatfet/one/) |
| [PINECIL V2](http://127.0.0.1:54644/devices/pinecil-v2/) | Add a compact, firmware-controlled soldering iron to your workbench. | Suitable power supply and cable, soldering stand, solder and ventilation. | [PINE64](https://pine64.com/product/pinecil-smart-mini-portable-soldering-iron/) |

## Coverage still missing

This is a useful first expansion, not a complete market inventory. The next additions should complete actual setups:

1. Antennas, feedlines, adapters, filters and LNAs, with frequency, connector, impedance and power constraints.
2. Batteries, chargers, power supplies and solar power, with connector polarity, voltage and charging requirements.
3. Enclosures, mounting, cooling, storage and displays, with explicit board revisions and mechanical fit.
4. Test leads, probes and programmers, with voltage limits and supported protocols.
5. More field-tested combinations, with firmware versions, configuration, measurements and builder notes.

Add these around documented builds, then make their catalog records reusable. A shared “LoRa” tag is not proof of firmware, regional-band or electrical compatibility. The current setup editor records a parts selection; it does not automatically validate compatibility.

## Model distinctions retained

- T114 and RAK GPS/display options are not presented as base-board capabilities.
- T-Echo is distinct from T-Echo Plus; Wio Tracker L1 is the OLED model, not Lite/Pro/E-Ink.
- RTL-SDR Blog V4 is not the later V4L. Its driver requirements and receive-only role are explicit.
- Pico 2 W is the wireless microcontroller; Raspberry Pi 5 and Zero 2 W are Linux-capable computers.
- Cardputer-Adv, UNO R4 WiFi and base XIAO ESP32S3 are identified separately from similarly named variants.
- Saleae sample rates are not treated as usable analog bandwidth; AD3 flywire and BNC bandwidths differ.
- Pinecil is V2. Its power supply and cable are separate setup requirements.

## Image evidence

All 22 additions have unmodified maker/project images, with origin, credit, dimensions, retrieval date and checksum in `data/images.json`. HackRF source photos are preliminary and labeled accordingly. The Pinecil image shows the green-grip V2. The RAK image is one starter-kit configuration; it is not evidence that every package includes optional modules.
