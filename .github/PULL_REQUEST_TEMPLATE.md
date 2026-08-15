## What changed

<!-- A sentence or two. Link the issue if there is one. -->

## How it was verified

<!-- Which of these ran, and the result:
     - scripts/test_all.sh (host-only or full)
     - webapp: npm test / npm run build
     - firmware: platformio run -e t-deck
     - simulator: platformio run -e simulator, --render-test -->

## Wire formats

- [ ] This change does not alter `.lscap` or the `SHLB` pointer encoding
- [ ] It does — and the spec in `docs/`, the golden test vector, and every
      implementation (C++ / TypeScript / Python) were updated together

## Docs

- [ ] Docs that describe the changed behavior were updated (or none apply)
