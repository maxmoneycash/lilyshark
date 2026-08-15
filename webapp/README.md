# Lilyshark web app

The cloud half of Lilyshark: a Wireshark-style analyzer for the `.lscap`
captures the T-Deck firmware writes, plus a live explorer for the Shelby
network itself. Deployed on Vercel.

## Architecture

```
browser (Vite + React)
  ├─ Traffic tab ─────────────── parses .lscap locally in the browser
  │     └─ fetch by blob name ──▶ /api/share/view/... ──▶ pulse-api ──▶ Shelby
  └─ network tabs (Overview, Metrics, Activity, Providers, Economy, Share)
        └─ /api/[...path] ────── CORS proxy (Vercel serverless)
                                   └─ services/pulse-api ── indexer + API
                                          └─ SQLite cache ◀── Shelby RPC /
                                                              Aptos indexer
```

- **`src/lib/lscap.ts`** — the `.lscap` reader and the Shelby off-grid
  pointer decoder, byte-compatible with the firmware (pinned by the golden
  vector in `../docs/shelby-pointer-format.md`). Covered by `node:test`
  (`npm test`).
- **`src/components/`** — one tab per view. `TrafficTab.tsx` is the capture
  analyzer; the rest read live network data.
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
npm test           # node:test suites (lscap reader, Shelby pointer)
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

The app deploys to Vercel from the repository root's `webapp/` directory;
`api/` becomes serverless functions. `services/pulse-api/` runs as a
long-lived Node process (any VM; `npm run build && npm start`) and the
proxy target in `api/[...path].ts` points at it.

## Shelby touchpoints

- Capture fetch by blob name in the Traffic tab (`/api/share/view/...`).
- `scripts/shelby-upload.ts` and friends (`npm run shelby:upload`, …) push
  assets to Shelby through the SDK.
- The network tabs are a read index of Shelby storage activity and the
  ShelbyUSD economy.
- The Shelby off-grid pointer (`../docs/shelby-pointer-format.md`) is
  decoded inline when a capture's frames carry one — see
  `../samples/sample-mesh-traffic.lscap`.
