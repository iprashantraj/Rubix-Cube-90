#!/usr/bin/env python3
"""Turn collected listing prices into the comps seed, and check the floor against them.

Two subcommands, and they are the two halves of the open `pricing` experiment in
research/RESULTS.md:

    python3 research/pricing/pricing.py build     observed.csv -> ai/price/comps_seed.json
    python3 research/pricing/pricing.py check     does cost-up land near real prices?

`build` is bookkeeping. `check` is the experiment: it takes the prices somebody observed and
asks whether the floor our formula computes sits inside, above, or below them — which is the
question `RESULTS.md` has had open since the file was created.

Stdlib only, like ai/price/compute.py, and for the same reason: this decides money, and the
answer has to survive "how did you get that?" without a dependency tree in the explanation.

The input is research/pricing/observed.csv, which is GITIGNORED and which a human writes.
Nothing in this file invents a price. See README.md for why that rule is absolute.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent.parent
OBSERVED = HERE / "observed.csv"
SEED = REPO / "ai" / "price" / "comps_seed.json"

SOURCES = {"indiahandmade", "amazon", "flipkart", "gem"}  # `market` is queried live, never seeded
COLUMNS = ["category", "source", "price", "url_or_note", "seen_on"]


def _load_rows() -> list[dict]:
    if not OBSERVED.exists():
        sys.exit(
            f"{OBSERVED} does not exist.\n"
            f"Collect prices first — research/pricing/README.md has the protocol and the\n"
            f"header row to start from. Nothing here can generate this file for you."
        )
    with OBSERVED.open() as f:
        rows = list(csv.DictReader(f))

    missing = set(COLUMNS) - set(rows[0] if rows else {})
    if missing:
        sys.exit(f"observed.csv is missing columns: {sorted(missing)}")

    clean, problems = [], []
    for i, row in enumerate(rows, start=2):  # line 1 is the header
        try:
            price = float(row["price"])
        except (TypeError, ValueError):
            problems.append(f"  line {i}: price {row['price']!r} is not a number")
            continue
        if price <= 0:
            problems.append(f"  line {i}: price {price} — a listing at zero is not a price")
            continue
        if row["source"] not in SOURCES:
            problems.append(f"  line {i}: source {row['source']!r} not in {sorted(SOURCES)}")
            continue
        if not row.get("seen_on"):
            problems.append(f"  line {i}: no seen_on date — an undated price is not evidence")
            continue
        if not row.get("url_or_note"):
            # Provenance is the whole difference between research and a guess.
            problems.append(f"  line {i}: no url_or_note — where did this number come from?")
            continue
        clean.append({**row, "price": price})

    if problems:
        print(f"{len(problems)} unusable row(s):", *problems, sep="\n")
    if not clean:
        sys.exit("nothing usable in observed.csv")
    return clean


def build(args) -> None:
    rows = _load_rows()

    by_cat: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        by_cat[row["category"]][row["source"]].append(row["price"])

    seed = json.loads(SEED.read_text())
    seed["collected"] = max(r["seen_on"] for r in rows)
    seed["collector"] = args.collector
    seed["categories"] = {
        cat: {src: sorted(prices) for src, prices in sorted(sources.items())}
        for cat, sources in sorted(by_cat.items())
    }
    SEED.write_text(json.dumps(seed, indent=2, ensure_ascii=False) + "\n")

    print(f"wrote {SEED.relative_to(REPO)}")
    for cat, sources in sorted(by_cat.items()):
        counts = ", ".join(f"{s} {len(p)}" for s, p in sorted(sources.items()))
        total = sum(len(p) for p in sources.values())
        thin = "   ⚠️  under 10 — a range from this is thin" if total < 10 else ""
        print(f"  {cat:38} {counts}{thin}")


def check(args) -> None:
    """The experiment: does cost-up land near real listing prices?

    Reads the same observed prices and asks, per category, where our floor sits relative to
    them. Three outcomes and all three are publishable:

      floor inside the observed spread    the model is calibrated. Say so, with the number.
      floor ABOVE everything observed     either our wage rate is too high, or the market
                                          genuinely pays below cost. The second is the
                                          finding this whole feature exists to expose, and
                                          it is a better slide than a working algorithm.
      floor BELOW everything observed     we are leaving money on the table and the floor
                                          is not protecting anyone.
    """
    sys.path.insert(0, str(REPO / "ai"))
    from price.compute import floor_price  # noqa: E402  — path set above

    rows = _load_rows()
    by_cat: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        by_cat[row["category"]].append(row["price"])

    floor = floor_price(args.material_cost, args.labour_hours, args.cluster)
    print(
        f"floor for {args.labour_hours}h + ₹{args.material_cost:g} materials "
        f"in {args.cluster}: ₹{floor:,}\n"
    )
    print(f"{'category':38} {'n':>3} {'median':>9} {'p10':>9} {'p90':>9}  verdict")

    for cat, prices in sorted(by_cat.items()):
        prices.sort()
        n = len(prices)
        p10 = prices[max(0, int(n * 0.10) - 1)]
        p90 = prices[min(n - 1, int(n * 0.90))]
        median = statistics.median(prices)

        if floor > p90:
            verdict = "floor ABOVE the market — market may pay below cost"
        elif floor < p10:
            verdict = "floor BELOW the market — under-protecting"
        else:
            verdict = "floor inside the observed spread"
        if n < 10:
            verdict += f"  (n={n}, too thin to conclude)"
        print(f"{cat:38} {n:>3} {median:>9,.0f} {p10:>9,.0f} {p90:>9,.0f}  {verdict}")

    print(
        "\nRecord the outcome in research/RESULTS.md with today's date. A verdict without a\n"
        "date is not a verdict."
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="observed.csv -> ai/price/comps_seed.json")
    b.add_argument("--collector", default="", help="who collected it, for the record")
    b.set_defaults(func=build)

    c = sub.add_parser("check", help="does the cost-up floor land near real prices?")
    c.add_argument("--material-cost", type=float, default=800)
    c.add_argument("--labour-hours", type=float, default=160)
    c.add_argument("--cluster", default="sambalpur")
    c.set_defaults(func=check)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
