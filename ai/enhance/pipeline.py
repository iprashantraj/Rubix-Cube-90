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
    """BiRefNet baseline; SAM 2 tap-to-refine when auto fails.

    Binary masks chop fringes and tassels — see matte().
    """
    raise NotImplementedError


def matte(image, mask):
    """Alpha matting with trimap refinement.

    Semi-transparent edges (muslin, net, chanderi, glass) need real alpha or the
    pallu appears sliced off.
    """
    raise NotImplementedError


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


def composite(image, alpha):
    """Pure #FFFFFF background. Verify programmatically — sample corners and assert.

    Marketplaces flag near-white like (252,252,252) even when the eye can't tell.
    No shadow on the main image; soft contact shadow allowed on secondaries.
    """
    raise NotImplementedError


def crop(image, alpha):
    """Bounding box -> padding -> product fills 85-90% -> square 2000x2000. Pure math."""
    raise NotImplementedError


def export(image, targets):
    """Per-channel variants + EXIF strip. Amazon 2000sq q90 sRGB, IndiaMART 500sq, social 1080sq."""
    raise NotImplementedError


def run(image, targets):
    raise NotImplementedError
