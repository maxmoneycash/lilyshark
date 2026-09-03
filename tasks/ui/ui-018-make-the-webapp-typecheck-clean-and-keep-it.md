---
id: UI-018
title: Make the webapp typecheck-clean, and keep it that way
area: ui
size: S
priority: P1
status: done
eval:
  auto:
  - cd webapp && pnpm exec tsc --noEmit
  rubric:
  - The 15 latent errors in src/lib/deviceLink.ts and src/mesh/screens/Mesh.tsx are fixed on their merits, not suppressed with any-casts or ts-ignore.
  - A typecheck step runs in CI (or the build script) so the count cannot silently grow again.
---

Why: `pnpm build` is Vite, and Vite does not typecheck — so `tsc --noEmit`
has accumulated 15 latent errors (14 in src/lib/deviceLink.ts, 1 in
src/mesh/screens/Mesh.tsx) that no gate ever catches. Every agent and
contributor who runs the compiler to verify their own change now wades
through someone else's noise, which is exactly how real errors start
getting ignored.

What: Fix the existing errors, then add `tsc --noEmit` to CI for webapp
changes.

Out of scope: enabling stricter compiler flags than the current tsconfig.
