"""Reading the upload and writing the results.

`contracts.md` is explicit that `image_url` is whatever `POST /uploads/{id}/complete`
returned, which today is a `file://` URI into `web/api`'s STORAGE_DIR and tomorrow is
`s3://`. It also says to open it through something that handles both schemes rather than
parsing the string, so that moving to object storage is a change here and nowhere else.
`web/api/storage.py` makes the same promise from the other side.

stdlib and Pillow only, so this stays testable with nothing installed.
"""

from __future__ import annotations

import os
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

    if parsed.scheme == "s3":
        # Deliberately explicit. When object storage is wired up this is the only function
        # that changes, and a clear message beats a stack trace from deep inside boto3.
        raise SourceError(
            "s3:// sources are not wired up yet — web/api still returns file:// URIs "
            "(see contracts.md). Add the fetch here, not in the pipeline."
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
