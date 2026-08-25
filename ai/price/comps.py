"""Market comparables — the only part of pricing allowed to be smart.

Searches Amazon, Flipkart, GeM rate contracts and our own marketplace for similar
listings, then uses an LLM to normalize messy listing titles into comparable
attributes. Returns a range, never a price.

A for-loop with retries is deliberate. Nothing here loops or re-decides enough to
need an agent framework; revisit only if source selection becomes genuinely adaptive.
"""

SOURCES = ["market", "amazon", "flipkart", "gem"]


def fetch(source, category, material, size):
    """One source. Returns a list of prices. Empty list on failure — never raises."""
    raise NotImplementedError


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
    trim = len(prices) // 10
    kept = prices[trim:len(prices) - trim] or prices
    return {"low": kept[0], "high": kept[-1], "sample_size": len(prices)}
