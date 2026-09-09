"""Bake Blender's material-preview HDRI into a Y-up EXR for SceneKit.

Usage from the repo root:
  blender --background --python scripts/model/export_tdeck_env_exr.py -- \
      [source.exr] [destination.exr] [pos|neg]

Defaults reproduce ios/Resources/TDeck/blender-forest-512.exr. `pos` is the
rotation that ships; `neg` flips the sky/ground axis if a future Blender or
SceneKit changes the equirect convention — compare against the website intro
and keep whichever matches.
"""
import sys

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = ARGS[0] if len(ARGS) > 0 else '/Applications/Blender.app/Contents/Resources/4.5/datafiles/studiolights/world/forest.exr'
DST = ARGS[1] if len(ARGS) > 1 else 'ios/Resources/TDeck/blender-forest-512.exr'
ROT = ARGS[2] if len(ARGS) > 2 else 'pos'
W, H = 512, 256

src = bpy.data.images.load(SRC)
sw, sh = src.size
pixels = np.array(src.pixels[:], dtype=np.float32).reshape(sh, sw, 4)[:, :, :3]

# Self-consistent Y-up equirect for both images: array row 0 is v=0 (bottom).
# Direction for texel center (u, v): phi = (v-0.5)*pi latitude, lambda = (u-0.5)*2*pi.
def dir_from_uv(u, v):
    phi = (v - 0.5) * np.pi
    lam = (u - 0.5) * 2 * np.pi
    y = np.sin(phi)
    r = np.cos(phi)
    x = r * np.cos(lam)
    z = r * np.sin(lam)
    return x, y, z

def uv_from_dir(x, y, z):
    v = np.arcsin(np.clip(y, -1, 1)) / np.pi + 0.5
    u = np.arctan2(z, x) / (2 * np.pi) + 0.5
    return u, v

def bilinear(u, v):
    px = u * sw - 0.5
    py = v * sh - 0.5
    x0 = np.floor(px).astype(int) % sw
    x1 = (x0 + 1) % sw
    y0 = np.clip(np.floor(py).astype(int), 0, sh - 1)
    y1 = np.clip(y0 + 1, 0, sh - 1)
    fx = (px - np.floor(px))[..., None]
    fy = (py - np.floor(py))[..., None]
    c00 = pixels[y0, x0]
    c10 = pixels[y0, x1]
    c01 = pixels[y1, x0]
    c11 = pixels[y1, x1]
    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy

i = np.arange(W)
j = np.arange(H)
u = (i + 0.5) / W
v = (j + 0.5) / H
uu, vv = np.meshgrid(u, v)  # rows are j (v), cols are i (u)
x, y, z = dir_from_uv(uu, vv)

def render(rot, path):
    if rot == 'pos':   # R_x(+90): (x, y, z) -> (x, -z, y)
        mx, my, mz = x, -z, y
    else:              # R_x(-90): (x, y, z) -> (x, z, -y)
        mx, my, mz = x, z, -y
    iu, iv = uv_from_dir(mx, my, mz)
    out = bilinear(iu, iv)
    img = bpy.data.images.new('env-out', W, H, alpha=False, float_buffer=True)
    alpha = np.ones((H, W, 1), dtype=np.float32)
    img.pixels = np.concatenate([out, alpha], axis=2).flatten().tolist()
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.exr_codec = 'ZIP'
    scene.render.image_settings.color_depth = '16'
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    print('wrote', path)

render(ROT, DST)
