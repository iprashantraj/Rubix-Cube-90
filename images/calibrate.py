"""Turn images/out/metrics.csv into a verdict on each threshold in ai/thresholds.json.

    python3 images/calibrate.py            # what the current numbers do to the set
    python3 images/calibrate.py --sweep    # the curve behind each number

`check.py` measures. This scores those measurements against ground truth and answers the
only question that moves a threshold: **how many images does it get wrong, and in which
direction?** It reads the CSV rather than the photographs, so it is instant and can be run
as many times as an argument needs.

Ground truth comes from the filename, and it is real ground truth rather than a label
somebody eyeballed:

  `*-bad-<kind>-*`  made by degrade.py from a clean fixture with recorded parameters. The
                    gate must reject these, and must say the right thing about them.
  everything else   a photograph somebody chose to publish. Not guaranteed beautiful, but
                    the gate refusing one is a false reject unless there is a reason.

Two verdicts are computed for every image, because the pipeline has two gates and they see
different pixels: the capture gate at 240x180 (what `gate.js` decides on the phone) and the
server gate at full resolution. Where those two disagree is the interesting part.

The messages matter as much as the pass/fail. An artisan who may not read gets one spoken
instruction, so rejecting an underexposed photo for being blurry is a failure even though
the reject was correct — they will hold the phone stiller in the same bad light, forever.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter, defaultdict

import check

# Which message each degradation is supposed to produce. degrade.py's kind -> the verdict
# find_problem() should return. A reject with any other message is a wrong-reason reject.
RIGHT_MESSAGE = {
    "motion": {"blurry"},
    "defocus": {"blurry"},
    "underexposed": {"too_dark", "too_dark (crushed shadows)"},
    "overexposed": {"too_bright", "too_bright (blown highlights)"},
    "toofar": {"too_far"},
    "offcentre": {"off_centre"},
}


def load() -> list[dict]:
    if not check.METRICS.exists():
        sys.exit(f"No {check.METRICS}. Run: python3 images/check.py")
    with check.METRICS.open() as f:
        return list(csv.DictReader(f))


def label(name: str) -> tuple[str | None, set[str]]:
    """(degradation kind or None, condition tokens). None kind means it should pass."""
    tokens = set(name.lower().replace(".", "-").split("-"))
    if "bad" in tokens:
        for kind in RIGHT_MESSAGE:
            if kind in tokens:
                return kind, tokens & set(check.COVERAGE)
        return "unknown", set()
    return None, tokens & set(check.COVERAGE)


def metrics(r: dict, where: str) -> dict:
    """The dict find_problem() wants, built from either the gate or the full-res columns."""
    suffix = "gate" if where == "gate" else "full"
    return {
        "blur_gate": float(r[f"blur_{suffix}"]),
        "exposure_gate": {
            "mean": float(r[f"mean_{suffix}"]),
            "blown": float(r[f"blown_{suffix}"]),
            "crushed": float(r[f"crushed_{suffix}"]),
        },
        # Framing is only ever measured on the 12x9 grid of the downscale — the server has
        # no better version of it, and gate.js's grid is the definition.
        "framing": {
            "found": bool(int(r["found"])), "fraction": float(r["fill"]),
            "offset_x": float(r["offset_x"]), "offset_y": float(r["offset_y"]),
        },
    }


def sweep(rows: list[dict], col: str, key: str, candidates: list[float],
          worse: str, t: dict) -> None:
    """One threshold at a time, everything else held at its current value.

    `worse` says which side of the number is a reject: 'below' for blur and brightness
    minimums, 'above' for the clipped-pixel fractions.
    """
    bad = [r for r in rows if label(r["name"])[0]]
    good = [r for r in rows if not label(r["name"])[0]]
    print(f"\n  {key}  (current {t[key]})")
    print(f"    {'value':>10} {'catches bad':>12} {'rejects good':>14}")
    for v in candidates:
        def rejects(r: dict) -> bool:
            x = float(r[col])
            return x < v if worse == "below" else x > v
        nb, ng = sum(map(rejects, bad)), sum(map(rejects, good))
        mark = "  <- current" if abs(v - t[key]) < 1e-9 else ""
        print(f"    {v:>10.4g} {nb:>7}/{len(bad):<4} {ng:>9}/{len(good):<4}{mark}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sweep", action="store_true", help="the curve behind each threshold")
    args = ap.parse_args()

    t = check.thresholds()
    rows = load()
    print(f"{len(rows)} measured images · thresholds from ai/thresholds.json\n")

    caught = {"gate": Counter(), "server": Counter()}
    wrong_message = {"gate": defaultdict(list), "server": defaultdict(list)}
    missed = {"gate": defaultdict(list), "server": defaultdict(list)}
    bad_total: Counter = Counter()
    false_reject = {"gate": defaultdict(list), "server": defaultdict(list)}
    clean_total: Counter = Counter()

    for r in rows:
        kind, conds = label(r["name"])
        verdicts = {
            "gate": check.find_problem(metrics(r, "gate"), t),
            "server": check.find_problem(metrics(r, "server"), t,
                                         "blur_laplacian_variance_reject_min"),
        }
        if kind:
            bad_total[kind] += 1
            for w, v in verdicts.items():
                if v is None:
                    missed[w][kind].append(r["name"])
                elif v in RIGHT_MESSAGE.get(kind, set()):
                    caught[w][kind] += 1
                else:
                    wrong_message[w][kind].append((r["name"], v))
        else:
            for c in conds or {"untagged"}:
                clean_total[c] += 1
            for w, v in verdicts.items():
                if v:
                    for c in conds or {"untagged"}:
                        false_reject[w][c].append((r["name"], v))

    print("Does the gate catch the known-bad fixtures, and does it say the right thing?")
    print(f"  {'degradation':<14} {'n':>4}   {'capture gate (240x180)':<26} {'server gate (full res)':<26}")
    for kind in sorted(bad_total):
        cells = []
        for w in ("gate", "server"):
            miss, wrongm = len(missed[w][kind]), len(wrong_message[w][kind])
            cells.append(f"{caught[w][kind]:>2} right, {wrongm:>2} wrong msg, {miss:>2} MISSED")
        print(f"  {kind:<14} {bad_total[kind]:>4}   {cells[0]:<26} {cells[1]:<26}")

    print("\nDoes it let the good photographs through? (a reject here is a false reject)")
    print(f"  {'condition':<14} {'n':>4}   {'capture gate':<14} {'server gate':<14}")
    for c in sorted(clean_total):
        g, s = len(false_reject["gate"][c]), len(false_reject["server"][c])
        print(f"  {c:<14} {clean_total[c]:>4}   {g:>3} rejected   {s:>3} rejected")

    print("\nWhy the good ones were rejected — the reason is the threshold to argue with:")
    for w in ("gate", "server"):
        reasons = Counter(v for lst in false_reject[w].values() for _, v in lst)
        print(f"  {w:<7} " + (", ".join(f"{k} x{n}" for k, n in reasons.most_common()) or "none"))

    print("\nBad fixtures the capture gate lets through entirely:")
    for kind in sorted(missed["gate"]):
        names = missed["gate"][kind]
        also = [n for n in names if n in missed["server"][kind]]
        print(f"  {kind:<14} {len(names):>3} missed at capture, {len(also):>3} of those missed by the server too")

    if args.sweep:
        print("\n" + "=" * 72)
        print("Threshold sweeps. Each row: hold everything else, move this one number.")
        sweep(rows, "blur_gate", "blur_laplacian_variance_min",
              [20, 50, 80, 100, 150, 200, 300, 500], "below", t)
        sweep(rows, "blur_full", "blur_laplacian_variance_min",
              [20, 50, 80, 100, 150, 200, 300, 500], "below", t)
        sweep(rows, "mean_gate", "brightness_mean_min", [30, 40, 50, 60, 70, 80], "below", t)
        sweep(rows, "mean_gate", "brightness_mean_max", [180, 190, 200, 210, 220], "above", t)
        sweep(rows, "blown_gate", "blown_pixel_fraction_max",
              [0.01, 0.02, 0.05, 0.08, 0.12, 0.2], "above", t)
        sweep(rows, "crushed_gate", "crushed_pixel_fraction_max",
              [0.01, 0.02, 0.05, 0.08, 0.12, 0.2], "above", t)
        sweep(rows, "fill", "fill_fraction_min", [0.15, 0.25, 0.3, 0.4, 0.5], "below", t)
        sweep(rows, "fill", "fill_fraction_max", [0.75, 0.85, 0.9, 0.95, 0.99, 1.0], "above", t)

    print("\nA number only moves when a named fixture justifies it. Log it in research/RESULTS.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
