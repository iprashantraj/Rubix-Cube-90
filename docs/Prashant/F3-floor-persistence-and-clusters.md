# Two gaps that made written safeguards do nothing

**Date:** 2026-08-28 · **Touches:** `web/api` (products, artisans, models, migration),
`ai/price/compute.py`, `app` (Price, OnboardPlace)
**Found by:** asking "is F3 implemented as planned?" and actually checking, rather than
recalling.

---

## Gap 1 — the floor was never saved, so GeM's guard never ran

`channels/gem.py` has a genuinely important check: refuse to publish if GeM's mandated 10%
discount would push the price below the artisan's floor. Its first line is

```python
if not product.mrp or not product.floor_price:
    return "missing mrp or floor price"
```

and **nothing ever wrote `floor_price`**. The column existed, the migration created it, the
check read it, and no code path set it — so the guard exited before testing anything, on the
channel we headline.

Harmless while `/price` is the only way to set a price, because that screen clamps. Not
harmless for any other path: admin edits, re-pricing from `/products/:id`, a future bulk
import. A safeguard that cannot fire is worse than no safeguard, because it reads as covered.

Fix: `floor_price` on `ProductIn`, and `Price.jsx` sends `quote.floor` alongside price and mrp.

### Turning it on immediately caught a real bug

With a floor to read, the guard **rejected a correctly priced saree**:

```
price 2576 -> mrp round(2862.22) = 2862 -> 2862 x 0.9 = 2575.8   <- below the floor
```

`mrp_for_channel` used `round`, which goes *down* below .5 and lands the post-discount price a
fraction under the floor — the exact property the guard asserts. `ceil` restores the
guarantee:

```
price 2576 -> mrp ceil(2862.22) = 2863 -> 2863 x 0.9 = 2576.7    <- clears
```

One rupee of MRP is invisible to a buyer; a blocked listing is not. The old test asserted
`round(mrp * 0.9) >= price`, which is the weaker claim that hid this — it now asserts the
unrounded property across six prices.

---

## Gap 2 — every artisan in the country priced their labour at one rate

`ai/price/rates.json` has carried per-cluster wage rates since the feature was written:
Sambalpur ₹120, Bhuj ₹140, Varanasi ₹150, Channapatna ₹110. **None could ever be used.**

- nothing set `artisans.cluster_id` — it was read in `Price.jsx` and written nowhere
- the `clusters` table was empty
- `Cluster.wage_rate_per_hour` was read by no code at all

So every request fell through to `default_wage_per_hour`, and the labour half of every floor
was one hardcoded ₹120. A Varanasi weaver's floor was quietly **20% short** — in the one
direction that costs an artisan money.

This is worse than the caveat recorded in `research/RESULTS.md`, which said only that ₹120 was
unsourced. It was unsourced *and universal*.

### The link was designed and never built

`OnboardPlace.jsx` already collects a pincode, and its own header says the pincode is for
*"serviceability, **cluster auto-link**, and the intra-state check"*. So:

- migration `e7a1c2b83d55` seeds the four clusters **with the rates copied from
  `rates.json`** — ids match its keys so the two cannot drift into disagreeing about who
  "sambalpur" is — and adds `pincode_prefix`
- `PATCH /me` resolves a pincode to a cluster by **longest** matching prefix, so a narrow
  cluster beats a broad one and adding a more specific prefix later needs no code change
- `GET /me` returns `cluster_id`; `OnboardPlace` keeps it in the session, which is where
  `Price.jsx` reads it from

**No match leaves `cluster_id` NULL and prices on the default** — today's exact behaviour. The
link can only ever add a correct rate, never substitute a wrong one for a right one.

```
same saree, 160 h, ₹800 of yarn
  varanasi   -> floor ₹28,520
  sambalpur  -> floor ₹23,000
  unmatched  -> floor ₹23,000  (default, as before)
```

⚠️ **The prefixes want field confirmation.** A district postal range is not a cluster's
catchment: a weaver 20 km outside Sambalpur shares the 768 prefix and may belong to no cluster,
and a cluster may draw from two prefixes. Said so in the migration, next to the data.

---

## Verified

Live through all three services: three pincodes (221001 → varanasi, 768001 → sambalpur,
110001 → null), `GET /me` carrying `cluster_id`, and the Varanasi floor coming back ₹28,520
against Sambalpur's ₹23,000. The GeM guard tested at three states — priced correctly, priced
below the floor, and floor missing.

30 pricing tests, the app self-checks and `web/api/test_uploads.py` all pass. Every MRP figure
quoted in `docs/app/Pricing.md` is asserted against `mrp_for_channel` rather than retyped.

`cluster_for_pincode` has **no unit test** — the longest-prefix rule lives in the SQL query and
the repo has no database fixture to test against. It was exercised live on the three cases
above, including the no-match fallback, which is the one that must not regress.
