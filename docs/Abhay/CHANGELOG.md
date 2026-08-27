# Image pipeline — change log

Newest first. One entry per working session, written for whoever else is in this repo.
Anything here that needs something from the app or web side says so explicitly and
repeats in `PIPELINE-RECONCILIATION.md` §9.

---

## 2026-08-28 (8) — your branch is merged; all four app/web requests are in *(from the app/web side)*

`origin/abhay/image-thresholds` is merged into `main`. Everything the 2026-08-27 entry asked
of the app or web side is done. Point-by-point detail, with the reasoning and the one place we
did **not** follow the request literally, is in **`REPLY-FROM-WEB-APP.md`** — read that one, it
is the reply to this entry.

| You asked for | State |
|---|---|
| Reorder the exposure rung (mean-low → mean-high → blown → crushed) | Done, `gate.js:197-200`, your fixture is now an assertion |
| Demote blur below framing | Done **with one added condition** — `frame.found` guards it. See reply §2 |
| Check whether `stripExif` rotates photos sideways | Removed the question instead of testing it: `imageOrientation: 'from-image'`, `upload.js:76` |
| `recipe` JSON + `mask_version` on `Product` | Done, migration `c3a71f0d5e42`, chained off the baseline |

**Two `storage.py` files existed** — yours (chunk assembly, stdlib-only) and ours (S3). Yours
keeps the name; ours became `web/api/objectstore.py`. `test_uploads.py` is untouched and passes.

**§5.1 is unblocked including the part we had broken.** `complete()` used to answer 503 with no
S3 configured, which would have blocked you again on a dev box. It now always sets the local
`file://` url and publishes only if there is somewhere to publish to.

### What is still open, and whose it is

1. **`blur_laplacian_variance_reject_min: 20` is enforced nowhere.** *(unassigned)* The key
   exists, the number is calibrated against 166 blurred fixtures, and no server-side code reads
   it. The advisory/hard-reject split you documented is currently half real — the capture gate
   advises, nothing rejects. Ours or yours, but it should not stay in this state.
2. **§9.2 — `white_ref` rect on `POST /enhance`.** *(ours, unanswered)* Still not answered by
   the app side. Until it is, white balance is gray-world forever.
3. **§9.5 — is the tier picker in scope for the app?** *(ours, unanswered)* Nobody is blocked
   either way; the server can pick by confidence. Still owed you an answer.
4. **`ai/thresholds.json` is now bundled into the app as a build-time floor**
   (`app/src/api/client.js:185`). That is the intended one-file-two-readers design — flagged so
   you know the app's behaviour changed the moment your branch landed, not the next time
   somebody fetches thresholds at runtime.

---

## 2026-08-27 (7) — the thresholds are calibrated; four numbers moved, one was badly wrong

The last session died part-way through generating the fixture set, and the machine ran out
of memory doing it. Both halves are fixed below: the run is finished and the tools no longer
need a gigabyte to look at a photograph. On the completed set — **93 real photographs and
498 degraded copies with known ground truth** — `ai/thresholds.json` stops being a guess.
It also stops claiming a calibration that never happened. Full verdict, with the fixture
names, in `research/RESULTS.md`.

**`ai/thresholds.json` — four changes**

| Threshold | Was | Now | Why |
|---|---|---|---|
| `fill_fraction_max` | 0.90 | 1.00, i.e. off | It refused **44 of the 93 good photographs** as "too close" |
| `fill_fraction_min` | 0.40 | 0.25 | All 83 too-far fixtures sit at 0.11; 0.25 keeps every catch and frees 5 good photos |
| `crushed_pixel_fraction_max` | 0.05 | 0.08 | Frees 3 good photos, loses none of the 83 underexposed fixtures |
| `blur_laplacian_variance_reject_min` | — | 20, new key | The server's hard reject, split from the capture advisory |

Over the same 591 images: good photographs refused by the capture gate fall from **65/93 to
21/93**, and degraded fixtures given the *wrong* spoken instruction fall from **200/498 to
79/498**. The gate got much more permissive and more accurate about what it does refuse, at
the same time.

`fill_fraction_max` was the worst number in the project and the mistake is easy to repeat:
the metric it gates is the area of the busy box, and a busy box spanning the frame is not a
photo taken too close — it is what a product photograph looks like. It tripped on 9 of 9
patterned backgrounds and 15 of 18 fringed textiles. It was also swallowing the real verdict,
so the gate said the wrong thing about the bad photos too: off-centre fixtures correctly
announced as off-centre went from 48/83 to 71/83 once it was off. The artisan may not read.
The spoken instruction is all they get, so a wrong one is close to no gate at all.

**The blur split is now proven on 166 blurred fixtures.** At 240×180 the Laplacian flags 23
of 166 while refusing 2 good photographs; at full resolution it flags 152 of 166 but refuses
24 of the 93. So the capture gate cannot hard-block at any threshold and stays advisory, and
the server hard-blocks at 20 rather than 100. Above 20 the exchange rate is about one good
photograph refused per one extra blurred photo caught, and rule 3 in `CLAUDE.md` prices that:
a missed blur costs a prettier photo, a false reject costs the artisan the listing.

All 32 remaining misses are motion, never defocus — a horizontal smear leaves vertical edges
intact. Closing that needs a directional measure, not a lower threshold, and nothing in the
set argues for one yet.

**`brightness_mean_min` stays at 60, and 65 was deliberately not taken** even though it looks
free on this set (three more catches, no extra false rejects). Stricter is the direction that
locks an artisan out, and the set cannot see the failure it would cause: every dark fixture
here is a synthetic exposure change on a well-lit original, with clean shadows where a real
indoor capture has read noise. `brass-diya-specular-02.jpg` — mean 58, *zero* crushed pixels
— is already refused as too dark. This one needs a phone in a courtyard in the evening.

**Two message bugs in `app/src/camera/gate.js`** — new requests, both small, both yours.

1. `gate.js:186` runs the crushed-shadow check before the two too-bright checks, so
   `pottery-earthen-sharp-01.png` — mean 173, 50.6% blown highlights — is announced as
   `photo.too_dark`. The artisan adds light to an already blown-out frame. Order should be
   mean-low, mean-high, blown, crushed.
2. The blur rung sits above framing, so at full resolution a too-far photo is announced as
   blurry. Much less visible since the framing fix, but the ordering is still the cause.

Neither is a wrong verdict — the photo is correctly refused. It is the instruction that is
wrong, which on this app is the part that matters.

**One thing to check on a real phone — `stripExif` may be rotating photos sideways.**

Not confirmed, and I cannot confirm it without a device. But it is cheap to check and
expensive to find later, so it is written down here rather than left in my head.

A phone's camera sensor is fixed in the body sideways. When someone holds the phone upright
to photograph a tall matka, the sensor still records a sideways picture — and rather than
rotate the pixels, the phone saves them as they are and attaches a small note to the file
saying "turn this 90 degrees before showing it". Every photo app reads that note, which is
why nobody ever notices.

`stripExif` (`app/src/api/upload.js:27`) removes every one of those notes, which is exactly
what we want it to do, because one of them is the artisan's GPS location. It works by
redrawing the photo onto a canvas and re-encoding it, so nothing hidden survives. The
question is whether the rotation happens *before* the note is thrown away. If it does not,
the note is gone and the sideways pixels are all that is left — permanently, with nothing
downstream able to recover the right way up.

The behaviour depends on how the WebView handles `createImageBitmap`. Some browsers apply
the rotation automatically, some do not, and Android WebViews are not consistent about it.

**How to check, about two minutes:** photograph something in portrait on a real phone, put
it through the app, and look at the uploaded result. Upright means there is nothing to fix.
On its side means the fix is to rotate the pixels first and strip the notes second.

**Why it matters on my side of the line.** The capture gate does not care — I checked all
four of its measurements against a rotated image today and every one gives the same answer
either way, because they are averages, a symmetric blur kernel, and a box area. But `crop()`
and `composite()` (steps 3 and 4 of my list) care a great deal. They cut the product out and
place it on a clean white background, so a sideways input produces a neatly cropped,
well-lit product lying on its side — worse than the photograph the artisan took, and it is
the version that reaches the listing. I would rather know before I build those two than
after.

**The interrupted run, finished.** `degrade.py` had written 128 of 498 fixtures and stopped
mid-file: `pottery-darkclay-bad-motion-03.jpg` was left truncated, every textile source had
nothing, and **not one of the 128 had a manifest row** — the script buffered every row in
memory and appended them in a single write at the end, which is exactly the point a crash
never reaches. Rows are now written and flushed per fixture, and `--fill-gaps` makes only
what is missing or unreadable and backfills manifest rows for what is already on disk. The
naming is deterministic (the nth source with a given base always produces `-nn`), which is
what lets it tell a fixture that was never made from one that was. The set is now 591 images
with 498 manifest rows, complete and self-describing.

**Why it ran out of memory, and what changed.** Both tools built float64 arrays of whole
images. `degrade.py`'s `motion()` was the worst: four full-image float64 copies plus a
temporary per shift, **2673MB** on the 22MP fixtures in this set, on a 7.6GB machine with no
swap. `check.py`'s full-resolution pass was a second offender at 962MB.

| | Before | After |
|---|---|---|
| `degrade.py`, largest source | 2673MB | **373MB** |
| `check.py`, largest fixture | 962MB | **328MB** |
| whole 591-image measuring run | — | 405MB, 80s |
| whole 371-fixture generation run | — | 400MB, 108s |

Laplacian variance and the exposure histogram are both reductions, so they are accumulated
over 256-row bands; the motion smear is horizontal, so rows are independent and it bands the
same way; and the two exposure changes are pointwise functions of one stored byte, so they
are now a 256-entry lookup table instead of a float64 array the size of the image. Peak
memory is flat in the image size rather than growing with it.

**All of it verified bit-identical to the old implementations** — `motion`, `underexposed`
and `overexposed` produce byte-for-byte the same pixels on real fixtures and on synthetic
images sized around the band boundary; `check.py`'s metrics match to within float rounding
(worst relative deviation 1.3e-15). The 240×180 gate path in `check.py` is untouched: it has
to mirror `gate.js` exactly and it costs nothing.

**`images/check.py`** also now writes `images/out/metrics.csv`, one row per image, flushed as
it goes, and `--resume` picks up from it. Measuring is the only slow part and no argument
about a threshold is settled in one pass, so the numbers are written down rather than
recomputed — and an interrupted run costs only the images it had left.

**`images/calibrate.py` — new.** Scores that CSV against `ai/thresholds.json` and answers the
only question that moves a number: how many images does it get wrong, and in which direction.
Ground truth from the filename. It reports two verdicts per image, capture and server,
because the two gates see different pixels — and it counts a right-verdict-wrong-message
reject as a failure, since that is what the artisan actually hears. `--sweep` prints the
curve behind each threshold. Instant, no decoding.

`find_problem()` in `check.py` gained one optional argument, `blur_key`, the only place the
two gates differ. The default keeps it an exact mirror of `gate.js`.

**Not touched.** No file in `app/` or `web/` was modified. `ai/thresholds.json` is the only
thing outside `docs/Abhay/`, `images/` and `research/` that changed — the app reads it at
runtime, so the new numbers reach the camera gate with no app release, and `gate.js`'s 19
self-test assertions use their own literal threshold object and are unaffected.

## 2026-08-27 (6) — two tools for collecting fixtures, and the first real threshold evidence

**`images/fetch.py` — new.** Pulls openly-licensed fixtures from the Openverse API
(Wikimedia Commons, Flickr, museum collections) with the licence and creator captured per
image and a manifest row appended automatically. Filters on real decoded dimensions rather
than the metadata, deduplicates by SHA against everything already in `raw/`, and names files
with the condition token `check.py` reads. Six presets for the subjects that actually decide
something: fringe, specular, darkfloor, patterned, sharp, indoor.

Openverse rather than Google Images for three reasons: Google has no API and forbids
scraping, it serves thumbnails — which is exactly how the first batch ended up 14/16 under
1000px — and it returns no licence, which leaves the consent column in `MANIFEST.md`
permanently blank.

**`images/degrade.py` — new.** Makes the `bad` fixtures, because **they cannot be
scraped at all.** The web is a filter that has already removed every blurry, dark and
badly-framed photograph: nobody uploads their failures. Six degradations — motion smear,
defocus, under/overexposure, off-centre, too-far — applied to clean fixtures with the
parameters recorded, so the ground truth is known rather than guessed. Exposure changes are
done in linear light, not on the stored sRGB bytes, or the histogram the gate reads would be
wrong in the direction that matters.

Stated in the file and worth repeating: these are valid for calibrating the gate, whose four
metrics are all luma statistics, and **not** valid for tuning `denoise_sharpen()`, because a
synthetically darkened image has clean shadows where a real underexposed capture has read
noise. That part of `gate-v1` still needs a phone.

**First real evidence, logged in `research/RESULTS.md`:** the capture gate cannot see motion
blur. A 24px smear on a 1600px fixture scores 365 at the gate's 240×180 (passes, threshold
100) and 46 at full resolution (rejected). The downscale removes the very defect being
measured. So the capture-side blur check fails in *both* directions — false-rejects plain
weave, false-accepts hand shake — which is a stronger argument for the split in
`PIPELINE-RECONCILIATION.md` §5.3 than the one made there.

Two bugs in `degrade.py` found by its own output and fixed: the motion fixture was cropping
its source under `resolution_min_px` (now edge-pads instead), and the off-centre fixture was
sliding a full-bleed image, which just crops it and leaves the busy box spanning the frame —
it now shrinks the subject so there is a background for it to be off-centre within.

---

## 2026-08-27 (5) — first fixture batch reviewed: 16 images, not yet usable

Sixteen web-sourced images landed in `images/raw`. Reviewed with `check.py` and by eye
(contact sheet at `images/out/contact_sheet.jpg`). **Verdict: not usable for threshold
calibration, partly usable for segmentation once it grows.** Detail:

- **14 of 16 are below `resolution_min_px` (1000px)**, several under 450px. The server gate
  drops those on sight, and BiRefNet at 1024×1024 would be upscaling to invent the very
  edges we would be judging it on. Only one image clears the floor and is a real photograph.
- **Almost all are finished e-commerce product shots** — studio backdrops, bokeh
  backgrounds, one already cut onto pure white. These are what the pipeline is meant to
  *produce*. They cannot test what it consumes.
- One byte-identical duplicate pair, one phone-advertisement screenshot with UI furniture
  and a watermark still in it.
- Filenames are UUIDs, so the condition tokens the coverage report keys off are absent, and
  none of the eight required conditions is provably present.

Added to `check.py` as a result, so the next batch is triaged in one command:
`backdrop()` (four-corner flatness, the same sampling `composite()` is specified to use on
its own output) flags an image that is already a product shot; a SHA pass flags
byte-identical duplicates.

**The split now matters and is worth restating:** `seg-v1` can be scraped, but needs ≥1000px
on the short edge and a real background still attached. `gate-v1` cannot be scraped at all —
it measures what a phone sensor produced in a courtyard, and every web image has already
been cropped, edited and re-compressed. That set needs real captures off a mid-range
Android.

---

## 2026-08-27 (4) — `images/check.py`, so "is this set any good" has an answer

**`images/check.py` — new.** Scores every fixture in `images/raw` against
`ai/thresholds.json` and prints one row per image: resolution, blur at full resolution and
at the gate's 240×180, exposure mean, blown and crushed fractions, fill fraction, and the
verdict the camera gate would reach. Then a set-coverage report keyed off the filename
condition token, naming which of the eight required conditions the set is still missing.

The metrics mirror `app/src/camera/gate.js` exactly — same Rec.601 luma, same Laplacian
kernel, same 12×9 grid, same busiest-cell-relative cutoff — so a number printed here is the
number the phone computes. Verified against the same synthetic frames `gate.js`'s own
self-test uses: dark, blown, flat, too-far and good all reach the same verdict through both
implementations. Divergence between the two is a bug, not a variant.

numpy and Pillow only, no OpenCV, so it runs before anyone has set up an environment.

```bash
python3 images/check.py             # table + coverage
python3 images/check.py --verbose   # full-res exposure, box position, file size
```

**Worth stating for whoever reads this later:** internet-sourced photographs can calibrate
the *segmentation* set (`seg-v1`) but not the *gate* set (`gate-v1`). The gate measures what
a cheap phone sensor produced in a courtyard; a web listing image has already been edited,
cropped, re-compressed and often shot in a studio, so it cannot tell us whether
`brightness_mean_min` locks out an artisan working indoors. `gate-v1` needs real captures
off a real mid-range phone. Note also that `pHash` (spec §12) exists specifically to catch
web-sourced photographs, so they must never leak into anything that looks like product data.

---

## 2026-08-27 (3) — repo now explains itself to a fresh session

**`CLAUDE.md` at the repo root — new.** There was none. Claude Code (and any other agent
tooling) reads this file automatically at the start of every session; without it the
architecture had to be re-explained each time, and the most likely place a new session
would look was `CLAUDE_CODE_PLAYBOOK_WEB.md` §0.1 — whose draft describes the *withdrawn*
device-side approach. That was a trap and it is now closed: the new file says explicitly
that it replaces that draft.

Contents: the folder/owner map, a pointer to `PIPELINE-RECONCILIATION.md` as required
reading before any image work, the settled architecture in three lines, the six
non-negotiable rules, the rejected-approaches table, the three test commands, and a note
that `enhance.failed` is the common path in development rather than a bug.

Kept deliberately short. It is loaded into context on every single session, so length here
is a recurring cost.

---

## 2026-08-27 (2) — unblocked the enhance path: uploads persist, and the poll route exists

This session touched `web/api/` and two lines of `app/`. Findings 1 and 4 from the entry
below are closed; everything they were blocking can now be built and tested.

**`web/api/storage.py` — new, ~50 lines, stdlib only**

Where uploaded bytes live. `parts_dir()`, `final_path()`, `assemble()`. Deliberately free
of FastAPI, SQLAlchemy and settings imports so the assembly logic can be tested with
nothing installed. Moving to S3 is a change to this file and nothing else — no caller
anywhere reads a path, only the url `complete()` hands back.

**`web/api/routers/uploads.py` — chunks are now written to disk**

`put_chunk` was doing `await chunk.read()` and dropping the bytes. It now writes one
zero-padded file per index under `STORAGE_DIR/parts/{upload_id}/`, and `complete()`
concatenates them in index order into `STORAGE_DIR/raw/{upload_id}.jpg` and returns a real
`file://` url. Also:

- **Idempotent `complete()`.** The app retries it after a dropped response, and by then the
  parts are gone. It returns the url it already has rather than a 409.
- **Assembly refuses rather than truncating.** A missing part, or a total that does not
  match the `size` the client declared at `start()`, deletes the half-written file and
  returns 409. This matters more than it looks: a truncated JPEG reaching `ai/` fails the
  quality gate for the wrong reason, and the artisan is told their photograph was bad when
  it was not.
- **Per-chunk size cap** (2× the 256KB contract chunk). `size` is validated once in
  `start()`; without this a client that lies about it writes to disk without limit.
- `start()` now also rejects a nonsense chunk count.

**`web/api/routers/products.py` — the upload can be linked to a product**

New `POST /products/{id}/images` with `{url, size_variant, is_primary}`. Writes the
`ProductImage` row with `size_variant = "raw"` that `enhance()` looks for. Two things worth
keeping if this is ever refactored:

- 🔒 **The url is checked against an `Upload` row owned by the caller.** It is a filesystem
  URI that the AI service will later open, so an unvalidated string here is an
  arbitrary-file-read with extra steps.
- Re-posting the same url is a no-op returning the existing row, because the app retries.
  Two raw rows would give `enhance()` a coin flip over which image it sends.

**`web/api/routers/products.py` — `GET /api/enhance/{job_id}` now exists**

The app has always polled this and always got a 404. It proxies to the AI service.
🔒 The job id alone is not authorisation, so `Product.enhance_job_id` (new nullable column)
records which product a job belongs to and the route checks the caller owns it — otherwise
one artisan could poll another's job and read back their image urls. **This needs a
migration on any shared database;** `create_all` will not add the column to an existing one.

**`web/api/test_uploads.py` — new**

Six assertions over `assemble()`: out-of-order chunks land in index order, a missing part
produces no file, a size mismatch produces no file, single-chunk works, the extension
follows the content type, and the returned url actually opens back to the same bytes. Runs
as `cd web/api && python3 test_uploads.py`. No database, no token, no server, no
dependencies — same spirit as `node app/src/camera/gate.js`. Verified passing.

**`app/` — two edits, both small**

- `CaptureReview.jsx` now calls `POST /products/{id}/images` before `POST /enhance`, inside
  the same inner try, so a failure to link degrades to "no enhancement" rather than costing
  the artisan the listing. Removed the comment saying no such endpoint exists.
- `CatalogPrefill.jsx` — corrected the comment that said web/api does not proxy the poll.

**Also**

- `config.py` gains `storage_dir`, anchored to the file rather than the working directory,
  defaulting to `web/api/.storage`. Added to `.env.example` and `.gitignore` — assembled
  uploads are real artisan photographs and belong in neither git nor a shared bucket by
  accident.
- `ai/contracts.md` — `image_url` is a `file://` URI today, not `s3://`. Whoever implements
  `/enhance` should open it with something that handles both schemes.
- `web/README.md` — storage paragraph and the test command.

**Not done, still needs the app side:** the `white_ref` rect (finding 2) and the blur
demotion in `gate.js` (finding 3). Both are unchanged requests.

---

## 2026-08-27 — reconciled the two pipeline designs; added the calibration set

**Added**

- `docs/Abhay/PIPELINE-RECONCILIATION.md` — decides between `IMAGE_PIPELINE_SPEC_WEB.md`
  (written before this repo existed, assumes on-device processing) and the architecture
  actually in the code. **Read it before either of the other two documents in this folder.**
- `images/` at the repository root — the calibration fixture set. `README.md` says what
  belongs in it, `MANIFEST.md` is the committed packing list, `raw/` and `out/` are
  gitignored the same way `research/data/` is.
- `.gitignore` — two lines for `images/raw/*` and `images/out/*`, keeping the directories
  tracked via `.gitkeep`.
- Banner at the top of both existing files in this folder pointing at the reconciliation,
  so a stale section is not read as current.

**Decided**

- The repository's architecture wins: capture coaching stays on the device exactly as
  built, all enhancement runs server-side in `ai/enhance/`, online-first stands.
- My spec's image science moves server-side rather than being dropped: the recipe model,
  mask confidence scoring, tiers A/B/C, contact shadow, CLAHE on L only, the hard limits
  on saturation and sharpening, multi-step downscale, and pHash.
- Withdrawn from my spec: OpenCV.js and ONNX Runtime Web in the WebView, U²-Netp on
  device, the `camera-preview` plugin swap, offline-first with a local database, and the
  400ms/1200ms progressive-reveal timings.
- SAM 2 tap-to-refine (`ai/enhance/pipeline.py:23`) is out of MVP scope. BiRefNet plus
  alpha matting, with the tier picker and erase/restore brush as the human fallback.

**Found** (detail and line references in the reconciliation, §5)

1. Enhancement cannot run at all today, and the block is upstream of `ai/`: upload chunks
   are discarded (`web/api/routers/uploads.py:76`) and no endpoint links an upload to a
   product, so `POST /products/{id}/enhance` answers `400 "no raw image"`.
2. The white-reference prompt is spoken (`app/src/screens/Camera.jsx:56-59`) but nothing
   captures the paper's position, so `white_balance()` can only ever do gray-world — the
   method most likely to pull a natural dye off-colour and get the colour lock answered "no".
3. Blur hard-blocks the shutter while three separate comments say it must be a suggestion.
   My call: advisory at capture, hard reject only server-side at full resolution, as two
   separate thresholds.
4. `GET /enhance/{job_id}` has no route in `web/api`; the app polls it and gets a 404.
5. `ai/enhance/pipeline.py` describes only the pure-white Tier A case — there is no path
   for a mask that is not good enough to cut out.
6. `ai/thresholds.json` claims a calibration in `research/camera-thresholds/` that has not
   happened; the directory is empty. Every threshold in the project is a guess today.
7. My own acceptance criteria (spec §18.1–2, the 3-second and 400ms targets) are not
   achievable on this architecture and are rewritten in the reconciliation.

**Asked for** — see `PIPELINE-RECONCILIATION.md` §9

- Persisted upload chunks at a path `ai/` can read, and an upload-to-product link.
- An optional `white_ref` rect on `POST /enhance` (changes `ai/contracts.md`).
- A `recipe` JSON column and `mask_version` on `Product`.
- A decision on who demotes the blur block in `app/src/camera/gate.js`.

**Not touched.** No file in `app/`, `web/` or `ai/` was modified this session — only
`docs/Abhay/`, the new `images/`, and two lines of `.gitignore`.
