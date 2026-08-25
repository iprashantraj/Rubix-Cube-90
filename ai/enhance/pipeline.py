"""F1 image pipeline. Stages run in order; each takes an image and returns an image.

The gate runs first so we reject before spending GPU time. Every stage after
segmentation operates on the product region only — we already have the mask.

Line we do not cross: never change colour or shape. Enhance, don't misrepresent.
Return rate destroys artisan income, and misrepresentation is a listing violation.
"""

# Rejection reasons this pipeline exists to defeat:
#   background not pure white  ->  composite()
#   product under 85% of frame ->  crop()
#   blurry / under 1000px      ->  gate()
#   wrong colour vs what ships ->  white_balance()
#   shadows on white           ->  composite()


def gate(image):
    """Reject before GPU: resolution, blur, extreme exposure. Thresholds from ../thresholds.json."""
    raise NotImplementedError


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
