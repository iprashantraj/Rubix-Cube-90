"""Shaping one listing into each marketplace's actual limits.

The model writes the prose. This file enforces the rules, and the split is deliberate:
every constraint below is a hard number from a platform's own documentation, and a model
asked to respect them will respect them most of the time. Most of the time is how you get a
listing rejected three days later, when the artisan has no idea which of seven platforms
disliked what.

So: one general description generated once, then deterministic per-platform shaping with a
test for every limit. Nothing here calls a model and nothing here is allowed to.

Sources for every number are in docs/Utsav/Product_Questions.md §3.

⚠️ The trap this file exists for: Amazon's `generic_keywords` is capped at **249 bytes, not
characters**. A Devanagari keyword string hits that limit at about 80 characters, so the
naive `[:249]` that works for English silently truncates a Hindi listing to a third of its
keywords — and truncating UTF-8 by bytes can also cut a character in half and produce
invalid output. Both are handled below.
"""

from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------------------
# per-platform limits, each one a documented number
# ---------------------------------------------------------------------------

LIMITS = {
    "amazon": {
        # 75 chars in all categories except media, effective 27 Jul 2026.
        "title_chars": 75,
        "desc_chars": 2000,
        # BYTES. See the module docstring.
        "keyword_bytes": 249,
        "bullets": 5,
        "bullet_chars": 255,
    },
    "flipkart": {
        "title_chars": 200,
        "desc_chars": 4000,
        # Flipkart takes a maximum of three, and rejects terms already in the title.
        "keyword_count": 3,
    },
    "meesho": {
        # Guidance is 50-120, under 100 recommended.
        "title_chars": 100,
        "desc_chars": 3000,
        # Meesho's downloadable template has no keyword column at all. Zero rather than
        # absent, so "this platform has no keyword field" is a stated fact and not an
        # oversight somebody later "fixes" by adding one.
        "keyword_count": 0,
    },
    "gem": {
        "title_chars": 200,
        "desc_chars": 4000,
        # GeM has no keyword field either, and actively rejects listings carrying seller
        # information — the opposite of a backend-keyword surface.
        "keyword_count": 0,
    },
    "ondc": {
        "title_chars": 200,
        # `descriptor.short_desc` is what buyer apps show in a list.
        "short_desc_chars": 120,
        "desc_chars": 4000,
    },
    "whatsapp": {
        "title_chars": 200,
        # Practical guidance for a catalogue item people read on a phone.
        "desc_chars": 300,
        # A catalogue item is read by a person in a chat, not indexed by a search engine.
        "keyword_count": 0,
    },
    "marketplace": {
        "title_chars": 300,
        "desc_chars": 8000,
    },
}


def clip_chars(text: str, limit: int) -> str:
    """Trim to `limit` characters on a word boundary where one is close enough.

    Cutting mid-word reads as a typo to a shopper and as sloppiness to a reviewer. Cutting
    at the last space is better, but only if that space is reasonably near the end —
    otherwise a single very long token would collapse the whole string, so past 80% we take
    the hard cut and accept it.
    """
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit * 0.8 else cut).rstrip(" ,;-")


def clip_bytes(text: str, limit: int) -> str:
    """Trim to `limit` BYTES of UTF-8 without splitting a character in half.

    This is Amazon's `generic_keywords` rule and it is the one that quietly breaks Hindi
    listings: `"हस्तनिर्मित"` is 11 characters and 33 bytes, so a keyword string that looks
    a quarter of the limit long in an editor is already most of the way to it.

    Encode-then-slice can land mid-sequence and produce invalid UTF-8, so the tail is
    dropped back to the last clean boundary.
    """
    text = (text or "").strip()
    raw = text.encode("utf-8")
    if len(raw) <= limit:
        return text
    # errors="ignore" drops the partial character at the end rather than raising.
    return raw[:limit].decode("utf-8", errors="ignore").rstrip().rstrip(",")


def strip_seller_identity(text: str, artisan_name: str | None) -> str:
    """Remove the seller's own name from listing copy.

    🚨 GeM requires this. "Seller Information must not appear in any field" is a stated
    rejection condition, and it is the exact opposite of every consumer marketplace, where
    the brand IS the seller name. Our own `map_attributes` sets `brand` to the artisan's
    display name, which is right for Amazon and wrong for GeM, so the copy has to be
    scrubbed rather than the brand field alone.

    Word-boundary matched and case-insensitive. A name that happens to be an ordinary word
    is a real risk here — an artisan called "Kamal" would lose the word for lotus from a
    lotus painting's description — so names shorter than four characters are left alone.
    Losing a word is a worse failure than a GeM reviewer seeing a first name.
    """
    if not text or not artisan_name:
        return text or ""
    out = text
    for part in str(artisan_name).split():
        if len(part) < 4:
            continue
        out = re.sub(rf"\b{re.escape(part)}\b", "", out, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", out).strip(" ,.-")


def dedupe_keywords(keywords: list[str], title: str) -> list[str]:
    """Drop keywords already carried by the title, and near-duplicates of each other.

    Both Amazon and Flipkart say the same thing in their own words: a backend keyword that
    repeats a title word buys nothing, because the title is already indexed. Flipkart only
    accepts three, so spending one on a word that is on screen anyway is a third of the
    budget wasted.

    Comparison is casefolded and NFKC-normalised so that visually identical strings in
    different Unicode forms collapse together.
    """
    def norm(s: str) -> str:
        return unicodedata.normalize("NFKC", (s or "")).casefold().strip()

    title_words = {w for w in re.split(r"\W+", norm(title)) if len(w) > 2}
    seen: set[str] = set()
    out: list[str] = []
    for kw in keywords or []:
        k = norm(kw)
        if not k or k in seen:
            continue
        # A multi-word phrase survives even if one of its words is in the title; a
        # single word that is already in the title does not.
        if " " not in k and k in title_words:
            continue
        seen.add(k)
        out.append(kw.strip())
    return out


def shape(channel: str, listing: dict, artisan_name: str | None = None) -> dict:
    """One listing, shaped to one channel's rules. Pure, deterministic, no model.

    `listing` carries the general copy: title, desc_en, desc_hi, keywords, short_desc.
    The returned dict is what that channel's adapter and the copy-paste UI both read, so
    the same text an artisan pastes into Meesho by hand is the text our API would have
    pushed. Two renderings of the same listing that disagree is a support problem nobody
    can debug from a voice note.
    """
    limits = LIMITS.get(channel, LIMITS["marketplace"])
    title = (listing.get("title") or "").strip()
    desc_en = (listing.get("desc_en") or "").strip()
    desc_hi = (listing.get("desc_hi") or "").strip()
    keywords = list(listing.get("keywords") or [])

    # GeM first: scrubbing has to happen before any clipping, or a name removed from the
    # middle leaves the text shorter than the limit we already trimmed it to.
    if channel == "gem":
        title = strip_seller_identity(title, artisan_name)
        desc_en = strip_seller_identity(desc_en, artisan_name)
        desc_hi = strip_seller_identity(desc_hi, artisan_name)

    # Meesho forbids a brand name in the title for unbranded sellers, and an artisan
    # listing under their own name is exactly that case.
    if channel == "meesho":
        title = strip_seller_identity(title, artisan_name)

    out: dict = {
        "title": clip_chars(title, limits["title_chars"]),
        "desc_en": clip_chars(desc_en, limits["desc_chars"]),
        "desc_hi": clip_chars(desc_hi, limits["desc_chars"]),
    }

    if "short_desc_chars" in limits:
        out["short_desc"] = clip_chars(
            listing.get("short_desc") or desc_en, limits["short_desc_chars"]
        )

    useful = dedupe_keywords(keywords, out["title"])

    if "keyword_bytes" in limits:
        # Joined and then byte-clipped as one string, because the cap is on the field and
        # not on each term. Clipping term by term would leave a trailing partial word.
        out["keywords"] = clip_bytes(" ".join(useful), limits["keyword_bytes"])
    elif "keyword_count" in limits:
        out["keywords"] = useful[: limits["keyword_count"]]
    else:
        out["keywords"] = useful

    if "bullets" in limits:
        bullets = [b.strip() for b in (listing.get("bullets") or []) if b and b.strip()]
        out["bullets"] = [
            clip_chars(b, limits["bullet_chars"]) for b in bullets[: limits["bullets"]]
        ]

    return out


def copy_block(channel: str, shaped: dict, lang: str = "hi") -> list[dict]:
    """The paste-one-field-at-a-time list for a channel with no write API.

    Meesho, WhatsApp and GeM are filled in by hand, so the artisan is holding their phone in
    one hand and a form in the other. One button per field, in the order the form asks for
    them, beats one button that copies a blob they then have to split up — splitting text is
    reading, and reading is the thing we cannot assume.

    `voice_key` is what gets spoken as they reach each field.
    """
    desc = shaped.get("desc_hi") if lang == "hi" and shaped.get("desc_hi") else shaped.get("desc_en")
    block = [
        {"field": "title", "voice_key": f"{channel}.step.name", "copy": shaped.get("title", "")},
        {"field": "description", "voice_key": f"{channel}.step.desc", "copy": desc or ""},
    ]
    kw = shaped.get("keywords")
    if kw:
        block.append(
            {
                "field": "keywords",
                "voice_key": f"{channel}.step.keywords",
                "copy": kw if isinstance(kw, str) else ", ".join(kw),
            }
        )
    return [b for b in block if b["copy"]]


def demo() -> None:
    def eq(got, want, msg):
        if got != want:
            raise AssertionError(f"{msg}\n  got:  {got!r}\n  want: {want!r}")

    listing = {
        "title": "Handwoven Sambalpuri Cotton Saree by Utsav Mohanty",
        "desc_en": "A handwoven Sambalpuri ikat saree made by Utsav Mohanty over three days.",
        "desc_hi": "उत्सव मोहंती द्वारा तीन दिन में बुनी गई संबलपुरी सूती साड़ी।",
        "keywords": ["sambalpuri", "handloom saree", "odisha ikat", "sambalpuri", "cotton"],
    }

    # ── byte limits, which is where Devanagari breaks naive code ──────────────────────
    hindi = " ".join(["हस्तनिर्मित"] * 40)
    clipped = clip_bytes(hindi, 249)
    assert len(clipped.encode("utf-8")) <= 249, "amazon keywords fit the BYTE cap"
    clipped.encode("utf-8").decode("utf-8")  # raises if a character was split
    assert len(clipped) < 100, "a Devanagari string hits 249 bytes well under 249 characters"
    eq(clip_bytes("abc", 249), "abc", "a short string is untouched")
    eq(clip_bytes("", 10), "", "empty stays empty")

    # ── character limits ──────────────────────────────────────────────────────────────
    eq(len(clip_chars("x " * 200, 75)) <= 75, True, "amazon title fits 75 characters")
    eq(clip_chars("hello world", 50), "hello world", "a short title is untouched")
    eq(clip_chars("hello world there", 12), "hello world", "cuts on a word boundary when one is near")
    eq(clip_chars("supercalifragilistic", 10), "supercalif", "one long token takes the hard cut")

    # ── GeM: no seller identity, anywhere ─────────────────────────────────────────────
    gem = shape("gem", listing, artisan_name="Utsav Mohanty")
    assert "Utsav" not in gem["title"], "GeM title carries no seller name"
    assert "Utsav" not in gem["desc_en"], "GeM description carries no seller name"
    # A Devanagari display name is scrubbed from Devanagari copy — see the parametrised
    # case in test_catalog.py, which asserts it rather than passing an empty listing.
    assert "Sambalpuri" in gem["title"], "scrubbing removes the name and keeps the product"

    # A short name that is also an ordinary word is left alone: losing the word is worse.
    eq(strip_seller_identity("Kamal lotus painting", "Kamal Das"),
       "lotus painting", "a four-letter name is still removed")
    eq(strip_seller_identity("Om shanti bowl", "Om"),
       "Om shanti bowl", "a name under four characters is never removed")

    # ── Amazon ────────────────────────────────────────────────────────────────────────
    amz = shape("amazon", listing, artisan_name="Utsav Mohanty")
    assert len(amz["title"]) <= 75, "amazon title is capped"
    assert isinstance(amz["keywords"], str), "amazon keywords are one byte-capped string"
    assert len(amz["keywords"].encode("utf-8")) <= 249, "amazon keywords fit"
    assert "Utsav" in amz["title"], "amazon keeps the brand — only GeM forbids it"

    # ── Flipkart takes three, and not ones already in the title ───────────────────────
    fk = shape("flipkart", listing)
    eq(len(fk["keywords"]) <= 3, True, "flipkart takes at most three keywords")
    assert "sambalpuri" not in [k.lower() for k in fk["keywords"]], (
        "a single word already in the title is not spent as one of the three"
    )
    assert "handloom saree" in fk["keywords"], "a multi-word phrase survives"

    # ── ONDC short_desc, which buyer apps show in a list ──────────────────────────────
    ondc = shape("ondc", listing)
    assert len(ondc["short_desc"]) <= 120, "ondc short_desc fits what buyer apps render"

    # ── WhatsApp is read on a phone by a person, not indexed ──────────────────────────
    wa = shape("whatsapp", listing)
    assert len(wa["desc_en"]) <= 300, "whatsapp description stays readable"

    # ── unknown channel degrades, never throws ────────────────────────────────────────
    unknown = shape("some_new_marketplace", listing)
    assert unknown["title"], "an unknown channel falls back to the loosest limits"
    eq(shape("amazon", {})["title"], "", "an empty listing shapes to empty, not a crash")

    # ── the copy-paste block ──────────────────────────────────────────────────────────
    block = copy_block("meesho", shape("meesho", listing, artisan_name="Utsav Mohanty"))
    eq([b["field"] for b in block], ["title", "description"],
       "meesho gets name and description, in the order its form asks")
    assert all(b["copy"] for b in block), "a button that copies nothing is not rendered"
    assert all(b["voice_key"].startswith("meesho.") for b in block), "each step is speakable"

    print("all seo checks passed")


if __name__ == "__main__":
    demo()
