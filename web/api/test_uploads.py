"""Chunk assembly — the one step that can silently produce a plausible, wrong file.

No database, no token, no server, no dependencies:

    cd web/api && python3 test_uploads.py
"""

import shutil
import tempfile
from pathlib import Path

from storage import AssemblyError, assemble, final_path, parts_dir


def _parts(root: Path, pieces) -> Path:
    d = root / "parts"
    d.mkdir(parents=True, exist_ok=True)
    for i, b in pieces:
        (d / f"{i:06d}").write_bytes(b)
    return d


def test_chunks_assemble_in_index_order_not_arrival_order(tmp: Path):
    # Chunks arrive out of order after a resume. The file must still be the photo.
    parts = _parts(tmp, [(2, b"CCC"), (0, b"AAA"), (1, b"BBB")])
    final = tmp / "raw" / "x.jpg"

    assert assemble(parts, 3, 9, final) == 9
    assert final.read_bytes() == b"AAABBBCCC"


def test_missing_part_refuses_rather_than_truncating(tmp: Path):
    parts = _parts(tmp, [(0, b"AAA"), (2, b"CCC")])
    final = tmp / "raw" / "x.jpg"

    try:
        assemble(parts, 3, 9, final)
    except AssemblyError:
        pass
    else:
        raise AssertionError("a missing chunk must not produce a file")
    # A half-written file left behind would be handed to ai/ as a real photo.
    assert not final.exists()


def test_wrong_total_size_refuses(tmp: Path):
    # A re-sent chunk carrying different bytes: right chunk count, wrong image.
    parts = _parts(tmp, [(0, b"AAA"), (1, b"BB")])
    final = tmp / "raw" / "x.jpg"

    try:
        assemble(parts, 2, 9, final)
    except AssemblyError:
        pass
    else:
        raise AssertionError("a short assembly must not produce a file")
    assert not final.exists()


def test_single_chunk_upload(tmp: Path):
    parts = _parts(tmp, [(0, b"only")])
    final = tmp / "raw" / "x.jpg"

    assert assemble(parts, 1, 4, final) == 4
    assert final.read_bytes() == b"only"


def test_paths_are_per_upload_and_typed(tmp: Path):
    assert parts_dir(tmp, "abc").name == "abc"
    assert final_path(tmp, "abc", "image/jpeg").name == "abc.jpg"
    assert final_path(tmp, "abc", "image/png").name == "abc.png"
    # An unknown content type still gets a file rather than a crash.
    assert final_path(tmp, "abc", "application/octet-stream").name == "abc.bin"


def test_url_is_openable_by_the_ai_service(tmp: Path):
    """`complete()` hands ai/ a url, not a path. It has to resolve back to these bytes."""
    from urllib.request import urlopen

    parts = _parts(tmp, [(0, b"jpegbytes")])
    final = tmp / "raw" / "x.jpg"
    assemble(parts, 1, 9, final)

    with urlopen(final.resolve().as_uri()) as r:
        assert r.read() == b"jpegbytes"


if __name__ == "__main__":
    print("uploads")
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_"):
            continue
        d = Path(tempfile.mkdtemp())
        try:
            fn(d)
            print(f"  ok  {name[5:].replace('_', ' ')}")
        finally:
            shutil.rmtree(d, ignore_errors=True)
    print("all passed")
