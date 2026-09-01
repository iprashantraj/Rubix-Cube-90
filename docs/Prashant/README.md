# F3 — Dynamic Pricing Assistant

**Owner:** Prashant · **PS 26090 feature 3** · **Status: built, running, and backed by 144
real listings — [the verdict](#the-verdict--144-listings-2026-08-28)**

My scope was feature 3 of the problem statement:

> *"A machine learning algorithm that analyzes the uploaded product image and description to
> suggest an optimal, competitive selling price based on current market trends and raw
> material costs."*

This file is the handover for that feature: what it does, what was decided and why, what is
proven and what is not. Per-change detail is in the notes indexed at the bottom.

---

## What it does

```
artisan speaks             "सामान कितने का आया?"  → ₹800
                           "कितना समय लगा?"       → "20 दिन"
      │
      ▼  voice/numbers.js — unit-aware
      │                     20 दिन = 160 working hours, NOT 20
      ▼
 POST /api/price  ──→  web/api/routers/price.py  ──→  ai/service.py
      │
      ├─ ① material ₹800 + ② 160h × ₹120 (Sambalpur wage) + 15%   = FLOOR ₹23,000
      ├─ ③ comparables — our marketplace live, plus a dated snapshot
      │     for GeM/Amazon/Flipkart. Can only move the price UP.
      └─ ④ MRP set so GeM's mandated 10% discount still clears the floor
      │
      ▼
 /price screen — three targets: less · more · yes
      the breakdown is SPOKEN, and the floor warning is spoken again
      every single time they press below it
```

The four layers map onto Master ref §7.2 ①–④, and the MRP onto §7.3.

### The one thing to understand about this feature

The problem is **not** that artisans do not know the market rate. It is that they price below
what the thing cost them to make, because their own labour is the input nobody taught them to
count. A middleman offers ₹1,800 for eleven days of work and ₹800 of thread, and it gets
accepted, because ₹1,800 feels like money and the eleven days feel like Tuesday.

So the floor is **spoken, not shown** — a red panel is decoration to someone who cannot read
it — and it is the one place in the entire app where we override the artisan's stated intent.
They can price *at* the floor. Below it, the screen says no, out loud, in their language,
every time.

---

## State

| Piece | State |
|---|---|
| `ai/price/compute.py` — floor, MRP, market logic, spoken line | ✅ |
| `ai/price/comps.py` — comparables, outlier trim | ✅ |
| `ai/service.py` — `POST /price` | ✅ |
| `web/api/routers/price.py` — the proxy hop | ✅ |
| `app` — 6th voice question, unit parser, clamp-and-speak screen | ✅ |
| Floor persisted to the product, so GeM's publish-time guard runs | ✅ |
| Cluster wage rates reachable — pincode → cluster on onboarding | ✅ |
| `ai/test_price.py` | ✅ **30 tests** |
| Verified over real HTTP, all three services running | ✅ |
| Market comparables — 144 real listings collected | ✅ |
| **Validated against real *sold* prices** | ❌ these are listed prices |
| Cluster pincode prefixes confirmed in the field | ❌ postal ranges, not catchments |

Built, running, and with a first evidence base behind it — see [the verdict](#the-verdict--144-listings-2026-08-28).

> **Two things were quietly doing nothing until 2026-08-28**, and both are worth knowing about
> because they are the shape of bug this feature attracts: a safeguard that reads as covered.
> `channels/gem.py` refuses to publish below the floor — but nothing ever *saved* the floor, so
> it exited on its first line every time. And `rates.json` has carried four cluster wage rates
> since the feature was written, none of which any artisan could reach, so the labour half of
> every floor was one hardcoded ₹120 for the whole country. Both fixed; details in
> [F3-floor-persistence-and-clusters.md](F3-floor-persistence-and-clusters.md).

---

## The decisions, and how to defend them

These are the questions this feature will actually get asked.

**"The PS says machine learning. This is arithmetic."**
Deliberate, and recorded in `docs/decisions.md`. No dataset exists for *"what should this
handicraft cost"*. A price model trained on nothing is a slide that dies to the first
question. The AI is real but it sits upstream: F2's vision model reads the photo into
`{category, material, technique}`, and that is what selects comparables. The LLM's job inside
this feature is normalising messy listing titles — **it never produces a number.** Every
figure survives *"how did you get that?"*, which matters more on a government PS than
sounding sophisticated.

**"Why does it not match competitor prices?"**
It does, by construction — `price = max(floor, market_mid)` — unless the entire observed
market sits below cost. That case is not a bug, it is the product: a ₹900 "Sambalpuri saree"
is a powerloom copy, and matching it means telling a handloom weaver to sell twelve hours of
work for ₹900.

**"What if the artisan skips a question?"**
Priced on what remains, with `assumed_missing` returned so the app can say what was not
counted. With *no* cost information at all it returns 422 rather than a ₹0 floor — a zero
floor clamps nothing while looking authoritative. `/price` failing costs a suggestion; a fake
floor costs the artisan money.

**"What if the AI service is down?"**
The screen offers retry and "set the price later", and the listing still publishes. An AI
outage costs a feature, never a listing.

---

## Run and verify

```bash
brew services start postgresql@16
cd ai       && .venv/bin/uvicorn service:app --port 8001
cd web/api  && .venv/bin/uvicorn api.main:app --port 8000 --app-dir ..
cd app      && npm run dev
```

Prerequisites — Python 3.10+, Postgres, `.env` — are in the root [`README.md`](../../README.md).

```bash
cd ai  && .venv/bin/python -m pytest test_price.py    # 30
cd app && npm test                                    # camera gate + number parser
```

The whole feature in one call:

```bash
curl -s -X POST localhost:8001/price -H 'Content-Type: application/json' \
  -d '{"product_id":"p","material_cost":800,"labour_hours":160,
       "cluster_id":"sambalpur","category":"textiles.saree.sambalpuri","channel":"gem"}'
```

```json
{"floor": 23000, "suggested_price": 23000, "mrp": 25556,
 "market_range": {"low": 1200.0, "high": 5000.0, "sample_size": 39},
 "below_floor_warning": true,
 "breakdown_voice_hi": "800 रुपये का सामान, 160 घंटे का काम। 23000 रुपये सही रहेगा।"}
```

`below_floor_warning: true` against 39 real comparables is the feature working: twenty days
of weaving does not clear what the observed market pays, and the app says so out loud.

---

## The verdict — 144 listings, 2026-08-28

Collected from **indiahandmade.com**, the Ministry of Textiles' own marketplace for verified
weavers. Full write-up in [`research/RESULTS.md`](../../research/RESULTS.md); protocol in
[`research/pricing/README.md`](../../research/pricing/README.md).

| Category | n | median |
|---|---|---|
| `textiles.saree` (cotton) | 39 | ₹2,140 |
| `textiles.saree.silk` | 9 | ₹30,000 |
| `textiles.dhurrie` | 48 | ₹3,230 |
| `painting.madhubani` | 30 | ₹3,225 |
| `painting` | 18 | ₹4,122 |

**The verdict flips on one input, and it is the one we trust least.** Same materials, same
cluster: at 12 labour hours the floor is ₹2,576 and sits inside the observed saree spread; at
160 hours it is ₹23,000 and sits above all of it. The formula is not right or wrong on its
own — it is a lever on `labour_hours`, which arrives as a spoken answer through a
first-number-wins parser that still cannot read *"बीस दिन"*.

### The number for the slide

At the median listed price of **₹2,140**, minus ₹800 of materials, ₹1,340 is left for labour:

| Time taken | Implied wage |
|---|---|
| 2 days (16 h) | ₹84/hour |
| 5 days (40 h) | ₹34/hour |
| 20 days (160 h) | **₹8/hour** |

> To clear the Sambalpur cluster wage of ₹120/hour, a handloom cotton saree would have to be
> woven in **11.2 hours** — on the government's own artisan marketplace, not a discount
> consumer platform.

That is direct evidence for the premise this feature is built on: under-pricing, not
over-pricing, is the problem in this sector.

**Three caveats, stated rather than buried:** these are *listed* prices, not sold prices;
`textiles.saree` is too broad a class, since a plain Santipuri and a Sambalpuri bandha ikat
differ perhaps tenfold in labour; and ₹120/hour is itself unsourced and is the denominator of
every number above.

---

## What is left

1. **Weave-specific collection.** The biggest weakness in the current set is breadth —
   `textiles.saree.sambalpuri` rather than `textiles.saree`. The taxonomy walk-up already
   supports it; it needs more browsing.
2. **Confirm the cluster pincode prefixes and wage rates.** The rates are now reachable
   (they were not until 2026-08-28 — see the change note below), but a district postal range
   is not a cluster's catchment, and `rates.json` says outright the rates are a field question.
3. **Spelled-out numbers** in the voice parser — *"बीस दिन"* → `null`. The verdict above makes
   this more urgent than it looked: `labour_hours` is the input the whole feature pivots on.
4. **`material`/`size` through the app** (~4 lines); `/price` already accepts them.
5. **A database fixture for `web/api`.** `cluster_for_pincode` has no unit test because its
   longest-prefix rule lives in the SQL and there is nothing to test a query against. It was
   verified live on three pincodes including the no-match fallback, which is the case that
   must not regress.

---

## Change notes

| Date | File | What |
|---|---|---|
| 2026-08-28 | [F3-pricing-inputs.md](F3-pricing-inputs.md) | Unit-aware number parsing + the sixth voice question. The units bug was worth **6×** on the floor |
| 2026-08-28 | [F3-post-price.md](F3-post-price.md) | `POST /price` — the floor guard had never once run |
| 2026-08-28 | [F3-comparables.md](F3-comparables.md) | Comparables from our own marketplace, and an outlier trim that did nothing below ten samples |
| 2026-08-28 | [F3-price-snapshot.md](F3-price-snapshot.md) | Snapshot loader + collection protocol for the sources with no API — numbers deliberately left to a human |
| 2026-08-28 | [`research/RESULTS.md`](../../research/RESULTS.md) | **The verdict** — 144 listings collected, and what they say about the floor |
| 2026-08-28 | [F3-floor-persistence-and-clusters.md](F3-floor-persistence-and-clusters.md) | Two written safeguards that did nothing: an unsaved floor, and cluster wage rates no artisan could reach |
| 2026-08-28 | [dev-setup-and-theme-check.md](dev-setup-and-theme-check.md) | Not F3: a self-check that failed on every page load, and the undocumented Python 3.10+ requirement |
| 2026-09-01 | [F2-first-live-run.md](F2-first-live-run.md) | Not F3: F2's first run against a live model — four faults in a row on one code path, all degrading silently into the fallback, a prompt that fabricated, a **server TTS that had been dead behind its own fallback**, and `/catalog/prefill` built — the last unwritten piece of F2 |

Commits: `c2c58dd` · `819aa3c` · `8633a0c` · `6e955bc` · `cb63fa2`, plus `40fb279` (a missing migration
that broke `POST /api/products` on any fresh clone) and `7b4101d`.

The permanent spec stays where it lives — Master ref §7 and
[`docs/app/Pricing.md`](../app/Pricing.md) — and was edited in place wherever these changes
made it stale. These notes are the record of the change; the spec describes the system.
