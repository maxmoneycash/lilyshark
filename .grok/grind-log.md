# Lilyshark UI grind log

Worktree: `/Users/maxmohammadi/lilyshark-flash-polish`
Ship: `git push origin HEAD:main` after `tsc --noEmit` and tests.
Do not touch `ios/`. No Tailwind/shadcn dump. No decorative chrome.

## Done

- Intro chrome stripped (pager, drag/pause/reset, channel footer)
- Connect buttons tappable on iPhone with Apple-API copy
- T-Deck AgX + emissive LCD
- Traffic phone toolbar 2-col, animated stats
- Copy button morph, press scale 0.97, hover gated to fine pointers
- Unread dot on hamburger
- Sticky chat composer on phone
- Connect-sheet error shake
- DialKit (dev only) on T-Deck camera/light knobs
- Flash installer scaled for a 390px phone
- Chat phone dock: wrapping tools, 44px targets, failed-send --err shake
- Nodes roster: wrapping rows, no sideways page scroll, empty state copy
- Map HUD/chips wrap; phone hint is tap/long-press, not right-click
- Spectrum waterfall fills the phone; Telemetry plot no longer donates 80px to a missing legend; controls wrap
- Config theme tiles with swatches; duration fields as unit-suffixed inputs
- Traffic table freezes # and TIME; filter wraps as a phone row
- CONNECT morphs CONNECT / CANCEL / LINKED in place
- Intro T-Deck look baked as TDECK_SCENE; DialKit keeps only framing/breathe; camera faces the LCD
- Docs/Paper: sticky Docs/Paper tabs, sticky PDF toolbar, phone-width pages, 44px doc nav
- Mesh graph lays out in CSS pixels with 18px hit targets; toolbar wraps; activity name column stays put
- Sniffer bars wrap as 44px keys; NOTE/TIME freeze; CLOSE is thumb-sized
- Shelby wire format wraps to the measure; registry freezes OBJECT; hex breaks instead of shoving the page

## Next (pick one per round)

1. Hex dump / dissection pane on a phone
