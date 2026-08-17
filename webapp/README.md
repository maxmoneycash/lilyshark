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

