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

## Next (pick one per round)

1. Traffic table: freeze first columns, filter row
2. Intro: DialKit-tuned constants copied into code; drop unused knobs
3. Intro: DialKit-tuned constants copied into code; drop unused knobs
4. Header CONNECT label morph (CONNECT / CANCEL / LINKED)
5. Docs/Paper: measure, images, sticky section tabs
