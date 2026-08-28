"""Market comparables — the only part of pricing allowed to be smart.

Searches Amazon, Flipkart, GeM rate contracts and our own marketplace for similar
listings, then uses an LLM to normalize messy listing titles into comparable
attributes. Returns a range, never a price.

A for-loop with retries is deliberate. Nothing here loops or re-decides enough to
need an agent framework; revisit only if source selection becomes genuinely adaptive.
"""

import datetime as dt
import json
import logging
import os
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

SOURCES = ["market", "amazon", "flipkart", "gem"]

# Our own marketplace, over its public catalogue endpoint. Not an import: web/ and ai/ are
# separate deploy units and ai/ holds no database credentials. /api/shop/products is
# unauthenticated because those pages have to be indexable, so this needs no key.
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")

# The artisan is waiting on a screen. The floor never depends on this call, so a slow
# marketplace must cost us a market range and not a price.
TIMEOUT_SECONDS = 3

# Amazon, Flipkart and GeM have no queryable price search (see fetch). Their prices come
# from a snapshot somebody collected by hand and dated — research/pricing/README.md.
SEED_PATH = Path(__file__).parent / "comps_seed.json"

# A handicraft price does not move much in a quarter, but a year-old snapshot presented as
# "the market" is a lie with a decimal point in it. Past this we still use it and say so
# loudly: returning nothing would silently drop the price back to the floor, which looks
# identical to everything working.
STALE_AFTER_DAYS = 180


def _seed():
    """The hand-collected snapshot, or None. Never raises — a malformed file must not cost
    an artisan their price suggestion."""
    try:
        data = json.loads(SEED_PATH.read_text())
    except FileNotFoundError:
        return None
    except Exception as e:
        log.warning("comps seed unreadable, pricing on cost alone: %s", e)
        return None

    # Nothing collected yet is the state this file ships in, and it is expected rather than
    # wrong — the app prices honestly on cost alone. Saying so on every single price request
    # would be noise that trains everyone to ignore this logger.
    if not data.get("categories"):
        return None

    collected = data.get("collected")
    try:
        age = (dt.date.today() - dt.date.fromisoformat(collected)).days
    except (TypeError, ValueError):
        # Prices WITH no date, though, is a real problem: an undated price is not evidence,
        # and this one is about to be shown to an artisan as the market rate.
        log.warning("comps seed has prices but no usable `collected` date — refusing to use it")
        return None
    if age > STALE_AFTER_DAYS:
        log.warning(
            "comps seed is %d days old (collected %s). Prices from it are being used but "
            "should be re-collected — see research/pricing/README.md",
            age, collected,
        )
    return data


def _seed_prices(data, source, category):
    """Walk up the taxonomy for the most specific match we actually have.

    "textiles.saree.sambalpuri" -> "textiles.saree" -> "textiles". A snapshot will realistically
    hold "textiles.saree" long before it holds every weave, and comparing a Sambalpuri saree
    against sarees generally is far better than comparing it against nothing. Most specific
    wins, so adding the narrower key later takes precedence with no code change.
    """
    parts = category.split(".")
    for depth in range(len(parts), 0, -1):
        entry = data.get("categories", {}).get(".".join(parts[:depth]))
        if entry and entry.get(source):
            return [float(p) for p in entry[source] if p]
    return []


def fetch(source, category, material, size):
    """One source. Returns a list of prices. Empty list on failure — never raises.

    Only `market` is built. The other three are not oversights:

      amazon / flipkart  Seller APIs. They authenticate AS one shop and show that shop's
                         own listings; there is no open "what does a cotton saree go for"
                         endpoint. Usable only for an artisan who has connected a Tier B
                         channel, which is not the artisan this PS is about.
      gem                No API of any kind. Rate contracts are published as documents.

    Scraping search pages would work until it did not — against both sites' terms, broken
    by a CSS rename, and IP-blocked halfway through a demo. So those three read a dated
    snapshot collected by hand instead: comps_seed.json, per research/pricing/README.md.
    Per-source lists, so a price seen on two platforms is not counted twice.

    `material` and `size` are accepted but unused for this source: /api/shop/products
    filters by category and does not return material, so there is nothing to compare on.
    Our taxonomy is granular enough that the category alone ("textiles.saree.sambalpuri")
    is already a tight comparison class. If it proves too tight, the fix is to query the
    parent path rather than to widen this signature.
    """
    if not category:
        return []

    if source != "market":
        data = _seed()
        return _seed_prices(data, source, category) if data else []

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
