# Where this app came from

The Lilyshark iOS, macOS and watchOS app is built on **PommeCore**, a
MeshCore client by maxmoneycash, vendored from
https://github.com/maxmoneycash/meshcore-ios at commit
`MeshCore iOS app: PommeCore (Apache 2.0) base with terminal upgrades`
(2026-07-29) and licensed under Apache 2.0. `LICENSE` and `NOTICE` are its
originals and stay that way.

It was chosen over a web wrapper for a reason that is not preference: Apple
does not permit Web Bluetooth, so lilyshark.com can never reach a T-Deck from
an iPhone. A native app is the only path onto the phone at all, and this one
already carries the parts that are slow to build and easy to get wrong --
background BLE, a USB transport, and separate iOS/macOS/watchOS targets.

`Packages/MeshCoreKit` speaks MeshCore over the Nordic UART service. A
Lilyshark deck advertises Meshtastic's client service instead, so reaching it
takes a sibling protocol module rather than a change to this one. The wire
format for that module is not guesswork: it is implemented and byte-tested on
both sides already, in `src/core/meshtastic_api.cpp` on the firmware and
`webapp/src/mesh/meshtasticProto.ts` in the browser.
