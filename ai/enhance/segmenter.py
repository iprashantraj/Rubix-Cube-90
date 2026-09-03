"""BiRefNet — separating the product from its background.

Chosen over InSPyReNet, u2net, isnet and RMBG-2.0 by benchmark, not by reputation:
`research/segmentation/RESULTS.md` has the argument, the numbers and the contact sheets.
Read it before swapping the model out.

**This module is imported lazily, and that is deliberate.** Importing it pulls in torch and
~3GB of CUDA libraries. `pipeline.py` must stay importable without them, because
`test_gate.py` runs the quality gate with plain `python3` and no virtualenv — that is how
the gate's calibration stays checkable by anyone who clones the repo. Nothing here is
imported at module scope by `pipeline`; `pipeline.segment()` imports it inside the call.

The module is named for the job rather than the model, so replacing BiRefNet is a change
inside one file instead of a rename across the pipeline.

Two numbers below are load-bearing and neither is a tuning knob:

`REVISION` — this repository ships `trust_remote_code` model definitions, so the code that
builds the network is downloaded alongside the weights. Tracking `main` would let an
upstream commit change our pipeline with no commit on our side, and it is remote code
execution besides. Pinned to the revision the benchmark actually measured.

`MASTER_LONG_EDGE` — 2000px, from `docs/Abhay/IMAGE_PIPELINE_SPEC_WEB.md:230`, and it is not
only about speed. BiRefNet always infers at 1024² whatever it is given, so its mask is then
stretched to fit. Measured in RESULTS.md ("Follow-up: does a 1024 mask survive being
upscaled?"): at 2000px the stretch is 1.95× and the edge band is 3-4px, near-identical to
the best the model can resolve. On a raw 12MP upload the stretch is 3.9× and the band grows
to 7px — a wire-thin nose ring turns into a blob and hair strands smear together. **Feeding
this the full-resolution upload is slower and visibly worse.** If that ever looks like an
optimisation, re-read the follow-up section first.
"""

from __future__ import annotations

import os
import threading

import numpy as np
from PIL import Image

REPO = "ZhengPeng7/BiRefNet"
REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"

INFER_PX = 1024          # what the weights were trained at. Not adjustable.
MASTER_LONG_EDGE = 2000  # see module docstring before changing

# ImageNet statistics, which is what BiRefNet's preprocessing expects.
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

_model = None
_device = None
_lock = threading.Lock()


def device() -> str:
    """`AI_SEGMENT_DEVICE` wins, else CUDA when present, else CPU.

    CPU works and is roughly twenty times slower. It is kept usable on purpose: enhancement
    degrading to slow is a bad afternoon, and enhancement degrading to unavailable costs the
    artisan the listing (`CLAUDE.md` rule 3).
    """
    override = os.environ.get("AI_SEGMENT_DEVICE")
    if override:
        return override
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def load():
    """Load once per process, under a lock. Returns (model, device).

    Loading takes ~5s warm and pulls ~1GB cold, so the worker should call `warm()` at
    startup rather than making the first artisan of the day wait for it.
    """
    global _model, _device
    if _model is not None:
        return _model, _device

    with _lock:
        if _model is not None:            # another thread won the race while we waited
            return _model, _device

        import torch
        from transformers import AutoModelForImageSegmentation

        dev = device()
        model = AutoModelForImageSegmentation.from_pretrained(
            REPO, revision=REVISION, trust_remote_code=True
        )
        model.to(dev).eval()
        if dev.startswith("cuda"):
            # 1615 MiB in half precision against ~3GB in float32. The benchmark measured
            # half, so this is the configuration the verdict actually covers.
            model.half()
            torch.set_float32_matmul_precision("high")

        _model, _device = model, dev
        return _model, _device


def warm() -> str:
    """Preload the model. For worker startup and health checks. Returns the device."""
    _, dev = load()
    return dev


def prewarm() -> str:
    """Load the weights AND spend one throwaway inference. Returns the device.

    `warm()` on its own is not enough, and the gap is not small. Loading gets the weights
    onto the device; the FIRST real inference then pays CUDA kernel autotuning on top of
    that. Measured on an RTX 4060, 2026-09-02:

        load()                 3486ms
        first alpha() after it  899ms
        every alpha() after     402ms

    So ~4s lands on whichever photograph happens to arrive first — which during a demo is
    the one somebody is watching, and during normal use is some artisan's. Paying it at
    startup instead costs nothing anybody is waiting on.

    The throwaway frame is `MASTER_LONG_EDGE` square because that is the size real callers
    pass; `alpha()` resizes to `INFER_PX` internally either way, and matching the caller
    means the autotuned kernels are the ones that get reused. The mask is discarded — a flat
    white frame has no product in it and is not supposed to.
    """
    _, dev = load()
    alpha(Image.new("RGB", (MASTER_LONG_EDGE, MASTER_LONG_EDGE), "white"))
    return dev


def to_master(image: Image.Image) -> Image.Image:
    """The 2000px master every later stage works on. Returns the original if already smaller.

    One LANCZOS step rather than the spec's "multi-step downscale". That advice exists
    because naive box or bilinear resampling aliases badly at large reduction ratios —
    it does not apply to Pillow's LANCZOS, which filters over the full support and is
    area-correct on the way down. A halving loop here would cost time and lose sharpness
    to repeated resampling, not gain any.
    """
    if max(image.size) <= MASTER_LONG_EDGE:
        return image
    out = image.copy()
    out.thumbnail((MASTER_LONG_EDGE, MASTER_LONG_EDGE), Image.LANCZOS)
    return out


def alpha(image: Image.Image) -> np.ndarray:
    """Soft mask for `image`, float32 in [0,1], same width and height as what was passed.

    Pass the master, not the upload — see the module docstring. This does not resize for
    you, because a stage silently changing resolution underneath the caller is how the
    recipe model loses track of what it rendered.

    The result is genuinely soft at the boundary, not a binary mask with blur applied: that
    is why `matte()` has nothing to add at 2000px, argued in RESULTS.md.
    """
    import torch

    model, dev = load()

    small = image.convert("RGB").resize((INFER_PX, INFER_PX), Image.BILINEAR)
    x = np.asarray(small, dtype=np.float32) / 255.0
    x = (x - _MEAN) / _STD
    t = torch.from_numpy(x).permute(2, 0, 1).unsqueeze(0).to(dev)
    if dev.startswith("cuda"):
        t = t.half()

    with torch.no_grad():
        pred = model(t)[-1].sigmoid().float().cpu()[0, 0].numpy()

    del t
    # Back up to the master's size. uint8 for the resize keeps a 4MP float array from
    # existing twice; the precision lost is below what an 8-bit composite can show anyway.
    up = Image.fromarray((pred * 255.0 + 0.5).astype(np.uint8)).resize(image.size, Image.BILINEAR)
    return np.asarray(up, dtype=np.float32) / 255.0
