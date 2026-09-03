# The 200-row hand-read — indiahandmade

**Date:** 2026-09-03 · **Run:** `indiahandmade-2026-09-03` · **Rows:** 200 in `out/listings.jsonl`

The request document calls this "the checkpoint that saves the week". It did. One bug found
was serious, and three of the assumptions the plan is built on turn out to be wrong.

## The bug: 33 of the first 200 rows were category pages

`/men-s-wear.html`, `/kids.html`, `/home-and-living.html` and 30 others were collected as
products, each with a **real, correct-looking price** — ₹549, ₹1,650, ₹1,249.

The price is real. It belongs to the first product tile in the category grid. The URL is a
category. So the row said *"a men's-wear listing sells for ₹549"* while pointing at a page that
is not a listing at all, and every one of them would have passed a human skim of the CSV.

The first-cut filter was "a page with no price is not a product". That is exactly backwards on a
Magento storefront, where every grid page has prices. `parse()` now requires `[itemprop=sku]`,
which category pages do not carry, and the selfcheck asserts that a page with a `finalPrice` and
no SKU is dropped. Re-running `--reparse` rebuilt the file from cache with **zero refetches** —
which is the entire argument for caching every page.

**167 of the original 200 were real.** The run was topped back up to 200.

## What the sample actually looks like

| | |
|---|---|
| Price median | **₹1,675** (min ₹60 fish-scale earrings, max ₹275,000 rosewood dining set) |
| MRP present | 123/200, never equal to and never below the selling price — a clean `discount_pct` |
| Images | every row, median 8 URLs — kept in the raw rows, not carried into the normalised ones |
| `State of Origin` | **195/200** |
| Material or Fabric | 158/200 |
| Duplicate titles | 0 |

The 200 are catalogue-wide, not textiles — earrings, bookmarks, stools, bedsheets, furniture. The
sitemap is not ordered by category, so a general crawl gives a general dataset. F3 compares
within a category, so either the crawl runs to completion or it is pointed at category pages
deliberately. Worth deciding before day 3 rather than after.

## Three things the plan assumed that are not true

### 1. `Weaving Style` is in 17 of 200 rows, not most of them

PROBE.md called the spec table the reason to crawl this site first, on the strength of one saree
that had `Weaving Style: Tussar`. Across 200 rows the field appears **8.5% of the time**, with ten
distinct values, one of which is `Others` and one of which is `zari` — a thread, not a weave.

`category_l3_weave` therefore **cannot come from the spec table.** It has to come from matching
the title against the GI registry, on this site as much as on the other five. The ₹175,000
Paithani is instructive: `Weaving Style: Paithani` *and* "Paithani" in the title. The title is the
reliable half.

This does not change the crawl order. `State of Origin` at 195/200 is still a field no other site
gives us, and region is the label the GI mapping needs to be checked against.

### 2. `Item Type` is not a category

Its only two values are `Handicraft` (109) and `Handloom` (58). It says how a thing was made, not
what it is. `category_l1`/`category_l2` have to be parsed from the title and the URL path.

It is still worth keeping — "handloom vs handicraft" is a plausible price feature and it is free.

### 3. `Material` is free text, and it is messy

Real values from the sample: `FISH SCALE`, `Fish Scale`, `cotton`, `Cotton`,
`Kalamkari Jumpsuit natural print handmade`, and
`Paper, water colours,poster colours, black pen, colourful pen`.

Case-inconsistent, sometimes a whole sentence, sometimes a list. The plan's "controlled
vocabulary, no free text to the model" is not a nicety here — it is most of Phase 3.

## Two hazards to decide on before the full crawl

**Multi-item packs — 10 of 200 (5%).** "Handmade Handloom Door Mat | Combo Pack of 5" at ₹149 is
₹30 a mat. "Bookmarks Set of 8" at ₹300. The target is the price of a *listing*; the model will
read these as an extremely cheap door mat. `quantity` was deliberately cut from the schema
because it arrives from the artisan at inference time, so these need either a `pack_size` column
parsed from the title or an explicit drop with the count logged. **They cannot be left in
untouched.**

**The same product listed twice.** SKUs `del1650` and `Del505132` are both
"Handloom Multi Colour Strip Bedsheet with 2 Pillow Covers", both ₹600, different URLs. The
plan's `(normalised_title, price)` dedupe catches this — worth knowing it is needed *within* one
site, not only across sites. Dedupe carefully: two genuinely different sarees from one weaver at
one price are not duplicates, and collapsing them thins exactly the mid-price band F3 lives in.

## Numbers for the plan

The sitemap holds **6,691 product URLs**, not the 25,633 it appears to — 18,586 are
`catalog/category/view/id/N` redirects and the rest are category pages. Still comfortably the
largest single source, and enough on its own for most of the 2,000-row target, but the headline
number in PROBE.md was the wrong one.

At 2.5s per page a full crawl of this site is about **4.6 hours**. It is resumable and cached, so
it can run in pieces.

---

# The GI table, checked against the sellers — 2026-09-03

`gi_crafts.py` maps a craft name to a region, and until now nothing had tested it. indiahandmade
states `State of Origin` as a field, so its rows can check the mapping: for every listing whose
title names a weave *and* whose spec table states a state, does our inferred region match what
the seller says?

**On 94 such rows, the table agrees with the seller 81 times — 86%.**

All thirteen disagreements are the same thing, and it is the behaviour the file documents rather
than an error:

| Craft | We say | The seller says |
|---|---|---|
| warli | Maharashtra | Karnataka, Jammu & Kashmir |
| phulkari | Punjab | West Bengal, Jammu & Kashmir |
| madhubani | Bihar | Jharkhand |
| banarasi | Uttar Pradesh | Rajasthan |
| chanderi, bagh | Madhya Pradesh | Punjab |

A Warli painting made in Karnataka is still Warli — the tradition is Maharashtra's and the
painter is not. `gi_crafts.py` says exactly this: the region is where the *style* belongs, not
where the piece was made. The 86% is therefore a floor on the table's accuracy, not a measure of
its error, and the 14% is the style-versus-maker distinction showing up in the data.

**This is why the indiahandmade crawl was stopped at 694 rows** rather than run to 6,691. Its
remaining value was volume in categories that are already at the seed's 200-price cap. The one
thing only this site could give — a stated region to check the taxonomy against — is answered,
and answering it again 6,000 more times would not change the number.
