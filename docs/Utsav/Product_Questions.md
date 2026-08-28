# What the marketplaces actually ask, and the fewest questions that answer them

Research date 2026-08-28. Seven platforms read from primary sources — GeM policy PDFs, the
ONDC `ONDC-RET-Specifications` YAML, Amazon Seller Central + SP-API attribute docs, the
Flipkart Listing Management API reference, Meesho's downloadable category templates, Myntra
partner onboarding, and the Meta Commerce product-feed spec.

This document exists because the app asks six questions chosen by intuition. One of them fills
no field any platform requires, and three fields most platforms make mandatory are never asked.

---

## 0. The ONDC flow sketch, filled in

A hand-drawn map of the ONDC path, not a field inventory — it was drawn to show the stages,
and the stages are right. What follows is the spec filled in underneath each box.

```
ONDC PRODUCT LISTING

1. Seller / Seller App
   ↓
2. Product catalogue
   ├── Product ID
   ├── Product name
   ├── Category
   ├── Description
   ├── Product attributes
   └── Images
   ↓
3. Commercial information
   ├── Selling price
   ├── Inventory
   └── Applicable tax information
   ↓
4. Seller / Store information
   ├── Seller
   ├── Store / provider
   └── Location
   ↓
5. Fulfilment information
   ├── Pickup location
   ├── Delivery capability
   └── Fulfilment details
   ↓
6. Seller application converts
   catalogue into ONDC protocol format
   ↓
7. ONDC network
   ↓
8. Product becomes discoverable
   across participating buyer applications
```

Every box maps onto a real part of the spec: Product ID → `items[].id`, name →
`descriptor.name`, category → `category_id`, description → `descriptor.short_desc` +
`long_desc`, images → `descriptor.images`, selling price → `price.value`, inventory →
`quantity.available.count`, tax → `tags code=g2 → tax_rate`, store → the provider block,
fulfilment → `fulfillment_id` plus the provider's locations.

**The stage the flow does not have a box for is returns and dispatch terms, and that is the
one that gets listings rejected.** ONDC B2C Retail 1.2.5 marks all of these Required on the
item:

| Missing from the diagram | Key |
|---|---|
| MRP, as distinct from selling price | `price.maximum_value` |
| Is it returnable, and for how long | `@ondc/org/returnable`, `@ondc/org/return_window` |
| Who collects a return | `@ondc/org/seller_pickup_return` |
| Is it cancellable | `@ondc/org/cancellable` |
| Days to prepare for dispatch | `@ondc/org/time_to_ship` |
| Cash on delivery allowed | `@ondc/org/available_on_cod` |
| Consumer care name, email, phone | `@ondc/org/contact_details_consumer_care` |
| Pack size and unit | `quantity.unitized.measure` |
| Minimum and maximum units per order | `quantity.minimum.count`, `quantity.maximum.count` |
| Country of origin | `tags code=origin → country` |

`web/api/channels/ondc.py` already fills seven of these, which is why it is the most complete
adapter in the repo — but it fills them with guesses (`lead_time_days or 2`), because nothing
in the app ever asks. That missing box is where three of the nine real questions land (§4).

---

## 1. The count

| Platform | Per-product fields | Of which mandatory |
|---|---|---|
| GeM | 29 | 21 + a category-specific Technical Parameter set |
| ONDC (B2C Retail 1.2.5) | 40 | 27 + a category attribute block |
| Amazon India | 41 | 19 hard, ~8 more mandatory-in-practice |
| Flipkart | 46 | 30 ("all the columns are mandatory" in the FTP template) |
| Meesho | 26 | 20 |
| Myntra | 30+ | — see §5, artisans cannot list |
| WhatsApp / Meta feed | 8 app / 45 feed | 1 app / 9 feed |

**Nobody can answer 200 fields.** The design problem is that ~85% of them are not questions at
all — they are constants, lookups, or things we already know.

---

## 2. Common across platforms

Counted as a match when two or more platforms ask the same thing under different labels.

### Asked by all seven

| Field | GeM | ONDC | Amazon | Flipkart | Meesho | Myntra | WhatsApp |
|---|---|---|---|---|---|---|---|
| Product name / title | B7 | `descriptor.name` | `item_name` | Title | Product Name | Style name | `title` |
| Description | B8 | `short_desc`+`long_desc` | `product_description` | Description | Product description | Description | `description` |
| Category | B1 | `category_id` | `feed_product_type` | Vertical | Category | Article type | `fb_product_category` |
| Selling price | B12 | `price.value` | `standard_price` | `selling_price` | Meesho Price | Price | `price` |
| Primary image | B22 | `descriptor.symbol` | `main_image_url` | Image URL 1 | Front image | Image 1 | `image_link` |
| Stock / availability | B17 | `available.count` | `quantity` | `inventory` | Stock | Inventory | `availability` |
| Country of origin | B15 | `tags origin` | `country_of_origin` | `countries_of_origin` | Country of Origin | CoO | `origin_country` |

### Asked by six of seven

| Field | Missing from |
|---|---|
| MRP / maximum price | WhatsApp app |
| HSN + GST rate | WhatsApp |
| Brand | ONDC (carried at provider level, not on the item) |
| Material / fabric | WhatsApp (optional there) |

### Asked by four or five

Net weight · dimensions · colour · additional images (2–5 minimum) · manufacturer name and
address · SKU · variant grouping.

**Common core: 18 fields.** Everything past that is platform-specific.

---

## 3. Unique to one platform

These are what make "one listing everywhere" hard. None can be dropped — each rejects a
listing on its own platform.

**GeM** — Golden Parameters (a category-defined subset of technical parameters that legally
decides bid eligibility) · Local Content percentage with Class-I/II self-certification ·
documentary proof of MRP (packaging photo, or a stamped OEM letter under one year old) · CMS
Quadrant + OEM/Reseller role per category · Model Number (`NA` permitted) · category-fixed Unit
of Measurement · delivery pincode list · Vendor Assessment · and a negative constraint no
consumer marketplace has: **no seller identity may appear anywhere in the listing or images**.

**ONDC** — the `@ondc/org/*` block listed in §0 · `statutory_reqs_packaged_commodities` ·
minimum and maximum order count · `replacement_terms`.

**Amazon** — GTIN, with a per-brand-per-product-type exemption workflow · five `bullet_point`
slots · `generic_keywords` capped at 249 **bytes**, so Devanagari hits the cap at ~80
characters · `product_tax_code` enum · `supplier_declared_dg_hz_regulation` · `part_number` ·
`variation_theme` · browse node.

**Flipkart** — Procurement SLA in days · `procurement_type: MADE_TO_ORDER`, the only
first-class made-to-order enum anywhere and an exact fit for craft · separate local/zonal/national
shipping fees · packer details as a field distinct from manufacturer · shelf life · FSN.

**Meesho** — Wrong/Defective Returns Price, a third price point below the selling price ·
catalog-as-listing-unit, so variants must be authored as one object · Net Weight in grams as a
hard column.

**WhatsApp / Meta** — `wa_compliance_category` · `condition` as a required enum ·
`availability` as an enum rather than an integer.

---

## 4. The reduction: who can actually answer

Every field in the union falls into exactly one bucket.

### Bucket A — constants. Never ask, ever. (~30 fields)

`country_of_origin` = India · `currency` = INR · `condition` = New · `seller_type` = OEM (an
artisan who makes their own goods **is** an OEM, and getting this wrong is a GeM rejection on
its own) · `local_content_percent` = 100 · `brand_type` = Unregistered ·
`contact_details_consumer_care` = our support line · `available_on_cod` = false ·
`fulfillment_profile` = NON_FBF · `dg_hz_regulation` = not_applicable · `listing_status` =
ACTIVE · SKU, part number, item id, group id, FSN — all generated.

### Bucket B — derived from the category, once we know what the thing is. (~25 fields)

HSN → GST rate → Amazon `product_tax_code` → Flipkart `tax_code`. One lookup table, four
platform outputs. Also: GeM category id, Amazon browse node, Flipkart vertical, ONDC
`category_id`, Meesho category, UOM, default return window.

**The highest-leverage AI in the product**, and `web/api/channels/gem.py` already says so:
10,700 GeM categories, and picking wrong is the most common listing failure. Nobody should ever
be asked "what is your HSN code".

### Bucket C — derived from the photo. (~8 fields)

Colour · pattern · rough product type · per-platform image variants. Needs
`POST /catalog/prefill`, still `NotImplementedError` in `ai/service.py`. Until it exists these
fall through to Bucket E and cost real questions.

### Bucket D — carried forward from the artisan. (~15 fields)

Craft, cluster, manufacturer name and address (their own), packer details (same), pickup
pincode, brand (their display name), delivery locations — and from their **previous products**:
material, technique, dye type, loom type, lead time, weight band.

First product: unknown. Fifth product: nearly all of it. This is the mechanism behind
"the app grows with you", and it is a `WHERE artisan_id = ?` query, not a vector search.

### Bucket E — genuinely must be asked. Nine slots, and only nine.

| Slot | Why it cannot be derived | Blocks publish on |
|---|---|---|
| `what` | The product's identity. Vision guesses, the artisan confirms | all 7 |
| `material` | Not reliably visible — cotton and rayon look identical | 6 |
| `size` | Needs a tape measure | 5 |
| `weight` | Needs a scale. Drives shipping and return fees | 5 |
| `stock` | Only the artisan knows how many exist | all 7 |
| `cost` | Material spend. Feeds the price floor, never shown to a buyer | none |
| `time` | Labour hours. Same | none |
| `lead_time` | Days to prepare. ONDC `time_to_ship`, Flipkart Procurement SLA | 2 |
| `special` | The craft story. Fills no mandatory field, and is the entire difference between a handmade listing and a factory one | 0 |

Seven are per-product. `material` and `lead_time` collapse to a yes/no confirmation from the
second product onwards.

---

## 5. Myntra: cannot be done

**An unbranded rural artisan cannot list on Myntra.** Not "hard" — categorically excluded.
Independently blocking: a registered trademark or brand authorisation is required; only
registered legal entities onboard, not individuals; GST is mandatory with no enrolment-ID path;
the practical catalogue floor is 20–50 SKUs; five mandatory studio images at 1080×1440 including
a gender-matched human model shot; and approval reportedly depends on documented revenue on
another marketplace.

**Decision: drop Myntra from the artisan-facing publish path.** Reachable only through an
aggregator holding the trademark. Saying so is more credible than a "coming soon" tile.

Meesho is the opposite and should rank accordingly: since 1 Oct 2023 it accepts sellers with no
GSTIN via a GST-portal Enrolment ID, and handicrafts sit inside the permitted non-GST set.

---

## 6. The strategy

### 6.1 One broad question, then gap-filling — not a fixed list

People do not answer one field per sentence. Asked what a thing is, an artisan says *"yeh
sambalpuri cotton saree hai, teen din laga"* — that is `what`, `material`, `technique` and
`time` in one breath. The current design throws three of those away and asks for them again
two screens later.

So: **ask one open question, extract every slot it fills, then ask only for what is still
missing.** Same interpreter, different call shape — many slots out of one transcript instead of
one slot out of one transcript.

### 6.2 Questions are computed, not hardcoded

```
plan(prefill, profileDefaults, answersSoFar, channels) -> next slot or null
```

Ranked by consequence: **blocks publish** > **affects the price floor** > **improves the
listing**. A slot no selected channel requires is never asked.

### 6.3 Channel selection moves before the questions

Today `/publish` is the last screen and fires every tier-A channel, so at question time the
targets are unknown and nothing can be skipped on their behalf.

The lazy version: **default to tier A and ask nothing.** Tier A is our marketplace plus ONDC,
where we are the Marketplace Seller Node and the artisan needs no GST, no registration, no
paperwork. The extra fields Amazon and Flipkart want get asked **once, at connect time**, not
per product.

### 6.4 The budget

| | Questions | Confirmations |
|---|---|---|
| Product 1 | 4 | 2 |
| Product 2, same craft | 1 | 2 |
| Product 5 | 1 | 1 |

Product 1: the open question (harvests `what`/`material`/`time`/`special`), then `size`,
`weight`, `stock`. Product 2 onwards: material, lead time and weight band are known and become
"cotton again?" — a tap, not a sentence.

### 6.5 What changes about `special`

It stays, moves last, stays skippable. It fills no mandatory field, and it is the only thing
that makes a handmade listing different from a factory one. Worth one question — not worth
being question four of six on a bad network.

### 6.6 Storage

No vector database for the memory. Carrying previous answers forward is a SQL lookup on tables
that already exist in `web/api/models.py`.

**pgvector, on the Postgres already chosen, for exactly one job:** mapping a product to GeM's
10,700 categories, Amazon browse nodes, Flipkart verticals and ONDC category ids. A static
index built once — a search problem, not a memory problem. Pricing comparables
(`ai/price/comps.py`) can share it.

Rejected: a separate vector service. It adds a deploy unit, an embedding cost on a path that
must survive a rural network, and non-determinism to a system whose stated rule is that every
number survives *"how did you get that?"*.

---

## 7. Consequences someone has to own

- **Weight and dimensions need instruments** — a scale and a tape. No AI substitutes for them
  and five platforms make them mandatory. This is the one place the app cannot degrade
  gracefully.
- **`POST /catalog/prefill` is unimplemented.** Bucket C is worth ~8 fields and one whole
  question. Until vision exists, every product costs more questions than §6.4 claims.
- **The HSN lookup does not exist.** Six platforms need it, no artisan can supply it, and there
  is no table in the repo.
- **GeM needs three images from different angles**, ≥1000×1000, product filling ≥50% of frame.
  The camera flow captures one. GeM listings are blocked until it captures three.
- **GeM wants documentary proof of MRP.** For an artisan with no packaging that means an OEM
  declaration on letterhead. There is no path in the app for this, and it blocks GeM.
