"""Market comparables — the only part of pricing allowed to be smart.

Searches Amazon, Flipkart, GeM rate contracts and our own marketplace for similar
listings, then uses an LLM to normalize messy listing titles into comparable
attributes. Returns a range, never a price.

A for-loop with retries is deliberate. Nothing here loops or re-decides enough to
need an agent framework; revisit only if source selection becomes genuinely adaptive.
"""

import os

import httpx

SOURCES = ["market", "amazon", "flipkart", "gem"]

# Our own marketplace, over its public catalogue endpoint. Not an import: web/ and ai/ are
# separate deploy units and ai/ holds no database credentials. /api/shop/products is
# unauthenticated because those pages have to be indexable, so this needs no key.
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")

# The artisan is waiting on a screen. The floor never depends on this call, so a slow
# marketplace must cost us a market range and not a price.
TIMEOUT_SECONDS = 3


def fetch(source, category, material, size):
    """One source. Returns a list of prices. Empty list on failure — never raises.

    Only `market` is built. The other three are not oversights:

      amazon / flipkart  Seller APIs. They authenticate AS one shop and show that shop's
                         own listings; there is no open "what does a cotton saree go for"
                         endpoint. Usable only for an artisan who has connected a Tier B
                         channel, which is not the artisan this PS is about.
      gem                No API of any kind. Rate contracts are published as documents.

    Scraping search pages would work until it did not — against both sites' terms, broken
    by a CSS rename, and IP-blocked halfway through a demo. The honest source for those
    three is a dated snapshot collected by hand (research/pricing/), read from a file.

    `material` and `size` are accepted but unused for this source: /api/shop/products
    filters by category and does not return material, so there is nothing to compare on.
    Our taxonomy is granular enough that the category alone ("textiles.saree.sambalpuri")
    is already a tight comparison class. If it proves too tight, the fix is to query the
    parent path rather than to widen this signature.
    """
    if source != "market" or not category:
        return []
    try:
        res = httpx.get(
            f"{API_BASE_URL}/api/shop/products",
            params={"craft": category, "limit": 100},
            timeout=TIMEOUT_SECONDS,
        )
        res.raise_for_status()
        # Unpriced listings are real — a product can be published before /price ran, which
        # is exactly what the "set the price later" path produces. They are not free, so
        # they must not enter the range as zero.
        return [float(row["price"]) for row in res.json() if row.get("price")]
    except Exception:
        # Contract: never raises. market_range() also wraps this call, and the redundancy
        # is deliberate — a dead source must not cost the artisan their price suggestion.
        return []


def normalize(listings):
    """LLM: messy titles -> {material, size, technique} so we compare like with like."""
    raise NotImplementedError


def market_range(category, material, size):
    prices = []
    for source in SOURCES:
        try:
            prices += fetch(source, category, material, size)
        except Exception:
            continue  # a dead source must not kill the price suggestion
    if not prices:
        return None
    prices.sort()
    # Trim the tails: one mispriced listing should not set the range.
    #
    # ⚠️ `len(prices) // 10` alone is 0 for every sample under ten, which is precisely when
    # a single outlier does the most damage — and small samples are the NORMAL case for a
    # marketplace that is still filling up. Caught by running this against six real
    # listings: a miscategorised silk piece at ₹45,000 sat next to five cotton sarees
    # around ₹4,000, nothing was trimmed, and the suggestion came back ₹24,000 for
    # something that cost ₹2,576 to make. The unit test missed it because it used twenty
    # prices, where the arithmetic happens to work.
    #
    # So: always drop at least one from each end once there are four prices, which is the
    # smallest sample where doing so still leaves a range behind. Below four, trimming
    # would leave nothing to report and the sample is thin enough that `sample_size` is
    # the honest signal instead.
    trim = max(1, len(prices) // 10) if len(prices) >= 4 else 0
    kept = prices[trim:len(prices) - trim] or prices
    return {"low": kept[0], "high": kept[-1], "sample_size": len(prices)}
