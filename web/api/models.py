"""Data model. Spec §15.

The privacy shape is the important part and it is load-bearing, not decorative:
Artisan carries readiness BOOLEANS and never the underlying values. `has_pan` is true or
false; the PAN number itself has no column here, in any table, ever. What we don't store
cannot leak (spec §14.1), and the boolean design is what keeps us out of DPDP's heaviest
obligations entirely.

If you are ever tempted to add `pan_number` to this file, read spec §14.2 first.
"""

from __future__ import annotations

import enum
import re
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _id() -> str:
    return uuid.uuid4().hex


class Channel(str, enum.Enum):
    marketplace = "marketplace"
    ondc = "ondc"
    gem = "gem"
    amazon = "amazon"
    flipkart = "flipkart"
    meesho = "meesho"
    whatsapp = "whatsapp"


class SignupStatus(str, enum.Enum):
    not_started = "not_started"
    taught = "taught"
    self_reported_done = "self_reported_done"
    connected = "connected"  # tier B only: we hold a live OAuth token


class OrderState(str, enum.Enum):
    placed = "placed"
    packed = "packed"
    shipped = "shipped"
    delivered = "delivered"
    settled = "settled"
    cancelled = "cancelled"


class FulfilmentModel(str, enum.Enum):
    a_marketplace = "A_marketplace"
    b_aggregator = "B_aggregator"
    c_cluster_hub = "C_cluster_hub"


class Cluster(Base):
    """A Common Facility Centre / Block Level Cluster. Government infrastructure that
    already exists — we plug into it rather than building a logistics operation."""

    __tablename__ = "clusters"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    name: Mapped[str] = mapped_column(String(200))
    district: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(120))
    wage_rate_per_hour: Mapped[float | None] = mapped_column(Numeric(10, 2))
    # How an artisan finds their cluster. OnboardPlace already asks for a pincode; this is
    # the join it was always meant to have. Longest prefix wins, and no match leaves
    # cluster_id NULL, so pricing falls back to the default wage rather than a wrong one.
    pincode_prefix: Mapped[str | None] = mapped_column(String(6), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Artisan(Base):
    __tablename__ = "artisans"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    phone: Mapped[str] = mapped_column(String(15), unique=True, index=True)
    language: Mapped[str] = mapped_column(String(8), default="hi")
    display_name: Mapped[str | None] = mapped_column(String(200))
    craft: Mapped[str | None] = mapped_column(String(80))
    cluster_id: Mapped[str | None] = mapped_column(ForeignKey("clusters.id"))
    pincode: Mapped[str | None] = mapped_column(String(6))
    upi_id: Mapped[str | None] = mapped_column(String(120))  # payout only

    # 🔒 Readiness FLAGS ONLY. Never the values. Not now, not later.
    has_pan: Mapped[bool] = mapped_column(Boolean, default=False)
    has_bank: Mapped[bool] = mapped_column(Boolean, default=False)
    has_gst: Mapped[bool] = mapped_column(Boolean, default=False)
    has_artisan_card: Mapped[bool] = mapped_column(Boolean, default=False)
    intra_state_only: Mapped[bool] = mapped_column(Boolean, default=True)

    # Which marketplaces this artisan already sells on, as stable channel ids
    # (`amazon`, `flipkart`, `meesho`, `whatsapp`). Asked once, in onboarding.
    #
    # 🔑 A question-reduction field before it is anything else. `plan()` in
    # app/src/catalog/slots.js only asks for a slot some target channel needs, so an artisan
    # with no Amazon or Flipkart account is never asked for a shipping weight at all —
    # several of the nine questions exist solely to satisfy channels they may never use.
    #
    # Deliberately NOT the same thing as `ChannelStatus.refresh_token_enc`. That records
    # "we hold an OAuth token"; this records "they told us they have an account". They
    # answer different questions: the first decides whether we can push, the second decides
    # whether the channel is worth showing at all. Someone with an Amazon account they have
    # not connected gets a Connect button; someone who has never heard of Amazon should not
    # be offered anything.
    #
    # Not a readiness flag and not covered by the rule above it: a channel id is not a
    # financial fact about a named person, and it never leaves our own services.
    sells_on: Mapped[list] = mapped_column(JSON, default=list)

    # Result of the name-consistency pre-check (§6.1). A boolean, not the names — name
    # mismatch across Aadhaar/PAN/GST/bank is the top GeM rejection cause, and catching it
    # before they start is worth far more than storing what they said.
    name_check_passed: Mapped[bool | None] = mapped_column(Boolean)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    products: Mapped[list[Product]] = relationship(back_populates="artisan")


class Consent(Base):
    """DPDP consent artifact. The notice is played by VOICE in the artisan's own language
    (spec §14.6) — which is both the compliance requirement and the accessibility one."""

    __tablename__ = "consents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)
    language: Mapped[str] = mapped_column(String(8))
    notice_version: Mapped[str] = mapped_column(String(20))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)

    title: Mapped[str | None] = mapped_column(String(300))
    # English AND Hindi. Both. Always. The PS says "in English and Hindi" and a listing
    # with only one of them does not satisfy feature 2.
    desc_en: Mapped[str | None] = mapped_column(Text)
    desc_hi: Mapped[str | None] = mapped_column(Text)

    category: Mapped[str | None] = mapped_column(String(120))  # our internal taxonomy
    category_map: Mapped[dict] = mapped_column(JSON, default=dict)  # gem_id, amazon_node, ...

    # Structured manufacture info (spec §6.5). Feeds pricing, the craft story, and
    # authenticity all at once — high value, cheap to capture.
    material: Mapped[str | None] = mapped_column(String(120))
    technique: Mapped[str | None] = mapped_column(String(120))
    dye_type: Mapped[str | None] = mapped_column(String(80))
    loom_type: Mapped[str | None] = mapped_column(String(80))
    time_taken_hours: Mapped[float | None] = mapped_column(Numeric(8, 2))
    dimensions: Mapped[str | None] = mapped_column(String(120))
    weight_grams: Mapped[int | None] = mapped_column(Integer)
    is_fragile: Mapped[bool] = mapped_column(Boolean, default=False)
    hsn_code: Mapped[str | None] = mapped_column(String(12))

    cost_material: Mapped[float | None] = mapped_column(Numeric(10, 2))
    labour_hours: Mapped[float | None] = mapped_column(Numeric(8, 2))
    floor_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    mrp: Mapped[float | None] = mapped_column(Numeric(10, 2))
    price: Mapped[float | None] = mapped_column(Numeric(10, 2))

    # Made-to-order has no race condition at all (spec §10.3). Most handicrafts are
    # replicable, so pushing artisans here shrinks the oversell problem rather than
    # solving it with locks.
    is_made_to_order: Mapped[bool] = mapped_column(Boolean, default=False)
    lead_time_days: Mapped[int | None] = mapped_column(Integer)

    gi_claim: Mapped[str | None] = mapped_column(String(120))
    certifications: Mapped[list] = mapped_column(JSON, default=list)

    # Publishing is blocked until the artisan confirms the colour survived white balance.
    colour_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)

    # 🔑 The enhancement, stored as PARAMETERS rather than as a modified image.
    #
    # Rule 2 in CLAUDE.md — never destroy the original — is currently kept by discipline: the
    # pipeline is a sequence of stages each returning a mutated image, and nothing structural
    # stops one from overwriting what the artisan photographed. A recipe makes it true by
    # construction. `render(original, mask, recipe)` is the only thing that produces pixels,
    # so the original is provably untouched, "the artisan chose a different tier" becomes a
    # field write instead of a re-run of segmentation, and a better mask later can re-render
    # everything without discarding a single choice they made.
    #
    # Shape is owned by ai/ and documented in docs/Abhay/PIPELINE-RECONCILIATION.md §4 —
    # white balance gains, CLAHE limits, gamma, tier, shadow, crop. Deliberately schemaless
    # here: this table should not need a migration every time a stage gains a parameter.
    recipe: Mapped[dict] = mapped_column(JSON, default=dict)

    # Which segmentation model produced the mask this recipe was built against. The reason
    # to keep it is re-rendering: when a better mask ships, this is what says which products
    # are worth re-running and which are already current.
    mask_version: Mapped[str | None] = mapped_column(String(40))

    # The AI service's job id for the most recent enhance run. Stored so that
    # GET /api/enhance/{job_id} can prove the caller owns the job before proxying it —
    # otherwise any authenticated artisan could poll anyone's job and read the image urls
    # that come back. Replaced on every new enhance.
    enhance_job_id: Mapped[str | None] = mapped_column(String(64), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    artisan: Mapped[Artisan] = relationship(back_populates="products")
    images: Mapped[list[ProductImage]] = relationship(back_populates="product")


class FieldCorrection(Base):
    """Every time we guessed a field and the artisan changed it.

    🔑 This is the half of "the app learns with you" that is worth more than the other half.
    `GET /catalog/defaults` remembers what an artisan SAID; this remembers what we got
    WRONG, which is a labelled example — we know the guess, we know the truth, and we know
    which of our two guessers produced it.

    Two things read it. It stops us re-offering a guess we keep having to walk back, and it
    prefers a correction over raw history when the two disagree, because a value the artisan
    typed over the top of ours is the strongest signal we ever get about a field.

    ⚠️ `guessed` and `corrected` are product descriptions — a material, a size, a title.
    Never a price, never a name, never anything from onboarding. The `source` column exists
    so a systematically wrong vision model can be told apart from a stale carried-forward
    default; they need different fixes and averaging them hides both.
    """

    __tablename__ = "field_corrections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"))

    field: Mapped[str] = mapped_column(String(40), index=True)
    guessed: Mapped[str | None] = mapped_column(String(300))
    corrected: Mapped[str] = mapped_column(String(300))
    # "prefill" (the vision model read the photo) or "default" (carried forward from an
    # earlier product). Anything else is a caller bug and is stored as given rather than
    # silently mapped, so it shows up in the data instead of hiding in it.
    source: Mapped[str] = mapped_column(String(20), default="default")
    # Denormalised on purpose: a weaver's corrections should not teach a potter, and
    # joining back through artisans to find out costs a query on every read.
    craft: Mapped[str | None] = mapped_column(String(80))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    size_variant: Mapped[str] = mapped_column(String(40))  # amazon_2000 | gem | social_1080
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    # Generated images are ALWAYS secondary, never primary. A generated main image is
    # "inaccurate representation" and gets the listing pulled.
    is_generated: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped[Product] = relationship(back_populates="images")


# Anchored, and it requires the /api/enhanced/ path to follow. An S3 url, a CDN url or a
# marketplace url has no business being rewritten — this shape is only ever produced by
# `_publish_local`.
_LOCAL_ENHANCED_HOST = re.compile(r"^https?://[^/]+(?=/api/enhanced/)")


@event.listens_for(ProductImage, "load")
def _drop_embedded_host(target: ProductImage, _context) -> None:
    """Strip the hostname off locally-served enhanced urls as rows come out of the database.

    🐞 `_publish_local` used to build absolute urls from whichever host the caller happened
    to reach the API on, and `_record_variants` writes those to `url`. Every enhanced product
    was therefore pinned to one laptop's DHCP lease. When the lease moved, 36 rows pointed at
    an address that no longer answered: thumbnails on /home and /products went blank, and
    /catalog/prefill asked "is this the real colour?" over an empty frame — the one question
    CLAUDE.md rule 4 says must never be asked about an image nobody can see.

    The writer is fixed and stores relative urls now. This heals rows written before that, and
    it lives here rather than in a migration for two reasons:

      * **Every reader is covered.** /products, /products/:id, the marketplace and the channel
        adapters all reach for `image.url` independently. Normalising at each call site is how
        one gets missed, and the one that gets missed is an adapter publishing a dead url into
        a real listing.
      * **No write to a shared database.** Teammates run against these same rows from
        different addresses; a migration picks one host's answer for everyone and has to be
        re-run after every lease change. This needs no coordination and cannot be forgotten.

    Idempotent and write-free: a relative url does not match, and mutating an attribute during
    `load` populates the instance without marking it dirty, so this never provokes an UPDATE.
    `scripts/relativise_enhanced_urls.py` still tidies the stored values permanently, but is
    no longer required for the app to work.
    """
    if target.url:
        target.url = _LOCAL_ENHANCED_HOST.sub("", target.url)


class ChannelStatus(Base):
    __tablename__ = "channel_status"
    __table_args__ = (UniqueConstraint("artisan_id", "channel"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)
    channel: Mapped[Channel] = mapped_column(Enum(Channel))
    signup_status: Mapped[SignupStatus] = mapped_column(
        Enum(SignupStatus), default=SignupStatus.not_started
    )
    # 🔒 Encrypted at rest. The ONLY third-party credential we ever hold, and only when the
    # artisan explicitly connects. We never see or store a platform password.
    refresh_token_enc: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    external_seller_id: Mapped[str | None] = mapped_column(String(120))
    last_export_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Listing(Base):
    """One product on one channel. This is what /publish writes."""

    __tablename__ = "listings"
    __table_args__ = (UniqueConstraint("product_id", "channel"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), index=True)
    channel: Mapped[Channel] = mapped_column(Enum(Channel))
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending|live|failed|file_ready
    external_id: Mapped[str | None] = mapped_column(String(200))
    artifact_url: Mapped[str | None] = mapped_column(String(500))  # the GeM .xlsx
    error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("channel", "external_order_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    channel: Mapped[Channel] = mapped_column(Enum(Channel))
    external_order_id: Mapped[str | None] = mapped_column(String(200))
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    amount: Mapped[float] = mapped_column(Numeric(10, 2))
    state: Mapped[OrderState] = mapped_column(Enum(OrderState), default=OrderState.placed)
    fulfilment_model: Mapped[FulfilmentModel | None] = mapped_column(Enum(FulfilmentModel))
    expected_settlement_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The "Paisa aaya?" tap (spec §11.3). We can see what a marketplace PROMISED; we
    # cannot see the artisan's bank account. This one tap turns that limitation into real
    # settlement-delay evidence across thousands of artisans.
    artisan_confirmed_payment: Mapped[bool | None] = mapped_column(Boolean)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryLedger(Base):
    """Single source of truth. No channel is authoritative (spec §10.2)."""

    __tablename__ = "inventory_ledger"

    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"), primary_key=True)
    available_qty: Mapped[int] = mapped_column(Integer, default=0)
    reserved_qty: Mapped[int] = mapped_column(Integer, default=0)
    # Optimistic lock. Two buyers, two platforms, the same one-of-a-kind saree, the same
    # second: first write wins, second is rejected. The propagation window cannot be
    # closed — every multichannel tool in the world lives with it — so we detect and
    # resolve rather than pretend.
    version: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Upload(Base):
    """Resumable chunked upload state. Online-first: this exists so a dropped connection
    resumes, not so the app works offline."""

    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    artisan_id: Mapped[str] = mapped_column(ForeignKey("artisans.id"), index=True)
    size: Mapped[int] = mapped_column(Integer)
    chunks: Mapped[int] = mapped_column(Integer)
    received: Mapped[list] = mapped_column(JSON, default=list)
    content_type: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StaffUser(Base):
    """Admin console. Multi-tenant: each agency sees only its own artisans."""

    __tablename__ = "staff_users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    cluster_id: Mapped[str | None] = mapped_column(ForeignKey("clusters.id"))
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)
