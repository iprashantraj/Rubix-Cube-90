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

## 4. Image pipeline latency — it was never the model

### Today

Measured 2026-09-02 on the dev laptop (RTX 4060, model warm), one 12MP phone photo:

| Stage | Time | Where |
|---|---|---|
| JPEG decode | ~100ms | CPU |
| `gate()` blur/resolution | 375ms | CPU, full 12MP array |
| `to_master()` 12MP → 2000px | 168ms | CPU LANCZOS |
| **BiRefNet segment** | **402ms** | GPU |
| `apply_tier()` | 124ms | CPU |
| `crop()` | 54ms | CPU |
| encode ×3 targets | 80ms | CPU |
| **Total compute** | **≈1.3s** | all local |

Against that, S3 on Supabase `ap-southeast-2` (Sydney) was costing **eight serialized round
trips** at 0.81–1.13s each, measured:

| Round trip | Count |
|---|---|
| `uploads.complete()` → `derive()` puts: full, thumb, display | 3 |
| + original into the private bucket | 1 |
| `ai/enhance/storage.py` fetching the signed `full` back | 1 GET |
| `_publish_s3()` → amazon, gem, whatsapp | 3 |

**≈7s of network against 1.3s of work. Compute was 15% of the wall clock.** The image was
crossing the Indian Ocean four times to be processed by a GPU in the same room. S3 was
switched off for the demo on 2026-09-02 for this reason, and that was the correct call.

Three multipliers, in order of size — and note that none of them is the model:

1. **Geography.** Sydney is ~0.9s RTT from India. Every round trip pays it in full.
2. **Serialization.** Those seven puts are independent and run one after another.
3. **Round-tripping.** `web/api` uploads bytes to Sydney so `ai/` can download the same
   bytes straight back.

### What changes for production

| Change | Effect |
|---|---|
| Move the Supabase project to `ap-south-1` (Mumbai) | 0.9s → ~50ms per round trip. Biggest single win and it is a project setting, not code |
| Parallelize the seven puts (`asyncio.gather`) | 7 serial → ~1 concurrent, even from Sydney |
| `ai/` publishes to object storage directly | Kills the laptop→cloud→laptop→cloud round-trip entirely. `ai/contracts.md` already specifies `s3://out/...`; needs credentials in `ai/.env`, which it does not have today. This is the real fix, and `_publish_results` says so in its own docstring |
| Redis + RQ for the job table (`docs/decisions.md` #2) | Jobs are process-local in `ai/enhance/jobs.py`; restarting the service loses in-flight work. Swap surface is two functions |
| CDN in front of the public bucket | Marketplace image loads, not processing |

### ⚠️ What must NOT be assumed in the meantime

- **`GET /api/enhanced/{path}` is demo scaffolding and must be deleted before production.**
  Added 2026-09-02 so that switching S3 off costs latency instead of correctness. It serves
  the AI box's local disk, so it only works while both services share a filesystem, and the
  urls it builds embed whichever host the caller used — on a phone hotspot that is a DHCP
  lease `docs/app/START-SERVER.md` says moves within the hour. `_record_variants` writes
  those urls to the database, so rows published this way go stale when the laptop's address
  changes. An S3 url would not. Superseded by "`ai/` publishes directly" above.
- **With S3 off, `Upload.url` is also `file://`.** `POST /uploads/{id}/complete` returns a
  local path, so the `raw` ProductImage row is unreadable to anything that is not the phone
  that took the photo. The app survives on its own local copy; the marketplace and admin
  console do not. `_record_variants` promoting an enhanced variant to primary is what keeps
  a listing page working — so this mode depends on enhancement having succeeded, where S3
  mode does not.
- **The 402ms GPU segment is the floor, not a target.** Do not shrink the inference size:
  `ai/enhance/segmenter.py` documents that BiRefNet always infers at 1024² whatever it is
  given, so there is nothing to gain. Do not feed it the full-resolution upload either — the
  same docstring records that this is slower *and* visibly worse.
- **The 375ms gate is not fat.** Blur detection needs real pixels; downscaling first
  destroys the signal it measures. Raising or lowering the sample size is already on the
  rejected list in `CLAUDE.md`.
- **The database host is not the same problem as the storage host.** Both are in Sydney, but
  the DB costs 200–406ms per query across a handful of queries per request (~1–2s), where
  S3 cost ~7s. Moving the region fixes both at once. Standing up a local Postgres to dodge
  the latency is a demo-day tradeoff, not an architecture decision — the schema is the same
  either way and `alembic upgrade head` reproduces it.

### The one thing still slow, and it is not on this list

`ai/service.py` has **no startup warm**. `segmenter.warm()` exists and nothing calls it, so
the model loads lazily on the first `/enhance`:

```
model load (COLD):           3486ms
first inference (autotune):   899ms   ← vs 402ms warm
```

Every restart of the AI service re-arms this, and it lands on the first photo of a demo. A
lifespan hook calling `warm()` plus one dummy inference to force CUDA autotune removes ~4s
from that first request and changes nothing else.

---

## 5. Known gaps, unrelated to models

- ~~**No Alembic migrations exist.**~~ Resolved. `web/api/alembic/versions/` holds seven as
  of 2026-09-02, through `c3a71f0d5e42` (product recipe and mask version). `alembic upgrade
  head` reproduces the schema on any host, which is what makes a local Postgres a
  configuration change rather than a migration project.
- **`POST /catalog/interpret` is not rate-limited.** It is authenticated, so it is not an
  open relay, but an artisan id is currently used only for identification. It spends money
  per call.
- ~~**`ai/catalog/nlp.py`, `ai/enhance/`, `ai/price/` are still stubs.**~~ Stale twice over.
  `enhance/` runs end to end apart from its colour stages — `white_balance()`, `tone()` and
  `denoise_sharpen()` are unwritten, skipped explicitly, and named in every response — and
  `price/` is deterministic. On the F2 side `catalog/interpret`, `catalog/harvest`,
  `catalog/prefill` and `POST /catalog` are all built. `ai/catalog/nlp.py` was the original
  stub sketch for F2 and was deleted on 2026-09-03: `interpret.py`, `catalog/describe.py`,
  `catalog/prefill.py` and `catalog/seo.py` are what got built instead, and
  `transcribe`/`speak` live in `web/api/routers/voice.py`, not in that service at all. See
  the "Current state" section of `CLAUDE.md`.
