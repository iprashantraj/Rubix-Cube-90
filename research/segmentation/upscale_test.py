"""
Does a mask computed at 1024 survive being scaled up to a full-resolution photo?

This is the question the seg-v1 benchmark could not answer, and it decides how much
work step 7 is. BiRefNet always infers at 1024x1024 — that is fixed by the weights.
What varies is how far its output has to be stretched to cover the original photo:
about 2x on a 2MP museum shot, 3.9x on a 12MP phone photo, 5.6x on our largest fixture.

There is no ground truth, so this measures against a *detail ceiling* instead. For one
region of an image we get two masks:

  full  — run the model on the whole photo, then upscale the 1024 mask to full size
          and take the region out of it. This is what the pipeline would really do.
  crop  — cut that same region out of the photo at native resolution and run the model
          on it directly. The region is ~1024px, so the mask comes back 1:1 with no
          upscaling at all. This is the most edge detail the model can resolve there.

The gap between them is what upscaling costs.

Caveat that must be quoted with any result: the crop run sees a fragment of the object,
not the whole thing, so it is not a strictly fair comparison of *segmentation* — only of
*edge detail*, which is what we are after. Where the crop run misreads the fragment
entirely, the row is reported and excluded.

Usage:  ai/.venv/bin/python research/segmentation/upscale_test.py
"""
from __future__ import annotations

import argparse
import csv
import gc
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "images" / "raw"
OUT = Path(__file__).parent / "out" / "upscale"
REPO = "ZhengPeng7/BiRefNet"
REV = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"
INFER = 1024
CROP = 1024  # the crop is run at 1024 = INFER, so its mask comes back 1:1, no upscaling

# Largest fixtures with an edge worth looking at. The upscale factor is what matters,
# and 3.9x is representative of a 12MP phone photo.
CASES = [
    "textile-pallu-fringe-01.jpg",         # 22.1MP, 5.6x
    "brass-bidri-specular-04.jpg",         # 15.7MP, 4.3x
    "brass-bidri-specular-02.jpg",         # 12.0MP, 3.9x  <- the production case
    "textile-blockprint-patterned-03.jpg", # 10.0MP, 3.6x
]

TF = transforms.Compose([
    transforms.Resize((INFER, INFER)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def load_model():
    from transformers import AutoModelForImageSegmentation

    m = AutoModelForImageSegmentation.from_pretrained(REPO, revision=REV, trust_remote_code=True)
    m.to("cuda").eval().half()
    return m


@torch.no_grad()
def alpha_u8(model, im: Image.Image) -> np.ndarray:
    """uint8 alpha at im's size. uint8 throughout — a float32 array of a 22MP photo is
    88MB per copy and this machine has under 2GB free."""
    x = TF(im).unsqueeze(0).to("cuda").half()
    pred = model(x)[-1].sigmoid().float().cpu()[0, 0].numpy()
    small = Image.fromarray((pred * 255).astype(np.uint8))
    del x, pred
    return np.asarray(small.resize(im.size, Image.BILINEAR), dtype=np.uint8)


def band_px(a: np.ndarray) -> float:
    """Mean thickness, in pixels, of the partly-transparent band around the edge.

    soft pixels / edge length. A mask carrying real detail keeps this near-constant as
    resolution rises. A mask that was upscaled from 1024 has it grow with the factor,
    because the softness is interpolation, not detail.
    """
    soft = np.count_nonzero((a > 13) & (a < 242))          # 0.05..0.95 in uint8
    edge = np.count_nonzero(cv2.Canny((a > 127).astype(np.uint8) * 255, 50, 150))
    return float(soft) / edge if edge else float("nan")


def pick_crop(a_small: np.ndarray, size: tuple[int, int]) -> tuple[int, int]:
    """Top-left of the CROP window with the most boundary in it."""
    w, h = size
    edges = cv2.Canny((a_small > 127).astype(np.uint8) * 255, 50, 150).astype(np.float32)
    sh, sw = edges.shape
    dens = cv2.blur(edges, (max(3, sw // 8), max(3, sh // 8)))
    # keep the window fully inside the image
    m = CROP // 2
    ys, xs = np.mgrid[0:sh, 0:sw]
    valid = ((xs * w // sw) >= m) & ((xs * w // sw) <= w - m) & \
            ((ys * h // sh) >= m) & ((ys * h // sh) <= h - m)
    dens = np.where(valid, dens, -1)
    cy, cx = np.unravel_index(int(np.argmax(dens)), dens.shape)
    return int(cx * w / sw) - m, int(cy * h / sh) - m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--master", type=int, default=0,
                    help="downscale each photo to this long edge first. 2000 is what the "
                         "pipeline actually feeds the model (spec IMAGE_PIPELINE_SPEC_WEB.md:230); "
                         "0 means the raw sensor image, which the spec forbids processing.")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    model = load_model()
    rows = []

    for name in CASES:
        p = RAW / name
        im = Image.open(p).convert("RGB")
        if args.master and max(im.size) > args.master:
            im.thumbnail((args.master, args.master), Image.LANCZOS)
        W, H = im.size
        factor = max(W, H) / INFER

        a_full = alpha_u8(model, im)

        small = np.asarray(Image.fromarray(a_full).resize((512, int(512 * H / W)) if W >= H
                                                          else (int(512 * W / H), 512)), np.uint8)
        x0, y0 = pick_crop(small, (W, H))
        box = (x0, y0, x0 + CROP, y0 + CROP)

        a_full_crop = a_full[y0:y0 + CROP, x0:x0 + CROP].copy()
        del a_full
        gc.collect()

        im_crop = im.crop(box)
        a_crop = alpha_u8(model, im_crop)

        iou_num = np.count_nonzero((a_full_crop > 127) & (a_crop > 127))
        iou_den = np.count_nonzero((a_full_crop > 127) | (a_crop > 127))
        row = dict(image=name, mp=round(W * H / 1e6, 1), factor=round(factor, 2),
                   crop_xy=f"{x0},{y0}",
                   band_full=round(band_px(a_full_crop), 2),
                   band_crop=round(band_px(a_crop), 2),
                   iou=round(iou_num / iou_den, 4) if iou_den else float("nan"))
        row["band_ratio"] = round(row["band_full"] / row["band_crop"], 2) if row["band_crop"] else None
        rows.append(row)
        print(f"{name:<40} {row['factor']}x  band full={row['band_full']:.2f}px "
              f"crop={row['band_crop']:.2f}px  ratio={row['band_ratio']}  IoU={row['iou']}", flush=True)

        # 100% side-by-side: photo | pipeline mask | detail ceiling
        panel = Image.new("RGB", (CROP * 3, CROP), "white")
        panel.paste(im_crop, (0, 0))
        panel.paste(Image.fromarray(a_full_crop).convert("RGB"), (CROP, 0))
        panel.paste(Image.fromarray(a_crop).convert("RGB"), (CROP * 2, 0))
        tag = f"-master{args.master}" if args.master else ""
        panel.save(OUT / f"{Path(name).stem}{tag}-100pct.png")

        del a_full_crop, a_crop, im, im_crop, panel
        gc.collect()
        torch.cuda.empty_cache()

    dest = OUT / (f"upscale-master{args.master}.csv" if args.master else "upscale.csv")
    with open(dest, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
