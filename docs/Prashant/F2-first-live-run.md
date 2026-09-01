# F2 — the first live run, and the four faults it found

**Date:** 2026-09-01 · **Touches:** `ai/service.py`, `ai/interpret.py`, `ai/catalog/describe.py`,
`ai/requirements.txt`, `web/api/.env.example`, `web/api/routers/voice.py`, `scripts/f2_smoke.py`
**Branch:** `f2-cataloger-fixes` · **Commits:** `f160307`, `7766f58` · **PR:** #1

**Not F3.** F2 is not my feature; this is the record of taking it from *written* to *observed*,
because nobody had ever run it against a live model and the difference turned out to matter.

---

## Why this happened at all

F2 read as finished. `/catalog/interpret`, `/catalog/harvest` and `/catalog` were all written,
`seo.py` was pure and tested, `compose_fallback` covered the model being unreachable. What was
missing was smaller and worse than a missing function: **no key had ever existed in this repo**,
so no line of that path had ever executed against a real model. Every failure mode degraded
politely into the fallback listing, which is exactly the behaviour you would see if everything
worked and the model happened to be down.

Four faults were sitting in a row on the same code path. Each one alone produced the same
visible symptom — `confidence: 0` and the artisan's own sentence handed back as the listing.

---

## ① `ai/.env` was never loaded

`.env.example` said to copy it there. `interpret.py` read `OPENROUTER_API_KEY` from
`os.environ` at call time. Nothing bridged the two, so a filled-in key behaved identically to
an empty one: `/catalog/interpret` answered 503 and the app fell back correctly to a state
nobody had chosen.

`service.py` now calls `load_dotenv` at import. A real environment variable still wins, which
is what a deployment sets. `python-dotenv` arrives with `uvicorn[standard]` anyway; it is named
in `requirements.txt` now because depending on a transitive dependency for a startup step is
how it goes missing.

## ② `max_tokens` was 400 for every caller

Generous for `interpret()` and `harvest()`, which each return one short object. Far too small
for `/catalog`, which returns a title, an English description, a Hindi description, a short
description, keywords and bullets — and **Devanagari costs two to three times the tokens of the
same sentence in English**.

Measured, five identical calls with a full field set:

```
0 length 400 ends_with_brace= False
1 length 400 ends_with_brace= False
2 length 400 ends_with_brace= False
3 length 400 ends_with_brace= False
4 length 400 ends_with_brace= False
```

`finish_reason: length` every time, completion pinned at exactly the cap. The JSON never
closed, parsing failed, fallback. It looked intermittent only because a single-field request
fits in ~274 tokens and passes — so it failed precisely when the listing was worth having.

`max_tokens` is a parameter now; `/catalog` asks for 1400.

## ③ `reasoning: {"exclude": true}` only *hides* the reasoning

The provider still generates it and still bills it against `max_tokens`. About one call in
three spent the entire budget thinking and returned `finish_reason: length` with empty content.
Raising the ceiling in ② moved the failure rather than removing it.

`{"enabled": false}` stops it being generated. Eight runs, zero failures, ~150 completion
tokens each, against 1400-and-empty before. Applied at both call sites.

This is the fault the file had already predicted: `interpret.py`'s own comment says
deepseek-v4-flash is a reasoning model and is the default only because this account's
OpenRouter data policy will not reach an instruct model. Widening that at
openrouter.ai/settings/privacy and setting `OPENROUTER_MODEL` remains the real fix.

## ④ The silent branch in `/catalog`

A model that returns nothing usable and a model that is unreachable both end at
`compose_fallback` and both report `confidence: 0`. One logged; the other did not. Fault ③ was
invisible for exactly that reason, and the one-line warning added here is what exposed it.

---

## 🔴 And then the listings fabricated

With the pipeline finally running, the output broke design law rule 1 on the first sparse
input. Given `what: sambalpuri cotton saree` and nothing else:

> "known for its intricate handwoven patterns and vibrant colors ... showcases the rich textile
> heritage of India"

Nobody has looked at this saree. The patterns, the colours and the heritage claim were supplied
by the model. That is the customer return and the unrecoverable rating that rule 1 exists to
prevent, and it arrives dressed as good copywriting.

`SYSTEM_PROMPT_DESCRIBE` already said *never invent*. One instruction was not enough against
three pressures, all three now addressed:

| Pressure | Fix |
|---|---|
| No list of **what counts as** invention | Rule 2 enumerates it: colour, pattern, motif, texture, weight, border, finish, occasion, season, recipient, dye method — *"do not reach for what objects of this kind usually have: this one may not"* |
| A regional name read as licence to describe the **category** | Rule 3 separates naming a craft from describing it. "A Sambalpuri saree, woven in Odisha" is allowed; "known for its intricate patterns" is not |
| `keywords: 5 to 10` and `bullets: 3 to 5` as **floors** | A floor is an instruction to make something up when the facts run out. Both are ceilings now, and bullets are tied to facts actually given |

Rule 4 was added for the same reason: *say less when you are given less*. A short listing is a
finished listing, not a failed one.

Same input, after — four consecutive runs, no invented attribute in any of them:

```
Sambalpuri Cotton Saree
A handwoven Sambalpuri cotton saree from Odisha.
ओडिशा से हाथ से बुनी गई एक संबलपुरी कॉटन साड़ी।
```

**One judgement call left open.** "Handwoven" is not in FIELDS. Sambalpuri *is* a handloom ikat
by definition, so this is category inference rather than invention, and rule 3 permits naming
the craft. It stands. Drawing the line harder — nothing not literally in FIELDS — is a one-line
change to rule 3 if that is the call.

---

## 🔴 And server TTS had been dead the whole time

Found while trying to produce a Hindi clip for the microphone path. Sarvam answers
`bulbul:v2` with:

> "Model 'bulbul:v2' has been deprecated. Please use 'bulbul:v3' instead"

**Every `/api/tts` call was a 400.** `voice.py` turns any provider failure into a 503,
`voice/engine.js` reads 503 as "use the next tier", and the next tier is the phone's own
voice — so the app kept speaking and the outage was invisible from the phone. Server TTS had
been entirely dead for however long the deprecation has been in effect, and nothing in the app
looked wrong.

The speaker had to move with the model: v3 rejects `anushka` outright and the two speaker
lists do not overlap. Picked `ritu` from v3's set. How the app sounds is a product decision,
so it stays a constant beside the model and is one string to change.

This is the third instance of one shape in this feature, and the file already documented the
first: `SARVAM_ASR_MODEL` was once `saarika:v2`, a model id that does not exist, and ASR was
dead behind the same 503-to-fallback path. A wrong string in one constant, a fallback doing
its job correctly, and no visible symptom. **All three were found by calling the provider, not
by reading the code**, which is the argument for `f2_smoke.py` existing at all.

---

## The microphone path, run

No microphone was available where this ran, so the clip was generated by the app's own
`/api/tts` and fed back into `/api/asr`. That is what surfaced the deprecation above.

Hindi, end to end:

```
transcript   यह सांबलपुरी कॉटन साड़ी है, नीले रंग की, छह मीटर लंबी, हाथ से बुनी हुई।
interpreted  'सांबलपुरी कॉटन साड़ी'  confidence 0.95
harvested    {material: कॉटन, colour: नीले, size: छह मीटर, technique: हाथ से बुनी हुई}

desc_en  This is a handwoven Sambalpuri cotton saree from Odisha. It is six meters long
         and comes in blue.
desc_hi  यह ओडिशा की हाथ से बुनी हुई सांबलपुरी कॉटन साड़ी है। यह छह मीटर लंबी है और नीले रंग में है।
```

Odia, which had never been exercised at all:

```
transcript   ଏହା ଏକ ସମ୍ବଲପୁରୀ କଟନ୍ ଶାଢ଼ୀ, ନୀଳ ରଙ୍ଗର 6 ମିଟର ଲମ୍ବା।
harvested    {material: କଟନ୍, colour: ନୀଳ, size: 6 ମିଟର}
             → "Sambalpuri Cotton Saree, Blue, 6 Metres", plus correct Hindi
```

Odia speech in, English and Hindi listing out. No fabricated attribute in either run.

**What this does not prove, and it is the important half.** The clip is synthetic: clean studio
Hindi from the same vendor that then transcribed it. A vendor recognising its own TTS is the
easiest case that exists. It proves the *wiring* — multipart upload, language codes, the
handoff through every service — and says nothing about a real artisan's accent, a noisy room,
or a rural tower. A human recording is still required, and is still the last real unknown.

Two smaller observations, neither a bug:

- The Hindi run produced a **Devanagari `title`** while `desc_en` was English, so Amazon would
  receive a Hindi title. `SYSTEM_PROMPT_DESCRIBE` does not say what language a title should be
  in. That is a prompt decision nobody has made yet, not a defect.
- ASR always reports `confidence: 0.0`. Sarvam returns no score and `voice.py` defaults to zero
  deliberately, with a comment saying why: a fabricated high score would skip a confirmation
  nobody performed.

---

## The check that exists now

`scripts/f2_smoke.py` runs the whole chain and **prints rather than asserts**, deliberately:

```bash
ai/.venv/bin/python scripts/f2_smoke.py clip.webm --lang hi
ai/.venv/bin/python scripts/f2_smoke.py --text "yeh sambalpuri cotton saree hai, neela rang"
```

ASR → interpret → harvest → catalog, then three questions only a human can answer: is the
transcript what you actually said, is `desc_hi` natural Hindi or English wearing a Devanagari
coat, and does anything in either description name a detail the product does not have.

Missing keys degrade with a named reason rather than a stack trace — a 503 from `/api/asr`
says which key is absent, and a 404 says the running uvicorn predates the route.

---

## State

| Piece | State |
|---|---|
| `/catalog/interpret` — one sentence, one field | ✅ live |
| `/catalog/harvest` — the other slots in the same sentence | ✅ live |
| `/catalog` — bilingual listing, `desc_hi` written fresh in Hindi | ✅ live |
| `seo.py` — per-channel shaping, byte-aware clipping | ✅ pure, self-checks pass |
| Fallback when the model is unreachable | ✅ `confidence: 0`, artisan's own words |
| Fabrication under sparse input | ✅ fixed, 4 clean runs |
| `/api/tts` — server voice | ✅ fixed, `bulbul:v2` was deprecated and every call a 400 |
| `/api/asr` — Hindi and Odia, full chain | ⚠️ runs, but on a **synthetic** clip only |
| **A human recording** | ❌ still never run — the last real unknown |
| `/catalog/prefill` — vision pre-fill | ❌ `NotImplementedError` |
| Tests on any F2 network path | ❌ none exist |

`describe.py` and `seo.py` self-checks are pure-function only — they never touch a model.
The smoke script prints for a human and asserts nothing. So the text path is **observed**, not
**tested**, and those are different words on purpose.

---

## What is left

1. **Record a human speaking, in a normal room, and run it.** The chain works on a clip the
   provider itself generated, which is the easiest input it will ever get. Everything about
   accent, noise and connection is still untested, and that is what the artisan actually
   brings. This is the last real unknown between here and being able to say F2 works.
2. **Decide what language a `title` should be in.** The prompt does not say, so it follows the
   transcript — which puts a Devanagari title on an Amazon listing.
3. **Widen the OpenRouter data policy and set `OPENROUTER_MODEL` to an instruct model.**
   `enabled: false` neutralised the symptom; the model is still the wrong shape for the job.
4. **`/catalog/prefill`.** Not before the above — the flow already degrades past it correctly,
   and building the optional shortcut while the mandatory path is unverified optimises the
   wrong half.
5. **A test on the `/catalog` contract**, the way `test_service.py` covers `/enhance`.

---

## Setup note

`web/api/.env.example` was missing `SARVAM_API_KEY` entirely, so the first thing anyone hits is
`/api/asr` answering 503 with no indication why. Added, above the Bhashini pair and with the
reason it goes first: Sarvam is one REST call with one key, where Bhashini needs a
pipeline-config round trip.

Two other things a fresh clone will hit, neither of them fixed here because both are machine
state rather than repo state: `ai/.venv` had only `fastapi`, `httpx` and `uvicorn` installed,
so `import service` died on numpy until `requirements.txt` was installed; and six tests in
`test_segment.py` / `test_service.py` fail rather than skip with `Skip: no torch`, because the
3GB enhance stack is not installed. Both are documented in `ai/requirements-enhance.txt`.
