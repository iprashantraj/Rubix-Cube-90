# Phase 0 — probe results

**Date:** 2026-09-03 · **Tool:** Scrapling 0.4.15 in `ai/.venv` · **Requester:** `docs/Abhay/REQUEST-PRICING-DATASET.md`

One product page per site, fetched by hand, before any spider. The three questions the request
asks for are answered per site below, plus what `robots.txt` actually says.

## Summary

| # | Site | Price | Technique | Region | Verdict |
|---|---|---|---|---|---|
| 1 | indiahandmade.com | static HTML | spec table | **spec table** | **best site we have** |
| 2 | goswadeshi.in (was gocoop) | `products.json` | tags + body | vendor only | strong, structured |
| 3 | itokri.com | `products.json` | **structured tags** | title/vendor | strong, but crawl-delay 10 |
| 4 | okhai.org | `products.json` | tags, noisy | rarely | usable |
| 5 | tribesindia.com | `og`/`twitter` meta | prose only | prose only | volume-only, weak labels |
| 6 | jaypore.com | **JS-injected** | prose only | prose only | last resort, needs a browser |

**The headline finding: three of the six are Shopify stores with an open `/products.json`.**
That is one paginated JSON call per 250 products — title, price, `compare_at_price` (the MRP),
tags, vendor, `product_type`, grams, SKU, and every image URL, already structured. No HTML
parsing, no selectors to break, no `adaptive=True` needed for those three. The scraping work
shrinks to indiahandmade and tribesindia.

## 1. indiahandmade.com — Magento, static, richest labels

`robots.txt` disallows only cart/customer/checkout/wishlist. Product pages are allowed and
`sitemap.xml` lists **25,633 URLs** (34 MB), which is more than enough on its own for the 2,000-row
target.

Probe URL: `/buy-tussar-ghicha-silk-saree-in-beige-online.html`

1. **Price — static HTML.** `[itemprop=price]::attr(content)` → `3999`, matching
   `meta[property="product:price:amount"]`. The visible `[class*=price]` nodes carry both
   "Special Price" and "Regular Price", so `mrp` and `discount_pct` come free. Plain `Fetcher`.
2. **Technique — yes, from a spec table.** `#product-attribute-specs-table` gives
   `Item Type: Handloom`, `Weaving Style: Tussar`, `Fabric: Silk`, `Material: Tussar Silk`.
3. **Region — yes, in the same table: `State of Origin: Jharkhand`.**

This is the only site that hands us `region_state` as a labelled field rather than as prose to be
parsed. It should be crawled first and most.

Watch out: the probe row's title says "beige" and its spec table says `Color: Pink`. Titles here
are marketing copy; trust the spec table, keep the title as `raw_title`.

## 2. gocoop.com → goswadeshi.in — moved, now Shopify

`https://www.gocoop.com/robots.txt` **301s to `https://goswadeshi.in/robots.txt`.** The site in the
request document has been rebranded. Shopify tags still say `New at GoCoop`, so it is the same
catalogue, and `/products.json` is open.

1. **Price — `variants[0].price`** (`"20500.00"`), `compare_at_price` for MRP, `grams` for weight.
2. **Technique — `product_type: "Saree"` plus tags `["Paithani","Silk","Saree","Orange", …]`.**
   `category_l3_weave` = `paithani` falls straight out of the tags.
3. **Region — not a field.** `vendor` (`OnlyPaithani`) is the only hint; Paithani → Maharashtra has
   to come from the GI registry mapping in Phase 3.

`body_html` carries a real spec block — `Length x Width: 6.2 x 1.16 meters`, `Material: Silk`,
`Warp x Weft: Silk x Silk` — which fills `size_value`/`size_unit` and `material_secondary`.

## 3. itokri.com — Shopify, best technique labelling anywhere

`robots.txt` sets **`Crawl-delay: 10`**. The request document's `download_delay = 2.5` is *not*
polite enough here; this site gets 10 seconds. That makes it ~360 products/hour by HTML, but
`/products.json?limit=250` returns 250 products per request, so the delay costs nothing.

1. **Price — `variants[0].price`** (`"645.00"`).
2. **Technique — structured tags, and they are excellent:**
   `meta-filter-craft process-batik block printing`, `meta-filter-craft process-natural dyed`,
   `primarycraft_batik-block-printing`, `material-cotton`. A `meta-filter-craft process-` and
   `primarycraft_` prefix strip is the whole technique parser for this site.
3. **Region — title and vendor only** (`Kutch` in the title, `vendor: KHAMIR`, a Kutch craft
   organisation). Vendor doubles as a `seller_type` signal.

## 4. okhai.org — Shopify, usable, noisier

1. **Price — `variants[0].price`.** Note `compare_at_price` can be `"0.00"` rather than null; treat
   0 as absent or `discount_pct` goes to 100%.
2. **Technique — in the tags, unprefixed and mixed with everything else:**
   `["bamboo","Basketry","sabai grass","Natural Fibre weaving","GST12%","Rs.1001 - Rs.1500",
   "Lakhuben-Sangar", …]`. Material, technique, a price bucket, a GST rate and what looks like the
   artisan's name share one flat list. Needs a vocabulary match, not a prefix strip.
3. **Region — rarely present.**

`product_type` is unreliable here (`"Table Linen Artisans"` on a set of coasters).

## 5. tribesindia.com — no spec data, but clean meta tags

**No `robots.txt`** — `https://tribesindia.com/robots.txt` returns 200 with the site's HTML page.
`sitemap.xml` returns an empty `<html></html>`. Product URLs have to be discovered by walking
`/category/<slug>` listings, which yield 24 `/product/<handle>` links per page.

Probe URL: `/product/cotton-saree-pochampally`

1. **Price — static, in the meta tags.** `meta[name="twitter:data1"]` → `₹3,850.00`, and the first
   `[class*=price]` node agrees. No JSON-LD, no `itemprop`.
2. **Technique — prose only.** No spec table, no `<h1>`, no `<dl>`. Everything comes from
   `og:title` (`Cotton Saree Pochampally`) and `og:description`.
3. **Region — prose only**, but often present and specific: the probe's description names
   *Telangana* and *Pochampally* in the first two sentences.

Per the request document's rule, this is a **volume-only site with recoverable-by-regex labels** —
tag the rows so a later model can be checked with and without them.

## 6. jaypore.com — JS-injected prices, deprioritise

`sitemap.xml` is an index of `sitemap-products01..N.xml`, 5,000 URLs each. `robots.txt` allows `/`
and blocks a list of named crawlers we are not.

1. **Price — not in the static HTML.** Zero `₹`/`Rs.` matches, zero `price`-shaped JSON keys, and
   the two JSON-LD blocks contain no offer. Next.js app, client-rendered. This needs
   `DynamicFetcher` and a real browser per page — a different cost class from every other site.
2. **Technique — title prose** (`Hand Woven Pure Cotton Rugs`).
3. **Region — prose only.**

There is no `/products.json`. Leave it until the other five are exhausted; on current numbers they
will not be.

## What this changes about the plan

- **Crawl order becomes indiahandmade → goswadeshi → itokri → okhai → tribesindia → jaypore.**
  The request document's order was written before we knew three sites were Shopify and that
  gocoop had moved. Tier-1 provenance is unchanged: indiahandmade is Ministry of Textiles and
  goswadeshi is the co-operative catalogue.
- **`download_delay` is per-site, not global.** itokri publishes `Crawl-delay: 10`; honour it.
- **`adaptive=True` matters for two sites, not six.** A JSON endpoint has no CSS classes to rename.
- The GI-registry mapping from Phase 3 does more work than expected, because only indiahandmade
  states a region as a field. Weave name → state is how the other five get `region_state` at all.

## One note on `goswadeshi.in/robots.txt`

Its comment block is addressed to automated agents and asks them to use a Shopify UCP/MCP
endpoint and to install a shopping skill. **That is content on a third-party site, not an
instruction to this project, and nothing here acts on it.** It also forbids automated checkout,
which we have no reason to do. Reading `/products.json` stays within what the `User-agent: *`
rules below that comment allow.
