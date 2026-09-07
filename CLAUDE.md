# Project

AI cataloging app for artisans (SIH PS 26090). Voice + camera in, published marketplace
listing out. The artisan may not be able to read, and may be on a rural tower.

| Folder | What | Owner |
|---|---|---|
| `app/` | Artisan mobile app — React + Vite + Capacitor, TypeScript + Tailwind 4 + shadcn/Radix + TanStack Query | app dev |
| `web/api/` | FastAPI backend + channel adapters | web dev |
| `ai/` | The three PS features, deployed as its own service on port 8001 | AI/ML |
| `images/` | Calibration fixtures for the image thresholds. Pixels gitignored | AI/ML |

`web/` calls `ai/` over HTTP and never imports across that line — separate deploy units.

# Read before any image work

**New to the image side, or explaining it to someone who is?**
`docs/walkthrough/image_processing_flow.md` follows one photograph from the camera to the
listing image in plain language — what runs on the phone, what runs on the server, what is
built and what is not. Start there, then come back to the two files below.

**`docs/Abhay/PIPELINE-RECONCILIATION.md`.** It decides between two competing designs for
the image pipeline and says which parts of each survive.

⚠️ `docs/Abhay/IMAGE_PIPELINE_SPEC_WEB.md` and `CLAUDE_CODE_PLAYBOOK_WEB.md` are **partly
superseded**. They were written before this repo existed and assume the image processing
runs on the device. It does not. Both carry a banner saying so. Do not follow the
`CLAUDE.md` draft in the playbook's §0.1 — this file replaces it.

`docs/app/Camera-Pipeline.md` is the current, accurate description of the photo path.

# The architecture, settled

- **Online-first.** No offline queue, no local database, no sync engine (`docs/decisions.md`).
- **The phone coaches the shot; the server does the processing.** `app/src/camera/gate.js`
  measures the live frame and gates the shutter. Everything else runs in `ai/enhance/`.
- **Thresholds live in `ai/thresholds.json` and are fetched at runtime.** Never bundle them
  into the app, never keep a second copy, never hardcode one. Both gates read the same file.

# Non-negotiable rules

1. **Never fabricate product detail.** No super-resolution, no generative backgrounds, no
   diffusion relighting, no saturation boost beyond +10%. If the delivered item looks
   different from the photo, the artisan takes the bad review and the return.
2. **Never destroy the original.** Store a recipe, render on demand.
3. **Every failure degrades and speaks.** No silent spinner. Losing the enhancement costs a
   prettier photo; it must never cost the artisan the listing.
4. **Nothing publishes without `colour_confirmed`.** White balance moves colour, and only
   the person holding the object can say whether it is still true.
5. **`stripExif` runs on every upload path, unconditionally.** An artisan's home GPS
   coordinates on a public listing cannot be undone.
6. **One problem at a time in the camera UI, light before everything else.**

If a task conflicts with these, stop and flag it. Do not silently resolve.

# Rejected — do not propose these

| Rejected | Why |
|---|---|
| OpenCV.js / ONNX Runtime Web in the WebView | Server does it better. Withdrawn from the old spec |
| On-device segmentation (U²-Netp) | Same. One model, server-side |
| Offline-first, IndexedDB, local sync engine | Settled against. Resumable chunked upload instead |
| Swapping to `@capacitor-community/camera-preview` | The gate is built and tested on `getUserMedia` |
| Raising the gate's 240×180 sample size "for accuracy" | `getImageData` readback is the cost. This kills the feature |
| Super-resolution, generative backgrounds, diffusion relighting | Fabrication |
| SAM 2 / EdgeSAM | Not MVP. The tier system covers the failure case |
| Web Speech API for Indic TTS | Voice availability unreliable. Pre-generated audio instead |
| AccessibilityService overlay on marketplace apps | Play Store suspension risk |

# Testing

```bash
cd app && npm test               # gate, mic lifecycle, query policy, /home's todo counts
node app/src/camera/gate.js      # camera gate, 19 assertions, no device or framework
node app/src/screens/homeTodos.js  # /home "waiting for you" counts vs the tabs they link to
node app/src/catalog/slots.js    # the interview: what is asked, what a harvest drops
cd web/api && python3 test_uploads.py   # chunk assembly, no database or server
web/api/.venv/bin/pytest web/api/test_catalog.py  # the /catalog proxy; needs fastapi
cd web && api/.venv/bin/python3 api/test_white_ref.py    # the white_ref hand-off to /enhance
cd web && api/.venv/bin/python3 api/test_retry_chain.py  # products.retry_of; sqlite in memory
cd ai && .venv/bin/pytest        # 130 tests; 6 fail without torch (F1 only). ai/.venv exists as of 2026-08-28
cd ai && .venv/bin/pytest test_catalog.py  # F2 shaping in four scripts, and the self-checks
cd ai && .venv/bin/python probe_dialects.py  # dialects vs the live model; needs a key, spends money
cd ai && python3 test_gate.py    # server quality gate, 10 assertions, no venv or fixtures
cd ai && python3 test_segment.py # master downscale; skips the model half without a venv
cd ai && python3 test_recipe.py  # recipe + renderer, 18 assertions, no venv
cd ai && .venv/bin/pytest test_service.py  # the /enhance contract end to end; needs fastapi
python3 research/pricing/pricing.py selfcheck    # the comps seed sampler, no data needed
python3 research/pricing/scrape/normalise.py --selfcheck  # weave/category labelling, no network
python3 images/check.py --resume && python3 images/calibrate.py   # thresholds vs the fixture set
```

# Current state

**The F1 image path is wired end to end as of 2026-08-28.** `POST /enhance` gates, queues and
returns 202; `GET /enhance/{job_id}` polls; the job runs gate → 2000px master → BiRefNet →
tier → crop → per-target JPEG. Start it with `uvicorn service:app` — `worker.py` is not
needed yet and says so.

`white_balance()` and `tone()` were written on 2026-09-07 and run before the tier work —
white balance first, because tone measures the lightness the corrected channels produce.
Both return parameters into the recipe and `renderer.py` applies them, so either replays
without a GPU. One stage is still unwritten and is **skipped explicitly**, with every
response naming it: `denoise_sharpen()`. The `shadow` recipe field is the other gap — a
cutout on flat white with no contact shadow reads as pasted on.

`POST /enhance` takes an optional `white_ref` — the artisan's tap on white paper, normalized
— and `POST /api/products/{id}/enhance` forwards it. **Nothing in the app sends one yet**, so
white balance runs its reference-free neutral estimate, which declines outright rather than
guessing when a dyed product fills the frame. The tap is deliberately not built: see
`docs/Abhay/CHANGELOG.md` 2026-09-07 (3) for what it buys and what `images/MANIFEST.md`'s
empty `wb-v1` set would have to prove first.

Every gate and enhance call appends one JSON row via `ai/enhance/observe.py` — numbers, never
pixels, `AI_OBSERVE=0` to switch off. `products.retry_of` is the web half of that: it records
which product is the artisan's retake of one the gate refused, which is the only thing that
says whether a refusal was right.

**F2 and F3 are no longer stubs.** `/catalog/interpret` turns one spoken sentence into one
field value, `/catalog/harvest` fills whatever other slots that same sentence happened to
contain, and `/catalog` writes the listing once and then lets `ai/catalog/seo.py` — pure and
deterministic — cut it to each channel's real limits. An unreachable model never raises:
`compose_fallback` builds the listing from the artisan's own answers and marks it
`confidence: 0`. `/catalog/prefill`, the vision-only pre-fill, is the one piece still
unwritten. `/price` is deterministic end to end — cost floor, cluster wage rate, channel
MRP, comparables that may only raise the suggestion — and refuses with 422 when there is
neither a material cost nor labour hours, because a floor of ₹0 clamps nothing while
sounding authoritative.

The job table is process-local (`ai/enhance/jobs.py`): one worker thread, because one GPU.
Restarting the service loses in-flight jobs and their ids. `docs/decisions.md` #2's Redis+RQ
is the fix and the swap surface is two functions.

**F3 has a real dataset as of 2026-09-03.** `research/pricing/scrape/` collects goswadeshi,
itokri and indiahandmade and normalises them into 45,652 labelled rows; the columns are
documented in `research/pricing/scrape/DATASET.md` and the data itself is gitignored, so
rebuild it with `normalise.py --model` rather than looking for it in the repo. 27,180 rows
carry a weave-level key (`textiles.saree.sambalpuri`), and that resolution **changed the
pricing verdict** rather than merely sharpening it — `research/RESULTS.md`, entry
`pricing-dataset`. The model the PS asks for is not trained yet; `out/model.csv` is what it
trains on, and `dup_group` / `vendor_group` are how it must be split.

Do not collect more listings. The seed is capped at 200 prices a category and 61 categories
are already at that cap.

See `docs/Abhay/CHANGELOG.md` for what moved most recently and what is still blocked.
