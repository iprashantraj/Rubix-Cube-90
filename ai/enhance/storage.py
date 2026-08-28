"""Reading the upload and writing the results.

`contracts.md` is explicit that `image_url` is whatever `POST /uploads/{id}/complete`
returned, and that it is opened through something that handles every scheme rather than by
parsing the string — so moving storage is a change here and nowhere else.

Three schemes are real, and which one you get depends on deployment, not on code:
  file://   no S3 configured. Both services share a machine, so a path is enough.
  https://  S3 configured. `web/api/objectstore.py` publishes over the S3 API but returns
            the PUBLIC REST url, because that same string is what the app renders in an
            <img> and what a marketplace links to.
  s3://     nothing produces this today. Kept as an explicit refusal, not a silent gap.

⚠️ https was missing until 2026-08-28 and it broke the whole path the moment Supabase was
configured: `POST /enhance` answered 502 "unsupported url scheme 'https'" for every real
upload, which web/api turned into a 500 and the app turned into "we could not improve the
photo". Nothing was wrong with the photograph or the model.

stdlib and Pillow only, so this stays testable with nothing installed.
"""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse

from PIL import Image

# Where rendered listing images go. Same shape as web/api's STORAGE_DIR and overridable
# for tests; in dev both services share a machine and therefore a filesystem.
OUTPUT_DIR = Path(os.environ.get("AI_OUTPUT_DIR", "/tmp/rubix-ai-out"))


class SourceError(Exception):
    """The upload could not be read. Distinct from 'the photograph is bad' — the artisan
    is told something different for each, and blaming their photography for our missing
    file is the wrong message."""


def open_image(url: str) -> Image.Image:
    """Load whatever `image_url` points at. Raises `SourceError` on anything unreadable."""
    parsed = urlparse(url)

    if parsed.scheme in ("", "file"):
        path = Path(unquote(parsed.path if parsed.scheme == "file" else url))
        if not path.exists():
            raise SourceError(f"no file at {path}")
        try:
            im = Image.open(path)
            im.load()
        except Exception as e:                       # truncated JPEG, wrong bytes, not an image
            raise SourceError(f"{path.name} is not a readable image: {e}") from e
        return im

    if parsed.scheme in ("http", "https"):
        # Object storage, as it actually arrives.
        #
        # `web/api/objectstore.py` publishes to Supabase Storage over the S3 API but hands
        # back the PUBLIC REST url — an ordinary https link, not an `s3://` URI — because
        # that same string is what the app renders in an <img> and what a marketplace page
        # links to. So the scheme this side was waiting for never comes: with S3 configured
        # `POST /uploads/{id}/complete` returns https, and without it, file://. Both are
        # real and both have to open.
        #
        # No credentials: derived variants live in the PUBLIC bucket by design, and the
        # private raw bucket is never what `image_url` points at. If that ever changes this
        # is the function that grows a signed request — not the pipeline.
        try:
            import httpx

            res = httpx.get(url, timeout=30, follow_redirects=True)
            res.raise_for_status()
            im = Image.open(BytesIO(res.content))
            im.load()
        except Exception as e:
            # Deliberately NOT a photo complaint. The artisan is told their photograph was
            # bad only when it was; a 404 on our own bucket is our fault and says so.
            raise SourceError(f"could not fetch {url}: {e}") from e
        return im

    if parsed.scheme == "s3":
        # Kept for the day something hands us a bare s3:// URI. Nothing does today —
        # objectstore.py returns the https form above.
        raise SourceError(
            "s3:// sources are not wired up — web/api returns the public https url "
            "(see objectstore.url_for). Add the signed fetch here, not in the pipeline."
        )

    raise SourceError(f"unsupported url scheme {parsed.scheme!r}")


def write_image(im: Image.Image, product_id: str, target: str, quality: int) -> tuple[str, int, int]:
    """Save one rendered variant. Returns (url, width, height).

    JPEG, no EXIF. `stripExif` already runs on the app's upload path, but this is a second
    place bytes are written and rule 5 is unconditional — a re-encode that carried the
    original's GPS through would put an artisan's home address on a public listing.
    """
    out = OUTPUT_DIR / product_id
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{target}_{im.width}.jpg"
    im.convert("RGB").save(path, "JPEG", quality=quality, optimize=True, subsampling=1)
    return path.as_uri(), im.width, im.height
