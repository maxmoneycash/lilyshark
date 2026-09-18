# Real MeshCore map and saved radio browsing — September 15, 2026

## Source and scope

The normal app now opens Map on the official MeshCore public directory. It downloads
`https://map.meshcore.dev/api/v1/nodes?binary=0&short=0`, which redirects to the official
`map.meshcore.io` service. The upstream repository is
[meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io).
No bundled or generated nodes are added to this layer. Public contacts, repeaters,
rooms, and sensors retain their full published identity, coordinates, radio settings,
submission source, advertisement date, and record update date.

The service returned 62,194 records in a direct download and 62,196 during the first
normal-app check. Counts change as the upstream directory changes. The direct response
contained 419 records with coordinates in the tested Bay Area bounding box. This is
published directory data, not independent proof of current hardware operation or RF
reception. For example, Endor Station's advertisement date was in 2024 while its public
record was updated in September 2026; the UI keeps those dates separate.

Reticulum is not represented by a fabricated layer. This pass implements the verified
MeshCore source requested by the user. My mesh continues to contain radio-reported
records only; an unconnected clean install has no local nodes.

## Implementation

- The directory validates full identities and coordinates, deduplicates identities,
  rejects malformed responses, and preserves a good directory on refresh failure.
- Download parsing and search ranking run outside the UI thread. Dense map regions
  cluster real records; selecting a cluster lists its actual members.
- The directory is saved in Application Support and restored on subsequent launches.
  Offline node records are supported; downloading basemap regions for offline use is
  not implemented. Basemap tiles depend on internet or the system cache.
- Fixed overlapping map selector/search controls and MapKit retaining the initial
  empty annotation set after the directory download.
- Public-node detail shows source and separate advertisement/update dates, with a link
  to the official record. Public nodes are not silently inserted into radio contacts.
- The normal simulator scanner no longer manufactures a T-Deck. The original explicit
  simulator demo remains available through `--lilyshark-simulator-preview`; onboarding's
  T-Deck tour is preserved. Fixture builds remain separate QA tools.
- Added encrypted per-radio browsing snapshots for contacts, channel names, positions,
  and radio observations. Existing per-radio message persistence supplies conversation
  history. Channel secrets are omitted from snapshots. A snapshot cannot be loaded for
  another full radio identity and cannot be saved or restored as plaintext.
- Disconnect restores a saved browsing context, with saved time shown on Mesh. A new
  connection clears saved context and conversation navigation before receiving new radio
  data. Sending requires a ready link and a fresh radio identity. Interrupted sends
  become failed, rather than spinning indefinitely. Background saves flush messages and
  the browsing snapshot. Incomplete contact synchronization retains prior real records
  under the same identity.

## Verification

Normal production-code simulator QA used the isolated `com.lilyshark.analyzerqa` bundle
on iPhone 17e, iOS 26.5. It replaced the prior UI fixture in that isolated app only.
No simulated connection, fixture contacts, or fixture messages were loaded.

Observed: initial directory download, real clustered pins, Endor Station details and
source dates, global directory search for Walnut Central, navigation to its published
position, and the Map data download count/date.

Package tests cover parser validation, role retention, identity deduplication, date
separation, encrypted snapshot round trips, full-identity checks, wrong-key rejection,
and failure when encryption is unavailable. Existing message and protocol model tests
also run.

Final validation passed: normal iOS and macOS builds, all 82 MeshCoreKit tests,
source registration (117 files), design checks (116 files), sheet checks (33 sheets),
and whitespace validation. The final normal simulator build downloaded 62,200 public
records. After terminating and relaunching it, the saved 62,200-node map returned;
the accessibility check completed in 221 ms after opening Map. The initial network
load took about 10 seconds. My mesh was empty on this clean, unconnected install.

The last fresh-install check also exposed a MapProxy startup issue that merged all
visible records into one cluster. Clustering now uses the visible region and view size;
fresh download and restart both showed multiple clusters and individual public nodes.
This is not an airplane-mode basemap or hardware reconnect test.

## Evidence

- [Public node detail](qa/real-mesh-map-2026-09-15/01-public-node-source.png)
- [Advertisement and update dates](qa/real-mesh-map-2026-09-15/02-public-node-freshness.png)
- [Real directory map](qa/real-mesh-map-2026-09-15/03-real-public-map.png)
- [Directory source and download](qa/real-mesh-map-2026-09-15/04-directory-download.png)
- [Final real map, 62,200 records](qa/real-mesh-map-2026-09-15/05-final-live-map.png)
- [Empty local mesh without a radio](qa/real-mesh-map-2026-09-15/06-empty-real-local-mesh.png)
- [Map restored after app restart](qa/real-mesh-map-2026-09-15/07-restored-map-after-restart.png)

## Hardware limits

`xcrun devicectl list devices` reported the physical iPhone and iPad as unavailable.
No physical install, radio transmission, send/receive/ACK, radio-switch, reconnect, or
sustained background-radio test was performed. Persistence tests do not establish that
those hardware flows work. All changes remain local; nothing was published or pushed.
