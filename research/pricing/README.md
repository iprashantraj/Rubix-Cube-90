# research/pricing/

> **Status 2026-09-03: 50,000 listings collected, 45,652 in the training set.** From
> goswadeshi, itokri and indiahandmade, by the scrapers in [`scrape/`](scrape/); the columns
> are documented in [`scrape/DATASET.md`](scrape/DATASET.md). 27,180 rows carry the
> weave-specific key this README asked for, and the verdict in [`../RESULTS.md`](../RESULTS.md)
> changed because of them. **No more collection is needed** — see "How many", below.

Two open questions, one dataset answers both:

1. **What does the market actually charge?** — feeds `ai/price/comps_seed.json`, which is the
   only comparables source we have for GeM, Amazon and Flipkart.
2. **Does our cost-up floor land near real prices?** — the `pricing` row in
   [`../RESULTS.md`](../RESULTS.md), first verdict recorded 2026-08-28.

The code for both is written, and there is now a first dataset behind it. **Nothing here can
be written by anyone who is not looking at real listings** — that rule does not relax now that
the file is non-empty.

---

## 🔴 The one rule

> **Never invent a number in this folder.**

Every price here ends up in front of an artisan deciding what to charge, and in the evidence
we use to claim our floor is calibrated. A plausible-looking guess is *worse than an empty
file*: an empty file prices honestly on cost alone and the app says so, a guess does not.

This is also why `pricing.py` refuses rows with no `seen_on` date and no `url_or_note`.
Provenance is the entire difference between research and a number somebody felt was about
right.

---

## Why by hand — and what changed on 2026-09-03

**The section below was written before the scrapers existed, and it argued against them. Two
of its three objections were answered; one still stands and always will.**

| The objection | What happened |
|---|---|
| *"breaks the week somebody renames a CSS class"* | Three of the six sites turned out to publish `/products.json` — structured data with no selectors to break. The two that need HTML are cached, so a parser change costs no requests |
| *"gets the demo laptop IP-blocked halfway through a presentation"* | Per-site delays honouring each `robots.txt` (10s for itokri, which asks for it), full response caching, and the seed is built ahead of time. **Nothing is ever scraped live in a demo** |
| *"against Amazon's and Flipkart's terms"* | **Stands, unchanged.** Nothing here has ever touched either, and nothing should |

What did not change is the rule below it: every number still comes off a real listing with a
URL and a date. The scrapers read the same public pages a person would, and store what the
page said rather than an interpretation of it.

The hand-collected 144 are still in `observed.csv`, still valid, and simply joined by the rest.
And the habit they came from is what makes the scraped set trustworthy: the first 200 scraped
rows were read one by one before anything else was collected, which is how 33 category pages
masquerading as products — each carrying a real, plausible price — were caught. See
[`scrape/HANDREAD-200.md`](scrape/HANDREAD-200.md).

## The original argument, for the record

| Source | Why there is no API |
|---|---|
| **GeM** | No seller or catalogue API of any kind. Rate contracts are published as documents |
| **Amazon / Flipkart** | *Seller* APIs. They authenticate as one shop and return that shop's own listings. There is no open "what does a cotton saree go for" endpoint — and our artisans have no seller account to authenticate with in the first place |
| **indiahandmade** | Public catalogue, browsable without an account. Best provenance of any source, and the only one that states a region as a field — but only 403 rows of the current set, because that field was the reason to collect it and 94 rows were enough to check the taxonomy |
| **goswadeshi, itokri** | Open `/products.json`. 45,249 of the 45,652 rows. goswadeshi is GoCoop under its new name |

### Prefer indiahandmade.com

The Ministry of Textiles' own D2C marketplace for verified weavers and GI-tagged products.
Same artisans, same crafts, same handmade claim — so it is a genuine comparison class rather
than an approximate one, and on a government problem statement nobody has to be persuaded of
that. It is also the only one of the four you can browse without a seller account.

A scraper against their search pages is against both sites' terms, breaks the week somebody
renames a CSS class, and gets the demo laptop IP-blocked halfway through a presentation. An
afternoon of browsing produces better data with none of that risk, and it is defensible in
the room: *"a dated sample of real listings"* is a true sentence.

Our own marketplace is different — it is our database, queried live over
`/api/shop/products`, and needs nothing from this folder.

---

## Collecting

Create `observed.csv` here (gitignored — the seed file is what gets committed):

```csv
category,source,price,url_or_note,seen_on
textiles.saree.sambalpuri,amazon,3499,https://…,2026-08-28
textiles.saree.sambalpuri,amazon,2850,https://…,2026-08-28
textiles.saree,flipkart,1299,https://… (printed powerloom — kept deliberately),2026-08-28
handicraft.dhokra,gem,2100,GeM rate contract RC/2026/…,2026-08-28
```

### How many

> **2026-09-03: this target is met and exceeded, and more collection is not useful.** 274
> categories hold 10 or more prices and 61 are at the seed's 200-price cap. `comps.py` shows an
> artisan a couple of dozen comparables, so 22,445 of the rows collected can never reach a
> screen. The remaining thin categories are thin because those crafts are rare, and scraping
> more of the same shops will not find them.

**At least 10 per category**, ideally 20–30. Below 10 the trim in `comps.market_range` can
only drop one price from each end, and below 4 it drops none — a thin sample is a wide range,
and a wide range moves the suggestion a long way. `sample_size` is reported to the app for
exactly this reason, and `pricing.py` flags any category under 10.

### What to record

- **Category** from our own taxonomy (`textiles.saree.sambalpuri`). Prefer the specific path;
  the loader walks up to `textiles.saree` then `textiles` when the narrow key is absent, so a
  broad key is useful immediately and a narrow one takes precedence the day it is added.
- **Price actually charged** — the selling price, not the struck-through MRP.
- **`url_or_note`** — a link, or for GeM the rate-contract reference. This is what makes it
  checkable by somebody else.
- **`seen_on`** — the date you looked. Prices move; the seed goes stale at 180 days and
  `comps.py` starts warning in the logs.

### What to keep and what to drop

**Keep the cheap ones.** A ₹900 powerloom saree sold as "Sambalpuri" is not noise — it is the
market our artisans are actually being compared against, and it is the case
`below_floor_warning` exists to catch. Dropping it would flatter our numbers.

**Drop genuine miscategorisations** — a silk lehenga filed under sarees is not a comparable at
any price. Note the ones you dropped and why, in your commit message.

Do not filter for "fair" prices. The trim handles outliers, and pre-filtering is how a dataset
quietly becomes an argument.

---

## Then

```bash
python3 research/pricing/pricing.py build --collector "your name"
python3 research/pricing/pricing.py check --material-cost 800 --labour-hours 160
```

`build` writes `ai/price/comps_seed.json`, which `comps.fetch()` reads for the three sources
with no API. **Commit the seed, not the CSV.**

`check` is the experiment. It prints, per category, whether our floor sits inside the observed
spread, above all of it, or below it:

| Outcome | What it means | What to do |
|---|---|---|
| **Floor inside the spread** | The model is calibrated | Say so on the slide, with the number |
| **Floor above everything** | Either our wage rate is too high, or **the market genuinely pays below what these things cost to make** | Check the wage rate first. If it holds, this is the finding the whole feature exists to expose — and a better slide than a working algorithm |
| **Floor below everything** | We are under-protecting and leaving money on the table | Revisit `default_margin_pct` and the cluster wage in `ai/price/rates.json` |

Record the outcome in [`../RESULTS.md`](../RESULTS.md) **with the date**. A verdict without a
date is not a verdict.

---

## Where the numbers you are validating come from

`ai/price/rates.json` — cluster wage rates and the 15% margin. The wage rates are a **field
question, not a config default**: an unsourced cluster silently gets ₹120/hour, and if that is
too low the artisan's floor is too low, which is the one direction we cannot afford to be
wrong in. Full formula and worked example: [`../../docs/app/Pricing.md`](../../docs/app/Pricing.md).
