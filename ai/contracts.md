# AI service contracts

Stable shapes. The web API codes against this; stub responses unblock day one.

---

## POST /enhance  — F1 image pipeline

Async. Returns a job id; enhancement takes ~20s.

Request
```json
{ "product_id": "p_123", "image_url": "s3://raw/abc.jpg", "targets": ["amazon", "gem", "whatsapp"] }
```

⚠️ `image_url` is whatever `POST /uploads/{id}/complete` returned. Today that is a
`file://` URI into `web/api`'s `STORAGE_DIR`, not `s3://` — object storage is not wired up
yet. Open it through something that handles both schemes rather than parsing the string,
and it will keep working when storage moves.

202 Accepted
```json
{ "job_id": "j_456", "status": "queued" }
```

GET /enhance/{job_id}
```json
{
  "status": "done",
  "images": [
    { "target": "amazon", "url": "s3://out/abc_2000.jpg", "width": 2000, "height": 2000, "is_primary": true }
  ],
  "warnings": ["colour shifted during white balance — confirm with artisan before publishing"]
}
```

Rejected at the gate (no GPU spent):
```json
{ "status": "rejected", "reason": "resolution_below_1000px", "message_key": "photo.too_small" }
```

`recipe` is also present on a `done` body. **Store it on `Product.recipe`** (migration
`c3a71f0d5e42`) — it is what makes the endpoint below cheap, and what lets a better mask
re-render this product later without discarding the artisan's choices.

---

## POST /enhance/rerender — re-apply a stored recipe

Synchronous, and **no GPU while the mask is cached** — tens of milliseconds against ~20s for
a fresh `/enhance`. This is what the tier picker calls when the artisan says "leave my
background alone".

Request
```json
{ "product_id": "p_123", "image_url": "s3://raw/abc.jpg",
  "recipe": { "...": "the recipe stored on the product row" },
  "tier": "C", "targets": ["amazon"] }
```

`tier` is optional. Sending it changes the tier **and marks the recipe
`tier_source: "user"`** — once a person has overruled the confidence score, nothing
automatic may quietly overrule them back.

200 OK — same shape as a `done` poll, plus the updated `recipe`. Store it back on the row.

`stages` says how the render was served: `mask_cached` means no model ran; `segment` means
the stored mask was gone and it was rebuilt (rare, and the only slow case).

Errors: **400** missing `image_url` or `recipe`, or a tier that is not A/B/C. **422** the
recipe is well-formed JSON that `render()` cannot honour — re-run `POST /enhance`. **502**
the source image could not be read.

---

## POST /catalog  — F2 voice to listing

Request
```json
{ "audio_url": "s3://voice/xyz.m4a", "language": "or", "image_url": "s3://raw/abc.jpg" }
```

Response — English and Hindi are always both present.
```json
{
  "transcript": "...",
  "title": "Handwoven Sambalpuri Cotton Saree",
  "desc_en": "...",
  "desc_hi": "...",
  "category": "textiles.saree.sambalpuri",
  "material": "cotton",
  "technique": "ikat",
  "dye_type": "natural",
  "dimensions": "5.5m x 1.2m",
  "keywords": ["sambalpuri", "handloom saree", "odisha ikat"],
  "confidence": 0.82
}
```

## POST /catalog/interpret  — free speech to one allowed answer

People do not answer in the shape of the question. Asked what they make, an artisan says
"मैं साड़ी बुनता हूँ", not "weaving". Every voice screen in onboarding needs the same thing:
here is what was said, here is what was asked, here are the answers I can accept.

Request
```json
{
  "transcript": "मेरे पिताजी करघा चलाते थे, मैं भी वही काम करता हूँ",
  "question": "onboard.craft",
  "options": ["weaving", "pottery", "metalwork", "woodwork",
              "painting", "jewellery", "leather", "bamboo"],
  "language": "hi"
}
```

Response
```json
{ "choice": "weaving", "confidence": 0.88 }
```

`choice` **must** be one of `options`, or `null`. Never a new value, never a paraphrase —
the caller stores it as a stable slug that the category mapping and every channel adapter
key off. A `null` choice is a supported answer and means "I could not place this"; the app
falls back to its visual grid and nobody is stuck.

⚠️ The client (`app/src/voice/interpret.js`) tries a local synonym table BEFORE calling
this, and uses it when it matches unambiguously. That is not a cost optimisation — it is so
an artisan who says a word we already know is not made to wait on a network they may not
have. This endpoint is for the sentences the table cannot reach, which is most of them.

## POST /catalog/prefill  — vision only, before the artisan speaks

Request `{ "image_url": "..." }` → same fields, all nullable. The artisan corrects by voice
instead of describing from scratch.

---

## POST /price  — F3 pricing

Request
```json
{
  "product_id": "p_123",
  "material_cost": 800,
  "labour_hours": 12,
  "cluster_id": "sambalpur",
  "category": "textiles.saree.sambalpuri",
  "channel": "gem"
}
```

Response — these numbers come from actually calling the endpoint, not from arithmetic by hand.
```json
{
  "floor": 2576,
  "suggested_price": 3150,
  "mrp": 3500,
  "market_range": { "low": 1800, "high": 4500, "sample_size": 23 },
  "below_floor_warning": false,
  "breakdown": {
    "material": 800, "labour": 1440, "margin": 336,
    "note": "mrp is set so the price still clears the floor after GEM's 10% mandated discount"
  },
  "breakdown_voice_hi": "800 रुपये का सामान, 12 घंटे का काम। 3150 रुपये सही रहेगा।"
}
```

`assumed_missing` is present ONLY when an input was absent — `["material_cost"]` when the artisan
skipped the sixth cataloger question. The floor is then built on labour alone and is too low; the app
should say what was not counted rather than present the figure as complete.

⚠️ With **neither** `material_cost` nor `labour_hours` the endpoint returns **422**, not a quote. There
is no floor to compute, and a floor of ₹0 clamps nothing while looking authoritative — the app would
speak "लागत 0 रुपये है" to someone who cannot read the screen to check it. `/price` failing costs a
suggestion; a fake floor costs the artisan money.

`below_floor_warning: true` means the market will not pay what it cost to make.
**The app must speak this warning.** Under-pricing is the problem we exist to fix.
