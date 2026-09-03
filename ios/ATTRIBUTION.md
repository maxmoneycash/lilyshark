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

## Changes made to the original (Apache 2.0, section 4(b))

Files under `ios/` have been modified from upstream's originals. The change so far
is a rebrand: PommeCore's code, renamed and recoloured. Nothing about how it talks
to a radio was touched.

**The name shown to a user is now Lilyshark.** `CFBundleDisplayName` and
`CFBundleName` on the iOS, macOS and watchOS apps; the widget and complication
display names; every `PommeCore` in the thirteen source strings and their
translations in `Shared/Localizable.xcstrings`, and in `Shared/InfoPlist.xcstrings`;
the app name sent to the radio in `MeshCoreProtocol.buildAppStart`; and the
`User-Agent` on link previews.

**Every reverse-DNS identifier moved to Lilyshark's namespace.** `com.mbedworth.meshcore`
became `com.lilyshark.app`, and with it the watch app, both extensions, the App Group
`group.com.lilyshark.app`, the CloudKit container `iCloud.com.lilyshark.app`, the
Keychain services, the Spotlight domain, the tip-jar product IDs, the BLE restore
identifier and the dispatch-queue labels in `Packages/MeshCoreKit`. These are one set:
if the App Group in an `.entitlements` file and the one in `PommeCore Widgets/WidgetState.swift`
ever disagree, the widget reads an empty container and the app fails to launch on a
signed build, so they are changed together or not at all.

**The tint colour is Lily Pink.** `MeshTheme.accent` in `Shared/App/Theme.swift` and
the `AccentColor` colorsets in both extensions now carry `#FF4F9D` on dark grounds
and `#C00068` — the same hue, deep enough to read as small type — on light ones, which
is the split `webapp/src/mesh/theme.ts` already made for the brand. No screen was
redesigned; only the accent changed hue.

**About now credits upstream.** `Shared/Views/SettingsView+Editors.swift` gained a
"Built on PommeCore" link to https://github.com/mbedworth/PommeCore and a "Licence"
row that shows `NOTICE` and the full Apache 2.0 text. Those two files are Copy Bundle
Resources on all three app targets, so the licence ships inside the app rather than as
a second copy pasted into Swift.

What deliberately did **not** change:

- `LICENSE`, `NOTICE`, and the `Copyright © 2026 Michael Bedworth` in
  `NSHumanReadableCopyright`. Apache 2.0 requires them and they are upstream's.
- Xcode target names, `PRODUCT_NAME`, and the `PommeCore*` Swift type names and file
  headers. The built products stay `PommeCore.app` and `PommeCore Watch.app` because
  the project's product references and embed-extension build phases resolve by those
  literal names; renaming them buys nothing a user can see and breaks the build.
- The `meshcore://` URL scheme. It is MeshCore's contact- and channel-sharing format,
  shared with other clients — renaming it would make our QR codes unreadable to them.
- The "PommeCore repository" line in `Shared/Models/RadioPreset.swift` and the preset
  feed URL in `Shared/Services/RegionalPresetService.swift`. Community presets really
  are fetched from upstream's repository, so that text is a fact, not a leftover.

`Packages/MeshCoreKit` speaks MeshCore over the Nordic UART service. A
Lilyshark deck advertises Meshtastic's client service instead, so reaching it
takes a sibling protocol module rather than a change to this one. The wire
format for that module is not guesswork: it is implemented and byte-tested on
both sides already, in `src/core/meshtastic_api.cpp` on the firmware and
`webapp/src/mesh/meshtasticProto.ts` in the browser.
