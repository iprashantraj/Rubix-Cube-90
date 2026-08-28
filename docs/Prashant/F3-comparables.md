# F3 — market comparables, and the trim that never ran

**Date:** 2026-08-28 · **Touches:** `ai/price/comps.py`, `ai/test_price.py`
**Follows:** [F3-post-price.md](F3-post-price.md)

---

## What landed

`fetch("market", …)` reads our own marketplace over `GET /api/shop/products`. That endpoint is
unauthenticated because those pages have to be indexable, so this needs **no API key and no
database credentials in `ai/`** — `web/` and `ai/` stay separate deploy units and nothing imports
across the line. Base URL from `API_BASE_URL`, 3s timeout.

Unpriced listings are skipped rather than counted as zero: publishing before `/price` ran is a
supported path ("set the price later"), and those products are not free.

### The other three sources return `[]`, and that is a decision

| Source | Why not |
|---|---|
| Amazon / Flipkart | **Seller** APIs. They authenticate *as one shop* and show that shop's own listings. There is no open "what does a cotton saree go for" endpoint. Usable only for an artisan who has connected a Tier B channel — not the artisan this PS is about |
| GeM | No API of any kind. Rate contracts are published as documents |

Scraping search pages would work until it didn't: against both sites' terms, broken by a CSS
rename, IP-blocked halfway through a demo. The honest source for those three is a **dated snapshot
collected by hand** into `research/pricing/` and read from a file. Still open.

`normalize()` stays unused — it exists to turn messy scraped titles into comparable attributes, and
our own rows are already structured. It becomes real when a hand-collected snapshot does.

---

## 🔴 The bug this found, which unit tests could not

`market_range` trimmed `len(prices) // 10` from each end. **That is zero for every sample under
ten** — exactly when one outlier does the most damage, and small samples are the normal case for a
marketplace that is still filling up.

Seeded six real listings through the running stack: five cotton sarees around ₹4,000 and one
miscategorised silk piece at ₹45,000.

```
before   range 3000–45000   suggested ₹24,000    for a saree that cost ₹2,576 to make
after    range 3500–5000    suggested ₹4,250
```

**The existing unit test missed it because it used twenty prices**, where `20 // 10 = 2` and the
arithmetic happens to work. The test was written from the worked example in the docs, and the
worked example used a comfortable sample size. Real data did not.

Fix: drop at least one from each end once there are four prices — the smallest sample where
trimming still leaves a range behind. Below four, nothing is trimmed and `sample_size` is the
honest signal that the range is thin.

> Worth keeping in mind for the other pipelines: this was not a logic error anyone would catch by
> reading. It needed real data, at a realistic volume, through the real path.

---

## Verified against the running stack

| Case | Result |
|---|---|
| Six listings incl. a ₹45,000 outlier | range `3500–5000`, suggested **₹4,250** |
| Market entirely below cost (gamcha, ₹800–1300) | suggested **₹2,576 = floor**, `below_floor_warning: true` — did not follow the market down |
| Empty marketplace | `market_range: null`, price falls back to the floor |
| `web/api` unreachable | `market_range: null`, price still ₹2,576 — a dead source costs a suggestion, never a price |

`test_price.py`: 12 → **21 tests**, including the first coverage `market_range` has ever had — its
trim, its outlier handling, its small-sample behaviour and its `None` path were all unreachable
while `fetch` raised.

---

## Still open

1. **Dated price snapshot** for Amazon/Flipkart/GeM (`research/pricing/`) — the demo-day source,
   since our own marketplace is empty until artisans list
2. **`material` / `size` through the app** — `/price` accepts them; `/api/shop/products` does not
   return material, so the market source filters on category alone. Our taxonomy is granular
   ("textiles.saree.sambalpuri") so this is tighter than it sounds
3. **Validate the floor against real sale prices** — `research/RESULTS.md` → `pricing`, still `open`

---

**Postscript, 2026-08-28:** the dated snapshot named in "Still open" now exists — 144 listings from
indiahandmade.com. `test_price.py` has grown 21 → 30, and four of the tests written here turned out
to be passing only because the committed seed was empty; they now isolate the seed as well as the
`market` source. See [F3-price-snapshot.md](F3-price-snapshot.md) and
[`research/RESULTS.md`](../../research/RESULTS.md).
