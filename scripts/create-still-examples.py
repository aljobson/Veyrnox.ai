"""Recreate the five A1 examples locally: python3 scripts/create-still-examples.py.

No network, model calls or third-party media. See example-media-provenance.md.
"""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/examples"
SIZE = (1280, 720)
# Veyrnox dark theme: app/globals.css --vx-base/panel/border/fg/accent.
BASE, PANEL, BORDER = (10, 10, 11), (20, 20, 22), (38, 38, 42)
INK, MINT = (242, 242, 243), (62, 230, 196)


def canvas():
    im = Image.new("RGB", SIZE, BASE)
    d = ImageDraw.Draw(im)
    for radius in range(560, 0, -2):
        strength = (1 - radius / 560) ** 2
        color = tuple(round(a + strength * (b - a)) for a, b in zip(BASE, (19, 51, 46)))
        d.ellipse((640-radius, 360-radius, 640+radius, 360+radius), fill=color)
    d.rounded_rectangle((32, 32, 1248, 688), radius=30, outline=BORDER, width=2)
    return im, d


def save(im, slug):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{slug}.webp"
    im.save(path, "WEBP", quality=86, method=6)
    assert path.stat().st_size < 200_000, path
    print(f"{path.relative_to(ROOT)}: {im.width}x{im.height}, {path.stat().st_size} bytes")


def waveform(d, left, right, center, height, phase=0, color=MINT):
    for i, x in enumerate(range(left, right, 16)):
        envelope = math.sin(math.pi * (x-left) / (right-left)) ** 0.7
        amplitude = 8 + height * envelope * (0.25 + 0.75 * abs(math.sin(i * 0.71 + phase)))
        d.rounded_rectangle((x, center-amplitude, x+6, center+amplitude), radius=3, fill=color)


def avatar():
    manifest = json.loads((ROOT / "public/avatars/fictional/manifest.json").read_text())
    assert "Generated specifically for Veyrnox" in manifest["provenance"]
    assert "fictional" in manifest["identity"]
    im, d = canvas()
    for radius in (230, 280, 330):
        d.ellipse((640-radius, 360-radius, 640+radius, 360+radius), outline=(39, 77, 69), width=2)
    portrait = ImageOps.fit(Image.open(ROOT / "public/avatars/fictional/mara.png").convert("RGB"), (488, 568))
    mask = Image.new("L", portrait.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 487, 567), radius=32, fill=255)
    im.paste(portrait, (396, 76), mask)
    d.rounded_rectangle((386, 66, 894, 654), radius=40, outline=MINT, width=2)
    for x, y in ((264, 260), (1008, 456)):
        d.ellipse((x-12, y-12, x+12, y+12), fill=MINT)
        d.line((x-36, y+46, x+36, y+46), fill=(75, 109, 101), width=3)
    save(im, "ai-avatar-generator")


def speech():
    im, d = canvas()
    d.rounded_rectangle((116, 170, 546, 550), radius=28, fill=PANEL, outline=BORDER, width=2)
    # Abstract text lines: no baked-in language or feature claims.
    for y, length in ((235, 260), (281, 322), (327, 205), (373, 288), (465, 135)):
        d.rounded_rectangle((166, y, 166+length, y+12), radius=6, fill=INK if y < 400 else MINT)
    d.line((586, 360, 665, 360), fill=INK, width=3)
    d.line((652, 347, 665, 360, 652, 373), fill=INK, width=3)
    waveform(d, 722, 1140, 360, 135)
    save(im, "text-to-speech")


def voice():
    im, d = canvas()
    for top in (132, 408):
        d.rounded_rectangle((200, top, 1080, top+180), radius=24, fill=PANEL, outline=BORDER, width=2)
    waveform(d, 250, 1030, 222, 62, color=INK)
    waveform(d, 250, 1030, 498, 62)
    for x in (600, 640, 680):
        d.ellipse((x-4, 356, x+4, 364), fill=MINT)
    save(im, "ai-voice-cloning")


def object_character():
    im, d = canvas()
    d.ellipse((394, 568, 896, 620), fill=(8, 17, 16))
    # An original friendly mug, drawn entirely from geometric shapes.
    d.ellipse((774, 274, 990, 494), fill=MINT)
    d.ellipse((811, 315, 948, 454), fill=(16, 39, 35))
    d.rounded_rectangle((404, 252, 838, 584), radius=70, fill=MINT)
    d.ellipse((404, 211, 838, 311), fill=(131, 242, 220))
    d.ellipse((430, 231, 812, 290), fill=(18, 62, 53))
    for x in (524, 698):
        d.ellipse((x, 364, x+28, 404), fill=BASE)
        d.ellipse((x+7, 370, x+14, 380), fill=INK)
    d.arc((568, 401, 672, 479), 5, 175, fill=BASE, width=7)
    for x in (484, 738):
        d.ellipse((x, 425, x+40, 442), fill=(25, 170, 146))
    d.rounded_rectangle((903, 138, 1094, 244), radius=32, fill=INK)
    d.polygon(((922, 229), (915, 270), (964, 235)), fill=INK)
    for x in (950, 996, 1042):
        d.ellipse((x, 183, x+10, 193), fill=BASE)
    save(im, "talking-objects")


def product():
    im, d = canvas()
    d.ellipse((283, 126, 997, 668), outline=(39, 77, 69), width=2)
    d.polygon(((298, 525), (888, 525), (1010, 643), (190, 643)), fill=(45, 57, 54))
    d.ellipse((414, 541, 918, 603), fill=(22, 32, 29))
    # Unbranded box and bottle. The blank label is an abstract original design.
    d.rectangle((727, 248, 898, 547), fill=(181, 193, 179))
    d.polygon(((898, 248), (949, 214), (949, 512), (898, 547)), fill=(108, 133, 120))
    d.polygon(((727, 248), (780, 214), (949, 214), (898, 248)), fill=(216, 222, 205))
    d.rounded_rectangle((456, 238, 705, 570), radius=46, fill=MINT)
    d.rounded_rectangle((508, 154, 653, 245), radius=14, fill=(189, 213, 202))
    d.line((525, 165, 525, 229), fill=INK, width=3)
    d.rounded_rectangle((478, 328, 683, 478), radius=12, fill=(228, 235, 218))
    d.ellipse((549, 357, 611, 419), outline=(21, 98, 81), width=3)
    d.line((539, 445, 621, 445), fill=(21, 98, 81), width=3)
    d.line((475, 284, 475, 305), fill=(173, 251, 235), width=5)
    save(im, "product-image-generator")


if __name__ == "__main__":
    avatar()
    speech()
    voice()
    object_character()
    product()
