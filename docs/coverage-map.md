# Lilyshark coverage map

The map is built into Lilyshark: SwiftUI and MapKit on iOS, React and Leaflet on
the web. It does not embed an external application's page, navigation, or
controls. Both clients distinguish public repeater positions, measured regional
coverage, and the connected radio's own observations.

## Capabilities

| Capability | iOS | Web |
| --- | --- | --- |
| Public repeater positions | Native map with clusters and searchable list | Map with clusters, viewport counts and searchable list |
| Regional coverage cells | Native colored overlays and accessible cell list | Colored overlays and cell details |
| Observation filters | Two-way, discovery, transmit, receive, dead end, dropped; SNR and age | Same observation meanings, SNR and age |
| Repeater details | Identity, reported position, age and ambiguity | Identity, reported position, age and ambiguity |
| Distance measurement | Two selected positions; straight-line distance | Two selected positions; straight-line distance |
| Terrain planning | Native line-of-sight tool with antenna settings and Fresnel analysis | Terrain profile with antenna settings, Earth curvature and 60% Fresnel analysis |
| Map data | Shared regional feed; optional personal key in Keychain | Shared regional feed; optional personal key in page memory |
| Saved coverage | Credential-scoped app cache | Snapshot cache in browser storage; no saved API key |
| Radio diagnostics | Actual connected identity, protocol, reported settings and position | MeshCore companion, Meshtastic BLE and Lilyshark USB diagnostics |
| Existing local map | My mesh | My mesh |

A distance line is not a received packet route. A directory pin is not a
coverage sample. Terrain is a calculation from sampled ground elevations; it
does not measure buildings, vegetation, interference or successful reception.
Source snapshot times remain visible even when an outage requires saved data.

## Map presentation

The map source switch and utility actions float over the map. Web source tabs
have 32px visible faces with extended touch areas and support arrow, Home and
End keys. Map controls use neutral surfaces with a restrained accent for selected
observations. Their hover and press states are isolated from the terminal's
raised-button styles. The map also omits the terminal's decorative scanlines.

Search and viewport counts share a compact surface. Selecting a repeater closes
the results panel; full public keys and coordinates are available under Details.
Small visual markers retain 44px hit areas, and a selected repeater or its cluster
has an accent ring. The map does not label a panned viewport with a fixed city
name. My mesh keeps its filters under Map options.

The web coverage map uses [OpenFreeMap](https://openfreemap.org/) Positron and
Dark vector styles, following the app's light or dark theme. MapLibre and its
worker load separately when the street map is used. The provider permits public
instance use without an API key, including commercial use. The
[official integration guide](https://openfreemap.org/quick_start/) documents the
Leaflet binding. OpenMapTiles, OpenStreetMap and OpenFreeMap attribution remain
visible on the map. If the vector renderer or source fails, the map falls back
to OpenStreetMap raster tiles while preserving the interactive observations.
The existing satellite layer remains available. iOS uses native MapKit.

## Data contracts

The regional adapter follows the documented
[Coverage API](https://wiki.meshmapper.net/coverage-api/). A regional or
multi-region credential is required for grid observations. The public node
directory is independent and remains useful without that credential.

Both parsers preserve nullable measurements and future observation types,
exclude invalid bounds from rendering, and deduplicate exact map identities.
Two repeaters with the same key prefix at different coordinates remain distinct.
An explicitly reported zero coordinate is valid; MeshCore's absent-position
sentinel is handled separately from coordinate validation.

The documented regional API does not provide an individual ping history,
verified per-packet routes, or a contribution/upload endpoint. These are not
invented from the aggregate cells. An authorized regional credential has not
been provided in this session, so live grid ingestion has been exercised with
synthetic contract fixtures rather than claimed as a working production feed.

## What remains external

### Shared feed deployment

`GET /api/community-coverage` is served by the existing Express backend in
`webapp/services/pulse-api`. Set `COVERAGE_API_KEY` **only on that backend**, using
an authorized regional or multi-region grant that permits sharing these data.
It is read separately from the general startup configuration so it is not
included in the logged configuration object. Vercel and Vite relay the fixed
backend endpoint at `https://64-23-133-21.sslip.io/api/community-coverage`; neither
holds the shared provider credential. Personal-key requests remain separate.

The cache lives in `DATA_DIR/shelby-pulse.db`, alongside the backend's existing
tables. Preserve that directory across restarts and container replacements.
Every worker serving this endpoint must use that same SQLite file on the same
host. Do not run independent replicas with separate databases for one grant.
No additional storage service is required. Ordinary analytics cache clearing
does not delete the coverage cache or reset its request budget.

A SQLite `IMMEDIATE` transaction reserves an hour before each upstream attempt.
Failed requests and process crashes consume that reservation too. A `429`
extends it to the greater of one hour, `Retry-After`, and the provider's reset
time. ETags and complete source snapshots persist; an outage serves saved data
with the original `generated_at`. A revoked grant clears its saved snapshot.
During the first refresh, a concurrent worker may receive a temporary `503`
until the first snapshot is ready; it does not make another provider request.
This follows SQLite's documented [write transaction semantics](https://www.sqlite.org/lang_transaction.html).

The backend must be updated before enabling the feed on the website. This
checkout's legacy `build` command has `noEmit` enabled while `start` expects a
`dist` directory, so use the source runner with installed dependencies:

```sh
cd webapp/services/pulse-api
npm install
npm run test:coverage
npm run start:source
```

The backend's local `node_modules` is currently a broken symlink to a separate
checkout. Validation used an isolated copy with installed dependencies, without
replacing that link. The nine SQLite tests cover restart, concurrent connections,
committed crash reservation, ETag reuse, malformed data, quota reset, credential
rotation/revocation, and storage failure before an outbound request. The complete
`start:source` app also passed a local HTTP check: an empty temporary database
initialized both existing tables and the coverage cache, the unconfigured feed
returned `503`, unsupported methods returned `405` with `Allow: GET`, and the
existing health route returned `200` against a local test indexer. Both local
servers were stopped afterward. Live provider access and backend deployment
remain unverified in this session.

### Required external checks

- Configure the authorized regional coverage source in the deployment. An
  unconfigured service responds explicitly; neither client fabricates coverage.
- Public contribution requires authenticated ingestion and an agreed data
  contract. A local radio announcement does not upload an observation.
- Validate the physical T-Deck's flashed version, selected profile, GPS lock and
  reception by a nearby peer. See [radio visibility](radio-map-visibility.md).

The implementation and tests in this checkout do not mean it has been deployed
to the live website, distributed through TestFlight, or flashed to a T-Deck.

## Verification

The common synthetic fixture is under
`ios/Packages/MeshCoreKit/Tests/MeshCoreKitTests/Fixtures/meshmapper-v2.json`.
It deliberately covers missing values, invalid bounds, future observation
types, prefix collisions and explicit zero coordinates. It is never seeded as
public coverage in the production app.

Relevant checks:

```sh
cd webapp
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

```sh
swift test --package-path ios/Packages/MeshCoreKit
swift test --package-path ios/Packages/MeshtasticKit
python3 scripts/add_ios_source.py --check
python3 scripts/check_ios_design.py
python3 scripts/check_sheet_chrome.py
```

Firmware tests also pin the exact default, Bay and custom-profile protobuf
bytes decoded by both clients, plus BLE GPS acquisition, queue-pressure retry
and reconnection behavior. Hardware reception requires the separate field check.

Design decisions and verified installed skills are preserved in
[design guidance](design-guidance.md).
