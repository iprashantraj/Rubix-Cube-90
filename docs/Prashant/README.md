# F3 — Dynamic Pricing Assistant

**Owner:** Prashant · **PS 26090 feature 3** · **Status: built, running, and unvalidated —
see [What is left](#what-is-left)**

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
| `ai/test_price.py` | ✅ **29 tests** |
| Verified over real HTTP, all three services running | ✅ |
| **Validated against real sale prices** | ❌ **never** |

**Everything is built. Nothing is validated.** Those are different claims, and the second is
the one a judge will ask about.

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
cd ai  && .venv/bin/python -m pytest test_price.py    # 29
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
 "breakdown_voice_hi": "800 रुपये का सामान, 160 घंटे का काम। 23000 रुपये सही रहेगा।"}
```

---

## What is left

**One thing, and it is not code: nobody has collected real prices.**

`research/RESULTS.md` → `pricing` is still `open`. The tooling is written and exercised —
`research/pricing/pricing.py check` prints, per category, whether our floor lands inside the
observed spread, above it, or below it. It needs an afternoon of browsing to fill
`research/pricing/observed.csv`. Protocol:
[`research/pricing/README.md`](../../research/pricing/README.md).

Two reasons it matters more than it sounds:

1. **Without it the demo shows a price sitting exactly on the floor.** Our own marketplace is
   empty until artisans list, and GeM, Amazon and Flipkart have no queryable price API — so
   `market_range` is `null` and the "current market trends" half of the PS sentence goes
   unanswered on stage.
2. **The camera thresholds were calibrated against 591 fixtures on 27 Aug. This floor has met
   zero real transactions.** Both feed a number an artisan acts on; only one has evidence
   behind it.

All three outcomes of that check are publishable — including *"the market pays below cost"*,
which is the finding this whole feature exists to expose and a better slide than a working
algorithm.

**Smaller, optional:** `material`/`size` are accepted by `/price` but not yet sent by the app
(~4 lines); spelled-out numbers — *"बीस दिन"* — still parse to `null` rather than 20, pending
a real sample of what Bhashini actually returns.

---

## Change notes

| Date | File | What |
|---|---|---|
| 2026-08-28 | [F3-pricing-inputs.md](F3-pricing-inputs.md) | Unit-aware number parsing + the sixth voice question. The units bug was worth **6×** on the floor |
| 2026-08-28 | [F3-post-price.md](F3-post-price.md) | `POST /price` — the floor guard had never once run |
| 2026-08-28 | [F3-comparables.md](F3-comparables.md) | Comparables from our own marketplace, and an outlier trim that did nothing below ten samples |
| 2026-08-28 | [F3-price-snapshot.md](F3-price-snapshot.md) | Snapshot loader + collection protocol for the sources with no API — numbers deliberately left to a human |
| 2026-08-28 | [dev-setup-and-theme-check.md](dev-setup-and-theme-check.md) | Not F3: a self-check that failed on every page load, and the undocumented Python 3.10+ requirement |

Commits: `c2c58dd` · `819aa3c` · `8633a0c` · `6e955bc`, plus `40fb279` (a missing migration
that broke `POST /api/products` on any fresh clone) and `7b4101d`.

The permanent spec stays where it lives — Master ref §7 and
[`docs/app/Pricing.md`](../app/Pricing.md) — and was edited in place wherever these changes
made it stale. These notes are the record of the change; the spec describes the system.
