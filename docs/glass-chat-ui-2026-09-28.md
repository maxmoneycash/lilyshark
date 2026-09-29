# Liquid Glass chat — September 28, 2026

Max asked for the iOS chat to use
[Appllama's Liquid Glass Chat UI](https://github.com/Appllama/liquid-glass-chat-ui).
That project is Expo / React Native and this app is native SwiftUI, so the
design was ported, not the code. The base is its Cookbook 2 ("Astra"): glass
bubbles, a floating glass composer with a separate send button, a glass search
field with filter chips, and airy inbox rows. Every borrowed value is quoted
beside its use in `ios/Shared/Views/GlassChat.swift` and `InboxRows.swift`, and
the design is credited in `ios/ATTRIBUTION.md`. No artwork, sample people or
branding from that repository is used.

Branch `agent/liquid-glass-chat`. Nothing was installed on a phone or released.

## What changed

| Before | After |
| --- | --- |
| Flat beige (incoming) and green-on-pink (outgoing) rounded rectangles. | Glass bubbles: white glass for them, pink-tinted glass for you, radius 27 with the sender-side lower corner at 15. On iOS 18-25 the same shapes and tints use a frosted material instead of Liquid Glass. |
| Time, delivery, hops, SNR and a "..." button under every message. | One quiet footer at the end of each run of messages from the same sender, broken by a five-minute pause. An outgoing message that is still unconfirmed or has failed keeps its own footer anywhere in a run, so a stuck message is never hidden behind a later delivered one. |
| The per-message "..." menu existed because text selection competed with the long press. | Bubble text is no longer selectable, so a long press opens the actions directly, as in Messages. Copy Text is in that menu; VoiceOver gets named actions (details, quote, copy, forward). Signal path moved into the same menu. |
| The composer sat on a bar with a divider. | The composer floats: a 58pt glass field with a + (share my location) and a 52pt glass send button that turns pink when there is something to send. Messages scroll under it with a fade behind it. The location button left the channel toolbar for the +. |
| Conversations kept the tab bar under the composer. | On a phone an open conversation fills the screen. iPad keeps its tabs. |
| No portraits. | Mesh nodes have no photos, so each node is a glass marble tinted from its public key (stable across launches and phones), with initials or a symbol for rooms, repeaters and sensors, and a green dot if heard in the last 15 minutes. It appears in the header, beside the last bubble of an incoming run, and in the inbox. Channel speakers are tinted from their name. |
| Inbox: sidebar list, system search, a filter menu, a column of flags per row. | Phone inbox: glass search field, All / Unread / Channels / Favourites chips, rows with a 56pt orb, name and time on one line, a one-line preview, and a pink unread dot. Draft and not-delivered states are the preview itself. No separators or chevrons. The iPad sidebar, the Mac and the contact book are unchanged. |
| Date lines and a "New Messages" rule. | Astra's small centred day heading, and a glass "New messages" capsule. |

Motion: a message that arrives while the conversation is open rises 36pt and
grows from 86% x 78% on Astra's arrival spring (damping 23, stiffness 245,
mass 0.7). Opening a conversation does not replay it. The send button squeezes
to 82% and springs back. Reduce Motion turns both off through `meshAnimation`.

## Verification

- iOS Simulator, both the fixture build and the plain app without fixture flags
  (iPhone 17 Pro, iOS 26.5): **BUILD SUCCEEDED**.
- macOS (`PommeCore-macOS`): **BUILD SUCCEEDED**. Only the Combine warnings that
  were there before this pass.
- `scripts/check_ios_design.py`: design system honoured across 118 files (it
  caught one hardcoded glyph size in the composer, now fixed).
- `scripts/check_sheet_chrome.py`: pass. `ios/scripts/verify_principles.sh`: 9/9.
- `scripts/add_ios_source.py --check`: every tracked Swift file is compiled.
  The script gained `--like FILE`, so a view that only the phone and Mac compile
  can copy one of their memberships instead of Theme.swift's, which includes
  the watch app.

Screens, from one launch of the fixture's new tour mode
(`-uiFixtureScenario conversation -uiFixtureTour YES`):

- [Inbox](qa/glass-chat-2026-09-28/inbox.png): large title, glass search,
  chips, orb rows, pink unread dots, tab bar present.
- [Direct conversation](qa/glass-chat-2026-09-28/direct.png): runs, a quote, a
  heart reaction hanging off a bubble, a shared position, Delivered and Radio
  accepted footers, no tab bar.
- [Channel](qa/glass-chat-2026-09-28/channel.png): three speakers, each with
  their own orb and a name above their run; Jordan's two messages share one orb
  and one footer.
- [Room](qa/glass-chat-2026-09-28/room.png): header orb, sender orb, no + (rooms
  never had location sharing).

The bubble tail was checked at full resolution: the lower sender-side corner is
visibly tighter than the other three.

At the largest accessibility text size (`-uiFixtureTextSize largest`), channel
bubbles wrap cleanly and the outgoing footer stacks as intended. That pass also
found two defects, both now fixed in code:
- **Inbox rows:** the name shared its line with the time and broke mid-word
  ("Pub-lic"). At accessibility sizes the row now stacks: orb and unread dot,
  then the name, the time, and a three-line preview.
- **Composer:** the + touched the "Message" placeholder. The spacing is wider.

Both fixes compile, but they have not been seen on screen: every later launch
timed out under the machine's load.

## Not verified

- **Nothing with touch input.** Argent's MCP server was not connecting, and the
  machine carried a load average of 400-1,000 from other sessions, so every
  check here is a launched screen. Long-press menus, typing, sending, the
  arrival animation, chip filtering, swipe actions and the + menu were built
  but not exercised.
- Physical iPhone and a real radio.
- iPad, Mac visuals, dark appearance, and iOS 18-25 (the non-glass fallback).
- Portrait ribbon and photo zoom from Astra were not ported: the ribbon needs a
  set of people the app considers yours, which mesh nodes are not yet, and
  mesh messages carry no photos.

## Also fixed on this machine

Every Xcode build that compiled an asset catalog hung: `actool` waited forever
on a lock in its shared tool-server registry (`IBCLIServerRegistryCopyDequeuedPipes`),
left behind by a crashed tool. Another project's `actool` had been stuck on it
for 17 hours. `actool --clear-shared-memory` hangs on the same lock, so the
segment was unlinked directly (`shm_unlink("ibEwHbEQAAAAC3hgEA9QEAAPUBAAA")`,
the name read from `IBToolDebugLogLevel=3 IBToolDebugLogFile=...`). New runs
create a fresh one. If builds hang at "actool --version" again, that is the fix.
