#!/usr/bin/env python3
"""Android launcher icons from the Windows app icon.

Diet Tracker ships one icon on both platforms: the blue rounded square with the
white disc and the green fork / knife. The Windows app keeps the master as
`Assets/DietTracker.ico`; this script derives every Android asset from it so the
two apps are pixel-identical in the launcher.

Generated files (all rewritten in place):

  android/app/src/main/res/mipmap-<density>/ic_launcher.png        full icon
  android/app/src/main/res/mipmap-<density>/ic_launcher_round.png  circular crop
  android/app/src/main/res/mipmap-<density>/ic_launcher_foreground.png
                                                                   adaptive layer
  android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml       adaptive icon
  assets/icon.png + assets/adaptive-icon.png                        Expo config

Usage:
  python scripts/make-icons.py ["<path to DietTracker.ico>"]
"""

from __future__ import annotations

import io
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
ASSETS = os.path.join(ROOT, 'assets')

DEFAULT_SOURCE = os.path.join(
    os.path.dirname(ROOT), '..', 'WINDOWS_APPS', 'src', 'DietTracker.App', 'Assets', 'DietTracker.ico'
)

# Launcher icon sizes in pixels per density (legacy icon + round icon).
LEGACY = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
# Adaptive foreground canvas: 108 dp per density. The icon itself covers the
# safe 72 dp, so every launcher mask keeps the whole disc visible.
ADAPTIVE = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
# The white disc covers 62 % of the Windows tile; the adaptive layer keeps that ratio.
DISC_SHARE = 0.62

ADAPTIVE_ICON_XML = '''<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive launcher icon: the Windows icon's blue as the background layer and
     its white disc with the fork/knife as the foreground, so every launcher mask
     yields the same artwork as the desktop tile. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
'''


def dominant_background(image: Image.Image) -> tuple[int, int, int]:
    """The blue of the tile: sampled well inside the rounded corner."""
    return image.getpixel((image.width // 2, 8))[:3]


def disc(master: Image.Image) -> Image.Image:
    """The white circle with the green cutlery, cut out of the blue tile.

    The adaptive icon paints the blue itself, so the foreground must not carry a
    second blue square (its rounded corners would show through the mask as a
    seam). A circular crop keeps exactly the artwork that is separate from the
    background.
    """
    side = 160  # the disc spans 158 px of the 256 px master, centred at 128
    box = (128 - side // 2, 128 - side // 2, 128 + side // 2, 128 + side // 2)
    crop = master.crop(box)
    mask = Image.new('L', (side * 4, side * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, side * 4 - 1, side * 4 - 1), fill=255)
    cut = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    cut.paste(crop, (0, 0), mask.resize((side, side), Image.LANCZOS))
    return cut


def round_mask(size: int) -> Image.Image:
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not os.path.exists(source):
        print(f'Icon source not found: {source}')
        return 1

    master = Image.open(source).convert('RGBA')
    blue = dominant_background(master)
    print(f'source {master.size[0]}x{master.size[1]}  background #{blue[0]:02X}{blue[1]:02X}{blue[2]:02X}')

    for density, size in LEGACY.items():
        folder = os.path.join(RES, f'mipmap-{density}')
        os.makedirs(folder, exist_ok=True)
        icon = master.resize((size, size), Image.LANCZOS)
        icon.save(os.path.join(folder, 'ic_launcher.png'), 'PNG')
        # The round variant is the same tile cut to a circle (Android's roundIcon).
        rounded = icon.copy()
        rounded.putalpha(round_mask(size))
        rounded.save(os.path.join(folder, 'ic_launcher_round.png'), 'PNG')
        # Adaptive foreground: the disc at 62 % of the 108 dp canvas (the share it
        # has on the Windows tile), centred inside the 72 dp safe zone.
        canvas_size = ADAPTIVE[density]
        disc_size = round(canvas_size * DISC_SHARE)
        canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
        offset = (canvas_size - disc_size) // 2
        canvas.paste(disc(master).resize((disc_size, disc_size), Image.LANCZOS), (offset, offset))
        canvas.save(os.path.join(folder, 'ic_launcher_foreground.png'), 'PNG')
        # The old template shipped .webp files with the same resource names.
        for stale in ('ic_launcher.webp', 'ic_launcher_round.webp'):
            path = os.path.join(folder, stale)
            if os.path.exists(path):
                os.remove(path)
        print(f'mipmap-{density}: {size}px legacy + round, {canvas_size}px adaptive')

    anydpi = os.path.join(RES, 'mipmap-anydpi-v26')
    os.makedirs(anydpi, exist_ok=True)
    for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with io.open(os.path.join(anydpi, name), 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(ADAPTIVE_ICON_XML)

    # Expo config assets (store listings + a future `expo prebuild`).
    os.makedirs(ASSETS, exist_ok=True)
    master.resize((1024, 1024), Image.LANCZOS).save(os.path.join(ASSETS, 'icon.png'), 'PNG')
    adaptive = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    disc_pixels = round(1024 * DISC_SHARE)
    offset = (1024 - disc_pixels) // 2
    adaptive.paste(disc(master).resize((disc_pixels, disc_pixels), Image.LANCZOS), (offset, offset))
    adaptive.save(os.path.join(ASSETS, 'adaptive-icon.png'), 'PNG')

    print('assets/icon.png + assets/adaptive-icon.png written')
    print('mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml written')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
