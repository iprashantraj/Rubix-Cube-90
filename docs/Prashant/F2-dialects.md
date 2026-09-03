# F2 — does the interpreter actually read a dialect?

**Date:** 2026-09-03 · **Touches:** `ai/interpret.py` (both prompts), `ai/probe_dialects.py` (new)
· **Model:** `deepseek/deepseek-v4-flash` via OpenRouter

Every prompt in `interpret.py` names the languages it expects — Hindi, Odia, Tamil, Bengali,
English — and roughly none of our users speak exactly those. They speak Bhojpuri,
Chhattisgarhi, Awadhi, Magahi, Maithili: languages a government form calls "Hindi" and their
speakers do not. The design assumed the model was forgiving about this. Nobody had checked.

Reproduce with `cd ai && .venv/bin/python probe_dialects.py` (needs `OPENROUTER_API_KEY`).
It is not in the test suite: it spends money, needs the network, and measures a third party
on a given day rather than an invariant of this code.

## What the probe found, before any change

| case | said | got | verdict |
|---|---|---|---|
| bhojpuri / what | ee sutti ke saari **ha** | `सूती` (cotton) | **wrong at 0.9 confidence** |
| bhojpuri / what, minimal | ee saari ha | `None` | **refused a sentence it should read** |
| chhattisgarhi / what | ye maati ke matka **ye** | `माटी के बर्तन` | passable, "vessel" for "pot" |
| awadhi / time | ehi ma teen din **lag gawa** | `तीन दिन` | correct |
| maithili / material | ee sikki ke banal **aich** | `सिक्की` | correct |
| magahi / name | hamar naam Utsav Mohanty **hau** | `Utsav Mohanty` | correct |
| bhojpuri / harvest | three facts in one breath | all three slots | correct |

Two real failures, and both on `catalog.q_what` — the **first question of the interview** and
the one every harvest hangs off. The pattern is specific: the model handled the dialect
*vocabulary* fine and tripped on the dialect *copula*. `ha`, `ye`, `hau`, `aich` are all "is",
and where a sentence's only unfamiliar word was the verb, it either returned nothing or
reached past the noun and answered with the material instead.

Standard Hindi through the same prompt was correct, which is what makes this a dialect
finding rather than a prompt-quality one.

## The fix, and its evidence

Two rules added to `SYSTEM_PROMPT`, one to `SYSTEM_PROMPT_HARVEST`:

* name the dialects, and say that unfamiliar grammar is never a reason to return null
* for a question asking WHAT an object is, the answer is the noun — a material, a colour or
  a quality is never that answer, however clearly it was said

A/B on the same sentences, three attempts each:

| case | before | after |
|---|---|---|
| bhojpuri / what | `सूती` | `saari` |
| bhojpuri / what, minimal | `None` | `saari` |
| chhattisgarhi / what | `matka` | `matka` |
| standard hindi / what | `सूती की साड़ी` | `saree` |

12 of 12 probe cases now return a usable value. The standard-Hindi row moved and is an
improvement rather than a regression twice over: `q_what` wants the object, and `material`
is a slot of its own that the harvest fills from the same sentence; and the old answer had
been silently translated into Devanagari from a Latin transcript, which rule 4 forbids.

Re-checked for collateral damage: the allowlist path (`onboard.craft` with options) still
refuses a value outside the list, an injection attempt in the transcript still returns null,
and filler with no answer in it still returns null.

## What is still wrong

**Romanised input is transliterated into script.** `idhu kaithari pruthi pudavai` came back
as `கைத்தறி ப்ருதி புடவை` — Tamil script the artisan did not use, and `ப்ருதி` is a
misspelling of `பருத்தி`. Rule 4 says keep their script; the model reads "Tamil" in the
language tag and converts. Harmless for a listing (`describe` reads it either way), wrong for
a name, and worth a rule if it turns up on `onboard.name`.

**The language tag matters more than it looks.** The same romanised Tamil sentence sent with
`language: "hi"` returned `None`; with `language: "ta"` it returned the right word. The app
sends the artisan's chosen language, so this is correct today — but it means a wrong or
defaulted tag degrades comprehension silently rather than loudly.

**The flow has since been run in a browser** (`F2-shippable.md` §7) — in Tamil, end to end,
with one sentence filling three slots and the interview skipping the questions it had already
been given the answers to. Every answer in that run was TYPED. So the finding below stands
exactly as written.

**Nothing here is a promise about a real microphone.** These are typed transcripts. What ASR
does to Bhojpuri in a courtyard is a separate measurement, and it is not blocked: the Sarvam
key in `web/api/.env` works, in all four languages (`F2-shippable.md`, "Where F2 stands").
What it needs is somebody speaking Bhojpuri into a phone. Expect it to be the harder half —
the recogniser is trained on standard Hindi, so a dialect reaches this module already
degraded, and the two prompt rules above only repair what the transcript still carries.
