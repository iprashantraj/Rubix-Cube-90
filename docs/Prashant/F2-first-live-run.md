# F2 — the first live run, and the four faults it found

**Date:** 2026-09-01 · **Touches:** `ai/service.py`, `ai/interpret.py`, `ai/catalog/describe.py`,
`ai/requirements.txt`, `web/api/.env.example`, `scripts/f2_smoke.py`
**Branch:** `f2-cataloger-fixes` · **Commit:** `f160307`

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
| **The microphone** | ❌ never run — everything above used `--text` |
| **Odia** | ❌ `LANGUAGES` accepts `or`, no clip has ever been in it |
| `/catalog/prefill` — vision pre-fill | ❌ `NotImplementedError` |
| Tests on any F2 network path | ❌ none exist |

`describe.py` and `seo.py` self-checks are pure-function only — they never touch a model.
The smoke script prints for a human and asserts nothing. So the text path is **observed**, not
**tested**, and those are different words on purpose.

---

## What is left

1. **Record one Hindi clip and run it.** The Sarvam key is loaded — `/api/asr` answers 422 on
   an empty clip rather than 503 — but no real audio has ever crossed it. This is the last
   unknown between here and being able to say F2 works.
2. **Then the same in Odia.** `or` is claimed in `LANGUAGES` with nothing behind it. If
   Sarvam's Odia is weak, better to know before it is said out loud.
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
