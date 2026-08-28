# Future implementations

Things the code is deliberately shaped for but does not do yet. Each entry says what exists
today, what would change, and what must NOT be assumed in the meantime.

---

## 1. Vision — sending the photo to a model

### Today

**No image is ever sent to any model.** `deepseek/deepseek-v4-flash` is a text model with no
vision capability; handing it an image would at best be ignored and at worst be billed.

So the whole image path is text-only right now:

| Screen | What happens today |
|---|---|
| `/camera` | The gate scores frames **on the device**. `camera/gate.js` is pure arithmetic — blur, exposure, framing, tilt. No network, no model. |
| `/capture/review` | The artisan confirms the colour by eye. No model. |
| `/catalog/prefill` | Calls `POST /catalog/prefill`, which is `NotImplementedError` in `ai/service.py`. Returns nothing; the flow continues without a pre-fill. |
| `/catalog/voice` | The photo is on screen **for the artisan to look at**. Only their spoken answer is interpreted. The model is told the question id and the transcript, never the image. |

The photo is displayed next to the question purely so the human has something to describe.
That is a UI decision, not a data flow — see the note in `CatalogVoice.jsx`.

### What changes when a vision model is wired

`POST /catalog/prefill` in `ai/contracts.md` is already specified for this: image in, the
same listing fields out, all nullable, so the artisan **corrects** by voice instead of
describing from scratch. The seam exists; only the implementation is missing.

To turn it on:

1. Pick a model with vision. `deepseek/deepseek-v4-flash` is not one — this needs a
   deliberate second model id, not a swap of the constant in `interpret.py`, because the
   text interpreter should stay cheap and fast.
2. Implement `catalog_prefill` in `ai/service.py`.
3. **Extend the allowlist deliberately.** `build_payload()` in `ai/interpret.py` permits four
   fields and an image is not one of them. That refusal is the safety property; do not
   loosen it for the text path. Give vision its own payload builder with its own allowlist.
4. Update [AI-Data-Flow.md](./AI-Data-Flow.md). An image is a new *kind* of data and the
   table there is meant to be complete.

### ⚠️ What must be settled before the first image leaves the device

- **EXIF is already stripped on upload** (`app/src/api/upload.js`, re-encoded through a
  canvas). That protects against home GPS reaching a public listing. It does **not** decide
  whether the pixels may go to a third-party provider.
- A photograph of a product taken inside someone's home contains their home. Faces,
  children, the inside of a house. The artisan consented to a marketplace listing, which is
  not the same as consenting to a foreign inference provider.
- The `/consent` notice would need to say so. See the same argument about names in
  AI-Data-Flow.md — that one is already live and already needs a disclosure.
- Retention: what does the provider keep, and for how long? Answer it before shipping, not
  after.

---

## 2. Interpreting the remaining questions

`KNOWN_QUESTIONS` in `ai/interpret.py` currently permits seven question ids. A question not
in that map is refused with a 422 — deliberately, so that adding one is a decision.

Not interpreted today, and the reasons are not all the same:

| Question | Why not | Would it help? |
|---|---|---|
| `onboard.place` (PIN code) | `extractPincode()` is deterministic, offline, and has 19 assertions covering digit words in three scripts. It is better than a model at this. | No. |
| `onboard.has_*` (readiness) | Booleans answered by tap. Sending them would disclose financial-inclusion facts for zero benefit. | No — actively harmful. |
| `auth.phone`, `auth.otp` | Typed, not spoken. | No. |
| Confirmations (`colour.confirm`, `money.confirm`) | `classifyYesNo()` returns `null` rather than guessing, and the caller re-asks. | Marginal. A model might catch "haan bilkul" — but re-asking costs eight seconds and a wrong yes on a payment confirmation costs trust. |

---

## 3. The local tier is not a stopgap

`stripCarrier()` and `matchCraft()` in `app/src/voice/interpret.js` run **before** the model
and their answer is used immediately when confident. It is tempting to delete them once the
model works well. Do not.

They are what makes the app work on a phone with no signal, which is where our users
actually are. The model is the fallback for hard sentences, not the primary path — the
ordering in `interpretAnswer()` is deliberate and reversing it would make every name in
onboarding depend on a network round trip.

---

## 4. Known gaps, unrelated to models

- **No Alembic migrations exist.** `web/api/alembic/versions/` is empty; the schema is
  created by `create_all()`, which silently ignores every column you alter. Fine for one
  developer, wrong the moment two share a database.
- **`POST /catalog/interpret` is not rate-limited.** It is authenticated, so it is not an
  open relay, but an artisan id is currently used only for identification. It spends money
  per call.
- **`ai/catalog/nlp.py`, `ai/enhance/`, `ai/price/` are still stubs.** Only
  `catalog/interpret` is implemented in that service.
