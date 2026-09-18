# Reference-link follow-up — 2026-09-16

Scope: the **19** `needs-browser-check` entries in [reference-link-audit-2026-09-16.json](reference-link-audit-2026-09-16.json). No catalog/profile data changed.

## Outcome

- **1 reachable application entry point requiring sign-in:** CircuitBlocks.
- **18 explicit Cloudflare challenge responses:** all returned HTTP 403 with `cf-mitigated: challenge`, server `cloudflare`, and a challenge-page title.
- Of those 18, the research web tool retrieved substantial primary content for **13**, partial campaign content for **3**, and an indexed primary campaign result for **1**. The remaining **1** is the Printables enclosure, whose destination content is still unconfirmed.
- **0 links proven missing; 0 exact-equivalent replacement URLs recommended.** A challenge response does not establish that a resource exists or is missing behind the challenge.

This explains the audit failures without turning them into blanket success. Browser access, application operation, downloads and hardware workflows were not tested.

## Method and evidence

A fresh, unauthenticated Python `requests` HTTPS GET checked every questioned URL. Redirects were followed, TLS verification remained enabled, and only a short initial response chunk was examined for the title/content type. The batch completed **2026-09-16 at 08:40:01 UTC**. No vendor installer or firmware was executed, and no browser, login or account creation was used.

For the 18 Cloudflare responses, the observed status/header/title combination was consistent:

```text
HTTP 403
server: cloudflare
cf-mitigated: challenge
content-type: text/html; charset=UTF-8
title: Just a moment...
```

The independent research web tool supplied page text or indexed content where noted below. Such retrieval can use a cached representation; it is evidence of the resource's identity/content, not proof that an ordinary browser can bypass a challenge today. Original HTTP audit results should remain historical observations.

## Per-link decisions

“CF403” below means the explicit response pattern above, not a inferred 404.

| # | Questioned official link | Follow-up evidence | Decision |
| --- | --- | --- | --- |
| 1 | [CircuitBlocks](https://code.circuitmess.com/) | GET follows 307 → 302 → 302 to CircuitMess login; final 200 HTML titled “Log in &#124; CircuitBlocks”. A second request with redirects disabled reconfirmed the initial 307 to `/api/auth/login?returnTo=%2F`. | Keep. Label sign-in required. Editor and device support remain untested. |
| 2 | [Analog Discovery 3 product](https://digilent.com/shop/analog-discovery-3/) | CF403 locally; research retrieval returned the exact product page, product identity and specifications. | Keep; crawler restriction, with substantive primary content available. |
| 3 | [Analog Discovery 3 datasheet](https://files.digilent.com/datasheets/Analog-Discovery-3-Datasheet.pdf) | CF403 HTML locally; research retrieval parsed the exact 26-page PDF. | Keep. Do not mistake the challenge HTML for a downloaded PDF. |
| 4 | [UNO R4 WiFi espflash recovery](https://support.arduino.cc/hc/en-us/articles/16379769332892-Restore-the-USB-connectivity-firmware-on-UNO-R4-WiFi-with-espflash) | CF403 locally; full matching Arduino Help Center article readable through research retrieval. | Keep. No replacement required. |
| 5 | [Arduino wireless boards](https://support.arduino.cc/hc/en-us/articles/4407129094546-Boards-and-shields-with-wireless-connectivity) | CF403 locally; full matching article, including UNO R4 WiFi entries, readable. | Keep. No replacement required. |
| 6 | [UNO R4 WiFi connectivity updater](https://support.arduino.cc/hc/en-us/articles/9670986058780-Update-the-connectivity-module-firmware-on-UNO-R4-WiFi) | CF403 locally; full matching updater article readable. | Keep. No replacement required. |
| 7 | [MAKERphone 2.0 campaign](https://www.kickstarter.com/projects/albertgajsak/makerphone-20-an-educational-diy-mobile-phone) | CF403 locally; research tool returned matching title and campaign navigation, without the complete campaign body. | Keep as original creator campaign; full campaign content still needs browser review if relied upon. |
| 8 | [CyperPRO campaign](https://www.kickstarter.com/projects/cyperdvice/cyperpro-gameboy-for-hackers-and-hardware-enthusiast) | CF403 locally; direct research open timed out. Search of the exact primary URL returned a matching Cyper Device campaign title and metadata. | Keep for identity/history. Current technical claims and delivery status remain unconfirmed. |
| 9 | [TICKEY campaign](https://www.kickstarter.com/projects/enilinx/ticket-refresh-it-new-clip-it-on-carry-your-moment) | CF403 locally; research tool returned matching TICKEY title and navigation, without the complete campaign body. | Keep. The historical `ticket-` slug is not evidence of a typo; it resolves to TICKEY metadata. |
| 10 | [CardputerZero campaign](https://www.kickstarter.com/projects/m5stack/cardputerzero) | CF403 locally; research retrieval returned M5Stack creator identity, campaign heading and campaign metadata. | Keep; full campaign body and fulfillment are not verified by this link check. |
| 11 | [Nordic nRF52840](https://www.nordicsemi.com/Products/nRF52840) | CF403 locally; matching Nordic product page text readable. | Keep. No replacement required. |
| 12 | [SLIM Signal Sleuth printable case](https://www.printables.com/model/1003074-slim-signal-sleuth-case) | CF403 locally; direct research open failed. Maker product page still publishes this exact URL, also confirmed in its 200 HTML response. | Keep as maker-linked, with destination/files still unverified. Prioritize normal browser check. |
| 13 | [Raspberry Pi getting started](https://www.raspberrypi.com/documentation/computers/getting-started.html) | CF403 locally; full matching documentation readable. | Keep. No replacement required. |
| 14 | [Raspberry Pi computer hardware](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html) | CF403 locally; full matching hardware reference readable. | Keep. No replacement required. |
| 15 | [Pico C/C++ SDK](https://www.raspberrypi.com/documentation/microcontrollers/c_sdk.html) | CF403 locally; matching SDK documentation readable. | Keep. No replacement required. |
| 16 | [Pico MicroPython](https://www.raspberrypi.com/documentation/microcontrollers/micropython.html) | CF403 locally; matching MicroPython documentation readable. | Keep. No replacement required. |
| 17 | [Pico-series boards](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html) | CF403 locally; matching Pico-board documentation readable. | Keep. No replacement required. |
| 18 | [Raspberry Pi 5 product](https://www.raspberrypi.com/products/raspberry-pi-5/) | CF403 locally; exact product page readable. | Keep. No replacement required. |
| 19 | [Raspberry Pi Zero 2 W product](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/) | CF403 locally; exact product page readable. | Keep. No replacement required. |

## CircuitBlocks: do not replace the stable URL

The final login destination contains transient OAuth state. The catalog should retain [code.circuitmess.com](https://code.circuitmess.com/), not a copied `login.circuitmess.com/u/login?state=…` URL.

Two official references corroborate the intended entry point:

- [CircuitMess Connect setup](https://circuitmess.com/connect-app) explicitly directs users to CircuitBlocks and tells them to log in.
- [CircuitMess's desktop release page](https://github.com/CircuitMess/CircuitBlocks/releases) adds a deprecation notice and points users to the web version.

Suggested resource label: **“CircuitBlocks web editor — sign-in required.”** This finding establishes the login entry point only. It does not establish successful compilation, connected-device detection, restoration or support for every listed hardware revision.

The original fetch failure may have been transient or related to its redirect chain; the precise cause is unknown. It is not supported to call the domain retired or the service operational end-to-end.

## Printables and campaign limits

The [463n7 SLIM kit page](https://463n7.io/products/slim-signal-sleuth-kit) publishes the exact Printables URL. That establishes maker attribution, not successful file access or physical fit. The general SignalSleuth GitHub CAD directory is not a proven equivalent of this specific SLIM enclosure, so it is not a substitute link.

For Kickstarter pages, identity or indexed metadata does not verify present stock, fulfillment, refunds, hardware specifications or downloadable files. Preserve the existing CyperPRO research limitations. No allegation from third-party discussion was used as evidence.

## Suggested audit handling

If the audit schema is extended later, use separate outcomes for `challenge-response`, `reachable-sign-in`, `content-retrieved` and `content-unconfirmed`. Keep raw HTTP status and method alongside the interpretation. Do not silently rewrite historical 403 observations to HTTP 200.

For the current data, retain all 19 original URLs. A reviewer can annotate the documented authentication requirement and crawler restrictions; the printable enclosure and complete campaign bodies remain the most useful normal-browser follow-ups.

