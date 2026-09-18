# Catalog expansion H: console, USB analysis and portable networking

Reviewed **2026-09-16**. Proposal: [three catalog entries and full profiles](../../data/catalog-expansion-proposal-h-2026-09-16.json). These are independent source reviews, without hands-on testing, maker endorsement or a commercial relationship. Price stays `null`; `listed` means a maker listing exists.

## What to add

| Entry | Exact scope | Useful setup outcome |
| --- | --- | --- |
| `openterface-mini-kvm-toolkit` | Toolkit **392-OPMINIKVMTOOLKIT** | A laptop becomes the nearby console for a headless machine. |
| `great-scott-gadgets-cynthion` | **Cynthion with aluminum enclosure**, production design **r1.4.0** documented; shipping revision unconfirmed | Inspect enumeration and transfers while debugging your own USB device. |
| `gl-inet-beryl-ax-gl-mt3000` | **Beryl AX GL-MT3000**, country-specific power converter | Put a portable lab on one Wi-Fi/Ethernet network. |

These fill different workflow gaps. They should sit beside the existing computers, controllers and instruments without adding a new taxonomy. Mini-KVM and Cynthion use `instruments / computer / build`; Beryl uses `wifi / handheld / wifi + build`. Existing `wifi5` means **5 GHz Wi-Fi**, so it applies to Beryl AX despite its Wi-Fi **6** generation.

## 1. Mini-KVM: specify both sides of the cable

The toolkit includes the short HDMI cable, short target USB cable and long host USB cable with their adapters. The connection guide assigns orange to host and black to target. This resolves an apparent datasheet error calling both USB-C connections “host.” The profile follows the dedicated guide. [Datasheet](https://docs.openterface.com/products/minikvm/datasheet/), [connection guide](https://docs.openterface.com/products/minikvm/how-to-connect/)

Keep **input resolution and capture resolution separate**. A 4K input does not produce a 4K captured picture. The target also needs its own suitable power; the FAQ specifically discourages powering a Raspberry Pi through Mini-KVM. Software USB switching requires hardware **v1.9+**, and older BIOS hub support is not universal. [Hardware FAQ](https://docs.openterface.com/products/minikvm/faq/)

The host download page lists macOS, Windows, Linux and Android. It points to QT **0.5.30**, while the releases page also contains **0.5.31 marked prerelease** at review. These are app versions, not proof of the capture firmware installed in a purchased unit. The FAQ's firmware recovery link goes to QT releases; no exact recovery binary was verified. [App downloads](https://docs.openterface.com/app/kvm/), [QT releases](https://github.com/TechxArtisanStudio/Openterface_QT/releases)

**Unresolved:** shipped PCB/capture-firmware revision, iPad host prerequisites, target-specific HDMI adapters and BIOS behavior. The newer KVM-GO stays outside this entry.

**Build-sharing hypothesis:** a small-rack creator supplies the exact host OS/app version and cable layout for recovering their headless setup. A concise companion would save viewers from buying the wrong adapter. No creator has committed to this.

## 2. Cynthion: revision and USB topology matter

The enclosed purchase option is separate from the bare board. Hardware release **r1.4.0** is explicitly labeled the initial production release; the storefront does not pin a shipping revision. The host tools expose the actual hardware identifier. [Ordering variants](https://www.crowdsupply.com/great-scott-gadgets/cynthion), [r1.4.0 release](https://github.com/greatscottgadgets/cynthion-hardware/releases/tag/r1.4.0), [installation guide](https://cynthion.readthedocs.io/en/latest/getting_started.html)

The maker's shipping update says cables are excluded. The worked keyboard example needs connections from CONTROL to the Packetry host and TARGET C to the target host, then TARGET A to the device. When one computer fills both host roles, the tutorial requires different USB hubs. Start capture before connecting the target so enumeration is recorded. [Cable statement](https://www.crowdsupply.com/great-scott-gadgets/cynthion/updates/cynthion-is-at-mouser), [worked tutorial](https://cynthion.readthedocs.io/en/latest/tutorials/usb_analysis.html)

The profile distinguishes Cynthion's **5 V device supply** from the documented target pass-through limits. It also carries the cable-length and expansion-voltage limits. No power-delivery experiment was performed. [Electrical requirements](https://cynthion.readthedocs.io/en/latest/support/safety_information.html)

**Unresolved:** actual PCB/firmware version, host USB topology and capture results. Packetry's current quickstart and the keyboard tutorial differ in whether they describe manual speed selection; follow the installed UI. Cynthion remains a USB 2.0 instrument; LUNA's broader capabilities do not establish SuperSpeed support on this board. [Packetry setup](https://packetry.readthedocs.io/en/latest/quick_start.html), [maker's scope explanation](https://greatscottgadgets.com/2023/02-15-renaming-luna-hardware-to-cynthion/)

**Build-sharing hypothesis:** a keyboard maker publishes the firmware revision and a small annotated capture explaining one real bug. The initial paid page could organize an existing capture; producing the hardware diagnosis would need its own scope.

## 3. Beryl AX: a network needs an upstream connection

The proposal keeps the two Ethernet speeds distinct and specifies **USB-C 5 V / 3 A**. It does not infer alternate USB-PD voltages. Package contents and the country-dependent converter are recorded separately. [Specifications](https://www.gl-inet.com/products/gl-mt3000/), [model guide](https://docs.gl-inet.com/router/en/4/user_guide/gl-mt3000/)

Phone tethering and cellular modems remain setup-dependent. The firmware resource is the **MT3000** selector, but its dynamic page did not expose a current stable version in this review. Do not substitute instructions for older Beryl, Beryl 7 or upstream OpenWrt. [Model guide](https://docs.gl-inet.com/router/en/4/user_guide/gl-mt3000/), [firmware selector](https://dl.gl-inet.com/router/mt3000)

**Unresolved:** region/plug availability, firmware version, phone/modem compatibility and measured performance. Hotspot Login Mode can suspend services and change DNS during authentication; a guide should not imply uninterrupted VPN coverage. [Hotspot guide](https://docs.gl-inet.com/router/en/4/faq/connect_to_a_hotspot_with_captive_portal/)

**Build-sharing hypothesis:** publish a small network diagram and a sanitized configuration checklist for a portable Pi/workbench setup. Keep secrets out of any shared configuration. This is an editorial direction, not a tested network.

## Original media: research links only

No images were downloaded or added to the asset manifest.

| Maker | Located original material | Publication status |
| --- | --- | --- |
| TechxArtisan | Repository documentation includes [v1.9 PCB imagery](https://github.com/TechxArtisanStudio/Openterface_Mini-KVM_Hardware/blob/main/docs/pcb_v1-9.jpg) and a [setup photo](https://github.com/TechxArtisanStudio/Openterface_Mini-KVM_Hardware/blob/main/docs/use-case-pc-angled-view.jpg). The [repository README](https://github.com/TechxArtisanStudio/Openterface_Mini-KVM_Hardware) declares documentation CC BY-SA 4.0. | Promising licensed-documentation route. Record the exact asset, revision, creator/source, license and modifications before publication. This does not establish rights to every storefront photo. |
| Great Scott Gadgets | [Product page](https://greatscottgadgets.com/cynthion/) and [maker campaign](https://www.crowdsupply.com/great-scott-gadgets/cynthion) show enclosed hardware. [Hardware design files](https://github.com/greatscottgadgets/cynthion-hardware) use CERN-OHL-P-2.0. | No explicit product-photo grant found. Hardware-design licensing does not clear unrelated photos. Use an original commissioned photo or obtain an asset-specific permission. |
| GL.iNet | Product page links this [Beryl AX media kit](https://www.dropbox.com/scl/fo/va471id8gkec69vk7s10b/AF3rTAxEcbsdXc2-HUwCkxI?rlkey=pegrchp3eixm2o1vxru88fb2m&dl=0). | Folder terms were not readable. [Website terms, section 3](https://www.gl-inet.com/en-gb/policies/terms-of-service) require a commercial license; public availability alone is insufficient. Request an exact grant before commercial reuse. |

Separate outreach consideration: GSG says it does not accept LLM-assisted contributions, and its Free Stuff application instructions exclude generated application content. This catalog is independent editorial work. Do not forward generated research as an upstream contribution or application. [Contribution policy](https://www.greatscottgadgets.com/tags/policy/), [application instructions](https://www.greatscottgadgets.com/2025/12-01-how-to-apply-for-the-great-scott-gadgets-free-stuff-program/)

## Integration and checks

Only the new proposal and this report were written. The first expansion proposal remains intact; existing catalog/profile files were not edited.

Each row has its own directly supporting resource and review date. Every profile preserves explicit unknowns; `coverage: reviewed` does not mean complete or physically tested. Core price remains unknown even where a store displayed prices or stock. There are no copied product descriptions, imported photos, affiliate links or endorsement claims.

Validation passed against the current **70-entry** catalog: **3** unique candidates would produce **73** entries; **3** matching profiles contain **59** dated rows, **28** resource links and **22** cited sources. Every row source and catalog source/extra-source appears in its profile resources. All category, status, task, format and capability values match the current taxonomy. The largest row-only source summary is **92 words**, with headroom retained for catalog/report references. No main build or browser session was run.

## Root integration — 16 September 2026

Merged three entries and their profiles into the local 73-entry catalog. The Mini-KVM processor field now explicitly says its processor was not specified in the reviewed datasheet; function is not presented as a chip identity. Original single-device images from the maker pages/campaign are copied locally with verified hashes and captions. Root visually inspected all three; accessories and actual PCB revisions are not inferred from appearance. Their commercial reuse remains unresolved.
