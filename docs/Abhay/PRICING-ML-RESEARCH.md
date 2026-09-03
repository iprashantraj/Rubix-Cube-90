# Dynamic Pricing Assistant — how other platforms do it, and what we should build

**Status:** research note · 2026-08-31 · no code written, nothing in `ai/` changed by this document
**Feature:** PS 26090 feature 3 — *"a machine learning algorithm that analyzes the uploaded
product image and description to suggest an optimal, competitive selling price based on current
market trends and raw material costs"*
**Read this after** `docs/app/Pricing.md` (what is built) and `research/RESULTS.md` (what the
144 collected listings say). This document does not restate either; it asks what comes next.

## Why this document exists

`docs/decisions.md:58` settles that **pricing is arithmetic, not a model**. The problem
statement asks for a machine learning algorithm. That reads as a contradiction and it is not —
but the resolution has to be written down, with evidence, or it will be re-litigated every time
somebody new reads the PS text next to our decisions file.

The evidence is: **no shipping e-commerce platform has an image-to-price model**, and the best
published price predictor in the world is still wrong by about 1.5× with a million training
rows. Both claims are sourced in §12.

## How to read this

| Part | What | For |
|---|---|---|
| **Part 1** | The whole argument in plain language, no jargon | Anyone. Teammates, a slide, a judge's question |
| **Part 2** | The research, the numbers, and the design | Whoever builds this |
| **Part 3** | Sources | Checking any claim above |

---
---

# PART 1 — In plain language

## 1. What the problem statement asks for

> "Look at the photo and the description. Tell the artisan what price to sell at."

Sounds simple. It is not.

## 2. What we have already built

When a weaver tells us her story by voice, we already do this arithmetic:

```
Yarn she bought            ₹800
Her time: 12 hours × ₹120  ₹1,440
                          ------
Total cost                 ₹2,240
+ 15% profit for her       ₹336
                          ------
FLOOR PRICE                ₹2,576   ← never sell below this
```

That ₹2,576 is **the floor**. It is the "you will lose money below this" line.

Then we look at what similar sarees sell for (we collected 144 real listings). If the market
says ₹3,000–₹5,000, we suggest ₹4,000.

**But the market can only push the price UP, never below the floor.**

That sentence is the heart of the feature. Here is why it matters:

A middleman offers a weaver ₹1,800 for 20 days of work. She says yes, because ₹1,800 *feels*
like money and 20 days feels like just… Tuesday. Nobody ever taught her to count her own time
as a cost. Our app counts it for her, refuses to let her go below it, and **says so out loud in
Hindi**, because she may not be able to read.

## 3. The confusion — and the answer

**The problem statement says "machine learning."**
**Our decisions file says "no machine learning — just arithmetic."**

That looks like we are not doing what was asked. The trick:

> **The AI should not guess the price. The AI should work out WHAT THE THING IS. Then ordinary
> arithmetic gives the price.**

Think of a property dealer. He does not stare at a house and magically feel "₹40 lakh." He works
out: *3BHK, Sector 12, 1,200 sq ft, 5 years old.* **That** is the skilled part. Once he knows
exactly what it is, he looks up what similar flats sold for.

Same here. The AI's job is to say *"this is a hand-woven Sambalpuri ikat cotton saree with dense
traditional motifs."* That is genuinely hard, and genuinely AI. Finding the price after that is
just comparing against similar sarees.

**This is also exactly what every big platform already does.** Nobody has an AI that looks at a
photo and produces a price. Checked, in §5 and Part 2 §1.

## 4. How the big platforms actually do it

Six of them, one line each.

**Etsy** — the world's biggest handmade marketplace. Their official seller advice is a formula:
*materials + labour + expenses + profit*. No AI. Literally our formula.

> They then tell sellers to **double** it for retail. We add only 15%. So our margin may be too
> harsh on the artisan. Worth revisiting — see Part 2 §6.

**eBay** — looks at what similar items actually **sold** for in the last 30 days, then shows the
seller the actual sold listings so they can see the proof. The seller can always ignore it.

**Amazon** — has an automatic pricing tool. But **the seller must enter a minimum price, and the
algorithm is not allowed to go below it. Ever.**

> The strongest outside validation of our floor. The most aggressive pricing robot in retail
> still obeys a floor. The difference is that an Amazon seller knows his own costs and our
> weaver does not — **so we compute the floor for her.** That is the actual contribution.

**Airbnb** — the fancy one. Real AI, 70+ signals, learns from bookings. They have millions of
past bookings to learn from. We have zero. We cannot copy this and should say so plainly rather
than gesture at it.

**Mercari** — ran a public competition to predict price from title and description. The most
important result in this whole document; see §5.

**GeM** — the government portal we publish to. It already has its own price-checking tools, and
government buyers are legally required to certify that a price is reasonable.

> This gives us a gap we do not handle: today we warn when a price is **too low**. On GeM, a
> price that is **too high** can be rejected by the buyer. We have no warning for that.

**The pattern across all six:**

| Everyone does this | Do we? |
|---|---|
| Suggest a range, never force a price | ✅ Yes |
| A floor exists that the algorithm cannot cross | ✅ Yes |
| The seller sees why, and can override | ✅ Yes |
| The AI's job is picking similar items, not inventing a number | ❌ **Our gap** |

## 5. The number that settles the argument

Remember this one for the presentation.

Mercari ran a public competition. **1.4 million** items with real prices. The world's best data
scientists competed. Best result:

> **The winning model was typically wrong by about 1.5×.**

For a ₹2,140 saree, the best price-predicting AI in the world would say *"somewhere between
₹1,450 and ₹3,150."*

**Not a price. A range.** And that is with 1.4 million examples. **We have 144.**

So even a perfect execution of the PS's literal wording gives a range. Any single confident
number a model produced here would be fiction.

> **The answer when a judge asks "why isn't your pricing AI?":**
>
> *"Because the best one in the world, with ten thousand times our data, still cannot give a
> single number. So we give the range honestly, and we give the floor exactly."*

## 6. Can a photo tell you the price?

**Photos work when the photo tells you what the thing IS, and that thing has a known price.**

A photo of a car → the AI recognises "2019 Maruti Swift VDI" → looks up the price. Notice it did
not *judge* the value. It *identified* the object, then used a price list.

**Photos fail when every item is one of a kind.** There is a study on art prices which found the
artist's reputation and history predict price **better than what the painting looks like**.
Handicraft is far closer to art than to cars. And:

> A genuine hand-woven Sambalpuri saree and a machine-printed copy look **almost identical** in
> a phone photo. One is worth ₹8,000 and the other ₹900.
>
> **What separates them is not in the picture.** It is the 20 days of work, the technique, and
> where it came from. We already capture the first two — by asking her.

So: **the camera cannot tell you what it is worth. It can tell you what it is.**

That is still worth a lot, because our biggest weakness today is comparing a fine Sambalpuri
ikat against *all sarees* — including ₹750 printed ones. That comparison is unfair and it drags
her suggestion down.

## 7. Where the photo genuinely helps us

Recognising fabric from photographs is a solved problem. Published results:

- Telling saree textures apart: **98% accurate**
- Telling Banarasi / Bandhani / Patola / Kanjeevaram / Tussar apart: a published system exists

And **we have an advantage nobody in those papers has.** Our pipeline already removes the
background. A clean product on white is far easier to classify than a saree on a charpai in a
dark room. We get that for free — step 5 already built it.

### The cheapest good idea in this document

A research paper on handloom pricing finds the biggest driver of handloom price is **design
density** — how much intricate work is packed into the cloth. That makes sense: more motifs =
more days of weaving = more value.

**We can measure that today, with code we already have.** We already have the cut-out product
shape. We can measure how busy the pattern is inside it. That is a number.

Then check it against our 144 real prices: *does busier cloth actually sell for more?*

> Yes → we have a real, explainable, photo-derived price signal, built in days.
> No → we learned it cheaply, and we write it up so nobody repeats it.

**This is what to build first.** Best effort-to-value ratio in the feature. No training data, no
labels, no GPU.

### One safety rule, non-negotiable

> **If the AI's guess disagrees with what she said, we believe HER — not the AI.**

She says "Sambalpuri saree." The AI, on a blurry photo, says "printed cotton." We do **not**
quietly price her at ₹900. We fall back to a wider comparison, report lower confidence, and keep
the floor.

Because think about the failure: a master weaver, 20 days of work, and our app tells her it is
worth ₹900 because the camera was confused. **That is the exact harm this feature exists to
prevent.** We would have built a more efficient middleman.

## 8. "Raw material costs" and "market trends"

The PS asks for both and we have neither as a live signal. Both are free from the government:

- **data.gov.in** publishes daily mandi prices for cotton
- **The government WPI index** publishes monthly trends for cotton yarn and raw silk

Three uses — and note that **her stated cost always wins**:

1. **Catch mistakes.** She says ₹800; the index says the yarn costs ₹2,500. Something is wrong —
   possibly our voice parser reading *"2 हज़ार"* as 2. Ask again. *(That exact bug happened once.)*
2. **Fill the gap when she skips.** The cost question is skippable, and skipping lowers her
   floor. An estimate, clearly marked and spoken as an estimate, beats nothing.
3. **"Market trends," for real.** Cotton up 12% since March → *"yarn has become more expensive,
   your saree could be worth more now."* A genuine, government-sourced trend signal, and a
   reason for her to come back to the app.

## 9. Is any of this legally risky?

No, and we are on the right side of every question — but we should raise it before anyone else
does. India's competition regulator (CCI) published a 2025 study warning that pricing tools
shared across many sellers can behave like a cartel, and that personalised pricing can be
exploitative.

| The concern | Where we stand |
|---|---|
| AI helps sellers fix prices together | Our price comes from **her own costs**, not competitors'. It can only move a price **up** — structurally incapable of coordinating prices downward |
| Different buyers see different prices | We never look at the buyer at all |
| Nobody can understand the algorithm | It is arithmetic. Published, tested, and spoken aloud in her language |

Also: the **World Fair Trade Organization** defines a fair price as *"a fair wage plus a fair
profit, transparently set."* That is our formula. We can cite an international fair-trade
standard for the shape of the maths.

## 10. Our biggest weakness — and it is not AI

Everything rests on one number: **₹120 per hour**. And it is a guess. `research/RESULTS.md`
says so.

| Her time | Our floor | Reality check |
|---|---|---|
| 12 hours | ₹2,576 | ✅ inside real market prices |
| 160 hours (20 days) | ₹23,000 | ❌ above *every* saree we found |

The formula is neither right nor wrong on its own. **It is a multiplier on a number we are not
sure about.**

The fix is not AI, it is homework: every state publishes minimum wages, and several have a
category literally called **"Handloom weaving establishment."** Odisha for Sambalpur, UP for
Varanasi, Gujarat for Bhuj, Karnataka for Channapatna. They are revised every six months, so we
get both a source and an update schedule.

> **One afternoon of this improves our pricing more than a model would.** Do it first.

## 11. What to build, in order

| # | What | Why now | Needs |
|---|---|---|---|
| 1 | Look up real cluster wages from state notifications | Fixes the number everything depends on | Desk research |
| 2 | Measure design density from the photo; correlate against the 144 prices | Photo-derived signal with no training data at all | Nothing new |
| 3 | Be less confident when we have few comparables | Today 4 listings and 40 listings are treated the same. That is wrong | Nothing new |
| 4 | Speak the evidence: *"twelve sarees like yours sell for ₹1,800–₹3,200"* | eBay's best feature, done by voice. Very demo-friendly | Nothing new |
| 5 | Record which listings actually **sold**, not just listed | Not building it now means losing the data forever | A database column |
| 6 | Pull government cotton/silk price data | Two phrases straight out of the PS | Free public API |
| 7 | Train the fabric-recognition model | Real AI, real accuracy — but needs labelled photos | A photo dataset |
| 8 | Photo-similarity search for comparables | The best comparisons we will ever get — useless until the marketplace fills | Listings |

**Items 2, 3 and 4 are the sweet spot.** Days of work each, no new data, each separately
demonstrable, each honest.

## 12. What we should refuse to build

| Rejected | Why |
|---|---|
| An AI that looks at a photo and states a price | Best in world is wrong by 1.5× with 1.4M examples. We would be faking confidence |
| Anything that prices below the floor | The whole point of the feature |
| Letting the camera overrule what she said | One misfire tells a master weaver her work is worth ₹900 |
| Airbnb-style demand prediction | Needs data on what sold and what did not. We have none. "Future work" is stronger than faking it |
| Scraping Amazon/Flipkart | Already rejected in `research/pricing/README.md`, for reasons that have not changed |
| Different prices for different buyers | Straight into the regulator's warning list, zero benefit to the artisan |

## 13. The one-paragraph version

> The problem statement asks for AI that prices from a photograph. Nobody in the world does
> that, because it does not work — even the best model with a million examples only gives a
> rough range. **So we let the AI do what AI is actually good at: recognising what the object
> is.** Then simple, transparent, testable arithmetic turns that into a price, with a floor
> built from her own materials and her own hours that nothing is allowed to cross. Every number
> can be explained out loud, in her language. And the largest improvement available to us is not
> a model at all — it is going and finding out what a weaver's hour is actually worth.

---
---

# PART 2 — The research

## 1. How the industry does price recommendation

Six patterns. What each is, and what to take from it.

### 1.1 Cost-up calculators — Etsy

Etsy's own seller handbook formula:

```
Materials + Labor + Expenses + Profit = Wholesale × 2 = Retail
```

That is `floor_price()` with a 2× retail multiplier. Their shipped tooling is an estimated
earnings calculator in the listing form; their smarter tool, "Optimize Prices," is in beta and
**uses the median of similar items rather than the mean** — the same reason `market_range` trims
tails.

> **Take:** the framing. When asked "why isn't this ML?", the answer is that the largest handmade
> marketplace in the world ships this formula in its own handbook, and its ML tool is a *median
> of comparables*, which is layer two of ours.
>
> Also: Etsy doubles wholesale for retail. `default_margin_pct = 0.15` is far more conservative.
> A real, sourceable argument that our floor is too low — §6.

### 1.2 Sold-comps engines — eBay

The eBay reseller tooling ecosystem converges on one design:

| Mechanism | Detail |
|---|---|
| Basis | **Sold** listings, last 30 days — not active listings |
| Recency weighting | 30-day sales weigh more than 6-month-old sales |
| Condition matching | A same-condition comp is worth 2–3× a different-condition one as signal |
| Lot normalisation | A "$120 lot of 5" is not a $120 single-unit comp — a named source of bad AI pricing |
| Outlier handling | Statistical outlier fencing |
| Confidence | An explicit **data-quality confidence score** shown to the seller |
| Explainability | The seller can **see the exact sold listings** used |
| Control | Review, override, skip, or approve before publishing |

> **Take, by value:**
> 1. **Sold ≠ listed** is caveat #1 in our own `RESULTS.md`, and this whole industry treats it as
>    the difference between a comp and noise. We cannot get sold data from indiahandmade — but we
>    **will** have it from our own marketplace, which makes our marketplace the most valuable
>    pricing data source we will ever have. Split `listed` from `sold` in `comps.fetch("market")`
>    **now**, before there is data; retrofitting means re-collecting.
> 2. **The confidence score.** We compute `sample_size` already. Make it a graded, *spoken*
>    confidence rather than a raw integer.
> 3. **Show the comps.** For a voice-first user who may not read, that is
>    *"बारह ऐसी साड़ियाँ 1800 से 3200 रुपये में बिकती हैं"* — eBay's "see the sold listings",
>    rendered as speech. Same feature.

### 1.3 Rule-based repricers — Amazon Automate Pricing

Free tool. The seller picks a rule ("stay below the Featured Offer price", "stay below the lowest
price") and — critically — **sets a mandatory minimum price and an optional maximum**. The
algorithm moves the price only inside the seller's own bounds. Amazon also states plainly that
automating price does **not** guarantee the Featured Offer, because performance factors matter.

> The strongest external validation of the floor guard. The most aggressive pricing automation in
> retail refuses to price below a floor the seller owns and the algorithm cannot touch.
>
> The difference worth putting on the slide: **Amazon makes the seller supply the floor; we
> compute it for them.** An Amazon seller knows their landed cost. A weaver has never been taught
> to count her own labour. Computing the floor *for* someone who would not have computed it is
> the contribution.

### 1.4 Demand/elasticity models — Airbnb

Smart Pricing / Price Tips: 70+ features, random forest over historical bookings, current market
listings and occupancy, external signals (local events, holidays, flights), elasticity models for
price sensitivity, feedback loops learning from booking outcomes. Hosts still set min/max and can
ignore the tip.

> **Take:** structurally, nothing. Airbnb has millions of transactions with observed outcomes
> (booked / not booked). We have zero. **Elasticity modelling is unreachable and we should say so
> out loud** — it is what separates a real dynamic pricing system from a price *suggestion*
> system, and pretending otherwise is what a sharp judge catches.
>
> What we can take is the vocabulary of honesty: Airbnb calls it a *Price Tip*. Not a price. Our
> equivalent is already in `contracts.md` — `suggested_price`.

### 1.5 Learned regressors — the Mercari Price Suggestion Challenge

The closest academic analogue to the literal PS wording, and the most useful numbers here.

- Task: predict price from **item name + description + category + brand + condition**. ~1.4M rows.
- Winner: ensembles of sparse MLPs over TF-IDF/BoW of concatenated text fields, **RMSLE ≈ 0.387**.
- Findings: merging text fields into one improved feature quality; **keeping stopwords improved
  the score**; n-grams mattered (uni+bi for names, uni+bi+tri for descriptions).
- **The competition used no images at all.**

The arithmetic on that error is what should govern the design:

```
RMSLE 0.387  →  exp(0.387) ≈ 1.47
```

**The best model in the world, on 1.4 million labelled transactions, has a typical multiplicative
error of about ×1.47 — roughly −32% / +47%.** On a ₹2,140 saree that is ₹1,450 to ₹3,150.

> Even a perfect execution of the PS's literal ask produces a range, not a price. So the honest
> output of any price model here is an interval. We have ~144 listings, not 1.4M — any point
> estimate from a learned model would be a confident-looking fiction.
>
> This is the strongest single argument in our defence, and it is quantitative rather than
> philosophical.

### 1.6 Institutional price reasonability — GeM

Directly relevant: `Price.jsx` hardcodes `channel: 'gem'`. GeM's buyer side already runs its own
price-reasonability apparatus — **PriceTrends** (historical transactions for that product on
GeM), **Purchase History** (last 6 months of orders and contracts), and a **Price Comparison**
facility. Buyers certify rate reasonability under **GFR Rule 149**, and reasonableness may be
confirmed by online comparison with leading e-commerce portals.

> **A constraint we do not model.** On GeM an artisan's listing is judged against PriceTrends by a
> government buyer with a statutory duty. A price above the observed GeM band does not merely fail
> to sell — it can fail procurement. `below_floor_warning` handles "the market is under cost";
> there is a symmetric case — "your price is above what GeM buyers have historically paid" — with
> no signal today. A real gap, and a good one to name because it shows we read the channel rules.

### 1.7 The pattern that holds across all six

1. The algorithm outputs a range or a tip, never a mandate.
2. A floor exists and belongs to the seller, not the model.
3. The seller can see the evidence and override.
4. Comparables are the substrate; the model's job is selecting them, not inventing a number.

We already do 1, 2 and 3. **Point 4 is the work.**

## 2. What the ML literature supports for image-based pricing

| Work | Domain | Finding |
|---|---|---|
| *The Price is Right: Predicting Prices with Product Images* | bicycles, cars | Ensemble over image features; visualises which visual features raise/lower price |
| *AI Blue Book: Vehicle Price Prediction using Visual Features* | cars | Visual features work when the image reveals the *identity* of a commodity item |
| *Deep end-to-end learning for price prediction of second-hand items* | C2C resale | CNN + LSTM over image and text |
| *A multimodal deep learning framework… retail price estimation* (2026) | retail | EfficientNetB1 (image) + GloVe/BiLSTM (text) + categorical embeddings, **late fusion** |
| *Social signals predict contemporary art prices better than visual features* (Nature Sci. Rep. 2024) | art | **Social/provenance signals beat visual features**, especially in emerging markets |
| *Optimizing Handloom Price Prediction* (Springer, ICAII 2024) | **handloom** | Decision-tree regression on **size, fabric type, colour, design features**; names **design density, fabric and colour** as why handloom pricing is hard |

Two conclusions, pointing the same way.

**Images work for price when the image identifies a commodity with a known market price.** A
photo of a car tells you it is a 2019 Swift VDI, and 2019 Swift VDIs have a price. That is visual
*identification* followed by lookup — not visual *valuation*.

**For art and craft — where each item is unique — visual features underperform provenance.** The
Nature paper is the sharpest version, and handicraft is much closer to art than to used cars. A
Sambalpuri bandha ikat and a printed powerloom imitation look near-identical in a phone
photograph and differ tenfold in honest price. **What separates them is not in the pixels — it is
labour hours, technique and GI provenance.** Two of the three we capture by voice; the third is an
artisan-registry question.

> **The image cannot tell us what the object is worth. It can tell us what the object is.** And
> "what it is" is exactly what picks the right comparison class — which is where our comps are
> weakest (`RESULTS.md` caveat #2: *"`textiles.saree` is too broad a comparison class"*).

### 2.1 Where the image model is genuinely strong

| System | Task | Reported |
|---|---|---|
| SareeNet | saree texture classification | 98.1% |
| Region-CNN + EfficientNet-B3 + SE attention | saree field-region texture | 99.1% |
| FabricNET + XGBoost | woven texture / weaving parameters | 0.987 |
| HybridWeaveNet | **Banarasi / Bandhani / Patola / Kanjeevaram / Tussar** | Indian handloom heritage fabrics specifically |

That last one is almost exactly our problem, and those five categories differ in price by an
order of magnitude.

**Caveat to carry:** several are trained on clean or microscopic imagery and report accuracies
that will not survive a mid-range Android phone in a courtyard at six in the evening. Treat 98%
as a laboratory upper bound, exactly as `RESULTS.md` already treats web-sourced fixtures.

**But we have an advantage nobody in those papers has: we already segment the product and render
a clean master.** Step 5 gives a background-removed, tone-corrected, cropped image with a cached
alpha mask. Every one of those classifiers is substantially easier on a background-free product
crop. That is a defensible reason our classifier would beat a naive baseline, and it costs
nothing because the pipeline already produces it.

## 3. The proposed approach

### 3.1 The ladder

```
                     ┌──────────────────────────────────────┐
  photo ────────────►│  L1  COMPARISON CLASS RESOLUTION     │  ◄── the ML
  voice description ►│  image + description → class + conf  │      lives HERE
                     └──────────────────┬───────────────────┘
                                        │  category path, material,
                                        │  technique, size, design density
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  L2  COMPARABLES RETRIEVAL           │
                     │  taxonomy walk-up + embedding kNN    │
                     └──────────────────┬───────────────────┘
                                        │  {low, high, n, confidence}
                                        ▼
  material cost ────►┌──────────────────────────────────────┐
  labour hours  ────►│  L0  FLOOR   (already built)         │
  cluster wage  ────►│  (material + hours×wage) × (1+margin)│
                     └──────────────────┬───────────────────┘
                                        ▼
                     ┌──────────────────────────────────────┐
                     │  L3  RECONCILE   price = max(floor,  │
                     │      shrink(mid, n)) + warnings      │
                     └──────────────────┬───────────────────┘
                                        ▼
                          spoken suggestion + spoken evidence
```

`L0` and the reconcile rule are **unchanged**. Everything new sits above them and can only refine
the comparison class or widen/narrow the range. **A total failure of L1 and L2 degrades to
exactly today's behaviour** — price at the floor, honestly, and say so. That is `CLAUDE.md` rule
3 applied to pricing, and it is the property that makes this safe to build.

### 3.2 L1 — what "analyzes the image and description" concretely means

Five signals, ordered by value-to-effort.

**(a) Craft/weave classifier on the segmented master.** Fine-tune a small CNN (EfficientNet-B0/B3
or a ResNet) on our craft taxonomy, running on the already-cached background-removed crop.
Output: taxonomy node + softmax confidence.

**(b) Design density — build this first.** The handloom paper names design density as a primary
price driver, and **we can measure it today with code we already have**: edge density and entropy
inside the alpha mask, on the master image. `ai/enhance/metrics.py` already computes Laplacian
variance; this is the same family of measurement.

> Why first: it needs **no training data, no model, no GPU, no labels**. It is a measurement,
> stdlib+numpy, testable on existing fixtures, and it produces a number we can **correlate against
> the 144 collected prices immediately** to see whether it has any signal. That is a
> `research/pricing/` experiment with a verdict, in the idiom this repo already uses. If it
> correlates, we have an explainable image-derived price feature. If not, we learned it cheaply
> and wrote it up so nobody repeats it.

**(c) Colour family from the mask.** `colour.py` now has real CIELAB. Dominant hue cluster plus
natural-vs-chemical dye character. Natural dye is a price premium and a claim she already makes by
voice — so this is also a cross-check on a claim, not only a feature.

**(d) Size sanity from geometry.** Mask area, aspect ratio and the crop plan give the product's
proportions. No absolute size without a reference object, but a 5.5m saree and a table runner have
very different aspect ratios. Use it to **catch a mis-parsed spoken size** — which matters,
because the parser is the known weak link.

**(e) Description → structured attributes.** `catalog/nlp.py` and `interpret.py` exist, and
`comps.normalize()` is a written-but-unused LLM stub for exactly this. It becomes live the moment
there are unstructured listings to compare against.

**The safety rule tying L1 together, non-negotiable:**

> **Image-derived class may only *narrow* the comparison class when it agrees with the spoken
> description. On disagreement, widen — never override the artisan.**

If she says "Sambalpuri saree" and the classifier says "printed cotton," we do **not** silently
price her as a powerloom product. Fall back to `textiles.saree`, report lower confidence, price
wider. The failure mode of overriding is that a misfiring classifier tells a master weaver her
ikat is worth ₹900 — the exact harm this feature exists to prevent. It is the pricing analogue of
`CLAUDE.md` rule 1.

### 3.3 L2 — comparables retrieval

Two upgrades to `comps.py`.

**Embedding kNN alongside taxonomy walk-up.** Embed the segmented master with CLIP (or
FashionCLIP, documented as beating generic CLIP on product similarity; Walmart ships this
architecture in production). Store embeddings for every marketplace listing, retrieve top-k by
cosine similarity, HNSW-indexed. **Background removal is why this works better for us than for a
generic catalog** — we compare products, not the rooms they were photographed in.

Cold-start reality: this needs marketplace listings. Until they exist, taxonomy walk-up over
`comps_seed.json` is the whole system — which is the correct MVP. Just add the embedding column
now so it backfills.

**Sample-size-aware confidence, replacing the flat midpoint.** Today:

```python
mid = (low + high) / 2
price = round(max(floor, mid))
```

With n=39 sarees spanning ₹750–₹10,999, the midpoint of a trimmed range is a weak statistic. Two
better options:

- **Shrinkage toward the floor as n falls.** With 4 comps, barely move off the floor; with 40,
  lean on the market. One number in `rates.json`, per §6 of `docs/app/Pricing.md` ("if you add
  weighting, make it a number in `rates.json`, not a constant in the code").
- **Conformal prediction** for a distribution-free interval with finite-sample coverage
  guarantees — precisely the tool for "39 samples, need an honest interval." Model-agnostic, no
  distributional assumptions. Split-conformal or conformalized quantile regression. Also a strong
  slide: *"we report an interval with a stated coverage guarantee rather than a point estimate,
  because with this much data a point estimate would be dishonest."*

### 3.4 L4 — "raw material costs" and "current market trends"

The PS names both; we have neither as a live signal. Both are Indian government open data, which
is the best possible provenance for a government PS.

| Source | What | Cadence | Use |
|---|---|---|---|
| **AGMARKNET via data.gov.in** — *current daily price of various commodities from various markets (Mandi)* | Daily min/max/modal mandi prices, documented public API | Daily | Raw cotton and other agri inputs |
| **WPI, eaindustry.nic.in** (2011-12 base; 117 primary articles, 564 manufactured products) | Item-level indices incl. **cotton yarn** and **raw silk** | Monthly, released 14th | The actual "market trend" time series |
| State labour dept. notifications | **"Handloom weaving establishment"** minimum wages exist as a named category (AP, Assam confirmed), by skill level and zone | VDA revision every 6 months, 1 Apr / 1 Oct | Sourcing `rates.json` — §6 |

**The constraint matters more than the integration:**

> **The artisan's stated material cost stays authoritative. The index never replaces it.**

She bought that yarn, at that price, from that shop. An index is a national aggregate. Three
legitimate uses:

1. **Parse-error detection.** She says ₹800 and cotton yarn for a 5.5m saree indexes to
   ₹2,000–₹3,000 → something is wrong, very possibly the `"2 हज़ार"` scale-word class of bug we
   already fixed once. Ask again by voice. This protects the floor's most important input.
2. **Backfill when the question is skipped.** `material_cost` is nullable by design, and a skipped
   answer means a lower floor. An index-derived estimate, **explicitly flagged in `assumed_missing`
   and spoken as an assumption**, beats silence — as long as it is never presented as fact.
3. **Re-pricing stale listings.** Yarn up 12% since she listed in March → *"cotton has become more
   expensive, your saree could be worth more now."* **Literally the PS's "current market trends,"
   implemented as a real published time series** — and a re-engagement feature.

## 4. PS-wording alignment

| PS phrase | Component | Status |
|---|---|---|
| "machine learning algorithm" | L1 craft/weave classifier + L2 embedding retrieval | To build |
| "analyzes the uploaded product image" | Classifier + design density + colour, on the segmented master | Pipeline exists; features to build |
| "and description" | `catalog/nlp.py`, `interpret.py`, `comps.normalize()` | Partly exists |
| "suggest an optimal… price" | `compute.suggest()` | ✅ Built |
| "competitive" | `comps.market_range()` — 144 real listings | ✅ Built |
| "current market trends" | WPI/AGMARKNET time series + seed recollection cadence | To build |
| "raw material costs" | Voice question 6 (authoritative) + index cross-check | ✅ + to build |

Every cell is done or has a concrete implementation. **Nothing in the PS requires an end-to-end
image→₹ regressor, and §1 shows no shipping platform has one.**

## 5. Ethics and defensibility

The CCI's **2025 Market Study on Artificial Intelligence and Competition** flagged algorithmic
cartelisation, self-preferencing and algorithmic price discrimination; the CCI chief has publicly
warned about AI-driven collusion. Commentary calls for algorithmic audits and disclosure for firms
using **shared or third-party pricing tools**, noting hub-and-spoke risk.

**A shared price recommender used by many sellers is, structurally, a hub.** Raise it before
anyone else does. We are in a good position on every count:

| Risk | Our position |
|---|---|
| Algorithmic collusion | Recommends from the **seller's own costs**, not competitors' prices. `max(floor, mid)` means the market can only move a price **up** — structurally incapable of coordinating prices downward |
| Personalised / discriminatory pricing | Per-artisan, cost-derived, **buyer-blind**. No device, location or browsing signal enters the price |
| Opacity | Arithmetic, published, spoken aloud in her language, with a full breakdown. Passes *"how did you get that?"* |
| Auditability | Deterministic, stdlib-only, unit-tested, numbers traceable to `rates.json` |

Positively: **WFTO's Fair Payment framing maps onto our floor almost word for word** — a Fair
Price is *transparently set* and includes *a fair wage and a fair profit*, aiming at a **local
living wage**. That is `material + hours×wage + margin`. We can cite an international fair-trade
standard for the structure of the formula.

## 6. The highest-value fix, which is not ML

`research/RESULTS.md` says it plainly: **`default_wage_per_hour = 120` is unsourced, and it is the
denominator of every number in the feature.** The verdict flips from "inside the spread" to "above
the entire market" on that input and on `labour_hours`.

No amount of image ML improves that. It is cheaply fixable:

- **State minimum wage notifications carry a named "Handloom weaving establishment" category**, by
  skill level and zone (Andhra Pradesh, Assam confirmed). Sambalpur → Odisha; Varanasi → UP;
  Bhuj → Gujarat; Channapatna → Karnataka.
- Revised via **VDA every six months, effective 1 April and 1 October** — so `rates.json` gets a
  *source* and a *refresh cadence* instead of four chosen numbers.
- The `_comment` in `rates.json` already claims *"Sourced per cluster, not guessed."* This makes
  that sentence true.

Second: **Etsy tells its own artisans to double wholesale for retail; `default_margin_pct` is
0.15.** Worth revisiting with evidence — it is the one lever that moves the floor for every
artisan at once, and we have no source for the number in either direction.

> Both are field/sourcing work, not code, and would move accuracy more than a weave classifier
> would. Sequence them first.

## 7. Suggested build order

| # | Thing | Why here | Data needed |
|---|---|---|---|
| 1 | Source cluster wages from state notifications; source or defend the 15% margin | Moves every number; the current weak link | None — desk research |
| 2 | **Design density** on the existing mask; correlate against the 144 collected prices | Image-derived price signal with **zero** training data or GPU | Already have both |
| 3 | Sample-size-aware confidence: shrinkage toward floor, then conformal intervals | Fixes a real weakness (flat midpoint on n=39) | Already have |
| 4 | Spoken comparables evidence — *"twelve like yours sell between X and Y"* | eBay's "see the comps," for a voice-first user. Very demo-visible | Already have |
| 5 | `listed` vs `sold` split in the marketplace comps schema | Retrofitting later means re-collecting | Schema only |
| 6 | WPI / AGMARKNET raw-material index: parse-error detection + trend | Two literal PS phrases, from government open data | Public APIs |
| 7 | Weave/craft classifier on the segmented master | Real ML, real ceiling — plus the narrow-only-on-agreement rule | Labelled craft images |
| 8 | CLIP/FashionCLIP embedding kNN over marketplace listings | The best comparables we will get — but cold-start empty | Marketplace listings |

Items 2, 3 and 4 are the ones to push hardest: days of work, no new data, each independently
demonstrable, each honest.

## 8. Rejected — do not propose these

| Rejected | Why |
|---|---|
| End-to-end image → ₹ regressor | Best-in-world with 1.4M rows is ×1.47 typical error. We have 144 listings. Confident number, no defensible provenance, fails *"how did you get that?"* |
| Letting the model price **below** the floor | The entire ethical core. `max(floor, mid)` is not negotiable |
| Image classifier **overriding** the spoken description | A misfire tells a master weaver her ikat is worth ₹900. Narrow on agreement, widen on disagreement |
| Demand/elasticity modelling (Airbnb-style) | Requires observed booked/not-booked outcomes. We have zero. Naming it as future work is stronger than faking it |
| Scraping Amazon/Flipkart/GeM for live comps | Already rejected in `research/pricing/README.md`; nothing has changed |
| Per-buyer or personalised pricing | Straight into the CCI's flagged concerns, for no artisan benefit |

## 9. Open questions

1. **Do we have, or can we get, labelled craft images?** Item 7 depends entirely on this.
   `images/` is calibration fixtures for thresholds, not a labelled craft corpus.
2. **Does design density correlate with price on the 144?** Genuinely unknown, cheap to find out,
   and a negative result is still a `RESULTS.md` row.
3. **Is `mid` even the right statistic**, or should the target be a percentile reflecting where an
   *honest handmade* item sits within a range polluted by powerloom imitations? The ₹750
   "Sambalpuri" in our data is real market context but a bad price target.
4. **Does the GeM buyer-side reasonability ceiling need a warning symmetric to
   `below_floor_warning`?**
5. **Where does this run?** `ai/price/` is deliberately stdlib-only and `compute.py` imports
   nothing but `json` and `pathlib`. A CNN or CLIP breaks that property. Likely answer: keep
   `compute.py` pure, put L1/L2 behind the enhance service's existing model infrastructure, and
   let the price path degrade to today's behaviour when unavailable — but that is a real
   architecture decision to make deliberately, not by accident.

---
---

# PART 3 — Sources

Collected 2026-08-31. Every claim in Parts 1 and 2 traces to one of these.

**Cost-up calculators**
- Etsy — The Ultimate Guide to Pricing (Seller Handbook): https://www.etsy.com/seller-handbook/article/745293633907
- Etsy price optimization tool guide: https://ecomclips.com/blog/ultimate-guide-to-use-etsy-price-optimization-tool/
- Craftybase — how to price on Etsy: https://craftybase.com/blog/how-to-price-on-etsy

**Sold comps**
- FlowLister — how to price items for eBay (data-driven method): https://flowlister.com/blog/how-to-price-items-for-ebay/
- FlowLister — eBay sold comps tools: https://flowlister.com/blog/ebay-sold-comps-tools/
- 3Dsellers — AI price suggestions & price analytics: https://help.3dsellers.com/en/articles/12864553-ai-price-suggestions-price-analytics

**Rule-based repricing**
- Amazon — Automate Pricing: https://sell.amazon.com/tools/automate-pricing
- Amazon — what are Automate Pricing rules: https://sell.amazon.com/blog/automate-pricing-rules

**Demand models**
- Airbnb Tech Blog — Learning Market Dynamics for Optimal Pricing: https://medium.com/airbnb-engineering/learning-market-dynamics-for-optimal-pricing-97cffbcc53e3
- How Airbnb uses ML for dynamic pricing: https://hw.glich.co/p/how-airbnb-uses-machine-learning-for-dynamic-pricing

**Learned price regressors — the ×1.47 number**
- Kaggle — Mercari Price Suggestion Challenge: https://www.kaggle.com/competitions/mercari-price-suggestion-challenge
- Mercari Engineering — competition report: https://engineering.mercari.com/en/blog/entry/2018-11-14-172509/
- 1st place solution talk (Jankiewicz & Lopuhin): https://www.youtube.com/watch?v=QFR0IHbzA30
- aerdem4 solution repository: https://github.com/aerdem4/mercari-price-suggestion

**GeM**
- GeM user FAQs — PriceTrends, purchase history, price comparison: https://gem.gov.in/userFaqs
- GeM procurement guidelines incl. GFR Rule 149: https://rdwu.ac.in/Pdf/R_and_D/POLICY/Guide-line-on-GeM-SU.pdf

**Image-based price prediction**
- Multimodal deep learning for retail price estimation (ScienceDirect, 2026): https://www.sciencedirect.com/science/article/pii/S2590005625001924
- Deep end-to-end learning for second-hand item prices (Springer): https://link.springer.com/article/10.1007/s10115-020-01495-8
- AI Blue Book: vehicle price prediction using visual features: https://arxiv.org/pdf/1803.11227
- The Price is Right: predicting prices with product images: https://www.researchgate.net/publication/324150897_The_Price_is_Right_Predicting_Prices_with_Product_Images
- Social signals predict contemporary art prices better than visual features (Nature Sci. Rep. 2024): https://www.nature.com/articles/s41598-024-60957-z
- Optimizing Handloom Price Prediction (Springer, ICAII 2024): https://link.springer.com/chapter/10.1007/978-3-032-06198-0_7

**Fabric and weave classification**
- SareeNet — saree texture classification: https://journals.pan.pl/Content/130178/PDF/OPELRE_2024_32_1_K_Ashok.pdf?handler=pdf
- HybridWeaveNet — Indian handloom heritage fabrics (Frontiers in AI): https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2026.1809586/full
- FabricNET dataset: https://www.researchgate.net/publication/374940316_FabricNET_A_Microscopic_Image_Dataset_of_Woven_Fabrics_for_Predicting_Texture_and_Weaving_Parameters_through_Machine_Learning

**Visual comparables retrieval**
- Extending CLIP for category-to-image retrieval in e-commerce: https://arxiv.org/pdf/2112.11294
- FashionCLIP vs CLIP for product similarity: https://www.width.ai/post/product-similarity-search-with-fashion-clip
- VL-CLIP (Walmart production deployment): https://arxiv.org/pdf/2507.17080

**Honest intervals on small samples**
- Conformalized Quantile Regression (NeurIPS): https://papers.neurips.cc/paper/8613-conformalized-quantile-regression.pdf
- Reliable statistical guarantees for conformal predictors with small datasets: https://arxiv.org/html/2512.04566

**Indian government open data — raw material costs and trends**
- data.gov.in — daily mandi commodity prices (AGMARKNET): https://www.data.gov.in/catalog/current-daily-price-various-commodities-various-markets-mandi
- data.gov.in — Wholesale Price Index: https://www.data.gov.in/catalog/wholesale-price-index-1
- PIB — WPI index numbers, 2011-12 base: https://www.pib.gov.in/PressReleseDetailm.aspx?PRID=1591541&reg=48&lang=2

**Wage rates — the denominator of every number in this feature**
- WageIndicator — AP handloom (silk) weaving establishments minimum wage: https://wageindicator.org/salary/minimum-wage/india/13970-andhra-pradesh/35388-handloom-silk-weaving-establishments
- Paycheck.in — Assam handloom weaving establishment: https://paycheck.in/salary/minimumwages/14054-assam/14295-handloom-weaving-establishment
- State-wise minimum wages 2025–26: http://complicoreadvisory.com/repertory/minimum-wages.html

**Fair pricing standards**
- WFTO — 10 Principles of Fair Trade: https://wfto.com/our-fair-trade-system/our-10-principles-of-fair-trade/
- WFTO Fair Payment Process report: https://wfto-europe.org/wp-content/uploads/2019/07/Implementing_SDG8_through_the_WFTO_Fair_Payment_Process_full_report.pdf

**Regulation**
- MediaNama — CCI chief warns of AI-powered collusion and algorithmic price discrimination (2025): https://www.medianama.com/2025/03/223-ai-powered-collusion-cci-chief-warns-of-algorithmic-discrimination-in-pricing/
- Invisible cartels in digital markets: https://www.cictl.in/post/invisible-cartels-in-digital-markets-algorithmic-pricing-and-the-limits-of-competition-law
- Algorithmic collusion of pricing and advertising on e-commerce platforms: https://arxiv.org/pdf/2508.08325
