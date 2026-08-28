"""
seg-v1 benchmark — closes open decision #1 (docs/decisions.md).

Runs each candidate background-removal model over the seg-v1 set, saves the alpha
matte and a white-background cutout for every image, and records the numbers we can
compute without ground-truth masks.

We have no hand-labelled masks, and making 41 of them by hand is days of work for a
decision that a contact sheet answers in ten minutes. So this script is deliberately
NOT an accuracy scoreboard. It produces:

  * per-image alpha and cutout PNGs, for looking at
  * contact sheets, one row per image, one column per model
  * consensus IoU  — how far each model sits from the pixel-wise majority of all of
    them. Not accuracy. It finds the model that is alone in its opinion, which on a
    hard image is usually the one that is wrong, and occasionally the only one right
  * soft-edge fraction — share of pixels with alpha strictly between 0.05 and 0.95.
    Near zero means the model emits a hard cut and the fringe cases will look bad
  * foreground fraction, hole count, component count — catch the degenerate answers
    ("everything is product", "nothing is product") that a score alone hides
  * latency and peak VRAM, per image, on this machine's RTX 2050

The human still picks the winner. This script's job is to make that possible and to
make the choice reproducible afterwards.

Usage:  ai/.venv/bin/python research/segmentation/bench.py [--models a,b] [--limit N]
"""
from __future__ import annotations

import argparse, csv, gc, json, time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "images" / "raw"
OUT = ROOT / "research" / "segmentation" / "out"
SETFILE = Path(__file__).parent / "seg-v1.txt"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# 4GB card. 1024 is what BiRefNet and RMBG-2.0 are trained at; going higher does not
# fit and going lower is not what the weights expect.
INFER_SIZE = 1024

# Every fixture is resized down to this longest side before anything touches it.
#
# Two reasons, and neither is about the models. First, this machine has 7GB of RAM and
# some fixtures are 22MP (3840x5760): a full-resolution float alpha, a float composite
# and a connected-components pass on top of that is several gigabytes of transient
# allocation, and the first run was OOM-killed twice at exactly that image. Second,
# every model here infers at 320 or 1024 internally and upscales, so the pixels above
# 2048 carry no information any of them actually used — they only make the mask files
# larger and the comparison slower.
#
# It also makes the masks directly comparable: consensus IoU needs every model's answer
# for one image to be the same shape.
MAX_SIDE = 2048


def load_set() -> list[Path]:
    names = [
        ln.strip()
        for ln in SETFILE.read_text().splitlines()
        if ln.strip() and not ln.lstrip().startswith("#")
    ]
    missing = [n for n in names if not (RAW / n).exists()]
    if missing:
        raise SystemExit(f"missing {len(missing)} fixture(s): {missing[:3]}")
    return [RAW / n for n in names]


# ---------------------------------------------------------------- model adapters
# Each adapter returns a float32 alpha in [0,1] at the original image size.


class TransformersSeg:
    """BiRefNet and RMBG-2.0 both ship as transformers models with remote code."""

    def __init__(self, repo: str, half: bool = True):
        self.repo, self.half = repo, half
        self.model = None

    def load(self):
        from transformers import AutoModelForImageSegmentation

        self.model = AutoModelForImageSegmentation.from_pretrained(
            self.repo, trust_remote_code=True
        )
        self.model.to(DEVICE).eval()
        if self.half and DEVICE == "cuda":
            self.model.half()
        torch.set_float32_matmul_precision("high")

    def alpha(self, im: Image.Image) -> np.ndarray:
        from torchvision import transforms

        tf = transforms.Compose([
            transforms.Resize((INFER_SIZE, INFER_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        x = tf(im).unsqueeze(0).to(DEVICE)
        if self.half and DEVICE == "cuda":
            x = x.half()
        with torch.no_grad():
            pred = self.model(x)[-1].sigmoid().float().cpu()[0, 0]
        a = Image.fromarray((pred.numpy() * 255).astype("uint8")).resize(im.size, Image.BILINEAR)
        return np.asarray(a, dtype=np.float32) / 255.0

    def unload(self):
        self.model = None


class InSPyReNetSeg:
    def __init__(self):
        self.model = None

    def load(self):
        from transparent_background import Remover

        self.model = Remover(mode="base", jit=False, device=DEVICE)

    def alpha(self, im: Image.Image) -> np.ndarray:
        out = self.model.process(im, type="map")  # greyscale confidence map
        a = np.asarray(out.convert("L"), dtype=np.float32) / 255.0
        return a

    def unload(self):
        self.model = None


class RembgSeg:
    """u2net / isnet-general-use. onnxruntime, CPU — see note in RESULTS."""

    def __init__(self, name: str):
        self.name, self.session = name, None

    def load(self):
        from rembg import new_session

        self.session = new_session(self.name)

    def alpha(self, im: Image.Image) -> np.ndarray:
        from rembg import remove

        # rembg hands back a mask at the input's full resolution. On a 22MP fixture
        # that is several float copies of a 22M-element array, and this machine has
        # 7GB of RAM — it was OOM-killed mid-run the first time. u2net and isnet both
        # infer at 320x320 internally regardless, so downscaling the input first
        # costs no accuracy and bounds the memory. The mask is then scaled back up,
        # which is the same infer-small-upscale shape BiRefNet uses at 1024.
        small = im
        if max(im.size) > 1024:
            small = im.copy()
            small.thumbnail((1024, 1024), Image.LANCZOS)
        out = remove(small, session=self.session, only_mask=True, post_process_mask=False)
        a = np.asarray(out.convert("L").resize(im.size, Image.BILINEAR), dtype=np.float32)
        return a / 255.0

    def unload(self):
        self.session = None


MODELS: dict[str, dict] = {
    "birefnet":      dict(make=lambda: TransformersSeg("ZhengPeng7/BiRefNet"),      licence="MIT",        device="cuda"),
    "birefnet-lite": dict(make=lambda: TransformersSeg("ZhengPeng7/BiRefNet_lite"), licence="MIT",        device="cuda"),
    "inspyrenet":    dict(make=lambda: InSPyReNetSeg(),                             licence="MIT",        device="cuda"),
    "u2net":         dict(make=lambda: RembgSeg("u2net"),                           licence="Apache-2.0", device="cpu"),
    "isnet":         dict(make=lambda: RembgSeg("isnet-general-use"),               licence="Apache-2.0", device="cpu"),
    # Reference only. RMBG-2.0 is CC BY-NC 4.0: we may measure it, we may not ship it.
    "rmbg2":         dict(make=lambda: TransformersSeg("briaai/RMBG-2.0"),          licence="CC-BY-NC-4.0 — CANNOT SHIP", device="cuda"),
}


# ---------------------------------------------------------------------- measures


def measures(a: np.ndarray) -> dict:
    """Shape-of-the-answer numbers. None of these need ground truth."""
    import cv2

    fg = a > 0.5
    total = a.size
    soft = np.count_nonzero((a > 0.05) & (a < 0.95)) / total

    mask = fg.astype(np.uint8)
    n_comp, labels = cv2.connectedComponents(mask)
    # holes: background components not touching the border
    inv = (1 - mask).astype(np.uint8)
    n_bg, bg_labels = cv2.connectedComponents(inv)
    border = set(bg_labels[0, :]) | set(bg_labels[-1, :]) | set(bg_labels[:, 0]) | set(bg_labels[:, -1])
    holes = sum(1 for i in range(1, n_bg) if i not in border)

    return dict(
        fg_fraction=round(float(fg.mean()), 4),
        soft_edge_fraction=round(float(soft), 5),
        components=int(n_comp - 1),
        holes=int(holes),
    )


def cutout(im: Image.Image, a: np.ndarray) -> Image.Image:
    """Composite onto white — what the artisan would actually see."""
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    al = a[..., None]
    return Image.fromarray((rgb * al + 255.0 * (1 - al)).astype("uint8"))


# -------------------------------------------------------------------------- run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(MODELS))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    images = load_set()
    if args.limit:
        images = images[: args.limit]
    wanted = [m.strip() for m in args.models.split(",") if m.strip()]
    for m in wanted:
        if m not in MODELS:
            raise SystemExit(f"unknown model {m!r}; have {list(MODELS)}")

    OUT.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    for mname in wanted:
        spec = MODELS[mname]
        print(f"\n=== {mname} ({spec['licence']}) ===", flush=True)
        adapter = spec["make"]()
        t0 = time.perf_counter()
        try:
            adapter.load()
        except Exception as e:
            print(f"  LOAD FAILED: {type(e).__name__}: {e}", flush=True)
            rows.append(dict(model=mname, image="-", error=f"load: {e}"))
            continue
        print(f"  loaded in {time.perf_counter()-t0:.1f}s", flush=True)

        mdir = OUT / mname
        (mdir / "alpha").mkdir(parents=True, exist_ok=True)
        (mdir / "cutout").mkdir(parents=True, exist_ok=True)

        if DEVICE == "cuda":
            torch.cuda.reset_peak_memory_stats()

        for p in images:
            im = Image.open(p).convert("RGB")
            src_w, src_h = im.size
            if max(im.size) > MAX_SIDE:
                im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
            try:
                if DEVICE == "cuda":
                    torch.cuda.synchronize()
                t = time.perf_counter()
                a = adapter.alpha(im)
                if DEVICE == "cuda":
                    torch.cuda.synchronize()
                ms = (time.perf_counter() - t) * 1000
            except Exception as e:
                print(f"  {p.name}: FAILED {type(e).__name__}: {e}", flush=True)
                rows.append(dict(model=mname, image=p.name, error=str(e)[:200]))
                continue

            # Deliberately NOT kept in memory. Holding every model's alpha for every
            # image to compute consensus at the end is 5 x 41 x 2048^2 floats, which
            # OOM-killed this script on a 7GB machine. consolidate.py recomputes the
            # cross-model numbers by reading these files back one image at a time.
            stem = p.stem
            Image.fromarray((a * 255).astype("uint8")).save(mdir / "alpha" / f"{stem}.png")
            cutout(im, a).save(mdir / "cutout" / f"{stem}.png")

            row = dict(model=mname, image=p.name, ms=round(ms, 1),
                       w=im.width, h=im.height, src_w=src_w, src_h=src_h,
                       **measures(a))
            rows.append(row)
            print(f"  {p.name:<46} {ms:7.0f}ms  fg={row['fg_fraction']:.3f} "
                  f"soft={row['soft_edge_fraction']:.4f} holes={row['holes']}", flush=True)

        if DEVICE == "cuda":
            peak = torch.cuda.max_memory_allocated() / 2**20
            print(f"  peak VRAM {peak:.0f} MiB", flush=True)
            for r in rows:
                if r.get("model") == mname:
                    r["peak_vram_mib"] = round(peak)

        adapter.unload()
        del adapter
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()

    cols = ["model", "image", "ms", "peak_vram_mib", "w", "h", "src_w", "src_h", "fg_fraction",
            "soft_edge_fraction", "components", "holes", "error"]
    with open(OUT / "metrics.csv", "w", newline="") as fh:
        wtr = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        wtr.writeheader()
        wtr.writerows(rows)
    print(f"\nwrote {OUT/'metrics.csv'}  ({len(rows)} rows)")
    print("now run consolidate.py for the cross-model numbers")

    (OUT / "run.json").write_text(json.dumps(dict(
        device=DEVICE, infer_size=INFER_SIZE, max_side=MAX_SIDE, models=wanted,
        gpu=torch.cuda.get_device_name(0) if DEVICE == "cuda" else None,
        images=len(images),
    ), indent=2))


if __name__ == "__main__":
    main()
