"""Catalog CRUD, and the two AI hops that build a listing.

The catalog is ours (spec §2, rule 1). Products live in our DB whether or not the artisan
ever joins a platform, and editing once regenerates every channel export.
"""

from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import objectstore
from ..caching import conditional
from ..config import settings
from ..db import get_db
from .. import learning, taxonomy
from ..models import (
    Artisan,
    FieldCorrection,
    InventoryLedger,
    Product,
    ProductImage,
    Upload,
)
from ..security import current_artisan

log = logging.getLogger(__name__)

router = APIRouter()


class ProductIn(BaseModel):
    title: str | None = None
    desc_en: str | None = None
    desc_hi: str | None = None
    category: str | None = None
    material: str | None = None
    technique: str | None = None
    dye_type: str | None = None
    time_taken_hours: float | None = None
    dimensions: str | None = None
    weight_grams: int | None = None
    is_fragile: bool = False
    cost_material: float | None = None
    labour_hours: float | None = None
    price: float | None = None
    mrp: float | None = None
    # Stored, not just shown. channels/gem.py refuses to publish when GeM's mandated
    # discount would push the price under this — and that check reads it off the product,
    # so a floor that only ever lived in the /price response left the guard permanently
    # skipped on our headline channel.
    floor_price: float | None = None
    is_made_to_order: bool = False
    lead_time_days: int | None = None
    quantity: int = 1


@router.post("/products")
def create(
    body: ProductIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    product = Product(artisan_id=artisan.id, **body.model_dump(exclude={"quantity"}))
    db.add(product)
    db.flush()
    db.add(InventoryLedger(product_id=product.id, available_qty=body.quantity))
    db.commit()
    return {"id": product.id}


@router.get("/products")
def mine(
    request: Request,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Response:
    """The artisan's catalogue, five columns wide.

    This loaded whole Product entities and then read `p.images` inside the comprehension —
    one extra query per product, so a 40-product catalogue was 41 round trips through the
    pooler to build a list of five fields. The primary image is an outer join now, and the
    columns are named rather than taken wholesale: the descriptions and the channel payloads
    are long text this response never contained and no longer transfers.
    """
    primary = (
        select(ProductImage.product_id, func.min(ProductImage.url).label("url"))
        .where(ProductImage.is_primary.is_(True))
        .group_by(ProductImage.product_id)
        .subquery()
    )
    rows = (
        db.query(
            Product.id,
            Product.title,
            Product.price,
            Product.colour_confirmed,
            primary.c.url,
        )
        .outerjoin(primary, primary.c.product_id == Product.id)
        .filter(Product.artisan_id == artisan.id)
        # created_at DESC then id. Without the tiebreak two products created in the same
        # millisecond can swap places between pages, and one of them is then never shown.
        .order_by(Product.created_at.desc(), Product.id)
        .limit(limit)
        .offset(offset)
        .all()
    )
    payload = [
        {
            "id": r.id,
            "title": r.title,
            "price": float(r.price) if r.price is not None else None,
            "colour_confirmed": r.colour_confirmed,
            "image": r.url,
        }
        for r in rows
    ]
    return conditional(request, payload, max_age=30)


# The fields the cataloguer is allowed to answer from an artisan's own history, and the
# Product column each one reads. Mirrors `carriesForward` in app/src/catalog/slots.js — a
# field in one and not the other is a question asked twice or a default nobody offered.
#
# Deliberately short. A weaver's fibre and turnaround are properties of *them*; a stock
# count and a material cost are properties of the object in front of them, and carrying
# those forward would put last week's numbers under this week's photo.
CARRY_FORWARD = {
    "material": Product.material,
    "lead_time": Product.lead_time_days,
    "weight": Product.weight_grams,
}


@router.get("/catalog/defaults")
def catalog_defaults(
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """What this artisan has already told us, so the cataloguer stops asking for it.

    This is the whole "the app gets quieter the longer you use it" claim, and it is a
    single query — no model, no embedding, no similarity search. See
    docs/Utsav/Product_Questions.md §6.6 for why it is deliberately not a vector store:
    the question "what did this person last say" is a lookup, and dressing it as retrieval
    would add a service, a per-call cost and a non-deterministic answer to a screen that
    has to work on a rural network.

    **Most recent non-null wins, per field independently.** Not the mode: a potter who has
    moved from terracotta to stoneware means it, and the majority of their history is
    exactly the wrong answer. Each field is resolved on its own so one product with a
    weight but no material still contributes its weight.

    Every value is offered to the artisan as a confirmation, never written silently — the
    app turns these into "cotton again?" (`catalog.confirm_same`), which is a tap. A
    default that publishes without being confirmed is a guess under somebody's name.
    """
    # Columns built FROM the map, not listed again alongside it. Writing them out twice is
    # two orderings that have to agree, and the day they stop agreeing every artisan is
    # asked to confirm their material and shown their weight.
    names = list(CARRY_FORWARD)
    rows = (
        db.query(*(CARRY_FORWARD[n] for n in names))
        .filter(Product.artisan_id == artisan.id)
        .order_by(Product.created_at.desc(), Product.id)
        # Enough history to survive a few sparse drafts, small enough to stay one cheap
        # read on the hot path of every new product.
        .limit(20)
        .all()
    )

    out: dict[str, object] = {}
    for row in rows:
        for name, value in zip(names, row, strict=True):
            if name not in out and value is not None:
                out[name] = value
        if len(out) == len(names):
            break

    # What we got WRONG, which outranks what they merely said. See learning.py: a value the
    # artisan typed over the top of ours is the strongest signal about a field we ever get,
    # and a field we keep having to walk back stops being offered at all — a confirmation
    # they have learned to reject is worse than the open question it replaced.
    corrections = [
        {"field": r.field, "guessed": r.guessed, "corrected": r.corrected, "source": r.source}
        for r in (
            db.query(FieldCorrection)
            .filter(FieldCorrection.artisan_id == artisan.id)
            .order_by(FieldCorrection.created_at.desc(), FieldCorrection.id)
            .limit(200)
            .all()
        )
    ]
    return learning.apply(out, corrections)


class CorrectionIn(BaseModel):
    field: str
    corrected: str
    guessed: str | None = None
    # "prefill" (vision read the photo) or "default" (carried forward). Scored separately,
    # because a bad vision model and stale history need different fixes.
    source: str = "default"
    product_id: str | None = None


@router.post("/catalog/corrections")
def record_correction(
    body: CorrectionIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Remember that we guessed and the artisan changed it.

    🔑 The half of "the app learns with you" that is worth more than the other half.
    /catalog/defaults remembers what they SAID; this remembers what we got WRONG, which is a
    labelled example — guess, truth, and which guesser produced it.

    Fire-and-forget from the app's side and deliberately cheap: it is called from the middle
    of a correction the artisan is already making, and a failure here must never surface to
    them. Losing one row costs a little learning; interrupting them to say so costs the
    correction itself.

    Only fields the cataloguer actually offers are stored. A caller naming something else is
    either a bug or an attempt to use this as free key/value storage against an artisan's
    row, and neither should be written.
    """
    field = (body.field or "").strip()
    if field not in learning.CORRECTABLE_FIELDS:
        raise HTTPException(422, f"not a correctable field: {field!r}")

    corrected = (body.corrected or "").strip()
    if not corrected:
        raise HTTPException(422, "corrected value is empty")

    # An unowned product id is dropped rather than refused: the correction is still true and
    # still worth learning from, and the artisan is mid-flow. Nothing here reads the product,
    # so a null is harmless -- but storing someone else's id on our row is not.
    product_id = body.product_id
    if product_id and db.query(Product.id).filter(
        Product.id == product_id, Product.artisan_id == artisan.id
    ).first() is None:
        product_id = None

    db.add(
        FieldCorrection(
            artisan_id=artisan.id,
            product_id=product_id,
            field=field,
            guessed=(body.guessed or None),
            corrected=corrected[:300],
            source=body.source if body.source in ("prefill", "default") else "default",
            craft=artisan.craft,
        )
    )
    db.commit()
    return {"ok": True}


def _own(product_id: str, db: Session, artisan: Artisan) -> Product:
    p = db.get(Product, product_id)
    if p is None or p.artisan_id != artisan.id:
        raise HTTPException(404, "product not found")
    return p


@router.patch("/products/{product_id}")
def update(
    product_id: str,
    body: ProductIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    p = _own(product_id, db, artisan)
    for k, v in body.model_dump(exclude_unset=True, exclude={"quantity"}).items():
        setattr(p, k, v)

    # 🐞 `category_map` had five readers and no writers, so every adapter's
    # `(product.category_map or {}).get("gem_id")` resolved to None: GeM emitted a generic
    # sheet, Amazon sent no product type, Flipkart no vertical. The mapping was designed and
    # then never populated, which made the step gem.py calls "the hardest and most valuable
    # in the whole system" a silent no-op.
    #
    # Derived HERE rather than in the app so every writer gets it -- the cataloguer, a later
    # edit from /products/:id, and anything added next. Recomputed on every PATCH because
    # the category can change and a stale map is worse than an absent one: it publishes a
    # saree under a pottery heading with nothing to show it went wrong.
    resolved = taxonomy.lookup(p.category, artisan.craft)
    if resolved:
        p.category_map = {
            k: resolved[k]
            for k in ("gem_id", "amazon_node", "flipkart_vertical", "ondc_code", "meesho_cat")
            if resolved.get(k)
        } | {"gst_rate": resolved.get("gst_rate"), "amazon_ptc": resolved.get("amazon_ptc")}

        # Six of the seven marketplaces make HSN mandatory and no artisan can supply one.
        # Only filled when empty: a code somebody set deliberately outranks our table, and
        # `verified: False` rows are guidance rather than settled -- see taxonomy.py.
        if not p.hsn_code and resolved.get("hsn"):
            p.hsn_code = resolved["hsn"]

    db.commit()
    return {"ok": True, "category_map": p.category_map, "hsn_code": p.hsn_code}


class ImageIn(BaseModel):
    url: str
    size_variant: str = "raw"
    is_primary: bool = False


@router.post("/products/{product_id}/images")
def add_image(
    product_id: str,
    body: ImageIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Link a completed upload to a product.

    This is what `enhance()` below looks for: without a `size_variant == "raw"` row there
    is no image to enhance, and the whole AI path stops before it starts.

    🔒 The url is not taken on trust. It has to match an `Upload` row belonging to this
    artisan, because that url is a filesystem URI the AI service will later open — an
    unchecked string here is an arbitrary-file-read with extra steps.
    """
    p = _own(product_id, db, artisan)

    up = db.query(Upload).filter_by(artisan_id=artisan.id, url=body.url).first()
    if up is None:
        raise HTTPException(400, "unknown image url")

    existing = next(
        (i for i in p.images if i.url == body.url and i.size_variant == body.size_variant),
        None,
    )
    if existing is not None:
        # The app retries this call after a dropped response. A second row would give
        # `enhance()` two raw images and a coin flip over which one it sends.
        return {"id": existing.id}

    img = ProductImage(
        product_id=p.id, url=body.url,
        size_variant=body.size_variant, is_primary=body.is_primary,
    )
    db.add(img)
    db.commit()
    return {"id": img.id}


@router.post("/products/{product_id}/confirm-colour")
def confirm_colour(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """The colour lock (spec §5.6).

    After white balance we ask, by voice, "kya yeh asli rang hai?" and publish only on
    confirmation. Practically: return rate destroys artisan income. Legally:
    misrepresentation is a listing violation. Both point the same way.
    """
    p = _own(product_id, db, artisan)
    p.colour_confirmed = True
    db.commit()
    return {"ok": True}


# -- the AI hops -------------------------------------------------------------
# web/ calls ai/ over HTTP and never imports across that line. They are separate deploy
# units; the AI box has a GPU that this one does not.


async def _ai(path: str, payload: dict) -> dict:
    async with httpx.AsyncClient(base_url=settings().ai_base_url, timeout=60) as client:
        res = await client.post(path, json=payload)
        res.raise_for_status()
        return res.json()


async def _ai_get(path: str) -> dict:
    async with httpx.AsyncClient(base_url=settings().ai_base_url, timeout=30) as client:
        res = await client.get(path)
        res.raise_for_status()
        return res.json()


@router.post("/products/{product_id}/enhance")
async def enhance(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    p = _own(product_id, db, artisan)
    raw = next((i.url for i in p.images if i.size_variant == "raw"), None)
    if not raw:
        raise HTTPException(400, "no raw image")

    """
    ⚠️ Send the FULL variant, not the url on the image row.

    What `add_image` stores is `Upload.url`, and `complete()` sets that to the DISPLAY
    variant — 1200px on the long edge — because that string is also what the app renders in
    an <img> and what a marketplace links to. It is the right url for looking at and the
    wrong one for processing: at 4:3 it is 900x1200, and `ai/enhance/pipeline.py` gate()
    refuses anything under `resolution_min_px` (1000) on the SHORT side. Every photograph
    came back `photo.too_small` without the model ever running.

    `full` is never resized (web/api/images.py) and is the variant the pipeline is meant to
    see. It lives in the private bucket, so it is handed over as a short-lived signed URL:
    `ai/` holds no S3 credentials by design, and the artisan's full-resolution photograph
    does not become publicly readable just because we wanted to enhance it.
    """
    source = raw
    if objectstore.available():
        up = db.query(Upload).filter_by(artisan_id=artisan.id, url=raw).first()
        if up is not None:
            try:
                source = objectstore.signed_url(
                    objectstore.key_for(artisan.id, up.id, "full", public=False)
                )
            except objectstore.StorageError as e:
                # Fall back to the display url rather than failing the request. It may still
                # be refused for size, but the artisan hears a real reason either way.
                log.warning("could not sign full variant for %s: %s", up.id, e)

    job = await _ai("/enhance", {
        "product_id": p.id, "image_url": source,
        "targets": ["amazon", "gem", "whatsapp"],
    })
    # Bind the job to this product so the poll below can check ownership. Recorded before
    # the response leaves, or the app is handed a job id nothing on this side recognises.
    if job.get("job_id"):
        p.enhance_job_id = job["job_id"]
        db.commit()
    return job


def _source_url(p: Product, artisan: Artisan, db: Session) -> str:
    """The url the pipeline should read. Extracted so enhance and rerender cannot diverge.

    See the note in `enhance()`: the row carries the 1200px DISPLAY variant, and the gate
    refuses anything under 1000px on the short side, so processing must be handed the `full`
    variant instead — signed, because `ai/` holds no S3 credentials and an artisan's
    full-resolution photograph should not become publicly readable to enhance it.
    """
    raw = next((i.url for i in p.images if i.size_variant == "raw"), None)
    if not raw:
        raise HTTPException(400, "no raw image")
    if not objectstore.available():
        return raw
    up = db.query(Upload).filter_by(artisan_id=artisan.id, url=raw).first()
    if up is None:
        return raw
    try:
        return objectstore.signed_url(objectstore.key_for(artisan.id, up.id, "full", public=False))
    except objectstore.StorageError as e:
        log.warning("could not sign full variant for %s: %s", up.id, e)
        return raw


class RerenderIn(BaseModel):
    # "A" removes the background, "B" softens the edge, "C" keeps it. The artisan is the
    # only one who can see whether the cut-out is right, which is the whole point.
    tier: str


@router.post("/products/{product_id}/rerender")
async def rerender(
    product_id: str,
    body: RerenderIn,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Replay a stored recipe at a different tier. Asked for in docs/Abhay/REQUEST-STEP5-WEB.md.

    **Synchronous, and deliberately so.** With the mask cached the work is shorter than a
    round trip — 131ms measured, against 8848ms for a fresh `/enhance` — so a job id and a
    poll would cost more than they save. This is what makes a tier picker worth building at
    all: three thumbnails, about 200ms each, instead of twenty seconds to undo one decision.

    🔒 `tier_source` becomes "user" the moment somebody chooses here, and nothing automatic
    may overrule that later. This route stores whatever the service returns and never
    recomputes a tier — see `_store_recipe`.

    A product enhanced before the recipe column was filled has `{}`, and the honest answer
    is a fresh `/enhance` rather than a re-render of nothing.
    """
    p = _own(product_id, db, artisan)

    tier = (body.tier or "").strip().upper()
    if tier not in ("A", "B", "C"):
        raise HTTPException(400, "tier must be A, B or C")

    if not p.recipe:
        # 409, not 500: nothing is broken, this product simply predates the recipe system.
        raise HTTPException(409, "no stored recipe — run /enhance first")

    job = await _ai("/enhance/rerender", {
        "product_id": p.id,
        "image_url": _source_url(p, artisan, db),
        "recipe": p.recipe,
        "tier": tier,
        "targets": ["amazon", "gem", "whatsapp"],
    })

    recipe = job.get("recipe")
    if isinstance(recipe, dict) and recipe.get("mask_version"):
        p.recipe = recipe
        p.mask_version = recipe["mask_version"]
        db.commit()

    # Same republish as the poll path: the AI service writes to its own disk, and a WebView
    # cannot open a path on the AI box.
    return _publish_results(job, p, artisan, db)


@router.get("/enhance/{job_id}")
async def enhance_status(
    job_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Poll an enhancement job. The contract path in `ai/contracts.md`, proxied.

    The app polls this every two seconds from `/catalog/prefill` and degrades to the
    artisan's own photo on any failure — so a 404 here is survivable by design, and was in
    fact the entire behaviour until this route existed.

    🔒 The job id alone is not authorisation. It has to belong to one of this artisan's
    products, or one artisan could poll another's job and read back the image urls.
    """
    owner = db.query(Product).filter_by(artisan_id=artisan.id, enhance_job_id=job_id).first()
    if owner is None:
        raise HTTPException(404, "unknown job")
    job = await _ai_get(f"/enhance/{job_id}")
    _store_recipe(job, owner, db)
    return _publish_results(job, owner, artisan, db)


def _store_recipe(job: dict, product: Product, db: Session) -> None:
    """Keep the recipe the pipeline just computed. Asked for in docs/Abhay/REQUEST-STEP5-WEB.md.

    Every `done` body carries one, and until this existed it was computed, returned and
    thrown away — so the `recipe` column added in migration c3a71f0d5e42 stayed empty and
    `POST /enhance/rerender` had nothing to replay. It still worked; it just fell back to a
    full segmentation pass, which measured 8848ms against 131ms for a replay.

    🔒 `tier_source` is the one field only this side can wreck.

    It reads "auto" until a person changes the tier, then "user". Once an artisan has
    overruled the confidence score, nothing automatic may quietly overrule them back — so
    this stores what the service returned and never recomputes a tier. Any future batch job
    or migration that re-renders on their behalf has to carry the field through unchanged.

    Silent on anything unexpected: a malformed recipe costs a fast re-render, and that is
    not worth failing a poll the app depends on to show the artisan their photo.
    """
    if job.get("status") != "done":
        return
    recipe = job.get("recipe")
    if not isinstance(recipe, dict) or not recipe.get("mask_version"):
        return
    product.recipe = recipe
    product.mask_version = recipe["mask_version"]
    db.commit()


def _publish_results(job: dict, product: Product, artisan: Artisan, db: Session) -> dict:
    """Put the pipeline's output somewhere the phone can actually load it.

    🐞 `ai/enhance/storage.py` writes each rendered variant to local disk and returns
    `file:///tmp/rubix-ai-out/...`. A WebView on a phone cannot open a path on the AI box,
    so `displayable()` in CatalogPrefill.tsx fell through to the artisan's OWN photo and the
    screen showed the unprocessed original — while announcing that the photo had been
    improved, and then asking "is this the real colour?" about an image nothing had touched.

    That last part is the reason this is not cosmetic. The colour lock is the one hard gate
    before publishing (`colour_confirmed`), and it exists because white balance MOVES
    colour. Asking it against the original makes the artisan confirm a question that was
    never posed — the gate still latches, and nothing downstream can tell it was answered
    about the wrong picture.

    ⚠️ CEILING: this reads the AI service's local files, so it only works while both
    services share a machine — which is the dev setup and not production. The right home for
    this is `ai/enhance/storage.py` publishing directly (`contracts.md` already specifies
    `s3://out/...` as the output), and that needs storage credentials in `ai/.env`, which it
    does not have today. Move it there before this is deployed anywhere real.
    """
    if not objectstore.available():
        return job

    images = job.get("images")
    if not images:
        return job

    for img in images:
        url = img.get("url") or ""
        if not url.startswith("file://"):
            continue  # already published, or a scheme we do not own
        src = Path(unquote(urlparse(url).path))
        if not src.exists():
            log.warning("enhanced file missing on the ai box: %s", src)
            continue
        try:
            key = objectstore.key_for(
                artisan.id, product.id, f"enh_{img.get('target', 'out')}", public=True
            )
            img["url"] = objectstore.put(key, src.read_bytes())
        except (objectstore.StorageError, OSError) as e:
            # Leave the file:// url in place. The app degrades to the artisan's own photo,
            # which is what it did before this function existed — a failure here costs the
            # prettier picture, never the listing (rule 3).
            log.warning("could not publish %s: %s", src.name, e)

    _record_variants(images, product, db)
    return job


# What the pipeline calls a target, and what the rest of the system calls that variant.
# `whatsapp.py` matches on `social_1080` exactly, and models.py names the other two — so
# these strings are a contract, not a convention.
VARIANT_FOR_TARGET = {
    "amazon": "amazon_2000",
    "gem": "gem",
    "whatsapp": "social_1080",
}

# Which variant a human should be shown when several exist. Square first: it is the one cut
# to the subject, so it reads at thumbnail size on /products where the original does not.
PRIMARY_PREFERENCE = ("social_1080", "amazon_2000", "gem", "raw")


def _record_variants(images: list, product: Product, db: Session) -> None:
    """Persist the enhanced renditions as real rows, and promote one to primary.

    🐞 This function is the fix for four bugs that were all the same bug.

    `_publish_results` rewrote the urls INSIDE the job body and wrote nothing to the
    database. `product_images` therefore only ever held the `raw` row that CaptureReview
    creates, and `raw` is the artisan's untouched photograph. Consequences, none of which
    announced themselves:

      * /products showed the original on the dashboard — the uncropped, unlit photo, next
        to a listing that claims the picture was improved.
      * `amazon.py`, `flipkart.py` and `ondc.py` read `product.images` and published that
        same original to the marketplaces.
      * `whatsapp.py` matches `size_variant == "social_1080"`, which never existed, so
        WhatsApp got an empty image list every time.

    The pipeline had done all the work and then the results were dropped on the floor.

    Idempotent per (product, variant): polling `/enhance/{job_id}` twice, or re-rendering at
    a different tier, updates the row in place instead of stacking duplicates that
    `format_images` would then send three of.

    `is_generated` stays False. These are the artisan's own pixels — segmented, cropped and
    composited, never fabricated (CLAUDE.md rule 1) — and the adapters that refuse generated
    images are right to accept these.
    """
    written: list[str] = []
    for img in images:
        url = img.get("url") or ""
        # A file:// url is one we failed to publish. Storing it would put a path on the AI
        # box into a listing, so the raw photo stays primary and the artisan keeps a
        # working screen.
        if not url.startswith(("http://", "https://")):
            continue
        variant = VARIANT_FOR_TARGET.get(img.get("target") or "", img.get("target") or "out")
        row = (
            db.query(ProductImage)
            .filter_by(product_id=product.id, size_variant=variant)
            .first()
        )
        if row is None:
            row = ProductImage(product_id=product.id, size_variant=variant)
            db.add(row)
        row.url = url
        row.is_generated = False
        row.is_primary = False
        written.append(variant)

    if not written:
        return

    # Exactly one primary, chosen by preference rather than by whichever row was written
    # last. Two primaries would make `amazon.py`'s main-image pick non-deterministic.
    best = next((v for v in PRIMARY_PREFERENCE if v in written), written[0])
    db.flush()
    for row in db.query(ProductImage).filter_by(product_id=product.id).all():
        row.is_primary = row.size_variant == best
    db.commit()


@router.post("/products/{product_id}/prefill")
async def prefill(
    product_id: str,
    db: Session = Depends(get_db),
    artisan: Artisan = Depends(current_artisan),
) -> dict:
    """Vision pre-fill before the artisan says anything (spec §6.4).

    The friction killer: instead of describing a saree from scratch, they only correct
    what we guessed. "Yeh Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?" -> yes.
    """
    p = _own(product_id, db, artisan)
    raw = next((i.url for i in p.images if i.is_primary), None)
    return await _ai("/catalog/prefill", {"image_url": raw})
