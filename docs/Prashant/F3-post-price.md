# F3 — opening the door: `POST /price`

**Date:** 2026-08-28 · **Feature:** PS 26090 F3, Dynamic Pricing Assistant
**Touches:** `ai/` only. No app change, no schema change, no new dependency.
**Follows:** [F3-pricing-inputs.md](F3-pricing-inputs.md), which made the inputs correct.

---

## What was wrong

`ai/service.py:38` was `raise NotImplementedError`. The cost-up arithmetic was written and
unit-tested, `web/api/routers/price.py` proxied to it, `Price.jsx` had the full clamp-and-speak
floor guard — and none of it ran, because the one function joining them was a stub.

## What landed

### `compute.quote()` — the response, assembled where it can be tested

Assembly lives in `price/compute.py`, not in the endpoint, so the entire contract shape is testable
without FastAPI and every number comes off the arithmetic `test_price.py` already locks down.
`service.py` is now validation + one call.

### `compute.voice_line_hi()` — the spoken sentence

A template. **No model touches a price** (`docs/decisions.md`), and that includes the sentence
saying it out loud.

```
"800 रुपये का सामान, 160 घंटे का काम। 23000 रुपये सही रहेगा।"
```

Register matches the app's own strings (`price.material`, `price.labour`, `price.suggested`) so the
spoken quote and the visible chips sound like one voice rather than two.

**Clauses drop when their input is missing, rather than being spoken as zero.** *"0 रुपये का सामान"*
states a falsehood about what the thing cost; saying nothing about materials is merely silent.

### The null policy — the one real judgement call

| Inputs | Behaviour | Why |
|---|---|---|
| Both present | Normal quote | — |
| One missing | Coerce to 0, price on the rest, return `assumed_missing: ["material_cost"]` | A floor too low is bad. **No floor at all is worse** — the screen then offers "set the price later", which is how an artisan publishes at whatever number feels like money. Labour alone still counts the input they were never taught to count |
| **Both missing** | **422, no quote** | There is nothing to build a floor from. A floor of ₹0 clamps nothing while looking authoritative, and the app would speak *"लागत 0 रुपये है"* to someone who cannot read the screen to check |

The asymmetry is deliberate: `/price` failing costs a suggestion, a fake floor costs the artisan
money. The 422 path is not a dead end — `Price.jsx` already offers retry and "set the price later",
and the listing still publishes.

### `material` and `size` accepted

`comps.market_range()` selects comparables by category **and** material **and** size — comparing a
5.5m cotton saree against a silk dupatta is how a market range becomes noise. The endpoint accepts
both; the app does not send them yet, though F2's vision pre-fill already derives both from the
photo. Wiring them through `web/api` + `Price.jsx` is ~4 lines and is worth doing when `comps.fetch`
lands, since it is what makes the PS phrase *"analyzes the uploaded product image and description"*
literally true of the pricing path.

---

## Verified

```bash
cd ai
.venv/bin/uvicorn service:app --port 8001
```

Not just compiled — **run, and curled**:

| Case | Result |
|---|---|
| 20-day saree, GeM | `200` · floor **₹23,000**, mrp ₹25,556, spoken Hindi sentence |
| Material cost skipped | `200` · floor ₹22,080 + `assumed_missing: ["material_cost"]`, materials clause dropped from the speech |
| No cost information | `422` — never a ₹0 floor |
| No `product_id` | `422` from pydantic |
| Unknown cluster | Falls through to the default wage |

`test_price.py` grew from 5 tests to **12**, covering the contract shape, the null policy, the MRP
note, and three properties of the spoken sentence — including that it quotes the *suggested price*
and not the floor, because speaking a different number from the one on screen is how trust dies.

`ai/contracts.md`'s worked example was stale **and internally impossible** (`floor: 2156` with
`800 + 1440 + 216`, a floor below cost). Now generated from the running endpoint and asserted
against it, so it cannot drift again silently.

---

## ⚠️ Two things the team needs to know

**1. The repo requires Python 3.10+.** `float | None` annotations are used throughout `ai/` and
`web/api/` and do not evaluate on 3.9, even with `from __future__ import annotations` — pydantic
raises `TypeError: unable to evaluate type annotation`. This machine has only 3.9.6, so `ai/.venv`
carries `eval_type_backport` as a local workaround. **Nothing in the repo states a version
requirement.** It belongs in a README, and it applies to `web/api` just as much.

**2. `ai/.venv` is deliberately partial.** It has `fastapi`, `uvicorn`, `httpx`,
`eval_type_backport` — enough to run `/price`, which is stdlib-only underneath. It does **not** have
`requirements.txt` (opencv, anthropic, pillow), because F1 and F2 are still stubs. Run
`pip install -r requirements.txt` before touching those.

## Still open

1. **`comps.fetch`** — `market_range()` returns `None` for every request, so the price always sits
   exactly on the floor. Honest, never harmful, but "current market trends" is unanswered PS wording.
   Our own marketplace first: it is our database and needs no API key
2. **`material` / `size` through the app** — ~4 lines, do it with the above
3. **Validate the floor against real sale prices** — `research/RESULTS.md` → `pricing`, still `open`.
   The formula is arithmetically sound and has never been checked against a real transaction
4. **Spelled-out numbers** in the voice parser, if ASR sampling says it matters
