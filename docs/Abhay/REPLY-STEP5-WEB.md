# Step 5: both web-side changes are in — and one measurement does not survive S3

Answering `REQUEST-STEP5-WEB.md`. Both changes landed on `main`.

## 1. The recipe is stored ✅

`_store_recipe()` in `web/api/routers/products.py`, called from `enhance_status()` on the
proxied body. Verified on a real job:

```
recipe stored : True | mask_version: birefnet@e2bf8e44
tier_source   : auto
```

`tier_source` is carried through untouched and no tier is ever recomputed on this side — the
one rule you asked for. `_store_recipe` is silent on a malformed recipe rather than raising:
losing a fast re-render is not worth failing a poll the app needs to show the artisan their
photograph.

## 2. `POST /products/{product_id}/rerender` is in ✅

Synchronous, straight through, same ownership check as `enhance()`. Errors pass through
rather than flattening. Verified:

```
tier A -> C : tier=C  tier_source=user  images=3
bad tier    : 400 "tier must be A, B or C"
empty recipe: 409 "no stored recipe — run /enhance first"
```

409 rather than your suggested wording for the empty-recipe case, because nothing is broken —
the product simply predates the column.

`_source_url()` is factored out of `enhance()` so both routes resolve the same `full` variant
the same way. That mattered more than it looks: the row carries the 1200px display url, and
the gate refuses anything under 1000px on the short side.

---

## ⚠️ The 131ms does not hold once object storage is configured

Measured just now, same box, `S3_*` set in `web/api/.env`:

| | yours (file://) | measured here (Supabase) |
|---|---|---|
| rerender A→C | 131 ms | **11225 ms** |
| rerender →B | 348 ms | 10804 ms |
| rerender →A | 295 ms | 9488 ms |

**The mask cache is working.** `mask_birefnet@e2bf8e44.png` is on disk at the expected path
and is being read; no segmentation pass is happening. The time is all network, at both ends:

- **~2.3 s** downloading the full-resolution original back from Supabase. `render()` needs the
  original pixels, and with S3 on they are no longer a local file — `storage.open_image()`
  fetches them over HTTPS on every call.
- **the rest** re-uploading three rendered variants to the public bucket, every time.

So the shape of the win changed rather than disappearing: the GPU is genuinely skipped, and
that is real. But "about 200 ms per thumbnail" was measured in a configuration where both the
input and the outputs were local files, and that is not the configuration this now runs in.

**What this means for the tier picker.** Three thumbnails at ~10 s each is not the interaction
either of us described. It is still better than 3 × 8.8 s, but it is not "immediate", and I
would not build the picker against this number without one of:

1. **Cache the decoded original next to the mask.** It is already being written per product;
   the input could be too, keyed the same way. Removes the 2.3 s download and is the smallest
   change.
2. **Do not re-upload variants that did not change.** A tier switch changes the cut-out, so
   all three do change — but a re-render at the *same* tier currently re-uploads identically
   named objects for nothing.
3. **Render one preview at one size for the picker**, and only produce the three marketplace
   variants once the artisan has settled. The picker does not need a 2000px Amazon render to
   show someone what the edge looks like.

(3) is probably the honest answer, and it is an AI-side call rather than a web-side one, which
is why this is a note and not a patch.

Everything else in your request is unchanged and working. `test_recipe.py` passes 18/18 here.
