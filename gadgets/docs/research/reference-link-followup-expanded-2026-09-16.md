# Incremental reference audit — through batch F

Completed **2026-09-16 at 09:16:09 UTC**. This pass covers the current 67 profiles, after batches E and F were merged and before any later catalog expansion. No catalog, profile, app, browser or build files were changed by this audit.

## Results

| Current scope | Count |
| --- | ---: |
| Resource entries across profiles | 405 |
| Unique resource URLs after removing fragments | 375 |
| Current URLs already represented by the previous audit or its final redirect destinations | 318 |
| New URLs requested in this pass | 57 |
| HTTP 200 | 54 |
| HTTP 403, followed up below | 3 |
| HTTP 404 / 410 | 0 |
| Rate-limited or deferred | 0 |

The machine-readable observations are in [reference-link-audit-expanded-2026-09-16.json](reference-link-audit-expanded-2026-09-16.json). They preserve the actual HTTP status rather than replacing a restricted response with the result of a different retrieval tool.

**No newly checked link is proven missing. No source deletion or replacement is recommended from this pass.** Successful HTTP responses establish reachability only; they do not verify every claim on the page, an installer, a firmware target, software operation, media rights or physical compatibility.

## Previous work preserved

The original [322-URL audit](reference-link-audit-2026-09-16.json) and its [19-link follow-up](reference-link-followup-2026-09-16.md) remain unchanged. Their SHA-256 hashes matched before and after this pass:

```text
reference-link-audit-2026-09-16.json
02fde3e50ba361ad291ec76130575c07f1c9c16a966ca8dbf828609e5f7f46f1

reference-link-followup-2026-09-16.md
71108b2b468d4a437e1bb8427e1384dfeb2d4549e79eb617605afafa6f1fc5fe
```

All 57 new result URLs are unique. None matches a normalized requested or final URL in the prior audit. The figures above describe the current resource set; simply adding 322 and 57 would also count historical references that are no longer in that set.

## Method

`scripts/audit-reference-links.mjs` now accepts optional `--since` and `--output` flags. Paths are resolved from the gadgets project root. `--since` can be repeated; every prior result's requested URL and final redirect URL is excluded after URL parsing and fragment removal. All prior states are excluded, so a previous access restriction is not silently retried. An explicit guard prevents using a supplied prior audit as the output path.

No-argument behavior remains unchanged: it checks the full current reference set and writes the original default output filename. This incremental run used a new output explicitly:

```sh
node scripts/audit-reference-links.mjs \
  --since docs/research/reference-link-audit-2026-09-16.json \
  --output docs/research/reference-link-audit-expanded-2026-09-16.json
```

The checker retained its existing three workers, 400 ms spacing after each worker's request, 15-second timeout, redirect following, host stop after HTTP 429, and no automatic retries. Each GET was inspected at the response-header stage, then its body stream was cancelled without reading or saving page bodies. This is not a HEAD request and does not guarantee zero response bytes crossed the network.

The three 403 results were then inspected through the separate research web tool at their exact primary-source URLs. No browser session was created, no access challenge was bypassed, and the HTTP audit was not rerun. Research retrieval may use cached content; it cannot establish that an ordinary browser will receive the same response today.

## Follow-up on the three restricted responses

All three URLs belong to the Analog Discovery 3 profile. The recorded audit headers establish HTTP 403 and HTML content, but do not identify the precise blocking mechanism. This pass therefore does not label them as explicit Cloudflare challenges merely because an earlier audit observed that behavior on related Digilent pages.

| Exact official URL | Audit observation | Primary research retrieval | Decision |
| --- | --- | --- | --- |
| [BNC Adapter for Analog Discovery](https://digilent.com/shop/bnc-adapter-for-analog-discovery/) | HTTP 403; no redirect | Matching product page and substantive adapter documentation, including the single-ended scope-input caveat and output-cable guidance | Keep. Content identity is corroborated; direct automated access remains restricted. No stock or purchase claim is made. |
| [WaveForms 3.25.1 application manual](https://files.digilent.com/manuals/WaveForms/3.25.1/main.html) | HTTP 403; no redirect | Matching WaveForms manual, device setup and installation sections, including architecture/runtime distinctions | Keep as a versioned manual. This does not test an installer or assert that every future release behaves identically. |
| [Analog Discovery 3 getting started, WaveForms 3.25.1](https://files.digilent.com/manuals/WaveForms/3.25.1/start10.html) | HTTP 403; no redirect | Matching AD3 guide with hardware setup, pin-out reference, power troubleshooting and clock configuration | Keep. The expected guide is identifiable; the audit does not resolve its previously recorded specification conflicts. |

The existing batch E caveats remain necessary, including the waveform-output protection discrepancy. A reachable or retrievable source can still contradict another official document. That content review is separate from the link audit.

## Successful responses: what was and was not checked

The 54 successful responses returned HTTP 200 without a final-URL change. Most declared HTML content. The two new `.pdf` references declared `application/pdf`: the Bus Pirate 5 rev10a schematic and Heltec V4-R8 datasheet. The RAK bundle-options `.js` endpoint declared JavaScript content. These header observations do not inspect file signatures, validate electrical diagrams, establish current stock, or execute those resources.

The new URLs serve twelve current models: Airspy R2, Analog Discovery 3, Bus Pirate 5, RAK WisBlock Meshtastic Starter Kit, ThinkNode M1/M2, Heltec LoRa32 V4/T114, HackRF One/Pro, RTL-SDR Blog V4 and Saleae Logic 8. Shared resources can belong to multiple models, so per-model reference counts are not unique-URL counts.

## Handoff

- Retain all three restricted URLs with their existing official attribution and version scope.
- Preserve the earlier unresolved normal-browser checks, including the Printables enclosure and limited campaign bodies; this incremental pass did not revisit them.
- For a future incremental audit, supply both historical JSON reports with repeated `--since` flags and a fresh `--output` path. Do not overwrite either observation set.
- The script passes `node --check`. Result count, deduplication, exclusion against the prior audit and historical-file hashes were checked locally. No main test suite, build, firmware download execution or publication occurred.
