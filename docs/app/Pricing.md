# Pricing

### Cost-up, not market-down — and why the floor is the feature

**Status:** v1 · handoff document. Extends Master ref §7 (dynamic pricing)
**Read this after** §7 of the Master Technical Reference and the `POST /price` section of
`ai/contracts.md`.
**Audience:** someone building a new workflow on top of this code who has not seen it before.

Everything below was verified by reading the files and running the tests. §8 states plainly what is
implemented and what is stubbed — read it before you plan anything.

---

## 0. The problem this feature actually solves

It is **not** "artisans do not know the market rate."

It is that artisans routinely price **below what the thing cost them to make**, because their own
labour is the one input they were never taught to count. A middleman offers ₹1,800 for eleven days of
work and ₹800 of thread, and it gets accepted — because ₹1,800 feels like money and the eleven days
feel like Tuesday.

Master ref §7.2 ④ puts it bluntly: **under-pricing is the actual epidemic in this sector, not
over-pricing.** This single feature does more for the "increase annual income" impact goal than any
other in the problem statement.

Which means:

> **The price floor is the ethical core of this feature, not a validation rule.**

It is not there to keep the data clean. It is there because a system that helps an artisan list a
product faster, and lets them list it at a loss, has made their life worse with better UX. Everything
in this document arranges itself around that.

Second consequence, from `docs/decisions.md`: **pricing is arithmetic, not a model.** No training data
exists for "what should this handicraft cost", and a pure ML price predictor with no training set is a
slide we cannot defend. Every number here has to survive the question *"how did you get that?"* — which
matters especially on a government problem statement. The LLM appears exactly once in this feature, in
`comps.py:20`, and it never produces a price: it only normalises messy listing titles so we compare
like with like.

---

## 1. The shape of it

```
  artisan's voice answers          artisan profile
   /catalog/voice                   cluster_id
        │                               │
        ▼                               ▼
  ┌─────────────────────────────────────────────────┐
  │  POST /price                     ai/contracts.md│
  │  { product_id, material_cost, labour_hours,     │
  │    cluster_id, category, channel }              │
  └──────────────────────┬──────────────────────────┘
                         ▼
        ┌────────────────────────────────┐
        │  ① material_cost               │  artisan-stated
        │  ② labour_hours × wage_rate    │  rates.json, per cluster
        │  ─────────────────────────     │
        │  cost = ① + ②                  │
        │  ③ × (1 + default_margin_pct)  │
        │  ═══════════════════           │
        │       FLOOR                    │  ← never go below this
        └────────────────┬───────────────┘
                         │
        ┌────────────────▼───────────────┐
        │  ④ market comparables          │  comps.py — currently returns None
        │     mid = (low + high) / 2     │
        │     price = max(floor, mid)    │  ← market only ever moves us UP
        │     below_floor_warning =      │
        │            high < floor        │  ← the market won't pay what it cost
        └────────────────┬───────────────┘
                         │
        ┌────────────────▼───────────────┐
        │  ⑤ mrp = price / (1 − discount)│  GeM mandates ~10% off MRP
        └────────────────┬───────────────┘
                         ▼
     /price screen — the breakdown is SPOKEN, and the floor
     warning is spoken again every time they try to go under it
```

The four layers map exactly onto Master ref §7.2 ①–④, and ⑤ onto §7.3.

---

## 2. Every input

`POST /price`, per `ai/contracts.md`. What the app actually sends is at `app/src/screens/Price.jsx:73-85`.

| Field | Type | Where the app gets it | Notes |
|---|---|---|---|
| `product_id` | str | `draft.listing.product_id` | Created at `/capture/review` |
| `material_cost` | number | `draft.listing.cost_material` | **`null` today** — see below |
| `labour_hours` | number | `hoursFrom(draft.answers.time)` | Parsed out of a spoken answer |
| `cluster_id` | str | `useSession.getState().artisan?.cluster_id` | Selects the wage rate |
| `category` | str | `draft.listing.category` | For comparables only |
| `channel` | str | Hardcoded `'gem'` (`Price.jsx:84`) | Deliberate — see §5 |

### `material_cost` is null today, and it is the wrong kind of wrong

The five voice questions (`app/src/screens/CatalogVoice.jsx:49-55`) are: what · material · time ·
special · size. `catalog.q_material` asks *"What is it made of?"* — the material's **identity**, not
its **cost**. Nothing in the flow asks what the thread cost.

`Price.jsx:75-78` flags this in a comment, and the direction matters:

> "the service prices on labour alone. That understates the floor, which is the wrong direction —
> worth a sixth question."

A floor that is too low is the exact failure this feature exists to prevent. Master ref §7.2 ① already
names the fix: ask by voice — *"dhaaga kitne ka aaya?"*. **Adding that sixth question is the single
highest-value pricing change available**, and it is a one-entry addition to the `QUESTIONS` array plus
a number parse.

⚠️ Note also that `floor_price()` does not accept `None`. Verified:
`floor_price(None, 12, 'sambalpur')` raises `TypeError: unsupported operand type(s) for +: 'NoneType'
and 'int'`, and a null `labour_hours` raises the same on the multiply. `cluster_id=None` is fine — it
falls through to the default wage. Whoever implements `POST /price` in `ai/service.py` must coerce or
reject nulls at the boundary; the app sends them today.

---

## 3. The formula · `ai/price/compute.py`

Deterministic on purpose. 61 lines, no model, no LLM.

### `wage_rate(cluster_id)` — `:16`

```python
RATES["clusters"].get(cluster_id, RATES["default_wage_per_hour"])
```

An unknown cluster silently gets the default. `test_price.py:11-12` asserts this, and the assertion is
only meaningful because `sambalpur` happens to equal the default (both 120). Onboarding a cluster with
a genuinely different wage is a `rates.json` edit, not a code change.

### `floor_price(material_cost, labour_hours, cluster_id, margin_pct=None)` — `:20`

```python
labour = labour_hours * wage_rate(cluster_id)
cost   = material_cost + labour
return round(cost * (1 + margin_pct))          # margin_pct defaults to 0.15
```

Docstring, in full: *"Below this, the artisan is working for free or paying to work."*

The margin is applied to the **whole** cost, material included — not to labour alone. That is a real
decision with a real consequence, and it is worth stating because the example in `ai/contracts.md`
appears to assume the other one (see §9).

### `mrp_for_channel(price, channel)` — `:28`

```python
discount = RATES["channel_min_discount_pct"].get(channel, 0.0)
return round(price / (1 - discount))
```

An unknown channel gets 0% discount, so `mrp == price`. That is the safe default: it never inflates an
MRP for a channel whose rules we do not know.

### `suggest(material_cost, labour_hours, cluster_id, channel="market", market_range=None)` — `:38`

```python
floor = floor_price(material_cost, labour_hours, cluster_id)
price, below_floor = floor, False
if market_range:
    mid  = (market_range["low"] + market_range["high"]) / 2
    price = round(max(floor, mid))               # ← market only moves us UP
    below_floor = market_range["high"] < floor   # ← even the top of the market is under cost
```

Two things in those four lines carry the whole ethic:

- **`max(floor, mid)`** — the market can raise the suggestion, never lower it below what the thing cost
  to make. `test_price.py:20-23` locks this down.
- **`below_floor_warning = high < floor`** uses the *high* end, not the mid. It fires only when the
  entire observed market sits under cost — a strong, honest claim rather than a nervous one. Per
  `ai/contracts.md`: *"the market will not pay what it cost to make. **The app must speak this
  warning.**"*

Returned `breakdown.margin` is `floor − material − labour`, i.e. the rupee value of the margin
percentage, computed by subtraction so the three chips on screen always sum to the floor.

⚠️ `suggest()`'s default `channel="market"` means a caller who forgets to pass the channel gets a 0%
discount and therefore `mrp == price`. On GeM that would recommend a loss-making price. Always pass it
explicitly.

---

## 4. `ai/price/rates.json` — where the numbers come from, and how to recalibrate

```json
{
  "default_wage_per_hour": 120,
  "default_margin_pct": 0.15,
  "clusters": { "sambalpur": 120, "bhuj": 140, "varanasi": 150, "channapatna": 110 },
  "channel_min_discount_pct": { "gem": 0.10, "amazon": 0.0, "flipkart": 0.0, "market": 0.0 }
}
```

| Key | Provenance | How to recalibrate |
|---|---|---|
| `clusters.*` | Rupees per hour. The file's own `_comment` says **"Sourced per cluster, not guessed. Update as clusters onboard."** Master ref §7.2 ② defines the input as `hours × cluster wage rate` | Per cluster, against local minimum-wage notifications and what the cluster coordinator reports the going rate to be. This is a field question, not a code question. Add the key when a cluster onboards; until then it silently gets the default, which is a floor that may be too low for a high-wage cluster like Varanasi |
| `default_wage_per_hour` | 120 — matches Sambalpur | Raise only with evidence. It is the fallback for every artisan whose cluster we have not sourced, so it directly sets their floor |
| `default_margin_pct` | 0.15. Not sourced in-repo; treat it as a product decision, not a measurement | This is the artisan's profit, not ours. Lowering it lowers the floor and weakens the guard |
| `channel_min_discount_pct.gem` | 0.10. Master ref §7.3: GeM mandates a minimum discount off MRP, ~10% typical | ⚠️ **Confirm against the live GeM listing rules.** Master ref marks GeM specs as unconfirmed in §18. If the real mandate is higher than 10%, every GeM MRP we compute is too low and the post-discount price drops under the floor — which is precisely the failure §7.3 exists to prevent |

**Recalibration procedure.** Edit `rates.json`, run `python3 -m pytest test_price.py` from `ai/`, redeploy
the AI service. Two of the five tests hardcode `800 / 12h / sambalpur → 2576`, so a change to the
Sambalpur wage or the default margin will fail them **on purpose** — that failure is the review prompt,
not a broken test. Update the expected number in the same commit, with the source in the message.

There is no rate table for raw materials. Master ref §7.2 ① lists handloom raw-material supply scheme
rates and NHDC yarn prices as possible sources, but the shipped design is *"or simply ask by voice"* —
which is the sixth question from §2.

---

## 5. MRP and the GeM discount · Master ref §7.3

GeM mandates a minimum discount off MRP when listing. **The floor guard must run *after* that discount,
not before.**

> Suggest ₹2,000, GeM knocks 10% off, the artisan nets ₹1,800 — which may be below cost. Miss this and
> we recommend loss-making prices on the platform we are headlining.

So the MRP is set high enough that the post-discount price is still the price we meant:

```
mrp = round(price / (1 - 0.10))
```

Verified with the shipped numbers: `price = 4000` → `mrp = 4444` → `round(4444 × 0.90) = 4000`.
`test_price.py:15-17` asserts exactly that round-trip.

Two places this is preserved that look like they could be dropped:

- **`Price.jsx:84` hardcodes `channel: 'gem'`.** GeM has the strictest MRP maths of any channel, so
  pricing for GeM makes every other channel safe by construction. One request, not one per channel.
- **`Price.jsx:142-144` re-derives the MRP by ratio after the artisan moves the price:**
  ```js
  const mrp = quote.suggested_price
    ? Math.round((price * quote.mrp) / quote.suggested_price)
    : price;
  ```
  Without this, an artisan who nudges the price up keeps the old MRP and the mandated discount eats
  into the margin — or worse, back through the floor.

---

## 6. Comparables · `ai/price/comps.py`

The only part of pricing allowed to be smart — and even here it **returns a range, never a price**.

```python
SOURCES = ["market", "amazon", "flipkart", "gem"]     # :11
```

Our own marketplace, Amazon and Flipkart catalog/search APIs (we are already authenticated wherever a
Tier B channel is connected), and GeM rate contracts, which are published.

| Function | Line | State | What it must do |
|---|---|---|---|
| `fetch(source, category, material, size)` | `:14` | ⛔ `NotImplementedError` | One source → a list of prices. **Returns `[]` on failure, never raises** |
| `normalize(listings)` | `:19` | ⛔ `NotImplementedError` | LLM: messy titles → `{material, size, technique}`, so we compare like with like |
| `market_range(category, material, size)` | `:24` | ✅ implemented | Aggregates, trims, returns `{low, high, sample_size}` or `None` |

### Weighting: there isn't any, and that is deliberate

`market_range` does **not** weight by source, recency or similarity. It pools every price, sorts, and
trims the tails:

```python
trim = len(prices) // 10
kept = prices[trim:len(prices) - trim] or prices
return {"low": kept[0], "high": kept[-1], "sample_size": len(prices)}
```

10% off each end, so one mispriced listing cannot set the range. `or prices` guards the small-sample
case where the trim would empty the list. `sample_size` reports the **pre-trim** count — it is
surfaced in `ai/contracts.md` so a range built from 3 listings can be told apart from one built from 23.

Per-source weighting is **genuinely undecided.** Nothing in the repo specifies it, and the file's own
header argues against reaching for machinery early: *"A for-loop with retries is deliberate. Nothing
here loops or re-decides enough to need an agent framework; revisit only if source selection becomes
genuinely adaptive."* If you add weighting, make it a number in `rates.json`, not a constant in the code.

**A dead source must never kill the price suggestion** (`:29-30`): each `fetch` is individually wrapped
in `try/except … continue`. Combined with the empty-list contract, this is a double guard, and it is
why the whole function currently returns `None` rather than exploding — verified by calling it: with
`fetch` raising `NotImplementedError` for all four sources, `market_range(...)` returns `None`.

When `market_range` is `None`, `suggest()` falls back to `price = floor`. The floor is always
computable, which is the property that makes cost-up the right base layer: **the market is an
enhancement, the floor is the product.**

---

## 7. The screen · `app/src/screens/Price.jsx`

Three tappable things exactly: **less · more · done** (design law rule 1).

### The floor is spoken, not shown

From the file header, and it is the design argument for the whole screen:

> "A red panel is a decoration to someone who cannot read it; a sentence in their own language saying
> 'at this price you will lose money, it cost you two thousand one hundred and fifty six rupees to
> make' is the actual feature."

| When | Code | What is spoken |
|---|---|---|
| The quote lands | `:102-113` | `breakdown_voice_hi` when the artisan's language is Hindi and the service supplied it, else `price.suggested`. Reciting three separate figures at someone is worse than one sentence the service wrote for the purpose |
| The quote lands **and** `below_floor_warning` | `:111` | Appends `price.floor_warning` — hi: *"सावधान! इस दाम पर आपको नुकसान होगा। लागत {floor} रुपये है"* |
| Every time they press **less** below the floor | `:125` | `price.floor_warning` again. Every single time |

### The floor guard · `:117-130`

```js
function lower() {
  const next = price - stepFor(price);
  if (next < quote.floor) {
    setPrice(quote.floor);      // clamp
    setAtFloor(true);
    say('price.floor_warning', { floor: quote.floor });   // AND speak
    return;
  }
  …
}
```

**It clamps and it speaks.** Both halves are required:

- Silently refusing to move reads as a broken button, and the artisan taps it again, harder.
- Moving silently is us watching someone give their work away.

They can still price **at** the floor. Below it, this screen says no. That is the one place in the
entire app where we override the artisan's stated intent, and the justification is §0.

Supporting details:

- `stepFor(p) = max(10, round(p × 0.1 / 10) × 10)` (`:39`) — 10% steps rounded to the nearest ₹10.
  Fine-grained control is not the ask; three big buttons are.
- `hoursFrom(text)` (`:47-50`) takes the first number out of a spoken answer. It carries its own
  `ponytail:` comment naming the ceiling: *"eleven days" spelled out yields nothing and the service
  falls back to its own default. Upgrade to a spoken-number/unit parser when the answers from real
  users say it is worth it — a wrong number here is worse than no number.* Note it also does not
  convert units: "11 din" yields `11`, which the service will read as eleven **hours**.
- The visible warning (`:190-195`) shows while `atFloor || below_floor_warning`, and it is the **only**
  warning this screen can show (rule 4, one problem at a time).
- The breakdown chips (`:198-200`) render `material` / `labour` / `margin` from `breakdown`, and the
  market range sentence below them only when `market_range` is present.

### Failure is not a dead end · `:155-172`

If `/price` fails, the screen offers **retry** and **`price.skip`** ("Set the price later"), which
navigates straight to `/publish`. The comment explains why that is safe:

> "Publish blocks on the colour lock, not on the price — an unpriced product can be priced later from
> `/products/:id`, which is a far better outcome than a lost listing."

This is the same principle as `enhance.failed` in the camera pipeline: an AI outage costs us a feature,
never the artisan's listing.

---

## 8. Current state — implemented vs stubbed

| Piece | State | Evidence |
|---|---|---|
| `ai/price/compute.py` — `wage_rate`, `floor_price`, `mrp_for_channel`, `suggest` | ✅ **Fully implemented** | Read the file; ran it |
| `ai/price/rates.json` | ✅ Real values for 4 clusters | Read the file |
| `ai/test_price.py` — 5 tests | ✅ **Passing** | Ran them |
| `ai/price/comps.py` — `market_range` | 🟡 Implemented, but useless today | Returns `None` because both its inputs are stubbed |
| `ai/price/comps.py` — `fetch`, `normalize` | ⛔ **`raise NotImplementedError`** | `comps.py:16`, `:22` |
| `ai/service.py` — `POST /price` | ⛔ **`raise NotImplementedError`** | `service.py:38` |
| `web/api` — a `/price` route | ⛔ **Does not exist** | Grepped every `@router.` in `web/api/routers/`. There is no `/price` anywhere |
| No `ai/.venv`, nothing on port 8001 | ⛔ | `ls -a ai/`; `ss -ltn` shows only :8000 |
| `breakdown_voice_hi` | ⛔ Not generated anywhere | Grepped. It is in `ai/contracts.md` and consumed at `Price.jsx:105`; nothing produces it |

**What the artisan experiences today.** `Price.jsx:73` posts to `/price`, which resolves to
`/api/price`, which no router serves. The 404 becomes an `ApiError`, `:91` sets `failed =
'price.unavailable'` — hi: *"अभी दाम नहीं निकल पाया"* — and the screen offers retry or skip. **The
listing still publishes.** So the floor guard, the most important feature in the problem statement,
is fully written, fully tested, and never runs in the app.

### What to implement, in order

1. **`POST /price` in `ai/service.py`.** Validate the request (`material_cost` and `labour_hours` are
   `None` today and `compute.py` will `TypeError` on both), call `comps.market_range(...)`, pass the
   result into `suggest(...)`, return the `ai/contracts.md` shape. `suggest()` already returns almost
   exactly that shape — the missing field is `breakdown_voice_hi`.
2. **Add a `/price` route to `web/api`.** `web/api/routers/products.py:119-123` already has the `_ai()`
   helper for exactly this hop, and the file header states the rule: `web/` calls `ai/` over HTTP and
   never imports across the line. This is a handful of lines and it turns the whole feature on.
3. **`breakdown_voice_hi`.** A template, not an LLM — money math stays deterministic and the LLM never
   touches a price (`docs/decisions.md`). `ai/contracts.md` gives the target register: *"800 rupaye
   dhaaga, 12 ghante kaam. 2600 sahi hai."*
4. **The sixth voice question** for material cost (§2). Highest value per line in this document.
5. **`comps.fetch` and `comps.normalize`.** Start with our own marketplace — it is our database and
   needs no API key. Amazon and Flipkart where a Tier B channel is connected, GeM rate contracts last.
   Honour the contract: `fetch` returns `[]` on failure and never raises.

### Running the tests

`test_price.py` imports `from price.compute import …`, so it must run with `ai/` on the path — i.e.
from inside `ai/`.

```bash
cd ai
python3 -m pytest test_price.py -q
```

Verified passing:

```
.....                                                                    [100%]
5 passed in 0.01s
```

Its one-line docstring is the reason it exists: *"The floor guard is the highest-impact feature in the
PS. It gets a test."* No `ai/.venv` is needed — `compute.py` is stdlib only. `pytest` is in
`ai/requirements.txt` if you would rather install it there.

| Test | Line | Locks down |
|---|---|---|
| `test_floor_covers_material_and_labour` | `:6` | The exact arithmetic: `800 + 12×120 = 2240`, +15% → **2576** |
| `test_unknown_cluster_uses_default_wage` | `:11` | An unknown cluster silently gets the default rate |
| `test_gem_mrp_survives_the_mandated_discount` | `:15` | `round(mrp × 0.90) >= price` — §5 |
| `test_market_never_prices_below_the_floor` | `:20` | Market under cost → price stays at the floor **and** `below_floor_warning is True` |
| `test_market_can_price_above_the_floor` | `:26` | Market above cost → price rises to the mid, warning stays `False` |

If you change `rates.json` or the formula, the first test fails by design.

---

## 9. Worked example

**The product:** a handwoven Sambalpuri cotton saree, 5.5m × 1.2m, natural-dye ikat. The artisan is in
the Sambalpur cluster. They bought ₹800 of yarn and say it took 12 hours. Listing to GeM.

Numbers below were produced by actually calling `suggest()` — they are not hand-arithmetic.

### Step 1 — labour

```
wage_rate("sambalpur")  = 120        rates.json → clusters.sambalpur
labour = 12 × 120       = ₹1,440
```

Worth pausing on: ₹1,440 for twelve hours of skilled ikat weaving is the number the artisan would
otherwise not have counted at all.

### Step 2 — cost

```
cost = material + labour = 800 + 1,440 = ₹2,240
```

### Step 3 — the floor

```
floor = round(2,240 × 1.15) = ₹2,576        default_margin_pct = 0.15
```

**₹2,576 is the number this whole feature exists to produce.** Anything below it and the artisan is
working for free or paying to work.

Breakdown as returned, and as the three chips on screen:

| Chip | Value | Source |
|---|---|---|
| `price.material` — "Material 800 rupees" | 800 | Artisan-stated |
| `price.labour` — "Your work 1440 rupees" | 1,440 | `12 × 120` |
| `price.margin` — "Profit 336 rupees" | 336 | `2,576 − 800 − 1,440` |

### Step 4 — the market, three ways

**(a) No comparables — today's real behaviour, since `comps.market_range()` returns `None`:**

```json
{ "floor": 2576, "suggested_price": 2576, "mrp": 2862,
  "market_range": null, "below_floor_warning": false,
  "breakdown": { "material": 800, "labour": 1440, "margin": 336 } }
```

Suggestion sits exactly on the floor. Honest, and never harmful.

**(b) Market above cost — `{low: 3000, high: 5000}`:**

```
mid   = (3000 + 5000) / 2 = 4000
price = max(2576, 4000)   = ₹4,000        ← market moved us UP
below_floor_warning       = 5000 < 2576 → false
```
```json
{ "floor": 2576, "suggested_price": 4000, "mrp": 4444,
  "market_range": { "low": 3000, "high": 5000, "sample_size": 9 },
  "below_floor_warning": false,
  "breakdown": { "material": 800, "labour": 1440, "margin": 336 } }
```

Note the breakdown is unchanged — it always describes the **floor**, not the suggested price. The extra
₹1,424 is what the market will bear above cost, and the screen shows it as
*"Others sell this between 3000 and 5000 rupees"* (`price.market`).

**(c) Market below cost — `{low: 900, high: 1100}`:**

```
mid   = 1000
price = max(2576, 1000)   = ₹2,576        ← market did NOT move us down
below_floor_warning       = 1100 < 2576 → TRUE
```
```json
{ "floor": 2576, "suggested_price": 2576, "mrp": 2862,
  "market_range": { "low": 900, "high": 1100, "sample_size": 5 },
  "below_floor_warning": true, … }
```

This is the case the feature was built for. The artisan hears, on entry, without touching anything:

> *"2576 रुपये सही रहेगा। सावधान! इस दाम पर आपको नुकसान होगा। लागत 2576 रुपये है"*

### Step 5 — MRP for GeM

Taking case (b), `price = 4000`:

```
mrp = round(4000 / (1 − 0.10)) = round(4444.44) = ₹4,444
check: round(4444 × 0.90) = 4000  ✓  clears the price we meant
```

For cases (a) and (c), `price = 2576` → `mrp = round(2576 / 0.9) = ₹2,862`, and
`round(2862 × 0.9) = 2576` ✓ — the post-discount price lands exactly on the floor, not under it.

### Step 6 — the artisan presses "less"

Say they are at ₹4,000 and want to be competitive.

```
stepFor(4000) = max(10, round(400/10)×10) = 400
4000 → 3600 → 3200 → 2800   (each above the floor, silent, allowed)
2800 − 400 = 2400  <  2576  ✗
     → clamp to ₹2,576
     → speak "सावधान! इस दाम पर आपको नुकसान होगा। लागत 2576 रुपये है"
```

Press it again and it speaks again. The button never goes dead and the price never goes under.

On **accept**, the MRP ratio is preserved (`Price.jsx:142-144`):

```
mrp = round(2576 × 4444 / 4000) = round(2861.9) = ₹2,862
```

— which is exactly the MRP the service would have computed for ₹2,576. The GeM discount still clears
the floor.

### A second cluster, to show the wage rate doing work

Same saree, same 12 hours, same ₹800 of yarn, artisan in **Varanasi** (`clusters.varanasi = 150`):

```
labour = 12 × 150 = ₹1,800
cost   = ₹2,600
floor  = round(2600 × 1.15) = ₹2,990      mrp (gem) = ₹3,322
```

₹414 higher, purely because the cluster's wage rate is sourced correctly. **This is why `rates.json` is
a field question, not a config default** — an unsourced cluster silently gets ₹120/hour and an
artisan's floor is set too low, which is the one direction we cannot afford to be wrong in.

---

## 10. Discrepancy found while writing this

**The worked example in `ai/contracts.md` does not match `ai/price/compute.py`, and does not add up
internally.**

For the same inputs (`material_cost: 800`, `labour_hours: 12`, `cluster_id: "sambalpur"`),
`ai/contracts.md:86-97` shows:

```json
{ "floor": 2156, "suggested_price": 2600, "mrp": 2889,
  "breakdown": { "material": 800, "labour": 1440, "margin": 216 } }
```

- The code produces `floor: 2576` and `margin: 336`. Verified by running it, and asserted by
  `test_price.py:8`.
- The contract's own numbers do not reconcile: `800 + 1440 + 216 = 2456`, not `2156`. The `216` looks
  like 15% of labour alone (`1440 × 0.15`), which is a different margin rule than the one in the code
  (15% of material **and** labour).
- `mrp: 2889` for `price: 2600` implies a discount of ~10%, so `mrp_for_channel` is consistent; only
  the floor and margin diverge.

Treat `ai/contracts.md`'s numbers as **illustrative and stale**, and `compute.py` + `test_price.py` as
the source of truth for the arithmetic. The *shapes* in the contract are correct and are what the app
codes against — it is only the example values that drifted.

---

## 11. If you are building a new workflow on this

- **The floor is not a validation rule.** If your workflow can set a price, it must respect the floor
  and must say so out loud. A clamp without a spoken reason is a broken button.
- **Cost-up first, market second.** Comparables may raise a price, never lower it below cost.
- **No model produces a price.** The LLM normalises comparable listings and nothing else
  (`docs/decisions.md`). Every number must survive *"how did you get that?"*.
- **Price for GeM and everything else is safe.** It has the strictest MRP maths; do not compute a
  per-channel price unless you have a reason.
- **Preserve the MRP ratio whenever the price moves**, or the mandated discount eats the margin.
- **Failing to price must never cost a listing.** `price.skip` exists; keep an equivalent.
- `compute.py` is stdlib-only and imports nothing but `json` and `pathlib`. Import it directly for any
  server-side price maths — do not reimplement the floor.
