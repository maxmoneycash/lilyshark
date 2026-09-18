# Maker demo sharing assets

Prepared 16 September 2026. Original photo-free SVG artwork and caption for the existing Wio L1 + Grove BME280 source example. No public deployment, posting, hardware test or commissioned relationship is implied.

## Integration

Import `createMakerDemoSharing` from `src/maker-demo-sharing.mjs` and call it with no arguments:

```js
const {cards, caption} = createMakerDemoSharing();
// Each card: {format, filename, width, height, svg, textBounds}
```

| Format | Filename | Export size |
| --- | --- | --- |
| Feed | `wio-l1-feed.svg` | 1080 × 1350 |
| Story | `wio-l1-story.svg` | 1080 × 1920 |
| Wide | `wio-l1-wide.svg` | 1200 × 630 |

The function writes no files and makes no network requests. Root owns packaging these strings, converting the cards to PNG in the authorized Arc session, linking the actual downloads/previews and updating the demo's credits and README. `textBounds` provides layout boxes for inspection; it is not browser-measured font geometry. The standalone package should preserve this caption next to the three sharing images.

The module imports only the existing demo's reviewed guide URL and review date, so those remain consistent with the example. It has no configurable creator claim, product substitution or default public gadgets.sh URL. No metadata generator was added: deployment metadata should use the actual public destination and actual wide-image URL once selected.

## Design and text

One layout adapts to three proportions: the existing geometric G, a large outcome, two quantity-labelled parts panels, Seeed credit and an evidence footer. Portrait cards stack the sections; the wide card places the parts beside the title. The palette follows the existing dark green, lime and neutral text colors. All geometry and copy are original project work. The pairing symbol is a plus, not a circuit or a measured signal.

The SVGs contain system-font text and inline geometry only. They contain no raster images, linked resources, scripts, third-party illustrations, embedded HTML or imported font files. Text has explicit advances and bounded lines, avoiding dependence on remote font loading. `textLength` with `spacingAndGlyphs` keeps each fixed string inside its intended horizontal extent when a fallback system font differs. Root's raster review must still check the visual weight and spacing in all three sizes; the advance estimates are not a substitute for that review.

Cards identify **1× Wio Tracker L1, OLED base model** and **1× Grove BME280**, credit Seeed Studio's guide, and visibly say **Independent source example** and **Not hands-on tested or commissioned**. The caption carries the accessories, remote-reception condition and [original guide](https://wiki.seeedstudio.com/get_started_with_meshtastic_wio_tracker_l1/#sensor-connection). It does not use a localhost link, invented public destination, discount, sales result or hardware-performance claim. Accessories and software choices still need the source review described in the [sample scope](../strategy/wio-l1-sample-scope.md).

The plainspoken-copy skill was applied to keep the outcome and needed facts direct. The concise card is a reference to the source guide, not a complete assembly tutorial.

## Focused verification

Six focused checks pass with `node --test test/maker-demo-sharing.test.mjs`. They cover the delivery dimensions, core quantities/model names, visible evidence labels, absence of active/remote SVG content, explicit text bounds and collisions, required caption accessories/source URL, and isolated deterministic results. An initial overlap in the conservative headline boxes was corrected by increasing line spacing before the passing run.

Only the new module, focused tests and this document belong to this task. The existing demo/build/public files and generated output are unchanged by this agent. Browser rendering and PNG inspection remain root's integration work.
