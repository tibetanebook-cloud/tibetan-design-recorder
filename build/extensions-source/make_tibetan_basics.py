"""Generate the bundled sample extension "Tibetan Basics" (all artwork original, made here).

  python build/extensions-source/make_tibetan_basics.py

Writes resources/extensions/tibetan-basics/:
  extension.json
  wallpapers/mandala.png       maroon + gold concentric mandala
  frames/laptop.png            laptop with a transparent screen opening
  frames/browser.png           browser window with a transparent content area
  sounds/click.wav             short soft "tok"
"""
import json
import math
import struct
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2] / "resources" / "extensions" / "tibetan-basics"
(ROOT / "wallpapers").mkdir(parents=True, exist_ok=True)
(ROOT / "frames").mkdir(parents=True, exist_ok=True)
(ROOT / "sounds").mkdir(parents=True, exist_ok=True)

GOLD = (212, 169, 74)
MAROON = (92, 18, 32)


def mandala(path: Path) -> None:
    w, h = 1920, 1080
    img = Image.new("RGB", (w, h), MAROON)
    d = ImageDraw.Draw(img, "RGBA")
    # Soft radial glow.
    for r in range(900, 0, -12):
        a = int(70 * (1 - r / 900) ** 2)
        d.ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], fill=(160, 40, 50, a))
    cx, cy = w / 2, h / 2
    for ring, (radius, petals) in enumerate([(120, 8), (210, 12), (320, 16), (450, 24), (600, 32)]):
        alpha = 150 - ring * 22
        d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=GOLD + (alpha,), width=3)
        for i in range(petals):
            a = 2 * math.pi * i / petals
            px, py = cx + radius * math.cos(a), cy + radius * math.sin(a)
            s = 10 + ring * 3
            d.polygon(
                [
                    (px + s * math.cos(a), py + s * math.sin(a)),
                    (px + s * 0.6 * math.cos(a + math.pi / 2), py + s * 0.6 * math.sin(a + math.pi / 2)),
                    (px - s * math.cos(a), py - s * math.sin(a)),
                    (px + s * 0.6 * math.cos(a - math.pi / 2), py + s * 0.6 * math.sin(a - math.pi / 2)),
                ],
                outline=GOLD + (alpha,),
                fill=GOLD + (alpha // 4,),
            )
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(path, optimize=True)


def laptop(path: Path) -> dict:
    W, H = 2200, 1420
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lid = (100, 40, 2100, 1300)
    d.rounded_rectangle(lid, radius=48, fill=(28, 30, 38, 255), outline=(70, 74, 88, 255), width=4)
    screen = {"x": 160, "y": 100, "width": 1880, "height": 1140}  # 1880x1140 ≈ 16:9.7
    # Transparent opening for the screen.
    d.rectangle([screen["x"], screen["y"], screen["x"] + screen["width"] - 1, screen["y"] + screen["height"] - 1], fill=(0, 0, 0, 0))
    d.ellipse([W / 2 - 7, 62, W / 2 + 7, 76], fill=(60, 64, 76, 255))  # camera
    # Base.
    d.polygon([(0, 1300), (W, 1300), (W - 60, 1400), (60, 1400)], fill=(52, 55, 66, 255))
    d.rounded_rectangle((W / 2 - 160, 1300, W / 2 + 160, 1322), radius=10, fill=(36, 38, 46, 255))
    img.save(path, optimize=True)
    return screen


def browser(path: Path) -> dict:
    W, H = 2000, 1220
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=28, fill=(32, 34, 44, 255), outline=(80, 84, 100, 255), width=3)
    for i, color in enumerate([(232, 89, 79), (236, 190, 62), (88, 190, 92)]):
        d.ellipse([34 + i * 46, 30, 62 + i * 46, 58], fill=color + (255,))
    d.rounded_rectangle((220, 22, W - 60, 66), radius=22, fill=(48, 51, 64, 255))
    screen = {"x": 0, "y": 92, "width": W, "height": H - 92}
    d.rectangle([0, 92, W - 1, H - 1], fill=(0, 0, 0, 0))
    img.save(path, optimize=True)
    return screen


def click(path: Path) -> None:
    rate = 44100
    n = int(rate * 0.06)
    frames = bytearray()
    for i in range(n):
        t = i / rate
        env = math.exp(-t * 90)
        v = env * (0.55 * math.sin(2 * math.pi * 1750 * t) + 0.25 * math.sin(2 * math.pi * 3600 * t))
        frames += struct.pack("<h", int(max(-1, min(1, v)) * 0.7 * 32767))
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(bytes(frames))


mandala(ROOT / "wallpapers" / "mandala.png")
laptop_screen = laptop(ROOT / "frames" / "laptop.png")
browser_screen = browser(ROOT / "frames" / "browser.png")
click(ROOT / "sounds" / "click.wav")

manifest = {
    "id": "tibetan-basics",
    "name": "Tibetan Basics",
    "names": {"bo": "བོད་ཀྱི་གཞི་རྩ།"},
    "version": "1.0.0",
    "author": "Tibetan Design",
    "description": "Sample extension: a mandala wallpaper, laptop and browser frames, and a soft click sound.",
    "contributes": {
        "wallpapers": [{"id": "mandala", "name": "Mandala", "names": {"bo": "དཀྱིལ་འཁོར།"}, "file": "wallpapers/mandala.png"}],
        "deviceFrames": [
            {"id": "laptop", "name": "Laptop", "names": {"bo": "ལག་ཁྱེར་རྩིས་འཁོར།"}, "file": "frames/laptop.png", "screen": laptop_screen},
            {"id": "browser", "name": "Browser Window", "names": {"bo": "བཤར་ཆས་ཀྱི་སྒེའུ་ཁུང་།"}, "file": "frames/browser.png", "screen": browser_screen},
        ],
        "clickSounds": [{"id": "soft-click", "name": "Soft Click", "names": {"bo": "གཅིག་རྡེབ་འཇམ་པོ།"}, "file": "sounds/click.wav"}],
    },
}
(ROOT / "extension.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("wrote", ROOT)
