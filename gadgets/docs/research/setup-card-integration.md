# Setup card export

Implemented and revised 16 September 2026. This is a local PNG exporter for a creator’s actual setup snapshot, using original gadgets.sh graphics, text and an optional creator-selected local build photo. “Create a post” now starts with a short editable caption and a separate setup-link action; full details remain available. It does not fetch remote/catalog photos or publish anything.

## Integration API

```js
import {initSetupCardDialog} from './setup-card.js';
// kits.mjs already supplies kitURL in public/kits.js.

// Create once, on the setup page. This creates the closed native dialog.
const setupCards = initSetupCardDialog();

// Call from the primary #export-card “Create a post” action.
async function exportSetupCard() {
  try {
    await setupCards.open({
      kit: current(), // normalized current draft OR the currently viewed shared setup
      catalog,
      shareURL: new URL(kitURL(current()), location.origin).href,
      format: 'feed' // optional: 'feed', 'story', or 'wide'
    });
  } catch (error) {
    // Reserved for unavailable native <dialog>, destroyed instance, or failure to open.
    notify(error.message || 'The setup card preview could not open.');
  }
}
```

`open(input)` returns `Promise<boolean>`: `true` means the preview was rendered; `false` means a recoverable input/render error is shown in the dialog, or the user closed it while rendering. A successful open does not initiate a download or copy to the clipboard. Every call uses a fresh snapshot of the caller’s data.

`close()` closes the preview. `destroy()` closes/removes the dialog, invalidates pending work, and revokes any outstanding Blob URLs. Both can be called repeatedly. `initSetupCardDialog({container})` optionally accepts a DOM container; the default is `document.body`.

**No dialog caller changes are required for this caption revision.** The main setup entry is the primary `#export-card` **Create a post** action. `#export-kit` **More share options** offers **Setup link** and **Parts list**. The dialog's existing `open`/`close`/`destroy` API is unchanged.

The dialog includes an optional local file picker, a Remove photo action, and Fill frame / Show whole photo framing controls. Every `open()` starts without a local photo; close/destroy clears it. Do not pass a photo URL or add file data to the kit model.

### Caption model API

The original full export API is unchanged:

```js
model.caption                     // full parts, notes, credits and exact setup URL
setupCardCaption(model)           // generates that same full export
```

Additive fields and helpers:

```js
model.postText                    // short editable starting text; no automatic setup URL
model.postCredits                 // visible creator, immediate remix and earliest credit
model.postCaption                 // default postText plus those credits
setupCardPostCaption(model, text) // edited text plus unchanged credits; no URL truncation
setupCardCaptionCount(text)       // Unicode code-point count, including spaces/newlines
```

The initial post text is the build title, plus a short excerpt of the creator's story or custom-parts note when present. The excerpt is labelled “Build note” and bounded to 160 grapheme clusters; full notes are retained in the full export and snapshot. No synthetic build outcome, ownership state or compatibility statement is added.

The editable textarea contains the post text. Attribution appears immediately below it and is included when **Copy caption** is clicked; editing post text does not remove the current creator, immediate parent or earliest known credit. Repeated immediate/earliest credit is shown once. Blank creator credit stays blank. The count covers exactly the copied text including those credits, using the visible label “characters (Unicode code points).” It is not a platform-specific remaining-character allowance.

Caption edits are local to the open dialog. They do not change the setup, URL, image or full-details export, and remain intact through photo/format changes. Reopening starts from the caller's fresh snapshot. The helper does not shorten user-edited text or URLs a creator chooses to paste into that text.

The renderer is also exported for a caller that already owns its Canvas:

```js
import {createSetupCardModel} from './setup-card.mjs';
import {renderSetupCard, readSetupCardPhoto} from './setup-card.js';
const model = createSetupCardModel({kit, catalog, shareURL});
const plan = renderSetupCard(canvas, model, 'story');
// plan.filename, plan.width, plan.height, plan.overflow, plan.hasPhoto

// Optional lower-level use after the user explicitly selects a local file:
const photo = await readSetupCardPhoto(fileInput.files[0]);
try {
  renderSetupCard(canvas, model, 'story', {photo, photoFit:'cover'});
  // Or photoFit:'contain' to show the whole photo without cropping.
} finally {
  photo.dispose(); // Canvas pixels remain; release the decoded source.
}
```

`readSetupCardPhoto(file, {signal} = {})` accepts a local File/Blob with a supported MIME type and matching signature. It returns a frozen `{source, width, height, name, dispose}` handle. Only handles from this helper are accepted by the renderer; remote Image elements and URL strings are not supported. `dispose()` is idempotent. `signal` is optional; the dialog uses it to retire selections on remove/close. A native bitmap decode already in progress may finish before cancellation can dispose its result.

The pure planner has an optional fourth argument: `planSetupCard(model, format, measure, {photo:{width,height}, photoFit:'cover'})`. It uses only decoded dimensions. `setupCardPhotoPlacement` computes bounded, centered cover/contain rectangles. None of these options is written to the setup model, caption or share link.

### Shared-file changes for the integrating agent

The root agent already completed the core integration below. **This revision requires no additional shared-file edits**; rebuild/copy the same modules and stylesheet when ready for QA.

1. Add `setup-card.mjs` to the `src` module-copy list in `scripts/build.mjs`. Its imports of `kits.mjs` / `catalog.mjs` already follow the existing static-module layout.
2. Load `/setup-card.css` on setup pages, after the general and setup styles. `public/setup-card.js` and CSS are copied automatically with the public directory.
3. The primary `#export-card` **Create a post** action calls `open` with `current()`, the catalog, and that snapshot's `kitURL`. The secondary `#export-kit` **More share options** menu contains **Setup link** and **Parts list**. Keep the existing nonempty/field-validation conditions for all export/share actions.
4. Initialize once on the setup page and reuse the instance. No additional storage key, service, package, account, or endpoint is required.

This subagent changed only the five assigned exporter files, without editing shared source/build files or running a build/browser.

## Content and image behavior

| Format | PNG size | Content layout |
| --- | --- | --- |
| Feed | 1080 × 1350 | Large photo frame above the parts; four to six parts use two columns; a single text-only part gets a large panel |
| Story | 1080 × 1920 | Tall photo frame with title, parts and a note excerpt; larger panels for sparse text-only setups |
| Wide | 1200 × 630 | Photo on the left, title/credit/parts on the right; text-only version uses both columns for text |

- Uses the current original geometric G mark in lime `#d5f582` on dark green `#18201b`, with the existing Instrument Sans/system fallback. The app adds no external graphics or third-party logos. The G is drawn with Canvas paths based on the project’s own `brandMark` in `src/templates.mjs`.
- Shows creator text, selected catalog names, quantities, existing part states and an optional local photo. “Considering,” “Need it,” and “Have it” remain distinct. The exporter adds no compatibility, tested-build, sponsorship, product-performance or audience claims.
- The card labels supporting text as **creator’s notes**. Freeform custom parts remain notes; it does not turn arbitrary lines into invented quantities or catalog entries.
- Text has bounded line boxes and measured wrapping. Long names, unbroken words, explicit newlines and emoji are handled; visible truncation uses an ellipsis. A preview caption says when text has been shortened and points to **Full details**. In dense wide/photo cards, notes may be omitted from the image and flagged as shortened; the full-details export retains them.
- Up to six selected catalog entries appear, in the creator’s order. Sparse text-only setups use larger names, quantities and panels, instead of preserving empty six-row space. Custom-only and notes-only setups remain labelled notes, also when a photo is present.
- Both copied captions and full details include the named current creator, immediate remix credit, and earliest known credit when it differs. **An unnamed creator has a blank credit**, preserving the root agent’s change; no placeholder credit appears. Full details include creator part notes and the existing creator project URL, if supplied. Buying links are not added or replaced; the supplied setup snapshot URL retains the complete current state, including creator links already encoded there.

## Optional local build photo

The picker says: “Used only in this PNG. It isn’t added to the shared setup.” It accepts JPEG, PNG and WebP files up to 10 × 1024 × 1024 bytes. MIME type and file signature are checked before decode. Decoded dimensions must be at least 64 pixels per side, at most 10,000 per side, and no more than 24 megapixels. Unsupported SVG/GIF/AVIF files, empty/mismatched files and excessive dimensions produce a readable error. Animated formats, when decoded successfully as PNG/WebP, use the decoder’s default frame; no animation is exported.

The photo fills a centered frame by default. “Show whole photo” contains the complete image without stretching. Text sits outside the photo frame so contrast does not depend on the supplied photo. Format changes reuse the same selected photo and framing choice.

There is no upload, network request or storage write. No local filename, pixel data or object URL is added to the caption or setup URL. An invalid replacement keeps the previous photo; a first invalid selection keeps the text-only export. A drawing failure releases the photo and retries a text-only card. Remove photo returns to the text-only layout. The caption and shared link are unchanged by all photo actions.

`createImageBitmap` is used when available; the fallback creates an Image from a **local Blob URL only**. The helper never sets a remote URL. Decoded bitmaps are closed, fallback Image sources cleared, and temporary photo Blob URLs revoked on replacement, removal, failed decode, close or destroy. Stale native decode results are disposed immediately on completion. Closing also clears Canvas pixels. The fallback decode has a 15-second timeout and can be aborted.

## Sharing model

The supplied `shareURL` must be a complete HTTP or HTTPS URL without credentials, whitespace or control characters. There is deliberately no short-link transformation and no short URL length limit. The exact provided string is retained for **Copy setup link** and the full-details export, including its query or fragment.

The default caption excludes the setup URL. **Copy setup link** is explicit and separate. One collapsed **Full details** disclosure contains the complete read-only export and its own copy action. This prevents a multi-kilobyte stateful URL from dominating the default caption editor while leaving the whole snapshot available.

The full export calls the URL a **setup snapshot** and says the parts and notes are stored in the link. It does not claim a public database permalink, generate a QR code or invent a “link in bio.” The PNG footer now says **Parts & notes in the setup link**. The link helper reminds the creator to keep the complete URL when pasting.

The caller owns URL selection. Root's `shareLinkNotice` remains in the full-details export and is shown next to **Copy setup link** and after successful copying when the destination is local/private. A caller-provided localhost URL remains localhost; the exporter does not invent public hosting. A short caption without a URL does not carry a misleading local-link warning. Public sharing requires an actually reachable instance; this is not an automatic publication step.

The exporter still ignores the setup’s remote `photo` field and all catalog images. Only a separate explicit local file selection supplies photo pixels. This does not assess rights in user-entered text, the selected file, or other parts of the site.

## Dialog and lifecycle

- Native `<dialog>` provides modal semantics, Escape dismissal and focus containment. Header has a 44px close button; focus returns to the initiating control after close. Radio inputs select formats through keyboard or touch; targets exceed 44px.
- Preview appears before the explicit PNG download action becomes available. The default editor is a compact, labelled editable textarea with visible automatic credits and a count. Full details use a separate read-only textarea inside a native disclosure. No automatic clipboard writes or downloads occur on opening or changing format.
- Clipboard write occurs only after **Copy caption**, **Copy setup link**, or **Copy full details**. If unavailable/denied, a normally hidden read-only fallback field shows and selects the exact complete requested output, including automatic credits or the entire link. The dialog gives manual copy instructions and does not falsely report success. Caption input and newer copy actions invalidate stale copy status/fallback updates.
- Canvas errors and null Blob results produce a readable status; rendering can be retried. Download errors keep the preview/caption available.
- Pending render, photo decode, download and clipboard completions are invalidated when relevant state changes or the dialog closes. Downloads are disabled while a photo is being decoded. Rapid close/reopen does not let a queued old close event invalidate the new preview.
- The preview uses Canvas directly. PNG downloads allocate an object URL only on a click; it is revoked after 30 seconds, on close, or on destroy. Temporary download anchors are removed immediately after use. No storage or network calls are made. The dialog waits for the page’s existing fonts to settle; it does not fetch fonts of its own.
- CSS is scoped to the dialog. It supports narrow screens, existing design tokens, forced colors and reduced motion; no animation is necessary for this utility.

## Validation completed

`node --test gadgets/test/setup-card.test.mjs`: **13 tests pass**.

Coverage: short initial post text; unchanged full-export API; edited caption plus preserved credits; Unicode counting; exact long query/fragment URLs; retained local-preview notice; updated footer; ordered quantities/states; full multiline notes; blank unnamed credit; sparse panels; source immutability; grapheme wrapping; invalid links/input; safe filenames. A layout matrix covers all three formats × zero to six parts × photo/no photo × notes/no notes, using long titles, creator names and part names: **84 combinations**. It checks Canvas bounds, measured text widths, separation of text boxes, text/photo separation and panel containment. Additional checks cover centered cover/contain proportions and invalid file signatures/types/sizes/dimensions. `node --check gadgets/public/setup-card.js` also passes.

The root agent reported successful earlier exporter Arc checks. This caption revision still needs root's mobile/desktop copy-and-download QA. No full build, browser session or generated image artifact was produced by this subagent.

### Arc checks for the integrating agent

1. Open from both a draft and a shared setup; confirm the correct snapshot appears and no download starts.
2. Inspect feed, story and wide at desktop and narrow mobile width: a one-part/no-story text-only setup, six parts with long names, and a custom-only setup. Verify large sparse panels and blank unnamed credit.
3. Explicitly choose a local JPEG/PNG/WebP; inspect all formats and both framing modes. Check title/credit, all quantities/states and the caption. Download each format and verify PNG dimensions, photo pixels and filename. Confirm switching format or replacing a photo during PNG encoding cannot save stale work.
4. Confirm the short default caption has no automatic setup URL. Edit the text; change photo/format; verify the edits remain and copied text includes both remix credits plus named creator. Check the count against the copied text. Copy the setup link separately and compare it byte-for-byte. Open **Full details** and copy the unchanged full export. Deny/disable clipboard access for all three actions: the fallback must select each entire requested value and report manual-copy instructions.
5. Test an invalid type, a mismatched signature, a file over 10 MB, and decoded dimensions over 24 MP. Errors should preserve the previous valid preview. Remove the photo; cancel the picker; select the same file again. Check keyboard access to picker/framing/remove.
6. Close during photo decode or font preparation, then reopen; verify the photo is cleared, the default caption is restored, focus returns, and stale work cannot replace the new preview. Confirm caption edits and the shared setup URL are unchanged by photo selection/removal. Verify Full details starts collapsed and the manual-copy fallback is hidden on every fresh open.

## Guidance used

Read [mobile-app-ui-design](../../../../.agents/skills/mobile-app-ui-design/SKILL.md) and [apple-design-web](../../../../.agents/skills/apple-design-web/SKILL.md) from `/Users/maxmohammadi/.agents/skills`. Applied simple hierarchy, 44px targets, calm palette, predictable feedback, progressive vanilla JavaScript, and a low-motion utility dialog. Also read the project’s tokens, brand, setup model, share flow and module-copy arrangement.

## Integrated Arc caption review — 16 September

At 320 CSS pixels, a six-device Unicode snapshot opens with a concise caption and all three attribution lines. Editing the caption and changing to Wide retains the edits and leaves the draft/full export unchanged. Copy caption produces exactly the edited text plus credits; the displayed code-point count matches. Copy setup link preserves the complete 6,744-character fragment URL, with the local-preview notice. Copy full details preserves the full 8,965-character export. Denied-clipboard checks for all three actions select the exact entire requested value and show manual instructions. Escape returns focus to Create a post and clears the Canvas to 1 × 1; reopening restores the default caption and collapses Full details/manual fallback. The integrated suite has 91 passing checks. These are local desktop Arc checks at a narrow width, not social-platform posting or physical-phone validation. Earlier photo-format checks remain applicable; this pass did not redo unchanged image decoding.
