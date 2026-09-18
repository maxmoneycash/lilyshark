# Seven additions that make the catalog more useful

Research date: **2026-09-16**. Compared against the current **67 entries** and the existing [creator](creator-marketing-2026-09-16.md), [affiliate](affiliate-partnerships-2026-09-16.md) and [revenue](../strategy/revenue-plan-2026-09-16.md) research.

## Recommendation

Add **NanoRFE NanoVNA V2 Plus4 Pro, Seeed reTerminal E1001 and DFRobot HUSKYLENS 2** first. They fill three different practical gaps: measuring an RF build, making a useful display, and teaching a device to recognize a builder’s own objects. Each has a documented result worth saving alongside the parts.

The remaining candidates extend portable setups and debugging. This is an editorial ranking, not measured demand. The commercial angles below are hypotheses; no company or creator has agreed to participate.

The catalog already offers several SDRs, many mesh nodes and Wi-Fi tools, MCU boards and bench instruments. It currently has no VNA, dedicated programmable dashboard display, self-contained vision sensor, KVM console adapter, travel router, dedicated high-speed USB analyzer or USB–CAN adapter. Those gaps matter more than adding another regional variant of an existing radio.

## Ranked shortlist

### 1. NanoRFE NanoVNA V2 Plus4 Pro — source-ready

**Exact selection:** NanoRFE’s **V2 Plus4 Pro** order, including its stated calibration kit and cables. Keep other NanoVNA sellers/models outside this entry. A current order form exists; checkout stock and shipping were not tested. [Maker store](https://www.nanorfe.com/shop)

**Distinct value:** The current SDR entries receive or generate signals; this instrument characterizes an antenna or RF network. The Pro adds adjustable measurement bandwidth. [Model documentation](https://nanorfe.com/nanovna-v2.html)

**One build:** A creator documents their own passive mesh antenna: physical dimensions, cable/adapter, calibration reference plane and before/after return-loss sweep. The maker’s antenna guide supplies the measurement workflow and computer-export path. This is a proposed application of that workflow, not an antenna we tested. [Antenna guide](https://nanorfe.com/nanovna-antenna-tuning-swr.html)

**Creator/company angle:** Offer an antenna designer a reusable measurement record to accompany the build. An antenna seller could fund the documented example; a creator gains evidence others can reproduce. Do not promise improved radio range from impedance measurements alone. No NanoRFE affiliate arrangement was found or assumed.

**Blockers:** Store and detailed table use different upper frequency limits. The proposal keeps the conservative store summary and exposes the difference. Confirm battery/package details and actual measurement accuracy before any tested-build claim. Media permission remains outstanding.

### 2. Seeed reTerminal E1001 — source-ready

**Exact selection:** **SKU 100073581**, E1001 monochrome, not the color or larger E-series models. The store displayed in-stock text at review; fulfillment is unverified. [Official product](https://www.seeedstudio.com/reTerminal-E1001-p-6534.html)

**Distinct value:** A finished, programmable e-paper dashboard is a different outcome from a radio’s small status screen or a bare XIAO board. [Specification sheet](https://files.seeedstudio.com/wiki/reterminal_e10xx/res/reTerminal_E_Series_ePaper_Display.pdf)

**One build:** A workshop weather/status display using the maker’s E1001 ESPHome example and an existing Home Assistant host. Share the actual YAML, entity mapping, firmware versions and refresh choices. The host and weather integration are prerequisites. [Official display cookbook](https://wiki.seeedstudio.com/reterminal_e10xx_esphome/)

**Creator/company angle:** “Use my dashboard” is immediately visible and gives builders something original to publish. Seeed is already a researched commercial prospect; a companion could preserve its own Firmware Hub and point viewers toward a creator’s configuration. The paid work is documenting and presenting a real configuration, not recreating the existing generator.

**Blockers:** Confirm model-specific configuration and battery behavior under the chosen refresh policy. Avoid claiming the microphone has a finished voice feature. Original screenshots/configurations are preferable to assuming rights to product imagery. [Setup and feature limits](https://wiki.seeedstudio.com/getting_started_with_reterminal_e1001/)

### 3. DFRobot Gravity HUSKYLENS 2 — source-ready

**Exact selection:** **SEN0638**, standard camera package; optional wireless and alternate lenses remain separate. A live purchase page exists; checkout stock and delivery were not established. [Official product](https://www.dfrobot.com/product-2995.html)

**Distinct value:** The catalog has general-purpose controllers but no dedicated vision module with a local interface and reusable learned models. [Maker documentation](https://wiki.dfrobot.com/sen0638/)

**One build:** A bench object identifier trained on the builder’s own distinct parts or tools. Start with stationary objects and controlled lighting; record misses as well as successes. The documented classifier exports paired model/configuration files that another HUSKYLENS 2 can import. No robot actuator is necessary for the first demonstration. [Classifier and export guide](https://wiki.dfrobot.com/sen0638/docs/22617)

**Creator/company angle:** A creator can share their original training result, mounting arrangement and example objects, then invite others to improve it. DFRobot is an existing prospect with a project community. A paid application note is plausible; neither its payment nor this model’s accuracy has been validated.

**Blockers:** Recognition confidence is not measured accuracy. Reproduce the exact object/lighting/firmware combination. Controller integration needs the correct power-board wiring, and a generic Arduino example does not establish compatibility with the catalog’s UNO R4. [Power-board guide](https://wiki.dfrobot.com/sen0638/docs/22601)

### 4. Openterface Mini-KVM Toolkit — next enrichment

**Exact selection:** **392-OPMINIKVMTOOLKIT**. Keep the basic unit and newer KVM-GO distinct. The official datasheet itemizes the toolkit cables and bag; capture output is limited to 1080p30 despite accepting higher input resolution. [Maker datasheet](https://docs.openterface.com/products/minikvm/datasheet/)

**Distinct value / build:** Turn a laptop into a local console for the catalog’s Raspberry Pi 5 or a headless mini-PC. A reproducible field kit specifies the host application, HDMI adapter and power/cabling instead of assuming the laptop’s USB-C port is a display input. This fills the missing maintenance step in portable computer builds.

**Creator/company angle:** TechxArtisan could fund a compact “recover this exact headless setup” companion. Mini-rack and field-kit creators have a useful reason to show their complete cable layout. The existing Jeff Geerling prospect is a later fit to assess, not an endorsement or presumed customer.

**Evidence / blockers:** The maker’s campaign displayed toolkit stock at review. Validate host OS/application, BIOS interaction and adapter behavior before a tested guide; datasheet wording around one host/target port warrants checking against the connection guide. [Maker campaign and ordering](https://www.crowdsupply.com/techxartisan/openterface-mini-kvm)

### 5. Great Scott Gadgets Cynthion — next enrichment

**Exact selection:** **Cynthion with aluminum enclosure**, as distinguished from the bare-board purchase option. Confirm the shipped PCB revision before committing a firmware-specific build. Both options appeared in stock on the maker’s campaign. [Ordering variants](https://www.crowdsupply.com/great-scott-gadgets/cynthion)

**Distinct value / build:** Record USB enumeration and exchanges from a builder’s own custom keyboard/controller while debugging its firmware. Dedicated low/full/high-speed USB analysis adds a workflow beyond the existing GreatFET and logic analyzer. The maker documents Packetry analysis and LUNA/Facedancer development paths. [Official product and repositories](https://greatscottgadgets.com/cynthion/)

**Creator/company angle:** A keyboard or USB-gadget maker publishes the minimal firmware and annotated capture that explain a real fix. Great Scott Gadgets is already present through several products, so this can become a coherent bench setup rather than another isolated device card.

**Blockers:** Scope stays with documented USB 2.0 speeds; do not borrow SuperSpeed claims from the separate LUNA SuperSpeed project. Confirm required cables, host support and capture/replay workflow. Technical production may exceed the simple $750 page scope unless a maker supplies an existing working demo.

### 6. GL.iNet Beryl AX — next enrichment

**Exact selection:** **GL-MT3000**, with the power-adapter plug appropriate to the buyer. Do not merge it with Beryl 7 or the older GL-MT1300. The current product page documents Wi-Fi 6, Ethernet and USB connectivity. [Official product](https://www.gl-inet.com/products/gl-mt3000/)

**Distinct value / build:** One portable LAN for a Pi and other workbench devices, with a chosen Ethernet, Wi-Fi-repeater or phone-tethering uplink. The maker documents these connection paths. A shared setup should state the actual uplink, firmware and power supply, with private configuration removed. [Device setup guide](https://docs.gl-inet.com/router/en/4/user_guide/gl-mt3000/)

**Creator/company angle:** Travel-workstation and mini-rack builders can share a complete working network topology. A small manufacturer’s demo kit could use it too. GL.iNet’s product page already features creator reviews, so our useful offer is the exact reproducible setup that accompanies a video.

**Blockers:** Region/plug stock and shipping were not checked. Vendor firmware and upstream OpenWrt instructions must remain separate. Phone tethering and captive-portal behavior require testing; advertised VPN speeds are not a build guarantee. No affiliate terms were researched for this merchant.

### 7. Openlight Labs CANable 2.0 — open project; hold purchase-led addition

**Exact selection:** Openlight Labs **CANable 2.0**, USB-C screw-terminal board. The maker calls its CAN-FD implementation beta and its store currently says sold out. [Official product and project links](https://openlightlabs.com/products/canable-2-0)

**Distinct value / build:** Observe a builder-owned robot’s CAN bench network and publish the wiring, termination, bit rate and a small message-decoding example. Existing Bus Pirate/GreatFET listings do not document this ready-made USB–CAN workflow.

**Creator/company angle:** A robotics creator could share a compact diagnostic setup and their own message definitions. Openlight Labs is a named small-maker prospect, but the immediate value is open project documentation and owner utility; sales conversion must wait for supply confirmation.

**Blockers:** Maker stock is unavailable, CAN-FD support is explicitly beta, and the main project site timed out during review. Confirm maintained firmware, exact hardware revision and software support before a full profile. Do not redirect buyers to an unverified clone as if it were the same SKU.

## Why these, and what to leave out

- **No additional mesh-node variants:** The present catalog already gives builders multiple phone-connected, keyboard, solar/modular and GNSS choices. Add a distinct job before another RAM/band variant.
- **CANtact Pro is excluded from the immediate list:** its maker campaign says “No Longer Available.” An old campaign price and impressive specification do not establish a current purchase path. [Campaign](https://www.crowdsupply.com/linklayer-labs/cantact-pro)
- **Another generic ESP32 development board is lower priority:** its value must exceed the existing Espressif, XIAO, Pico and Arduino entries. Revision-heavy multimedia boards merit a specific documented project first.
- **No eight-slot target to fill:** seven defensible candidates are enough. Six have a current product/order path; the seventh is clearly an open-project watchlist item.

## Proposal JSON and integration

[catalog-expansion-proposal-2026-09-16.json](../../data/catalog-expansion-proposal-2026-09-16.json) is a staging envelope with:

- `catalog`: three objects using the current catalog schema and existing category/task/format values.
- `profiles`: matching complete profile objects keyed by slug, with dated rows and direct citations.

The records are **source-ready**, not publication approval. Independently verified fields mean checked against maker/project documentation; they do not mean laboratory validation or maker endorsement. `price` is deliberately `null`; stock is not encoded as a guarantee. Exact known facts, proposed uses and unresolved requirements are separated in profile rows, usage text and gaps.

Validation passed against the 67-entry catalog: three unique new slugs, valid existing taxonomy values, three matching profiles, **47 dated rows**, 14 distinct cited resource URLs and every citation present in its profile’s resources. The largest row-text attribution to one source is 88 words; catalog copy and this report were also kept concise. No application build or browser session was run.

Before integration, root should recheck slug uniqueness against the latest catalog, review the unresolved field notes and select an image treatment with established rights. No photos were downloaded or copied. A source link does not grant media reuse permission. Additions can use an original placeholder while image permissions remain open.

## Commercial implication

The shareable unit should be an artifact the builder owns: **an RF measurement record, a dashboard configuration, a trained model, a complete cable layout or a debugging example**. The hardware catalog makes those artifacts understandable and purchasable. A maker-funded page can package an already working example for the maker’s existing audience; demand, payment, technical review and media rights still need confirmation.

Start with one of the three ready candidates and one existing creator demonstration. Keep the documented $750 pilot scope: source organization and presentation using approved material. Physical validation, custom firmware and original filming need a separate agreed scope. No outreach, application, purchase or publication occurred in this research.

## Root integration checkpoint

The first three candidates and the three batch-H devices are now merged: 73 catalog entries, including the separate LilyShark concept. Six original product images were added with captions and unresolved commercial-use status. The first three also have sourced build-finder records; none is claimed as physically reproduced. NanoRFE’s processor field explicitly remains unspecified. Current automated route/data checks pass; narrow Arc checks confirm the first three images, device routes and guide handoffs, plus an actual Cynthion carousel-card click and specification search.
