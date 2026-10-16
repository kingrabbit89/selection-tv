"""Encode downloaded posters as small WebP files with fixed settings.

Called by scripts/poster-copy.mjs during local production only; CI validates
the committed files and never encodes. Input: a JSON manifest
[{"in": path, "out": path}], output: one JSON result per entry on stdout.
"""
import json
import sys

from PIL import Image, ImageOps

MAX_SIZE = (360, 540)  # 2:3 poster box; landscape art keeps its ratio
QUALITY = 76
METHOD = 6


def encode(source, target):
    with Image.open(source) as image:
        image.seek(0)  # first frame of an animated GIF/WebP
        image = ImageOps.exif_transpose(image)
        alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        image = image.convert("RGBA" if alpha else "RGB")
        if alpha and image.getchannel("A").getextrema() == (255, 255):
            image = image.convert("RGB")
        image.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
        # No EXIF/ICC/XMP: identical pixels give identical bytes.
        image.save(target, "WEBP", quality=QUALITY, method=METHOD, exact=False)
        return image.size


def main():
    with open(sys.argv[1], encoding="utf-8") as handle:
        manifest = json.load(handle)
    results = []
    for entry in manifest:
        try:
            width, height = encode(entry["in"], entry["out"])
            results.append({"out": entry["out"], "ok": True, "width": width, "height": height})
        except Exception as error:  # report per file, keep the batch going
            results.append({"out": entry["out"], "ok": False, "error": f"{type(error).__name__}: {error}"})
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
