# Setup sharing: portability audit and bounded fix

Reviewed 2026-09-16. No platform posts, outreach, account actions, deployment, server changes or browser automation were performed. HTTP checks were read-only GETs against the existing preview at `http://127.0.0.1:54644`. Root owns browser integration and QA.

## Outcome

Valid, fully populated six-device setups could create query URLs of **22,945–28,945 characters**. The preview returned **HTTP 431**, before the setup page could load. Emoji at a field boundary could also change to `�` when a setup was shared.

Both defects are addressed in `src/kits.mjs`, with regression checks in `test/kits.test.mjs`:

- Short links keep their existing query format. Longer snapshots use a versioned, bounded UTF-8 JSON fragment: `/setup/#kit=v1.<base64url>`.
- The fragment is decoded and normalized in the browser. The server receives only `/setup/` for these links.
- Text truncation retains complete Unicode code points while preserving the existing field budgets. This also covers the remix name prefix.
- Existing query decoding remains available. Credits, creator buying links, affiliate flags, part order, quantities and planning states retain their meaning.

**28 targeted kit and card-exporter tests pass.** All seven measured fixtures round-trip exactly with the new format. The previously failing maximum fixtures now receive HTTP 200. These GET checks establish that the HTML is reachable; actual browser rendering is root's separate integration check.

This fixes transport reliability. It does **not** make every caption suitable for every social platform, create public hosting, or turn a snapshot URL into a database permalink.

## Measurements

Measurements use the current 67-device catalog, Node v24.5.0, the current caption including the local-preview notice, and the origin `http://127.0.0.1:54644`. URL characters equal UTF-8 bytes because the resulting URLs are ASCII. Caption counts below are JavaScript UTF-16 units; platform counting rules can differ.

“Before” reconstructs the previous query serializer from the same normalized fixture. “After” uses the updated `kitURL`. Every response body was consumed; no browser or external asset URL was opened by the fixture runner.

| Fixture | Old URL | New URL | Old caption | New caption | Old → new HTTP |
| --- | ---: | ---: | ---: | ---: | --- |
| Six devices, no extra text | 166 | 166 | 568 | 568 | 200 → 200 |
| Realistic English setup | 3,128 | 3,161 | 4,737 | 4,770 | 200 → 200 |
| Realistic Japanese/English setup | 4,612 | 3,311 | 5,875 | 4,574 | 200 → 200 |
| All fields full, ASCII | 6,593 | 8,063 | 9,643 | 11,113 | 200 → 200 |
| All fields full, CJK | 22,945 | 13,513 | 25,995 | 16,563 | 431 → 200 |
| All fields full, CJK and reserved characters in links | 28,945 | 13,513 | 31,995 | 16,563 | 431 → 200 |
| All fields full, varied CJK and distinct buying links | 22,945 | 13,513 | 26,139 | 16,707 | 431 → 200 |

The new request target is **7 bytes** (`/setup/`) for every fragment fixture. The unchanged minimal query request target is 144 bytes. The decoded maximum fragment fixture is **10,107 bytes**, below the 16,384-byte decode limit.

Base64 is encoding, not compression. It can increase ASCII link length; the improvement is that the snapshot no longer consumes the server's request-target budget. CJK benefits additionally because UTF-8 base64 avoids repeated percent escapes.

The realistic Unicode caption contains 4,566 Unicode code points after the fix, versus 5,867 before. Its new UTF-8 byte count is 5,064. A simple JavaScript `.length` is therefore not a general platform character counter.

### What the fixtures contain

The everyday fixture uses Scout Lite, Flipper Zero, T-Deck Plus, Wio Tracker L1, SenseCAP T1000-E and T-Embed CC1101, in that order. It has:

- A 30-unit English title, 10-unit author, 213-unit story and 140-unit custom-parts note.
- A 62-character project URL and 48-character remote-photo URL.
- Six part notes; quantities of one except two Wio units; alternating “Considering” and “Have it”; one affiliate flag.
- Distinct 127–137-character example buying links containing a creator reference and campaign parameters.

The Unicode variant changes the title to `週末の無線ベンチ — radio lab 📻`, author to `@工作室_Émilie`, and uses mixed Japanese/English multiline notes. Its story and custom-parts fields are shorter in UTF-16 units than the English fixture; percent encoding still made the old URL substantially longer.

Saturated fixtures fill **every normalized field budget**: name 64, author 40, immediate credit 120, earliest credit 120, story 500, custom parts 240, and six notes of 160 UTF-16 units each. Quantities are 99; all six affiliate flags are true. Project, photo and all six buying URLs are each 400 characters. The six longest current catalog slugs are used:

```text
rak-wisblock-meshtastic-starter-kit
digilent-analog-discovery-3
cerberus-development-board
slim-signal-sleuth-v1-1
nasa-artemis-watch-2-0
heltec-mesh-node-t114
```

Repeated-character fixtures use `x` or `界`. The reserved-link fixture uses `https://example.invalid/?` followed by enough `&` characters to reach 400; this is syntactically accepted by the current URL validator, but deliberately atypical of a real buying link. No example buying link was fetched.

The varied fixture uses a deterministic xorshift32 generator seeded with `0x5eed1234`, CJK code points `0x4e00 + (value % 20992)`, and distinct 400-character alphanumeric example URLs. Its immediate and earliest credits differ, so the caption includes both. These are saturated-field stress cases, not a claim to have found a mathematical upper bound over every possible catalog and Unicode string.

## Findings in the original implementation

### 1. The server could reject a valid setup

`kitURL` put the full setup into the query, including JSON item details and eight possible URLs. `kitFromURL` limited decoded item JSON to 10,000 units, but the saturated cases had only 3,983 units of item JSON. They passed application normalization while failing the earlier HTTP parsing step.

The dev server uses `http.createServer` without a `maxHeaderSize` override. The measured runtime reports `http.maxHeaderSize === 16384`. Node documents the default 16 KiB request-header limit and its HTTP 431 response for parser overflow. The observed large-request failures are consistent with that mechanism; this is not a measured public-hosting limit. [Node v24.5.0 HTTP documentation](https://nodejs.org/download/release/v24.5.0/docs/api/http.html#event-clienterror)

A fragment is separated before URI retrieval, which is why the new GET request excludes its snapshot payload. [RFC 3986, section 3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5)

### 2. A UTF-16 slice could damage an emoji

Before the fix, a name made from 63 `A` characters followed by `📻` was sliced to 64 UTF-16 units. The last unit was an unmatched high surrogate (`d83d`). URL serialization replaced it with `fffd`, so the shared name differed from the saved name.

The bounded helper now stops before a complete code point would exceed the same budget. It also replaces already malformed, isolated surrogate input consistently. It preserves code points, not whole grapheme clusters: a complex emoji sequence or combining-mark sequence can still end at a field boundary, but valid code points are not split.

### 3. Full captions duplicate the snapshot content

The caption contains readable part names, quantities, states, notes, credits and project URL, followed by a URL that also serializes the setup. This is useful as a full export but expensive as a post caption. Neither the caption nor URL is silently shortened by this fix.

The optional local export photo is not in the kit, URL or caption and does not affect these measurements. A user-supplied remote photo URL in the setup is different: its address is included in the snapshot, but its image bytes are not.

### 4. Local links are accurately labeled

Root's `shareLinkNotice` already adds a local-preview warning to the share action and caption. The current measurements include that warning. It does not imply that a non-local hostname is deployed or publicly accessible.

## Exact API and caller integration

```js
// Existing calls remain valid for query-only links.
kitFromURL(search, catalog, hash = '')

// Required at initial setup load and during both navigation events:
shared = kitFromURL(location.search, catalog, location.hash);

const readLocation = () => {
  shared = kitFromURL(location.search, catalog, location.hash);
  render(true);
};
window.addEventListener('popstate', readLocation);
window.addEventListener('hashchange', readLocation);
```

Root has staged these updates in `public/kits.js`; this subtask did not edit that file. Existing callers of `kitURL`, including collection/workbench presets that supply partial kits, retain the same function signature and do not need a catalog argument. Existing preview, copy-link and exporter calls can use the returned URL unchanged.

Format rules:

1. Keep the old query URL when the relative path plus query is at most `KIT_QUERY_MAX_LENGTH`, currently 1,800 characters. This is an application cutover, **not** a claimed browser or platform maximum.
2. Otherwise serialize known setup fields into JSON, omitting empty top-level fields and default item values. Encode UTF-8 bytes as unpadded base64url, prefixed with `#kit=v1.`. No compression dependency or network request is used.
3. Bound encoded length before decoding; bound decoded bytes to `KIT_FRAGMENT_MAX_BYTES`, currently 16 KiB. Require canonical base64url, valid UTF-8, valid JSON, a top-level object and a devices array. Normalize the decoded object through the existing catalog and field rules.
4. A recognized `#kit=` payload wins over a query snapshot. If it is malformed, oversized or an unsupported version, return `null`; do not load a different query kit. An unrelated anchor such as `#parts` leaves legacy query parsing intact.

**UI follow-up:** because `null` also means “no shared setup,” root should distinguish a rejected `#kit=` link in the page UI and show a readable invalid-link message. Do not imply that an unrelated saved draft is the rejected shared setup.

Old query URLs still decode exactly when they reach JavaScript. An old over-limit query URL can still be rejected before the page loads; changing the parser cannot repair a URL that the server never serves. Re-sharing its saved setup produces the new format. No server limit was raised.

The fragment is not encryption, a stored account record, or a verified authorship signature. Anyone given the full URL can decode its notes. This preserves the previous snapshot-sharing semantics.

## Platform usability: verified scope only

### YouTube video descriptions

YouTube documents a 5,000-character limit for video descriptions. Both realistic fixtures now fall below 5,000 by the measured UTF-16 and code-point counts; the full-field captions remain well above it. The English realistic caption leaves only 230 units for a creator's introduction, disclosures and other links. This is a counting comparison, not a successful platform upload test. [YouTube upload documentation](https://support.google.com/youtube/answer/57407?hl=en)

### Standard X posts

X documents 280 weighted characters and counts a recognized URL as 23 characters regardless of its actual length. It weights CJK and emoji differently from ordinary Latin text. The minimal six-part caption alone contains 402 UTF-16 units outside its setup URL, so it already exceeds a standard post's budget even if the link receives X's short URL weight. X's shortening does not fix a destination server rejecting the target. [X character-count documentation](https://docs.x.com/fundamentals/counting-characters)

### Instagram and other destinations

The official Meta publishing/reference pages returned HTTP 429 to the research tool during this pass. No numeric Instagram caption or link limit is asserted from secondary sources. Actual paste, link recognition and fragment preservation still need platform-specific checks with user-authorized posting/draft workflows. This audit made no platform submissions. [Meta publishing documentation](https://developers.facebook.com/docs/instagram-platform/content-publishing/)

## Smallest useful next product changes

1. **Separate a short post caption from the full setup export.** Keep full notes and credits in the snapshot and Markdown export. Offer a concise post introduction plus explicit copy-link action; preserve creator/remix credit. Never cut the snapshot URL to fit a count.
2. **Show counts without claiming universal acceptance.** Name a target platform only when its current counting rules are implemented. If a full caption is too long, offer the short version or full parts file instead of a success message implying it will post unchanged.
3. **Keep the existing Markdown fallback prominent.** It already preserves creator buying links, disclosure labels, requirements and notes independently of the URL. This audit did not add an import flow.
4. **Validate real destination handling before describing sharing as effortless.** Test copy/paste and fragment preservation on selected creator channels. A larger decoded-byte limit or server-header override would not solve social caption budgets.
5. **Treat short, hosted setup pages as a separate product step.** An explicit publish flow with immutable snapshot IDs could support short links and per-build preview metadata. It needs hosting, persistence and clear creator control; this change creates none of those things. Public deployment is still a separate requirement for the current local preview.

Compression was considered but not introduced: repeated-character fixtures compress misleadingly well, while varied content remains much larger. The bounded synchronous fragment change fixes the verified request failure with fewer moving parts. It is a useful interim transport, not a complete social publishing system.

## Validation completed

```sh
node --test test/kits.test.mjs test/setup-card.test.mjs
```

Result: 28 passed, 0 failed. Coverage includes old query URLs, unchanged short links, all bounded text fields and remix prefix, malformed input surrogates, realistic six-device Unicode, all-full fields with 400-character buying links, custom-only builds, preserved credits/states/links, malformed and noncanonical base64, invalid UTF-8/JSON, unknown fragment versions, exact byte-boundary rejection, and unchanged card captions/layout behavior.

Read-only HTTP verification additionally covered all seven before/after fixtures. Browser navigation, actual local-photo PNG QA, platform paste behavior and the full main build remain root-owned checks.

## Root browser integration — 16 September

The integrated main preview renders a six-device Unicode snapshot with quantities, creator buying URLs, affiliate labels, full multiline notes and both remix credits. Hash-only navigation to a second three-device snapshot, browser Back and Forward, and exact complete-link copy passed without changing the visitor draft. The 320px layout has no document overflow. After a fresh document load, an unsupported `#kit=v2.bad` shows the explicit invalid-link notice and retains the original draft. Open tabs must reload after local source rebuilds to receive changed HTML/modules. The short-caption exporter now separates the post text from Copy setup link and collapsed Full details; the prior caption-size measurements above refer to that full export.
