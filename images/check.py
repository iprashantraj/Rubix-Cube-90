"""Score the fixture set in images/raw against ai/thresholds.json.

    python3 images/check.py                 # table + set coverage
    python3 images/check.py --verbose       # every metric, per image
    python3 images/check.py --resume        # skip what images/out/metrics.csv already has

Answers two questions, and only these two:

  1. Is this set usable? Does it cover the conditions that actually break the pipeline,
     and is each image big enough and real enough to measure?
  2. What do the current thresholds do to it? Which images the gate would reject, and
     whether each rejection is correct.

The metrics mirror `app/src/camera/gate.js` exactly — same Rec.601 luma, same Laplacian
kernel, same 12x9 grid, same busiest-cell-relative cutoff — so a number printed here is
the number the phone would compute. Divergence here is a bug, not a variant.

Every run writes `images/out/metrics.csv`, one row per image, flushed as it goes. Decoding
the set is the expensive part — 1.5 gigapixels — and nothing about calibration is answered
in one pass, so the numbers are written down rather than recomputed. `--resume` picks up
from that file, which also means an interrupted run costs only the images it had left.

Deliberately numpy + Pillow only. No OpenCV: nothing below needs it, and the point of this
script is that it runs before anyone has set up an environment.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
RAW = ROOT / "raw"
OUT = ROOT / "out"
METRICS = OUT / "metrics.csv"

# The app gate runs on a 240x180 downscale (gate.js header). Blur measured at full
# resolution is a different number entirely, so both are reported: full-res is what the
# server gate will see, 240x180 is what the phone saw when it decided to open the shutter.
GATE_W, GATE_H = 240, 180
GRID_COLS, GRID_ROWS = 12, 9

# From images/README.md. A set missing one of these cannot calibrate the threshold beside
# it — the images that only look nice prove nothing.
COVERAGE = {
    "sharp": "plain/low-texture subject, sharp — decides whether blur can ever hard-block",
    "darkfloor": "dark product on a dark background — crushed_pixel_fraction_max",
    "specular": "brass/zari/mirror-work highlights — blown_pixel_fraction_max",
    "indoor": "indoor or evening light — brightness_mean_min, the lockout case",
    "fringe": "fringed or netted textile — segmentation confidence floor",
    "patterned": "patterned floor or rug behind the product — cell_busy_ratio",
    "whitepaper": "white reference sheet in frame — the white-balance path",
    "bad": "a genuinely bad photo the gate must reject",
}


def thresholds() -> dict:
    """The one file. Never a second copy — see docs/app/Camera-Pipeline.md §0."""
    raw = json.loads((REPO / "ai" / "thresholds.json").read_text())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


# Full resolution is where the memory goes. The obvious implementation — decode, convert
# the whole thing to a float64 RGB array, take the luma — peaks near 1.5GB on the 22MP
# fixtures in this set, and this machine has no swap to absorb that. Nothing measured at
# full resolution needs the whole image at once: Laplacian variance and the exposure
# histogram are both reductions. So they are accumulated over horizontal bands and peak
# memory stays flat in the image size instead of growing with it.
#
# The 240x180 gate path below is deliberately left alone. It is 43k pixels, it costs
# nothing, and it has to match gate.js exactly.
BAND_ROWS = 256


def _band_luma(rgb: np.ndarray) -> np.ndarray:
    """Rec.601 luma for one band of uint8 RGB rows. Same arithmetic as to_gray()."""
    a = rgb.astype(np.float64)
    return (a[..., 0] * 299 + a[..., 1] * 587 + a[..., 2] * 114) / 1000


def full_res(img: Image.Image) -> tuple[float, dict]:
    """Blur score and exposure at full resolution, in bounded memory.

    Returns exactly what `blur_score(to_gray(img))` and `exposure(to_gray(img))` return —
    the band split is an implementation detail, not a different measurement. The Laplacian
    bands carry the previous band's last two rows so the kernel is never split across a
    seam, and the interiors tile rows 1..h-2 once each with no gap and no overlap.
    """
    rgb = np.asarray(img.convert("RGB"))
    h, w = rgb.shape[0], rgb.shape[1]

    q_n = q_sum = blown = crushed = 0          # exposure, over every pixel
    n = 0                                       # Laplacian, over the interior only
    s_lap = ss_lap = 0.0
    tail: np.ndarray | None = None

    for top in range(0, h, BAND_ROWS):
        g = _band_luma(rgb[top:min(top + BAND_ROWS, h)])

        q = np.clip(g, 0, 255).astype(np.uint8)
        q_n += q.size
        q_sum += int(q.sum(dtype=np.int64))
        blown += int(np.count_nonzero(q >= 250))
        crushed += int(np.count_nonzero(q <= 5))
        del q

        block = g if tail is None else np.vstack((tail, g))
        if block.shape[0] >= 3 and w >= 3:
            c = block[1:-1, 1:-1]
            lap = block[:-2, 1:-1] + block[2:, 1:-1] + block[1:-1, :-2] + block[1:-1, 2:] - 4 * c
            n += lap.size
            s_lap += float(lap.sum(dtype=np.float64))
            ss_lap += float(np.square(lap).sum(dtype=np.float64))
            del c, lap
        tail = g[-2:].copy()
        del g, block

    mean_lap = s_lap / n if n else 0.0
    blur = (ss_lap / n - mean_lap * mean_lap) if n else 0.0
    return max(blur, 0.0), {
        "mean": q_sum / q_n if q_n else 0.0,
        "blown": blown / q_n if q_n else 0.0,
        "crushed": crushed / q_n if q_n else 0.0,
    }


def sha_of(path: Path) -> str:
    """Streamed, so a 7MB fixture is not held twice for the sake of twelve hex digits."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def to_gray(img: Image.Image) -> np.ndarray:
    """Rec.601 luma, matching useCameraGate.js:21. Not PIL's 'L', which rounds differently."""
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    return (a[..., 0] * 299 + a[..., 1] * 587 + a[..., 2] * 114) / 1000


def blur_score(gray: np.ndarray) -> float:
    """Variance of the Laplacian response. High = sharp. gate.js:21."""
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    c = gray[1:-1, 1:-1]
    lap = gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:] - 4 * c
    return float(lap.var())


def exposure(gray: np.ndarray) -> dict:
    """gate.js:44. Blown and crushed matter more than the mean — a clipped highlight holds
    no information at all and nothing downstream recovers it."""
    q = np.clip(gray, 0, 255).astype(np.uint8)
    n = q.size
    return {
        "mean": float(q.mean()),
        "blown": float(np.count_nonzero(q >= 250) / n),
        "crushed": float(np.count_nonzero(q <= 5) / n),
    }


def framing(gray: np.ndarray, busy_ratio: float) -> dict:
    """gate.js:70. Not object detection — where something is *happening*. The cutoff is
    relative to the busiest cell, which is why a dark matka and a bright dupatta both work."""
    h, w = gray.shape
    xs = [(c * w) // GRID_COLS for c in range(GRID_COLS + 1)]
    ys = [(r * h) // GRID_ROWS for r in range(GRID_ROWS + 1)]

    cells = np.zeros((GRID_ROWS, GRID_COLS))
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            block = gray[ys[r]:ys[r + 1], xs[c]:xs[c + 1]]
            cells[r, c] = block.var() if block.size else 0.0

    max_var = cells.max()
    if max_var == 0:
        return {"found": False, "fraction": 0.0, "offset_x": 0.0, "offset_y": 0.0}

    busy = np.argwhere(cells >= max_var * busy_ratio)
    if busy.size == 0:
        return {"found": False, "fraction": 0.0, "offset_x": 0.0, "offset_y": 0.0}

    min_r, min_c = busy.min(axis=0)
    max_r, max_c = busy.max(axis=0)
    box_w = (max_c - min_c + 1) / GRID_COLS
    box_h = (max_r - min_r + 1) / GRID_ROWS
    return {
        "found": True,
        "fraction": float(box_w * box_h),
        "offset_x": abs(float((min_c + max_c + 1) / 2 / GRID_COLS) - 0.5),
        "offset_y": abs(float((min_r + max_r + 1) / 2 / GRID_ROWS) - 0.5),
    }


def backdrop(gray: np.ndarray) -> str | None:
    """Is this already a processed product shot rather than a capture?

    Samples the four corners, the same way `composite()` is specified to verify its own
    output (`ai/enhance/pipeline.py:60`). A studio or already-cut image has four flat,
    near-identical corners; a photograph taken in a courtyard does not.

    This matters because a fixture that is already the pipeline's *output* cannot test its
    *input*. A saree pre-cut onto pure white teaches a segmentation model nothing — the
    answer is baked into the pixels — and it tells the gate nothing about what a phone
    sensor produces indoors.
    """
    h, w = gray.shape
    ph, pw = max(h // 12, 2), max(w // 12, 2)
    corners = [
        gray[:ph, :pw], gray[:ph, -pw:],
        gray[-ph:, :pw], gray[-ph:, -pw:],
    ]
    if max(float(c.std()) for c in corners) > 6.0:
        return None  # real texture in at least one corner
    means = [float(c.mean()) for c in corners]
    if max(means) - min(means) > 12.0:
        return None  # a gradient or a lit backdrop, not a flat fill
    if min(means) > 235:
        return "already on white"
    if max(means) < 45:
        return "black studio backdrop"
    return "flat studio backdrop"


def find_problem(m: dict, t: dict, blur_key: str = "blur_laplacian_variance_min") -> str | None:
    """gate.js:180, minus the tilt rungs — a still image carries no accelerometer reading.

    One problem, highest priority first. Light before everything else: every other check is
    meaningless in the dark.

    `blur_key` is the one place the two gates differ. The capture gate uses the default and
    is an exact mirror of gate.js; the server gate passes
    `blur_laplacian_variance_reject_min`, because it measures full-resolution pixels and is
    the only one of the two allowed to hard-reject on blur.
    """
    e = m["exposure_gate"]
    if e["mean"] < t["brightness_mean_min"]:
        return "too_dark"
    if e["crushed"] > t["crushed_pixel_fraction_max"]:
        return "too_dark (crushed shadows)"
    if e["mean"] > t["brightness_mean_max"]:
        return "too_bright"
    if e["blown"] > t["blown_pixel_fraction_max"]:
        return "too_bright (blown highlights)"
    if m["blur_gate"] < t[blur_key]:
        return "blurry"
    f = m["framing"]
    if not f["found"] or f["fraction"] < t["fill_fraction_min"]:
        return "too_far"
    if f["fraction"] > t["fill_fraction_max"]:
        return "too_close"
    if max(f["offset_x"], f["offset_y"]) > t["center_offset_max"]:
        return "off_centre"
    return None


def measure(path: Path, t: dict) -> dict:
    with Image.open(path) as img:
        w, h = img.size
        gate = to_gray(img.resize((GATE_W, GATE_H), Image.BILINEAR))
        blur_full, exp_full = full_res(img)
    return {
        "name": path.name,
        "w": w,
        "h": h,
        "bytes": path.stat().st_size,
        "blur_full": blur_full,
        "blur_gate": blur_score(gate),
        "exposure_full": exp_full,
        "exposure_gate": exposure(gate),
        "framing": framing(gate, t["cell_busy_ratio"]),
        "backdrop": backdrop(gate),
        "sha": sha_of(path),
    }


CSV_FIELDS = [
    "name", "w", "h", "bytes", "sha",
    "blur_full", "blur_gate",
    "mean_full", "blown_full", "crushed_full",
    "mean_gate", "blown_gate", "crushed_gate",
    "found", "fill", "offset_x", "offset_y",
    "backdrop", "problem", "under_min_px",
]


def csv_row(m: dict, problem: str | None, small: bool) -> dict:
    ef, eg, f = m["exposure_full"], m["exposure_gate"], m["framing"]
    return {
        "name": m["name"], "w": m["w"], "h": m["h"], "bytes": m["bytes"], "sha": m["sha"],
        "blur_full": round(m["blur_full"], 3), "blur_gate": round(m["blur_gate"], 3),
        "mean_full": round(ef["mean"], 3), "blown_full": round(ef["blown"], 6),
        "crushed_full": round(ef["crushed"], 6),
        "mean_gate": round(eg["mean"], 3), "blown_gate": round(eg["blown"], 6),
        "crushed_gate": round(eg["crushed"], 6),
        "found": int(f["found"]), "fill": round(f["fraction"], 4),
        "offset_x": round(f["offset_x"], 4), "offset_y": round(f["offset_y"], 4),
        "backdrop": m["backdrop"] or "", "problem": problem or "",
        "under_min_px": int(small),
    }


def from_csv(r: dict) -> dict:
    """A cached row back into the shape measure() returns."""
    return {
        "name": r["name"], "w": int(r["w"]), "h": int(r["h"]), "bytes": int(r["bytes"]),
        "sha": r["sha"], "blur_full": float(r["blur_full"]), "blur_gate": float(r["blur_gate"]),
        "exposure_full": {"mean": float(r["mean_full"]), "blown": float(r["blown_full"]),
                          "crushed": float(r["crushed_full"])},
        "exposure_gate": {"mean": float(r["mean_gate"]), "blown": float(r["blown_gate"]),
                          "crushed": float(r["crushed_gate"])},
        "framing": {"found": bool(int(r["found"])), "fraction": float(r["fill"]),
                    "offset_x": float(r["offset_x"]), "offset_y": float(r["offset_y"])},
        "backdrop": r["backdrop"] or None,
    }


def conditions(name: str) -> set[str]:
    """Filename convention from images/README.md: category-subject-condition-nn.jpg."""
    tokens = set(re.split(r"[-_.]", name.lower()))
    return {c for c in COVERAGE if c in tokens}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true", help="every metric, per image")
    ap.add_argument("--resume", action="store_true",
                    help="skip images already in images/out/metrics.csv")
    args = ap.parse_args()

    t = thresholds()
    files = sorted(p for p in RAW.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    if not files:
        print(f"No images in {RAW}. See images/README.md for what the set needs.")
        return 1

    # Rows already measured. Resuming is the difference between an interrupted run costing
    # the images it had left and costing all of them again.
    done: dict[str, dict] = {}
    if args.resume and METRICS.exists():
        with METRICS.open() as f:
            done = {r["name"]: r for r in csv.DictReader(f) if r.get("name")}
        done = {k: v for k, v in done.items() if k in {p.name for p in files}}

    OUT.mkdir(exist_ok=True)
    sink = METRICS.open("w", newline="")
    writer = csv.DictWriter(sink, fieldnames=CSV_FIELDS)
    writer.writeheader()

    print(f"{len(files)} images · thresholds from ai/thresholds.json"
          + (f" · {len(done)} reused from metrics.csv" if done else "") + "\n")
    header = f"{'file':<44} {'size':>11} {'blur':>8} {'blur@gate':>10} {'mean':>6} {'blown':>6} {'crush':>6} {'fill':>6}  verdict"
    print(header)
    print("-" * len(header))

    seen: set[str] = set()
    rejected = 0
    too_small = 0
    studio = 0
    by_hash: dict[str, str] = {}
    dupes: list[tuple[str, str]] = []

    for p in files:
        cached = done.get(p.name)
        if cached and int(cached["bytes"]) == p.stat().st_size:
            m = from_csv(cached)
        else:
            try:
                m = measure(p, t)
            except Exception as e:  # a truncated download, a HEIC, a renamed HTML error page
                print(f"{p.name:<44} unreadable — {e}")
                continue

        seen |= conditions(p.name)
        if m["sha"] in by_hash:
            dupes.append((p.name, by_hash[m["sha"]]))
        else:
            by_hash[m["sha"]] = p.name
        if m["backdrop"]:
            studio += 1
        problem = find_problem(m, t)
        small = min(m["w"], m["h"]) < t["resolution_min_px"]
        if problem:
            rejected += 1
        if small:
            too_small += 1

        flags = []
        if small:
            flags.append(f"UNDER {t['resolution_min_px']}px")
        if m["backdrop"]:
            flags.append(m["backdrop"])
        if problem:
            flags.append(problem)
        verdict = " · ".join(flags) if flags else "passes"

        writer.writerow(csv_row(m, problem, small))
        sink.flush()  # so a kill -9 costs the current image and nothing before it

        e = m["exposure_gate"]
        print(
            f"{p.name:<44} {m['w']:>5}x{m['h']:<5} {m['blur_full']:>8.0f} {m['blur_gate']:>10.0f} "
            f"{e['mean']:>6.0f} {e['blown']:>6.3f} {e['crushed']:>6.3f} "
            f"{m['framing']['fraction']:>6.2f}  {verdict}"
        )

        if args.verbose:
            f = m["framing"]
            ef = m["exposure_full"]
            print(
                f"{'':<44} full-res mean {ef['mean']:.0f} blown {ef['blown']:.3f} "
                f"crushed {ef['crushed']:.3f} · box found={f['found']} "
                f"offset {f['offset_x']:.2f},{f['offset_y']:.2f} · {m['bytes'] // 1024}KB"
            )

    sink.close()

    print()
    print(f"{rejected}/{len(files)} would be rejected by the current gate.")
    if too_small:
        print(f"{too_small} are below resolution_min_px ({t['resolution_min_px']}px) — the server gate drops these.")
    if studio:
        print(f"{studio} look like finished product shots, not captures — they are the pipeline's output, not its input.")
    for dup, first in dupes:
        print(f"DUPLICATE: {dup} is byte-identical to {first} — delete one.")

    missing = [c for c in COVERAGE if c not in seen]
    print("\nSet coverage (from the filename condition token):")
    for c, why in COVERAGE.items():
        mark = "  ok " if c in seen else "  --  "
        print(f"{mark} {c:<12} {why}")
    if missing:
        print(f"\nMissing: {', '.join(missing)}.")
        print("Without these the thresholds beside them stay guesses — see images/README.md.")

    print(f"\nPer-image metrics written to {METRICS.relative_to(REPO)}.")
    print("A rejection is only a problem if it is wrong. Read the table against the")
    print("photographs before moving any number, and log the verdict in research/RESULTS.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
