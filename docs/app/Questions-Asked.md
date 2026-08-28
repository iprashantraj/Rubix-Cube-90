# Every question the app asks

One place, so that adding a question is a decision somebody makes deliberately rather than
a line someone adds to a screen. Every entry here is **spoken aloud** in the artisan's
language — this is a voice interface, and the written form below is the fallback.

Keep this in step with the code. The `key` column is the i18n key, and the English text is
from `app/src/i18n/strings/`; Hindi and Odia live in the same folder.

**Rules that apply to every question in this document**

- Asked one at a time. A screen that asks two is two screens (design law rule 4).
- Answered by voice or by tap. Nothing is typed except the OTP (design law rule 3).
- Every answer that came from voice is **shown back before it counts**, faintly, in the
  artisan's own words — see `Heard` in `app/src/ui/kit.jsx`.
- Nobody answers in the shape of the question. "What is your name" gets "मेरा नाम उत्सव है".
  Extraction is not optional; see [AI-Data-Flow.md](./AI-Data-Flow.md).

---

## 1. Identity and consent — asked once, before an account exists

Not a "question" in the interpreted sense: these are choices with fixed options, so no
model is involved and nothing is sent anywhere.

| Screen | key | English | Answer shape |
|---|---|---|---|
| `/lang` | `lang.title` | Choose your language | tap, 3 tiles |
| `/consent` | `consent.title` | Your data | tap, understood / replay |
| `/auth` | `auth.phone` | Tell us your phone number | **typed** — the one exception |
| `/auth` | `auth.otp` | Type the OTP we sent to your phone | **typed** |

> The phone number and OTP are typed on purpose. A misheard digit in a phone number is an
> account you cannot recover, and the OTP arrives as text anyway.

---

## 2. Onboarding — asked once, in this order

| Screen | key | English | Answer shape | Interpreted? |
|---|---|---|---|---|
| `/onboard/name` | `onboard.name` | What is your name? | voice, open | ✅ open text |
| `/onboard/name` | `onboard.name_confirm` | Did I hear {name}? | yes / no | — |
| `/onboard/craft` | `onboard.craft` | What do you make? | 8 tiles, or voice | ✅ choice of 8 |
| `/onboard/craft` | `onboard.craft_confirm` | Did I hear {craft}? | yes / no | — |
| `/onboard/place` | `onboard.place` | What is your PIN code? | voice, digits | ❌ parsed locally |
| `/onboard/place` | `onboard.place_confirm` | Is your PIN code {pincode}? | yes / no | — |
| `/onboard/ready` | `onboard.has_pan` | Do you have a PAN card? | yes / no | ❌ never sent |
| `/onboard/ready` | `onboard.has_bank` | Do you have a bank account? | yes / no | ❌ never sent |
| `/onboard/ready` | `onboard.has_gst` | Do you have GST? | yes / no | ❌ never sent |
| `/onboard/ready` | `onboard.has_artisan_card` | Do you have an artisan card? | yes / no | ❌ never sent |

**The craft options.** Stable English slugs, never the translated label — the label changes
with language and the category mapping keys off the slug.

`weaving` · `pottery` · `metalwork` · `woodwork` · `painting` · `jewellery` · `leather` · `bamboo`

**Why the PIN code is not interpreted.** `extractPincode()` in `OnboardPlace.jsx` is a
deterministic parser with 19 assertions covering digit words in three scripts. It is more
reliable than a model for this and needs no network. A PIN code is also location data — see
the withholding rules in [AI-Data-Flow.md](./AI-Data-Flow.md).

**Why the readiness flags are never interpreted.** They are booleans answered by tapping
yes or no, and `classifyYesNo()` returns `null` rather than guessing. Sending "do you have a
PAN card" and its answer to a third party would disclose a financial-inclusion fact about a
named individual for no benefit whatsoever.

---

## 3. The cataloger — computed per product, not a fixed list

⚠️ **This section used to list five questions and then six. It no longer lists any**, because
the set is decided at runtime by `plan()` in `app/src/catalog/slots.js`. The table below is the
*slots it may draw from*; which of them get asked depends on the photo, on what this artisan
has already told us, and on which channels the product is going to.

The reasoning, and the marketplace field research behind the mapping, is in
[../Utsav/Product_Questions.md](../Utsav/Product_Questions.md). Short version: the old fixed
list asked for `special`, which fills no field any marketplace requires, and never asked for
weight or stock, which five of the seven make mandatory.

| Slot | key | English | Answer shape | Interpreted? | Needed by |
|---|---|---|---|---|---|
| `what` | `catalog.q_what` | Tell me about this. What is it? | voice, open | ✅ open text | all channels |
| `material` | `catalog.q_material` | What is it made of? | voice, open | ✅ open text | all but WhatsApp |
| `size` | `catalog.q_size` | How big is it? | voice, open | ✅ open text | GeM, Amazon, Flipkart, Meesho, ONDC |
| `weight` | `catalog.q_weight` | How much does it weigh? | voice, number | ❌ `numberFrom()` | GeM, Amazon, Flipkart, Meesho |
| `stock` | `catalog.q_stock` | How many of these do you have? | voice, number | ❌ `numberFrom()` | all channels |
| `lead_time` | `catalog.q_lead_time` | How many days to get it ready? | voice, number | ❌ `numberFrom()` | ONDC, Flipkart |
| `cost` | `catalog.q_cost` | What did the materials cost? | voice, number | ❌ `numberFrom()` | none — the price floor |
| `time` | `catalog.q_time` | How long did it take? | voice, number | ❌ `numberFrom()` | none — the price floor |
| `special` | `catalog.q_special` | What is special about it? | voice, open | ✅ open text | none — the craft story |

**Why the number slots are not interpreted.** `numberFrom()` in `voice/numbers.js` reads
Devanagari, Odia and Latin digits and their word forms, offline and deterministically. Their
question ids are deliberately **absent** from `KNOWN_QUESTIONS` in `ai/interpret.py`, so
sending one would be refused with a 422 — that refusal is the allowlist working, not a bug.

**Three ways a slot is filled without asking.** The vision pre-fill (`POST /catalog/prefill`),
this artisan's previous products (`GET /catalog/defaults`), and the answers already given.
A slot filled that way is still **put to the artisan as a confirmation** —
`catalog.confirm_same`, "last time you said cotton, same this time?" — a tap rather than a
sentence. Nothing is written silently: a default that publishes without being confirmed is a
guess under somebody's name.

**Everything derivable is never a question.** Country of origin, currency, condition, seller
type, local content, HSN, GST rate, consumer care contact, the `@ondc/org/*` block: constants
or lookups. Asking a human for a value we can compute is a bug, not thoroughness.

### Ordering, skipping, and the two rules that did not change

**Order is by consequence, not by declaration:** slots that block a publish come first, then
the two that feed the price floor, then the craft story. `special` is always last — it is the
only thing that makes a handmade listing different from a factory one, and it is also the only
one no marketplace requires, so it earns a question but not a good slot on a bad network.

🔒 **`cost` never reaches a buyer.** It is what the artisan spent on materials — an input to
their own price floor, not a line in a public listing. `compose()` in `CatalogReview` builds
the description from a named field list that excludes it. Parsed by `rupeesFrom()` and
persisted to `products.cost_material`; see `docs/app/Pricing.md`.

Each answer may still be **skipped**, including a confirmation. Skipping everything still
reaches `/catalog/review`, where the vision pre-fill carries the listing on its own — the
questions improve a listing, they do not gate it.

### Adding or removing a question now

Do not edit `CatalogVoice.tsx`. Add a slot to `SLOTS` in `app/src/catalog/slots.js`, say which
channels need it in `CHANNEL_NEEDS`, add the string, and add a row above. `slots.js` has a
self-check (`node src/catalog/slots.js`) that fails if a channel demands a field no slot asks
for, so a channel and its questions cannot drift apart silently.

---

## 4. Confirmations and money

| Screen | key | English | Answer shape |
|---|---|---|---|
| `/capture/review` | `colour.confirm` | Is this the right colour? | yes / no |
| `/earnings` | `money.confirm` | Did the money arrive? | yes / no |
| `/settings` | `settings.erase_say` | If you are sure, say yes out loud | **spoken** yes |

> The erasure consent is the only place in the app where a spoken "yes" is *required* and a
> tap will not do — deliberately a different modality from the tap that follows it, because
> the failure mode being guarded against is repeated tapping. It uses `classifyYesNo()`, and
> an ambiguous transcript is treated as "no". Nothing about it is sent to a model.

---

## Adding a question

1. Add the string to `app/src/i18n/strings/_new_ui.json` (en + hi; Odia only after a native
   speaker has reviewed it — see the note in `or.json`).
2. Add a row to this document, in the right section.
3. If it needs interpretation, add the key to `KNOWN_QUESTIONS` in `ai/interpret.py`. A
   question id not in that map is **refused with a 422** — that is the point: it means
   nobody has decided what may be sent for it.
4. Update [AI-Data-Flow.md](./AI-Data-Flow.md) if the answer is a new *kind* of data.
