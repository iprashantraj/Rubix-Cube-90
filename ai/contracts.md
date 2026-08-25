# AI service contracts

Stable shapes. The web API codes against this; stub responses unblock day one.

---

## POST /enhance  — F1 image pipeline

Async. Returns a job id; enhancement takes ~20s.

Request
```json
{ "product_id": "p_123", "image_url": "s3://raw/abc.jpg", "targets": ["amazon", "gem", "whatsapp"] }
```

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

Response
```json
{
  "floor": 2156,
  "suggested_price": 2600,
  "mrp": 2889,
  "market_range": { "low": 1800, "high": 4500, "sample_size": 23 },
  "below_floor_warning": false,
  "breakdown": {
    "material": 800, "labour": 1440, "margin": 216,
    "note": "mrp is set so the price still clears the floor after GeM's 10% mandated discount"
  },
  "breakdown_voice_hi": "800 rupaye dhaaga, 12 ghante kaam. 2600 sahi hai."
}
```

`below_floor_warning: true` means the market will not pay what it cost to make.
**The app must speak this warning.** Under-pricing is the problem we exist to fix.
