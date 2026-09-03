# F3 needs a real dataset — the scraping plan

**Date:** 2026-09-03 · **Feature:** PS 26090 F3, Dynamic Pricing Assistant
**Owner of F3:** Prashant · **This document:** the plan, and who does which half
**Reads:** `research/pricing/README.md`, `research/RESULTS.md` (pricing), `docs/Abhay/PRICING-ML-RESEARCH.md`

---

## Why

F3 is built and it works. The verdict on 144 listings is real and it is on the slide. What it
cannot do yet is the PS's literal first clause — *"a machine learning algorithm"* — because
144 rows split across five categories (n = 39, 48, 30, 18, 9) is not a training set.

The plan is to collect **2,000+ rows** and train a model on them. Two things about that,
before any code:

**1. The model is not the headline. The floor is.** At the median listed price of ₹2,140,
minus ₹800 of materials, a 20-day saree implies **₹8/hour**. A model trained on those prices
predicts that wage accurately. `max(floor, market)` stays exactly as it is, and the model
refines the *market* half only — it can widen or narrow the range, never move the floor.

**2. The row count is the second most important axis.** The first is **label resolution.**
`research/pricing/README.md` already says it:

> *"More is still welcome — especially weave-specific keys (`textiles.saree.sambalpuri` rather
> than `textiles.saree`), which is the biggest weakness in the current set."*

2,000 rows labelled at the weave level beats 5,000 labelled "saree", for the model *and* for
the comparables. A plain Santipuri and a Sambalpuri bandha ikat are both "handloom cotton
saree" and differ perhaps tenfold in labour. Until that is fixed, more rows just make the
model more confident about a mixture it cannot separate.

---

## The tool: Scrapling

`github.com/d4vinci/Scrapling`. Chosen because it answers two of the three objections
`research/pricing/README.md` raised against scraping in the first place:

| The old objection | What Scrapling does |
|---|---|
| *"breaks the week somebody renames a CSS class"* | `adaptive=True` element tracking — records where an element lived, relocates it when the markup shifts |
| *"gets the demo laptop IP-blocked halfway through a presentation"* | checkpoints, rate limiting, `respect_robots_txt`, and a response cache so nothing is ever fetched twice |
| *"against Amazon's and Flipkart's terms"* | **stands.** The plan below does not touch either |

```bash
cd ai && .venv/bin/pip install "scrapling[fetchers]"
.venv/bin/scrapling install
```

---

## Sources

### Scrape these

| # | Site | Why it is on the list |
|---|---|---|
| 1 | **indiahandmade.com** | Ministry of Textiles' own D2C marketplace. Where the 144 came from, so new rows stay compatible. Best provenance we can get |
| 2 | **tribesindia.com** | TRIFED, Ministry of Tribal Affairs. Strong craft and region labelling |
| 3 | **gocoop.com** | Weaver co-operatives — usually names the co-op and the cluster, which is the region signal we are missing |
| 4 | **itokri.com** | The volume source. Titles unusually rich in technique and region ("Ajrakh hand block printed", "Bagru") |
| 5 | **okhai.org** | Well-structured product data |
| 6 | **jaypore.com** | Curated craft, good on materials |

Strictly in that order. 1–3 are the defensible base; only reach for 4 once they are exhausted.
Check each site's `robots.txt` before pointing anything at it.

### Do not scrape these

**Amazon, Flipkart, Amazon Karigar, Flipkart Samarth.** Their public APIs are *seller* APIs —
they authenticate as one shop and return that shop's listings. There is no open "what does a
cotton saree go for" endpoint, our artisans have no seller account to authenticate with, and
scraping the search pages is against terms and gets the IP blocked.

**GeM.** Not because of access — because it is **a different market**. GeM is B2G procurement:
a department buying 200 units on a rate contract is not a consumer buying one saree, and the
price formation is not comparable. Merging those rows into a D2C model gives a blend that
represents neither market.

GeM still matters to F3 in two other places — as the channel ceiling `mrp_for_channel()`
already handles, and as a possible buyer-side reasonability warning (open question #4 in
`PRICING-ML-RESEARCH.md`). If GeM rate-contract prices are ever collected by hand, they get
tagged `market_type: institutional` and stay out of the model.

**Etsy.** Has a real public API, but the prices are USD and a different market. Useful for
craft vocabulary, never as a price target. Do not mix those rows in.

### Pull these, but not for prices

| Source | What for |
|---|---|
| **GI Registry** — `search.ipindia.gov.in` | The canonical craft-name → region mapping. Sambalpuri Bandha, Pochampally Ikat, Bagru, Ajrakh, Bidriware. **This is the taxonomy** that makes `category_l3_weave` possible, and it is a government source, so the taxonomy itself is defensible |
| **AGMARKNET / WPI** — `agmarknet.gov.in`, `eaindustry.nic.in` | Cotton, silk and bamboo commodity prices over time. The honest answer to the PS phrases *"raw material costs"* and *"current market trends"*, and the only part of F3 that can legitimately be called **dynamic** |

---

## The schema

Every field below either has a stated mechanism or is provenance. Anything that could not
answer *"what is the mechanism, in one sentence?"* was cut, and the cuts are recorded at the
bottom so nobody adds them back.

### Provenance — stored, never a feature

| Field | Notes |
|---|---|
| `row_id` | hash of url |
| `source` | indiahandmade / tribesindia / gocoop / itokri / okhai / jaypore |
| `url` | **required** — `pricing.py` refuses rows without it |
| `seen_on` | **required** — the date you looked |
| `scrape_run_id` | so a bad run can be dropped wholesale |
| `raw_title`, `raw_description` | keep verbatim; these get re-parsed more than once |

### Target

| Field | Notes |
|---|---|
| `price` | int, ₹. **The selling price, not the struck-through MRP** |
| `mrp` | nullable, kept separately |
| `discount_pct` | derived |

> **Train on `log(price)`.** The observed spread runs ₹250 → ₹100,000. A raw-rupee target lets
> a handful of ₹40,000 sarees dominate the loss and wreck accuracy under ₹3,000, which is where
> almost every artisan sits.

### Categorical

| Field | Example |
|---|---|
| `category_l1` | textiles / pottery / metalwork / painting / basketry |
| `category_l2` | saree / dhurrie / dupatta / madhubani |
| **`category_l3_weave`** | **sambalpuri / pochampally / bagru / ajrakh** — the highest-value column in the table |
| `material` | cotton / silk / tussar / bamboo / brass / terracotta |
| `material_secondary` | zari / silver thread — nullable |
| `technique` | handwoven / block-print / ikat / embroidery / dhokra cast |
| `gi_tagged` | bool, from the GI registry match |
| `region_state` | Odisha |
| `region_cluster` | Sambalpur — nullable, but gold when present |
| `seller_type` | cooperative / individual / brand / NGO |
| `market_type` | `d2c_retail` for every scraped row. The GeM guard |

### Numeric

| Field | Notes |
|---|---|
| `size_value` + `size_unit` | 6.3 m / 12×18 in / 30 cm |
| `weight_g` | nullable |
| `thread_count` | textiles only, when listed |

### Image-derived — computed here, not scraped

| Field | The mechanism |
|---|---|
| `design_density` | More motifs packed into the cloth = more days at the loom = more value. A handloom pricing paper finds this is the biggest single driver |
| `colour_count` | Each additional colour is another yarn change and another dye stage. **Untested** — may turn out to be a weaker `design_density` |

### Not in this dataset

`material_cost`, `labour_hours`, `cluster_wage`, `quantity`, `artisan_location`.

**A marketplace listing says what a thing sells for, never what it cost to make.** These arrive
from the artisan at inference time and feed `floor_price()`. The model never sees them — which
is exactly the `max(floor, market)` split, but it means the training script and the pricing
call have different feature vectors, and that is worth knowing before either is written.

### Cut, and why — do not add these back

| Cut | Why |
|---|---|
| `mask_area_fraction` | A property of how the photo was taken, not of the product. Risks teaching the model *"photographed close = expensive"*, which would penalise an artisan for stepping back |
| `edge_density` | This is *how* `design_density` is computed. Two near-identical columns split feature importance and make both look weak |
| `motif_repeat_period` | Mechanism is ambiguous — a tight repeat means either a loom-programmed pattern (cheap) or hand-tying (expensive). Points both ways |
| `image_count` | No mechanism |
| `price_per_metre` **as a feature** | **Target leakage.** `price_per_metre × size = price`. Beautiful validation score, model that knows nothing. Keep it as an analysis column, or use `log(price_per_metre)` as an alternative target — never as an input alongside `size_value` |
| `has_gi_term_in_title` | The same information as `gi_tagged` and `category_l3_weave`, a third time |
| `days_since_seen` | Near-constant within a run. Still a useful *field* for the 180-day staleness warning, just not a feature |

---

## Two outputs, one crawl

**Do not break what already works.**

**`observed.csv`** — the exact five-column contract `pricing.py` already consumes:

```csv
category,source,price,url_or_note,seen_on
```

`python3 research/pricing/pricing.py build` turns it into `ai/price/comps_seed.json`. The
existing 144 rows stay valid and simply get joined by thousands more.

**`listings.jsonl`** — the rich ML dataset, full schema above, one JSON object per line,
including `image_urls`.

That second file also answers open question #1 in `PRICING-ML-RESEARCH.md` — *"do we have, or
can we get, labelled craft images?"* One crawl gives an image and a price label on the same
row.

---

# Who does what

## Prashant — the scrape (F3 is your feature)

**Lands in `research/pricing/scrape/`:**

```
sites/          one config module per site — selectors only
spider.py       the shared Scrapling Spider
probe.py        phase-1 selector discovery
normalise.py    raw rows → schema
cache/          Scrapling response cache (gitignore)
out/            listings.jsonl, observed.csv (gitignore)
```

### Phase 1 — probe first. Do not skip this.

One product page per site, by hand, before writing any spider:

```python
from scrapling.fetchers import Fetcher

page = Fetcher.get("https://www.indiahandmade.com/<a-product-url>")
print(page.css('h1::text').get())
print(page.css('[class*=price]::text').getall())
```

Three questions per site, written down:

1. Is the **price** in the HTML, or injected by JS? → `Fetcher` vs `DynamicFetcher`
2. Is the **craft technique** recoverable — spec table, title, or description?
3. Does the listing carry a **region**?

**A site that cannot give technique or region cannot give weave-level labels.** Downgrade it to
volume-only and tag it, rather than discovering that after 3,000 rows.

### Phase 2 — the spider

Settings that are not optional:

- `download_delay = 2.5`, `concurrent_requests = 2`. This is a few nights of collecting, not
  ten minutes. Politeness is what keeps the IP unblocked.
- `respect_robots_txt = True`.
- `adaptive=True, auto_save=True` on the selectors.
- **Dev-mode response caching on.** Re-parse from `cache/` freely. Refetching 3,000 pages
  because a regex changed is how people get banned.
- Checkpoints, so an interrupted crawl resumes rather than restarts.

### Phase 3 — normalise. This is the real work.

The scrape is the easy half.

- **Price** → integer rupees, selling price, MRP kept separately.
- **Category** → match titles against the **GI registry list** so `textiles.saree.sambalpuri`
  beats `textiles.saree`. This mapping is the single highest-value part of the whole exercise.
- **Material / technique** → controlled vocabulary. No free text through to the model.
- **Drop** genuine miscategorisations — a silk lehenga filed under sarees is not a comparable at
  any price. Log what was dropped and why.
- **Keep the cheap ones.** A ₹900 powerloom saree sold as "Sambalpuri" is not noise — it is the
  market our artisans are actually compared against, and it is the case `below_floor_warning`
  exists to catch. Filtering for "fair" prices is how a dataset quietly becomes an argument.
- **Dedupe** on url, and on `(normalised_title, price)` across sites.

Then:

```bash
python3 research/pricing/pricing.py build --collector "prashant (scrapling)"
python3 research/pricing/pricing.py check --material-cost 800 --labour-hours 160
```

and record the outcome in `research/RESULTS.md` **with the date**. A verdict without a date is
not a verdict.

### Suggested sequence

| Day | Work |
|---|---|
| 0 | Install, probe all six sites (~30 min). Write down which have technique + region |
| 1 | `indiahandmade` end to end. **Stop at 200 rows and read them by hand** |
| 2 | `tribesindia` + `gocoop`. Tier-1 base complete |
| 3 | `itokri` for volume. Dedupe across all four |
| 4 | GI-registry category mapping, then `build` + `check`, logged to RESULTS.md |

**The hand-read at 200 rows is the checkpoint that saves the week.**

---

## Abhay — the image-derived half

Blocked on `listings.jsonl` existing with `image_urls`. Until then, nothing to do here.

1. **`design_density` on the existing mask.** The segmentation from step 5 already produces the
   cut-out shape; this measures edge/high-frequency energy inside it, normalised by mask area.
   No training data, no labels, no GPU.
2. **`colour_count`** — cluster in LAB space, count clusters holding a meaningful share of the
   pixels. Not raw distinct RGB values, which give thousands on any photograph.
3. **Correlate both against the collected prices.** Does busier cloth actually sell for more?
   Yes → a real, explainable, photo-derived price signal. No → a `RESULTS.md` row, learned
   cheaply, and nobody repeats it.
4. Feed the result back as two columns on `listings.jsonl`.

---

## Non-negotiables, for both of us

1. **`url` and `seen_on` on every row.** `pricing.py` already refuses rows without them, and
   that rule is the entire difference between research and a number somebody felt was about
   right.
2. **Never invent a number in `research/pricing/`.** A plausible-looking guess is *worse than an
   empty file* — an empty file prices honestly on cost alone and the app says so.
3. **Tag every row with its source**, and keep it as a feature. If the model behaves differently
   on iTokri rows than indiahandmade rows, that is a finding we would otherwise never see.
4. **Commit the code and the derived seed. Never the raw HTML, the CSV, or the images.**
5. **Never run the scrape live in a demo.** Ship the built JSON.

---

## What we say about the model when it exists

Train it, then **cross-validate it and report its error honestly.**

Mercari ran a public competition on **1.4 million** items with real sold prices. The winning
model was typically wrong by about **1.5×**. If ours lands near 1.4× on 2,000 listed prices,
that number is not an embarrassment — it is the measurement that *justifies* showing a range:

> *"We trained a gradient-boosted model on 2,000 real listings. Its typical error is 1.4×. That
> is why we show a range and not a number — and here is the measurement."*

A team that says "our model predicts ₹1,780" gets asked how accurate it is and has nothing.
That is the difference between a claim and evidence.
