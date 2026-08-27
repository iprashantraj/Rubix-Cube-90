"""Where uploaded bytes live.

Local filesystem for now. `ai/` has to be able to open whatever url
`POST /uploads/{id}/complete` returns, and in dev both services run on one machine, so the
url is a `file://` URI. Moving to S3 is a change to this file and nothing else — no caller
anywhere reads a path.

Deliberately stdlib-only and free of FastAPI, SQLAlchemy and settings imports, so the
assembly logic can be tested with nothing installed (`test_uploads.py`).
"""

from __future__ import annotations

from pathlib import Path

EXT = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def parts_dir(root: Path, upload_id: str) -> Path:
    """Per-chunk scratch. One file per index, so an out-of-order or re-sent chunk is a
    plain overwrite rather than a seek into a half-written file."""
    return root / "parts" / upload_id


def final_path(root: Path, upload_id: str, content_type: str) -> Path:
    return root / "raw" / f"{upload_id}{EXT.get(content_type, '.bin')}"


class AssemblyError(Exception):
    """The parts on disk do not add up to the image the client said it sent."""


def assemble(parts: Path, chunks: int, expected_size: int, final: Path) -> int:
    """Concatenate `chunks` numbered part files into `final`. Returns bytes written.

    Raises `AssemblyError` rather than writing something plausible and wrong. A truncated
    JPEG handed to `ai/` fails the quality gate for the wrong reason, and the artisan gets
    told their photograph was bad when it was not.
    """
    final.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with final.open("wb") as out:
            for i in range(chunks):
                piece = parts / f"{i:06d}"
                if not piece.exists():
                    # `received` said we had this one. A wiped storage dir, or two processes
                    # running with different storage_dir values.
                    raise AssemblyError(f"chunk {i} missing on disk — re-upload")
                written += out.write(piece.read_bytes())

        # A resumed upload can re-send a chunk carrying different bytes: right chunk count,
        # wrong image. The length check is the cheapest thing that catches it.
        if written != expected_size:
            raise AssemblyError(f"assembled {written} bytes, expected {expected_size} — re-upload")
    except Exception:
        final.unlink(missing_ok=True)
        raise
    return written
