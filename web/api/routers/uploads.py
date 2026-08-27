"""Resumable chunked upload.

Online-first (docs/decisions.md): this exists so a dropped connection resumes from the last
acknowledged chunk instead of restarting a 3MB photo on a rural tower. It is not an offline
queue and it is not a sync engine.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..db import get_db
from ..models import Artisan, Upload
from ..security import current_artisan

router = APIRouter()

MAX_BYTES = 25 * 1024 * 1024


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

    # TODO(phase 1): stream to object storage as a multipart part rather than buffering.
    await chunk.read()

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
    up.url = f"s3://raw/{up.id}"
    db.commit()
    return {"url": up.url}
