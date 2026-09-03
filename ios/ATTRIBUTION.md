# Where this app came from

The Lilyshark iOS, macOS and watchOS app is built on **PommeCore**, a
companion app for MeshCore LoRa mesh radios.

**Original author: Michael P. Bedworth** (michael.bedworth@me.com)
**Project home: https://github.com/mbedworth/PommeCore**
Copyright 2026 Michael P. Bedworth. Licensed under Apache 2.0.

`LICENSE` and `NOTICE` in this directory are PommeCore's originals and stay
that way. Apache 2.0 asks that they travel with the code and that changes be
stated; both obligations are met here and neither is optional.

An earlier version of this file credited the app to the GitHub account this
tree was cloned through rather than to its author. That was wrong. The clone
was taken from a fork at `github.com/maxmoneycash/meshcore-ios`, whose own
commit describes itself as a "PommeCore (Apache 2.0) base with terminal
upgrades" — so the fork is a downstream of Mr Bedworth's work, and the
NOTICE file three directories up said so all along. Nobody checked it before
writing the credit.

## Why a native app at all

Apple does not permit Web Bluetooth, so lilyshark.com can never reach a
T-Deck from an iPhone. A native app is the only path onto the phone, and this
one already carries the parts that are slow to build and easy to get wrong:
background BLE, a USB transport, and separate iOS, macOS and watchOS targets.

## What Lilyshark changes

- Adds `Packages/MeshtasticKit`: a second protocol module beside MeshCoreKit.
  A Lilyshark deck advertises Meshtastic's client service rather than the
  Nordic UART service MeshCore uses, so reaching it takes a sibling module,
  not an edit to the existing one. Its wire format is not guesswork — the
  same bytes are implemented and tested in `src/core/meshtastic_api.cpp` on
  the firmware and `webapp/src/mesh/meshtasticProto.ts` in the browser, and
  MeshtasticKit's tests are ports of those vectors.
- Renames the product to Lilyshark and moves bundle identifiers off the
  upstream `com.meshcore.*` namespace. The MeshCore transport itself is
  untouched: this app can still talk to the radios it was written for.
