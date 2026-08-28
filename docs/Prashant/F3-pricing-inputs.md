# F3 — fixing the two inputs the price floor is built from

**Date:** 2026-08-28 · **Feature:** PS 26090 F3, Dynamic Pricing Assistant
**Touches:** `app/` only. No backend, no AI service, no schema change.
**Spec this updates:** `docs/app/Pricing.md` §2, §7, §8 · `docs/Application-Architecture.md` row 12

---

## Why

The floor price is the ethical core of F3. `docs/app/Pricing.md` §0:

> a system that helps an artisan list a product faster, and lets them list it at a loss, has made
> their life worse with better UX.

The arithmetic that produces the floor was already written and unit-tested. **Its two inputs were
both wrong, and both wrong in the same direction — too low.**

### Error 1 — the units, worth 6×

`hoursFrom()` lived inline in `Price.jsx` and took the first number in the answer as hours,
ignoring the unit word sitting right next to it.

A weaver answers *"बीस दिन लगे"* — twenty days.

```
parsed as 20 hours   ->  floor = (800 + 20×120)  × 1.15 = ₹3,680
actually 160 hours   ->  floor = (800 + 160×120) × 1.15 = ₹23,000
```

Genuine Sambalpuri ikat sarees sell for ₹8,000–₹25,000. **₹23,000 is the honest number. ₹3,680 is
the app handing a weaver to the middleman with a receipt** — and doing it with the authority of a
figure on a screen.

### Error 2 — nobody asked what the materials cost

The five cataloger questions were: what · material · time · special · size. `catalog.q_material`
asks *"What is it made of?"* — the material's **identity**, never its **cost**. So `material_cost`
was `null` on every single request and the floor counted labour alone.

Master ref §7.2 ① had already named the fix (*"or simply ask by voice"*); it had just never been
built.

---

## What changed

### 1. `app/src/voice/numbers.js` — new

The parser moved out of the screen into its own module, because two screens need it and a parser
this load-bearing needs a test that does not require React.

Exports `numberFrom`, `hoursFrom`, `rupeesFrom`. Imports nothing.

| Capability | Example | Result | Why it matters |
|---|---|---|---|
| **Unit words**, hi/en/or, matched as stems | `"3 हफ्ते"` | 144 hours | The 6× bug |
| **Indic digits**, Devanagari + Odia | `"२० दिन"` · `"୨୦ ଦିନ"` | 160 hours | Indic ASR returns these routinely and `/\d/` does not match them — a perfectly clear answer read as *no answer* |
| **Scale words** | `"2 हज़ार"` | ₹2,000 | Reading it as ₹2 understates material cost **1000×** — worse than the units bug |

**`HOURS_PER` is a calibration, not a fact.** A day is 8 hours, a week 48, a month 200 — working
days, not calendar ones. Tune per craft if field testing says artisans mean something else. Both
directions move the floor.

**Unit selection takes the unit that *follows* the number**, with a whole-sentence fallback for
`"din bees, 20"` word order. This was a bug found by a failing test: the first version picked by
table order, so `"एक हफ्ते और 2 दिन"` resolved as two days *by accident* rather than by rule. It still
resolves as two days and still loses the week — an acceptable crudeness only because the sixfold
error is gone.

**Scale words only multiply when they follow the number**, so `"hazaar rupaye ka 2 metre kapda"`
stays 2.

**Zero is a real answer.** `rupeesFrom("0")` returns `0`, not `null` — a potter who digs their own
clay genuinely spent nothing, and that is not the same as not answering.

#### ⚠️ Known ceiling, deliberately left

Spelled-out numbers. `"बीस दिन"` returns `null`.

A number-word table across three languages is ~80 entries of data whose value depends entirely on
whether Bhashini returns numerals or words — and that is an open question
(`research/RESULTS.md` → `asr-bhashini`, verdict `open`). Build it when a real transcript sample
says it is needed.

`null` is the safe failure: the floor falls back to what it does have. **A wrong number is worse
than no number.**

### 2. The sixth question

`app/src/screens/CatalogVoice.jsx` — `catalog.q_cost`, added to `QUESTIONS` **after** `q_material`,
not at the end: "what is it made of" then "what did that cost" is one conversational beat.

| Lang | String |
|---|---|
| hi | सामान कितने का आया? |
| en | What did the materials cost? |
| or | କଞ୍ଚାମାଲ କେତେ ଟଙ୍କାର ଆସିଲା? |

Added to the three base bundles rather than a `_new_*.json` file, so it sits with the other five
`catalog.q_*` keys.

`QUESTIONS` was already fully length-driven (`.length`, `.map`) — the six progress dots render
automatically and `.qdots` is a flex row, so no CSS changed.

### 3. The answers reach the product

`CatalogReview.accept()` now parses and PATCHes both pricing figures:

```js
cost_material: rupeesFrom(draft.answers?.cost),
labour_hours:  hoursFrom(draft.answers?.time),
```

Both columns already existed in `models.py` and `ProductIn` already accepted both. **Nothing had
ever written to either.**

Persisting them — rather than only handing them to `/price` — is what lets a product be re-priced
later from `/products/:id` without re-asking. Which is why `Price.jsx` now reads:

```js
labour_hours: d.listing?.labour_hours ?? hoursFrom(d.answers?.time)
```

The product first, the draft second. `useDraft` is cleared when the flow ends, so a re-price from
the catalog would otherwise have sent `null` hours for a product that has them on record.

### 🔒 One trap, guarded at both ends

**`cost` must never reach a buyer.** It is the artisan's input cost, not a line in a public listing.

`compose()` in `CatalogReview` builds the description from a named field list and `cost` is
deliberately absent. Safe by construction — but commented in both files, because "add the new
answer to the description" is exactly the tidy-up someone does six weeks from now.

---

## Flow check — what else this touches

Traced every consumer before and after.

| Checked | Result |
|---|---|
| `QUESTIONS` index/length assumptions | None. Fully `.length`/`.map` driven |
| `OnboardReady.jsx` — has its own `QUESTIONS` | Separate array, untouched |
| Other readers of `draft.answers` | Only `CatalogReview` and `Price`. Both updated |
| Other definitions of `hoursFrom` | None left — the inline copy in `Price.jsx` is deleted, not duplicated |
| `ProductIn` accepts the two fields | Yes, already did |
| Route into `/price` | Only from `/catalog/review`, which always sets them first |
| Stale "five questions" prose | Fixed in `CatalogVoice`, `CatalogReview`, `CatalogPrefill`, `styles.css`, `Application-Architecture.md` |

## Tests

```bash
cd app && npm test
```

Runs `node src/camera/gate.js && node src/voice/numbers.js`. The new self-check is 21 cases, every
one a sentence somebody would actually say into a microphone. Same node-runnable pattern as the
camera gate — no framework, no fixtures.

`vite build` was **not** run: `node_modules` is not installed in this clone. Wiring verified
statically instead — exports resolve, both importers point at real paths, `catalog.q_cost` present
in all three bundles, all four string files parse as JSON.

---

## What this does NOT close

**F3 still does not run.** These changes make the floor *correct*; they do not make it *reachable*.

`ai/service.py:38` is still `raise NotImplementedError`, and nothing listens on port 8001. The app
posts to `/api/price`, `web/api/routers/price.py` proxies it, the AI service is not there, the
router returns 503, and `Price.jsx` speaks *"अभी दाम नहीं निकल पाया"* and offers retry or skip.

**One function stands between a written, tested, correctly-fed floor guard and it running:**
`POST /price` — validate, call `comps.market_range()`, pass to `suggest()`, return the
`ai/contracts.md` shape. ~40 lines.

Still open after that, in order:

1. `breakdown_voice_hi` — a template, not an LLM. No LLM touches a price (`docs/decisions.md`)
2. `comps.fetch` — our own marketplace first; it needs no API key
3. Validate the floor against real sale prices — `research/RESULTS.md` → `pricing`, still `open`
4. Spelled-out numbers, if ASR sampling says it matters
