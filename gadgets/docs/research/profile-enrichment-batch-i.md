# Profile enrichment batch I — 2026-09-16

## Ready for review

The proposal is [profile-enrichment-batch-i-2026-09-16.json](../../data/profile-enrichment-batch-i-2026-09-16.json). It contains complete replacement detail profiles for five existing slugs. No shared catalog, application, generated output or browser state was changed.

| Profile | Rows before → proposed | Resources before → proposed | Main improvement |
| --- | ---: | ---: | --- |
| `interrupt` | 11 → 13 | 2 → 3 | Dated prototype evidence and explicit missing production information |
| `mesh-detect-v2` | 11 → 22 | 6 → 9 | Kit choice, firmware roles, pinned UART definitions, host and offline-map preparation |
| `bleshark-nano` | 12 → 27 | 1 → 7 | Charging, current/older setup, recovery, Shiver and host SDK requirements |
| `oui-spy` | 13 → 24 | 7 → 8 | Current firmware interfaces, installation and documented version conflicts |
| `radiacode-110` | 15 → 32 | 2 → 7 | Included cable, model-specific cases, host requirements and bootloader-dependent updates |
| **Total** | **62 → 118** | **18 → 34** | **56 additional practical rows** |

Every proposed row has its own source and review date. `coverage: "reviewed"` means documentation reviewed; all five explicitly have `testedByUs: false`. It does not imply that every manufacturer claim was independently measured, or that these profiles exhaust every firmware feature.

## Findings that affect setup or purchase

### Interrupt

The [April prototype update](https://blog.interrupt-tech.com/interrupt-project-update-4-3-26/) is useful dated evidence; it is not a September shipping confirmation. The [product page](https://www.interrupt-tech.com/) still advertises the proposed hardware and a preorder link. The profile stays deliberately short: no fabricated battery specification, distribution image, pinout, package inventory or delivery date.

### Mesh Detect v2

The [hardware listing](https://colonelpanic.tech/#products) distinguishes the finished product and bare PCB. The [flasher](https://colonelpanichacks.github.io/drone-mesh-mapper/flasher/) distinguishes a detector from a Home bridge; that role choice now appears before host setup.

There is a real pin-documentation conflict. The [pinned general README](https://github.com/colonelpanichacks/drone-mesh-mapper/blob/3373e4e83da30f34af321a27815d74bc543ff5e0/README.md) includes other mappings. Both reviewed S3 source files define TX5/RX6 at 115200:

- [Standard dual-core source](https://raw.githubusercontent.com/colonelpanichacks/drone-mesh-mapper/3373e4e83da30f34af321a27815d74bc543ff5e0/remoteid-mesh-dualcore/src/main.cpp)
- [Node dual-core source](https://raw.githubusercontent.com/colonelpanichacks/drone-mesh-mapper/3373e4e83da30f34af321a27815d74bc543ff5e0/node-mode-dualcore/src/main.cpp)

The proposal identifies those builds explicitly and keeps the conflict visible. It does not turn either mapping into universal v2 wiring instructions. Source commit: `3373e4e83da30f34af321a27815d74bc543ff5e0`.

### BLEShark Nano

[Charging instructions](https://docs.infishark.com/docs/basics/charging) require the side switch to remain on. [Setup instructions](https://docs.infishark.com/docs/basics/getting-started) distinguish the current on-device flow from earlier captive-portal units. [Recovery instructions](https://docs.infishark.com/docs/basics/updating) distinguish setup firmware from full OTA releases.

[Shiver documentation](https://docs.infishark.com/docs/shiver/overview) establishes a two-device minimum and shared-radio limitations; retail pack sizes do not define that minimum. The [SDK overview](https://docs.infishark.com/docs/sdk) supplies a 0.66-inch display reference and host prerequisites. The [v1.1.0 release notes](https://infishark.com/blogs/firmware-releases/v1-1-0-changelog) provide a dated feature baseline. No equivalence with another mesh protocol is asserted.

The former fixed black/clear color row was omitted because the currently rendered [product listing](https://infishark.com/products/bleshark-nano) did not substantiate both choices. This is not a claim that a clear edition never existed.

### OUI-SPY

The [current installer](https://colonelpanichacks.github.io/oui-spy-unified-blue/) and [pinned README](https://github.com/colonelpanichacks/oui-spy-unified-blue/blob/d57600044d5cbde5562587ccd4829441fec1cb53/README.md) expose documentation drift: mode count and capture transport differ from older descriptions. Installed-build confirmation remains necessary. Source commit: `d57600044d5cbde5562587ccd4829441fec1cb53`.

The proposal treats standard-board and wearable editions separately. It also scopes Sky Spy to the reviewed combined build, rather than importing every feature from a standalone project.

### Radiacode 110

The [110 product page](https://www.radiacode.com/products/radiacode-110) establishes SKU and accessories, while the [comparison table](https://www.radiacode.com/compare) keeps the 110 column separate from Zero/103/103G. The 500 mA value is relabeled as maximum wired consumption, matching that table.

[Phone connection documentation](https://radiacode.com/docs/en/100-series/devices/software-connectivity/app-connectivity), the [quick guide](https://radiacode.com/docs/en/100-series/quick-guide-manual), [Windows connection guidance](https://www.radiacode.com/knowledge/bluetooth-connection-requests-passcode?lang=en) and [firmware instructions](https://radiacode.com/docs/en/100-series/devices/using-the-device/firmware-update) add useful host and update distinctions. No readings were interpreted and no health guidance was added.

## Suggested core catalog corrections — not applied

| Field | Suggested correction | Evidence / reason |
| --- | --- | --- |
| BLEShark `specs.display` | `0.66″ monochrome OLED (developer docs) · resolution unconfirmed` | SDK overview above; retain the panel-resolution and exact-board caveats. |
| BLEShark `usage.needs` | `USB-C charging with the switch ON; Wi-Fi for setup and updates.` | Charging, setup and update documentation above. |
| BLEShark `usage.tradeoff` | `Some host features require Linux and current firmware.` | SDK requirements provide a more useful distinction than a now-resolved diagonal-size gap. |
| OUI-SPY `verificationNotes[1]` | `The shop and current installer describe different firmware generations. Confirm the installed build. Identifier matches do not prove device identity or operator.` | Preserve the existing interpretation caveat while removing the unconditional development-branch claim. |
| OUI-SPY `usage.needs` | `USB-C power; interface and host requirements depend on the selected mode.` | Some modes use a browser; others expose serial data or need the host dashboard. |
| OUI-SPY `usage.format` | `board` | The hardware listing describes a PCB-based tool; `computer` does not describe this form factor well. |
| Interrupt `usage.capabilities` | Review/remove `lf` until frequency-specific documentation exists. | “NFC/RFID” marketing alone does not establish LF support. Preserve the prototype caveat. |

No price, stock, delivery promise, affiliate link or measurement claim needs a date refresh as part of this proposal. Mesh Detect and Radiacode core summaries can stay as they are; their material refinements are in the detailed profiles.

## Review and validation method

- Reviewed official product pages, maker repositories, firmware source, manuals and support articles. No third-party reviews were used as factual support.
- Retained every existing resource URL. Five older standalone/alternative project resources keep their earlier `2026-09-15` review date; no facts newly depend on those unread pages. Current repository hubs, installers and all row sources are dated `2026-09-16`.
- Radiacode documentation exceeded the web reader's page-size limit. Read-only HTTPS fetches returned status 200 and the main documentation text was inspected. The two GitHub Pages installers also returned 200 through read-only fetch; no flasher was activated.
- Used short paraphrases and compact specification rows. Shared source budgets were counted across profiles, especially the single Colonel Panic shop page. Repeated repository/raw representations were treated as the same source for attribution budgeting.
- Pure `validateDeviceDetails` validation passes for these five catalog slugs. Additional checks cover exact source/resource membership, HTTPS URLs, unique resource URLs, row dates, preserved existing resources and explicit untested status. No main test suite, build, device interaction or browser session was run.

## Remaining boundaries

Firmware behavior, revision-specific hardware, range, battery life and retail package contents still require device or seller confirmation where marked. All proposed profiles retain explicit gaps. There were no applications, account actions, orders, messages to makers or publication steps.

## Root integration — 16 September 2026

Merged all five profiles and the seven suggested core corrections after review. Existing resource URLs and listing price/stock check dates are retained. Root independently checked BLEShark charging/SDK documentation and Interrupt’s current proposed specifications. Together with catalog expansion H, the live source data contains 73 profiles, 1,486 specification rows and 463 resource entries. These counts describe structured summaries, not exhaustive manuals or physical validation.
