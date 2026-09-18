# gadgets.sh preview

A hardware discovery and setup-sharing prototype for experienced radio and hardware hobbyists, adapted from the three files in `files (23).zip`. gadgets.sh and LilyShark are separate products. This app has its own build/server and is separate from the LilyShark analyzer in `../webapp`; LilyShark is one attributed project in the catalog.

```sh
cd gadgets
npm run dev
```

Open http://127.0.0.1:54644. Requires Node 20 or later; no package installation is needed. `GADGETS_PORT` changes the preview port. Re-run `npm run build` after editing files; the preview server reads the rebuilt output. There is no development file watcher.

## Included

- Visual discovery homepage, a separate hardware directory and four curated collections.
- Detailed LilyShark build with physical project photography, a clearly labeled synthetic capture explorer, frame-specific links, capture download, parts and firmware links, evidence notes and a starting setup to remix.
- Setup pages with quantities, have/need states, per-part notes, creator buying links and affiliate disclosures, a build story, creator credit, custom parts, project/demo link, optional photo URL and up to six catalog devices. Browser-local drafts, one-step recovery after replacing a draft (until leaving/reloading the page), shared snapshots, credited remixes, Markdown parts export and three social-card formats with an optional local photo.
- Vertical 3D card carousel by default, optional photo grid and list, keyword search, and independent task, radio/protocol, device-format, category, availability and source-evidence filters. Filter URLs support sharing and browser history.
- Device pages with practical requirements and tradeoffs; 1,486 structured specification rows, revision notes and 463 resource links. Models with documented builds link directly into the build finder.
- Nineteen credited external project guides with exact core quantities, accessory requirements and explicit revision/verification limits. Choose hardware or import the setup’s “Have it” items without changing the draft. Each guide opens a credited planning template with exact core quantities.
- A source-based Scout Lite companion guide and a proposed $750 maker production pilot with a local brief editor.
- Permanent, statically generated pages for 44 imported devices, 28 additional source-checked devices and one explicitly identified LilyShark hardware concept.
- Separate LilyShark firmware article and attribution of the T-Deck to its manufacturer, LILYGO.
- Shortlists in local browser storage; comparisons of up to three devices with shareable URLs, a differences-only view, and sticky table headers.
- Three permanent comparisons with statically rendered tables, plus six selection guides with locally saved setup checklists.
- Local product images for all 72 device entries, local fonts, responsive layouts, semantic navigation, keyboard focus and reduced-motion support.

## Main routes

- `/` — discoveries and featured build
- `/builds/` — examples and hardware-based external guide finder
- `/builds/scout-lite/` — source-based Scout / SigRoam companion
- `/builds/lilyshark/` — demonstration, parts and development record
- `/hardware/` — searchable device directory
- `/setup/` — personal setup draft and shared setup views
- `/for-makers/` — proposed production pilot and local brief

## Data and editing

`data/catalog.json` is the editable public catalog. `data/images.json` records image paths, source pages, original URLs, captions, credits, retrieval dates, dimensions and SHA-256 hashes. `data/archive.json` is the original research input, retained for provenance and **never copied to the built website**. It contains unverified claims and must not be published as a factual reference.

The importer removed campaign totals, delivery-failure allegations and unsupported editorial superlatives. All 44 imported entries were reviewed on 2026-09-14: 41 have source-checked claims, with unconfirmed fields and revision caveats retained. CyperPRO, MAKERphone 2.0 and TICKEY remain partial reviews because final hardware details could not be established. See [the catalog review](docs/catalog-review-2026-09-14.md) for every entry and source. A checked source is not a hands-on test. Prices and stock have a check date; they are not refreshed automatically. All public device pages identify the applicable evidence level.

The [September 15 expansion](docs/catalog-expansion-2026-09-15.md) adds 22 devices across mesh, SDR, computing/controllers and bench tools. The September 16 additions include NanoVNA V2 Plus4 Pro, reTerminal E1001, HUSKYLENS 2, Mini-KVM, Cynthion and Beryl AX, bringing the catalog to 73 entries. The [carousel implementation notes](docs/hardware-carousel.md) record the user-supplied reference and adaptations.

All device entries have images from linked maker, project or creator campaign pages. Prototype illustrations and older hardware images have explicit captions. `docs/assets.md` records provenance and the pre-publication review. Replacing an image requires updating its credit. Missing images are visibly marked; no synthetic product renders are used.

`src/templates.mjs` generates static pages and the dynamic saved/comparison content. `public/app.js` adds browser behavior; `public/kits.js` manages setup drafts and shared views using `src/kits.mjs`. `src/workbench.mjs` renders discovery and build content; `public/capture-demo.js` inspects the sample through `src/capture-demo.mjs`. `tokens.css`, `public/workbench.css` and `public/quiet-pages.css` define the supporting pages; the carousel has its own isolated styling. `scripts/build.mjs` builds `dist/`; `scripts/dev.mjs` serves only that output. Device content and navigation remain readable without JavaScript; interactive filters, shortlists, checklist progress and changes to comparisons require it. Permanent comparison tables remain readable without it.

See [the product direction](docs/product-direction.md) for the audience, evidence priorities and proposed validation with real builders.

## Verification

```sh
npm test
npm run build
```

Ninety-seven checks pass at the latest September 16 checkpoint. They cover carousel recycling and wrap, compound radio and dependency filters, URL round-trips, comparison history and differences, malformed/stale local storage, comparison limits, setup stories and remix attribution, safe project/photo URLs, untrusted URL values, attribution and concept disclosures, generated routes and links, the preview server's routing and file boundary, and capture provenance, CRC/truncation challenges and invalid sample data. The provenance check uses Python 3 to regenerate the public JSON with the project's existing capture parser.

See [the browser verification record](docs/verification.md) for completed Arc flows, viewport checks and screenshots.

Setup links are URL-encoded snapshots; they need public hosting to open from another machine. There is no account system, hosted photo upload, public community feed or automatic per-setup social preview image. The PNG exporter can include a local creator photo without uploading it or adding it to a shared snapshot.

This is a local review build. No domain has been purchased, site deployed, affiliate program joined, account collection added or payments enabled. `robots.txt` blocks indexing until the content and publication setup are ready. A production host must serve directory indexes and the supplied 404 page. Do not expose `scripts/dev.mjs` as a production server.


## Maker demo and revenue research

The standalone [maker-demo.zip](maker-demo.zip) contains eighteen static files, one licensed Wio L1 photo, a source-based sensor example, three sharing-image sizes with editable vectors and a caption, the proposed offer and an isolated three-field brief. Build it with `node scripts/build-maker-demo.mjs`; view with `python3 -m http.server 5187 --bind 127.0.0.1 --directory maker-demo-dist`. See the [artifact handoff and browser checks](docs/research/maker-demo-handoff.md).

The [revenue plan](docs/strategy/revenue-plan-2026-09-16.md), [first three unsent pitches](docs/strategy/first-three-maker-pitches-2026-09-16.md), [affiliate research](docs/research/affiliate-partnerships-2026-09-16.md) and [one-board / three-build experiment](docs/strategy/one-board-three-builds-experiment.md) separate proposed pricing from actual traction. No customer, paid partnership, earned commission or revenue is claimed. Follow [the overnight journal](docs/overnight-2026-09-16.md) for later checkpoints.
