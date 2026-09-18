# Standalone maker demo handoff

Prepared 2026-09-16. Status: generated locally; no deployment or outreach.

## Reviewable artifact

- Folder: `gadgets/maker-demo-dist/`
- Archive: `gadgets/maker-demo.zip`
- Entry point: `index.html`
- Build command, from `gadgets/`: `node scripts/build-maker-demo.mjs`
- Focused checks: `node --test test/maker-demo.test.mjs`

To view from `gadgets/`, run:

```sh
python3 -m http.server 5187 --bind 127.0.0.1 --directory maker-demo-dist
```

Then open `http://127.0.0.1:5187/` in the existing authorized Arc session. This agent did not start a browser or server. The ZIP contains eighteen files, with `index.html` at its root; an extracted copy can be served with the command in its README. All page URLs are relative, so a static subdirectory also works.

## What the page demonstrates

A maker can give an existing social post a useful destination: the exact parts, an original guide, direct store links and a reference the viewer can download. The page uses the light gadgets.sh identity, an original inline brand mark, system fonts and lime accents. It contains one concrete source example, the proposed $750 production offer, and a three-field brief.

The sharing section below the source example shows a real wide PNG preview and download links for the same design in feed, story and wide sizes, with editable SVGs and the actual caption. These downloads work without JavaScript. The visible example status remains independent, not hands-on tested or commissioned.

The Wio L1 example chooses the OLED base model and the BME280 option in [Seeed Studio’s sensor guide](https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/#sensor-connection). Model and firmware references are linked beside the example. Direct official product links were followed from the maker’s wiki. The BME280 store teaser inconsistently says “BMP280”; the demo uses the BME280 name supported by the guide, product title and store SKU selection, and does not repeat that teaser claim. No price, stock, live reading, range or battery-life estimate is shown.

The example is clearly independent, not maker commissioned or hands-on tested. It does not claim a relationship with Seeed, Meshtastic, a paid client, a creator audience or an affiliate program. It is a concise guide companion, not a replacement for the original instructions.

## Photo and distribution rights

The only product photograph is `assets/seeed-wio-tracker-l1.jpg`. The newly cleared base XIAO image is deliberately absent because it is not a part of this example. No other catalog assets are copied. The three additional PNGs are renders of original photo-free vector sharing designs.

The Wio image’s SHA-256 is pinned to `f8e8e7edfc74d34458ab4343f2d31ed984fb018a0c545d184521407fca238269`. The build checks its manifest path, source, credit, dimensions, license ID, license declaration and review date, then hashes the actual bytes. Any mismatch stops packaging for review.

The visible image caption names Seeed Studio, links its [source page](https://wiki.seeedstudio.com/wio_tracker_l1_node/) and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and states that the file is unchanged and only resized for display. `CREDITS.md` and `asset-manifest.json` also retain the original file URL, [Seeed’s Documents and Images license declaration](https://wiki.seeedstudio.com/License/), review date, changes and hash. The photograph is fully contained with its original aspect ratio, with no crop, filter or blend treatment. No restrictions on the CC-licensed photograph are added by the package.

## Sharing files and render validation

| Package path | Contents |
| --- | --- |
| `sharing/wio-l1-feed.png` and `.svg` | 1080 × 1350 design |
| `sharing/wio-l1-story.png` and `.svg` | 1080 × 1920 design |
| `sharing/wio-l1-wide.png` and `.svg` | 1200 × 630 design; PNG also used for the page preview |
| `downloads/wio-l1-caption.txt` | Original caption with quantities, required extras, Seeed guide URL and evidence status |
| `sharing/render-manifest.json` | Source SVG and rendered PNG SHA-256 values plus exact dimensions |

`src/maker-demo-sharing.mjs` supplies the exact SVGs and caption. Root rendered those vectors to PNG in the authorized Arc session, checked their appearance and saved the renders/manifest under `assets/maker-demo-sharing/`. The integration did not change that source module or re-render its images. The original vectors use system fonts and geometry; they contain no product photos, third-party illustrations or external SVG resources. The package credits distinguish this project artwork from Seeed's separately licensed photograph.

The builder reads only fixed filenames from that source directory. It requires all three formats, compares the manifest's SVG hashes with the current generated SVGs, then checks PNG signatures, IHDR dimensions and complete-byte hashes. It also checks that the packaged caption exactly matches the source. Changed source artwork requires a new reviewed render and manifest; stale assets fail packaging. Browser-rendering diagnostics such as `*-bounds.json` are excluded by the allowlist.

The README explains that absolute `og:url` and `og:image` metadata need the real public page/image destination after deployment. No default public URL was invented, and the standalone page does not claim dynamic social previews for URL-encoded setup snapshots.

## Local brief and offer boundaries

The artifact copies `public/maker-pilot.js` unchanged. It copies `src/pilot-brief.mjs` with one guarded substitution: the storage key becomes `gadgets.maker-demo-pilot`. This prevents a three-field standalone draft from overwriting the main preview’s fuller maker brief if both are served on the same origin.

Required fields are maker/creator name, product/build HTTPS URL and one intended outcome. Autosave, validation, copy fallback and Markdown download reuse the existing implementation. The fieldset starts disabled and is enabled by JavaScript; a blank Markdown brief is downloadable without JavaScript. Nothing is sent. No contact endpoint, CRM, tracking request, payment link or appointment flow exists.

The $750 offer matches the current brief module: one companion page, up to six catalog devices plus stated accessories, one revision/firmware path, eight primary sources, approved existing media, one sharing design in three crops and one consolidated review. Production is proposed as five working days after complete materials and scope agreement. Hosting is separate; payments are proposed as $375 after agreement and $375 after acceptance. No reach or sales result is promised. This demo itself does not claim to deliver every paid-pilot asset.

## Validation and remaining review

Eleven focused automated checks pass after the sharing integration. They cover the exact eighteen-file allowlist, one unchanged approved photo, the three current PNG/SVG pairs, caption content and download links, stale SVG manifests, damaged PNG headers, incorrect dimensions/hashes, duplicate/missing formats, local page/module/Markdown references, image attribution, preview URL leaks, remote assets, network submission code, isolated storage and the brief export contract. The standalone build completed with 24 checked local references and passed its archive integrity check with `unzip -tqq`.

The source checks are not a browser or hardware test. Root owns the integrated section's visual and interaction review in its existing Arc session: narrow-width layout, reading order, keyboard focus, preview loading and the PNG/SVG/caption links. The prior form review is recorded below. Source and store links leave the artifact directly.

Public URL and a real channel to receive briefs are still unconfigured. The only deployment placeholder is in the packaged README; the page has no fake public CTA. Publishing the static files, choosing any submission channel and sending maker outreach are separate actions.

## Owned implementation files

- `src/maker-demo.mjs`: standalone HTML, source URLs and reference/credit downloads.
- `public/maker-demo.css`: self-contained responsive layout, focus states and native form styling.
- `scripts/build-maker-demo.mjs`: source/asset guards, packaging and ZIP generation.
- `test/maker-demo.test.mjs`: focused artifact regression checks.
- This handoff document.

No shared application routes, catalog entries, image manifests, main build scripts or existing maker utility files were edited.


### Earlier root browser review — 16 September, before the sharing section

The generated demo was reviewed in the existing authorized Arc task tab at 320 and 1280 CSS pixels. Both widths have no document overflow; the approved photo loads. Required-field and HTTPS errors focus the first invalid field. A three-field draft survives reload with its line breaks, copies with its scope and URL, and produces the expected Markdown filename and content through a controlled download-anchor interception. Denied clipboard access opens a native dialog with the full brief selected. The isolated storage key was restored to its original null value after the checks. Browser API stubs were removed by reload.

Screenshots: [320px hero](../qa/overnight/maker-demo-320.png), [320px validation](../qa/overnight/maker-demo-form-320.png), [desktop hero](../qa/overnight/maker-demo-desktop.png). These are narrow/desktop Arc checks, not physical mobile-device or hardware tests. Playwriter’s floating controls are not part of the demo. The artifact is still local and has no receiving endpoint.

### Root sharing-section review — 16 September

Arc at 320 and 1280 CSS pixels loads the 1200 × 630 preview without document overflow. The six image/vector links and caption link have download attributes, clear accessible names and HTTP 200 responses with the expected MIME types and byte lengths. Root enlarged the PNG targets to 44 × 44 CSS pixels; SVG targets are at least 44 pixels tall. The 18-file package was rebuilt after that adjustment. The isolated brief key remains null after this review. Screenshots: [mobile](../qa/overnight/maker-sharing-320.png), [desktop](../qa/overnight/maker-sharing-desktop.png). Checks used desktop Arc at narrow widths, not a physical phone or external public host. Download response inspection does not claim a saved file on a recipient’s device.
