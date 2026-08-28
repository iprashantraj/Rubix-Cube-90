"""What to do with the fact that we were wrong.

`GET /catalog/defaults` remembers what an artisan said. This decides what to do when they
change something we guessed — which is the stronger signal, because it is labelled: we know
the guess, we know the truth, and we know which guesser produced it.

Two questions, and they are separate on purpose:

    trusted()    should we still OFFER a guess for this field, or has it been wrong so
                 often that a confirmation is now just an insult with a button on it?
    best()       when history and corrections disagree, which value do we show?

Pure functions over plain dicts. No ORM, no session, no clock — the caller passes rows in
and a decision comes out, so every rule below is testable against adversarial input without
a database. `test_learning.py` does exactly that, including the cases that made the naive
version of each rule wrong.

⚠️ Nothing here ever writes a value into a listing on its own. The output is always "offer
this, as a confirmation" or "offer nothing". A default that publishes without the artisan
confirming it is a guess under their name, and no amount of history earns that.
"""

from __future__ import annotations

import unicodedata

# How many times we may be wrong about a field before we stop offering guesses for it.
#
# Three, not one: an artisan who makes a cotton saree, then a silk one, then cotton again
# has corrected us once without our model being wrong about anything. One-strike would mean
# a single unusual product permanently silences a field that was helping.
#
# And not ten: being wrong ten times is ten confirmations they had to read, reject and
# re-record. The cost of a wrong guess is paid by the person least able to afford it.
WRONG_LIMIT = 3

# What may be recorded as a correction at all.
#
# Mirrors SLOTS in app/src/catalog/slots.js plus the listing fields /catalog/review lets an
# artisan re-record. Enumerated rather than open, for the same reason every other allowlist
# in this codebase is: without it this endpoint is arbitrary key/value storage keyed on an
# artisan id, and the first thing to end up in it will be something nobody reviewed.
#
# 🔒 No prices. `cost`, `price`, `mrp` and `floor_price` are absent and must stay absent —
# a correction row is read back to pre-fill a later product, and last week's material spend
# under this week's photo is a wrong number in a place nobody would think to check.
CORRECTABLE_FIELDS = frozenset(
    {
        "what",
        "material",
        "technique",
        "size",
        "colour",
        "weight",
        "stock",
        "lead_time",
        "special",
        "title",
        "desc",
        "category",
    }
)

# Corrections older than this stop counting against us.
#
# A potter who moved from terracotta to stoneware last year corrected us a lot at the time.
# Holding that against the field forever means the feature degrades permanently for the
# artisans who use it most, which is exactly backwards.
RECENT = 20


def norm(value) -> str:
    """Compare the way a human would.

    NFKC and casefold, because "Cotton", "cotton" and a compatibility-form "ｃotton" are the
    same answer and counting them as three disagreements would silence the field. Whitespace
    collapses for the same reason: a trailing space is not a correction.
    """
    if value is None:
        return ""
    return " ".join(unicodedata.normalize("NFKC", str(value)).casefold().split())


def _recent(corrections: list[dict], field: str) -> list[dict]:
    """This field's corrections, newest first, capped at the recency window.

    Assumes the caller ordered by recency — the query does, and re-sorting here would need
    a timestamp this module has deliberately not been given.
    """
    return [c for c in corrections if c.get("field") == field][:RECENT]


def trusted(corrections: list[dict], field: str, source: str | None = None) -> bool:
    """Whether a guess for `field` is still worth putting to the artisan.

    A correction only counts against us when it actually changed something. `guessed` equal
    to `corrected` is the artisan re-recording the same value because the microphone cut
    out, or fixing a different field on the same screen — treating that as evidence we were
    wrong is how a field silences itself while it is working perfectly.

    `source` narrows it: the vision model being unreliable for this artisan says nothing
    about whether their own history is. Scored separately, because they have different
    fixes and averaging them hides both.
    """
    wrong = 0
    for c in _recent(corrections, field):
        if source is not None and c.get("source") != source:
            continue
        guessed, corrected = norm(c.get("guessed")), norm(c.get("corrected"))
        # No guess means nothing was offered, so nothing was wrong. A correction recorded
        # against an empty guess is the artisan filling a blank, which is a success.
        if not guessed:
            continue
        if guessed != corrected:
            wrong += 1
    return wrong < WRONG_LIMIT


def best(corrections: list[dict], history_value, field: str):
    """The value to offer for `field`, or None to offer nothing.

    Ordering, and each step is a rule that a simpler version got wrong:

    1. If we are no longer trusted on this field, offer nothing. Asking outright is better
       than a confirmation the artisan has already learned to reject.
    2. The most recent correction wins over history. It is the value they typed over the
       top of ours, which is the strongest evidence available.
    3. Otherwise history, which is what /catalog/defaults already computes.

    A correction whose `corrected` is empty is skipped rather than returned: an artisan who
    cleared a field said "not this", not "the answer is nothing", and offering an empty
    confirmation is a screen that asks them to agree with a blank.
    """
    if not trusted(corrections, field):
        return None

    for c in _recent(corrections, field):
        corrected = c.get("corrected")
        if corrected is not None and str(corrected).strip():
            return corrected

    return history_value if history_value is not None and str(history_value).strip() else None


def apply(defaults: dict, corrections: list[dict]) -> dict:
    """Fold corrections into the raw history read. Returns what to offer, per field.

    Fields present in `defaults` and fields we only know about from corrections are both
    considered — an artisan who has corrected `material` on three drafts that were never
    saved as products has taught us something the products table cannot see.
    """
    fields = set(defaults) | {c.get("field") for c in corrections if c.get("field")}
    out = {}
    for field in fields:
        value = best(corrections, defaults.get(field), field)
        if value is not None:
            out[field] = value
    return out
