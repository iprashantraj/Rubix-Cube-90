"""F2 multilingual auto-cataloger.

    voice note (regional language)
        -> ASR
    transcript + image context
        -> LLM
    { title, desc_en, desc_hi, category, material, dimensions, keywords }

English AND Hindi. Both. Always. The PS names both explicitly.
"""

# Asked one at a time, by voice, in their language:
QUESTIONS = [
    "Yeh kya hai?",
    "Kisse bana hai?",
    "Kitna samay laga?",
    "Kya khaas hai isme?",
    "Kitna bada hai?",
]

# Captured as structured fields, not free text — feeds pricing, the craft story,
# and the authenticity claim all at once.
MANUFACTURE_FIELDS = [
    "material", "technique", "dye_type", "loom_type",
    "time_taken_hours", "cluster", "gi_claim",
]


def transcribe(audio_url, language):
    """Bhashini preferred — government stack, better dialect coverage, far cheaper.
    Commercial API behind the same interface as fallback.
    """
    raise NotImplementedError


def prefill(image_url):
    """Vision model reads category, material, colour, technique from the photo alone.

    The artisan then only *corrects* by voice instead of describing from scratch:
    "Yeh Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?" -> tap yes -> done.
    """
    raise NotImplementedError


def describe(transcript, image_url, prefilled=None):
    """LLM -> SEO-friendly professional description in English and Hindi."""
    raise NotImplementedError


def speak(text, language):
    """TTS. Every prompt, every error, every confirmation is spoken.
    Text is the fallback, not the default — that is what accessible means here.
    """
    raise NotImplementedError
