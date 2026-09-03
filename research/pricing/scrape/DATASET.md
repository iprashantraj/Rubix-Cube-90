# The F3 pricing dataset

**Built:** 2026-09-03 · **Rows:** 45,652 · **Columns:** 27 · **Files:** `out/model.csv`, `out/model.jsonl`

One row is one product that was on sale on the day we looked, with its asking price and what
the shop said about it. Rebuild both files with:

```bash
python3 research/pricing/scrape/normalise.py --model
```

`out/` is gitignored — the data is not in the repository, only the code that produces it.

## Where it came from

| Source | Rows | What it is |
|---|---|---|
| `goswadeshi` | 23,415 | Weaver co-operatives. GoCoop under its new name, after the domain moved |
| `itokri` | 21,834 | Craft retailer, unusually precise about naming the craft process |
| `indiahandmade` | 403 | The Ministry of Textiles' own marketplace |

All three publish their catalogues openly and were collected within their `robots.txt` rules —
itokri at the 10-second crawl delay it asks for. Amazon and Flipkart are deliberately absent
(seller-only APIs, and scraping them is against their terms); GeM is absent because government
procurement is a different market, not because it is hard to reach. `PROBE.md` has the detail.

## The columns

### The target

| Column | Meaning | Filled |
|---|---|---|
| `price` | asking price in rupees, integer | 100% |
| `mrp` | the struck-through price, where the shop shows one | 25% |
| `discount_pct` | derived from the two | 25% |

**Train on `log(price)`.** The range is ₹60 to ₹275,000; on raw rupees a handful of ₹40,000
sarees dominate the loss and wreck accuracy under ₹3,000, where nearly every artisan sits.

### What the product is

| Column | Meaning | Filled |
|---|---|---|
| `category_l1` | textiles, painting, jewellery, pottery, accessories… | 100% |
| `category_l2` | saree, dupatta, kurta, stole, bag… | 100% |
| `category_l3_weave` | **sambalpuri, pochampally, jamdani, bomkai** | 59% |
| `category` | the three joined: `textiles.saree.sambalpuri` | 100% |
| `weave_label_source` | `title` if the seller named the craft, `tags` if we inferred it | 59% |
| `material` | cotton, silk, tussar, wool, bamboo — controlled vocabulary | 95% |
| `technique` | handloom, block-print, ikat, embroidery, tie-dye | 78% |

`category_l3_weave` is the column the whole exercise exists for. Without it a listing is "a
cotton saree", which spans ₹500 to ₹40,000. With it, a Sambalpuri is about ₹10,000 and a
Nuapatna about ₹3,000. **`weave_label_source` matters**: a craft named in the seller's own
title is their claim about that piece; one inferred from a tag or a vendor name is weaker
evidence. 27,180 rows carry a label and 24,000 of those come from the title.

### Where it is from

| Column | Meaning | Filled |
|---|---|---|
| `region_state` | Odisha, Telangana, Gujarat… | 60% |
| `gi_tagged` | the craft is a registered geographical indication | 46% |
| `region_cluster` | the shop or co-operative that listed it | 99% |
| `seller_type` | `cooperative` or `brand` | 100% |
| `market_type` | always `d2c_retail` — the guard against mixing in GeM rows | 100% |

`region_state` is where the **tradition** belongs, not always where the piece was made: a
Sambalpuri woven in Surat is still tagged Odisha. Measured against indiahandmade's own stated
`State of Origin`, the mapping agrees with the seller on 81 of 94 rows, and every disagreement
is that distinction (a Warli painting made in Karnataka). See `HANDREAD-200.md`.

### Practical facts

| Column | Meaning | Filled |
|---|---|---|
| `weight_g` | grams | 98% |
| `pack_size` | 1, or 5 for "combo pack of 5" | 100% |
| `wholesale_flag` | the seller tags it as bulk stock | 12% |
| `variant_prices_differ` | S and XL are priced differently; the row carries the cheapest | 0.5% |

**`pack_size` is not decoration.** A five-mat combo at ₹149 is ₹30 a mat, and a model that
ignores this learns that door mats are nearly free.

### Provenance — never use these as features

| Column | Meaning |
|---|---|
| `url`, `seen_on` | the exact listing and the date we looked. On every row, no exceptions |
| `row_id`, `scrape_run_id`, `source` | identity, and which run collected it, so a bad run can be dropped whole |
| `raw_title` | the seller's own words, kept verbatim for re-parsing |

`source` is the exception: keep it **as a feature**. If a model behaves differently on itokri
rows than goswadeshi rows, that is a finding we would otherwise never see.

### Two columns for splitting the data honestly

| Column | Why |
|---|---|
| `dup_group` | title + price. 944 rows are colour variants sharing both — real listings, but a random split puts copies of one listing on both sides of it |
| `vendor_group` | the seller. The largest is 9% of the data, and a model can score well by memorising a shop's price points instead of learning anything about craft |

**Split on these, not at random**, or the reported error is fiction.

## What is deliberately not here

`material_cost`, `labour_hours`, `cluster_wage`, `artisan_location`. **A marketplace listing
says what a thing sells for, never what it cost to make.** Those arrive from the artisan at
inference time and feed `floor_price()`. It means the training features and the live pricing
call are different vectors, which is worth knowing before either is written.

`image_urls` was dropped when the image-derived half of the request was cancelled. The scrapers
still store it, so it is one line to restore and needs no refetching.

## What the data cannot tell you

**These are asking prices, not sold prices.** A saree listed at ₹20,500 that never sells is
still in here at ₹20,500. Only the marketplaces know what clears, and they do not publish it.
Every conclusion drawn from this file inherits that limit.
