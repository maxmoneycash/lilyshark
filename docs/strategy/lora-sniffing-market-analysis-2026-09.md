LoRa packet inspection, Meshtastic/MeshCore decryption, and Lilyshark demand

Research date: September 13, 2026. This is desk research using protocol documentation, project repositories, product pages, and the existing Lilyshark strategy. Competitor capabilities below are documented claims, not independently tested implementations. Listed prices are observations, not evidence of sales. Buyer priorities and commercial recommendations are hypotheses; no customer interviews or sales data were available.

**Assessment: public-channel decoding has little differentiation. The whitepaper proposes an RF observation-data business, but does not establish demand for Lilyshark's LoRa captures. A diagnostic instrument is a separate, unvalidated hypothesis.**

**Correction after reviewing the whitepaper**

The initial version of this memo evaluated packet inspection and recommended a diagnostic workflow without first reconciling that recommendation with the [whitepaper](../../webapp/public/lilyshark-whitepaper.pdf). That omitted the original thesis. The diagnostic positioning and study below remain possible experiments, not a supported decision to change the business.

The paper's recommendation is specific:

- Page 2 favors verified RF observation, starting with GNSS interference, and explicitly declines a consumer-facing device business.
- Pages 7 and 9 argue that receiving public signals can produce a valuable data service. The proposed sale is a regional interference picture: location, time, waveform, strength, and potentially emitter position. The value would come from the measurements and their geographic coverage, not access to private message content.
- Page 25 specifies MERIDIAN, a GNSS interference and spectrum-observation network. Its receiver requirements include per-satellite signal quality, AGC trends, spectrum snapshots, and carrier-phase measurements. These are different inputs from captured LoRa frames.
- Page 27 proposes company-funded sensor deployment and a conventional data subscription before token emissions. It does not propose funding a capture network before establishing a paying customer.

This explains the intended answer to "why sniff public radio?": a public transmission does not already provide a buyer with a dependable record of how it was received across a region over time. The paper uses aircraft and satellite observation networks as precedents. Those precedents do not establish demand for a dataset of Meshtastic or MeshCore packets, however. The specific measured phenomenon and the buyer's use for it still matter.

The repository acknowledges this distinction in [the MERIDIAN gap](../meridian-gap.md): it deliberately does not implement the GNSS receiver, observation pipeline, ephemeris checks, geographic reward cells, or interference data product. Instead, [Field Receipts](../protocol/field-receipts.md) applies a corroboration concept to LoRa captures. Adopting that concept does not transfer the GNSS business case to LoRa. Nor does agreement between signed packet records, by itself, establish independent physical reception: record integrity, observer independence, and measurement authenticity are separate claims.

The paper also exceeds its evidence in places. Page 7's assertion that the observation tier needs no demand thesis does not follow from successful businesses in other observation markets. Page 10 explicitly identifies contract values and penetration as assumptions underlying its $26 million annual revenue scenario; those are not customer commitments. Page 52 retains the earlier $40–120 million estimate that page 10 retracts. These figures should not be presented as a validated Lilyshark market size.

The resulting decision is narrower than the initial recommendation: the paper does not validate a LoRa decryption business or a paid diagnostic instrument, and it does not justify automatically switching the project to GNSS. A commercial case for the current project still needs to connect a particular observation it can actually produce, credible verification of that observation, and a buyer's decision that benefits from it. The hardware, subscription, and contribution-reward proposals should not be treated as established consequences of the whitepaper.

The user's objection is commercially sound: someone who only wants to read the default public chat can already do that with an ordinary compatible radio and its app. A packet inspector must justify the extra device, setup, or subscription by answering a question the existing workflow leaves unresolved. Public availability does not eliminate the value of measurement, but it does eliminate privileged access to the message content as a durable advantage.

**What is actually public**

Receiving an RF signal, decoding its protocol, possessing its decryption key, and finding its contents on an internet dashboard are separate conditions. A receiver must be in range and listening with compatible radio settings. A public dashboard contains only traffic its contributors delivered to it. LoRa is the radio modulation; the protocol above it determines confidentiality.

| Traffic | What a listener can ordinarily read | Meaning for a decryption product |
| --- | --- | --- |
| Meshtastic default public channel | Payload using the published default key, plus outer headers | Existing clients already provide access; decoding is a baseline feature |
| Meshtastic private channel with a random PSK | Outer header and receive metadata; payload requires the PSK | Importing the owner's key is useful for analysis, but provides no special access |
| Meshtastic modern PKC direct messages | Exposed metadata; message content requires the appropriate private-key material | The public channel key alone does not decrypt them |
| MeshCore default Public channel | Payload using its published shared key | Baseline compatibility |
| MeshCore hashtag channels | Payload if the name is known or guessed, because the key is derived from it | Name-based lookup can reveal apparently obscure channels; this does not recover arbitrary random keys |
| MeshCore private channels and direct messages | Exposed protocol fields; protected content requires the appropriate secret/key material | Capture alone does not establish plaintext access |
| LoRaWAN application messages | Some protocol information and receiver measurements; application payload is encrypted | Industrial LoRaWAN is a separate customer segment from public mesh chat |

Meshtastic documents the known default key and distinguishes channel encryption from PKC DMs. Its firmware security model identifies X25519 and AES-CCM for modern DMs. Older firmware and failed/missing key exchange need separate treatment; "DM" alone is not a sufficient security classification. [Encryption overview](https://meshtastic.org/docs/overview/encryption/), [firmware security model](https://github.com/meshtastic/firmware/security).

MeshCore's companion specification explicitly distinguishes Public, hashtag, and private channels. Its payload specification places direct-message content inside ciphertext while exposing other packet fields. LoRaWAN also encrypts application data; the TTN material linked here describes the 1.0 key model. [MeshCore channel types](https://github.com/meshcore-dev/MeshCore/blob/main/docs/companion_protocol.md#channel-management), [MeshCore payloads](https://github.com/meshcore-dev/MeshCore/blob/main/docs/payloads.md), [LoRaWAN security](https://www.thethingsnetwork.org/docs/lorawan/security/).

There are real implementation exceptions. Meshtastic's June 2025 advisory describes duplicated or low-entropy device keys and interception of affected DMs using known compromised keys. It lists 2.6.11 as patched. This supports a version-specific exposure audit, not a promise that all current private messages can be recovered. [Original advisory, CVE-2025-52464](https://github.com/meshtastic/firmware/security/advisories/GHSA-gq7v-jr8c-mfr7).

MeshCore's current encryption utility uses AES block encryption in ECB mode and a truncated HMAC. These construction choices deserve security review; they do not by themselves demonstrate general plaintext recovery from arbitrary private traffic. A market claim about "breaking encryption" would require a specific reproducible result, affected versions, and explicit prerequisites. [MeshCore encryption implementation](https://github.com/meshcore-dev/MeshCore/blob/main/src/Utils.cpp).

**Why anyone would capture traffic they can already read**

For a radio hobbyist, discovering nearby activity, watching propagation, learning a protocol, and examining packets are legitimate ends in themselves. This can support an enthusiast instrument or an educational project. It does not establish frequent use or subscription demand.

For an operator or developer, the relevant questions are more concrete:

- Did this test transmission reach the receiver at the intended site, and with what signal margin?
- Did a configuration or antenna change improve results under comparable conditions?
- Which observed transmissions account for airtime, and how much repetition is present?
- What did receivers at two different sites hear during the same incident?
- Does a firmware change emit the expected bytes, packet type, and timing?
- Is an intended private channel actually using a public or name-derived key?

Message text usually cannot answer those questions. A useful capture retains the relevant bytes, timing, receiver settings, signal measurements, and origin of each observation. However, existing tools already expose much of this. "The normal app hides packets" is too broad: MeshCore's app can export its Rx Log, and third-party monitors consume raw radio events. The opportunity is reducing the effort and uncertainty of the complete diagnostic task. [MeshCore Rx Log export and Wireshark conversion](https://github.com/aaronb/wireshark-meshcore).

**The current competitive baseline**

| Existing option | Documented capability | Commercial implication for Lilyshark |
| --- | --- | --- |
| Ordinary Meshtastic/MeshCore radio and app | Public chat and node interaction; MeshCore Rx Log export | The strongest substitute for a curious casual user is the device they already own |
| [MeshSense](https://github.com/Affirmatech/MeshSense) | Open-source Meshtastic monitoring, maps, signal reports, and traceroutes | A node map and signal history are already available without buying a dedicated analyzer |
| [MeshMonitor](https://meshmonitor.org/features/multi-source.html) | Multiple Meshtastic and MeshCore sources in one deployment | Supporting both protocols is already competitive baseline in desktop/server monitoring |
| [MeshMonitor Packet Monitor](https://meshmonitor.org/features/packet-monitor.html) | Meshtastic packet inspection and MeshCore OTA frames, relay chain, signal metrics, hex | Raw packet views are also available through ordinary connected radios |
| [MeshMonitor automation](https://meshmonitor.org/features/automation-engine) | Telemetry triggers, heartbeat-loss/recovery, source events, geofences | Generic alerts alone are insufficient justification for a paid tier |
| [CoreScope](https://github.com/Kpa-clawbot/CoreScope/) | Open-source MQTT packet analyzer, maps, replay, channel decryption, observer tracing, node analytics | Direct competition for the proposed rich web analyzer and correlation features |
| [MeshCore Wireshark dissector](https://github.com/aaronb/wireshark-meshcore) | Packet trees, filters, radio metadata, JSON-to-PCAPNG conversion | Byte inspection and interoperable export are established workflows |
| [MeshMapper](https://meshmapper.net/) and its [coverage API](https://wiki.meshmapper.net/coverage-api/) | Regional coverage maps fed by observers; API with radio-configuration filters | A community coverage map and data feed are not an empty market |
| [Colorado Mesh-Client](https://github.com/Colorado-Mesh/mesh-client) | Meshtastic, MeshCore, and Reticulum in one app; history and routing/RF diagnostics | Even three-protocol support and diagnostic positioning have alternatives |
| [CatSniffer V3](https://electroniccats.com/store/catsniffer-v3/) | USB multiprotocol IoT sniffer including LoRa, with Wireshark integration | A dedicated sniffer hardware category exists, but competes on breadth and integration |

CoreScope advertises channel decryption with a rainbow table. Read this alongside MeshCore's name-derived public-channel design; the advertisement is not evidence of arbitrary private-key recovery. Separately, MeshMonitor's PKI DM decryption feature uses private keys from the operator's own nodes to combine messages received through different sources. It is a practical example of decryption as a workflow feature. [CoreScope](https://github.com/Kpa-clawbot/CoreScope/), [MeshMonitor PKI decryption](https://meshmonitor.org/features/pki-dm-decryption.html).

CatSniffer's own tools also advertise live and offline Meshtastic decoding and a chat interface. Public-channel reading is available in specialist capture products as well as ordinary mesh clients. [CatSniffer tools releases](https://github.com/ElectronicCats/CatSniffer-Tools/releases).

**Who might pay, and what remains unproven**

The following ranking is an assessment of fit and buying motivation, not measured willingness to pay.

| Potential buyer | Recurring problem | Plausible purchase | Assessment |
| --- | --- | --- | --- |
| Casual mesh user | Read nearby chat, discover neighbors | Convenient gadget or small one-time purchase | Low subscription fit; ordinary apps are strong substitutes |
| Community repeater maintainer | Check a new site, compare changes, investigate failed links | Portable instrument or occasional survey assistance | Best initial field-use hypothesis; many maintainers have hobby budgets |
| Firmware developer or hardware vendor | Reproduce defects and reduce support time | Capture/replay tooling, integration, support, tested hardware | Stronger economic rationale, probably a smaller customer count |
| Event or field-communications organizer | Verify planned locations and hand over a useful report | Survey kit, rental, or service | Plausible episodic demand; actual budgets need validation |
| Security researcher or training provider | Demonstrate exposure and test protocol behavior | Instrument, lab kit, or workshop | Real technical use, but broad tools such as CatSniffer compete |
| LoRaWAN installer | Validate sensor-to-gateway connectivity | Field tester and deployment report | Established adjacent product category, with different protocol/backend requirements |

Observed commercial offers give a price context:

- MeshCore's FAQ lists a **$10 per-device T-Deck unlock** for deeper map zoom and remote server administration. That is a price for specific optional features, not evidence of demand for a monthly packet-inspection service. [Official FAQ](https://docs.meshcore.io/faq/).
- CatSniffer V3 lists **$136 sale / $150 regular**, and was marked **out of stock** when checked. It covers multiple IoT protocols and requires a host computer. [Manufacturer store](https://electroniccats.com/store/catsniffer-v3/).
- RAK lists the **RAK10701-Plus at $139**, alongside a **$69–$89** LoRa/LoRaWAN signal meter. These are adjacent field-testing offers, not direct proof that mesh hobbyists will pay the same. [RAK signal testers](https://store.rakwireless.com/collections/lorawan-signal-tester).
- Adeunis describes field-testing measurements for uplinks/downlinks and geolocated results. Its product confirms the relevance of installation validation as a job; no sales volume was established. [Adeunis field testing](https://www.adeunis.com/test-reseau-iot/).

The clearest scale signal found here is MeshCore's own April 4, 2026 report of **30,000 mapped nodes**. This is historical, voluntarily mapped infrastructure/device data, not a September installed-base estimate, count of distinct people, or number of prospective analyzer buyers. This research does not establish a defensible paid-market size. [MeshCore map article](https://blog.meshcore.io/2026/04/04/meshcore-map).

Do not multiply a global LoRa device count by a subscription price. Industrial sensors, gateways, individual hobbyists, community maintainers, and organizational purchasing accounts are different units. The useful early market size is the number of reachable operators with repeated unsolved incidents and an actual budget.

**What the existing Lilyshark strategy overstates**

The [Q3 direction memo](2026-q3-direction.md) and [premium-tier proposal](premium-tier.md) contain hypotheses worth testing, but several statements outrun their evidence:

1. The map article cited for "38,000+ mapped nodes and 100k+ app users" states 30,000 mapped nodes and does not establish the cited app-user count. Those figures need separate sources before reuse.
2. A low one-time firmware price does not validate the proposed $9/month or $49/month subscription. The buyer, purchase frequency, and perceived outcome differ.
3. Multi-protocol operation, history, maps, alerts, and correlation face meaningful existing alternatives. They need competitive task comparisons before being described as unique advantages.
4. Contributors supplying captures do not demonstrate customers buying those captures. Feed rewards can increase costs without establishing demand.
5. RF coverage data is useful only with adequate receiver placement, radio profiles, calibration/context, observation windows, and a buyer's specific decision. Random captures do not automatically create a commercially useful regional dataset.
6. A cryptographic hash can establish that a file's bytes have not changed relative to a known hash. It cannot establish that the original capture was authentic. Storage provenance and radio-observation validity require separate evidence.

The earlier strategy files have not been rewritten by this research. These are identified corrections and objections for the next strategy decision.

**The credible product hypothesis and its limits**

A candidate promise is: **"Take Lilyshark to a site, compare what the radios hear, and bring back an evidence-backed explanation of the result."** The likely buyer is a person installing, maintaining, or developing a mesh. Default-channel decryption makes the inspector usable; the sale depends on the diagnostic result and ease of obtaining it.

Start by demonstrating one of two workflows: a repeatable site/antenna comparison, or a two-receiver investigation of a delivery problem. Keep original observations attached to every conclusion. Separate directly observed facts, protocol-derived facts, and hypotheses. Build integrations with existing capture and observer tooling so evaluation does not require replacing someone's entire setup.

The hardware imposes a crucial limit. Lilyshark's documented SX1262 path listens on one receive profile at a time, and spectrum sweeps pause reception. An absent packet can reflect the observer's location, tuning, or receive gap. One observer generally cannot prove a remote hop failed, calculate an exact network-wide loss rate, or establish that a quiet location lacks coverage. Delivery-rate claims need a known transmitted test count and an appropriate receiving endpoint; broader diagnosis often needs multiple observers. [Project capture and scan description](../../README.md#radio-capture-and-spectrum-scanning).

The repository also contains documentation drift: [what-you-can-see.md](../what-you-can-see.md) says the product never transmits and has no key management, while the current README and [channel-key-security.md](../channel-key-security.md) describe messaging and stored keys. Product positioning needs a versioned capability matrix before sales claims are made. This research did not execute hardware tests or reconcile those implementations.

**A concrete validation test before expanding the paid product**

Run a small operator study with a proposed cohort of five community maintainers, four developers/vendors, and three field/event operators. These counts are study-design choices, not statistical market estimates. Ask each to reconstruct their most recent real failure or deployment decision: what happened, which tools they used, time spent, and what remained unresolved. Avoid asking whether a hypothetical analyzer "sounds useful."

Compare Lilyshark against each person's current app plus their preferred free tools on that exact task. Record setup time, time to a correct conclusion, whether the conclusion was independently confirmed, and whether they choose it again for another task. A documented radio profile mismatch or antenna comparison is a better early test than promising automatic diagnosis of an entire mesh.

Suggested continuation criteria: at least five participants voluntarily reuse it for a second real task; at least three independent buyers make a paid pilot or hardware commitment at a price covering the actual cost of delivery; and the diagnostic benefit is observable against their existing workflow. These thresholds are management choices, not industry benchmarks. Free contributor access should be tracked separately from paying conversions.

If participants enjoy the packet feed but cannot name a repeated problem it solves, keep the project scoped as a hobby/education instrument and reassess the subscription plan. If a narrow workflow repeatedly saves support or field time, focus the commercial offering on that workflow before adding more dashboards, incentivized capture supply, or speculative data products.
