"""F2's vision pre-fill: read the photograph before the artisan says anything.

The friction this removes is the whole point. Without it `/catalog/voice` opens with "yeh
kya hai?" and the artisan describes a saree from scratch, out loud, to a phone. With it the
app speaks a guess — "Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?" — and they say
yes. Correcting a guess is a far smaller task than composing a description, and it is the
difference between two taps and six spoken answers for someone who cannot read the screen.

Every field it fills is a question `catalog/slots.js` then does not ask.

── What it may look at, and what it must not ──────────────────────────────────────────────
Rule 1 is sharper here than anywhere else in the app. Everywhere else a fabricated detail
has to survive the artisan reading it. Here it arrives as a spoken question they answer
"yes" to, so an invented material ends up on a listing wearing the artisan's own
confirmation. That is worse than no pre-fill at all.

So this returns ONLY what a photograph can actually carry — what the object is, its colour,
and a material or technique when the weave is legible — and `null` for everything else.
It never guesses size, weight, stock, lead time, cost or hours, and not merely because they
are unknowable from an image: `time` and `cost` are inputs to F3's price floor, and a
hallucinated "three days" moves real money. A field this cannot see is a question worth
asking out loud.

`confidence` is what the app gates on. A weak guess should not be spoken at all — being
asked to confirm something wrong costs more than being asked the question plainly.
"""

from __future__ import annotations

import base64
import os
import re
from io import BytesIO

# A vision model, and an INSTRUCT one for the same reason interpret.py names one: a
# reasoning model spends the token budget narrating and returns empty content. Overridable
# because which vision models an OpenRouter account can reach is an account setting, not a
# code decision — see the data-policy note in interpret.py.
VISION_MODEL = os.environ.get("OPENROUTER_VISION_MODEL", "").strip() or "qwen/qwen3-vl-30b-a3b-instruct"

# Only fields a photograph can carry. Deliberately a subset of the harvest slots: the ones
# left out are left out because they are not in the picture.
ALLOWED_PREFILL_FIELDS = ("what", "material", "colour", "technique", "category", "title")

MAX_FIELD_CHARS = 120
MAX_KEYWORDS = 8

# The longest side the model is sent. Big enough to read a weave, small enough that the
# call stays quick and cheap — this runs while the artisan is watching a progress screen.
VISION_MAX_PX = 768

SYSTEM_PROMPT_PREFILL = """\
You are looking at one photograph of a handmade object made by an artisan in India. Your \
job is to say what you can actually see, so the app can ask them to confirm it instead of \
making them describe it from scratch.

Return ONLY a JSON object, no prose, no markdown, no code fences, shaped exactly:
{"what": "...", "material": "...", "colour": "...", "technique": "...", \
"category": "...", "title": "...", "keywords": ["..."], "confidence": 0.0}

Rules:
1. Every field may be null, and null is a good answer. Someone will be asked out loud to \
confirm whatever you write, and they may say yes without listening closely — so a guess \
you are not sure of becomes a false detail on a real listing that they appear to have \
approved. Null costs one spoken question. A wrong value costs a customer return.
2. Report only what is visible in this photograph. Never state the size, the weight, how \
long it took, what it cost, how many exist, or where it was made. You cannot see any of \
those. Do not infer them from what objects of this kind usually are.
3. `material` only when the surface actually shows it — a visible weave, grain, glaze or \
metal. If cotton and a cotton-polyester blend would look the same here, the answer is null.
4. `technique` only when the working is legible in the image, such as a visible ikat \
blur, block-print repeat, or hand-thrown ridges. Otherwise null.
5. `colour`: the dominant colour in plain words, in English.
6. `category`: a dotted slug like "textiles.saree" or "pottery.vessel". Go only as deep as \
you can see. "textiles.saree" is a better answer than a specific weave you are guessing at.
7. `title`: a short plain name for the object, in English. No promotional words.
8. `keywords`: up to 8 search terms supported by what you can see. Fewer is fine.
9. `confidence`: 0.0 to 1.0, for the guess as a whole, written with at most two decimal \
places — 0.25, not 0.2514873629915583. Be honest and be harsh. If the photograph is dark, \
blurred, cropped, or shows several unrelated objects, say so with a low number. The app \
stays silent below a threshold, which is the correct outcome.
10. If the photograph does not show a handmade object at all, return every field null with \
confidence 0.
11. Never output an explanation, an apology, a URL, code, or any text outside the JSON.
"""


def to_data_url(image, max_px: int = VISION_MAX_PX) -> str:
    """A PIL image in, a JPEG data URL out, downscaled to `max_px` on the longest side.

    `storage.open_image` is what reads the upload, so every scheme it supports works here
    and `s3://` stays the one explicit refusal — the caller turns that into a 502 the same
    way `/enhance` does. Sending pixels rather than a url also means OpenRouter never needs
    to reach our storage, which for a `file://` path or a private bucket it cannot do.
    """
    im = image.convert("RGB")
    longest = max(im.size)
    if longest > max_px:
        scale = max_px / longest
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))))
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=82)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _clean(value, limit: int = MAX_FIELD_CHARS) -> str | None:
    """A model's field to something storable, or None. Null is a supported answer."""
    if not isinstance(value, str):
        return None
    text = re.sub(r"\s+", " ", value).strip()[:limit]
    # Models write these instead of using the null the schema offers them.
    if not text or text.lower() in {"null", "none", "unknown", "n/a", "not visible"}:
        return None
    return text


def validate_prefill(raw_content: str) -> dict:
    """Whatever the model said, as fields we are willing to speak aloud, or nulls.

    Assumes the model ignored every instruction it was given. In particular it drops any
    field outside `ALLOWED_PREFILL_FIELDS`, so a model that helpfully volunteers "size":
    "6 meters" cannot put a measurement nobody took into the interview.
    """
    import json

    text = (raw_content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\s*|\s*```$", "", text, flags=re.IGNORECASE)

    try:
        body = json.loads(text)
    except (ValueError, TypeError):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        try:
            body = json.loads(match.group(0)) if match else None
        except (ValueError, TypeError):
            body = None

    empty = {f: None for f in ALLOWED_PREFILL_FIELDS} | {"keywords": [], "confidence": 0.0}
    if not isinstance(body, dict):
        return empty

    out = {f: _clean(body.get(f)) for f in ALLOWED_PREFILL_FIELDS}

    raw_kw = body.get("keywords")
    out["keywords"] = [
        k for k in ((_clean(x, 40) for x in raw_kw[:MAX_KEYWORDS]) if isinstance(raw_kw, list) else [])
        if k
    ]

    try:
        out["confidence"] = min(max(float(body.get("confidence", 0.0)), 0.0), 1.0)
    except (TypeError, ValueError):
        out["confidence"] = 0.0

    # A guess with nothing in it is not a guess. Reporting confidence on an empty object
    # would let the app speak "is this right?" about nothing at all.
    if not any(out[f] for f in ALLOWED_PREFILL_FIELDS):
        out["confidence"] = 0.0

    return out


def demo() -> None:
    """Runnable with plain python3 — no venv, no key, no network, no image."""
    from PIL import Image

    def eq(got, want, msg):
        assert got == want, f"{msg}: got {got!r}, want {want!r}"

    v = validate_prefill('{"what":"saree","material":"cotton","colour":"blue",'
                         '"technique":null,"category":"textiles.saree","title":"Cotton Saree",'
                         '"keywords":["saree","cotton"],"confidence":0.7}')
    eq(v["what"], "saree", "a clean object survives")
    eq(v["technique"], None, "an explicit null stays null")
    eq(v["confidence"], 0.7, "confidence survives")

    fenced = validate_prefill('```json\n{"what":"pot","confidence":0.5}\n```')
    eq(fenced["what"], "pot", "a fenced object is tolerated")
    eq(fenced["material"], None, "a missing field is null, not absent")

    smuggled = validate_prefill('{"what":"saree","size":"6 meters","time":"3 days",'
                                '"cost":800,"confidence":0.9}')
    assert "size" not in smuggled and "time" not in smuggled and "cost" not in smuggled, \
        "a field the model volunteered but cannot see must not reach the interview"

    eq(validate_prefill("I think this is a saree!")["confidence"], 0.0,
       "prose is not a guess")
    eq(validate_prefill('{"what":null,"confidence":0.9}')["confidence"], 0.0,
       "an empty guess cannot carry confidence — there is nothing to confirm")
    eq(validate_prefill('{"what":"unknown","confidence":0.8}')["what"], None,
       "the word 'unknown' is a null wearing a string")
    eq(validate_prefill('{"what":"saree","confidence":"high"}')["confidence"], 0.0,
       "a non-numeric confidence is zero, never assumed high")

    url = to_data_url(Image.new("RGB", (4000, 2000), "red"), max_px=64)
    assert url.startswith("data:image/jpeg;base64,"), "a data url is produced"
    from PIL import Image as I
    back = I.open(BytesIO(base64.b64decode(url.split(",", 1)[1])))
    eq(back.size, (64, 32), "downscaled on the longest side, aspect kept")

    small = to_data_url(Image.new("RGB", (20, 10), "blue"), max_px=64)
    back = I.open(BytesIO(base64.b64decode(small.split(",", 1)[1])))
    eq(back.size, (20, 10), "an already-small image is not upscaled")

    print("all prefill checks passed")


if __name__ == "__main__":
    demo()
