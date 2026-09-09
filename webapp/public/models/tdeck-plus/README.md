# T-Deck Plus web model

`tdeck-plus-v5.glb` is the web derivative of the approved v5 reconstruction. Use a new versioned filename for later changes so service workers and CDN caches cannot serve an earlier model.

| Measure | Result |
| --- | --- |
| Master file | 21,480,216 bytes |
| Web file | 4,109,100 bytes (3.92 MiB) |
| Reduction | 80.87% |
| Meshes / triangles | 59 / 198,508, unchanged |
| Geometry | Lossless Meshopt; no decimation or position quantization |
| Large photographs | Original resolution; WebP quality 98 |
| Key legends, regulatory label, screw photo | Lossless WebP |
| LCD image | Original PNG, unchanged |
| Khronos validation | 0 errors, 0 warnings, compressed and decoded |

All oriented triangles, positions, and shading normals match the master after decoding. The rear screw uses a 92×95 crop of its original 4032×3024 photograph, with a 16-pixel gutter and adjusted UVs. Broad-photo pixel PSNR is 50.63 dB for the rear and 48.27 dB for the front. No texture was downscaled.

SHA-256: `7894bdf8a315dfbc814969eacb1bd91c2f207657f119aea215213a6c8f249b9f`.

## Three.js loading and the live LCD

The asset requires `EXT_meshopt_compression` and `EXT_texture_webp`. Meshopt decoding was checked with Three.js 0.185.1's bundled decoder.

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltf = await loader.loadAsync('/models/tdeck-plus/tdeck-plus-v5.glb');
gltf.scene.rotation.x = Math.PI / 2;
```

The raw glTF node is `LCD glass`; Three.js sanitizes that name to `LCD_glass`. It contains two primitives. Find the display primitive by `material.name === 'LCD display'`, leaving the glass edge material intact. Its texture coordinates are exactly 0..1 in `TEXCOORD_0` (`geometry.attributes.uv`). Replacement canvas textures use `flipY = false`, channel 0, and sRGB color space. The viewer uses an unlit `MeshBasicMaterial` with `toneMapped = false` for this primitive so the illuminated display retains the source UI colors, without environment reflections lifting its black background. Initial readiness waits for both the model and its first display image; an initial image failure uses the photo fallback.

The original glTF coordinates are meters, with the front pointing +Y and the top/antenna pointing −Z. The rotation above makes the device upright with its front pointing +Z. Handset dimensions are 73.140 × 114.984 × 21.870 mm, including the trackball and rear insert. The complete antenna assembly is 295.764 mm tall. Exact bounds are in `optimization.json`.

## Reproduce

Run from the repository root with Node.js 24. The temporary tooling does not change application dependencies.

```sh
model_tools="$(mktemp -d)"
npm install --prefix "$model_tools" --no-audit --no-fund \
  @gltf-transform/core@4.2.1 @gltf-transform/extensions@4.2.1 \
  @gltf-transform/functions@4.2.1 meshoptimizer@0.24.0 \
  sharp@0.35.4 gltf-validator@2.0.0-dev.3.10
node scripts/model/optimize-tdeck.mjs \
  /path/to/approved/tdeck-plus-v5.glb \
  webapp/public/models/tdeck-plus/tdeck-plus-v5.glb "$model_tools"
```

The optimizer checks geometry hashes and LCD UVs, then runs the Khronos validator on both the compressed file and a fully decoded PNG/core-glTF copy. Reports are `optimization.json`, `validation.json`, and `validation-decoded.json`. Validator informational messages concern non-power-of-two image dimensions and the validator's inability to inspect Meshopt directly; the decoded validation covers that payload.

## Lighting: matching the saved Blender scene

The approved `tdeck-plus-v5.blend` enables **Scene World** and **Scene Lights** in
material preview. Its selected `forest.exr` studio light is inactive. The viewer
uses the saved scene's neutral world (linear RGB 0.12, strength 0.7), AgX tone
mapping, and three white square area lights:

| Light | Position (m) | Side (m) | Power |
| --- | --- | --- | --- |
| Key | −0.14, −0.12, 0.23 | 0.18 | 1.2 |
| Fill | 0.18, 0.02, 0.12 | 0.16 | 0.7 |
| Back | −0.06, 0.08, −0.19 | 0.16 | 0.8 |

The positions and rotations in `tdeck-scene.ts` use the same axes as the upright
model. The constant world is PMREM-filtered locally; no lighting image needs to
load. The older `blender-forest-512.hdr` experiment remains in the asset library
but is not used by the web viewer. The housing materials and all texture
resolutions are preserved; only the live LCD uses the unlit material described above. Blender and Three.js use different renderers, so
this reproduces the scene configuration rather than promising identical pixels.

The camera frames the handset for readable LCD content, without a view-mode UI.
The long antenna whip extends through the top edge of the stage; its base and the handset remain visible.

## Sources

The enclosure and PCB come from LILYGO's official [T-Deck Plus shell STEP](https://github.com/Xinyuan-LilyGO/T-Deck/blob/master/shell/T-Deck-Plus-Shell.stp) and [PCB STEP](https://github.com/Xinyuan-LilyGO/T-Deck/blob/master/shell/T-Deck-PCB-3D.stp). Photographs are of the owner's actual device; the v5 reconstruction registers those photographs to the CAD and adds the measured keyboard and estimated antenna/hardware details. The LCD artwork belongs to the Lilyshark project. The approved source GLB has SHA-256 `618a3eed41ab82ee4d4f78deec544d6d3ab1c6416881755f093ccaf5d75cccad` and is not changed by this optimizer.
