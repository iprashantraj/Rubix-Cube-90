"""F3 pricing math.

Deterministic on purpose. No model, no LLM — there is no training data for
"what should this handicraft cost", and every number here has to survive the
question "how did you get that?".

Cost-up, not market-down: start from what it cost to make, then show the market.
"""

import json
from pathlib import Path

RATES = json.loads((Path(__file__).parent / "rates.json").read_text())


def wage_rate(cluster_id):
    return RATES["clusters"].get(cluster_id, RATES["default_wage_per_hour"])


def floor_price(material_cost, labour_hours, cluster_id, margin_pct=None):
    """Below this, the artisan is working for free or paying to work."""
    margin_pct = RATES["default_margin_pct"] if margin_pct is None else margin_pct
    labour = labour_hours * wage_rate(cluster_id)
    cost = material_cost + labour
    return round(cost * (1 + margin_pct))


def mrp_for_channel(price, channel):
    """GeM mandates a minimum discount off MRP (~10%).

    Set MRP high enough that the post-discount price is still the price we meant.
    Miss this and we recommend loss-making prices on our headline channel.
    """
    discount = RATES["channel_min_discount_pct"].get(channel, 0.0)
    return round(price / (1 - discount))


def suggest(material_cost, labour_hours, cluster_id, channel="market", market_range=None):
    floor = floor_price(material_cost, labour_hours, cluster_id)

    # Market only moves us up, never below what it cost to make.
    price = floor
    below_floor = False
    if market_range:
        mid = (market_range["low"] + market_range["high"]) / 2
        price = round(max(floor, mid))
        below_floor = market_range["high"] < floor

    labour = labour_hours * wage_rate(cluster_id)
    return {
        "floor": floor,
        "suggested_price": price,
        "mrp": mrp_for_channel(price, channel),
        "market_range": market_range,
        "below_floor_warning": below_floor,
        "breakdown": {
            "material": material_cost,
            "labour": labour,
            "margin": floor - material_cost - labour,
        },
    }
