"""The `white_ref` hand-off: app tap -> POST /products/{id}/enhance -> AI POST /enhance.

Run: cd web && api/.venv/bin/python3 api/test_white_ref.py

`ai/contracts.md` calls white_ref the one field the app still owes the endpoint. It is
optional on purpose — absent, `white_balance()` runs its neutral-pixel estimate, which is
what shipped before the field existed — so the thing worth asserting is that the absent case
stays byte-identical to the old payload, and that a client-supplied rect is bounds-checked
here rather than trusted to be clamped on the far side.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pydantic import ValidationError  # noqa: E402

from web.api.routers.products import EnhanceIn, _enhance_payload  # noqa: E402

OLD = {"product_id": "p1", "image_url": "file:///x.jpg",
       "targets": ["amazon", "gem", "whatsapp"]}


def test_no_body_sends_exactly_what_it_always_sent():
    """The app that has not been updated yet must be unaffected — not even a null key."""
    assert _enhance_payload("p1", "file:///x.jpg", None) == OLD


def test_a_body_without_a_tap_sends_no_white_ref_key():
    body = EnhanceIn()
    assert _enhance_payload("p1", "file:///x.jpg", body) == OLD


def test_a_tap_is_forwarded_in_the_contract_shape():
    body = EnhanceIn(white_ref={"x": 0.61, "y": 0.78, "w": 0.12, "h": 0.09})
    payload = _enhance_payload("p1", "file:///x.jpg", body)
    assert payload["white_ref"] == {"x": 0.61, "y": 0.78, "w": 0.12, "h": 0.09}


def test_an_out_of_frame_rect_is_refused():
    """A rect indexes a numpy array on the AI box. `_patch_means` clamps, but the clamp is
    not the boundary — this is."""
    for bad in ({"x": -0.1, "y": 0.5, "w": 0.1, "h": 0.1},
                {"x": 0.5, "y": 1.4, "w": 0.1, "h": 0.1},
                {"x": 0.5, "y": 0.5, "w": 0.0, "h": 0.1},   # zero-area reads nothing
                {"x": 0.5, "y": 0.5, "w": 0.1, "h": -0.2}):
        try:
            EnhanceIn(white_ref=bad)
        except ValidationError:
            continue
        raise AssertionError(f"accepted an out-of-frame rect: {bad}")


def test_a_partial_rect_is_refused():
    """Three of four fields is a bug in the caller, not a rect with defaults."""
    try:
        EnhanceIn(white_ref={"x": 0.5, "y": 0.5, "w": 0.1})
    except ValidationError:
        return
    raise AssertionError("accepted a rect missing h")


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print("  ok ", name)
    print("all passed")
