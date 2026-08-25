"""The floor guard is the highest-impact feature in the PS. It gets a test."""

from price.compute import floor_price, mrp_for_channel, suggest


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
