# Image Pipeline — Reconciliation

### Two designs for the same feature, and which parts of each survive

**Status:** v1 · decision record · written by the image/AI owner
**Reconciles:** `docs/Abhay/IMAGE_PIPELINE_SPEC_WEB.md` (my spec, written before the repo existed)
against `docs/app/Camera-Pipeline.md` and the code actually in `app/`, `web/api/` and `ai/`.
**Read this before** either of those two documents. Where they disagree, this file decides.

Everything below was checked against the code, not against the docs. Line references are to the
files as they stand today.

---

## 0. The short version

**The repository's architecture wins. My spec's image science wins.**

They are not really competing designs — they disagree about *where* the work runs, and they agree
about almost everything else. My spec assumed the WebView would do the processing, because when I
wrote it there was no server. There is a server now, `docs/decisions.md` settled online-first, and
the whole enhancement path is already stubbed out in `ai/enhance/pipeline.py` waiting to be filled
in. Running U²-Netp and OpenCV.js inside a Capacitor WebView when a Python service with a GPU is
sitting there is work spent to get a worse result.

So: **everything in my spec that describes device-side processing is withdrawn. Everything in it
that describes what a good product photo is, and how to know when the pipeline has failed, moves
into `ai/enhance/pipeline.py`.**

| Question | Answer | Loser |
|---|---|---|
| Where does capture coaching run? | On the device, exactly as built — `app/src/camera/gate.js` | My spec §3 |
| Where does enhancement run? | On the server — `ai/enhance/pipeline.py` | My spec §5, §6 (device-side) |
| Offline or online? | Online-first, as settled in `docs/decisions.md` | My spec §10 |
| Who owns the thresholds? | `ai/thresholds.json`, one file, fetched at runtime | My spec §14's `thresholds.ts` |
| Is the original preserved? | Yes — via a recipe, my spec §2 | The repo has no answer yet |
| How does a bad cutout fail safely? | Three tiers, my spec §6.3 | `pipeline.py` has no answer yet |
| What must never be built? | My spec §13, unchanged | — |

---

## 1. Why the repository's architecture wins

Five reasons, in the order they mattered to me.

**1. The capture gate that exists is better than the one I specified.** This is not politeness. My
spec §3.1 described blur and exposure checks on a 160×120 frame at 5fps with a red/green border.
`app/src/camera/gate.js` does that and then does four more things I did not think of: a priority
ladder so the artisan is told *one* problem instead of four (`gate.js:180`), two independent layers
of hysteresis so the ring does not flicker (`gate.js:181` and `:226`), a free tilt check riding the
accelerometer that costs no image work at all (`gate.js:142`), and a three-frame burst that keeps
the sharpest still (`gate.js:269`). The framing check measures cell variance *relative to the
busiest cell* (`gate.js:101`), which is why a dark matka and a bright dupatta both work without
recalibration — I would have written an absolute threshold and spent a day discovering why it
failed on dark products. It also has 19 assertions that run with `node app/src/camera/gate.js`, no
device and no framework. Replacing that with my §3 would be a downgrade shipped as progress.

**2. The device cannot do the segmentation work well, and does not have to.** My spec §1.1 was
honest about the ceiling: no NPU from a WebView, INT8 unusable on the WebGL backend, ~300ms–1s for
U²-Netp at 320×320 on a good day. The server runs BiRefNet at 1024×1024 with real alpha matting.
For a fringed pallu or a net dupatta — the exact cases the tier system exists to protect — that gap
is the whole product. `ai/enhance/pipeline.py` already names the right stages in the right order.

**3. Two segmentation models is two of everything.** My spec had U²-Netp on the device and BiRefNet
on the server, with a silent swap between them. That is two model integrations, two sets of
confidence calibration, a mask-versioning scheme, and a class of bug where the two disagree and the
artisan watches their product change shape. The single server model deletes all of it.

**4. `ai/thresholds.json` solves a problem my spec did not know it had.** I specified
`src/config/thresholds.ts`, compiled into the app. Recalibrating would then be an app release, and
`docs/app/Camera-Pipeline.md` §0 is right that rural users do not install app updates. Serving the
numbers means recalibration is a JSON edit and a deploy. The single-source rule also removes the
failure I would eventually have shipped: the phone accepting a photo the server then rejects.

**5. Online-first is already load-bearing everywhere else.** Every AI feature in this project is a
server call. An offline-capable image pipeline sitting inside an app whose cataloging, pricing and
publishing all need the network buys the artisan a photo and nothing else. `docs/decisions.md` made
that call before I arrived; re-litigating it from the image side would fork the app.

---

## 2. What my spec keeps, and where it now lives

These are the parts worth having, all of them moving server-side into `ai/enhance/`.

| From my spec | Moves to | Why it is worth keeping |
|---|---|---|
| §2 Recipe model | `Product.recipe` (JSON column) + `ai/enhance/renderer.py` | Non-destructive by construction. Undo is a field change. Tier switching costs no re-segmentation. The v2-mask silent swap preserves the artisan's choices for free |
| §6.2 Confidence scoring | `pipeline.py` after `matte()` | The pipeline has to know when its own cutout is bad. Without this there is no principled way to choose the safe path |
| §6.3 Three tiers A/B/C | `pipeline.py` `composite()` | `composite()` today only describes pure-white Tier A. A chewed-up saree edge on white looks worse than no edit at all — Tier C removes nothing and therefore cannot damage the product. It is the safety net for the whole feature |
| §6.4 Contact shadow | `pipeline.py`, Tier A only | Best visual gain per line in the pipeline. `docs/decisions.md` already agrees: "~20 lines of OpenCV, not a model" |
| §5.3 CLAHE on the L channel of LAB only | `pipeline.py` `tone()` | CLAHE on RGB shifts hue. A saree changing shade is the misrepresentation problem the colour lock exists to catch — better not to cause it |
| §5.5 Hard limits (sat ≤ +10%, mild unsharp only, no heavy denoise) | `pipeline.py` constants | Texture is what signals handmade. `denoise_sharpen()` needs a documented ceiling or it will smooth the weave away |
| §9.2 Multi-step downscale | `pipeline.py` `export()` | Any reduction over 2× in one step aliases visibly. Halve repeatedly. Cheap, and it shows in the 2000px listing image |
| §12 pHash on ingest | `ai/enhance/` or the upload path | Catches stock photos pulled off the web and the same image reused across accounts. Small, and it is a trust feature the marketplace will want |
| §8 Correction logging | `corrections` table, if the fix brush ships | Every brush stroke is a labelled example of where the model failed, on the hardest cases. That dataset does not currently exist for Indian handicraft |
| §13 Non-goals | Unchanged, applies to both stacks | Super-resolution, generative backgrounds and diffusion relighting are all fabrication. The reasons do not depend on where the code runs |
| §14–§15 Calibration and prototype-first | `images/` + `research/camera-thresholds/` | See §7 below. This is the one that most needs doing |

## 3. What my spec withdraws

Deleted, not deferred. If someone finds these sections later, this is the note saying they were
considered and dropped.

| Withdrawn | Reason |
|---|---|
| §1.3, §5, §6 — OpenCV.js and ONNX Runtime Web in the WebView | Server does it better. Also saves an 8–10 MB WASM download and the `Mat.delete()` OOM class of bug (my own §19 called it the most likely silent failure) |
| §3 — `@capacitor-community/camera-preview` | `app/` uses `@capacitor/camera` and plain `getUserMedia`; the gate is built and tested on it. Swapping the plugin would rewrite a working, covered path for no gain |
| §10 — offline-first, Capacitor Filesystem, IndexedDB, upload queue | Settled against in `docs/decisions.md`. `app/src/api/upload.js` (resumable, chunked, backoff) is the replacement and is the right size of solution |
| §1.2 — progressive reveal at 400ms / 1200ms | Not achievable when enhancement is a ~20s server job. See §5 finding 8 — this is a conflict I am flagging rather than quietly resolving, per my own §0 |
| §3.1 exposure test (`fraction(gray<15) > 0.35`) | `gate.js:44` is better: a mean *plus* separate clipped-highlight and crushed-shadow fractions. A blown region contains no information at all and deserves its own signal |
| §7.3 — pre-generated Bhashini audio, as an image-pipeline concern | Still correct, but it is the app's problem and `app/src/voice/` already owns it. Out of my scope |
| §11 — device→server mask swap as a two-model pipeline | One model, one mask. The recipe still gives us re-render-on-upgrade if a better model lands later |

---

## 4. The one thing my spec is still right about that the repo has not built

`ai/enhance/pipeline.py` is a sequence of stages, each taking an image and returning an image. Read
literally, that is exactly the design my spec §2 warns against — apply edits to a canvas in order,
save the result. It works, and it makes four things impossible:

- undo without keeping a stack of intermediate images
- switching tier without re-running segmentation
- re-rendering with a better mask later without discarding what the artisan chose
- proving the original was never modified

The fix is small and it is not a rewrite. Keep every stage exactly as designed, but have them
**compute parameters into a recipe** rather than each returning a mutated image, and add one
`render(original, mask, recipe)` at the end. The recipe is a JSON blob on the product row:

```python
# ai/enhance/recipe.py
Recipe = {
    "version": 2,
    "mask_version": "v1",
    "white_balance": {"method": "patch" | "grayworld", "gains": [r, g, b]},
    "clahe": {"clip_limit": 2.0, "tile_grid": [8, 8]},
    "gamma": 1.0,
    "tier": "A" | "B" | "C",
    "tier_source": "auto" | "user",
    "confidence": 0.0,
    "shadow": {"enabled": True, "opacity": 0.25, "blur": 40, "offset_y": 18},
    "crop": {"x": 0, "y": 0, "w": 0, "h": 0, "padding_pct": 8},
}
```

Then "the artisan tapped a different tier" is a field write and a re-render, not a re-run. And
`original.jpg` being byte-identical after any number of edits is true by construction rather than by
discipline.

**This needs one migration on the web side:** a `recipe` JSON column and a `mask_version` string on
`Product` (`web/api/models.py:131`). That is a request to whoever owns `web/api/` — I am not
touching the models file.

---

## 5. Findings — things that are broken or missing, verified in the code

Ordered by what blocks the most work.

**1. ~~Nothing can be enhanced today, and the reason is upstream of `ai/`.~~ FIXED 2026-08-27 — see `CHANGELOG.md`.**
`web/api/routers/uploads.py:76` reads each chunk and discards it (`await chunk.read()` with the
result unused), and `complete()` at `:96` synthesises an `s3://raw/{id}` URL that does not resolve.
Separately, no endpoint writes a `ProductImage` row with `size_variant == "raw"`, which is exactly
what `products.py:133` looks for — so `POST /products/{id}/enhance` answers `400 "no raw image"`
even if the AI service were running. `docs/app/Camera-Pipeline.md` §10 states both plainly. **Until
chunks are persisted somewhere I can read and an upload is linked to a product, I cannot test a
single stage of the pipeline against a real photograph.** For development the storage can be the
local filesystem; it does not need to be S3 to unblock me.

**2. The white reference is asked for and then thrown away.**
`app/src/screens/Camera.jsx:56-59` speaks the white-paper hint at 2500ms. Nothing captures where the
paper is, or even whether the artisan complied. `pipeline.py:40` documents `white_balance()` as
"if a white reference paper is in frame, calibrate the exact white point from it and crop it out" —
but it has no signal telling it the paper exists, and my spec §3.3 explicitly rules out
auto-detecting it as unreliable. So the hint currently buys nothing and the pipeline will always
fall back to gray-world. This matters more than it sounds: white balance is the stage the colour
lock exists to police, and gray-world is exactly the method that pulls a maroon Sambalpuri towards
orange under a tungsten bulb.

The minimal fix is one tap and one optional field. On the review screen, the artisan taps the paper
once; the app sends a normalized rect with the enhance request:

```json
{ "product_id": "p_123", "image_url": "...", "targets": [...],
  "white_ref": { "x": 0.61, "y": 0.78, "w": 0.12, "h": 0.09 } }
```

Absent field → gray-world, exactly as today. Present → calibrate from that patch and crop it out.
**This is a request to the app side and a change to `ai/contracts.md`** — I would rather agree the
shape than build against a guess.

**3. Blur is a hard block, and three separate places say it must not be.**
`gate.js:190-191`, the `_comment` in `ai/thresholds.json`, and the Master reference §4.4 ① all say
blur is content-dependent and must be a suggestion. In code it returns `'photo.blurry'`, which makes
`committed` non-null, which disables the shutter and prevents auto-capture. A plain white cloth or
an undecorated pot is genuinely unphotographable. `docs/app/Camera-Pipeline.md` §11 already flags
this and asks someone to decide. As the person who owns the numbers, my decision:

- **Capture gate: demote blur to non-blocking.** Speak the hint, leave the shutter enabled. A
  Laplacian on a 240×180 preview of a flat-colour product cannot tell "blurry" from "no edges".
- **Server gate: keep a hard reject, but at a lower bar and on the full-resolution image.** Two
  numbers instead of one — `blur_laplacian_variance_min` (advisory, currently 100) and a new
  `blur_laplacian_variance_reject` (hard, well below it). The reject bar exists to catch genuine
  motion blur, not low-texture subjects.

Both numbers need calibrating against the fixtures in `images/` before either is trustworthy. The
capture-side change is a one-line change in `gate.js` plus a self-test assertion, and it is not mine
to make — flagging it here.

**4. ~~`GET /enhance/{job_id}` is not proxied by `web/api`.~~ FIXED 2026-08-27 — added to `routers/products.py`, ownership-checked via the new `Product.enhance_job_id`.**
`app/src/screens/CatalogPrefill.jsx:76` calls it and gets a 404. The app is correctly built to poll;
there is simply no route. A handful of lines, and it unblocks the entire polling path.

**5. `ai/worker.py` is a stub, and the ~20s job cannot be a request.**
`POST /enhance` must return 202 with a job id, per `ai/contracts.md`. That means a queue.
`docs/decisions.md` #2 already settled Redis/RQ. Mine to build.

**6. `pipeline.py` describes only Tier A.**
`composite()` at `:60` is "pure #FFFFFF, sample corners and assert". Correct, and correct for
marketplace primaries — but there is no path for the case where the mask is not good enough to cut
out. Adding the confidence score and tiers B and C is the single biggest robustness win available in
that file.

**7. `pipeline.py:23` proposes SAM 2 for tap-to-refine; my spec §13 rejects SAM 2.**
Both are partly right and the objection does not transfer. My reason was "video model, 150 MB+,
GPU-only, cannot run in a WebView" — irrelevant now, because this would run on the server. The
remaining objection is scope: it is a second model and a second interaction to build for the case
the tier system already covers. **Verdict: not for MVP.** BiRefNet plus alpha matting, with the tier
picker and the erase/restore brush (my spec §7) as the human fallback. `docs/decisions.md` #1 stays
open until benchmarked — see §7.

**8. The 3-second and 400ms/1200ms targets in my spec §18 are not achievable and should be
rewritten.** With enhancement as a ~20s server job they were never going to hold, and I would rather
say so than let an acceptance criterion quietly become decorative. What is actually true, and worth
keeping as the criterion:

- The artisan's own photo appears immediately after capture and is never replaced by a spinner.
  This is already true — `CaptureReview.jsx` shows the captured blob.
- The enhanced version swaps in when polling completes, or never, and the flow completes either way.
  This is already true too: `CatalogPrefill.jsx:63-66` calls `degrade()`, speaks `enhance.failed`,
  and moves on to the colour lock.

That degrade path is the honest version of progressive reveal on this architecture, and it is better
engineered than what I specified, because it survives the AI box being unreachable in production.

**9. `ai/thresholds.json` claims a calibration that has not happened.**
The `_comment` says the numbers were "calibrated in `research/camera-thresholds/` on our own artisan
photos". That directory holds a `.gitkeep`. My spec §14 admits the same thing about its own numbers.
Two documents asserting a calibration that does not exist is worse than one admitting it does not.
Fixing this is what `images/` is for.

**10. `resolution_min_px` is served to the app and never read by it.** Already noted in
`docs/app/Camera-Pipeline.md` §11.2. Harmless today, and it is genuinely the server gate's number —
`pipeline.py:18` is where it belongs. Worth a comment in the JSON saying so, so the next reader does
not go looking for the client-side check.

---

## 6. Threshold reconciliation

`ai/thresholds.json` is the single source of truth and my spec's `thresholds.ts` is withdrawn. Where
we both specified the same check, the repo's formulation wins — it is better factored.

| Check | My spec §3.1/§14 | `ai/thresholds.json` | Verdict |
|---|---|---|---|
| Blur | `BLUR_THRESHOLD = 80` | `blur_laplacian_variance_min: 100` | Repo's key name. Both values are guesses; split into advisory + reject per finding 3 |
| Too dark | `fraction(gray < 15) > 0.35` | `brightness_mean_min: 60` + `crushed_pixel_fraction_max: 0.05` | Repo. Mean and clipping are different failures and deserve different signals |
| Too bright | `fraction(gray > 240) > 0.10` | `brightness_mean_max: 200` + `blown_pixel_fraction_max: 0.05` | Repo, same reason |
| Framing | not specified | `fill_fraction_min/max`, `center_offset_max`, `cell_busy_ratio` | Repo. I had nothing here |
| Tilt | not specified | `tilt_degrees_max: 8` | Repo |

New keys the enhancement side needs. Proposed as a third section of the same file, so the server
pipeline's numbers are recalibrated the same way the gate's are — a JSON edit and a deploy, never a
code change:

```jsonc
"_enhance_only": "Server enhancement pipeline. The app never reads these.",
"blur_laplacian_variance_reject_min": 20,  // BUILT, and calibrated to 20 not 30 — see research/RESULTS.md
"mask_uncertain_fraction_max": 0.08,    // alpha in (0.1, 0.9) — hairy, undecided edges
"mask_blob_count_max": 3,               // product fragmented into pieces
"mask_area_min": 0.15,                  // subject too small to be the subject
"mask_area_max": 0.85,                  // mask has eaten the background
"tier_a_confidence_min": 0.75,          // full cutout on white + contact shadow
"tier_b_confidence_min": 0.45,          // feathered mask on a soft gradient; below this, Tier C
"clahe_clip_limit": 2.0,
"saturation_boost_max": 1.10,           // hard ceiling; see spec §5.5
"crop_fill_target": 0.85,
"crop_padding_pct": 8
```

`blur_laplacian_variance_reject_min` is no longer a guess: §7 has run, and it is 20 rather than the
30 proposed here, because 30 costs six more good photographs for four more blurred ones. It lives in
`thresholds.json` under `_enhance_only` and the server gate reads it. **Every other key above is
still a guess** and none should be trusted until the stage that uses it has been through the same
exercise.

---

## 7. `images/` — the calibration set, and what it closes

Created at the repository root this session. `images/README.md` has the full rationale; the short
version is that thirteen numbers currently decide whether an artisan can use this app at all, and
not one of them has been checked against a photograph.

```
images/
  README.md      what belongs in the set and why — read this before shooting
  MANIFEST.md    committed packing list: file, subject, device, consent
  raw/           the fixtures — gitignored
  out/           contact sheets and per-stage dumps — gitignored
```

Pixels are gitignored and the manifest is committed, following the rule `research/README.md` already
sets for `research/data/`.

The set is deliberately weighted towards the cases that break things — plain white cloth (which
scores blurry while being sharp), black terracotta on a mud floor, brass with real specular
highlights, indoor evening light, fringed dupattas, patterned backgrounds, and paired shots with and
without a sheet of white paper. Twenty-five images minimum before any number is trusted.

**Procedure**, which is my spec §15 unchanged except that the prototype now produces
`ai/thresholds.json` values instead of a `thresholds.ts`:

1. Shoot the set on a mid-range Android phone. Originals only — no crop, no rotate, no editor.
2. Fill in `images/MANIFEST.md` as each image is added.
3. Run every fixture through the gate and the enhancement stages, dumping per-image metrics and a
   contact sheet to `images/out/`.
4. For each threshold, count how many fixtures it rejects and check every rejection is correct. A
   number only moves when a named image justifies it.
5. Log the verdict in `research/RESULTS.md` citing the image names, and update `ai/thresholds.json`.
6. Point `research/camera-thresholds/` at `images/` so the `_comment` in the JSON stops being a
   claim about an empty directory.

This is also where `docs/decisions.md` #1 gets closed. BiRefNet, rembg with the `u2netp` session,
and whatever else is worth a look all get benchmarked on the same `seg-v1` set, scored on the
fringed and low-contrast fixtures specifically, because those are the ones that decide the tier
distribution.

---

## 8. What I am building, in order

Each of these is mine unless marked. The dependency order is real — 1 and 2 are not mine and they
gate everything else.

| # | Work | Owner |
|---|---|---|
| 0 | Shoot and manifest the fixture set in `images/` | me |
| 1 | ~~**Persist upload chunks**~~ done — `web/api/storage.py`, `file://` urls under `STORAGE_DIR` | done |
| 2 | ~~**Link an upload to a product**~~ done — `POST /products/{id}/images` | done |
| 3 | ~~`pipeline.py` `gate()`~~ done — pure numpy, reads `thresholds.json`, refuses 291 of 498 degraded fixtures and 25 of 93 good ones. Framing deliberately excluded, `crop()` repairs it | done |
| 4 | `pipeline.py` `crop()` + `composite()` — pure math, no models; between them they defeat the two most common marketplace rejections | me |
| 5 | Recipe module + `render(original, mask, recipe)`; `recipe` and `mask_version` columns on `Product` | me + web (migration) |
| 6 | Benchmark segmentation on `seg-v1`, close `decisions.md` #1 | me |
| 7 | `segment()` + `matte()` — the real work | me |
| 8 | Confidence scoring + tiers A/B/C + contact shadow | me |
| 9 | `ai/service.py` `/enhance` (202 + job id) and `/enhance/{job_id}`, plus `ai/worker.py` | me |
| 10 | ~~`GET /enhance/{job_id}` proxy in `web/api`~~ done — ownership-checked proxy | done |
| 11 | White-reference tap: contract field, app tap, `white_balance()` patch path | app + me |
| 12 | pHash on ingest | me |

**Nothing in this list is allowed to break the degrade path.** `enhance.failed` reaching the artisan
with their own photo intact is the correct behaviour the day the AI box is unreachable in
production, and it is the common path in development today.

---

## 9. Open questions for the app/web side

1. ~~**Where do persisted chunks land in dev?**~~ **Answered and built.** `STORAGE_DIR`, default
   `web/api/.storage/`, and `complete()` returns a `file://` url that `ai/` can open directly.
   Object storage has since been built alongside it, in `web/api/objectstore.py` — `storage.py`
   assembles chunks on local disk, `objectstore.py` publishes them to S3. With no S3 configured
   the `file://` url stands and nothing else happens.
2. **Is the `white_ref` rect acceptable as an optional field on `POST /enhance`?** It changes
   `ai/contracts.md` and needs one tap on the review screen. Without it, white balance is gray-world
   forever and the colour lock will be answered "no" more often than it should be.
   **Still open — the app side has not answered this.**
3. ~~**Who makes the blur-demotion change in `gate.js`?**~~ **Done, by the app side.** Blur now
   runs below framing, but guarded by `frame.found` — a frame with no busy region anywhere is not
   the same fact as a product that is small in the frame, and it falls through to the blur rung
   instead. `gate.js:216` and `:229-233`; reasoning in `REPLY-FROM-WEB-APP.md` §2.
4. ~~**Can `Product` take a `recipe` JSON column and a `mask_version` string?**~~ **Yes, done.**
   `models.py:189` and `:194`, migration `c3a71f0d5e42`, chained off the baseline. Both additive
   and defaulted; `recipe` carries a `server_default` so a non-ORM writer cannot leave a NULL.
   The shape of `recipe` is still yours and stays documented in §4.
5. **Is the tier picker in scope for the app?** Three thumbnails, artisan taps one, never labelled
   A/B/C in the UI. If it is not in scope, the server picks by confidence and nobody is blocked —
   but the picker is what turns a wrong automatic choice into a two-second fix instead of a retake.
   **Still open — the app side has not answered this.**

**One open item that is not a question for anyone — it is unassigned work.**
`blur_laplacian_variance_reject_min: 20` is read by no code. The advisory/hard-reject split in
§6 is half real until some server-side path enforces it.
