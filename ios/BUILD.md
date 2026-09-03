# Building the iOS app

The vendored PommeCore app (see `ATTRIBUTION.md`) builds for the iOS Simulator with no
Apple developer account, no team ID, and no signing certificate. One command does it:

```bash
./scripts/build_ios.sh        # from the repository root
```

That is the whole happy path. Everything below explains what it needs, what it does, and
where a human still has to step in.

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| macOS | Xcode is macOS-only. There is no Linux or CI-container path for this build. | `uname -s` → `Darwin` |
| Xcode 16 or newer, full install | The Command Line Tools alone cannot build an app target. | `xcodebuild -version` |
| `xcode-select` pointing at Xcode | Fails far downstream, and obscurely, if it points at the CLT. | `xcode-select -p` → `/Applications/Xcode.app/Contents/Developer` |
| An iOS 18+ simulator runtime | `Packages/MeshCoreKit/Package.swift` sets floors of iOS 18 / macOS 15 / watchOS 11. An older runtime fails package resolution before any source compiles. | `xcrun simctl list runtimes` |

`scripts/build_ios.sh` checks all four before it starts and names the fix for each, because
every one of them otherwise surfaces as an unrelated-looking error thousands of log lines in.

There are no third-party dependencies to install. `MeshCoreKit` is a local Swift package under
`Packages/`, resolved from disk, so the build needs no network access.

Verified on: Apple M1 Max, 10 cores, macOS 26.6 (25G5065a), Xcode 26.6 (17F113),
iOS 26.5 simulator runtime.

## Expected duration

| Build | Time |
|---|---|
| Clean (`--clean`, empty DerivedData) | ~60 seconds |
| Incremental (no source changes) | ~3 seconds |

Measured on the machine above. A first-ever build on a cold machine will be slower, since
Xcode also resolves the package graph and builds the module cache.

## What the script does

```bash
xcodebuild \
    -project ios/PommeCore.xcodeproj \
    -scheme PommeCore \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath ios/DerivedData \
    -configuration Debug \
    CODE_SIGNING_ALLOWED=NO \
    build
```

`generic/platform=iOS Simulator` builds for the simulator as a platform rather than for one
named device, so the build does not depend on which simulators happen to be installed and
never boots one.

Output lands at `ios/DerivedData/Build/Products/Debug-iphonesimulator/PommeCore.app`, and the
full log at `ios/DerivedData/build_ios.log`. `ios/.gitignore` already excludes `DerivedData/`.

Options: `--clean` wipes DerivedData first, `--scheme NAME` builds something other than
`PommeCore`. The script exits non-zero and prints the deduplicated `error:` lines plus the last
40 log lines on any failure. It also treats "xcodebuild exited 0 but produced no `.app`" as a
failure, which is the shape a broken build phase takes.

## Other things that build

The committed `PommeCore.xcodeproj` carries five targets: `PommeCore`, `PommeCore-macOS`,
`PommeCore-watchOS`, `PommeCore WidgetsExtension`, and `PommeCore Watch ComplicationsExtension`.

Verified working beyond the iOS simulator app:

```bash
# macOS app -- BUILD SUCCEEDED, unsigned
xcodebuild -project ios/PommeCore.xcodeproj -scheme PommeCore-macOS \
  -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build

# MeshCoreKit unit tests -- 32 tests, 0 failures
cd ios/Packages/MeshCoreKit && swift test
```

`./scripts/build_ios.sh --scheme PommeCore-macOS` will not work for the macOS app: the script
pins an iOS Simulator destination. Use the `xcodebuild` line above.

## Signing: what needs a human

**The simulator build needs no signing at all.** It passes `CODE_SIGNING_ALLOWED=NO`, and
simulator apps are never signed with a real identity. Nothing in this document requires an
Apple account.

**A build for a physical iPhone does, and cannot be automated here.** It needs:

- An Apple Developer account and its **Team ID**, set as `DEVELOPMENT_TEAM`. There is no team
  ID in this repository and none should be committed.
- **A different bundle identifier.** Every target ships upstream's `com.meshcore.app` (and
  `com.meshcore.app.watchos`), which belongs to PommeCore's author. You cannot sign or upload
  under it. Lilyshark needs its own prefix before any device or TestFlight build.
- **Provisioning profiles** for the app and both extensions, with the App Group and iCloud
  entitlements in `iOS/PommeCore.entitlements` and the extensions' `.entitlements` files
  provisioned to match. Entitlements are the usual reason a device build fails after the
  simulator build has been green for weeks.

`ios/build-and-distribute.sh` and the `ExportOptions-AppStore-*.plist` files are upstream's
distribution path and still carry upstream's identifiers. Treat them as unverified: nothing in
them has been run or checked here.

## Do not run `xcodegen`

`ios/project.yml` exists but **is not how this app is built**, despite appearances.
`xcodegen generate` overwrites the committed `PommeCore.xcodeproj` in place, and the project it
writes has only three targets — the Widgets and Watch Complications extensions and the
entitlements wiring are silently gone. Upstream never used XcodeGen: neither `README.md`,
`CONTRIBUTING.md`, nor any script in `ios/scripts/` mentions it.

The spec has been corrected so that it at least validates and produces something that compiles
(as vendored it referenced a `watchOS/Views` directory that does not exist, declared deployment
targets below MeshCoreKit's floors, and omitted a source file the app target needs). A spec that
cannot generate at all is worse than one that generates a known-reduced project. But the
committed `.xcodeproj` is canonical, and regenerating is a lossy, destructive operation.

## Known issues in the vendored tree

Both are upstream's, unmodified here, and neither blocks the build:

- `README.md` documents `xcodebuild test -scheme MeshCoreKit -destination 'platform=iOS
  Simulator,name=iPhone 16'`. That fails with *"Scheme MeshCoreKit is not currently configured
  for the test action."* Use `swift test` from `Packages/MeshCoreKit` instead.
- `README.md` and `LICENSE` say Apache 2.0; `CONTRIBUTING.md` says contributions are GPL-3.0.
  `NOTICE` and `ATTRIBUTION.md` both treat the app as Apache 2.0. Worth resolving before
  Lilyshark accepts outside contributions to this tree.
