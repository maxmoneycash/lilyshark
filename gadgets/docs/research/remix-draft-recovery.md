# Remix draft recovery

Implemented 2026-09-16 in `public/kits.js`. This extends the existing one-step, in-memory Undo behavior; it does not add a setup library or change shared snapshots.

## Behavior for QA

| Action | Expected result |
| --- | --- |
| Remix while a draft has parts, notes, credit, links, a photo URL or a custom name | Save an independent copy of that draft as the recovery point, then open the existing `remixKit` result. |
| Remix with an untouched empty draft | Open the remix. Do not offer recovery of a meaningless empty setup. If a useful recovery point already exists in this page, retain it. |
| Start a new setup | Remember the current nonempty draft, then clear the editor. Clicking again while it is empty does not erase the recovery point. |
| Replace another nonempty draft during the same page session | The most recently replaced draft becomes the single recovery point. The helper names it; earlier versions are not a history stack. |
| Restore previous setup | Replace the current editor with the remembered draft, including quantities, ownership states and notes; consume the recovery point; persist and focus the name field. There is no redo. |
| Storage write fails during any action | Keep the current editor and in-memory recovery usable. Show the existing storage warning, and do not show a success message claiming the setup was saved. Export before leaving. |
| Reload or navigate away | Recovery is lost, as stated next to the button. Reload reads the last successfully stored current draft. A failed write must not be described as surviving reload. |
| Revisit the shared source with Back, then remix again | The source snapshot remains unchanged. The current local draft becomes the new recovery point. |

## Selectors

- `#remix-kit`: start a remix.
- `#reset-kit`: start a new setup.
- `#undo-reset-kit`: existing control, relabeled **Restore previous setup**; hidden when there is no recovery point.
- `#kit-restore-help`: static helper beside the setup name naming the recovered setup and the leave/reload limit; connected with `aria-describedby`.
- `#kit-save-state`: existing persistent storage status.
- `#kit-name`: focus destination after replacement or restoration.

`remixKit` itself is unchanged: source attribution survives and the copied ownership states become Considering. No shared URL payload is edited. Validation performed here: `node --check public/kits.js` passed. Root owns browser and integration QA.

## Root integration and Arc checks

Recovery now appears in a compact panel immediately before the setup name, with a 44px action, so it stays visible when the name field receives focus on a 320px viewport. The panel hides in shared views and when consumed. Root verified exact restoration of the prior saved draft after remix and repeated empty reset, preserved quantities/notes/ownership, source preview without draft mutation, and focus return. A controlled storage-write rejection kept the existing stored draft unchanged, retained in-memory recovery, displayed the warning and suppressed saved-success messages. After removing the stub and reloading, the previously stored draft returned and recovery was absent as stated.


A second review found that cross-tab updates could replace unsaved notes after a failed write. The storage-event handler now preserves the local editor while writes remain unsaved and explains the conflict. A controlled StorageEvent in Arc retained the unsaved story and the exact stored bytes; removing the write-failure stub and reloading returned the previous saved draft. This checks the handler, not a physical two-tab race.
