# Incremental reference audit — catalog through batches H and I

Completed **2026-09-16 at 09:36:43 UTC**, after both batches were merged. This snapshot contains 73 profiles and 463 resource entries. Only the two new audit artifacts were created; the checker, source data and earlier reports were left unchanged.

## Results

| Current scope | Count |
| --- | ---: |
| Profiles | 73 |
| Resource entries | 463 |
| Unique resource URLs after fragment removal | 433 |
| Current URLs excluded using both earlier audits | 375 |
| New URLs requested | 58 |
| HTTP 200 | 58 |
| HTTP 404 / 410 | 0 |
| Other unsuccessful responses or request errors | 0 |
| HTTP 429 or deferred requests | 0 |

The complete header observations are in [reference-link-audit-latest-2026-09-16.json](reference-link-audit-latest-2026-09-16.json).

**No new link is confirmed broken. No new blocked response needs investigation.** There were no failed statuses to follow up through another retrieval tool, so no source URL was revisited unnecessarily. Earlier restricted results remain governed by their existing follow-up reports; this successful incremental pass does not clear them.

HTTP reachability is separate from content verification. These checks do not establish that a page supports each cited specification, that a download is valid, that a shared folder grants reuse permission, or that a firmware target matches a retail unit. Existing profile caveats remain in force.

## Redirects and non-HTML references

Two newly checked GL.iNet URLs redirect to US English paths:

| Requested URL | Final URL | Observation |
| --- | --- | --- |
| [Beryl AX product page](https://www.gl-inet.com/products/gl-mt3000/) | [US English product page](https://www.gl-inet.com/en-us/products/gl-mt3000) | HTTP 200; product path retained under a locale route |
| [UK English terms route](https://www.gl-inet.com/en-gb/policies/terms-of-service) | [US English terms route](https://www.gl-inet.com/en-us/policies/terms-of-service) | HTTP 200; a UK-specific terms interpretation is not established by this request |

Both original and final URLs are retained in the JSON for future deduplication. No source replacement is proposed from these header observations.

The Seeed e-paper display PDF declares `application/pdf`. The two pinned Mesh Detect source files declare `text/plain`. Their bodies were cancelled without saving or inspecting files in this pass. The maker-linked Dropbox folder returns HTML without redirecting; this only establishes a reachable landing page, not successful access to every asset inside it. No binary or folder contents were downloaded.

The 58 new references cover Interrupt, Mesh Detect v2, BLEShark Nano, OUI-SPY, Radiacode 110, NanoRFE NanoVNA V2 Plus4 Pro, reTerminal E1001, HUSKYLENS 2, Openterface Mini-KVM, Cynthion and Beryl AX.

## Method

Ran the existing checker with both historical JSON files excluded:

```sh
node scripts/audit-reference-links.mjs \
  --since docs/research/reference-link-audit-2026-09-16.json \
  --since docs/research/reference-link-audit-expanded-2026-09-16.json \
  --output docs/research/reference-link-audit-latest-2026-09-16.json
```

Paths are relative to the gadgets project root. Exclusion covers every previous requested URL and final redirect destination, after URL parsing and fragment removal, regardless of prior status. It therefore skips earlier access restrictions as well as successful responses.

The checker uses three workers, 400 ms spacing after each worker's request, a 15-second timeout, redirects and no automatic retries. A 429 stops subsequent work for that host. Each read-only GET is observed at the response-header stage, then its body stream is cancelled. This is not a HEAD request and does not guarantee that zero body bytes crossed the network.

No browser session, site interaction, account action, source/schema edit, application build or firmware execution occurred. Successful responses were not fetched again merely to expand this audit.

## Preservation and validation

All 58 result URLs are unique and disjoint from normalized requested/final URLs in both historical audits. The new job set exactly matches current resource URLs absent from those reports. Result counts, current scope, response classifications and redirects were checked locally.

These earlier files have matching SHA-256 hashes before and after the pass:

```text
reference-link-audit-2026-09-16.json
02fde3e50ba361ad291ec76130575c07f1c9c16a966ca8dbf828609e5f7f46f1

reference-link-audit-expanded-2026-09-16.json
fa5c570552cd22504c8a8c8b038dae739af8b718168e57dfa56247ff088f572c

reference-link-followup-2026-09-16.md
71108b2b468d4a437e1bb8427e1384dfeb2d4549e79eb617605afafa6f1fc5fe

reference-link-followup-expanded-2026-09-16.md
aa4f2cdb79e93bcbabb82995509a01874d723ced8d8071261639dcaa8b238338
```

For a later incremental pass, supply **all three audit JSON files** through repeated `--since` arguments and choose a fresh output filename. Historical result totals include older references and should not be added together as a count of the current catalog.
