# Native analyzer QA — September 14, 2026

Argent is working in the resumed Codex session. A native iPhone walkthrough
found and fixed three UI problems: a missing Spectrum Clear button, unnamed
traffic filter menus, and truncated Radio tool rows at accessibility text sizes.
Changes remain local and uncommitted.

## Fixes

- `SpectrumAnalyzerView`: use a toolbar item group for Pause / Next sweep and
  Clear so both actions appear.
- `TrafficAnalyzerView`: show each filter's label, put labels above menus at
  accessibility text sizes, and avoid repeating the label in accessibility
  descriptions.
- `ToolsView`: allow tool titles and descriptions to wrap at accessibility
  sizes; omit decorative symbols and chevrons there to give the text room.

## Device and data

The completed walkthrough used iPhone 17e, iOS 26.5, 390 × 844 points,
`9DF35957-E4CC-4D69-AC93-3D0CEE0DF7A0`. Initial setup also used iPhone 17
`B365CF55-6DAC-4513-995F-853C1884D68F`; screen changes outside this task prompted
moving to the separate 17e simulator.

The test app uses the isolated bundle ID `com.lilyshark.analyzerqa`. The real
`com.lilyshark.app` installation and radio pairing were not uninstalled or reset.
All capture fixtures are synthetic. This report does not establish RF reception.

## Observed results

| Check | Result |
| --- | --- |
| Import repository sample through Files | 24 of 24 frames; synthetic labels and elapsed-time chart |
| Export `.lscap` through the system Save dialog | 4,689 bytes, identical to the source sample |
| Reopen sample with its final ten bytes removed | Recovers 23 frames; incomplete payload at byte 4,501 and 178 unread trailing bytes reported |
| Import invalid 19-byte file | Header error; previously loaded 23-frame capture survives |
| Cancel another import | Existing capture survives |
| Open five-frame message fixture | Synthetic Reticulum records; missing timestamps and RF measurements remain explicitly unavailable |
| Open frame detail and select bytes 160–167 | Exact `89 8A 8B 8C 8D 8E 8F 90` selection; selected state exposed to accessibility |
| Query sequence 4, then export CSV | One matching record; exact hex payload and blank timestamp/frequency/RSSI/SNR preserved |
| Select Meshtastic on the Reticulum-only fixture | Zero matches and export disabled; Reset filters restores all five frames |
| Preview → Pause → Next sweep | Paused strongest-bin value stays stable; Next sweep changes the sample without restarting continuous updates |
| Preview → Clear | Returns to empty state and stays empty; preview can be started again |
| Background a running preview and return | Returns with Next sweep; strongest-bin value stays stable |
| Largest accessibility text size | Radio titles/details wrap; capture remains scrollable; filter labels stack above readable menus; Spectrum actions remain available |
| Standard text size after restoration | Filter labels, selection, reset, and Spectrum actions work |

Selected evidence:

- [Standard filter labels](qa/native-analyzer-2026-09-14/filters-standard.png),
  [largest text](qa/native-analyzer-2026-09-14/filters-largest-text.png),
  [Radio tool rows](qa/native-analyzer-2026-09-14/tools-largest-text.png).
- [Spectrum controls](qa/native-analyzer-2026-09-14/spectrum-controls.png),
  [after Clear](qa/native-analyzer-2026-09-14/spectrum-cleared.png).
- [Truncated import](qa/native-analyzer-2026-09-14/truncated-import.png),
  [invalid import preserving data](qa/native-analyzer-2026-09-14/invalid-import.png),
  [byte selection](qa/native-analyzer-2026-09-14/selected-bytes.png),
  [no matching frames](qa/native-analyzer-2026-09-14/no-matching-frames.png).
- Actual exports: [LSCap](qa/native-analyzer-2026-09-14/Valid-filtered.lscap)
  and [CSV](qa/native-analyzer-2026-09-14/Messages-filtered.csv).

## Automated validation

- Unsigned `PommeCore` iOS Simulator build: passed.
- Unsigned `PommeCore-macOS` build: passed.
- Native capture host suite: 27 tests passed.
- Source registration, design-system, sheet-chrome, and whitespace checks: passed.

The complete host/web gate from the previous continuation was not rerun for
these SwiftUI layout changes. This is a manual walkthrough, not a recorded
Argent regression flow or a VoiceOver navigation audit.

## Argent repair and cleanup

Argent 0.22.1 is installed under Node 22.22.1. Explicitly launching ARM Node by
path was insufficient: inherited Intel architecture preference caused the
native helper to reject ARM64 SimulatorKit. The Codex MCP command now starts
with `/usr/bin/arch -arm64`, followed by the installed Node and Argent CLI paths.
The Node bin directory is also prepended to that server's PATH. The shared
Argent tool-server was restarted using the same explicit architecture.
No Argent upgrade was installed.

Use native app-scoped discovery for Lilyshark when AX discovery exposes stale
elements behind sheets. For system UI, use `describe`. A scoped simulator-server
restart recovered stale AX reads after app switching; do not use a global stop
while other devices may be in use.

After large-text QA, Settings' accessibility subpages stopped responding even
after restart. Only the 17e simulator's `UIPreferredContentSizeCategoryName` was
restored directly to `UICTContentSizeCategoryL`, then the simulator was restarted
and the app's standard-size UI was verified. Reduce Motion remains off.
Argent's simulator services were then stopped for the two devices used by this
task, without a machine-wide shutdown.

## Still unverified

- Reduce Motion walkthrough, dark appearance, iPad layout, VoiceOver navigation,
  and a native macOS UI walkthrough.
- Physical USB recording/scanning, analyzer BLE transport on iOS, and RF data.
- Payload decryption, signature verification, and annotations remain separate
  implementation work. Structural decoding does not verify signatures.
- No firmware flash, deployment, TestFlight upload, or App Store submission.
