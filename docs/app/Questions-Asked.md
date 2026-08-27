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

## 3. The cataloger — asked once per product, every product

Five questions on `/catalog/voice`, one at a time, with the artisan's own photo on screen
above them. All five are open text and all five are interpreted.

| # | key | English | Field |
|---|---|---|---|
| 1 | `catalog.q_what` | What is this? | `what` |
| 2 | `catalog.q_material` | What is it made of? | `material` |
| 3 | `catalog.q_time` | How long did it take? | `time` |
| 4 | `catalog.q_special` | What is special about it? | `special` |
| 5 | `catalog.q_size` | How big is it? | `size` |

Each answer may be **skipped**. Five skips still reaches `/catalog/review`, where the vision
pre-fill carries the listing on its own — the questions improve a listing, they do not gate
it.

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
