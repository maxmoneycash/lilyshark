# Scout Lite companion — source and integration note

Checked 16 September 2026. Local independent demonstration, not a commissioned page or hands-on review.

## Integration

- Import `scoutCompanionBody` from `src/scout-companion.mjs`.
- Pass the same image-enriched `devices` array used by existing templates.
- Render `/builds/scout-lite/` through the standard layout with `page: 'scout-companion'`, `active: 'builds'` and `/scout-companion.css` loaded after the shared styles.
- Suggested title: `Scout Lite + SigRoam — gadgets.sh`.
- Suggested description: `The parts, app and source instructions for a Scout Lite and Flipper Zero Wi-Fi survey setup.`
- The body owns its `<main id="main">`; it needs no additional JavaScript. Its primary link opens a shared setup snapshot through the existing `kitURL`/`kitFromURL` flow. Both catalog items have quantity one, a neutral considering state, and individual notes. The visitor can then explicitly remix the snapshot.
- No build, browser session or hardware test was run by the implementing agent. Root owns integration and visual QA.

## Primary sources

| Source | Used for |
| --- | --- |
| [PINGEQUA product page](https://www.pingequa.com/products/scout-lite) | Device identity, intended survey use, included antenna, host sold separately, product-store destination. |
| [Scout Lite guide](https://github.com/pingequalab/scout-lite) | Board image, installation sequence, antenna connection, storage, GPS precondition and unreleased scanner status. |
| [SigRoam repository](https://github.com/pingequalab/sigroam-wardriving) | Host/scanner responsibility, receive-only purpose, CSV destination and start/stop controls. |
| [SigRoam 0.3 release](https://github.com/pingequalab/sigroam-wardriving/releases/tag/v0.3) | Pinned filename, supported Flipper firmware targets, installation directory and excluded firmware target. Link leads to the official release; no binary was downloaded or executed. |
| [Flipper qFlipper documentation](https://docs.flipper.net/zero/qflipper) | USB file-transfer route and Flipper microSD use. |
| [Flipper product page](https://flipper.net/products/flipper-zero) | Official product-store destination, reached through the maker homepage’s Buy link. |

Copy is deliberately brief and paraphrased. The on-screen references sit beside the sections they support. The product page contains older diagrams and a separate Marauder-app quick start; the newer SigRoam-specific instructions and pinned app release determine this guide’s app path. The future scanner image is not treated as an available download.

## Photographs

The page uses existing local files without editing. It reads image paths, dimensions, source pages and credits from enriched catalog metadata:

- `/assets/scout-lite.jpg` — PINGEQUA, 1600 × 1600, [source product page](https://www.pingequa.com/products/scout-lite). The photo visibly shows the Marauder interface; the caption identifies that interface instead of presenting it as a SigRoam screenshot.
- `/assets/flipper-zero.png` — Flipper Devices, 1200 × 630, [source maker site](https://flipper.net/). Accessories in the maker photo are illustrative; the page’s textual list defines the requested setup.

Both entries in `data/images.json` are marked `Local preview; commercial reuse not cleared`. Credits do not establish reuse permission. Secure maker permission or substitute cleared media before commercial publication.

## Scope

The page explains one source-documented configuration. It does not imply gadgets.sh authored the firmware, maker endorsement, observed compatibility, stock availability, active discounts or an affiliate relationship. Store links remain distinct from the reusable parts-list action. No pricing, fabricated survey results, testimonials or community activity appears.
