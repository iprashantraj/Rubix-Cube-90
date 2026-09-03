"""Raw scraped listings -> the F3 schema, and the five-column observed.csv.

Phase 3 of docs/Abhay/REQUEST-PRICING-DATASET.md, and the half the request calls "the real
work". The scrapers store what each site said, verbatim; everything that turns three
different vocabularies into one lives here, so it can be rewritten without refetching.

    python3 normalise.py                 # out/listings.*.jsonl -> out/listings.normalised.jsonl
    python3 normalise.py --observed      # also merge into research/pricing/observed.csv
    python3 normalise.py --selfcheck

`image_urls` is deliberately not carried through. The scrapers still store it, so it is one
line to put back, but the image-derived half of the request — `design_density` and
`colour_count` — is not being pursued and the normalised rows should not imply it is.

Two rules from the request govern every decision below:

  * Never invent a number. A row whose price we cannot read is dropped and counted, never
    filled in. Every drop is reported by reason.
  * Keep the cheap ones. A Rs 900 powerloom "Sambalpuri" is not noise — it is the market our
    artisans are priced against, and it is the case below_floor_warning exists to catch.
    Nothing here filters on price.
"""

import argparse, csv, glob, json, pathlib, re, sys
from collections import Counter

from gi_crafts import CATEGORIES, MATERIALS, TECHNIQUES, WEAVES

HERE = pathlib.Path(__file__).parent
OUT = HERE / "out"
OBSERVED = HERE.parent / "observed.csv"          # gitignored; holds the hand-collected 144
PACK = re.compile(r"\b(?:set|pack|combo(?:\s+pack)?)\s+of\s+(\d+)\b", re.I)


def _haystack(row: dict) -> str:
    """Everything a site told us about the product, lowercased, in one string. Tags and the
    spec table are searched alongside the title because no site puts the weave in the same
    place twice."""
    specs = row.get("specs") or {}
    parts = [row.get("raw_title", ""), row.get("raw_description", "")[:600]]
    parts += [str(v) for k, v in specs.items() if k not in ("grams", "n_variants")]
    parts += list(specs.get("tags") or [])
    return " ".join(parts).lower().replace("_", " ").replace("-", " ")


_WORD = {}


def _category(text: str):
    """First category word to appear, in the order gi_crafts.CATEGORIES lists them —
    specific before general, so "dress material" beats "fabric"."""
    for word, cat in CATEGORIES:
        rx = _WORD.get(word) or _WORD.setdefault(word, re.compile(rf"\b{re.escape(word)}\b"))
        if rx.search(text):
            return cat
    return None


def _first(table, hay: str):
    """Longest match wins: 'kota doria' before 'kota', 'hand block' before 'block'.

    Matched on word boundaries, not as a substring. A plain `in` test labelled 11,938 rows
    as Assam `eri` silk because the letters are inside the word "material"."""
    for key in sorted(table, key=len, reverse=True):
        rx = _WORD.get(key) or _WORD.setdefault(key, re.compile(rf"\b{re.escape(key)}\b"))
        if rx.search(hay):
            return key
    return None


def normalise(row: dict) -> tuple[dict | None, str]:
    """One schema row, or (None, reason) for a row we will not stand behind."""
    try:
        price = float(row["price_raw"])
    except (TypeError, ValueError, KeyError):
        return None, "price unreadable"
    if price <= 0:
        return None, "price is zero"          # two goswadeshi rows; zero is not a price
    if not row.get("url") or not row.get("seen_on"):
        return None, "no url or no seen_on"

    hay = _haystack(row)
    specs = row.get("specs") or {}
    title = (row.get("raw_title") or "").lower().replace("_", " ").replace("-", " ")

    # The title is asked first and on its own. Searching everything at once and taking the
    # longest match made a saree titled "khandua" come back as nuapatna, because a longer
    # weave name sat in the seller's tags. The title is what the seller says this piece is.
    weave, label_source = _first(WEAVES, title), "title"
    if not weave:
        # Weaker, but real: "Sambalpuri Fab" as the vendor, or an `odisha` tag. Labelled,
        # and marked, so anything trained on these can tell the two apart.
        weave, label_source = _first(WEAVES, hay), "tags"
    if not weave:
        label_source = None
    region, gi = WEAVES.get(weave, (None, False)) if weave else (None, False)

    # indiahandmade states the region as a field. Where a site does, it beats the weave
    # table, which only knows where a *tradition* comes from.
    stated = specs.get("State of Origin")
    region_state = stated or region

    # Same two rules as the weave: word boundaries, and the title before anything else.
    # A substring test over every field put 2,550 itokri rows in `basketry.mat`, because
    # "material" contains "mat".
    cat = _category(title) or _category(hay)
    l1, l2 = cat if cat else ("unknown", "unknown")

    mrp = None
    try:
        mrp = float(row["mrp_raw"]) if row.get("mrp_raw") else None
    except (TypeError, ValueError):
        mrp = None
    if mrp is not None and mrp <= price:
        mrp = None                            # a struck-through price below the asking price is not an MRP

    pack = PACK.search(row.get("raw_title", ""))
    tags = [t.lower() for t in (specs.get("tags") or [])]

    return {
        "row_id": row["row_id"],
        "source": row["source"],
        "url": row["url"],
        "seen_on": row["seen_on"],
        "scrape_run_id": row.get("scrape_run_id", ""),
        "raw_title": row.get("raw_title", ""),

        "price": int(round(price)),
        "mrp": int(round(mrp)) if mrp else None,
        "discount_pct": round(100 * (mrp - price) / mrp, 1) if mrp else None,

        "category_l1": l1,
        "category_l2": l2,
        "category_l3_weave": weave,
        "weave_label_source": label_source,
        "category": ".".join(p for p in (l1, l2, weave) if p and p != "unknown"),
        "gi_tagged": bool(gi),
        "region_state": region_state,
        "region_cluster": specs.get("vendor") or None,
        "material": _first(MATERIALS, hay),
        "technique": TECHNIQUES.get(_first(TECHNIQUES, hay) or "", None),
        "seller_type": "cooperative" if row["source"] == "goswadeshi" else "brand",
        "market_type": "d2c_retail",

        # 5% of rows are "Combo Pack of 5" — one price covering several objects. Kept with
        # the count rather than dropped, because a pack is a real listing; the model must
        # not read it as one very cheap door mat.
        "pack_size": int(pack.group(1)) if pack else 1,
        # goswadeshi tags 5,915 rows "wholesale". Their median price is HIGHER than the
        # retail rows, so it marks stock offered in bulk, not a bulk discount. Recorded as
        # a flag; not dropped, and not assumed to mean cheap.
        "wholesale_flag": "wholesale" in tags,
        "weight_g": specs.get("grams") or None,
        "variant_prices_differ": bool(specs.get("variant_prices_differ")),
    }, ""


def run(write_observed: bool) -> None:
    files = sorted(glob.glob(str(OUT / "listings.*.jsonl")))
    files = [f for f in files if "normalised" not in f]
    if not files:
        sys.exit("no out/listings.*.jsonl — run the scrapers first")

    rows, drops, seen_url, seen_sku = [], Counter(), set(), set()
    for path in files:
        for line in open(path, encoding="utf-8"):
            raw = json.loads(line)
            if raw["url"] in seen_url:
                drops["duplicate url"] += 1
                continue
            seen_url.add(raw["url"])
            # SKU, not (title, price): 24 goswadeshi rows share one generic title with 24
            # distinct SKUs, 24 images and 16 prices. They are 24 different sarees, and the
            # title key would delete the mid-priced handloom band F3 lives in.
            key = (raw["source"], raw.get("sku"))
            if raw.get("sku") and key in seen_sku:
                drops["duplicate sku within source"] += 1
                continue
            seen_sku.add(key)

            row, why = normalise(raw)
            if row is None:
                drops[why] += 1
                continue
            rows.append(row)

    out_path = OUT / "listings.normalised.jsonl"
    with out_path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"{len(rows)} rows -> {out_path}")
    for why, n in drops.most_common():
        print(f"  dropped {n:6}  {why}")
    labelled = sum(1 for r in rows if r["category_l3_weave"])
    print(f"  weave-level label on {labelled} rows ({100 * labelled // max(len(rows), 1)}%)")
    print(f"  region on {sum(1 for r in rows if r['region_state'])} rows")
    print(f"  category unknown on {sum(1 for r in rows if r['category_l1'] == 'unknown')} rows")

    if write_observed:
        merge_observed(rows)


def merge_observed(rows: list[dict]) -> None:
    """Add the scraped rows to observed.csv without touching what is already in it.

    observed.csv is gitignored and holds 144 rows somebody collected by hand. Those rows
    are read back and rewritten verbatim; nothing here edits or reorders them."""
    existing, urls = [], set()
    if OBSERVED.exists():
        existing = list(csv.DictReader(OBSERVED.open()))
        urls = {r["url_or_note"].split(" ")[0] for r in existing}

    added = 0
    with OBSERVED.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["category", "source", "price", "url_or_note", "seen_on"])
        w.writeheader()
        w.writerows(existing)
        for r in rows:
            if r["url"] in urls or not r["category"] or r["category_l1"] == "unknown":
                continue
            # A pack of five is one listing at one price, and observed.csv has no column to
            # say so. Only single items go into the comparables.
            if r["pack_size"] != 1:
                continue
            w.writerow({"category": r["category"], "source": r["source"], "price": r["price"],
                        "url_or_note": r["url"], "seen_on": r["seen_on"]})
            added += 1
    print(f"observed.csv: {len(existing)} kept, {added} added -> {OBSERVED}")


def selfcheck() -> None:
    row = {"row_id": "x", "source": "goswadeshi", "url": "u", "seen_on": "2026-09-03",
           "raw_title": "Multicolor Black Cotton Handloom Sambalpuri Saree",
           "raw_description": "", "price_raw": "9150.40", "mrp_raw": "12000.00", "sku": "s1",
           "specs": {"vendor": "Boyanika", "tags": ["Saree", "wholesale"], "grams": 800},
           "image_urls": []}
    r, _ = normalise(row)
    assert r["price"] == 9150 and r["mrp"] == 12000, r
    assert r["category"] == "textiles.saree.sambalpuri", r["category"]
    assert r["region_state"] == "Odisha" and r["gi_tagged"] is True
    assert r["material"] == "cotton" and r["technique"] == "handloom"
    assert r["wholesale_flag"] is True and r["pack_size"] == 1

    # A stated region beats the weave table's guess about where a tradition lives.
    ih = dict(row, source="indiahandmade", specs={"State of Origin": "Surat", "tags": []})
    assert normalise(ih)[0]["region_state"] == "Surat"

    # Packs keep their count, so a pack of five is never read as one cheap object.
    pk = dict(row, raw_title="Handmade Handloom Door Mat | Combo Pack of 5", price_raw="149")
    assert normalise(pk)[0]["pack_size"] == 5

    # Longest match wins, or 'kota doria' resolves as 'kota'.
    kd = dict(row, raw_title="Kota Doria Cotton Saree")
    assert normalise(kd)[0]["category_l3_weave"] == "kota doria"
    assert normalise(kd)[0]["weave_label_source"] == "title"

    # "material" contains "mat"; a dress material is not a floor mat.
    dm = dict(row, raw_title="Blue cotton dress material", specs={"tags": []})
    assert normalise(dm)[0]["category_l2"] == "dress-material", normalise(dm)[0]["category_l2"]

    # Word boundaries, not substrings: "material" contains the letters of Assam "eri".
    mat = dict(row, raw_title="Plain cotton fabric", specs={"Material": "cotton", "tags": []})
    assert normalise(mat)[0]["category_l3_weave"] is None, normalise(mat)[0]["category_l3_weave"]

    # A weave that appears only in the vendor name is labelled, and marked as weaker.
    ven = dict(row, raw_title="Black cotton handwoven fabric",
               specs={"vendor": "Sambalpuri Fab", "tags": []})
    assert normalise(ven)[0]["weave_label_source"] == "tags"

    # The title wins over a longer weave name in the tags: this is a khandua, not a nuapatna.
    kh = dict(row, raw_title="Pink orange silk handloom khandua saree",
              specs={"vendor": "Boyanika", "tags": ["nuapatna"]})
    assert normalise(kh)[0]["category_l3_weave"] == "khandua", normalise(kh)[0]

    assert normalise(dict(row, price_raw="0.00"))[0] is None
    assert normalise(dict(row, price_raw=None))[0] is None
    # An MRP at or below the asking price is not an MRP.
    assert normalise(dict(row, mrp_raw="9000.00"))[0]["mrp"] is None
    print("selfcheck ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--observed", action="store_true", help="merge into research/pricing/observed.csv")
    ap.add_argument("--selfcheck", action="store_true")
    a = ap.parse_args()
    selfcheck() if a.selfcheck else run(a.observed)
