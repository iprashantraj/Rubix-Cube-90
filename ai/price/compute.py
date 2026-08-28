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


def voice_line_hi(material_cost, labour_hours, price):
    """The breakdown as one spoken Hindi sentence.

    A template, never an LLM — no model touches a price (docs/decisions.md), and that
    includes the sentence that says the price out loud.

    Why one sentence and not three figures: the app speaks this the moment the quote lands,
    and reciting "material 800. labour 1440. margin 336. price 2600" at someone who cannot
    read the screen is four numbers with no grammar holding them together. The register
    here matches the app's own strings (price.material, price.labour, price.suggested) so
    the spoken quote and the visible chips sound like the same voice.

    Clauses are dropped when their input is missing, rather than spoken as zero. "0 रुपये
    का सामान" states a falsehood about what the thing cost; saying nothing about materials
    is merely silent about them.
    """
    parts = []
    if material_cost:
        parts.append(f"{round(material_cost)} रुपये का सामान")
    if labour_hours:
        parts.append(f"{round(labour_hours)} घंटे का काम")
    said = f"{round(price)} रुपये सही रहेगा।"
    return f"{', '.join(parts)}। {said}" if parts else said


def quote(material_cost, labour_hours, cluster_id, channel="gem", market_range=None):
    """The full `POST /price` response — ai/contracts.md § POST /price.

    Lives here rather than in service.py so the whole shape is testable without FastAPI,
    and so every number in the response comes off the same arithmetic that test_price.py
    already locks down.

    ⚠️ Nulls are coerced to zero, NOT rejected, and the caller is told which ones via
    `assumed_missing`. The reasoning is asymmetric: a missing material cost gives a floor
    that is too low, which is bad — but refusing to answer gives no floor at all, and the
    screen then offers "set the price later", which is how an artisan ends up publishing at
    whatever number feels like money. A floor built on labour alone still counts the input
    they were never taught to count.

    Rejecting when EVERYTHING is missing is service.py's job, not this function's: a floor
    of ₹0 clamps nothing, and the app would speak "लागत 0 रुपये है" as though it were a fact.
    """
    missing = [
        name
        for name, value in (("material_cost", material_cost), ("labour_hours", labour_hours))
        if value is None
    ]
    material_cost = material_cost or 0
    labour_hours = labour_hours or 0

    res = suggest(material_cost, labour_hours, cluster_id, channel, market_range)

    discount = RATES["channel_min_discount_pct"].get(channel, 0.0)
    if discount:
        res["breakdown"]["note"] = (
            f"mrp is set so the price still clears the floor after {channel.upper()}'s "
            f"{round(discount * 100)}% mandated discount"
        )
    if missing:
        # Surfaced so the app can say what was NOT counted. A floor is only as honest as
        # the inputs behind it, and the artisan is the only person who can supply them.
        res["assumed_missing"] = missing

    res["breakdown_voice_hi"] = voice_line_hi(material_cost, labour_hours, res["suggested_price"])
    return res


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
