# T-Deck model in the iOS app

`tdeck-plus.usdz` is the approved T-Deck Plus reconstruction, converted from the website’s `tdeck-plus-v5.glb` so SceneKit can load it. `screens/` contains 42 firmware frames at 320×240 from the render test and deterministic live telemetry, the same images the site puts on the LCD.

Refresh both the iOS and website frames from the repository root:

```sh
python3 scripts/generate_intro_frames.py
python3 scripts/generate_intro_frames.py --check
```

The exporter needs `uvx` and ImageMagick (`magick`), builds the simulator, and
checks its pixel goldens before replacing the images. `--check` reports stale
frames without replacing them.

Rebuild the USDZ from the repo root after changing the master GLB:

```sh
git show origin/main:webapp/public/models/tdeck-plus/tdeck-plus-v5.glb > /tmp/tdeck-plus-v5.glb
npx --yes @gltf-transform/cli@4.2.1 copy /tmp/tdeck-plus-v5.glb /tmp/tdeck-decoded.glb
blender --background --python scripts/model/export_tdeck_usdz.py -- /tmp/tdeck-decoded.glb ios/Resources/TDeck/tdeck-plus.usdz
```

The export parents the scene under `TDeckRoot` and rotates it so the front faces +Z. The app textures the model’s own `LCD_glass` mesh with a firmware frame, the same mesh the website retextures; there is no overlay plane.

`blender-forest-512.exr` is the SceneKit lighting environment: Blender 4.5’s bundled material-preview HDRI (`forest.exr`, Greg Zaal / Poly Haven “ninomaru_teien”, CC0), downscaled to 512×256 and pre-rotated from Blender’s Z-up equirect to the Y-up convention SceneKit samples. `TDeckSceneView` currently lights the model with this environment alone; without the file it falls back to flat white plus lamps. The web intro now uses the approved Blender file’s saved neutral world and three area lights, so the native and web lighting setups differ. Rebuild from the repo root:

```sh
blender --background --python scripts/model/export_tdeck_env_exr.py
```
