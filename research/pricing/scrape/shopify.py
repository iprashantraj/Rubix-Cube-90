"""Collect the Shopify storefronts for the F3 pricing dataset.

Phase 2 of docs/Abhay/REQUEST-PRICING-DATASET.md. Three of the six sites in the request
turned out to be Shopify stores with an open /products.json (see PROBE.md), which returns
250 products per request already structured — title, price, compare-at price, tags,
vendor, weight, SKU and every image URL. There is no HTML to parse and no selector to
break, so `adaptive=True` and the whole spider apparatus buy nothing here.

    python3 shopify.py goswadeshi
    python3 shopify.py itokri --limit 500
    python3 shopify.py okhai --reparse        # rebuild from cache, no network

Like indiahandmade.py, nothing is normalised and every response is cached, so a parser
change costs no requests. Phase 3 reads out/listings.<source>.jsonl.
"""

import argparse, hashlib, json, pathlib, sys, time
from datetime import date

from scrapling.fetchers import Fetcher

# delay is per site: itokri's robots.txt publishes Crawl-delay: 10 and we honour it.
# It costs almost nothing here — one request carries 250 products.
SITES = {
    "goswadeshi": {"base": "https://goswadeshi.in", "delay": 2.5},
    "itokri":     {"base": "https://itokri.com",    "delay": 10.0},
    "okhai":      {"base": "https://okhai.org",     "delay": 2.5},
}
PAGE_SIZE = 250
HERE = pathlib.Path(__file__).parent


def fetch_page(source: str, page: int) -> list[dict]:
    """One page of products, from cache if we have ever asked for it."""
    site = SITES[source]
    path = HERE / "cache" / source / f"products-{page:03d}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")).get("products", [])
    url = f"{site['base']}/products.json?limit={PAGE_SIZE}&page={page}"
    # .body, not .html_content — Scrapling wraps a JSON response in <html><body> and
    # the wrapper is not valid JSON.
    body = Fetcher.get(url, timeout=60).body.decode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.loads(body)
    if "products" not in payload:
        # Shopify stops paginating /products.json after page 100 (25,000 products) and
        # answers with an error object rather than an empty list. Not cached — it is not
        # data, and caching it would make the stop permanent.
        return []
    path.write_text(body, encoding="utf-8")
    time.sleep(site["delay"])
    return payload["products"]


def parse(source: str, product: dict, run_id: str) -> dict | None:
    """One listing, verbatim. None when there is no sellable variant with a price."""
    variants = [v for v in product.get("variants", []) if v.get("price")]
    if not variants:
        return None
    v = variants[0]

    # okhai returns "0.00" rather than null for "no compare-at price". Left as-is, a
    # zero MRP reads as a 100% discount, which is a number nobody meant.
    mrp = v.get("compare_at_price")
    if mrp in (None, "", "0.00", "0"):
        mrp = None

    prices = {x["price"] for x in variants}
    url = f"{SITES[source]['base']}/products/{product['handle']}"
    return {
        "row_id": hashlib.sha1(url.encode()).hexdigest()[:16],
        "source": source,
        "url": url,
        "seen_on": date.today().isoformat(),
        "scrape_run_id": run_id,
        "raw_title": (product.get("title") or "").strip(),
        "raw_description": product.get("body_html") or "",   # goswadeshi's spec block lives here
        "price_raw": v["price"],
        "mrp_raw": mrp,
        "sku": (v.get("sku") or "").strip(),
        # The Shopify equivalents of indiahandmade's spec table. itokri prefixes its craft
        # process into the tags; okhai mixes technique, material, a GST rate and a price
        # bucket into one flat list. Phase 3 sorts that out, not this file.
        "specs": {
            "product_type": product.get("product_type") or "",
            "vendor": product.get("vendor") or "",
            "tags": product.get("tags") or [],
            "grams": v.get("grams"),
            "n_variants": len(variants),
            # True when the sizes are not all one price, so the single price on this row
            # is the cheapest variant and not the whole story.
            "variant_prices_differ": len(prices) > 1,
        },
        "image_urls": [i["src"] for i in product.get("images", [])][:8],
    }


def run(source: str, limit: int | None, reparse: bool) -> None:
    out_dir = HERE / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"listings.{source}.jsonl"
    run_id = f"{source}-{date.today().isoformat()}"

    kept = skipped = 0
    seen_urls = set()
    with out_path.open("w", encoding="utf-8") as f:      # cache-backed, so a rebuild is free
        page = 1
        while limit is None or kept < limit:
            cached = (HERE / "cache" / source / f"products-{page:03d}.json").exists()
            if reparse and not cached:
                break
            try:
                products = fetch_page(source, page)
            except Exception as e:
                print(f"  ! page {page}: {e}", file=sys.stderr)
                break
            if not products:
                break
            for product in products:
                row = parse(source, product, run_id)
                if row is None or row["url"] in seen_urls:
                    skipped += 1
                    continue
                seen_urls.add(row["url"])
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
                kept += 1
                if limit is not None and kept >= limit:
                    break
            f.flush()
            print(f"  page {page}: {kept} rows", file=sys.stderr)
            page += 1

    print(f"{kept} rows, {skipped} skipped. -> {out_path}", file=sys.stderr)


def selfcheck() -> None:
    """No network: the shapes below are the ones the three stores actually returned."""
    goswadeshi = {
        "title": "Orange Silk Handloom Paithani Saree", "handle": "orange-silk-paithani",
        "product_type": "Saree", "vendor": "OnlyPaithani",
        "tags": ["Paithani", "Saree", "Silk"], "body_html": "<p>Material: Silk</p>",
        "variants": [{"price": "20500.00", "compare_at_price": None, "grams": 800, "sku": "DPPOGAG0024"}],
        "images": [{"src": "https://cdn.shopify.com/a.jpg"}],
    }
    row = parse("goswadeshi", goswadeshi, "test")
    assert row["price_raw"] == "20500.00" and row["mrp_raw"] is None
    assert row["url"] == "https://goswadeshi.in/products/orange-silk-paithani", row["url"]
    assert row["specs"]["tags"] == ["Paithani", "Saree", "Silk"]
    assert row["specs"]["variant_prices_differ"] is False

    # okhai writes "0.00" for "no compare-at price"; left alone it is a 100% discount.
    okhai = dict(goswadeshi, variants=[{"price": "499.00", "compare_at_price": "0.00"}])
    assert parse("okhai", okhai, "test")["mrp_raw"] is None

    # Sizes at different prices: the row carries the first, and says so.
    multi = dict(goswadeshi, variants=[{"price": "999.00"}, {"price": "1299.00"}])
    assert parse("itokri", multi, "test")["specs"]["variant_prices_differ"] is True

    assert parse("itokri", dict(goswadeshi, variants=[]), "test") is None
    print("selfcheck ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?", choices=sorted(SITES))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--reparse", action="store_true", help="rebuild from cache, no network")
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()
    if a.selfcheck:
        selfcheck()
    elif a.source:
        run(a.source, a.limit, a.reparse)
    else:
        ap.error("a source is required unless --selfcheck")
