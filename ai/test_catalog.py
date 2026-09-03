"""F2's shaping layer under pytest, and the self-checks wired in so they cannot rot.

    cd ai && .venv/bin/pytest test_catalog.py

Two halves. The first runs the `demo()` blocks that already live in the F2 modules — they
were thorough and nothing collected them, so they passed only when somebody remembered to
run the file by hand. The second half is what they did not cover, which is almost entirely
about scripts that are not Latin: every character limit in seo.py is a character limit, one
is a BYTE limit, and the difference is invisible until a Devanagari or Tamil listing arrives
truncated.

Nothing here calls a model or touches the network.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from catalog import describe, prefill, seo

HERE = Path(__file__).parent

# One spoken sentence in each script F2 accepts, with its meaning, so a failure names a
# language rather than a code point. Tamil and Bengali are here ahead of being accepted
# languages: the shaping is script-agnostic by design and this is what proves it before
# anyone relies on it.
SCRIPTS = {
    "hindi": "हस्तनिर्मित संबलपुरी सूती साड़ी",
    "odia": "ହସ୍ତନିର୍ମିତ ସମ୍ବଲପୁରୀ ସୂତା ଶାଢ଼ୀ",
    "tamil": "கைத்தறி பருத்தி புடவை",
    "bengali": "হাতে বোনা সুতির শাড়ি",
}


# ---------------------------------------------------------------------------
# the existing self-checks, collected
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mod", [seo, describe, prefill], ids=lambda m: m.__name__)
def test_the_module_self_check_still_passes(mod):
    mod.demo()


def test_the_interpreter_self_check_still_passes():
    """interpret.py keeps its checks under `__main__` rather than in a function, so this
    runs the file. Same guarantee, one subprocess."""
    run = subprocess.run(
        [sys.executable, str(HERE / "interpret.py")],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert run.returncode == 0, run.stdout + run.stderr


# ---------------------------------------------------------------------------
# byte limits vs character limits — the failure this file exists for
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("script,text", SCRIPTS.items())
def test_amazon_keywords_fit_the_byte_cap_in_every_script(script, text):
    """249 BYTES, not characters. Every Indic script costs three bytes per character, so a
    keyword string that looks a third of the limit long is already over it."""
    listing = {"title": "Saree", "keywords": [text] * 12}
    shaped = seo.shape("amazon", listing)

    assert isinstance(shaped["keywords"], str)
    assert len(shaped["keywords"].encode("utf-8")) <= seo.LIMITS["amazon"]["keyword_bytes"]
    # Decodes cleanly: slicing UTF-8 by bytes can land mid-character.
    shaped["keywords"].encode("utf-8").decode("utf-8")


@pytest.mark.parametrize("script,text", SCRIPTS.items())
def test_clipping_never_leaves_a_broken_character(script, text):
    """Every byte offset around the cap, not just the cap. A three-byte character can be
    split at two different offsets and only one of them is the one a test happens to hit."""
    long = " ".join([text] * 20)
    for limit in range(1, 120):
        out = seo.clip_bytes(long, limit)
        raw = out.encode("utf-8")
        assert len(raw) <= limit
        raw.decode("utf-8")  # raises on a half character


@pytest.mark.parametrize("script,text", SCRIPTS.items())
def test_a_title_limit_counts_characters_not_bytes(script, text):
    """The mirror of the above, and the reason both functions exist. Amazon's title cap is
    75 CHARACTERS — clipping it by bytes would cost an Indic seller two thirds of a title
    they are entitled to."""
    listing = {"title": " ".join([text] * 10)}
    title = seo.shape("amazon", listing)["title"]

    assert len(title) <= 75
    # 75 characters of Devanagari is ~225 bytes. If this ever fits in 75 bytes, somebody
    # has swapped clip_chars for clip_bytes and every non-Latin title just got shorter.
    assert len(title.encode("utf-8")) > 75


# ---------------------------------------------------------------------------
# the seller-name scrub, in the script the name is actually written in
# ---------------------------------------------------------------------------


def test_a_devanagari_name_is_scrubbed_for_gem():
    """The existing self-check asserted this with `or True` appended, which is not an
    assertion. GeM rejects any listing carrying seller information, and an artisan whose
    display name is in Devanagari is the normal case, not the edge one."""
    listing = {
        "title": "संबलपुरी साड़ी",
        "desc_en": "A saree woven by Utsav Mohanty.",
        "desc_hi": "उत्सव मोहंती द्वारा बुनी गई संबलपुरी सूती साड़ी।",
    }
    gem = seo.shape("gem", listing, artisan_name="उत्सव मोहंती")

    assert "उत्सव" not in gem["desc_hi"], "the Hindi name is removed from the Hindi copy"
    assert "संबलपुरी" in gem["desc_hi"], "and the product survives the scrub"


def test_a_name_that_is_a_substring_of_a_product_word_is_left_alone():
    """Word-boundary matched, or an artisan called "Sam" takes "Sambalpuri" out of every
    listing they ever publish."""
    kept = seo.strip_seller_identity("Sambalpuri cotton saree", "Sambal")
    assert "Sambalpuri" in kept


# ---------------------------------------------------------------------------
# the platforms that have no keyword field at all
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("channel", ["meesho", "gem", "whatsapp"])
def test_a_channel_with_no_keyword_field_gets_no_keywords(channel):
    """Zero is a stated fact about these platforms' forms, not an oversight. A keyword
    string pasted into a form that has no keyword box lands in the description."""
    shaped = seo.shape(channel, {"title": "Saree", "keywords": ["handloom", "ikat"]})
    assert shaped["keywords"] == []

    block = seo.copy_block(channel, shaped)
    assert [b["field"] for b in block] == ["title", "description"] or block == [
        {"field": "title", "voice_key": f"{channel}.step.name", "copy": "Saree"}
    ], "no keyword button is offered for a form with no keyword field"


def test_the_copy_block_speaks_the_language_the_artisan_chose():
    shaped = seo.shape("meesho", {"title": "Saree", "desc_en": "A saree.", "desc_hi": "एक साड़ी।"})

    hindi = seo.copy_block("meesho", shaped, "hi")
    english = seo.copy_block("meesho", shaped, "en")

    assert hindi[1]["copy"] == "एक साड़ी।"
    assert english[1]["copy"] == "A saree."


def test_an_empty_hindi_description_falls_back_rather_than_pasting_nothing():
    """A blank field is worse than an English one: the artisan pastes emptiness into a form
    and publishes a listing with no description."""
    shaped = seo.shape("meesho", {"title": "Saree", "desc_en": "A saree.", "desc_hi": ""})
    assert seo.copy_block("meesho", shaped, "hi")[1]["copy"] == "A saree."


# ---------------------------------------------------------------------------
# the fallback listing — what an artisan gets when the model is unreachable
# ---------------------------------------------------------------------------


def test_the_fallback_listing_is_usable_and_says_it_is_a_fallback():
    """Rule 3: losing F2 costs a prettier description, never the listing. `confidence: 0`
    is the only thing telling the app the model never answered."""
    fields = {"what": "saree", "material": "cotton", "technique": "handloom"}
    fb = describe.compose_fallback(fields)

    assert fb["title"], "a listing without a title cannot be published anywhere"
    assert fb["desc_en"] and fb["desc_hi"], "the PS names both languages, always"
    assert fb["confidence"] == 0, "a composed listing must not claim model confidence"
    assert "cotton" in fb["desc_en"], "built from the artisan's own words, not invented"


def test_the_fallback_survives_shaping_for_every_channel():
    """The path taken during an outage is the one least likely to have been exercised."""
    fb = describe.compose_fallback({"what": "saree", "material": "cotton"})
    for channel in seo.LIMITS:
        shaped = seo.shape(channel, fb, artisan_name="Utsav Mohanty")
        assert shaped["title"], f"{channel} lost the title"


# ---------------------------------------------------------------------------
# the harvest prompt's worked examples
# ---------------------------------------------------------------------------


def test_every_worked_example_teaches_a_slot_we_would_actually_keep():
    """The examples in SYSTEM_PROMPT_HARVEST are the highest-leverage lines in F2 — they are
    what turns one generous sentence into four filled slots instead of one. They are also
    unreviewed prose that a model copies exactly, so an example naming a slot outside
    HARVESTABLE_SLOTS would teach it to return a value `validate_harvest` then discards, and
    the only symptom would be a quieter harvest nobody can explain."""
    import json as _json
    import re as _re

    from interpret import HARVESTABLE_SLOTS, SYSTEM_PROMPT_HARVEST

    examples = _re.findall(
        r'SLOTS: (\[[^\]]*\])\nTRANSCRIPT: <<<.*?>>>\n(\{.*?\})\n',
        SYSTEM_PROMPT_HARVEST,
        _re.DOTALL,
    )
    assert len(examples) >= 3, "the prompt lost its worked examples"

    empty_seen = False
    for offered, answer in examples:
        wanted = set(_json.loads(offered))
        body = _json.loads(answer)
        assert wanted <= HARVESTABLE_SLOTS, f"an example offers a slot we never accept: {wanted}"
        assert set(body["slots"]) <= wanted, "an example fills a slot it was not offered"
        assert 0.0 <= body["confidence"] <= 1.0
        empty_seen = empty_seen or not body["slots"]

    assert empty_seen, "one example must show that finding nothing is a correct answer"


# ---------------------------------------------------------------------------
# the seller scrub, in the scripts artisans are actually named in
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,name,gone,kept",
    [
        # `\b` does not work here: every Indic vowel sign is a combining mark, which Python's
        # re counts as a NON-word character, so `\bमोहंती\b` never matches and the surname
        # stayed in the listing. GeM rejects seller identity in any field, so this was a
        # rejection an artisan could not have diagnosed. Found on the first live run.
        ("उत्सव मोहंती द्वारा बुनी गई संबलपुरी साड़ी।", "उत्सव मोहंती", "मोहंती", "संबलपुरी"),
        ("হাতে বোনা শাড়ি, শিল্পী রবীন্দ্র", "রবীন্দ্র", "রবীন্দ্র", "শাড়ি"),
        ("கைத்தறி புடவை, நெசவாளர் முருகன்", "முருகன்", "முருகன்", "புடவை"),
        ("ଉତ୍ସବ ମହାନ୍ତି ଙ୍କ ଦ୍ୱାରା ବୁଣା", "ମହାନ୍ତି", "ମହାନ୍ତି", "ବୁଣା"),
    ],
)
def test_a_name_is_scrubbed_whatever_script_it_is_written_in(text, name, gone, kept):
    out = seo.strip_seller_identity(text, name)
    assert gone not in out, f"{gone} survived the scrub"
    assert kept in out, "the product was scrubbed along with the name"


@pytest.mark.parametrize(
    "text,name,want",
    [
        ("Cotton Saree by Utsav Mohanty", "Utsav Mohanty", "Cotton Saree"),
        ("This saree is woven by Utsav Mohanty. It is made of cotton.", "Utsav Mohanty",
         "This saree is woven. It is made of cotton"),
        ("उत्सव मोहंती द्वारा बुनी गई साड़ी।", "उत्सव मोहंती", "बुनी गई साड़ी।"),
    ],
)
def test_the_connector_leaves_with_the_name(text, name, want):
    """Removing "Utsav Mohanty" alone left "Cotton Saree by" as a GeM title and "woven by ."
    as its description — a sentence with a hole where a name used to be. English puts the
    connector before the name, Hindi and Odia after; both go."""
    assert seo.strip_seller_identity(text, name) == want


def test_a_name_that_is_the_start_of_a_product_word_is_still_safe():
    """The boundary has to work in both directions — the lookarounds that made Indic names
    match must not make Latin ones match too eagerly."""
    assert seo.strip_seller_identity("Sambalpuri cotton saree", "Sambal") == "Sambalpuri cotton saree"
    assert seo.strip_seller_identity("Kamal lotus painting", "Kamal Das") == "lotus painting"
