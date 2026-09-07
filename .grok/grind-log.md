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

## Next (pick one per round)

1. Map: HUD overlap, full-height wrap, chip row wrap
2. Telemetry/Spectrum plots: height, controls wrapping
3. Config: duration fields, theme tiles press
4. Traffic table: freeze first columns, filter row
5. Intro: DialKit-tuned constants copied into code; drop unused knobs
6. Header CONNECT label morph (CONNECT / CANCEL / LINKED)
7. Docs/Paper: measure, images, sticky section tabs
