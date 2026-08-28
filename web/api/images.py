"""Derive the display variants from one uploaded photo.

The phone already downscales to 1600px / q0.82 before upload (app/src/api/upload.js) — that
one is about the artisan's mobile data. This one is about what a page loads.

## Why variants at all

/products draws a list of 56px thumbnails and /home draws a 2-up shelf. Serving a 1600px
photo into a 56px box means the phone downloads ~350KB, decodes 2.5 megapixels, and throws
almost all of it away — per row. On the low-end device this app targets, that is the
difference between a list that scrolls and one that stutters, and it is the artisan's data
being spent to render something they cannot see.

    thumb    400px   list rows, the home shelf
    display  1200px  product detail, catalog review
    full     as-is   marketplace zoom, channel exports

## Rules that are not negotiable

* Never upscale. A small original stays small; a variant larger than its source is bytes
  spent inventing detail.
* Never crop. Marketplace adapters have their own aspect requirements and they crop from
  `full` themselves. Cropping here would silently decide what part of a saree matters.
* Never change colour. `ai/README.md` says it and it is a listing-integrity rule: the
  artisan confirmed the colour on /capture/review, and a "helpful" saturation bump makes
  that confirmation a lie.
"""

from __future__ import annotations

import io
import logging

from PIL import Image, ImageOps

log = logging.getLogger(__name__)

# name -> longest edge in px. `full` is the original, re-encoded but not resized.
VARIANTS = {"thumb": 400, "display": 1200}

# Slightly above the phone's 0.82 because this re-encodes an already-lossy JPEG, and
# generation loss compounds. The thumbnail can afford less: at 400px nobody is inspecting
# weave.
QUALITY = {"thumb": 0.80, "display": 0.85, "full": 0.88}

MAX_PIXELS = 50_000_000  # a decompression-bomb guard, not a product limit


def _encode(img: Image.Image, quality: float) -> bytes:
    buf = io.BytesIO()
    img.save(
        buf,
        format="JPEG",
        quality=int(quality * 100),
        # Progressive so a slow connection paints a blurry whole image rather than a sharp
        # top third — which is what a shopper on a rural connection actually experiences.
        progressive=True,
        optimize=True,
    )
    return buf.getvalue()


def derive(original: bytes) -> dict[str, bytes]:
    """Return {variant_name: jpeg_bytes}, always including 'full'.

    Raises ValueError on anything that is not a decodable image, so a corrupt upload fails
    here rather than becoming a broken product row.
    """
    # Bomb guard BEFORE decode. A 20KB PNG can declare 60000x60000 and exhaust the box.
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS

    try:
        img = Image.open(io.BytesIO(original))
        img.load()
    except Exception as e:  # Pillow raises a wide family here
        raise ValueError(f"not a decodable image: {e}") from e

    # Honour the EXIF orientation flag before we discard EXIF. The phone strips metadata on
    # its way out, but a gallery pick that reached us another way can still be a landscape
    # sensor read rotated by a tag — and dropping the tag without applying it turns every
    # portrait photo on its side.
    img = ImageOps.exif_transpose(img)

    # Flatten to RGB. JPEG has no alpha, and a PNG with transparency otherwise saves with a
    # black background instead of white.
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.split()[-1])
        img = flat
    elif img.mode != "RGB":
        img = img.convert("RGB")

    out = {"full": _encode(img, QUALITY["full"])}

    longest = max(img.size)
    for name, edge in VARIANTS.items():
        if longest <= edge:
            # Never upscale — see the module docstring. The caller gets fewer keys and the
            # product row simply points at `full` for that size.
            continue
        scale = edge / longest
        size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        # LANCZOS: on woven texture a box filter produces moiré, which is exactly the
        # detail these products are sold on.
        out[name] = _encode(img.resize(size, Image.LANCZOS), QUALITY[name])

    log.info(
        "derived %s from %.0fKB original (%dx%d)",
        {k: f"{len(v) / 1024:.0f}KB" for k, v in out.items()},
        len(original) / 1024, img.width, img.height,
    )
    return out


if __name__ == "__main__":
    # Offline self-check. No network, no storage — just the pixel rules that must not
    # regress, because each of them silently corrupts a listing rather than erroring.
    import sys

    src = Image.new("RGB", (2000, 1000), (200, 60, 30))
    got = derive(_encode(src, 0.9))
    assert set(got) == {"full", "display", "thumb"}, got.keys()
    assert max(Image.open(io.BytesIO(got["thumb"])).size) == 400
    assert max(Image.open(io.BytesIO(got["display"])).size) == 1200
    assert Image.open(io.BytesIO(got["full"])).size == (2000, 1000), "full is never resized"

    # Aspect ratio is preserved, i.e. nothing is cropped.
    t = Image.open(io.BytesIO(got["thumb"])).size
    assert abs(t[0] / t[1] - 2.0) < 0.01, f"aspect changed: {t}"

    # A small original is not upscaled, and does not gain variants larger than itself.
    small = derive(_encode(Image.new("RGB", (300, 200), (10, 10, 10)), 0.9))
    assert set(small) == {"full"}, f"small image should yield only full, got {small.keys()}"

    # Transparency flattens to white, not black.
    png = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 255, 255, 0)).save(png, format="PNG")
    flat = Image.open(io.BytesIO(derive(png.getvalue())["full"]))
    assert flat.getpixel((5, 5))[0] > 200, "alpha must flatten to white"

    # Garbage in is a ValueError, not a broken product row.
    try:
        derive(b"this is not an image")
        sys.exit("should have refused a non-image")
    except ValueError:
        pass

    print("all image checks passed")
