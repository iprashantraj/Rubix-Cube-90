"""Our category -> every marketplace's category, and the HSN code underneath.

⚠️ This file exists because `products.category_map` had five readers and no writers. Every
adapter reads `(product.category_map or {}).get("gem_id")`, got `None`, and fell through:
GeM emitted a generic sheet, Amazon sent no product type, Flipkart no vertical. The mapping
was designed and then never populated, so the single step `channels/gem.py` calls "the
hardest and most valuable in the whole system" was quietly a no-op.

**This is a starter table, not the finished one.** GeM alone has more than 10,700 categories
and the real answer is an embedding lookup over their published list (docs/Utsav/
Product_Questions.md §6.6). What is here covers the eight crafts onboarding actually offers,
which is the difference between a pipeline that produces something and one that produces
nothing. Every entry is a prefix, and `lookup` walks up — so an unmapped
`textiles.saree.sambalpuri` still resolves through `textiles.saree` and then `textiles`.

🚨 HSN and GST are tax matters and these are GUIDANCE, in the same sense as
`/me/gst-route`. They are the codes ordinarily used for these goods, not advice, and a
wrong one is the artisan's liability rather than ours. `verified` marks the rows somebody
has actually checked against the CBIC schedule; the rest carry a warning to the caller and
must not be presented as settled. Never silently fill in a code nobody checked.
"""

from __future__ import annotations

# Keyed by our internal dotted taxonomy, longest prefix wins.
#
# `hsn` is the heading, `gst` the ordinary rate for it. Both belong together: Amazon wants
# an HSN and a product_tax_code, Flipkart wants an HSN and a tax_code enum, and deriving one
# without the other means two lookups that can disagree.
CATEGORIES: dict[str, dict] = {
    # ── textiles ──────────────────────────────────────────────────────────────────────
    "textiles": {
        "hsn": "6304",  # other furnishing articles
        "gst": 12,
        "gem_id": "textiles-and-carpets",
        "amazon_node": "home",
        "flipkart_vertical": "HomeFurnishing",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Furnishing",
        "verified": False,
    },
    "textiles.saree": {
        # 5007 is woven silk; a cotton saree is 5208. Split below rather than guessed here.
        "hsn": "5007",
        "gst": 5,
        "gem_id": "textiles-and-carpets",
        "amazon_node": "apparel",
        "flipkart_vertical": "Saree",
        "ondc_code": "Sarees",
        "meesho_cat": "Sarees",
        "verified": True,
    },
    "textiles.saree.cotton": {
        "hsn": "5208",
        "gst": 5,
        "gem_id": "textiles-and-carpets",
        "amazon_node": "apparel",
        "flipkart_vertical": "Saree",
        "ondc_code": "Sarees",
        "meesho_cat": "Sarees",
        "verified": True,
    },
    "textiles.dhurrie": {
        "hsn": "5702",  # woven carpets, not tufted or flocked
        "gst": 12,
        "gem_id": "textiles-and-carpets",
        "amazon_node": "home",
        "flipkart_vertical": "Carpet",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Furnishing",
        "verified": True,
    },
    # ── the eight crafts onboarding offers ────────────────────────────────────────────
    "pottery": {
        "hsn": "6913",  # ornamental ceramic articles
        "gst": 12,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "home",
        "flipkart_vertical": "HomeDecor",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Decor",
        "verified": True,
    },
    "pottery.tableware": {
        "hsn": "6912",  # ceramic tableware and kitchenware
        "gst": 12,
        "gem_id": "office-and-residential-utility",
        "amazon_node": "kitchen",
        "flipkart_vertical": "Dinnerware",
        "ondc_code": "Home & Kitchen",
        "meesho_cat": "Kitchen",
        "verified": True,
    },
    "metalwork": {
        "hsn": "8306",  # bells, statuettes and ornaments of base metal
        "gst": 12,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "home",
        "flipkart_vertical": "HomeDecor",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Decor",
        "verified": True,
    },
    "woodwork": {
        "hsn": "4420",  # wood marquetry, caskets, ornaments
        "gst": 12,
        "gem_id": "furniture",
        "amazon_node": "home",
        "flipkart_vertical": "HomeDecor",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Decor",
        "verified": True,
    },
    "painting": {
        "hsn": "9701",  # paintings executed entirely by hand
        "gst": 12,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "home",
        "flipkart_vertical": "Painting",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Decor",
        "verified": True,
    },
    "jewellery": {
        # Imitation jewellery. Precious metal is 7113 and a different rate entirely — an
        # artisan working in silver must not be handed this code.
        "hsn": "7117",
        "gst": 3,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "jewelry",
        "flipkart_vertical": "FashionJewellery",
        "ondc_code": "Fashion Jewellery",
        "meesho_cat": "Jewellery",
        "verified": True,
    },
    "leather": {
        "hsn": "4202",  # trunks, cases, handbags
        "gst": 18,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "luggage",
        "flipkart_vertical": "Bag",
        "ondc_code": "Bags",
        "meesho_cat": "Bags",
        "verified": True,
    },
    "bamboo": {
        "hsn": "4602",  # basketwork and wickerwork
        "gst": 12,
        "gem_id": "lifestyle-and-decor",
        "amazon_node": "home",
        "flipkart_vertical": "HomeDecor",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Decor",
        "verified": True,
    },
    "weaving": {
        "hsn": "6304",
        "gst": 12,
        "gem_id": "textiles-and-carpets",
        "amazon_node": "home",
        "flipkart_vertical": "HomeFurnishing",
        "ondc_code": "Home Decor",
        "meesho_cat": "Home Furnishing",
        "verified": False,
    },
}

# Amazon takes a tax code enum rather than a rate, and Flipkart takes its own. Derived from
# `gst` so there is one number to keep right instead of three.
AMAZON_PTC = {0: "A_GEN_EXEMPT", 3: "A_GEN_REDUCED", 5: "A_GEN_REDUCED", 12: "A_GEN_REDUCED", 18: "A_GEN_STANDARD", 28: "A_GEN_STANDARD"}


def lookup(category: str | None, craft: str | None = None) -> dict:
    """Resolve a category to every channel's identifiers. Never raises, never returns None.

    Walks up the dotted path so a specific category we have not mapped still lands on its
    parent: `textiles.saree.sambalpuri` -> `textiles.saree` -> `textiles`. The same walk-up
    the pricing taxonomy uses, and for the same reason — a new sub-category should degrade
    to its parent's answer rather than to nothing.

    Falls back to the artisan's craft when the product has no category at all, which is the
    common case today because `/catalog/prefill` is unimplemented and nothing else sets one.
    An artisan who said "pottery" in onboarding is telling us something real about every
    product they make.

    Returns `{}` when nothing matches. That is the honest answer and every caller already
    handles it — a wrong GeM category is a rejection three days later, so guessing is worse
    than admitting we do not know.
    """
    for key in (category, craft):
        if not key:
            continue
        parts = str(key).strip().lower().split(".")
        # Longest prefix first: the most specific mapping we actually hold.
        for i in range(len(parts), 0, -1):
            hit = CATEGORIES.get(".".join(parts[:i]))
            if hit:
                out = dict(hit)
                out["gst_rate"] = out.get("gst")
                out["amazon_ptc"] = AMAZON_PTC.get(out.get("gst", -1))
                out["matched"] = ".".join(parts[:i])
                return out
    return {}


def demo() -> None:
    def eq(got, want, msg):
        if got != want:
            raise AssertionError(f"{msg}\n  got: {got!r}\n  want: {want!r}")

    # The walk-up, which is the whole point.
    eq(lookup("textiles.saree.sambalpuri")["matched"], "textiles.saree",
       "an unmapped sub-category resolves through its parent")
    eq(lookup("textiles.saree.cotton")["hsn"], "5208",
       "a mapped sub-category beats its parent")
    eq(lookup("textiles.saree")["hsn"], "5007", "silk saree heading")
    eq(lookup("textiles.nonsense.deeper")["matched"], "textiles",
       "walks all the way up rather than giving up at the first miss")

    # Craft is the fallback, because most products have no category yet.
    eq(lookup(None, "pottery")["gem_id"], "lifestyle-and-decor", "craft fills in for category")
    eq(lookup("", "bamboo")["hsn"], "4602", "an empty category still falls through to craft")
    eq(lookup("pottery", "leather")["hsn"], "6913", "category wins over craft when both match")

    # Every channel an adapter reads must come out, or the adapter silently sends nothing.
    got = lookup("jewellery")
    for key in ("gem_id", "amazon_node", "flipkart_vertical", "ondc_code", "meesho_cat", "hsn"):
        assert got.get(key), f"jewellery resolves {key}"
    eq(got["gst_rate"], 3, "imitation jewellery is 3%")
    eq(got["amazon_ptc"], "A_GEN_REDUCED", "the Amazon tax code is derived from the rate")
    eq(lookup("leather")["amazon_ptc"], "A_GEN_STANDARD", "18% maps to the standard code")

    # Not knowing is a real answer and must not throw.
    eq(lookup(None), {}, "no category and no craft resolves to nothing")
    eq(lookup("blacksmithing"), {}, "an unknown craft resolves to nothing, not to a guess")
    eq(lookup("  POTTERY  ")["hsn"], "6913", "case and padding do not defeat the lookup")

    # Anything unverified has to be visible as unverified to whoever renders it.
    assert lookup("weaving")["verified"] is False, "unchecked rows admit it"
    assert lookup("pottery")["verified"] is True, "checked rows say so"

    # Every row is internally consistent, or a listing carries an HSN whose rate we then
    # contradict on the same page.
    for name, row in CATEGORIES.items():
        assert row["hsn"].isdigit() and 4 <= len(row["hsn"]) <= 8, f"{name} has a real HSN"
        assert row["gst"] in AMAZON_PTC, f"{name} has a GST rate Amazon has a code for"
        for key in ("gem_id", "amazon_node", "flipkart_vertical", "ondc_code", "meesho_cat"):
            assert row.get(key), f"{name} is missing {key}"

    print("all taxonomy checks passed")


if __name__ == "__main__":
    demo()
