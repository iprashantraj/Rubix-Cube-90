# Reply to the 2026-08-27 change log — everything you asked for is done

Written for Abhay, from the app/web side. Your branch is merged into `main`.

Four things in `CHANGELOG.md` were marked as ours. All four are in, plus one correction to
what you asked for on the second one, explained below because it changes the behaviour you
were expecting. Nothing on your side needs to change; this is a status note.

---

## 1. The gate said "too dark" about a blown-out photo

**What you found.** `pottery-earthen-sharp-01.png` — mean 173, 50.6% of pixels blown — was
announced as `photo.too_dark`, because the crushed-shadow check ran before the two
too-bright checks. The artisan is told to add light to a photograph that already has too
much of it.

**What we did.** Reordered the rung to mean-low → mean-high → blown → crushed.

`app/src/camera/gate.js:197-200`

```js
if (exp.mean < t.brightness_mean_min / s) return 'photo.too_dark';
if (exp.mean > t.brightness_mean_max * s) return 'photo.too_bright';
if (exp.blownFraction > t.blown_pixel_fraction_max * s) return 'photo.too_bright';
if (exp.crushedFraction > t.crushed_pixel_fraction_max * s) return 'photo.too_dark';
```

Your fixture is now an assertion in the gate's self-check, so it cannot come back:

```
blown highlights beat crushed shadows — add light to that and it gets worse
```

---

## 2. Blur was announced about a too-far photo — and one correction

**What you found.** The blur rung sat above framing, so at full resolution a photo taken
from too far away scored blurry (a small product leaves little edge energy anywhere) and the
artisan was told to hold still when the fix was to step closer.

**What we did, and where we did not follow you exactly.** Framing now runs first — but only
when a product was actually found.

`app/src/camera/gate.js:216` and `:229-233`

```js
if (frame.found && frame.fraction < t.fill_fraction_min / s) return 'photo.too_far';
// ... too_close, off_centre ...
if (blur < t.blur_laplacian_variance_min / s) return 'photo.blurry';
if (!frame.found) return 'photo.too_far';
```

**Why the extra condition.** Moving framing above blur wholesale means `frame.found === false`
returns `too_far`, and "not found" is not the same fact as "the product is small in the
frame". A frame with no busy region anywhere is out of focus, or pointed at a blank wall.
Telling that artisan to walk closer sends them towards something the camera never saw, and
they have no way to know that — the sentence is all they get.

So: not-found falls through to the blur rung, and is only answered as `too_far` after blur
has had its say. A sharp, well-lit frame with genuinely nothing in it does say "move closer",
which is the right answer for that case.

Worth knowing: the gate's existing `no texture -> blurry` assertion is what caught this. The
straightforward reading of your request failed it on the first attempt.

---

## 3. stripExif and the sideways photos — answered, not tested

**What you flagged.** `stripExif` might be discarding the EXIF rotation tag *before* the
rotation is applied, leaving permanently sideways pixels with no note left to recover them.
You could not confirm it without a device, and you wanted to know before building `crop()`
and `composite()`.

**What we did.** Removed the uncertainty instead of testing it.

`app/src/api/upload.js:76`

```js
const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
```

The default for that option is `'none'`, and Android WebViews are inconsistent about it —
so your suspicion was well founded. `'from-image'` makes the browser apply the rotation while
decoding, which is *before* the canvas re-encode throws every tag away. The GPS coordinates
still go, which is the point of the function; the orientation is now baked into the pixels
first.

You do not need the two-minute phone test any more. Your crop and composite stages will get
upright input.

---

## 4. `recipe` and `mask_version` on `Product` — the migration is written and applied

**What you asked for** (PIPELINE-RECONCILIATION §4): a JSON `recipe` column and a
`mask_version` string, so stages can compute parameters rather than each returning a mutated
image, and `render(original, mask, recipe)` becomes the only thing that produces pixels.

**What we did.**

`web/api/models.py:189` and `:194`

```python
recipe: Mapped[dict] = mapped_column(JSON, default=dict)
mask_version: Mapped[str | None] = mapped_column(String(40))
```

Migration `c3a71f0d5e42_product_recipe_and_mask_version.py`, chained off the baseline. Both
columns are additive and defaulted, so it applies to a live table without a rewrite.
`recipe` carries `server_default='{}'` rather than only a Python-side default, so a row
written by anything that is not our ORM still gets a valid object instead of a NULL every
reader has to guard.

**The shape is yours.** We deliberately did not model it. Keep it documented in §4 — this
table should not need a migration every time a stage gains a parameter.

---

## What changed on our side that touches yours

**Two `storage.py` files existed.** You wrote one, we wrote one, independently, on the same
base. They are not two versions of one module: yours stages and assembles upload chunks on
local disk and is stdlib-only on purpose, so `python3 test_uploads.py` runs with nothing
installed. Ours publishes to S3 and needs boto3 and settings.

Merging them would have cost your test its independence, so **yours keeps the name** and
ours became `web/api/objectstore.py`. Bytes are assembled in `storage.py` and published in
`objectstore.py`. `test_uploads.py` is untouched and passes.

**Your finding §5.1 is fully unblocked, including the part we had broken.** Our version of
`complete()` answered 503 when S3 was unconfigured — which would have blocked you again, on
a dev box, for the same reason as before. Now:

`web/api/routers/uploads.py:146` and `:158`

```python
up.url = final.resolve().as_uri()   # your local file:// url — always set
if objectstore.available():          # publish only if there is somewhere to publish to
```

With no S3 configured you get the `file://` URL and nothing else happens. With S3 configured
the derived variants are uploaded and `up.url` becomes the public display URL. If publishing
fails, it logs and keeps the upload — the bytes are already safe on disk, and losing the
enhancement must never cost the listing (rule 3).

**One privacy constraint you should know about.** Raw originals go to a *separate private
bucket*, not a `raw/` prefix inside the public one. Public-read is a property of the bucket
in S3 and Supabase, so a prefix is a naming convention and not a boundary — with one public
bucket, every artisan's original photograph was fetchable by anyone holding the URL. The key
prefixes still exist so a key names its own bucket. `web/api/check_storage.py` asserts the
split by actually trying to read a raw object over HTTP and requiring a failure.

---

## Two open threads back to you

1. **`blur_laplacian_variance_reject_min: 20` is not enforced anywhere yet.** You added the
   key and the number is calibrated, but no server-side code reads it — the hard reject does
   not exist. Ours or yours, but right now the split you documented is only half real.

2. **`ai/thresholds.json` moved and the app bundles it as a floor.** Your recalibration came
   in with the merge, so `app/src/api/client.js` now ships your numbers as its offline
   fallback. That is the intended design (one file, two readers) — flagging it so you know
   the app's behaviour changed the moment your branch landed, not when someone next fetches
   thresholds at runtime.
