"""F1 "Studio" — secondary images only.

Generated images are ALWAYS secondary, never the main image. A generated model shot
used as the primary is "inaccurate representation" and gets the listing rejected.

Generation is opt-in and hard-capped (e.g. 2 per artisan, or unlocked after first sale).
One enthusiastic user should not burn the budget.
"""


def lifestyle_scene(image, product_type):
    """Matka on a wooden table, saree draped on a mannequin. API, capped."""
    raise NotImplementedError


def detail_crops(image, mask):
    """Weave texture, knot work, hallmark. Derived from the mask — no generation, no cost."""
    raise NotImplementedError


def scale_overlay(image, dimensions):
    """Dimension reference so buyers know how big it actually is."""
    raise NotImplementedError
