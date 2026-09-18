# LilyShark build-page asset provenance

Prepared September 15, 2026. Original source files remain unchanged.

## Project photograph

`public/builds/lilyshark/tdeck-traffic.jpg` is a JPEG derivative of the repository's `docs/media/tdeck-traffic-live-night.png` (relative to the LilyShark repository root). It shows physical T-Deck hardware held in front of a laptop. The repository README identifies its displayed traffic as simulate mode. Both the homepage caption and build-page caption explicitly identify the simulated display.

The photo is project-supplied material, not a synthetic product render or evidence of the live reception reported elsewhere in the README. No external photographer or additional license was established in this task; confirm publication rights as part of the existing asset review.

Conversion from the repository root:

```sh
sips -s format jpeg -s formatOptions 85 docs/media/tdeck-traffic-live-night.png --out gadgets/public/builds/lilyshark/tdeck-traffic.jpg
```

Dimensions: 1050 × 1400. SHA-256: `20ddd68f9a03aaa7b2e0d227135356a8592ba9ec92374731809539756eeb4747`.

## Capture fixture

`public/samples/lilyshark-synthetic.lscap` is a byte-for-byte copy of `samples/field-capture-0846.lscap` from the repository root. Despite the source filename, it contains 24 generated frames. Every record has the synthetic metadata flag. It contains no Shelby pointer; the page does not resolve network data or attach to a radio.

`public/samples/lilyshark-synthetic.json` is the output of the project's parser:

```sh
python3 scripts/lscap.py dump samples/field-capture-0846.lscap --pretty > gadgets/public/samples/lilyshark-synthetic.json
```

The demo displays recorded numeric fields and payload bytes. It does not infer protocol identity from random fixture payloads. Sequence 14 has the invalid CRC flag. Sequence 20 stores seven fewer bytes than the original-length field reports. A valid CRC flag and complete stored bytes are separate properties.

SHA-256:

- `.lscap`: `56d3037eb9402f437e9c1ba0118b19923479741baa1b15cc84b049cad7eb48fb`
- `.json`: `18389a8b852989993c46a30223875cc038acc383937c8f517d10ea480a7c06a0`

The automated suite compares the public binary with the source fixture and regenerates JSON with `scripts/lscap.py` to detect drift. This verification requires Python 3 as well as Node; serving the built preview requires only Node.

## Other images and claims

Homepage discoveries and the T-Deck parts image use the existing catalog assets and their recorded maker credits in `data/images.json`. Review status and commercial-image permissions have not changed. See [assets.md](assets.md).

Development-status text summarizes the current local repository README: reception and decoding between two T-Deck Plus units and bidirectional direct messages are recorded there. The page attributes these to the project record, with September 15, 2026 as the note-check date; it does not claim a new physical test. MicroSD capture writes, spectrum-scan recovery and live MeshCore/Reticulum operation remain explicitly unverified.
