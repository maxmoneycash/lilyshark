"""Import the decoded T-Deck GLB and export a USDZ for SceneKit.

The app textures the model's own LCD_glass mesh with firmware frames, the
same mesh the website retextures, so no extra overlay plane is added here.
"""
import math
import sys
from pathlib import Path

import bpy

src = Path(sys.argv[sys.argv.index("--") + 1])
dst = Path(sys.argv[sys.argv.index("--") + 2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src), import_pack_images=True)

root = bpy.data.objects.new("TDeckRoot", None)
bpy.context.scene.collection.objects.link(root)
for obj in list(bpy.context.scene.objects):
    if obj != root and obj.parent is None:
        obj.parent = root
# Match the web viewer: front +Z, antenna +Y.
root.rotation_euler = (math.pi / 2, 0, 0)

dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.usd_export(
    filepath=str(dst),
    export_textures=True,
    export_materials=True,
    generate_preview_surface=True,
    export_animation=False,
    evaluation_mode="RENDER",
)
print("exported", dst, "bytes", dst.stat().st_size)
