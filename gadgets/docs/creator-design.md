# Creator redesign

Historical September 14 prototype. The user rejected this direction. The September 15 discovery/build implementation replaces its homepage and shared visual system; see [the current design](workbench-design.md).

Audience: experienced radio and hardware hobbyists showing their own builds and setups.
Primary action: create a setup story and share it. Secondary: discover parts, follow project documentation, remix a setup.

Visual system: Hallmark editorial / Ecosystem Index / Brutal. N6 newspaper masthead on the homepage, compact masthead inside; Ft2 inline footer. Bricolage Grotesque for display type, existing Instrument Sans for reading and controls. Warm paper, dark ink and restrained orange. Actual maker images remain credited. Mobile leads with the LilyShark project photo and keeps “Share a setup” in the navigation; desktop pairs the project with the creation invitation.

Implementation: `src/templates.mjs`, `src/catalog.mjs`, `public/app.js`, `scripts/build.mjs`, `public/fonts.css`; new `src/discovery.mjs`, `src/kits.mjs`, `public/kits.js`, `tokens.css`, `public/discovery.css`, setup tests and product/QA notes. Existing global CSS and device research routes retained. `/setup/` is the primary creator route; `/kit/` is a compatibility alias.

Tradeoffs: this is a static, local prototype. Photo URLs are supported; uploads and durable public project pages need hosting. Shared URLs are snapshots. There is no simulated community activity. A maker product image is not represented as a photo of a completed community build.

## Design review

Hallmark self-critique: philosophy 4/5, hierarchy 4/5, execution 4/5, specificity 4/5, restraint 4/5, structural variety 5/5. The first pass was revised after rendered checks: smaller masthead, larger featured hardware, less orange surface area, natural headline wrapping, and the project photograph first on mobile. This is a first design direction for user review, not a claim that aesthetic fit has been validated with builders.

New colors and font families come from `tokens.css`; spacing uses a four-pixel token scale. Focus appears immediately, controls have active/disabled styles, copying exposes progress and failure recovery, inputs expose URL errors, and a new draft can be undone. There is no continuous decorative animation. Existing research-page CSS remains in place under the new theme; this pass does not claim an exhaustive 58-gate certification of every inherited route.
