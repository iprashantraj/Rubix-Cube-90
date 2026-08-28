"""Adversarial tests for learning.py. No database, no framework: `python3 test_learning.py`.

Every block below is an attempt to make the module behave badly on input a real artisan can
produce. Several of them describe bugs the first version of this file actually had, and
those are marked — a test whose failure mode was hypothetical is worth less than one that
caught something.

The property that matters throughout: **being wrong must cost the artisan a question, never
a wrong listing.** Any ambiguity resolves toward asking.
"""

from __future__ import annotations

from learning import RECENT, WRONG_LIMIT, apply, best, norm, trusted


def c(field, guessed, corrected, source="default"):
    return {"field": field, "guessed": guessed, "corrected": corrected, "source": source}


def eq(got, want, msg):
    if got != want:
        raise AssertionError(f"{msg}\n  got:  {got!r}\n  want: {want!r}")


def main() -> None:
    # ── norm: what counts as "the same answer" ─────────────────────────────────────────
    eq(norm("Cotton"), "cotton", "case is not a correction")
    eq(norm("  cotton  "), "cotton", "surrounding space is not a correction")
    eq(norm("cotton  silk"), "cotton silk", "internal run of spaces collapses")
    eq(norm(None), "", "a missing value normalises to empty, not to 'None'")
    eq(norm(123), "123", "a number is comparable without crashing")
    # NFKC: a fullwidth character is the same word to a human and must be to us.
    eq(norm("ｃotton"), norm("cotton"), "compatibility forms compare equal")
    eq(norm("साड़ी"), norm("साड़ी"), "Devanagari normalises consistently")

    # ── trusted: only real disagreements count ────────────────────────────────────────
    eq(trusted([], "material"), True, "with no history we are trusted")

    # 🐞 The bug the first version had: it counted every correction row. An artisan whose
    # microphone cut out re-records the same answer, which arrives as a correction with
    # guessed == corrected, and three of those silenced a field that was never wrong.
    same = [c("material", "cotton", "cotton") for _ in range(9)]
    eq(trusted(same, "material"), True,
       "re-recording the same value is not evidence we were wrong")

    # Likewise a correction against a blank guess: we offered nothing, so nothing was wrong.
    blanks = [c("material", None, "cotton") for _ in range(9)]
    eq(trusted(blanks, "material"), True, "filling a blank is a success, not a miss")
    eq(trusted([c("material", "", "cotton")] * 9, "material"), True,
       "an empty-string guess is the same as no guess")

    # Real disagreements do count, and the threshold is exact.
    wrong = [c("material", "rayon", "silk") for _ in range(WRONG_LIMIT - 1)]
    eq(trusted(wrong, "material"), True, f"{WRONG_LIMIT - 1} misses is still trusted")
    wrong.append(c("material", "rayon", "silk"))
    eq(trusted(wrong, "material"), False, f"{WRONG_LIMIT} misses stops the guessing")

    # Fields are scored independently. Being wrong about material says nothing about weight.
    eq(trusted(wrong, "weight"), True, "one bad field does not silence the others")

    # Sources are scored independently too: a bad vision model is not bad history.
    vision_misses = [c("material", "rayon", "silk", source="prefill") for _ in range(5)]
    eq(trusted(vision_misses, "material", source="default"), True,
       "the vision model being wrong does not discredit the artisan's own history")
    eq(trusted(vision_misses, "material", source="prefill"), False,
       "but it does discredit the vision model")

    # Case-only differences are not misses. Without norm() this silences a working field.
    caseish = [c("material", "Cotton", "cotton") for _ in range(9)]
    eq(trusted(caseish, "material"), True, "a capital letter is not a correction")

    # ── recency: a past life does not silence a field forever ─────────────────────────
    # Newest first, as the query returns them. Old misses fall outside the window.
    recent_good = [c("material", "cotton", "cotton") for _ in range(RECENT)]
    ancient_bad = [c("material", "terracotta", "stoneware") for _ in range(50)]
    eq(trusted(recent_good + ancient_bad, "material"), True,
       "corrections beyond the recency window stop counting against us")

    # ── best: which value to actually offer ───────────────────────────────────────────
    eq(best([], "cotton", "material"), "cotton", "with no corrections, history wins")
    eq(best([], None, "material"), None, "no history and no corrections offers nothing")
    eq(best([], "   ", "material"), None, "whitespace history is not a value")

    # The most recent correction beats history — it is what they typed over the top of ours.
    eq(best([c("material", "cotton", "tussar silk")], "cotton", "material"), "tussar silk",
       "a correction outranks the products table")

    # Newest first: the first matching row wins, not the last.
    seq = [c("material", "cotton", "silk"), c("material", "cotton", "jute")]
    eq(best(seq, "cotton", "material"), "silk", "the newest correction is the one offered")

    # 🐞 An artisan who CLEARS a field said "not this", not "the answer is blank". Returning
    # the empty string here rendered a confirmation asking them to agree with nothing.
    cleared = [c("material", "cotton", ""), c("material", "cotton", "silk")]
    eq(best(cleared, "cotton", "material"), "silk",
       "an emptied correction is skipped, not offered as a blank confirmation")
    eq(best([c("material", "cotton", "   ")], "cotton", "material"), "cotton",
       "a whitespace correction falls through to history")

    # Once untrusted, offer nothing at all — even though corrections exist to draw from.
    dead = [c("material", "rayon", f"silk{i}") for i in range(WRONG_LIMIT)]
    eq(best(dead, "cotton", "material"), None,
       "an untrusted field offers nothing; asking outright beats a rejected confirmation")

    # ── apply: the whole fold ─────────────────────────────────────────────────────────
    eq(apply({}, []), {}, "nothing in, nothing out")
    eq(apply({"material": "cotton", "weight": 800}, []),
       {"material": "cotton", "weight": 800}, "clean history passes straight through")

    folded = apply({"material": "cotton", "weight": 800},
                   [c("material", "cotton", "tussar silk")])
    eq(folded["material"], "tussar silk", "the corrected field is replaced")
    eq(folded["weight"], 800, "an untouched field is left alone")

    # A field only ever seen in corrections still teaches us. Drafts that never became
    # products are invisible to the products table but not to this.
    eq(apply({}, [c("lead_time", None, "5")])["lead_time"], "5",
       "a field known only from corrections is still offered")

    # An untrusted field disappears from the offer entirely rather than appearing as null.
    out = apply({"material": "cotton"}, dead)
    eq("material" in out, False, "an untrusted field is absent, not present-and-None")

    # ── malformed input must not crash a screen ───────────────────────────────────────
    eq(apply({"material": "cotton"}, [{}]), {"material": "cotton"}, "a row with no field")
    eq(apply({"material": "cotton"}, [{"field": None}]), {"material": "cotton"},
       "a row with a null field")
    eq(best([{"field": "material"}], "cotton", "material"), "cotton",
       "a correction row missing both values falls through to history")
    eq(trusted([{"field": "material", "guessed": 5, "corrected": 5}] * 9, "material"), True,
       "non-string values compare without crashing")

    # ── the safety property, stated as a test ─────────────────────────────────────────
    # Whatever the history, `apply` never invents a field nobody has evidence for.
    noise = [c("material", "a", "b"), c("weight", "1", "2")]
    assert set(apply({}, noise)) <= {"material", "weight"}, (
        "apply never produces a field it was told nothing about"
    )

    print("all learning checks passed")


if __name__ == "__main__":
    main()
