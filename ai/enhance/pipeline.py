"""F1 image pipeline. Stages run in order; each takes an image and returns an image.

The gate runs first so we reject before spending GPU time. Every stage after
segmentation operates on the product region only — we already have the mask.

Line we do not cross: never change colour or shape. Enhance, don't misrepresent.
Return rate destroys artisan income, and misrepresentation is a listing violation.
"""

from . import metrics

# Rejection reasons this pipeline exists to defeat:
#   background not pure white  ->  composite()
#   product under 85% of frame ->  crop()
#   blurry / under 1000px      ->  gate()
#   wrong colour vs what ships ->  white_balance()
#   shadows on white           ->  composite()


def gate(image):
    """Reject before GPU: resolution, blur, extreme exposure. Thresholds from ../thresholds.json.

    Returns None when the photo is worth processing, or the rejection body from
    `contracts.md` — `{"reason": ..., "message_key": ...}` — which `service.py` returns under
    `{"status": "rejected"}`. No GPU is spent on anything this refuses.

    **What it does not check: framing.** Too far, too close and off-centre are all repairable
    — `crop()` exists to do exactly that — so refusing them here would throw away a listing
    the pipeline was built to rescue. Framing is coached on the phone, where the artisan can
    still act on it, and fixed on the server. Only what cannot be repaired is refused:
    resolution that is not there, detail that is not there, and clipped pixels that hold no
    information at all.

    **Blur uses `blur_laplacian_variance_reject_min`, not the capture number.** The two gates
    look at different pixels: the phone measures a 240x180 preview, which destroys the very
    defect it is testing for — it flags 23 of 166 known-blurred fixtures, against 152 at full
    resolution. So the phone advises and this decides. See research/RESULTS.md.

    The check order deliberately differs from `gate.js`, which puts the crushed-shadow test
    above the two too-bright tests and so announces a 50%-blown photograph as "too dark"
    (logged as a request in docs/Abhay/CHANGELOG.md). Here the mean settles dark-or-bright
    first and the clipping tests follow, so the message always matches the failure. The
    artisan may not be able to read; the spoken instruction is all they get.
    """
    t = metrics.thresholds()

    w, h = image.size
    if min(w, h) < t["resolution_min_px"]:
        # Not a coaching problem — no amount of holding still adds pixels that were never
        # captured, and upscaling to a 2000px listing image invents detail we are not
        # allowed to invent.
        return _reject(f"resolution_below_{t['resolution_min_px']}px", "photo.too_small")

    blur, exp = metrics.full_res(image)

    # Light first: every other measurement is meaningless in the dark.
    if exp["mean"] < t["brightness_mean_min"]:
        return _reject("brightness_below_min", "photo.too_dark")
    if exp["mean"] > t["brightness_mean_max"]:
        return _reject("brightness_above_max", "photo.too_bright")
    if exp["blown"] > t["blown_pixel_fraction_max"]:
        return _reject("blown_highlights", "photo.too_bright")
    if exp["crushed"] > t["crushed_pixel_fraction_max"]:
        return _reject("crushed_shadows", "photo.too_dark")

    if blur < t["blur_laplacian_variance_reject_min"]:
        return _reject("blur_below_reject", "photo.blurry")

    return None


def _reject(reason: str, message_key: str) -> dict:
    """One rejection, shaped as contracts.md specifies.

    `message_key` is the app's spoken string, and it is deliberately coarser than `reason`:
    the artisan hears "the photo is too dark", not which of two statistics said so. `reason`
    is for us, in the logs, when a threshold looks wrong.
    """
    return {"reason": reason, "message_key": message_key}


def segment(image):
    """Soft mask for the product, float32 in [0,1], at `image`'s size.

    BiRefNet, chosen by benchmark over InSPyReNet, u2net, isnet and RMBG-2.0 —
    `research/segmentation/RESULTS.md` for the argument and the pictures. SAM 2 tap-to-refine
    is out of MVP scope (reconciliation §4); the tier system in step 8 is the fallback for a
    mask that is not good enough, not a second model.

    **Pass the 2000px master, not the upload.** `segmenter.to_master()` produces it. The model
    infers at 1024² whatever it is handed and its answer is then stretched to fit, so feeding
    it a 12MP original makes the stretch 3.9x instead of 1.95x and fine detail — a thin wire,
    individual hairs — dissolves. Measured, in RESULTS.md.

    torch is imported here rather than at module scope so this file stays importable without
    a virtualenv. `test_gate.py` depends on that.
    """
    from . import segmenter

    return segmenter.alpha(image)


def matte(image, mask):
    """Returns `mask` unchanged. Kept as a stage, deliberately, and currently a no-op.

    The spec assumed a trimap-and-alpha-matting stage would be needed because a binary mask
    slices through fringes and tassels. **BiRefNet does not return a binary mask.** Its
    output is already soft where the subject is soft: on the four museum tassels in `seg-v1`
    it followed individual threads including stray wisps, and at the 2000px master the edge
    band measures 3-4px against a 1.5-2.8px ceiling — close enough that a refinement pass has
    nothing left to recover. Both measurements are in RESULTS.md.

    So this is not "not implemented yet". It is implemented as nothing, on evidence, and the
    stage stays in the sequence for two reasons: the recipe model records which stages ran,
    and the conditions that would bring it back are specific and foreseeable —

      * output above ~2000px for some future channel, where the stretch grows and the edge
        band with it (re-run `research/segmentation/upscale_test.py --master <N>` first);
      * genuinely translucent goods — muslin, net, chanderi, glass — where the question is
        not edge softness but whether a *large interior region* is semi-transparent. `seg-v1`
        contains no such fixture, so this is untested rather than disproven;
      * a model swap, since this conclusion is about BiRefNet's output and nothing else.
    """
    return mask


# --- step 8: does the mask deserve to be trusted? -----------------------------
#
# The benchmark's most important finding was not which model won. It was that the model
# never reports doubt: handed a photograph with no single clear product in it, BiRefNet
# returns a confident outline around an arbitrary region rather than an empty or hesitant
# mask (research/segmentation/RESULTS.md). Nothing downstream can ask it how sure it is.
#
# So confidence is measured from the shape of the answer instead. Three signals, all of
# them cheap, each one aimed at a failure actually observed on seg-v1 rather than imagined.

MASK_BLOB_PX = 256  # blob counting runs on a downscale; it does not need full resolution


def _components(binary):
    """(count, sizes) of 4-connected True regions. numpy only — no OpenCV, no scipy.

    `metrics.py` explains the rule this follows: the fixture tools and the gate tests run
    on a clean machine with nothing installed, and a second implementation of a measurement
    is a second thing to keep honest. Run-length union-find, which on a 256px mask is a few
    hundred runs and finishes in well under a millisecond.
    """
    import numpy as np

    h, w = binary.shape
    parent: list[int] = []

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    sizes: list[int] = []
    prev: list[tuple[int, int, int]] = []
    for y in range(h):
        row = binary[y].astype(np.uint8)
        d = np.diff(np.concatenate(([0], row, [0])))
        starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        cur = []
        for s, e in zip(starts.tolist(), ends.tolist()):
            lbl = len(parent)
            parent.append(lbl)
            sizes.append(e - s)
            for ps, pe, pl in prev:
                if ps < e and s < pe:          # runs overlap in x -> same component
                    union(lbl, pl)
            cur.append((s, e, lbl))
        prev = cur

    totals: dict[int, int] = {}
    for i, n in enumerate(sizes):
        r = find(i)
        totals[r] = totals.get(r, 0) + n
    return len(totals), sorted(totals.values(), reverse=True)


def mask_signals(alpha):
    """The raw measurements behind the confidence score. Returned separately so a log line
    can say *why* a photo was demoted, not just that it was."""
    import numpy as np
    from PIL import Image as _Image

    a = np.asarray(alpha, dtype=np.float32)
    area = float((a > 0.5).mean())
    uncertain = float(np.count_nonzero((a > 0.1) & (a < 0.9)) / a.size)

    small = np.asarray(
        _Image.fromarray((a * 255).astype(np.uint8)).resize((MASK_BLOB_PX, MASK_BLOB_PX),
                                                            _Image.BILINEAR),
        dtype=np.uint8,
    ) > 127
    n, sizes = _components(small)
    # Specks are not fragmentation. A tassel sheds a few loose pixels and that is the mask
    # being right, not wrong; only pieces big enough to read as a separate object count.
    big = [s for s in sizes if s >= 0.01 * small.size]
    return dict(area=round(area, 4), uncertain=round(uncertain, 4),
                blobs=len(big), blobs_raw=n,
                largest_share=round(sizes[0] / sum(sizes), 4) if sizes else 0.0)


def mask_confidence(alpha):
    """0..1. How much the mask looks like a clean cut-out of one object.

    Not a probability and not an accuracy estimate — nothing here knows what the right
    answer was. It is a shape check, and it is calibrated in
    `research/segmentation/RESULTS.md` against the failures seg-v1 actually contains.

    The three deductions, and the real photograph behind each:

    `area` — the mask covers almost none of the frame, or almost all of it.
      `textile-shawl-fringe-03` is cream linen on a white background: BiRefNet kept a few
      fringe threads and threw the cloth away, leaving 1.4% coverage. At the other end,
      a close-up where the fabric fills the frame leaves nothing to cut away, and a mask
      covering ~everything means the same thing as covering ~nothing — there is no
      figure-ground here.

    `uncertain` — a wide band of undecided alpha. Real fringe is soft, so this fires late.

    `blobs` — the product came back in pieces. A museum case of many objects, a shop of
    stacked textiles, a row of pots on a rail.

    Thresholds live in `thresholds.json` under `_enhance_only`, so moving one is a JSON edit
    and a RESULTS.md row, not a code change.
    """
    t = metrics.thresholds()
    s = mask_signals(alpha)

    score = 1.0
    if s["uncertain"] > t["mask_uncertain_fraction_max"]:
        score -= 0.4
    if s["blobs"] > t["mask_blob_count_max"]:
        score -= 0.3
    if s["area"] <= t["mask_area_min"] or s["area"] >= t["mask_area_max"]:
        score -= 0.3
    return max(score, 0.0), s


def tier(alpha):
    """"A", "B" or "C" — how much of the cut-out we are willing to use.

    A: full cut-out on white. The mask is trusted.
    B: the mask is usable but not clean, so it is feathered rather than cut hard.
    C: **remove nothing.** Crop and colour-correct the photograph as it is.

    **Reaching C takes two independent failures, not one.** The deductions are 0.4, 0.3 and
    0.3 against a start of 1.0, and `tier_b_confidence_min` is 0.45 — so any single anomaly
    lands at 0.6 or 0.7 and demotes only to B. That is the intended shape: one odd
    measurement is usually a legitimately odd photograph (a rug that fills the frame, a pot
    in a dark tunnel), and answering it by refusing to enhance at all would cost more
    listings than it saves. Two unrelated anomalies at once is when the mask stops being
    worth believing.

    Tier C is the safety net for the whole feature and it is not a failure state. A chewed-up
    saree edge looks worse to a buyer than an unedited photograph, and `CLAUDE.md` rule 3 is
    explicit that losing the enhancement must never cost the artisan the listing. C removes
    nothing, so it cannot damage the product.
    """
    t = metrics.thresholds()
    score, signals = mask_confidence(alpha)
    if score >= t["tier_a_confidence_min"]:
        name = "A"
    elif score >= t["tier_b_confidence_min"]:
        name = "B"
    else:
        name = "C"
    return name, score, signals


FEATHER_PX = 3  # tier B edge softening, at the 2000px master


def apply_tier(image, alpha):
    """Route the mask through the treatment its confidence earns.

    Returns `(image, tier, score, signals)`. The image is on white for tiers A and B, and
    is the photograph untouched for tier C. Run `crop()` after this, as always.

    Tier A — the mask is trusted; cut hard onto white.

    Tier B — the mask is usable but not clean, so the edge is feathered before compositing.
    Softening does not fix a wrong mask; it makes a slightly-wrong one stop announcing
    itself, because the eye catches a crisp incorrect boundary far faster than a soft one.

      **This diverges from spec §6.3, which puts Tier B on a "soft studio gradient".** A
      gradient cannot be a marketplace primary — `contracts.md` and rule 4 of the spec's own
      §9.1 require #FFFFFF, and a listing on a gradient is the rejection we are trying to
      avoid. Feathered-on-white keeps the tier's intent and the marketplace requirement.

    Tier C — **remove nothing.** Return the photograph.

      This also diverges from spec §6.3, which asks for "background blurred + dimmed". That
      contradicts the guarantee the spec makes for C two lines later: *"it removes nothing,
      so it cannot damage the product."* Blurring the background needs the mask, and Tier C
      is precisely the case where the mask is not to be trusted — blurring with a bad mask
      smears the product itself. A dimmed background is a nicety; an unblurred honest
      photograph is the safety net. If the blur is wanted later it should key off something
      other than the mask we just declined to believe.
    """
    name, score, signals = tier(alpha)

    if name == "C":
        return image.convert("RGB"), name, score, signals

    a = alpha
    if name == "B":
        import numpy as np
        from PIL import Image as _Image, ImageFilter

        soft = _Image.fromarray((np.asarray(a, np.float32) * 255).astype(np.uint8))
        soft = soft.filter(ImageFilter.BoxBlur(FEATHER_PX))
        a = np.asarray(soft, np.float32) / 255.0

    return composite(image, a), name, score, signals


def white_balance(image):
    """Most underrated stage — matters more than background removal for textiles.

    A maroon saree shot under a tungsten bulb photographs orange; the buyer returns it
    and the artisan's rating drops. If a white reference paper is in frame, calibrate
    the exact white point from it and crop it out. Free, and professional-grade.
    """
    raise NotImplementedError


def tone(image, mask):
    """Auto-levels, shadow lift, CLAHE — product region only."""
    raise NotImplementedError


def denoise_sharpen(image, mask):
    """Texture is the selling point in handicraft. Weave, knot and grain must pop."""
    raise NotImplementedError


WHITE = 255


def composite(image, alpha):
    """Lay the product on pure #FFFFFF. Returns RGB at `image`'s size.

    `alpha` is float in [0,1], same width and height as `image` — what `segment()` returns.

    Marketplaces reject near-white. (252,252,252) looks white to the eye and fails the check,
    so the invariant is exact: **every fully transparent pixel comes out exactly 255,255,255**,
    not approximately. That is what `_assert_transparent_is_white` verifies on every call, and
    it is cheap because it only looks at pixels the mask already said were background.

    No shadow here. A contact shadow is a Tier A embellishment for secondary images
    (`studio.py`), never the marketplace primary.

    **Colour fringing was looked for and is not there**, so foreground colour estimation is
    not built. The concern is real in principle: a half-transparent edge pixel still holds
    some of the original background's colour, so a product shot against something dark should
    keep a faint dark rim once composited onto white.

    Measured 2026-08-28 on the two fixtures most likely to show it — `1816d85d` (a near-black
    pot on a near-black ground) and `brass-bidri-specular-02`. Comparing each rim pixel
    against an ideal blend of product colour toward white, the deviation is +2.3 mean on the
    first and +37.3 on the second: **toward white, not away from it.** A dark halo would be
    negative. At 4x zoom both silhouettes ramp cleanly from product to white with no visible
    rim. If a future fixture does show one, the fix belongs here, not in `matte()`.
    """
    import numpy as np

    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    a = np.asarray(alpha, dtype=np.float32)
    if a.shape[:2] != rgb.shape[:2]:
        raise ValueError(f"alpha {a.shape[:2]} does not match image {rgb.shape[:2]}")

    a3 = a[..., None]
    out = rgb * a3 + WHITE * (1.0 - a3)
    out = np.clip(out + 0.5, 0, 255).astype(np.uint8)

    _assert_transparent_is_white(out, a)
    from PIL import Image as _Image

    return _Image.fromarray(out, "RGB")


def _assert_transparent_is_white(rgb, a):
    """Where the mask says background, the pixel must be exactly white.

    Not a style check. A marketplace's automated background test samples pixels and rejects
    on anything that is not 255, and the artisan sees a rejected listing with no explanation
    they can act on.
    """
    import numpy as np

    bg = a <= 0.0
    if not bg.any():
        return
    bad = rgb[bg]
    if bad.size and int(bad.min()) != WHITE:
        raise AssertionError(
            f"composite left a non-white background pixel ({int(bad.min())}); "
            "marketplaces reject near-white"
        )


def crop_plan(alpha, canvas=None, fill=None):
    """The geometry `crop()` will use, separately so it can be inspected and tested.

    Returns a dict with the product box, the square source box in `alpha`'s coordinates
    (which may extend outside the image — `crop()` pads those parts white), and `upscale`,
    the factor the source box is scaled by to reach the canvas.

    **`upscale` is the number worth watching.** A product photographed from too far away
    fills little of the frame, so its square box is small and reaching 2000px means
    enlarging it. Lanczos resampling interpolates, it does not invent detail, so this is not
    the fabrication rule 1 forbids — but past roughly 2x the result is visibly soft, and the
    caller should put that in the `warnings` array `contracts.md` already carries rather than
    quietly shipping a mushy listing. The capture gate's `fill_fraction_min` of 0.25 is what
    is supposed to keep this small; it advises rather than blocks, so this can still happen.
    """
    t = metrics.thresholds()
    canvas = canvas or t["listing_canvas_px"]
    fill = fill or t["crop_fill_target"]

    box = product_box(alpha)
    h, w = alpha.shape[:2]
    if box is None:
        # No product found. Rule 3: degrade, never fail — a centre square is a poor listing
        # image, and no listing image at all is a worse one. Step 8's tier system is what
        # should catch an empty mask before it reaches here.
        side = min(w, h)
        x0, y0 = (w - side) // 2, (h - side) // 2
        return dict(product_box=None, source_box=(x0, y0, x0 + side, y0 + side),
                    side=side, upscale=canvas / side, degraded=True)

    l, top, r, b = box
    side = int(round(max(r - l, b - top) / fill))
    cx, cy = (l + r) / 2.0, (top + b) / 2.0
    x0 = int(round(cx - side / 2.0))
    y0 = int(round(cy - side / 2.0))
    return dict(product_box=box, source_box=(x0, y0, x0 + side, y0 + side),
                side=side, upscale=canvas / side, degraded=False)


def product_box(alpha, eps=0.001):
    """Tightest (left, top, right, bottom) around the product, or None if there is no product.

    Not a plain `alpha > 0` bounding box. A soft mask has faint dust far from the subject —
    an eyelash of alpha 0.01 in a corner — and one such pixel drags the box to the frame edge
    and shrinks the product to nothing. So the box is found by mass instead: project the alpha
    onto each axis and take the interval holding all but `eps` of the total at each end.

    `eps` is 0.001. At that level what gets trimmed is anti-aliasing, not product: a tassel
    thread carries far more than a thousandth of the mask's weight. The 15% margin that
    `crop_fill_target` leaves means anything trimmed here is still comfortably inside the
    final frame — the box sets the *scale*, it is not the cut line.
    """
    import numpy as np

    a = np.asarray(alpha, dtype=np.float32)
    total = float(a.sum())
    if total <= 0.0:
        return None

    def span(mass):
        c = np.cumsum(mass, dtype=np.float64)
        lo = int(np.searchsorted(c, eps * total, side="left"))
        hi = int(np.searchsorted(c, (1.0 - eps) * total, side="left"))
        return lo, min(hi + 1, len(mass))

    l, r = span(a.sum(axis=0))
    top, b = span(a.sum(axis=1))
    if r <= l or b <= top:
        return None
    return l, top, r, b


def crop(image, alpha):
    """Square listing image, product at `crop_fill_target` of the frame, `listing_canvas_px` a side.

    **Run this after `composite()`, not before.** Where the square box falls outside the
    photograph this pads with white, which is only correct once the background already is
    white. Passing the original photograph gives it a white L-shaped border around the real
    background.

    Pure geometry — no colour is touched, and the product's aspect ratio is preserved, which
    rule 1 requires: a saree stretched to fit a square is a misrepresented saree.
    """
    from PIL import Image as _Image

    t = metrics.thresholds()
    canvas = t["listing_canvas_px"]
    plan = crop_plan(alpha, canvas=canvas, fill=t["crop_fill_target"])
    x0, y0, x1, y1 = plan["source_box"]
    side = plan["side"]

    src = image.convert("RGB")
    square = _Image.new("RGB", (side, side), (WHITE, WHITE, WHITE))
    # Paste only the part that actually exists; the rest stays white.
    ix0, iy0 = max(x0, 0), max(y0, 0)
    ix1, iy1 = min(x1, src.width), min(y1, src.height)
    if ix1 > ix0 and iy1 > iy0:
        square.paste(src.crop((ix0, iy0, ix1, iy1)), (ix0 - x0, iy0 - y0))

    if side == canvas:
        return square
    return square.resize((canvas, canvas), _Image.LANCZOS)


def export(image, targets):
    """Per-channel variants + EXIF strip. Amazon 2000sq q90 sRGB, IndiaMART 500sq, social 1080sq."""
    raise NotImplementedError


def run(image, targets):
    raise NotImplementedError
