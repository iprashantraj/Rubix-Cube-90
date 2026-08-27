"""
Recompute the cross-model numbers from every alpha matte on disk.

bench.py computes consensus only across the models in one invocation. The models
here do not all install cleanly in one go — the torch ones and the onnxruntime ones
arrived separately — so the benchmark ran in batches. This reads every
out/<model>/alpha/*.png that exists, whichever run produced it, and writes the
combined table.

Run it after the last batch finishes.

Usage:  ai/.venv/bin/python research/segmentation/consolidate.py
"""
from __future__ import annotations

import csv
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

OUT = Path(__file__).parent / "out"
SETFILE = Path(__file__).parent / "seg-v1.txt"


def set_names() -> list[str]:
    return [ln.strip() for ln in SETFILE.read_text().splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")]


def measures(a: np.ndarray) -> dict:
    fg = (a > 0.5).astype(np.uint8)
    n_comp, _ = cv2.connectedComponents(fg)
    inv = (1 - fg).astype(np.uint8)
    n_bg, bgl = cv2.connectedComponents(inv)
    border = (set(bgl[0, :]) | set(bgl[-1, :]) | set(bgl[:, 0]) | set(bgl[:, -1]))
    return dict(
        fg_fraction=round(float(fg.mean()), 4),
        soft_edge_fraction=round(float(np.count_nonzero((a > 0.05) & (a < 0.95)) / a.size), 5),
        components=int(n_comp - 1),
        holes=int(sum(1 for i in range(1, n_bg) if i not in border)),
    )


def main():
    models = sorted(p.name for p in OUT.iterdir() if (p / "alpha").is_dir())
    if not models:
        raise SystemExit(f"no alpha output under {OUT}")
    print("models:", ", ".join(models))

    rows = []
    for name in set_names():
        stem = Path(name).stem
        alphas = {}
        for m in models:
            p = OUT / m / "alpha" / f"{stem}.png"
            if p.exists():
                alphas[m] = np.asarray(Image.open(p).convert("L"), np.float32) / 255.0

        # every mask is stored at the source image's size, so shapes agree
        stack = {m: (a > 0.5) for m, a in alphas.items()}
        for m, a in alphas.items():
            row = dict(image=name, model=m, **measures(a))
            if len(stack) >= 3:
                others = np.stack([v for k, v in stack.items() if k != m])
                majority = others.sum(0) > (others.shape[0] / 2)
                mine = stack[m]
                union = np.count_nonzero(majority | mine)
                row["consensus_iou"] = round(float(np.count_nonzero(majority & mine) / union), 4) if union else 1.0
            rows.append(row)

    cols = ["image", "model", "fg_fraction", "soft_edge_fraction",
            "components", "holes", "consensus_iou"]
    dest = OUT / "consolidated.csv"
    with open(dest, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    print(f"wrote {dest} ({len(rows)} rows)")

    # per-model summary
    print(f"\n{'model':<16}{'n':>4}{'mean IoU':>10}{'soft edge':>11}{'mean fg':>9}{'holes':>7}")
    for m in models:
        r = [x for x in rows if x["model"] == m]
        if not r:
            continue
        iou = [x["consensus_iou"] for x in r if "consensus_iou" in x]
        print(f"{m:<16}{len(r):>4}"
              f"{(sum(iou)/len(iou) if iou else float('nan')):>10.3f}"
              f"{sum(x['soft_edge_fraction'] for x in r)/len(r):>11.4f}"
              f"{sum(x['fg_fraction'] for x in r)/len(r):>9.3f}"
              f"{sum(x['holes'] for x in r)/len(r):>7.1f}")


if __name__ == "__main__":
    main()
