# Web polish preferences — 2026-09-08

The user wants sustained mobile and desktop dogfooding across the web app. Keep
the existing pink terminal identity. Fix actual clipping, wasted space, confusing
flows, and rendering defects; do not add controls to compensate for weak defaults.

Copy must engage curious technical people and radio enthusiasts together. Lead
with a clear use or interesting observation, then give concrete radio details.
Keep protocol names and useful measurements. Explain unfamiliar abbreviations in
context. Avoid both generic marketing fluff and acronym-heavy specifications.

Latest correction: the user rejected the rewritten intro and explicitly requested
ALL copy and device screens currently deployed on lilyshark.com. This supersedes
the previous six/ten-screen curation and omission of setup/settings. Restore the
verbatim 12 chapters and 42 screens from main-BwMualIR.js (2026-09-08), with their
original production PNGs. Splash opens the tour; the original numbered Home menu
follows. Do not rewrite or curate this copy without a new request. Keep the model
crisp and separated from the copy. Do not restore Full device / Screen detail controls.
Remove the intro's side navigation circles entirely. Keep headings naturally
wrapped, with restrained motion and readable spacing on phones and desktops.

## Requested skills

Read and use the full skills when relevant; these notes are reminders, not a
replacement for the source. The user explicitly requested both sources:

- Apple Design: https://github.com/emilkowalski/skills/tree/main/skills/apple-design
  Installed at `/Users/maxmohammadi/.agents/skills/apple-design/SKILL.md`.
  Verified byte-identical to upstream on 2026-09-08.
- Appllama: https://github.com/Appllama/appllama-skills
  Installed `appllama-app-design-skill` and `appllama-usage` under
  `/Users/maxmohammadi/.codex/skills/`, including their references.

Apply: immediate press feedback; interruptible direct manipulation; consistent
navigation; clear type hierarchy; stable loading states; deliberate spacing;
native browser controls; reduced-motion support; complete flow verification,
including keyboard, scroll limits, safe areas, empty/error states and both themes.
The project is React/Vite web, not React Native: preserve its stack and identity.
Do not apply native-only APIs or add glass/blur over the device to imitate Apple.
Appllama's MCP is not connected, so do not claim its reference library was used.

## Browser QA

Arc/Playwriter remains preferred. The user explicitly allowed other automation
tools on 2026-09-08 after Arc's extension repeatedly disconnected. Argent is
available for native Safari on iPhone simulator and an isolated Electron harness
in `/tmp/lilyshark-web-qa` (no changes to user browser profiles). Discover elements
before taps and scope server cleanup to devices actually used.

## Completed swarm pass — 2026-09-08

Three agents handled Config/Chat, Docs/DB/Nodes, and Flash/Mesh/Telemetry/Sniffer/
Shelby. Root integrated the intro, model, shared layout, Spectrum rendering,
and browser checks. Work remains uncommitted on `codex/ios-everyday-use`.

- Intro: six matched screens/captions; no side circles or view-mode buttons;
  natural heading wrapping; reserved loading space; first LCD failure falls
  back to the photo. LCD uses unlit source colors, housing keeps its materials.
- Mobile: compact conversation/document pickers, usable dialogs/forms, readable
  node/mesh data, compact telemetry, shorter Shelby explanation with expandable
  wire format. Nodes detail opens below the header and returns focus on close.
- Functional fixes: Docs deep links/back navigation/loading races; IndexedDB
  connection recovery; Spectrum peak reset on retune and high-DPI canvas sizing.
- Final validation: 596 web tests, TypeScript, production build, whitespace
  checks all pass. Production preview is `http://127.0.0.1:4173/`.
- Intro geometry checked across all six screens at 320×568, 768×1024,
  844×390, and 1440×968; no horizontal page overflow or clipped copy/footer.
  Normal 390×812 phone layouts also visually reviewed. Reduced motion produces
  no idle animation callbacks; Connect Escape restores focus; forced initial
  LCD decode failure correctly enters fallback. Agents exercised their screens
  at 320/390/768/1440 where applicable, without messages or radio commands.
- Evidence: `/tmp/lilyshark-web-qa/evidence/` and
  `/tmp/lilyshark-config-chat-qa/evidence/`; test/build logs are
  `/tmp/lilyshark-final-web-tests.log` and `/tmp/lilyshark-final-build.log`.
- Native Safari first-screen fit was checked earlier, but the final native
  scrolling/keyboard run was blocked by simulator browser launch timeouts.
  Do not describe that final native flow as verified. Shared booted simulators
  were being used by unrelated agents; the isolated Air attempt was cleaned up.
- The long antenna whip intentionally crosses the top stage edge to preserve
  LCD readability. The camera contains the handset and antenna base; it does
  not fit the complete 295.764 mm antenna assembly. Blender/Three rendering is
  not pixel-identical. No physical radio or firmware flash was tested here.

## Home-screen correction — 2026-09-08

The user rejected the omission of firmware HOME and requested more actual
screens. The intro now opens at HOME and includes ten views across six chapters
(selection listed above), preserving the previous total scroll distance.
Do not revert to six images. The empty READY survey asset is not featured.
Each frame was verified in order with real desktop wheel gestures; all ten
layouts fit at 390×812 and 320×568. Production preview visibly opens the model
with `/intro/fw/home.png`, counter 1 / 10. Tests (596), TypeScript, and build pass.
Opening screenshot: `/tmp/lilyshark-web-qa/evidence/intro-home-mobile.png`.

## Restore deployed content — 2026-09-08

Restored all 12 original headings and paragraphs, the 42-screen order and groupings,
and all 42 original PNGs from the current production domain. Every PNG differed
from the regenerated local assets, including the original numbered Home menu.
Production reference and original local image backups are in
`/tmp/lilyshark-live-restore/`. Existing layout/rendering polish is retained.
The earlier Home correction above is historical and is superseded by this request.

Validation for this restoration: exact string comparison for all 24 text fields,
byte equality for all 42 production PNGs, and exact chapter/group order all pass.
601 web tests pass (596 prior plus the mesh-demo geometry tests). Follow the
latest Arc-only policy for subsequent QA.

## Restore follow-up — 2026-09-08

The two user screenshots at 1:16 PM were deleted as requested (copies kept in
`/tmp/lilyshark-live-restore/user-shots/`). The live 12-chapter copy and 42
screens remain. A Meshtastic-flood / MeshCore-routed illustration sits under
chapters 3–4 without replacing that copy.

`MeshRoutingDemo.tsx` and `meshRoutingDemo.ts` collided on macOS's
case-insensitive disk and blanked the whole app; the geometry module is now
`meshDemo.ts`. On phones the demo no longer steals the handset: the copy column
caps height and scrolls, and the device row keeps a 240px floor.

Arc visual check at 1440×900, 390×844, and 320×568: all 12 headings, 1/42
through 42/42, no horizontal overflow. Antenna whip still exits the top of the
stage on purpose. Dev server: `http://localhost:3002/#intro`.

## Intro 3D-first, orbitable chassis — 2026-09-09

The user still saw a 2D photograph for about a second, then the GLB. Intro
must not mount `TDeckPhoto` / `/intro/tdeck.webp`. `tdeck-scene.ts` parses the
GLB once at module load; `TDeckModel` attaches a clone in `useLayoutEffect`.
Reload sampling on localhost never requested `tdeck.webp`; first sample at
~575ms was `data-state=ready` with canvas opacity 1. Rest pose is tilted so
the chassis has volume (side, thickness, antenna). Drag turns yaw through a
full orbit and pitches; it does not spring back. Lighting is the Blender area
lights plus a warm key, cool rim, and hemisphere bounce. LCD stays unlit.
Flash keeps the 2D photo. Do not rewrite the twelve-chapter intro copy.
