# F2 — the changeset that made it shippable

**Date:** 2026-09-03 · **Branch:** `f2-cataloger-fixes`
**Touches:** `web/api/routers/catalog.py`, `web/api/routers/voice.py`, `ai/interpret.py`,
`ai/catalog/describe.py`, `ai/catalog/seo.py`, `ai/price/comps.py`,
`app/src/catalog/slots.js`, `app/src/screens/CatalogVoice.tsx`, `app/src/screens/Price.tsx`,
`app/src/i18n/` · **New:** `ai/test_catalog.py`, `web/api/test_catalog.py`,
`ai/probe_dialects.py`, `app/src/i18n/strings/{ta,bn}.json`, `docs/Prashant/F2-dialects.md`
· **Deleted:** `ai/catalog/nlp.py`

F2 was described as complete. It was not: the interview ran, understood the artisan, and then
had nowhere to send the result. Six changes, in the order they were made, and what each one
was actually for.

---

## 1. The route that was never written

`CatalogReview.tsx:148` calls `POST /api/catalog` — the step that turns the artisan's answers
into a listing and produces `copy_blocks`, the per-field paste buttons `/publish` shows for
the channels people fill in by hand. `web/api/routers/catalog.py` proxied
`/catalog/interpret` and `/catalog/harvest` and **nothing else**. The call 404'd, the app
caught it (correctly — it is non-fatal by design), and the artisan approved a review screen
with empty fields.

Added the proxy. Two decisions inside it are worth keeping:

* **`artisan_name` comes from the session, never the request body.** That name is only ever
  *subtracted* — `seo.strip_seller_identity` removes it from copy bound for GeM, which
  rejects any listing carrying seller information. A caller-supplied name is useless at best
  and strips a stranger's name out of somebody else's listing at worst.
* **45-second timeout, where the neighbours use 15.** A full bilingual listing is a
  1400-token generation; the one-field callers ask for 400. At 15s it times out mid-write and
  the artisan silently gets the fallback listing from a model that was about to answer
  properly.

`fields` is forwarded uninspected on purpose: the field-by-field allowlist lives in
`ai/catalog/describe.py`, and a second copy here would be a second place to forget the same
thing.

## 2. The tests that existed but nothing ran

`seo.py`, `describe.py` and `prefill.py` all carry thorough `demo()` self-checks. **pytest
collected none of them** — they passed only when somebody remembered to run the file by hand,
which is untested with extra steps.

`ai/test_catalog.py` collects all three, plus `interpret.py` (whose checks live under
`__main__`, so it runs as a subprocess), and then adds what they missed: **scripts that are
not Latin**. Every test is parametrised over Hindi, Odia, Tamil and Bengali.

* Amazon's `generic_keywords` cap is **249 bytes, not characters**, and every Indic script
  costs three bytes per character. Asserted in all four.
* `clip_bytes` is checked at **every byte offset from 1 to 120**, not just at the cap — a
  three-byte character splits at two different offsets and one test hits only one of them.
* The mirror, which matters as much: Amazon's *title* cap is 75 **characters**, and the test
  asserts the result is **more than 75 bytes**. If anyone ever swaps `clip_chars` for
  `clip_bytes`, every Indic seller quietly loses two thirds of a title they are entitled to,
  and now that fails the build instead.
* GeM's seller scrub with a **Devanagari** name, and a name that is a substring of a product
  word — an artisan called "Sam" must not delete "Sambalpuri" from every listing they publish.

Mutation-checked: replacing `clip_bytes` with a naive slice fails five tests, naming Odia,
Tamil and Bengali.

Two assertions in `seo.py`'s own demo read `assert ... or True`, which is not an assertion.
One of them was the Devanagari scrub. Both replaced with the real thing.

## 3. Listening properly to a generous answer

Two separate faults, and the second was the expensive one.

**The harvest fired from only some questions.** `size` had no `harvests` list, so "saade chhe
gaz, cotton ki, do din laga" answered as a size question threw two of its three facts away.
All four open questions now harvest every other slot: which question an artisan happens to
answer generously is not something we get to choose.

**The queue never shrank.** `CatalogVoice.tsx` freezes the question plan when the interview
starts, so the progress dots cannot count backwards — correct, and it meant a harvested answer
landed in the draft *and the question was asked anyway*. The system already understood the
sentence; it just did not act on it. `nextUnanswered()` in `slots.js` now walks the frozen
queue past anything already answered.

What is deliberately **not** skipped:

* a slot the harvest did not fill — still asked;
* a `confirm` (a guess from the photo, or from what this artisan said last time) — **not an
  answer**, still put to them as one tap;
* an empty string — not an answer;
* `cost` — never harvestable at all, it is their margin and no part of any listing.

A zero **is** an answer: nobody is asked their stock twice for saying they have none. Skipping
happens only while the question is on screen, never mid-recording, or the *heard* panel would
be confirming a sentence against a prompt that had already changed.

Typed answers are harvested too. The keyboard is the fallback for when ASR is down, not a
lesser kind of answer.

The harvest prompt also gained three worked examples — one breath carrying four facts where
only three slots get filled (the fourth is left empty *on purpose*, and the example says so),
one sentence carrying nothing, and one in Odia script. A pytest test parses those examples out
of the prompt and asserts each names only slots we would actually keep; without it, an example
naming a bogus slot would teach the model to return something `validate_harvest` silently
discards, and the only symptom is a quieter harvest nobody can explain.

## 4. Tamil and Bengali

The AI layer needed **two lines** — `LANGUAGES` in `interpret.py` and `describe.py`. The
shaping was already script-agnostic; the tests in §2 proved it before anything relied on it.
Prompts now name all five languages and forbid transliterating Tamil or Bengali into Latin.
`describe.py` gained an explicit rule that fields may arrive in any of the five, or mix them
mid-sentence, and **the listing still comes out in English and Hindi, always** — the problem
statement names both and that requirement does not widen with the input.

`ta-IN` and `bn-IN` added to the Sarvam map. Left a warning there: Odia is `od-IN`, not the
ISO `or-IN`, and an unmapped code falls back to Hindi *silently* — heard as "the Tamil voice
is broken", diagnosed as anything but a missing dict key.

`ta.json` and `bn.json` carry **104 keys each**: the whole photo → interview → review path.
The remaining 145 fall back to English **in an English voice**, which `resolve()` already
guarantees. Both files declare an empty `_reviewed` list and say in their own `_note` that
every string is an LLM draft, following `or.json`'s existing pipeline. These are spoken aloud
to someone who cannot read them; claiming they are reviewed would be the fabrication rule
applied to language instead of pixels.

Two guards added to the i18n self-check: the new languages must answer the interview keys and
must fall back *tagged English* elsewhere, and **every key in every bundle keeps its
placeholders** — a dropped `{n}` turns "Question 3 of 6" into "Question of", and the artisan
is told a number that is not there.

**One real bug found while wiring this.** `Price.tsx` built spoken text with `t()`, which
throws away *which* language answered. A Tamil user would have heard English words pushed
through a Tamil TTS voice — the exact failure this codebase documented for Odia and built
`resolve()` to prevent. Fixed. The bug predated Tamil; it was just rarely reachable.

## 5. Dialects, measured instead of assumed

Full write-up: `docs/Prashant/F2-dialects.md`. The short version: the model handled dialect
*vocabulary* and tripped on the dialect *copula*.

* `"ee sutti ke saari ha"` → **`सूती`** ("cotton") at **0.9 confidence**. Wrong answer to
  "what is this?", delivered confidently, and it would have become the product name.
* `"ee saari ha"` → **`None`**. It refused "this is a saree."

Both on `catalog.q_what` — the first question of the interview and the one every harvest hangs
off. Standard Hindi through the same prompt was correct, which is what makes it a dialect
finding. Two prompt rules fixed both; 12 of 12 probe cases now return a usable value, and the
allowlist path, injection refusal and empty-answer refusal all still behave.

`ai/probe_dialects.py` is the harness, deliberately outside the test suite: it spends money,
needs the network, and measures a third party on a given day rather than an invariant of this
code.

## 6. Deletions

`ai/catalog/nlp.py` — 54 lines, four `NotImplementedError`, zero importers. The original F2
sketch; every function in it was built elsewhere and better (`transcribe`/`speak` in
`web/api/routers/voice.py`, `prefill` and `describe` in `ai/catalog/`). Its hardcoded
five-question list was superseded by `slots.js`, which computes the questions from what is
empty and what the target channels demand. A file saying "not implemented" beside the working
implementation teaches a reader something false.

`comps.normalize()` — never called, and an LLM normalising listing titles would put a model in
the one place F3 says no model goes.

`docs/app/Future-Implementations.md` claimed all three `ai/` packages were stubs. Corrected to
name the one real remaining gap. `docs/Utsav/TASK-AUDIT.md` left alone: it is a dated snapshot
against a specific commit, and rewriting a record of what was true then destroys the record.

---

## 7. The first live run, and the five faults it found

Everything above was verified by tests and by calling the AI service directly. Then the whole
flow was run for real — Postgres, `web/api`, `ai/` and the app in a browser, in Tamil, with a
synthetic photograph fed through the gallery picker because the pane blocks the camera.

Five faults, none of which a unit test could have caught, because each one lives in the space
*between* the pieces the tests cover.

**`\b` cannot match an Indic name.** `strip_seller_identity` had never worked for a Devanagari
surname. Python's `re` counts only letters, digits and `_` as word characters, and every Indic
vowel sign and anusvara is a combining mark (Mn/Mc) — so in `मोहंती` the final `ी` is a
NON-word character and `\bमोहंती\b` never matches. GeM rejects seller information in any
field, so this was a rejection an artisan could not have diagnosed. The unit test in §2 passed
because it used `उत्सव`, which happens to end in a bare consonant. Replaced with lookarounds
over a class that includes combining marks and U+0900–U+0DFF — every script this app accepts
and several it does not.

**The connector stayed when the name left.** The GeM title came out as `Cotton Saree by` and
its description as `This saree is woven by . It is made of cotton.` A test asserting
`"Utsav" not in title` passes happily on a dangling `by`. English puts the connector before
the name and Hindi and Odia put it after; both go now, with the punctuation debris.

**The model transliterated the name past the scrub.** English copy said "handwoven by
artisan"; Hindi said `उत्सव मोहंती द्वारा` — the same name in the other script, which no
literal match on the name we hold can ever remove. Fixed at the source: rule 5b in
`SYSTEM_PROMPT_DESCRIBE` forbids naming the maker in any field in either language, and says
why. Verified twice against the live model; both runs now say `कारीगर द्वारा`.

**A dev-only self-check blanked the app.** The placeholder guard added in §4 ran `.match()`
over every value in every bundle — and `_reviewed` is an ARRAY, `_note` is prose, both
documented as translator metadata at the top of that same file. It threw on module load: white
screen, no routes. `npm test`, `tsc --noEmit` and `npm run build` were all green, because none
of them executes a `import.meta.env.DEV` block. **A guard whose entire purpose is to be
cheaper than finding out later must not be the thing that breaks the app.**

**`/catalog/prefill` polled a dead job for sixty seconds.** The loop handled `done` and
`rejected` and not `failed`, so a job that died — no torch on this box, but in production a
model that will not load or a worker that crashed — left the artisan on "we are improving your
photo, please wait" for the full poll budget before degrading. The status is terminal on the
first poll. Rule 3 says every failure degrades AND speaks; this did neither until the budget
ran out.

### What the run proved

In order, all in Tamil, against both live services:

* the server gate refused a too-bright photograph and said so — `நிழலுக்கு வாருங்கள்`;
* the enhancement failed and degraded to the artisan's own photo, spoken, without costing the
  listing (rule 3);
* colour confirmation gated publish (rule 4);
* the microphone was denied and the interview degraded to typing, in Tamil;
* **one Tamil sentence — `idhu kaithari pruthi pudavai, moonu naal aachu, aaru gajam neelam`
  — answered `what` and harvested `material`, `size` and `time`, and the interview SKIPPED
  both harvested questions**, landing on `stock` with three of eight dots filled. That is §3
  working in a browser rather than in an assertion;
* `POST /api/catalog` returned 200 and the listing persisted as **"Handwoven Cotton Fabric,
  6 Yards"** with `desc_en` AND `desc_hi` both written — from Tamil speech. Which is the
  problem statement's actual requirement, demonstrated rather than claimed;
* `/price` answered 422 → "set the price later", because `cost` and `time` were skipped. F3
  refusing rather than clamping a floor to zero is the designed behaviour, not a fault.

### What it did not prove

**The spoken half was never exercised.** The browser pane blocks the microphone and the
camera, so every answer was typed and the photograph was a canvas. ASR in a real room is
untested, and it is exactly the input the dialect findings in §5 care about most: a Bhojpuri
sentence reaches the interpreter already degraded by a recogniser trained on standard Hindi.
One person, one phone, one courtyard is the missing measurement.

## Where F2 stands

**Working end to end, and run end to end** (§7). Photograph → gate → enhancement (or its
failure, spoken) → colour confirmation → interview → interpret → harvest → compose →
per-channel shaping → copy blocks → price. An unreachable model degrades to a listing built
from the artisan's own sentences at `confidence: 0` rather than costing them the listing.

**Voice is live, in all four languages.** An earlier draft of this note said `/api/asr` and
`/api/tts` answer 503 until a key is configured, and named it F2's one outstanding item. That
was taken from the documentation rather than from trying it: a Sarvam key is in
`web/api/.env`, and both tiers answer. Measured 2026-09-03, synthesising one sentence per
language and round-tripping the audio back through transcription:

| | TTS | said | heard |
|---|---|---|---|
| `hi` → `hi-IN` | 83 KB | यह सूती साड़ी है | यह सूती साड़ी है। ✓ |
| `or` → `od-IN` | 65 KB | ଏହା ସୂତା ଶାଢ଼ୀ | ଏହା ସୁତା ସାଢ଼ୀ। — two vowel/sibilant slips |
| `ta` → `ta-IN` | 54 KB | இது பருத்திப் புடவை | இது பருத்தி **புடமை**. — the noun changed |
| `bn` → `bn-IN` | 70 KB | এটা সুতির শাড়ি | এটা সুতির শাড়ি। ✓ |

So the §4 assumption — that Sarvam covers the two new languages — holds, and the `ta-IN` /
`bn-IN` codes are right.

**What that does not prove.** This is a clean synthetic voice read into the same vendor's
recogniser: the easiest input that exists. It establishes the wiring, the key and the language
codes, and nothing about a courtyard microphone. **Tamil lost a content word on that easiest
input** — `புடவை` (saree) came back as `புடமை`, which is not a spelling wobble but the answer
to "what is this?". Worth a real-voice check before leaning on Tamil.

**Known and recorded, not fixed:** romanised input gets transliterated into script (harmless
for a listing, wrong for a name); the language tag matters more than it looks — the same
romanised Tamil sent as `hi` returns nothing and as `ta` returns the right word; and the
dialect measurements in `F2-dialects.md` are typed transcripts, so what ASR does to Bhojpuri
in a courtyard is still an unmade measurement — now blocked only on somebody speaking into a
phone, not on a key.

## Verification

```bash
cd ai && .venv/bin/pytest                     # 130 passed, 6 failed — all 6 pre-existing F1 "no torch" skips
cd ai && .venv/bin/pytest test_catalog.py     # 34 passed
web/api/.venv/bin/pytest web/api/test_catalog.py  # 4 passed
cd app && npm test && npx tsc --noEmit && npm run build   # clean
cd ai && .venv/bin/python probe_dialects.py   # 12/12, needs a key and spends money
```

Speech was verified separately, against the live provider, by calling `_sarvam_tts` and
`_sarvam_asr` directly for `hi`, `or`, `ta` and `bn` — see the table above. It spends Sarvam
quota, so it is not in the suite.

The live round trip HAS now been run — see §7 for what it found and what it did not reach.
Reproducing it needs four things up at once, and one migration that a stale dev database will
be missing:

```bash
web/api/.venv/bin/alembic upgrade head            # artisans.sells_on and two after it
cd ai      && .venv/bin/uvicorn service:app --port 8001
cd web/api && .venv/bin/uvicorn api.main:app --app-dir .. --port 8000
cd app     && npm run dev
```

Still unreached by any run: **the microphone**. Every answer in §7 was typed and the
photograph was a canvas, because the browser pane blocks both devices. One person speaking
Bhojpuri into a real phone is the measurement nothing here substitutes for.
