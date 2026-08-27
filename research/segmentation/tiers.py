"""Score the tier thresholds against seg-v1.

`pipeline.mask_confidence()` demotes a mask on three shape signals. The numbers behind
those signals came from the reconciliation, where they were reasoned about rather than
measured. This checks them against the 41 masks BiRefNet actually produced.

There is no ground truth here either, so the labels below are mine, assigned by looking at
the contact sheets in `out/`. That is a weaker instrument than a measurement and it is
stated plainly rather than dressed up: what it can establish is whether the thresholds
separate masks a person would reject from masks a person would ship, on this set.

    ai/.venv/bin/python research/segmentation/tiers.py
    ai/.venv/bin/python research/segmentation/tiers.py --grid   # search better values
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ai"))

from enhance import metrics, pipeline  # noqa: E402

ALPHA = Path(__file__).parent / "out" / "birefnet" / "alpha"
SETFILE = Path(__file__).parent / "seg-v1.txt"

# Masks a person would not ship, and why. Assigned by eye from the contact sheets.
BAD = {
    "291e88c5-3d23-4344-af53-e3e865c22165.jpeg": "frame-filling saree — arbitrary chunk cut from the middle",
    "b4b717b2-c087-43a2-beb3-ba37ad5a9d8b.jpeg": "frame-filling textile — same failure",
    "textile-shawl-fringe-03.jpg": "cream linen on white — kept the fringe, threw the cloth away",
    "pottery-blackware-darkfloor-01.jpg": "museum case, many objects, no single product",
    "pottery-earthen-sharp-02.jpg": "row of pots on a rail",
    "textile-blockprint-patterned-02.jpg": "shop interior, stacked textiles",
    "pottery-potter-indoor-01.jpg": "person at a wheel, product barely present",
}


def names():
    return [l.strip() for l in SETFILE.read_text().splitlines()
            if l.strip() and not l.lstrip().startswith("#")]


def load_signals():
    rows = []
    for n in names():
        p = ALPHA / f"{Path(n).stem}.png"
        if not p.exists():
            continue
        a = np.asarray(Image.open(p).convert("L"), np.float32) / 255.0
        rows.append((n, pipeline.mask_signals(a)))
    return rows


def evaluate(rows, t):
    """Returns (caught, missed, demoted_good) under one set of thresholds."""
    caught, missed, demoted = [], [], []
    for n, s in rows:
        score = 1.0
        if s["uncertain"] > t["mask_uncertain_fraction_max"]:
            score -= 0.4
        if s["blobs"] > t["mask_blob_count_max"]:
            score -= 0.3
        if s["area"] <= t["mask_area_min"] or s["area"] >= t["mask_area_max"]:
            score -= 0.3
        score = max(score, 0.0)
        is_a = score >= t["tier_a_confidence_min"]
        if n in BAD:
            (missed if is_a else caught).append((n, score))
        elif not is_a:
            demoted.append((n, score))
    return caught, missed, demoted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", action="store_true")
    args = ap.parse_args()

    rows = load_signals()
    t = dict(metrics.thresholds())
    print(f"{len(rows)} masks, {len(BAD)} labelled unshippable\n")

    print(f"{'image':<46}{'area':>8}{'uncert':>8}{'blobs':>7}   verdict")
    for n, s in rows:
        score = evaluate([(n, s)], t)
        tag = "BAD " if n in BAD else "    "
        sc = 1.0
        if s["uncertain"] > t["mask_uncertain_fraction_max"]: sc -= 0.4
        if s["blobs"] > t["mask_blob_count_max"]: sc -= 0.3
        if s["area"] <= t["mask_area_min"] or s["area"] >= t["mask_area_max"]: sc -= 0.3
        sc = max(sc, 0.0)
        tier = "A" if sc >= t["tier_a_confidence_min"] else ("B" if sc >= t["tier_b_confidence_min"] else "C")
        print(f"{tag}{n:<42}{s['area']:>8.3f}{s['uncertain']:>8.4f}{s['blobs']:>7}   {sc:.2f} {tier}")

    caught, missed, demoted = evaluate(rows, t)
    print(f"\ncurrent thresholds: caught {len(caught)}/{len(BAD)} bad, "
          f"missed {len(missed)}, demoted {len(demoted)} good masks")
    for n, s in missed:
        print(f"  MISSED  {n}  ({BAD[n]})")
    for n, s in demoted:
        print(f"  demoted {n}  score {s:.2f}")

    if not args.grid:
        return
    print("\nsearching...")
    best = None
    for amin in [0.02, 0.05, 0.08, 0.10, 0.15]:
        for amax in [0.80, 0.85, 0.90, 0.95, 0.98]:
            for unc in [0.04, 0.06, 0.08, 0.12]:
                for blob in [2, 3, 4, 6]:
                    c, m, d = evaluate(rows, dict(
                        mask_area_min=amin, mask_area_max=amax,
                        mask_uncertain_fraction_max=unc, mask_blob_count_max=blob,
                        tier_a_confidence_min=t["tier_a_confidence_min"]))
                    key = (len(m), len(d))
                    if best is None or key < best[0]:
                        best = (key, dict(mask_area_min=amin, mask_area_max=amax,
                                          mask_uncertain_fraction_max=unc,
                                          mask_blob_count_max=blob), c, m, d)
    (nm, nd), cfg, c, m, d = best
    print(f"best: missed {nm}, demoted {nd}  ->  {cfg}")
    for n, s in m:
        print(f"  still missed  {n}")
    for n, s in d:
        print(f"  still demoted {n}")


if __name__ == "__main__":
    main()
