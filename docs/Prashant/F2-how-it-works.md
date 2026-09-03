# F2 — the Multilingual Auto-Cataloger, and how it actually works

**PS 26090, feature 2.** For the team and for anyone assessing this. It describes the system
as built on 2026-09-03, not as planned.

> *"An NLP-based engine that allows artisans to describe their product via voice notes in
> regional languages. The AI should translate and generate SEO-friendly, professional product
> descriptions in English and Hindi."*

---

## The one-line version

An artisan who cannot read photographs their work, answers a few spoken questions in their own
language, and gets a finished marketplace listing — in **English and Hindi**, shaped to each
platform's real limits — without typing anything.

## The workflow, end to end

```
  1  PHOTOGRAPH        the phone coaches the shot, the server checks it
        ↓
  2  PRE-FILL          a vision model reads the photo and fills what it can
        ↓
  3  INTERVIEW         one spoken question at a time, in their language
        ↓                 ├── the answer to the question asked
        ↓                 └── every OTHER fact that sentence contained  ← the harvest
        ↓
  4  REVIEW            read back aloud; they confirm or re-record
        ↓
  5  COMPOSE           one listing written once: title, English + Hindi, keywords, bullets
        ↓
  6  SHAPE             cut to each channel's real limits, deterministically, no model
        ↓
  7  PUBLISH           API where one exists, paste-one-field-at-a-time where it does not
```

### 1 · Photograph

`app/src/camera/gate.js` measures the live frame on the phone and gates the shutter — light,
blur, framing — coaching in the artisan's language *before* the photo is taken. The server
checks again in `ai/enhance/pipeline.py`: what a phone can repair is coached, what cannot be
repaired is refused, and the refusal is a `message_key` so it can be **spoken** rather than
displayed. "resolution_below_1000px" is not something you can read aloud to someone.

### 2 · Pre-fill — the question we never have to ask

`POST /catalog/prefill` sends the photo to a vision model, which reads back category, material,
colour and technique. Those become **confirmations instead of questions**: "this looks like a
cotton saree — right?" is one tap, where "what is it made of?" is a sentence.

Nothing is auto-accepted. A vision guess is a guess, and publishing one under the artisan's
name is how they get a return they cannot afford.

### 3 · The interview — and why it is questions, not one long voice note

The obvious design is: record one voice note, let the AI sort it out. We deliberately did not
build that, and the reason is accessibility rather than accuracy. If an artisan who cannot read
rambles for a minute and forgets to mention the size, an open-ended recorder has **no way to
tell them what is missing** — and missing fields are what block publishing and break the price
floor. So the app asks one question at a time and knows exactly what it still needs.

The questions are not a fixed list. `app/src/catalog/slots.js` computes them: a slot is asked
only when it is still empty **and** some channel this artisan is actually publishing to requires
it. Country of origin, HSN code, GST rate, currency — constants and lookups. Asking a human for
those is a bug.

**Then the part that makes it feel intelligent.** Nobody answers one field per sentence. Asked
what a thing is, an artisan says:

> *"yeh sambalpuri cotton saree hai, teen din laga, saade chhe gaz"*

That is four facts in one breath. `POST /catalog/harvest` pulls every slot that sentence
contained, `absorb()` fills only the slots still empty, and the interview **drops the questions
it now has answers to**. A talkative artisan gets a much shorter interview; a terse one gets the
same interview as before. Measured live: that sentence in Tamil ended the interview with three
of eight questions already gone.

Three rules that are not negotiable here:

* a **guess** is not an answer — a pre-filled or carried-forward value is still put to them;
* a harvested value **never overwrites** a direct answer, because the inference is cheaper, not
  better;
* **cost is never harvested.** It is what they spent on materials — their margin, an input to
  the price floor, and no part of any listing. It never leaves the phone.

### 4 · Review

The listing is read back aloud before anything is written. What is shown is the artisan's own
sentence, not our reduction of it: the reduction is the thing we are asking them to trust, so
the evidence has to be the original.

### 5 · Compose — English *and* Hindi, always

`POST /catalog` turns the answers into one listing: title, `desc_en`, `desc_hi`, `short_desc`,
keywords, bullets.

**Hindi is written fresh in Hindi.** It is not a translation of the English. The usual pipeline
— regional speech → English → write → translate to Hindi — loses something at every hop and
produces Hindi that reads like machine output. Ours writes both from the same facts, so a Hindi
buyer reads something written for them.

**The prompt's hardest job is refusing to write.** Given only "Sambalpuri cotton saree" an
early version produced *"known for its intricate handwoven patterns and vibrant colours"* —
about a saree nobody had looked at. Three rules now forbid inventing colour, pattern, texture,
occasion or origin, and every count is a **ceiling, not a floor**: "5 to 10 keywords" is an
instruction to make things up when the facts run out.

**It never fails closed.** If the model is unreachable, `compose_fallback` builds the listing
from the artisan's own sentences and marks it `confidence: 0`. Losing the AI costs a prettier
description. It must never cost the listing.

### 6 · Shape — the part with no AI in it at all

`ai/catalog/seo.py` is pure, deterministic Python with no model anywhere near it. It cuts the
finished listing to each platform's documented limits.

This split is the design decision we would most defend. A model *asked* to respect Amazon's
limit will respect it most of the time — and most of the time is how a listing gets rejected
three days later, with the artisan having no idea which of seven platforms disliked what.

The trap that justifies the whole file: **Amazon's keyword field is capped at 249 bytes, not
characters.** Every Indian-language character costs three bytes, so a Hindi keyword string that
looks a quarter full in an editor is already over the limit — and slicing UTF-8 by bytes can cut
a character in half and produce invalid output. Both are handled, and tested at *every* byte
offset in four scripts.

GeM gets special handling: it **rejects any listing carrying seller information**, the exact
opposite of every consumer marketplace where the brand is the seller's name. So the artisan's
name is scrubbed from GeM copy — and the model is told never to write it in the first place,
because a name transliterated into the other script cannot be scrubbed afterwards.

### 7 · Publish

Channels with an API get pushed. Channels without one — Meesho, GeM, WhatsApp — get
`copy_blocks`: **one button per field, in the order that platform's form asks for them.** One
button copying a blob would leave the artisan to split it up, and splitting text is reading.

---

## What we used

| Layer | Choice | Why |
|---|---|---|
| Speech in / out | **Sarvam AI** (`saaras:v3` ASR, `bulbul:v3` TTS), Bhashini as second tier | One documented REST call; Bhashini needs a pipeline round trip first |
| Text model | **DeepSeek v4 Flash** via OpenRouter, Gemma fallback | Cheap and fast enough to sit in a conversational loop |
| Vision model | **Qwen3-VL 30B** via OpenRouter | Reads the photo for the pre-fill |
| Backend | **FastAPI**, two services | `web/api` holds the session, `ai/` holds the model key and never sees the artisan |
| App | React + Vite + Capacitor, TypeScript, Tailwind | One build, phone and web |
| SEO shaping | **Plain Python. No model, no library.** | Every limit is a documented number; determinism is the feature |

**No LangChain, no LangGraph, no agent framework, no spaCy.** One prompt, one JSON response,
one parse — about twenty lines of `httpx`. The work that actually matters here is validating
what comes back, and a framework would have buried that inside someone else's abstraction
while adding a dependency and two failure modes.

**Languages:** Hindi, Odia, Tamil, Bengali and English in, **English and Hindi out, always.**
The input language widens; the output does not, because the problem statement names both.

## Things worth knowing if you are assessing this

**It works with the model switched off.** Every AI call has a defined failure: a local synonym
table answers the common phrasings offline, the interview continues if a harvest returns
nothing, the listing composes from the artisan's own words if the writer is unreachable. The
artisan can always finish.

**It refuses to invent.** Not a disclaimer — a design rule with tests behind it. If the
delivered object does not match the words, the artisan absorbs the bad review and the return,
not us.

**Nothing publishes without colour confirmation.** White balance moves colour, and only the
person holding the object can say whether it is still true.

**GPS is stripped from every upload, unconditionally.** An artisan's home coordinates on a
public listing cannot be undone.

**Dialects are measured, not assumed.** `docs/Prashant/F2-dialects.md` records what the model
does with Bhojpuri, Chhattisgarhi, Awadhi, Magahi and Maithili — including a case where it
answered *confidently and wrongly* on the interview's first question, and the fix.

## What is honestly not done

* **Nobody has spoken into a real phone yet.** The full flow has been run end to end, in Tamil,
  in a browser — but the pane blocks the microphone, so every answer in that run was typed.
  ASR in a real courtyard is the one measurement nothing here substitutes for, and it is the
  input the dialect findings care about most.
* **Tamil and Bengali are 104 of 249 UI strings** — the whole photo-to-listing path. The rest
  falls back to English *in an English voice*, deliberately, but a Tamil user sees a half-Tamil
  home screen.
* **All 208 Tamil and Bengali strings are unreviewed LLM drafts**, marked as such in the files.
  Every one is spoken aloud to someone who cannot read it, so a native speaker should read them
  before anyone demos in those languages.
* **Comparables for three of four price sources are hand-collected snapshots** — an F3 note,
  but it reaches the same listing.

## Reading the code

| What | Where |
|---|---|
| Which questions get asked, and what a harvest drops | `app/src/catalog/slots.js` |
| The interview screen | `app/src/screens/CatalogVoice.tsx` |
| Transcript → one field value, and the harvest | `ai/interpret.py` |
| Photo → pre-filled fields | `ai/catalog/prefill.py` |
| Answers → the listing | `ai/catalog/describe.py` |
| Listing → each platform's limits | `ai/catalog/seo.py` |
| Speech in and out | `web/api/routers/voice.py` |
| What the changes were, and what the live run found | `docs/Prashant/F2-shippable.md` |
