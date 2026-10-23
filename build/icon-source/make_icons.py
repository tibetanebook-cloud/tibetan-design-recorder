"""Turn the source icon JPG (with a painted-on checkerboard) into a transparent
master PNG plus the platform icon set used by electron-builder.

Usage: python make_icons.py
Outputs (next to this folder, in build/):
  icon.png (1024), icon.ico (16-256), icons/<size>x<size>.png (Linux)
  icon-source/master-transparent.png (cropped, full resolution)
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = Path(__file__).resolve().parent
BUILD = HERE.parent

src = Image.open(HERE / "original.jpg").convert("RGB")
rgb = np.asarray(src).astype(np.int16)

# Checkerboard squares are near-neutral light greys/whites. The icon edge is a
# saturated gold/blue/red frame, so "light and unsaturated" separates them.
mx, mn = rgb.max(axis=2), rgb.min(axis=2)
background_like = (mn > 185) & ((mx - mn) < 22)
# The generator also drew a thin dark frame line in the outer few pixels.
EDGE = 8
background_like[:EDGE, :] = background_like[-EDGE:, :] = True
background_like[:, :EDGE] = background_like[:, -EDGE:] = True

# Keep only the background-like region that touches the image border, so light
# highlights inside the icon are never removed.
labels, _ = ndimage.label(background_like)
border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
border = border[border != 0]
outside = np.isin(labels, border)

# Close tiny JPEG specks, then grow by 1px to eat the light halo on the edge.
outside = ndimage.binary_closing(outside, iterations=2)
outside = ndimage.binary_dilation(outside, iterations=1)

# The source's outermost rows/columns carry a faint frame line; keep only the
# single largest opaque shape (the icon) so stray edge lines are dropped.
solid, count = ndimage.label(~outside)
if count > 1:
    sizes = ndimage.sum(np.ones_like(solid), solid, index=range(1, count + 1))
    outside = solid != (int(np.argmax(sizes)) + 1)

alpha = Image.fromarray(np.where(outside, 0, 255).astype(np.uint8))
alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))  # anti-aliased edge

rgba = src.copy()
rgba.putalpha(alpha)
rgba = rgba.crop(rgba.getbbox())

# Pad to a square canvas with a small margin so the icon is not clipped.
side = int(max(rgba.size) * 1.04)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(rgba, ((side - rgba.width) // 2, (side - rgba.height) // 2), rgba)
square.save(HERE / "master-transparent.png")

master = square.resize((1024, 1024), Image.LANCZOS)
master.save(BUILD / "icon.png")
master.save(BUILD / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

icons = BUILD / "icons"
icons.mkdir(exist_ok=True)
for s in (16, 32, 48, 64, 128, 256, 512, 1024):
    square.resize((s, s), Image.LANCZOS).save(icons / f"{s}x{s}.png")

# Preview on dark and light backgrounds to check the cut-out edge.
for name, color in (("preview-dark.png", (24, 24, 28, 255)), ("preview-light.png", (245, 245, 245, 255))):
    bg = Image.new("RGBA", (1024, 1024), color)
    bg.alpha_composite(master)
    bg.convert("RGB").save(HERE / name)

print("removed px:", int(outside.sum()), "master:", square.size)
