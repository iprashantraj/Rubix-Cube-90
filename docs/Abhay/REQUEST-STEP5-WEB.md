# Step 5 is built — two changes needed on the web side

Branch `abhay/recipe-system`. The recipe system is done and `POST /enhance/rerender` is live
on the AI service. **Neither does anything for a real artisan until the two changes below
land**, because the recipe is currently computed, returned, and thrown away.

Shapes are in `ai/contracts.md`. Reasoning is in `docs/Abhay/CHANGELOG.md`, entry
2026-08-29, and in `PIPELINE-RECONCILIATION.md` §4, which is what asked for this.

## Why it is worth your time

Measured on a real fixture, on the dev box:

| | |
|---|---|
| `POST /enhance` (fresh) | **8848 ms** |
| `POST /enhance/rerender`, tier A→C, mask cached | **131 ms** |
| same, →B | 348 ms |
| same, →A again | 295 ms |

About 40× faster, and it never touches the GPU. That is the difference between an artisan
tapping "leave my background alone" and getting an answer immediately, versus waiting twenty
seconds to undo one decision.

It also means a better segmentation model later can re-render every existing product
**without discarding what each artisan chose** — `mask_version` on the row is what identifies
who needs it.

---

## 1. Store the recipe. `web/api/routers/products.py`, `enhance_status()`

The poll proxy returns the AI body to the app and keeps nothing. Every `done` body now carries
a `recipe`, and the column you built in `c3a71f0d5e42` is still empty.

When the proxied body has `status == "done"`:

```python
rec = body.get("recipe")
if rec:
    owner.recipe = rec
    owner.mask_version = rec["mask_version"]
    db.commit()
```

`owner` is the `Product` you already look up for the ownership check, so there is no extra
query. **Without this, change 2 has nothing to replay** and every re-render silently falls
back to a full ~9s segmentation pass — it still works, it is just no faster than before.

## 2. Add a re-render route

`POST /products/{product_id}/rerender`, proxying to the AI service's `POST /enhance/rerender`.
Same ownership check as `enhance()`. It needs the product's stored `recipe` and the same raw
`image_url` that `enhance()` sends.

```python
job = await _ai("/enhance/rerender", {
    "product_id": p.id,
    "image_url": raw,               # the size_variant == "raw" url, as in enhance()
    "recipe": p.recipe,
    "tier": tier,                   # "A" | "B" | "C", from the request body
    "targets": ["amazon", "gem", "whatsapp"],
})
p.recipe = job["recipe"]
p.mask_version = job["recipe"]["mask_version"]
db.commit()
return job
```

**It is synchronous** — no job id, no polling. With the mask cached the work is shorter than a
round trip, so a queue would cost more than it saves. Return the body straight through.

Guard `p.recipe` being empty (`{}`, the server default) — that is a product enhanced before
this landed, and the honest answer is to call the existing `/products/{id}/enhance` instead.

Errors, all from the AI service and worth passing through rather than flattening to 500:
**400** missing `image_url`/`recipe` or a tier that is not A/B/C, **422** the stored recipe
cannot be rendered (the fix is a fresh `/enhance`), **502** the source image could not be read.

---

## One rule that matters more than either change

`recipe["tier_source"]` is `"auto"` until a person changes the tier, then `"user"`.

**Once an artisan has overruled the confidence score, nothing automatic may quietly overrule
them back.** If anything on your side ever re-renders on their behalf — a batch job, a
migration, a retry — carry `tier_source` through unchanged and do not recompute the tier for a
recipe that says `"user"`. The AI service sets the field; only the web side can accidentally
discard it.

---

## For the app side, and it answers an open question

This makes the tier picker cheap: three thumbnails — *remove the background* / *soften the
edge* / *keep my background* — each a call to change 2, each about 200 ms.

That answers §9.5, which has been open since the reconciliation: **yes, it is worth the app's
time**, because the server cost is no longer twenty seconds.

The server picks a tier by confidence regardless, so nothing is blocked if this is not built.
But tier B and C exist precisely for the photographs where the automatic choice is least
trustworthy, and the artisan is the only one who can see whether the cut-out is right.

## Still open from my side, unchanged

`white_balance()`, `tone()` and `denoise_sharpen()` are still unwritten, and their recipe
fields are null rather than absent so that today's recipes keep rendering once they land.
Colour is the largest remaining gap, and it is blocked on §9.2 — whether the app can send a
`white_ref` rect with the upload. Until that is answered, white balance can only ever be
gray-world, which is the method most likely to pull a natural dye off-colour.
