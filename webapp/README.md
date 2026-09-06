# Lilyshark web app

The cloud half of Lilyshark: a terminal-style web app that reads the `.lscap` captures the T-Deck
firmware writes, drives a real radio over USB or Bluetooth, and explores the
Shelby network live. Deployed on Vercel.

## Architecture

```
browser (Vite + React)
  ├─ src/mesh/ ............ the terminal analyzer
  │    ├─ radio.ts / store.ts / db.ts ... Web Serial + BLE link, state, history
  │    ├─ screens/ ........ TRAFFIC (the .lscap analyzer), SHELBY, WHITEPAPER,
  │    │                    CHAT, NODES, MAP, MESH, TELEMETRY, CONFIG, DEBUG
  │    ├─ theme.ts ........ one-line color themes; "lilyshark" pink is default
  │    └─ meshterm.css .... the terminal stylesheet, scoped under .meshterm
  ├─ src/lib/lscap.ts ..... .lscap + Shelby pointer reader (byte-exact vs firmware)
  ├─ TRAFFIC ── fetch by blob name ──▶ /api/share/view/... ──▶ pulse-api ──▶ Shelby
  └─ SHELBY screen ── /api/[...path] ── CORS proxy (Vercel serverless)
                                          └─ services/pulse-api ── indexer + API
                                                 └─ SQLite cache ◀── Shelby RPC /
                                                                     Aptos indexer
```

- **`src/lib/lscap.ts`** — the `.lscap` reader and the Shelby off-grid
  pointer decoder, byte-compatible with the firmware (pinned by the golden
  vector in `../docs/shelby-pointer-format.md`). Covered by `node:test`.
- **`src/mesh/screens/Traffic.tsx`** — the TRAFFIC screen: open a capture
  from disk, from the bundled sample, or from Shelby by blob name; readouts,
  frame table, RF detail, hex dump, and inline Shelby-pointer decode.
- **`src/mesh/screens/`** — the rest of the terminal: a full MeshCore client
  (chat, nodes, map, mesh graph, telemetry, config, debug log) plus the
  SHELBY network screen and the WHITEPAPER reader.
- **`api/[...path].ts`** — Vercel catch-all that proxies API calls to the
  backend with CORS headers. No secrets here; the network data is public.
- **`services/pulse-api/`** — Express service that syncs the chain's `blobs`
  and `blob_activities` indexer tables into SQLite (`better-sqlite3`) and
  serves read endpoints (`/network/stats`, `/blobs/recent`, `/providers`,
  `/economy`, `/analytics`, …) plus the capture share routes
  (`/share/upload`, `/share/view/:address/:filename`) that move `.lscap`
  files to and from Shelby. Wallet signing happens client-side via the
  Aptos wallet adapter; the service never custodies keys.

## 3D introduction

[IntroTab.tsx](src/components/IntroTab.tsx) maps native vertical scrolling to all
42 firmware renders in `public/intro/fw/`, grouped under the original twelve
narratives. The track remains twelve viewports long, with a snap stop for each
screen. Section rail buttons jump to the group's first screen. The sequence and
scroll calculations live in [intro-sequence.ts](src/components/intro-sequence.ts);
its tests check asset coverage, ordering, section jumps, and reachable endpoints.
There is no timer advancing the LCD.

[TDeckModel.tsx](src/components/TDeckModel.tsx) owns the React lifecycle, controls,
and loading/error photo fallback. It loads [tdeck-scene.ts](src/components/tdeck-scene.ts)
on demand; that module owns Three.js, the LCD texture, pointer input, and GPU
cleanup. One scene persists while screens change. The device floats and rotates
independently of scrolling. Drag horizontally to spin it; `touch-action: pan-y`
keeps vertical touch gestures available for scrolling. Arrow keys rotate and
Home resets the view. Reduced motion disables automatic movement, and the pause
control lets other visitors stop it. The photo fallback still receives the
current firmware screen if WebGL or model loading fails.

The versioned model is
[`public/models/tdeck-plus/tdeck-plus-v5.glb`](public/models/tdeck-plus/tdeck-plus-v5.glb)
(4.1 MB). See the [asset README](public/models/tdeck-plus/README.md) for provenance,
LCD material/UV conventions, validation, and reproduction commands for
[`scripts/model/optimize-tdeck.mjs`](../scripts/model/optimize-tdeck.mjs).
Use a new versioned filename when changing the model so caches cannot keep an
older asset.

## Develop

```sh
npm install
npm run dev        # Vite dev server
npm test           # node:test suites (lscap, theme, i18n, mesh, alerts, battery, fmt)
npm run build      # production build into dist/
```

The backend service (`services/pulse-api/`) has its own package:

```sh
cd services/pulse-api
npm install
npm run dev        # tsx watch; DATA_DIR and LOG_LEVEL env vars supported
```

Format and lint with Biome (`npm run fmt`, `npm run lint`).

## USB telemetry and message evidence

The `LSK ID` node field supplies the linked deck's identity. Older firmware
that omits it stays unidentified; the web app does not assign a substitute
node number. A successful USB transmission or TX echo means **sent, delivery
unconfirmed**. It does not establish that a recipient received the message.

In `LSK T`, `frames` is the newest capture sequence and includes transmissions.
`rx` is the radio's receive counter. The separate `drop_crc`, `drop_bad` and
`drop_nosrc` counters explain frames the analyzer cannot attribute to nodes.
Their lifetimes can differ from `rx`, so the UI does not subtract them to
invent an attributed total. Missing counters remain unknown; explicit zeros
are retained. The unattributed total is shown only when all three counters
are present.

`latest_pf` carries the newest frame's RF presence mask, and `latest_dir`
uses 0 for unknown, 1 for receive and 2 for transmit. RSSI and SNR are shown
only for a received frame with that measurement's presence bit. For older
firmware, a recent `LSK F` with exactly the same sequence can supply this
metadata. A receive count alone cannot certify a signal measurement.
`BAT --` means the battery reading is unavailable, even when the firmware
also sends its numeric zero defaults.

Traffic decodes cleartext opportunistic LXMF messages only within eligible
Reticulum data packets. Reference-generated fixtures in `../test/lxmf/`
pin the timestamp/title/content/fields order, optional stamp, and both
stored and opportunistic framing. Signature and stamp presence does not
claim cryptographic verification.

## Deploy

**Pushing to `main` deploys lilyshark.com. Nothing else does.**

The Vercel project is connected to `maxmoneycash/lilyshark`, so a push to
`main` builds and promotes to production and a push to any other branch gets
a preview URL. Two settings make that work, and both matter:

| Setting | Value | Why |
| --- | --- | --- |
| Root Directory | `webapp` | The repository root is a PlatformIO firmware tree with no `package.json`. Left at the default, every Git build fails immediately. |
| Ignored Build Step | `git diff --quiet HEAD^ HEAD -- .` | Most commits here are firmware. Exit 0 skips the build, so only changes under `webapp/` spend a build. |

Do **not** deploy with `vercel --prod`. It works, which is the problem: it
publishes whatever is in the working tree, so production stops matching any
commit and the drift is invisible until someone checks. This project sat 19
hours behind `main` that way. If you ever need a one-off, deploy from a
clean tree at the commit you intend to ship.

`api/` becomes serverless functions. `services/pulse-api/` runs as a
long-lived Node process (any VM; `npm run build && npm start`) and the
proxy target in `api/[...path].ts` points at it.

## Shelby touchpoints

- Capture fetch by blob name on the TRAFFIC screen (`/api/share/view/...`).
- The SHELBY screen is a live read index of Shelby storage activity and the
  ShelbyUSD economy.
- `scripts/shelby-upload.ts` and friends (`npm run shelby:upload`, …) push
  assets to Shelby through the SDK.
- The Shelby off-grid pointer (`../docs/shelby-pointer-format.md`) is
  decoded inline when a capture's frames carry one — press **Sample** on the
  TRAFFIC screen and select frame 9.
