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
| An iOS 18+ simulator runtime | Both `Packages/MeshCoreKit/Package.swift` and `Packages/MeshtasticKit/Package.swift` set floors of iOS 18 / macOS 15 / watchOS 11. An older runtime fails package resolution before any source compiles. | `xcrun simctl list runtimes` |

`scripts/build_ios.sh` checks all four before it starts and names the fix for each, because
every one of them otherwise surfaces as an unrelated-looking error thousands of log lines in.

There are no third-party dependencies to install. `MeshCoreKit` and `MeshtasticKit` are local
Swift packages under `Packages/`, resolved from disk, so the build needs no network access.

One dependency is *not* local and is not vendored: `PommeCoreWatchKit`, a private upstream
package. The iOS and macOS builds guard every use of it behind `canImport` and are unaffected.
The watch targets do not, which is why they cannot be built at all — see below.

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

`--scheme` refuses the two watch schemes up front and points at this file, because otherwise
they fail with an error about destinations or asset catalogs that has nothing to do with the
actual cause.

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

# MeshtasticKit unit tests -- 21 tests, 0 failures
cd ios/Packages/MeshtasticKit && swift test
```

`./scripts/build_ios.sh --scheme PommeCore-macOS` will not work for the macOS app: the script
pins an iOS Simulator destination. Use the `xcodebuild` line above.

The two watch targets are the exception. They have never compiled here, and the section below
explains exactly why and what a human would have to do about it.

## The watch target cannot be built from this checkout

`PommeCore-watchOS` and `PommeCore Watch ComplicationsExtension` have never produced a binary
on this machine. There are **two independent blockers**, and installing the thing the error
message asks for only clears the first one.

### Blocker 1: no watchOS simulator runtime (fixable by a download)

`xcodebuild` refuses before it compiles anything:

```
$ xcodebuild -project ios/PommeCore.xcodeproj -scheme PommeCore-watchOS -showdestinations
	Ineligible destinations for the "PommeCore-watchOS" scheme:
		{ platform:watchOS, id:dvtdevice-DVTiOSDevicePlaceholder-watchos:placeholder,
		  name:Any watchOS Device,
		  error:watchOS 26.5 is not installed. Please download and install the platform
		  from Xcode > Settings > Components. }
```

The message is misleading in a way worth writing down, because it costs an hour otherwise.
**The watchOS SDKs are already installed.** Both of these exist on disk and `xcodebuild` lists
them:

```
$ xcodebuild -showsdks
watchOS SDKs:
	watchOS 26.5                  	-sdk watchos26.5
watchOS Simulator SDKs:
	Simulator - watchOS 26.5      	-sdk watchsimulator26.5
```

What is missing is the *simulator runtime*, which is a separate download from the SDK:

```
$ xcrun simctl list runtimes
== Runtimes ==
iOS 26.5 (26.5 - 23F77) - com.apple.CoreSimulator.SimRuntime.iOS-26-5
```

Only iOS. No watchOS entry. That absence is what makes the platform read as "not installed",
and it blocks the build in two separate places: the destination resolver above, and `actool`.
Even a device-SDK build (`-sdk watchos`, so `actool` runs with `--platform watchos`) dies on
the asset catalog:

```
PommeCore Watch Complications/Assets.xcassets: error: No available simulator runtimes for
platform watchsimulator. SimServiceContext supportedRuntimes=[SimRuntime : iOS 26.5 ...]
** BUILD FAILED **
```

That failure arrives before a single Swift file is compiled — the build log contains zero
`SwiftCompile` and zero `Ld` steps.

**What a human must install:** the watchOS platform support, via Xcode > Settings > Components,
or `xcodebuild -downloadPlatform watchOS`. It is a multi-gigabyte download and cannot be done
from this repository or by any script in it.

### Blocker 2: PommeCoreWatchKit is not in this repository (not fixable by a download)

This is the one that actually matters, and it survives installing the runtime.

Both watch targets depend on `PommeCoreWatchKit`, **a private upstream package that was never
vendored into Lilyshark.** The repository already says so, at `Shared/PhoneWatchRelay.swift:450`:

> `// PommeCoreWatchKit is a private package; without it the watch relay is a`
> `// no-op so the iPhone app builds and runs standalone.`

The iOS side degrades cleanly because every use of it sits behind `canImport`. The watch side
does not. `Shared/App/PommeCoreApp.swift` imports it conditionally at line 21:

```swift
#if (os(watchOS) || os(iOS)) && canImport(PommeCoreWatchKit)
import PommeCoreWatchKit
#endif
```

but then *uses* it unconditionally under a plain `#if os(watchOS)` at lines 27-31 and 59-72.
So on watchOS, with the package absent, the symbols are simply unresolved. This is provable
without any simulator runtime at all, by typechecking the watch app's three sources directly
against the watchOS SDK. Run the two `swift build --triple` commands from *What is verified for
watchOS* below first — they are what create the two `-I` module directories:

```bash
xcrun swiftc -typecheck -target arm64-apple-watchos11.0 \
  -sdk "$(xcrun --sdk watchos --show-sdk-path)" -swift-version 5 \
  -I ios/Packages/MeshtasticKit/.build/arm64-apple-watchos/debug/Modules \
  -I ios/Packages/MeshCoreKit/.build/arm64-apple-watchos/debug/Modules \
  ios/Shared/App/PommeCoreApp.swift ios/Shared/App/Theme.swift ios/Shared/PhoneWatchRelay.swift
```

It emits exactly six errors, all of the same kind, and nothing else is wrong:

```
error: cannot find 'WatchReceiver' in scope
error: cannot find 'WatchContactStore' in scope
error: cannot find 'WatchMessageStore' in scope
error: cannot find 'WatchAppState' in scope
error: cannot find 'WatchRootView' in scope
error: cannot find 'WatchWidgetState' in scope
```

None of those six types is defined anywhere in this repository:

```bash
grep -rnE '(struct|class|enum|actor|typealias) (WatchReceiver|WatchContactStore|WatchMessageStore|WatchAppState|WatchRootView|WatchWidgetState)\b' --include='*.swift' .
# no matches
```

The complications extension is worse: `PommeCore Watch Complications/PommeCoreComplications.swift:11`
does a bare, unguarded `import PommeCoreWatchKit`, so it fails at the import itself
(`error: no such module 'PommeCoreWatchKit'`) and uses `WatchWidgetState` in seven places.

**What a human must do:** obtain `PommeCoreWatchKit` from upstream and vendor it under
`ios/Packages/`, or write replacements for those six types. Neither is a build-configuration
change, and no amount of `xcodebuild` flags will work around it. Until then the watch targets
are dead code that the iOS and macOS builds correctly never touch.

### What *is* verified for watchOS

The shared packages both compile for watchOS today. This is real, and it is the useful part:
whatever else is wrong, the mesh code the watch app would link is not the problem.

```bash
# MeshtasticKit for watchOS -- Build complete! (3.03s)
cd ios/Packages/MeshtasticKit && swift build --triple arm64-apple-watchos11 \
  --sdk /Applications/Xcode.app/Contents/Developer/Platforms/WatchOS.platform/Developer/SDKs/WatchOS26.5.sdk

# MeshCoreKit for watchOS -- Build complete! (5.76s)
cd ios/Packages/MeshCoreKit && swift build --triple arm64-apple-watchos11 \
  --sdk /Applications/Xcode.app/Contents/Developer/Platforms/WatchOS.platform/Developer/SDKs/WatchOS26.5.sdk
```

`--sdk` is not optional there. `swift build --triple` alone keeps the macOS sysroot and fails
with `error: unable to load standard library for target 'arm64-apple-watchos11.0'` under a
`warning: using sysroot for 'MacOSX' but targeting 'Watch'`, which looks like a toolchain fault
and is not one.

Clean up after yourself, or check `git status` before committing: `Packages/MeshtasticKit`
ignores its own `.build/`, but **`Packages/MeshCoreKit` does not**, so the second command above
leaves an untracked `Packages/MeshCoreKit/.build/` that a `git add -A` would happily commit.
`ios/.gitignore` says `build/`, which does not match `.build/`.

Summary of the watch state, so nobody re-derives it:

| Thing | State |
|---|---|
| watchOS device + simulator SDKs | Installed |
| watchOS simulator runtime | **Missing** — needs `xcodebuild -downloadPlatform watchOS` |
| `MeshtasticKit` for watchOS | Compiles |
| `MeshCoreKit` for watchOS | Compiles |
| Watch app Swift sources | Fail on 6 symbols from an absent private package |
| Complications extension | Fails at `import PommeCoreWatchKit` |
| `PommeCore-watchOS` binary | **Never produced, and cannot be from this checkout** |

## Continuous integration

`.github/workflows/build.yml` has an `ios` job that runs `./scripts/build_ios.sh` and
`swift test` for MeshtasticKit on a `macos-15` runner.

It is scoped that narrowly on purpose. GitHub bills GitHub-hosted macOS minutes at **10x** the
Linux rate, so on a private repository this one job drains the included allowance ten times
faster than the four `ubuntu-24.04` jobs beside it. On a public repository it is free. The job
does not build the macOS target and does not attempt the watch targets, which cannot be built
anywhere for the reasons above.

Nothing in the release path depends on it: `publish-alpha` still gates on the firmware jobs
only. A broken app build cannot block a firmware release, and a green firmware release does not
imply the app compiles.

Two honest caveats:

- **The job has never run.** It is validated only statically — `actionlint` 1.7.7 reports no
  findings, and the YAML parses with the expected job and step structure — but GitHub Actions
  cannot be exercised locally. Treat its first run on a real push as the actual test.
- **The runner's toolchain is not the one this file was verified on.** Everything here was
  verified on Xcode 26.6 with the iOS 26.5 runtime; the `macos-15` image ships a different
  Xcode. The project needs Xcode 16 or newer to open at all (`objectVersion = 77`, and it uses
  `fileSystemSynchronizedGroups`), and both packages declare `swift-tools-version: 6.0` with
  iOS 18 / macOS 15 / watchOS 11 floors, so `macos-15` should satisfy the floors — but "should"
  is the correct word until it runs. The job's first step prints `sw_vers`, `xcodebuild
  -version`, and `xcrun simctl list runtimes` so that a CI-only failure can be diagnosed
  against the toolchain that actually produced it.

## Building from a clean clone

`scripts/build_ios.sh` was re-confirmed against a fresh `git clone` — a real clone into a temp
directory, not the working tree — after the two merge waves that landed MeshtasticKit. Twice:
once on the merge tip before this file changed, and again on the commit that introduced it.

```
==> Building scheme 'PommeCore' for the iOS Simulator
** BUILD SUCCEEDED **
app: .../cleanclone2/ios/DerivedData/Build/Products/Debug-iphonesimulator/PommeCore.app
```

Exit 0 both times; 86.8 s and 66.6 s wall clock for the clone-cold builds. In the same clean
clone, `MeshtasticKit` ran 21 tests and `MeshCoreKit` 32 tests, both with 0 failures. The
resulting `PommeCore.app` is a real bundle (`Assets.car`, localized `.lproj` directories, audio
resources), not an empty directory. No network access and no Apple account were needed.

Those two commands, in that order, are exactly what the CI job runs.

## Signing: what needs a human

**The simulator build needs no signing at all.** It passes `CODE_SIGNING_ALLOWED=NO`, and
simulator apps are never signed with a real identity. Nothing in this document requires an
Apple account.

**A build for a physical iPhone does, and cannot be automated here.** It needs:

- An Apple Developer account and its **Team ID**, set as `DEVELOPMENT_TEAM`. There is no team
  ID in this repository and none should be committed.
- **Bundle identifiers registered to that team.** Every target now ships `com.lilyshark.app`
  (and `com.lilyshark.app.watchos`, plus the two extension suffixes). Those identifiers are
  ours to claim, but nobody has registered them with Apple yet, so no device or TestFlight
  build can be signed until someone does.
- **Provisioning profiles** for the app and both extensions, with the App Group
  `group.com.lilyshark.app` and the iCloud container `iCloud.com.lilyshark.app` from
  `iOS/PommeCore.entitlements` and the extensions' `.entitlements` files provisioned to match.
  Entitlements are the usual reason a device build fails after the simulator build has been
  green for weeks.

`ios/build-and-distribute.sh` and the `ExportOptions-AppStore-*.plist` files are upstream's
distribution path. Their bundle identifiers and profile names moved to Lilyshark's with
everything else, but `teamID` in them is still upstream's `7R925EW7AT` and the profiles they
name do not exist yet. Treat them as unverified: nothing in them has been run or checked here.

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
