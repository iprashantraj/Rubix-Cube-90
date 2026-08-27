#!/usr/bin/env python3
"""Round-trip one real image through storage, then delete it.

Answers the only question that matters after setup: does an artisan's photo actually come
back from a URL a marketplace page can load — and does the raw original stay unreadable.
Anything less (a bucket listing, a 200 on HEAD) still passes when the public/raw split is
misconfigured, which is the failure this is here to catch.
"""

import io
import urllib.request

from PIL import Image

from api import storage
from api.images import derive

def cleanup(keys: list[str]) -> None:
    """Runs even when an assertion fails — a failed privacy check must not leave the object
    it was complaining about sitting in the bucket."""
    for key in keys:
        storage._client().delete_object(Bucket=storage.bucket_for(key), Key=key)
    print(f"cleaned up      {len(keys)} objects")


img = Image.new("RGB", (2000, 1500), (180, 60, 40))
buf = io.BytesIO()
img.save(buf, "JPEG", quality=90)
original = buf.getvalue()

upload_id = "0" * 32
artisan = "smoke"
keys = []

try:
    raw_key = storage.key_for(artisan, upload_id, "original", public=False)
    storage.put(raw_key, original)
    keys.append(raw_key)
    print(f"raw uploaded    {raw_key} -> {storage.bucket_for(raw_key)} ({len(original)//1024} KB)")

    for variant, data in derive(original).items():
        # Same public/private split routers/uploads.py applies: `full` is the archival
        # size and is not something a marketplace page links to. A test that published it
        # would be checking a path production never takes.
        public = variant != "full"
        key = storage.key_for(artisan, upload_id, variant, public=public)
        url = storage.put(key, data)
        keys.append(key)
        if not public:
            print(f"private stored  {variant:8} -> {storage.bucket_for(key)}")
            continue
        with urllib.request.urlopen(url, timeout=30) as r:
            fetched = r.read()
        w, h = Image.open(io.BytesIO(fetched)).size
        assert fetched == data, f"{variant}: fetched bytes differ from what was uploaded"
        print(f"public verified {variant:8} {w}x{h} {len(fetched)//1024:>4} KB  {url}")

    # The privacy boundary, asserted rather than assumed. This is the check that caught the
    # single-public-bucket version, where a raw/ prefix looked private and was not.
    raw_url = storage.url_for(raw_key)
    try:
        with urllib.request.urlopen(raw_url, timeout=30):
            raise AssertionError(f"raw original is anonymously readable: {raw_url}")
    except urllib.error.HTTPError as e:
        print(f"raw is private  HTTP {e.code} on {raw_key}")

    # ...and still readable by us, or the pipeline cannot re-derive from the original.
    body = storage._client().get_object(Bucket=storage.bucket_for(raw_key), Key=raw_key)["Body"]
    assert body.read() == original, "raw original does not read back byte-identical"
    print("raw readable    with credentials, byte-identical")
finally:
    cleanup(keys)
