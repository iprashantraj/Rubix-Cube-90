"""The floor guard is the highest-impact feature in the PS. It gets a test."""

from price.compute import floor_price, mrp_for_channel, quote, suggest, voice_line_hi


def test_floor_covers_material_and_labour():
    # 800 yarn + 12h x 120/h = 2240, +15% margin
    assert floor_price(800, 12, "sambalpur") == 2576


def test_unknown_cluster_uses_default_wage():
    assert floor_price(800, 12, "nowhere") == floor_price(800, 12, "sambalpur")


def test_gem_mrp_survives_the_mandated_discount():
    mrp = mrp_for_channel(2600, "gem")
    assert round(mrp * 0.90) >= 2600  # post-discount still clears what we meant


def test_market_never_prices_below_the_floor():
    r = suggest(800, 12, "sambalpur", market_range={"low": 900, "high": 1100, "sample_size": 5})
    assert r["suggested_price"] >= r["floor"]
    assert r["below_floor_warning"] is True  # market won't pay what it cost to make


def test_market_can_price_above_the_floor():
    r = suggest(800, 12, "sambalpur", market_range={"low": 3000, "high": 5000, "sample_size": 9})
    assert r["suggested_price"] == 4000
    assert r["below_floor_warning"] is False


# -- the response shape POST /price returns ----------------------------------


def test_quote_matches_the_contract_shape():
    q = quote(800, 12, "sambalpur", channel="gem")
    for field in (
        "floor", "suggested_price", "mrp", "market_range",
        "below_floor_warning", "breakdown", "breakdown_voice_hi",
    ):
        assert field in q, field
    assert q["floor"] == 2576
    assert q["breakdown"]["material"] == 800


def test_missing_material_cost_prices_on_labour_and_says_so():
    """A floor too low is bad. No floor at all is worse — the screen then offers
    "set the price later" and the artisan publishes at whatever feels like money."""
    q = quote(None, 12, "sambalpur", channel="gem")
    assert q["assumed_missing"] == ["material_cost"]
    assert q["floor"] == floor_price(0, 12, "sambalpur")  # labour still counted
    assert q["breakdown"]["material"] == 0


def test_nothing_missing_means_no_flag():
    assert "assumed_missing" not in quote(800, 12, "sambalpur", channel="gem")


def test_gem_quote_explains_its_mrp():
    assert "10%" in quote(800, 12, "sambalpur", channel="gem")["breakdown"]["note"]
    # A channel with no mandated discount has nothing to explain.
    assert "note" not in quote(800, 12, "sambalpur", channel="amazon")["breakdown"]


# -- the spoken sentence -----------------------------------------------------


def test_voice_line_reads_as_one_sentence():
    assert voice_line_hi(800, 160, 23000) == "800 रुपये का सामान, 160 घंटे का काम। 23000 रुपये सही रहेगा।"


def test_voice_line_never_speaks_a_missing_input_as_zero():
    """"0 रुपये का सामान" states a falsehood about what the thing cost. Silence does not."""
    assert "सामान" not in voice_line_hi(None, 160, 23000)
    assert "घंटे" not in voice_line_hi(800, None, 23000)
    assert voice_line_hi(None, None, 23000) == "23000 रुपये सही रहेगा।"


def test_voice_line_quotes_the_suggested_price_not_the_floor():
    """The artisan hears the number on screen. Speaking a different one is how trust dies."""
    q = quote(800, 12, "sambalpur", channel="gem",
              market_range={"low": 3000, "high": 5000, "sample_size": 9})
    assert str(q["suggested_price"]) in q["breakdown_voice_hi"]
    assert q["suggested_price"] == 4000


# -- comparables · price/comps.py --------------------------------------------

import contextlib

from price import comps


@contextlib.contextmanager
def _shop(rows_or_error):
    """Stand in for our marketplace. No pytest fixtures — this suite runs under plain
    `python3 test_price.py` too, and money math should not need a test framework."""

    class _Res:
        def raise_for_status(self):
            pass

        def json(self):
            return rows_or_error

    def _get(url, **kw):
        if isinstance(rows_or_error, Exception):
            raise rows_or_error
        return _Res()

    real = comps.httpx.get
    comps.httpx.get = _get
    try:
        yield
    finally:
        comps.httpx.get = real


def test_market_fetch_keeps_only_real_prices():
    rows = [{"price": 2400}, {"price": None}, {"price": 0}, {"price": "3100"}]
    with _shop(rows):
        # None and 0 are unpriced listings, not free ones -- publishing before /price ran
        # is a supported path ("set the price later"), and those must not enter the range.
        assert comps.fetch("market", "textiles.saree", None, None) == [2400.0, 3100.0]


def test_a_dead_marketplace_returns_empty_and_never_raises():
    with _shop(RuntimeError("connection refused")):
        assert comps.fetch("market", "textiles.saree", None, None) == []


def test_no_category_means_nothing_to_compare_against():
    assert comps.fetch("market", None, None, None) == []


def test_the_unbuilt_sources_are_empty_not_broken():
    """Amazon and Flipkart are seller APIs with no open price search; GeM has no API."""
    for source in ("amazon", "flipkart", "gem"):
        assert comps.fetch(source, "textiles.saree", None, None) == []


def test_market_range_trims_the_outliers():
    # A powerloom copy at 450 and a miscategorised silk piece at 45000 must not set the
    # range. 20 prices -> 10% off each end -> the two lowest and two highest are dropped.
    prices = [450, 900, 1200, 1800, 2100, 2400, 2500, 2600, 2800, 3000,
              3200, 3400, 3600, 3800, 4000, 4200, 4500, 5000, 8000, 45000]
    with _shop([{"price": p} for p in prices]):
        r = comps.market_range("textiles.saree", None, None)
    assert (r["low"], r["high"]) == (1200, 5000)
    assert r["sample_size"] == 20  # reported PRE-trim, so a thin range is visible as thin


def test_market_range_is_none_when_nobody_answers():
    with _shop(RuntimeError("down")):
        assert comps.market_range("textiles.saree", None, None) is None


def test_a_real_market_lifts_the_price_off_the_floor():
    """The end-to-end point of comps: cost-up sets the floor, the market raises it."""
    with _shop([{"price": p} for p in (3000, 3500, 4000, 4500, 5000)]):
        r = comps.market_range("textiles.saree", None, None)
    q = quote(800, 12, "sambalpur", channel="gem", market_range=r)
    assert q["floor"] == 2576
    assert q["suggested_price"] > q["floor"]
    assert q["below_floor_warning"] is False


def test_a_single_outlier_cannot_set_a_small_range():
    """The case `len // 10` missed: under ten prices it trimmed nothing, which is exactly
    when one bad listing does the most damage. Six real listings produced a Rs 24,000
    suggestion for a Rs 2,576 saree before this."""
    with _shop([{"price": p} for p in (3000, 3500, 4000, 4500, 5000, 45000)]):
        r = comps.market_range("textiles.saree", None, None)
    assert (r["low"], r["high"]) == (3500, 5000)  # 3000 and 45000 both dropped
    assert r["sample_size"] == 6

    q = quote(800, 12, "sambalpur", channel="gem", market_range=r)
    assert q["suggested_price"] == 4250  # the mid of the trimmed range, not of the outlier


def test_a_sample_too_small_to_trim_is_reported_not_mangled():
    with _shop([{"price": p} for p in (3000, 4000, 5000)]):
        r = comps.market_range("textiles.saree", None, None)
    # Trimming three prices leaves nothing to report a range from. Keep them and let
    # sample_size say the range is thin.
    assert (r["low"], r["high"], r["sample_size"]) == (3000, 5000, 3)
