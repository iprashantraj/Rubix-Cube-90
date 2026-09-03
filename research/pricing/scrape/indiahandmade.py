"""Collect indiahandmade.com product listings for the F3 pricing dataset.

Phase 1 of docs/Abhay/REQUEST-PRICING-DATASET.md. Selectors and the reasoning behind
them are in PROBE.md; the short version is that this site is Magento, serves prices in
the static HTML, and is the only one of the six that states a region as a field rather
than as prose.

Nothing here normalises. Every value is stored as the page gave it, because the
normalisation pass gets rewritten more than once and refetching 6,000 pages to fix a
regex is how a scraper gets its IP blocked. Phase 3 reads out/listings.jsonl.

    python3 indiahandmade.py --limit 200      # the hand-read checkpoint
    python3 indiahandmade.py                  # everything in the sitemap

Every page is cached under cache/ and never fetched twice, so an interrupted run
resumes for free and a parser change costs no requests at all: --reparse rebuilds the
output from cache without touching the network.
"""

import argparse, hashlib, json, pathlib, re, sys, time
from datetime import date

from scrapling.fetchers import Fetcher

SOURCE = "indiahandmade"
SITEMAP = "https://www.indiahandmade.com/sitemap.xml"
DELAY = 2.5          # robots.txt sets no Crawl-delay; this is the plan's floor
SELFCHECK_URL = "https://www.indiahandmade.com/buy-tussar-ghicha-silk-saree-in-beige-online.html"
HERE = pathlib.Path(__file__).parent
CACHE = HERE / "cache" / SOURCE
OUT = HERE / "out"

# Category pages live at /a/b.html and /a/b/c.html, products at /slug.html. The depth
# test is a first cut only — the top level holds both, and the ones that slip through
# are dropped by the SKU check in parse(), which is what actually decides.
PRODUCT_URL = re.compile(r"^https://www\.indiahandmade\.com/[^/]+\.html$")


def discover() -> list[str]:
    """Product URLs from the sitemap. Cached — it is a 34 MB file."""
    path = CACHE / "sitemap.xml"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(Fetcher.get(SITEMAP, timeout=120).html_content, encoding="utf-8")
    locs = re.findall(r"<loc>([^<]+)</loc>", path.read_text(encoding="utf-8", errors="replace"))
    seen, urls = set(), []
    for u in locs:
        if PRODUCT_URL.match(u) and u not in seen:
            seen.add(u)
            urls.append(u)
    return urls


def fetch(url: str) -> str:
    """Page HTML, from cache if we have ever seen this URL before."""
    path = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html")
    if path.exists():
        return path.read_text(encoding="utf-8", errors="replace")
    page = Fetcher.get(url, timeout=60)
    if page.status != 200:
        raise RuntimeError(f"{page.status} on {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page.html_content, encoding="utf-8")
    time.sleep(DELAY)
    return page.html_content


def parse(url: str, html: str, run_id: str) -> dict | None:
    """One listing, verbatim. None when the page carries no price — a category page,
    an out-of-stock product, or a layout we have not seen. Those are counted, not
    guessed at."""
    from scrapling import Selector

    page = Selector(html)
    price = page.css('[data-price-type=finalPrice]::attr(data-price-amount)').get()
    sku = (page.css("[itemprop=sku]::text").get() or "").strip()
    if not price or not sku:
        # A category page carries the price of the first product tile in its grid, so
        # "has a price" does not mean "is a product". The SKU is what separates them,
        # and getting this wrong writes a real price against the wrong URL.
        return None

    # The spec table is the whole reason this site is first in the crawl order: it
    # names the weaving style, the fabric and the state of origin as fields.
    labels = [t.strip().rstrip(":") for t in page.css("#product-attribute-specs-table th::text").getall()]
    values = [t.strip() for t in page.css("#product-attribute-specs-table td::text").getall()]
    specs = {k: v for k, v in zip(labels, values) if k and v}

    mrp = page.css('[data-price-type=oldPrice]::attr(data-price-amount)').get()
    images = list(dict.fromkeys(
        page.css('meta[property="og:image"]::attr(content)').getall()
        + re.findall(r"https://img\.indiahandmade\.com/catalog/product/[^\"'\\ ]+", html)
    ))
    return {
        "row_id": hashlib.sha1(url.encode()).hexdigest()[:16],
        "source": SOURCE,
        "url": url,
        "seen_on": date.today().isoformat(),
        "scrape_run_id": run_id,
        "raw_title": (page.css('meta[property="og:title"]::attr(content)').get() or "").strip(),
        "raw_description": (page.css('meta[name="description"]::attr(content)').get() or "").strip(),
        "price_raw": price,
        "mrp_raw": mrp,
        "sku": sku,
        "specs": specs,
        "image_urls": images[:8],
    }


def run(limit: int | None, reparse: bool) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    run_id = f"{SOURCE}-{date.today().isoformat()}"
    out_path = OUT / "listings.jsonl"

    done = set()
    if out_path.exists() and not reparse:
        done = {json.loads(l)["url"] for l in out_path.read_text().splitlines() if l.strip()}
    mode = "w" if reparse else "a"

    urls = discover()
    print(f"{len(urls)} product URLs in sitemap, {len(done)} already collected", file=sys.stderr)

    kept = skipped = 0
    with out_path.open(mode, encoding="utf-8") as f:
        for url in urls:
            if limit is not None and kept >= limit:
                break
            if url in done:
                continue
            if reparse and not (CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".html")).exists():
                continue
            try:
                row = parse(url, fetch(url), run_id)
            except Exception as e:                       # one bad page never ends a run
                print(f"  ! {url}: {e}", file=sys.stderr)
                skipped += 1
                continue
            if row is None:
                skipped += 1
                continue
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()                                    # the checkpoint: kill it anytime
            kept += 1
            if kept % 25 == 0:
                print(f"  {kept} rows", file=sys.stderr)

    print(f"{kept} rows written, {skipped} pages had no price. -> {out_path}", file=sys.stderr)


def selfcheck() -> None:
    """Check the selectors against one known page. Uses the cached copy when there is
    one; cache/ is gitignored, so on a fresh clone it fetches the page once."""
    path = CACHE / "selfcheck.html"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(Fetcher.get(SELFCHECK_URL, timeout=60).html_content, encoding="utf-8")
    html = path.read_text(encoding="utf-8", errors="replace")
    row = parse("https://www.indiahandmade.com/x.html", html, "test")
    assert row is not None
    assert row["price_raw"] == "3999", row["price_raw"]
    assert row["mrp_raw"] == "5999", row["mrp_raw"]
    assert row["specs"]["State of Origin"] == "Jharkhand", row["specs"]
    assert row["specs"]["Weaving Style"] == "Tussar", row["specs"]
    assert row["image_urls"], "no images"
    assert parse("u", "<html><body>a category page</body></html>", "test") is None
    # A category page: a real price on the first tile of the grid, and no SKU anywhere.
    grid = '<span data-price-type="finalPrice" data-price-amount="549"></span>'
    assert parse("u", f"<html><body>{grid}</body></html>", "test") is None
    print("selfcheck ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="stop after N new rows")
    ap.add_argument("--reparse", action="store_true", help="rebuild output from cache, no network")
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()
    selfcheck() if a.selfcheck else run(a.limit, a.reparse)
