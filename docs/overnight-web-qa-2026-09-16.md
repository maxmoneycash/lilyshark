# Web work and QA — September 16, 2026

Current pass verified locally. The user requested continued overnight work and
`/workflows`, then narrowed the intro to its title, a few sentences, and a smaller
device. Work started around 00:25 Pacific. No commit, push, or publication.
Existing native and firmware work is preserved.

## Simple intro

Removed every routing diagram and chapter action row. Each chapter contains only
its title, paragraph, and 3D T-Deck. Kept 12 chapters and 33 curated firmware
screens. Removed the unused diagram/action/progress/hint styles too.

The mobile device is roughly a quarter smaller on a 390px phone; desktop maximum
height is 620px. Short phones give the paragraph priority and shrink the device.
Checked 390×844, 540×960, 320×568, 844×390 landscape, and 1440×900 desktop, including
the long paragraph and former routing chapter. Zero diagram components and zero
buttons inside the intro body. Header connect/navigation remains available.

Touch gestures beginning over the model scroll vertically: observed scrollTop
0 → 271 downward and 271 → 0 upward. The reverse gesture tool call timed out;
a subsequent DOM read confirmed the actual return to zero. Other gesture logic
is unchanged: horizontal drags rotate; reduced motion disables idle movement.
Physical Safari was not tested in this pass.

- [Phone](qa/web-2026-09-16/intro-phone.png)
- [Small phone / long paragraph](qa/web-2026-09-16/intro-small-phone.png)
- [Wide phone](qa/web-2026-09-16/intro-wide-phone.png)
- [Desktop](qa/web-2026-09-16/intro-desktop.png)
- [Landscape](qa/web-2026-09-16/intro-landscape.png)
- [Former diagram chapter](qa/web-2026-09-16/intro-without-diagram.png)

## Real data and explicit samples

Normal startup creates no sample nodes, messages, unread badges, or captures.
Connect → Explore sample data starts a visibly marked demo. Exit removes its
nodes, messages, own sample sends, delayed replies, and automatic capture slots.
Samples carry explicit ownership and never write into radio history. Cleanup
preserves real high-numbered identities and actual replacement channels.

Real network data ends a sample session before entering the store, including
when it reuses a sample node number. A saved node or active connection prevents
starting demo. Explicitly opened capture files remain available after demo exit.
Normal Traffic opens empty; the optional SAMPLE action and explicit #resolve
link remain. Browser verified demo entry → sample/live capture → Exit demo → no
open captures, then Nodes → zero detected. [Exit evidence](qa/web-2026-09-16/exit-demo.png).

Internet relay is now off unless the user explicitly enabled it. Config explains
that enabling it shares received packet contents, including reported positions
and decoded text. Browser confirmed relay OFF; no relay preference was cleared.

## Public MeshCore map

MeshCore is the default map; My mesh remains the radio view. The directory requires
full public keys and valid coordinates, includes contacts/repeaters/rooms/sensors,
and deduplicates by full identity. A regional survey cannot replace public nodes.
Regional survey requests are explicit instead of failing automatically at startup.

Details distinguish advertisement date, record update date, and source; dates
include the year. Endor Station showed a 2024 advertisement and a September 2026
record update. Official source records use the full published public key.

The first live download contained 62,216 positioned identities; a subsequent
refresh returned 62,222 at 01:17 Pacific. IndexedDB saves positions. Blocking only
`/api/mesh-directory` retained the nodes during failed refresh and after a page
reload. The refresh button disables while loading and failures appear inside
Map data as well as on the map. All task-specific request interception removed.
Offline basemap downloading was not implemented or tested.

Search results are memoized to avoid rebuilding a 62k-node result list on unrelated
renders. My mesh popups escape names/descriptions; Leaflet tooltips use text nodes.
Generated and internet nodes also have explicit source labels in Nodes/details.

- [Public map](qa/web-2026-09-16/public-map-phone.png)
- [Distinct dates/source](qa/web-2026-09-16/public-node-dates.png)
- [Saved map during failed refresh](qa/web-2026-09-16/saved-map-refresh-failure.png)
- [Saved map after reload](qa/web-2026-09-16/saved-map-after-reload.png)
- [Refresh feedback](qa/web-2026-09-16/map-refresh-feedback.png)

## Messaging and saved history

Drafts belong to a conversation and radio identity. They survive tab navigation
and page reload when storage is available. Radio-specific drafts return when the
same identity is known again; reconnect is required after a cold page reload.
Reply references stay with their draft. Failed pre-queue sends restore only the
original empty draft, without overwriting newer writing or another conversation.
Browser confirmed navigation/reload retention, the UTF-8 byte limit, and cleanup
of the temporary QA draft. No radio messages were sent.

Storage events synchronize drafts across tabs. A stale tab checks the stored
revision before consuming a draft, and an asynchronous failure checks for newer
saved writing before restoring. Storage failure retains writing in memory with
an explicit limited-lifetime message. Sample drafts never persist.

History saves failure details and original message reception measurements, along
with node source, advertisement time, and path. Reloaded pending sends become
unconfirmed failures requiring an explicit retry. Message state writes target
both packet ID and timestamp, preventing same-ID rows from changing together.

Asynchronous history loading merges beneath live observations. Real radio updates
replace prior external/generated evidence, without retaining coordinates the
radio never reported. Local favorites/ignore edits preserve source. Late history
cannot restore an external position onto a node subsequently heard by radio.
Volatile node battery/SNR/RSSI remain absent after reload.

## Validation and review

- Final full web suite: **654 tests passed**, 42 suites, zero failures.
- Final focused draft suite: 9 tests passed.
- Final TypeScript check and production build passed. Vite retains its existing
  large-chunk advisory; the build generated the offline worker successfully.
- `git diff --check` passed.
- Four read-only review roles used the installed review-and-simplify-changes skill.
  Fixed confirmed source transition, demo ownership, stale draft, repeated search,
  and dead style findings. Clarified radio-draft restoration behavior in docs.

## Environment and remaining limits

Preview: http://127.0.0.1:5173/. Verified in the dedicated Arc/Playwriter session 31;
no other browser was launched. Browser tooling overlays part of the header in
screenshots; keyboard activation bypassed that overlay. Wallet extensions report
provider override errors distinct from application errors. Compound automation
calls occasionally timed out after completing their actions; subsequent observations
established the resulting state.

Use ARM Node `/Users/maxmohammadi/.nvm/versions/node/v22.22.1/bin/node`. The default
x64 Node cannot use installed ARM Rollup. Dependencies were not reinstalled.

The existing Rhai overnight workflow contains stale branch/port/screen-count and
push instructions, so it was not run. This pass followed audit → fix → browser QA
→ tests manually. No background workflow or overnight scheduler was started.

Physical iPhone/radio transmission, reconnection, and delivery receipts remain
unverified here. Public directory membership does not prove current reachability
or reception by this radio. Web history still uses its existing shared browser
database; native per-radio encrypted browsing snapshots are documented separately.
