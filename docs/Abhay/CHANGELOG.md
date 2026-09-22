# Image pipeline — change log

Newest first. One entry per working session, written for whoever else is in this repo.
Anything here that needs something from the app or web side says so explicitly and
repeats in `PIPELINE-RECONCILIATION.md` §9.

---

## 2026-09-07 (4) — both of your open web-side requests are answered *(from the app/web side)*

`origin/abhay/recipe-system` is merged. Tone, white balance and the observation log are in.
The two things entries (2) and (3) asked the web side for:

| You asked for | State |
|---|---|
| `white_ref` on `POST /enhance` | **Web hop only.** `POST /api/products/{id}/enhance` takes an optional `white_ref` and forwards it in the contract shape. Bounds-checked here, not trusted. The **tap is not built** — see below |
| "this upload was a retry of that one" | **Done.** `products.retry_of`, migration `a1b6d3e40f92`, self-referential and indexed. Set by the app only when the *server gate* refused the previous shot |

**Why the tap is not built, and it is a decision rather than a backlog item.** The pipe is
open, so building it later is a UI change and nothing else. What stopped it is that the
reference-free path is what every artisan gets today and it is not obviously the loser: your
own table says 1.3 was chosen partly because 1.6 made 30 of 172 mild-cast fixtures worse, and
the ground truth behind all of it is synthetic. A tap needs a spoken instruction in five
languages telling an artisan to hold up printer paper, and we would be asking for that on the
strength of a measurement `images/MANIFEST.md` says has not been taken. **Shoot `wb-v1`** —
same object, with and without the paper — and the tap follows the week the numbers do.

**`retry_of` is narrower than "a retake" on purpose.** Only a gate refusal sets it. A
voluntary retake of a photograph we accepted proves nothing about the thresholds and would
dilute exactly the signal you asked for. Write-once by construction: it is on the create
model and not on `ProductIn`, which `PATCH` shares, so nothing can restate it afterwards.

**One bug found while wiring it.** After a gate refusal the primary button relabelled itself
`common.retry` and re-ran the upload with the same bytes, at a gate that is deterministic —
identical refusal, another abandoned product row, another multi-megabyte upload over a rural
tower, forever. The button is gone on a refusal now; retake is the only thing on screen that
can succeed. It would also have poisoned `retry_of` with chains whose "retake" was the same
photograph.

Checks: `web/api/test_white_ref.py` and `web/api/test_retry_chain.py`, both listed in
`CONTRIBUTING.md`. Neither needs a server, a database or the AI service.

---

## 2026-08-27 (8) — the server gate is built; step 3 of the list is done

First working stage in `ai/enhance/`. `gate()` decides whether a photograph is worth
spending a GPU on, and it decides it on the numbers calibrated in entry (7) rather than on
guesses.

**`ai/enhance/pipeline.py` `gate()`** — returns `None` when the photo is worth processing,
or the rejection body from `contracts.md`, `{"reason", "message_key"}`, which `service.py`
returns under `{"status": "rejected"}`. Six refusals: resolution, mean too low, mean too
high, blown highlights, crushed shadows, blur. Pure numpy and Pillow — no model, no GPU,
211ms and 391MB on a 22MP photograph.

**It does not check framing, on purpose.** Too far, too close and off-centre are all
repairable, and `crop()` is the thing that repairs them — refusing them here would throw
away a listing the pipeline was built to rescue. Framing is coached on the phone where the
artisan can still act on it, and fixed on the server. Only what cannot be repaired is
refused: pixels that were never captured, detail that is not there, and clipped values that
hold no information at all.

**The check order deliberately differs from `gate.js`.** The mean settles dark-or-bright
first and the clipping tests follow, so a 50%-blown photograph is never announced as "too
dark" — which is bug 1 in entry (7), still open on the app side. There is a test named after
it. I did not want to build the same mistake into the server while the request to fix it on
the phone is outstanding.

**Blur reads `blur_laplacian_variance_reject_min`, not the capture advisory.** That key is
now in a third `_enhance_only` section of `thresholds.json`, as reconciliation §6 proposed,
though at 20 rather than the 30 that section guessed — 30 costs six more good photographs
for four more blurred ones, and rule 3 prices that trade the other way.

**`ai/enhance/metrics.py` — new, and the reason it exists matters.** The luma, Laplacian and
exposure measurements now live in one module that both the server gate and `images/check.py`
import. They were briefly duplicated, which would have quietly turned entry (7)'s
calibration into evidence for nothing: every threshold in `thresholds.json` was set using
these exact functions, so a second copy that drifted by a rounding rule would mean the gate
no longer does what the fixtures say it does. Same argument as the one thresholds file.
`check.py` keeps the half that describes the phone — the 12×9 framing grid and the `gate.js`
verdict ladder — because that half is a mirror of someone else's code, not shared logic.

The module carries the banded, bounded-memory implementations from entry (7). That matters
more here than it did there: this runs on a worker box sized for model inference, where a
gigabyte spent looking at a photograph is a gigabyte not available to BiRefNet.

**`ai/test_gate.py` — new, 10 assertions, runs on plain `python3` with no venv and no
fixtures.** Same spirit as `node app/src/camera/gate.js` and `web/api/test_uploads.py`.
Synthetic images with a known defect, asserting the gate refuses each one *for the right
reason* — a correct refusal with the wrong spoken message is still a failure, because the
message is what the artisan acts on. It also asserts that framing is never a reason to
refuse, and that the two blur numbers have not been collapsed into one.

The last test replays the whole calibration set and asserts the counts recorded in
`research/RESULTS.md`: **25 of 93 good photographs refused, 291 of 498 degraded fixtures
caught.** If either moves, the gate has stopped agreeing with the evidence its thresholds
were set on, or a threshold moved without the RESULTS row that is supposed to accompany it.
It skips itself when the fixture pixels are not on the machine, since they are gitignored.

Verified separately against 50 real fixtures through `gate()` itself rather than through the
recorded measurements — all 50 agree.

**Where the numbers differ from what entry (7) implied.** I quoted 450 of 498 for the server
gate there. That figure included framing, which this stage does not check; the correct number
for the gate as specified is 291, and the difference is 159 off-centre and too-far fixtures
that now pass through to `crop()` as they should. The count of good photographs refused is
unchanged at 25.

**Also updated:** `CONTRIBUTING.md`'s "Current state" no longer says everything in `ai/` is
`NotImplementedError`, and its testing block lists the two new commands. Reconciliation §8
marks step 3 done.

**Not touched.** No file in `app/` or `web/`. Nothing calls `gate()` in production yet —
`/enhance` is still a stub, and it is step 9.

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
photograph refused per one extra blurred photo caught, and rule 3 in `CONTRIBUTING.md` prices that:
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

**`CONTRIBUTING.md` at the repo root — new.** There was none. Claude Code (and any other agent
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

---

## 2026-08-28 — Segmentation model chosen: BiRefNet (decision #1 closed)

**Decided**

`docs/decisions.md` #1 is closed. We use **BiRefNet** (`ZhengPeng7/BiRefNet`, MIT licence,
self-hosted, run at 1024×1024). Measured on the dev machine's RTX 2050: 1615 MiB peak VRAM,
~645 ms per image. BiRefNet-lite is held in reserve as a drop-in swap if GPU memory ever
becomes the binding constraint. Both revisions are pinned in `research/segmentation/RESULTS.md`
— these repos ship `trust_remote_code`, so tracking `main` would let upstream change our
pipeline silently.

Five models over 41 fixtures, chosen by eye from contact sheets with metrics as support.
Rejected: `isnet-general-use` (48 holes per image), `u2net` (weakest on fringe), and
**RMBG-2.0**, which never ran — its repo is gated behind a Hugging Face account approval, and
its CC BY-NC 4.0 licence means a good score could not have changed the outcome. Worth knowing,
since it is the model most commonly recommended for this task online. InSPyReNet was a close
second and lost mainly on memory (2924 MiB of a 4GB card).

**Three findings that change steps 7 and 8**

1. **Fringe is largely solved by the model itself.** The four museum tassels were in the set to
   force the question of whether we need a separate alpha-matting stage. BiRefNet followed
   individual threads including stray wisps. On this evidence the separate matting stage in the
   spec may be unnecessary — worth proving before building it.
2. **Pale-on-pale is the real failure, not dark-on-dark.** `1816d85d` (near-black pot, near-black
   ground) was picked as the hardest image and came out clean. `textile-shawl-fringe-03` (cream
   linen on white) lost the entire cloth, keeping only a few fringe threads. An artisan shooting
   white cotton on a white sheet is not a rare event.
3. **The model never signals doubt.** On frames with no single product, it returns a confident
   outline around an arbitrary region rather than an empty or low-confidence mask. Two full-frame
   textile close-ups drove it to 0.017 and 0.042 consensus IoU. **Step 8 cannot ask the model how
   sure it is** — confidence has to be derived from the mask's own geometry.

**Also found**

- **Five fixtures are mislabelled.** `textile-zari-specular-01..04` are a guitarist, a drummer, a
  man in a branded jacket and a runner at an athletics meet; `textile-dupatta-fringe-04` is a
  photograph of mountains. Harmless to the threshold calibration, which only ever read luma
  statistics and never needed the subject to match the name. They would have corrupted this
  benchmark. Excluded, and recorded in `images/MANIFEST.md`.
- **Roughly half the 93 originals cannot be used for segmentation** — book plates, engravings,
  flat full-frame fabric with no background, documentary shots of weavers. Not a defect: the set
  was built to measure light and blur, where content is irrelevant.
- Two metrics I introduced turned out to be misleading and are documented as such in RESULTS.md.
  Soft-edge fraction *inversely* tracked fringe quality — BiRefNet has the lowest and the best
  edges; what the metric rewards is a smeared boundary. Hole count is meaningless inside the
  fringe group, where gaps between threads are correct.

**Environment** — `ai/.venv` now exists (gitignored) with torch 2.11.0+cu128. The NVIDIA
driver was installed and the machine rebooted, so the RTX 2050 is usable; the walkthrough's
"the development machine has no graphics card" note is corrected. Note `python3.10-venv` is not
installed system-wide, so the venv was bootstrapped via `get-pip.py`. **`ai/requirements.txt`
is unchanged** — it still describes the CPU service, and the benchmark's dependencies
(transformers, timm, rembg, transparent-background) are deliberately not in it until step 7
decides what the service actually imports.

**New files** — all under `research/segmentation/`: `seg-v1.txt` (the set), `seg-v1.md` (why
those 41), `bench.py`, `consolidate.py`, `sheets.py`, `RESULTS.md`, and `out/` with every
cut-out and six contact sheets. `out/` is large and binary; it should be gitignored the same
way `images/out/` is, which I have **not** done — say the word and I will.

**Not touched.** No file in `app/`, `web/` or `ai/` was modified. `ai/.venv/` was created and
one line added to `.gitignore`.

### Same day, follow-up — the upscale question, answered

The one measurement step 6 could not make. `research/segmentation/upscale_test.py`, results
appended to `research/segmentation/RESULTS.md`.

BiRefNet infers at 1024² regardless of input, so its mask is stretched to fit the photo. At
full sensor resolution (3.6–5.6×) the outline stays correct — IoU ~0.99 — but fine detail
dissolves: the edge band grows from ~2px to 7–13px, and at 100% a wire-thin nose ring becomes
a blob. **At the 2000px master the spec already mandates (`IMAGE_PIPELINE_SPEC_WEB.md:230`),
the stretch is 1.95× and the band is 3–4px** — near-indistinguishable from the detail ceiling.

Two consequences:

- **Step 7 does not need a separate matting stage**, provided segmentation runs on the 2000px
  master and not the raw upload. The tassel result from the benchmark holds, because those
  fixtures were already in the ~1.9× regime.
- **The spec's downscale-first rule is load-bearing for mask quality, not just speed.** It is
  justified on performance grounds in the spec. Anyone who later "optimises" by segmenting the
  full-resolution upload would get a slower pipeline and worse edges. Worth a comment in the
  code when step 7 is written.

If a channel ever needs images above ~2000px, this stops applying — re-run
`upscale_test.py --master <N>` before assuming otherwise.

---

## 2026-08-28 — Step 7 started: segmentation is implemented

`ai/enhance/pipeline.py` `segment()` and `matte()` are no longer `NotImplementedError`.
This is the first working model stage in `ai/`.

**New: `ai/enhance/segmenter.py`.** BiRefNet, pinned to the revision the benchmark measured.
Lazy singleton behind a lock, half precision on CUDA, automatic CPU fallback (~20× slower,
kept working on purpose — rule 3 says losing enhancement must never cost the listing).

Two constants in it are conclusions rather than settings, and both are commented as such:

- `REVISION` is pinned because BiRefNet ships `trust_remote_code` — the code that builds the
  network downloads with the weights. Tracking `main` would let upstream change our pipeline
  with no commit on our side, and it is remote code execution besides.
- `MASTER_LONG_EDGE = 2000` is not a speed setting. The model infers at 1024² whatever it is
  given and its mask is stretched to fit, so **the master's size is the edge quality**.
  Measured: 1.95× stretch at 2000px, 3.9× on a raw 12MP upload, where a wire-thin nose ring
  becomes a blob.

**`matte()` returns the mask unchanged, deliberately.** The spec assumed a trimap and alpha
matting stage; BiRefNet's output is already soft where the subject is soft, and at 2000px the
edge band sits 3–4px against a 1.5–2.8px ceiling. Documented as an evidence-backed no-op with
the three conditions that would bring it back, rather than deleted — output above ~2000px, a
model swap, or genuinely translucent goods (muslin, net, chanderi, glass), which `seg-v1`
contains no fixture for and which is therefore untested rather than disproven.

**Requirements are now split.** `ai/requirements.txt` stays small — `service.py` queues jobs
and needs no GPU stack. The new `ai/requirements-enhance.txt` is the worker's ~3GB of torch
and CUDA. `pipeline.py` imports nothing from it at module scope, which is what keeps
`python3 test_gate.py` runnable with no virtualenv; that property is load-bearing for the
gate's calibration staying checkable and there is a comment saying so in both files.

**Tests** — `ai/test_segment.py`, same two-half shape as `test_gate.py`. The geometry half
(7 assertions on the master downscale, including aspect-ratio preservation and never
upscaling) runs on plain `python3`. The model half skips without torch, and skips are
reported as SKIP rather than counted as passes. Whole suite: 24 passed under
`ai/.venv/bin/pytest`.

Verified end to end on real fixtures: 22MP → 1333×2000 master → alpha in 1204 ms on the
RTX 2050, 645 ms for the smaller ones.

**Still open in step 7** — nothing calls `segment()` in production yet. `service.py`
`/enhance` and `worker.py` are still stubs, and `crop()`, `composite()`, `white_balance()`,
`tone()` and `denoise_sharpen()` remain unimplemented. Step 8's tier system is where the
"model never signals doubt" finding gets handled.

**Not touched.** No file in `app/` or `web/` was modified. `CONTRIBUTING.md` gained one line in the
testing block; `ai/README.md` gained the requirements split and a segmentation note.

### Same day — `crop()` and `composite()` built

`ai/enhance/pipeline.py`. The pipeline now produces a finished 2000×2000 listing image from
a raw photograph: `segment → matte → composite → crop`. 42–177 ms for the two geometry
stages on top of segmentation's ~650 ms.

**`composite()`** lays the product on pure #FFFFFF and asserts the invariant on every call:
every fully transparent pixel comes out *exactly* 255, not approximately. Marketplaces sample
pixels and reject (252,252,252); the artisan would see a rejected listing with no explanation
they could act on.

I went looking for the colour-fringing artefact — a half-transparent edge pixel keeps some of
the original background's colour, so a product shot against something dark should leave a
dark rim on white. **It is not there.** On the two worst fixtures (`1816d85d`, a near-black
pot on a near-black ground, and `brass-bidri-specular-02`), rim pixels deviate from an ideal
blend by +2.3 and +37.3 — *toward* white, not away from it, where a dark halo would be
negative. At 4× zoom both silhouettes ramp cleanly. So foreground colour estimation is not
built, and the docstring records the measurement rather than the worry.

**`crop()`** squares the frame with the product at `crop_fill_target`. Two decisions worth
knowing:

- **The product box is found by alpha *mass*, not by `alpha > 0`.** A soft mask carries faint
  dust — one alpha-0.01 pixel in a corner — and a naive bounding box snaps to the frame edge
  and shrinks the product to a stamp. The box is the interval holding all but 0.1% of the
  mask's weight per axis. There is a test for exactly that speck.
- **`crop_plan()` is separate from `crop()`** and reports `upscale`. A product photographed
  from far away has a small square box, and reaching 2000px enlarges it — 4.07× on one
  fixture. Lanczos interpolates rather than inventing detail, so this is not the rule-1
  fabrication, but past ~2× the result is visibly soft and **the caller should turn it into a
  `warnings` entry** (the array already exists in `contracts.md`) instead of quietly shipping
  a mushy listing.

**`crop()` must run after `composite()`** — it pads with white where the square runs off the
photograph, which is only right once the background already is white. Said plainly in the
docstring, since the signatures do not enforce it.

**Thresholds** — added `crop_fill_target: 0.85` and `listing_canvas_px: 2000` under
`_enhance_only`. The reconciliation also proposed `crop_padding_pct: 8`; that is the same
number said backwards ((1 − 0.85) / 2 = 7.5%), so I did not add it. Two keys that can
disagree about one measurement is a bug waiting to happen. Neither number is calibrated
against fixtures — 0.85 is the marketplace requirement from spec §9.1, and the comment in the
JSON says so rather than implying evidence that does not exist.

**Tests** — `ai/test_segment.py` is now 20 assertions, still runnable with plain `python3`
(the model half skips). Whole suite 37 passed. One of the new tests caught a bug in itself
rather than in the code: PIL sizes are (w, h) and numpy shapes are (h, w), so my first
"mismatched alpha" case was accidentally a matching one. Worth knowing, because a transposed
mask composites a product against its own background and looks *almost* right.

**Still open** — `white_balance()`, `tone()`, `denoise_sharpen()`, `export()` and `run()`
remain stubs, and nothing calls any of this in production: `service.py /enhance` and
`worker.py` are still unimplemented.

---

## 2026-08-28 — Step 8: mask confidence and tiers A/B/C

`ai/enhance/pipeline.py` — `mask_signals()`, `mask_confidence()`, `tier()`, `apply_tier()`,
and a numpy connected-components (`_components`, run-length union-find, no OpenCV and no
scipy, because `test_gate.py` and the fixture tools run on a clean machine). ~13 ms per mask.

**Calibrated, not assumed.** `research/segmentation/tiers.py` scores the reconciliation's
proposed thresholds against the 41 masks BiRefNet produced on `seg-v1`, using seven masks I
labelled unshippable by eye from the contact sheets. Result: **catches 5 of 7, demotes 2 good
masks to tier B.** A grid search found nothing better on this set, so the values stand — now
measured. Full table in `RESULTS.md`.

**The gap is real and worth your attention.** `b4b717b2` — a frame-filling textile close-up —
scores a perfect 1.00 and goes to tier A. Its mask is 57% of the frame, one clean piece,
almost no undecided alpha: by every shape measure an excellent mask, and completely wrong. Its
twin `291e88c5` is caught only because its mask happened to land at 92% coverage.

This matters because filling the frame with cloth is *how people photograph cloth*, so it
lands hardest on textile artisans. I tried an edge-alignment signal for exactly this (a real
silhouette follows image gradients, an invented one cuts through flat colour) and **it does
not separate** — bad masks span 0.98–9.66, good ones 0.76–24.87, and the lowest score of all
belongs to a correct mask. Rejected, and written up so nobody repeats it.

**→ Request for the app side.** What would catch it is knowing there is no background in the
frame, and the capture gate already measures that as `fill_fraction` before the shutter. That
number does not currently reach the server. Sending it with the upload would likely close this
gap; it is a change in `app/` so it is a request, not something I have done.

**Two deliberate divergences from spec §6.3**, both argued in the docstrings and RESULTS.md:

- Tier B is **feathered-on-white**, not the spec's "soft studio gradient" — a gradient cannot
  be a marketplace primary (`contracts.md`, spec §9.1 both require #FFFFFF), so it would cause
  the rejection the tier exists to prevent.
- Tier C **removes nothing at all**, not the spec's "background blurred + dimmed". The spec
  asks for that blur two lines after promising C *"removes nothing, so it cannot damage the
  product"* — but blurring needs the mask, and C is exactly when the mask is not trustworthy.
  Blurring with a bad mask smears the product. The guarantee is worth more than the nicety.

**Non-obvious property, now documented and tested:** deductions are 0.4/0.3/0.3 from 1.0 and
tier B starts at 0.45, so a single anomaly only ever reaches B. **Tier C takes two independent
failures.** Deliberate — one odd measurement is usually an odd photograph, and refusing to
enhance on one signal costs more listings than it saves. Two tests found this before a user
would have.

**Thresholds** — the six `_tiers` keys are live in `thresholds.json` with the calibration
result in the comment.

**Tests** — `test_segment.py` is now 32 assertions, still plain-`python3` runnable. Suite: 49
passed. Two of the new tests initially failed on a real edge in my own code: blobs sized at
exactly the 1% speck cutoff, which is worth knowing since that cutoff is what stops a tassel's
shed pixels reading as fragmentation.

**Still open** — `white_balance()`, `tone()`, `denoise_sharpen()`, `export()`, `run()`, and
all of step 9. Nothing calls any of this in production yet.

---

## 2026-08-28 — Step 9: the image path is connected

`POST /enhance` and `GET /enhance/{job_id}` are real. **An artisan's photograph can now reach
the pipeline and come back as listing images.** Your side already had the calling half —
`web/api/routers/products.py` was calling `/enhance` and proxying the poll — so this was
entirely the missing half in `ai/`.

New: `ai/enhance/jobs.py` (job table), `ai/enhance/storage.py` (source and output I/O), plus
`pipeline.run()` and `pipeline.export()`. `service.py` wires them. Verified end to end
against the running app: 202 + job id, poll to done, 2000×2000 amazon + 1000×1000 whatsapp
JPEGs written, no EXIF, pure white corners, whatsapp at 37KB against spec §9.1's 200KB
ceiling.

**The gate runs synchronously in the POST, before anything is queued.** It costs no GPU, and
a refusal is worth much more to the artisan now — still holding the object, in the same
light — than after a twenty-second wait. A rejection returns **200 with no job id**, matching
`contracts.md`; your `job.get("job_id")` already handles that.

Error shapes, because the app's degrade path depends on them: missing `image_url` → 400,
unreadable source → **502 with `message_key: enhance.failed`** (our missing file must never
be reported as the artisan's bad photograph — they would retake a picture that was fine),
unknown job id → 404, `s3://` → 502 saying exactly what is not wired up.

**Two limits you should know before this goes anywhere near a demo.**

1. **The job table is in memory, in the service process.** Restart the service and in-flight
   jobs vanish and their ids stop resolving. It also cannot survive a second replica — a poll
   routed to the other process finds nothing. Decision #2's Redis+RQ fixes both and the swap
   surface is deliberately two functions, `jobs.submit()` and `jobs.get()`. I did not stand up
   Redis because that is deployment shape, and it is your call. `worker.py` is where it goes
   and now explains itself instead of raising.
2. **One job at a time, on purpose.** One GPU, and BiRefNet holds ~1.6GB of a 4GB card. Two
   concurrent jobs is an out-of-memory crash, not throughput.

**Still skipped, and named in every response** (`"skipped": [...]`): `white_balance()`,
`tone()`, `denoise_sharpen()`. Colour is the significant one — a maroon saree under a tungsten
bulb still comes back orange. Rule 4 means nothing publishes without the artisan confirming
colour anyway, but this is the largest remaining quality gap.

`run()` also returns `stages`, which is the beginning of step 5's recipe: rule 2 says record
what was done and render on demand rather than overwriting the original.

**Tests** — new `ai/test_service.py`, 10 assertions over the contract including every error
path. It needs fastapi, so unlike the other two it does not run on a bare machine; the GPU
half skips separately. Suite: **59 passed**.

**Not touched.** Still nothing in `app/` or `web/`. The two open requests from earlier stand:
`fill_fraction` sent with the upload (would likely close the tier system's blind spot), and
the five mislabelled fixtures in `images/MANIFEST.md`.

---

## 2026-08-29 — Step 5: the recipe system. All ten steps are done

`ai/enhance/recipe.py` and `ai/enhance/renderer.py`. Stages now compute **parameters**;
`render(original, mask, recipe)` is the only thing in the pipeline that produces pixels.
`PIPELINE-RECONCILIATION.md` §4 asked for this and your migration `c3a71f0d5e42` is what it
stores into — thank you for leaving the recipe's shape to this side, it is defined in
`recipe.py` and documented in `contracts.md`.

**What it buys, measured on a real fixture:**

    POST /enhance            8848 ms   segment + tier + render + export
    POST /enhance/rerender    131 ms   tier A -> C, stages ["master", "mask_cached"]
                              348 ms   -> B
                              295 ms   -> A again

Switching tier is ~40x faster and never touches the GPU. That is the artisan tapping "leave
my background alone" and getting an answer immediately instead of waiting twenty seconds.

**New endpoint: `POST /enhance/rerender`.** Synchronous, because with the mask cached a job
id would be slower than the work. Full shapes in `contracts.md`. **Please store the `recipe`
returned on every `done` body onto `Product.recipe`** — without it stored, re-render has
nothing to replay and the whole thing degrades to re-running `/enhance`.

**`tier_source` is the field to respect.** It is `"auto"` until a person changes the tier,
then `"user"`. Once the artisan has overruled the confidence score, nothing automatic may
quietly overrule them back — if a re-render ever runs on their behalf, keep the field.

**Masks are now persisted** beside the outputs as lossless greyscale PNG, keyed by
`mask_version` (`birefnet@e2bf8e44` — model plus pinned revision, because BiRefNet ships
`trust_remote_code` and a different revision is a different network). PNG not JPEG
deliberately: JPEG ringing lands hardest on exactly the high-frequency edges a mask exists
to describe.

Masks are derived data and may be evicted. Verified: deleting one makes the next re-render
re-segment (1123 ms, `stages: ["master", "segment"]`) and store it again. **Losing a mask
costs time, never the listing.**

**Rule 2 now holds by construction.** Nothing writes over the original, because nothing but
`render()` writes pixels at all. There is a test asserting `render()` does not modify its
input, and another asserting two renders of one recipe are byte-identical — without that,
"undo" and "switch back" would quietly produce a slightly different listing image.

The crop box is **replayed, not recomputed**. After an artisan has approved a listing image,
a later re-render moving the product is a change they never asked for.

**Tests** — new `ai/test_recipe.py`, 18 assertions, runs on plain `python3`. Whole suite:
**102 passed**.

**Thanks for the three fixes while I was away** — the missing `https` scheme in
`storage.py`, `kornia` missing from `requirements-enhance.txt`, and the resolution path that
refused every real upload. All three were mine, and all three were only findable by running
against real infrastructure with a real phone. The square-fixture blind spot in my
`test_gate.py` is a fair hit.

**Still unwritten:** `white_balance()`, `tone()`, `denoise_sharpen()`. Their recipe fields
are null rather than absent, so recipes written today keep rendering once they land. Colour
remains the largest quality gap, and §9.2's `white_ref` rect is still the open question that
decides whether white balance can be anything better than gray-world.

---

## 2026-09-07 — Tone: the first stage that changes how a photograph looks

`ai/enhance/colour.py` is new, and `pipeline.tone()` is no longer `NotImplementedError`. It
follows step 5's shape: `tone()` measures and returns parameters into `recipe["clahe"]`,
`renderer.render()` applies them. So a tone correction replays, undoes and re-renders
exactly like a tier change, and costs no GPU to redo.

Two corrections, both on the **L channel of LAB and never on a or b**. Black and white
points are percentiles of the product's own lightness taken inside the mask, then CLAHE for
local contrast. Measured on two indoor fixtures:

    textile-weaver-indoor-02    mean L 25.4 -> 33.2   contrast sd 29.2 -> 31.3
    pottery-potter-indoor-04    mean L 38.3 -> 46.4   contrast sd 21.2 -> 26.4
                                hue shift 0.25 and 0.33 degrees, max chroma rise 0.84

**Colour cannot move, and that is enforced rather than intended.** `a` and `b` come out of
`to_lab` and go back into `to_rgb` bit-for-bit. `to_rgb_in_gamut()` exists because a plain
per-channel clip walked a deep maroon toward orange by up to 16.5 of a/b — out-of-gamut
pixels now lose chroma and keep hue, so the answer is always a less saturated version of the
same colour, never a different one.

**The stretch is capped at 1.35x.** A dark product photographed in a dim room is a dark
product; pulling it wide until it looks studio-lit invents an appearance the object does not
have, which is rule 1 whether a diffusion model or arithmetic does it.

**The mask edge needed a measurement nobody had taken.** `matte()` is a no-op because
BiRefNet's alpha ramps over 3-4px, which RESULTS.md established is soft enough for fringes.
It is not soft enough for a brightness change: on `pottery-potter-indoor-04` an 11.1 L
correction across that ramp is **3.3 L per pixel**, which draws a visible line around the
product on tier C, where the background is not replaced. `renderer._tone_weight()` softens
the weight — never the mask, so compositing keeps every thread — to ~8px and 1.39 L/px.
`tone_edge_blur_px: 4` is the only number in the tone block that is measured rather than
copied from the spec.

**What the tests prove, and what they do not.** Hue preserved, chroma never raised, cap
held, background untouched, edge not a seam. Every one is a safety property: they show the
stage cannot do harm. **None of them shows it does good**, because there is no ground truth
for "correctly exposed" the way `degrade.py` gives ground truth for "blurred". The tone
thresholds are still the spec's numbers, and the threshold file says so.

**Still unwritten:** `white_balance()` and `denoise_sharpen()`. A maroon saree under a
tungsten bulb still ships orange — tone fixes brightness, not colour cast, and §9.2's
`white_ref` rect remains the open question. The `wb-v1` fixture set is declared in
`images/MANIFEST.md` and empty; it needs photographs, not code.

---

## 2026-09-07 (2) — One line per upload, so the thresholds can be re-tuned on real traffic

`ai/enhance/observe.py`. `gate()`, `run()` and `rerender()` now append a JSON row each.

Every number in `thresholds.json` was calibrated against `images/raw` — 591 files, but only
**93 distinct scenes**, and mostly stock photographs rather than an artisan's phone in an
artisan's workshop. That set cannot answer what production will ask: *if the blur cutoff
moved to 90, how many real uploads stop being refused, and were they any good?* Only real
traffic answers that, and only if it was written down at the time. This is in before launch
because the alternative is arguing from 93 scenes after 50,000 uploads have passed through
unrecorded.

    {"event":"gate","product_id":"p1","blur":303.1,"mean":89.9,"verdict":null}
    {"event":"enhanced","product_id":"p1","tier":"A","confidence":1.0,"toned":true}
    {"event":"gate","product_id":"p2","blur":1.8,"verdict":"blur_below_reject"}

**Accepted photographs are logged too**, and that is the half worth insisting on: a cutoff
can only be argued down if you know the distribution of what already passes.

**Tier share is now countable.** Tier C keeps the background, so its share is the share of
listings that do not meet the marketplace white-background rule — a number to watch rather
than discover.

**Numbers, never pixels.** A row is a few hundred bytes, holds no photograph and nothing an
artisan typed. `AI_OBSERVE=0` switches it off, `AI_OBSERVE_LOG` moves it, and every failure
inside `observe.py` is swallowed — an enhancement that fails because a log directory is
read-only would be a far worse outcome than a lost row.

**Web side — the signal I cannot see is the retake, and it is the most valuable one here.**
A refusal followed by a retake that passes is a *correct* refusal. A refusal followed by
three more and then silence is a false one that cost us a seller. That lives in the web
side's records; `product_id` is on every row so the two join. If you can record "this upload
was a retry of that one", the gate becomes tunable on evidence instead of on 93 photographs.

**Suite: 118 passed** (gate 16, recipe 28, segment 34, service 10, price 30). `test_gate.py`
and `test_recipe.py` still run on plain `python3` with nothing installed; the seam test needs
the model and skips without it. Test files set `AI_OBSERVE=0` so a test run can never append
to a real log.

---

## 2026-09-07 (3) — White balance: the stage rule 4 exists to police

`pipeline.white_balance()` is written. It returns gains, `renderer._apply_white_balance()`
applies them, and it runs **before** tone in both the measurement and the render — tone
measures the lightness the corrected channels produce, so correcting after it would leave a
permanent mismatch between the recipe's numbers and the picture.

**Two methods, and the accurate one still needs one tap from the app.**

*patch* — `white_ref`, the normalized rect from the artisan's tap on the white paper, now an
optional field on `POST /enhance` and documented in `contracts.md`. That patch is a direct
reading of the light. Blown or shadowed, it is refused rather than guessed at.

*neutral* — no rect. **Deliberately not gray-world**, though §4's recipe sketch names that
method: §5 finding 2 is right that gray-world pulls a maroon Sambalpuri toward orange, so
only the *least chromatic slice* of the frame votes on the illuminant. A ranked slice rather
than a fixed chroma cutoff, because a fixed cutoff fails exactly where it is needed — under a
strong cast the genuinely grey wall photographs orange, fails the cutoff, and the estimate
comes back "nothing to correct" on the photograph that most needed correcting. A frame where
even the least coloured fifth is strongly coloured is **declined**, not guessed.

**Measured — `images/wb_check.py`, 179 fixtures, three synthetic casts:**

    cast ratio   uncorrected   corrected   declined   made worse
    1.24               7.70        1.92          7           15
    1.52              15.29        4.48         18            0
    1.99              20.39        9.94         93            0

Mean |chroma error| against the untouched original. **`wb_max_gain_ratio` is 1.3, and it is
not the sweep's minimum.** No single cap is optimal at every cast strength — the minimum
tracks the cast, which makes it circular. 1.6 scores better on the medium set (2.36) and puts
30 of 172 mild-cast fixtures *further* from the truth than leaving them alone. Rule 1 makes
that the wrong trade: under-correcting leaves the photograph closer to as-photographed,
over-correcting invents. 1.3 is within noise of the mild-cast optimum, cuts error roughly
threefold on the medium set and twofold on the strong one, and made nothing worse on either.

**The ground truth is synthetic, and that bounds what the table means.** A known cast applied
to a fixture measures whether the method recovers a *known* illuminant. It cannot say whether
the method is right about a real bulb in a real workshop, because `images/raw` holds no
photograph with a recorded illuminant. **`wb-v1` is what would** — the same object shot with
and without a sheet of white paper — and `images/MANIFEST.md` has declared it empty since
August. It needs a phone, printer paper and an afternoon, not code.

**Rule 4 is wired.** Past `wb_warn_ratio` the response carries the warning `contracts.md` has
promised since before the stage existed, and it **survives a re-render** — the artisan does
not stop needing to confirm the colour because they changed the background.

Gains are normalised so none exceeds 1, so the correction can only ever darken a channel and
can never clip one into a colour the photograph did not hold. The brightness that costs is
what tone's levels stretch is for, which is the other reason for the order.

**Suite: 127 passed** (gate 16, recipe 37, segment 34, service 10, price 30).

**Web side — `white_ref` is the last thing this stage is waiting on.** One tap on the review
screen, one optional field, shape in `contracts.md`. Absent, nothing breaks and the neutral
path runs exactly as it does today; present, the correction stops being an inference. It is
also the only way past the honest ceiling above: a reference-free method cannot tell warm
light from a warm object, and no threshold fixes that.

**Still unwritten:** `denoise_sharpen()`, and the `shadow` recipe field. A cutout on flat
white with no contact shadow reads as pasted on, and that is now the largest visible gap
between our output and a marketplace listing photograph.
