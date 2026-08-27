"""Resumable chunked upload.

Online-first (docs/decisions.md): this exists so a dropped connection resumes from the last
acknowledged chunk instead of restarting a 3MB photo on a rural tower. It is not an offline
queue and it is not a sync engine.
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import storage
from ..db import get_db
from ..images import derive
from ..models import Artisan, Upload
from ..security import current_artisan

router = APIRouter()
log = logging.getLogger(__name__)

MAX_BYTES = 25 * 1024 * 1024

# Chunks land here until `complete` assembles them.
#
# Disk, not memory: a resumable upload is open for as long as the artisan's connection
# takes, and holding 25MB of half-finished photos per in-flight upload in process memory is
# how a box with several artisans on it falls over. The OS temp dir is also cleared on
# reboot, which is the right lifetime for something abandoned mid-upload.
#
# ⚠️ This makes the API stateful across requests: chunk 3 must reach the same process that
# holds chunks 1 and 2. Fine for one box. Behind more than one replica this needs to become
# S3 multipart, which is what the original TODO here meant.
STAGING = Path(tempfile.gettempdir()) / "kaarigar-uploads"


def _staging_dir(upload_id: str) -> Path:
    d = STAGING / upload_id
    d.mkdir(parents=True, exist_ok=True)
    return d


class StartUpload(BaseModel):
    size: int
    chunks: int
    content_type: str = "image/jpeg"


@router.post("/uploads")
def start(
    req: StartUpload,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    if req.size <= 0 or req.size > MAX_BYTES:
        raise HTTPException(413, "image too large")
    up = Upload(
        artisan_id=artisan.id, size=req.size, chunks=req.chunks,
        content_type=req.content_type, received=[],
    )
    db.add(up)
    db.commit()
    return {"upload_id": up.id, "chunk_size": 256 * 1024}


def _owned(upload_id: str, db: Session, artisan: Artisan) -> Upload:
    up = db.get(Upload, upload_id)
    if up is None or up.artisan_id != artisan.id:
        raise HTTPException(404, "unknown upload")
    return up


@router.get("/uploads/{upload_id}")
def state(
    upload_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    up = _owned(upload_id, db, artisan)
    return {"received": up.received, "chunks": up.chunks, "url": up.url}


@router.post("/uploads/{upload_id}/chunk/{index}")
async def put_chunk(
    upload_id: str,
    index: int,
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    up = _owned(upload_id, db, artisan)
    if not 0 <= index < up.chunks:
        raise HTTPException(400, "chunk index out of range")

    # This used to `await chunk.read()` and THROW THE BYTES AWAY, then `complete` wrote a
    # fabricated `s3://raw/{id}` URL that pointed at nothing. Every product in the database
    # therefore had an image that did not exist, which is why every row rendered the
    # "no image yet" placeholder.
    body = await chunk.read()
    (_staging_dir(upload_id) / f"{index:06d}").write_bytes(body)

    if index not in up.received:
        up.received = sorted([*up.received, index])
        flag_modified(up, "received")
        db.commit()
    return {"received": len(up.received), "of": up.chunks}


@router.post("/uploads/{upload_id}/complete")
def complete(
    upload_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    up = _owned(upload_id, db, artisan)
    if len(up.received) != up.chunks:
        missing = sorted(set(range(up.chunks)) - set(up.received))
        raise HTTPException(409, f"missing chunks: {missing[:10]}")

    d = _staging_dir(up.id)
    # Sorted by the zero-padded index, so reassembly order is the write order and does not
    # depend on the filesystem's idea of directory ordering.
    original = b"".join(p.read_bytes() for p in sorted(d.iterdir()))
    if not original:
        raise HTTPException(409, "no chunk data on this server")

    try:
        variants = derive(original)
    except ValueError as e:
        # A corrupt or non-image upload fails HERE, before it becomes a product row with a
        # dead image. 422, not 500: the request was wrong, not the server.
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(422, str(e)) from e

    if not storage.available():
        # No S3 configured — a normal dev box. Keep the staged bytes so the flow still
        # completes and say so loudly, rather than writing another URL that points nowhere.
        log.warning("object storage is not configured; upload %s stays local", up.id)
        raise HTTPException(503, "object storage is not configured")

    urls = {}
    try:
        for name, data in variants.items():
            # `full` is the archival original and is NOT public — see storage.py. The
            # derived sizes are what a marketplace page links to.
            key = storage.key_for(artisan.id, up.id, name, public=(name != "full"))
            urls[name] = storage.put(key, data)
    except storage.StorageError as e:
        # Staged chunks are deliberately left in place: the artisan already spent the data
        # to send them, and a retry of /complete should not cost them a second upload.
        raise HTTPException(503, f"could not store image: {e}") from e

    # Only now is the upload really done, so only now do the chunks go.
    shutil.rmtree(d, ignore_errors=True)

    up.url = urls.get("display") or urls["full"]
    db.commit()
    return {"url": up.url, "variants": urls}
