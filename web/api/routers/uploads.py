"""Resumable chunked upload.

Online-first (docs/decisions.md): this exists so a dropped connection resumes from the last
acknowledged chunk instead of restarting a 3MB photo on a rural tower. It is not an offline
queue and it is not a sync engine.

Chunks land on disk under `settings().storage_dir` and are concatenated on `complete()`,
which returns a url. That url is what `POST /products/{id}/images` accepts and what `ai/`
is eventually handed. Where the bytes actually go is `../storage.py`'s problem — and, once S3 is configured,
`../objectstore.py`'s.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import objectstore
from ..config import settings
from ..db import get_db
from ..images import derive
from ..models import Artisan, Upload
from ..security import current_artisan
from ..storage import AssemblyError, assemble, final_path, parts_dir

router = APIRouter()
log = logging.getLogger(__name__)

MAX_BYTES = 25 * 1024 * 1024
CHUNK_SIZE = 256 * 1024

# A chunk is 256KB by contract. The slack is for a client that rounded up or is on an older
# chunk size; the cap is here because `size` is checked once in start() and a client that
# lies about it would otherwise write to disk without limit.
MAX_CHUNK_BYTES = 2 * CHUNK_SIZE


class StartUpload(BaseModel):
    size: int
    chunks: int
    content_type: str = "image/jpeg"


def _root() -> Path:
    return Path(settings().storage_dir)


@router.post("/uploads")
def start(
    req: StartUpload,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    if req.size <= 0 or req.size > MAX_BYTES:
        raise HTTPException(413, "image too large")
    if req.chunks <= 0 or req.chunks > (MAX_BYTES // CHUNK_SIZE) + 1:
        raise HTTPException(400, "bad chunk count")
    up = Upload(
        artisan_id=artisan.id, size=req.size, chunks=req.chunks,
        content_type=req.content_type, received=[],
    )
    db.add(up)
    db.commit()
    return {"upload_id": up.id, "chunk_size": CHUNK_SIZE}


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
    if up.url:
        raise HTTPException(409, "upload already completed")

    data = await chunk.read()
    if len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(413, "chunk too large")

    parts = parts_dir(_root(), up.id)
    parts.mkdir(parents=True, exist_ok=True)
    # Zero-padded so a plain sorted() over the directory is index order.
    (parts / f"{index:06d}").write_bytes(data)

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
    # Idempotent: the app retries `complete` on a dropped response, and by then the parts
    # are gone. Returning the url it already has is the honest answer, not a 409.
    if up.url:
        return {"url": up.url}

    if len(up.received) != up.chunks:
        missing = sorted(set(range(up.chunks)) - set(up.received))
        raise HTTPException(409, f"missing chunks: {missing[:10]}")

    parts = parts_dir(_root(), up.id)
    final = final_path(_root(), up.id, up.content_type)
    try:
        assemble(parts, up.chunks, up.size, final)
    except AssemblyError as e:
        # 409, not 500: the client can fix this by sending the chunks again, and upload.js
        # retries transport and 5xx only — a 500 here would stall silently.
        raise HTTPException(409, str(e)) from e

    shutil.rmtree(parts, ignore_errors=True)
    up.url = final.resolve().as_uri()

    # Publish, if there is anywhere to publish to.
    #
    # The local file:// url above is what `ai/` opens on the same machine, and it stays the
    # answer when S3 is unconfigured — an unset bucket is a normal dev box, not an error,
    # and answering 503 here is what blocked the image pipeline from being testable at all
    # (docs/Abhay/PIPELINE-RECONCILIATION.md §5, finding 1).
    #
    # With S3 configured the derived variants go up and the artisan's ORIGINAL does not
    # follow them into the public bucket: raw/ is a private bucket, and what a marketplace
    # page links to is only ever something we deliberately derived for it.
    if objectstore.available():
        try:
            original = final.read_bytes()
            for name, data in derive(original).items():
                key = objectstore.key_for(artisan.id, up.id, name, public=(name != "full"))
                url = objectstore.put(key, data)
                if name == "display":
                    up.url = url
            objectstore.put(
                objectstore.key_for(artisan.id, up.id, "original", public=False), original
            )
        except (objectstore.StorageError, ValueError) as e:
            # The bytes are already safe on disk and the url already resolves. A failed
            # publish costs the marketplace variants, never the upload — rule 3.
            log.warning("upload %s assembled but not published: %s", up.id, e)

    db.commit()
    return {"url": up.url}
