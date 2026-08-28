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
node app/src/camera/gate.js      # camera gate, 19 assertions, no device or framework
cd web/api && python3 test_uploads.py   # chunk assembly, no database or server
cd ai && .venv/bin/pytest        # pricing, 15 tests. ai/.venv exists as of 2026-08-28
cd ai && python3 test_gate.py    # server quality gate, 10 assertions, no venv or fixtures
cd ai && python3 test_segment.py # master downscale; skips the model half without a venv
cd ai && .venv/bin/pytest test_service.py  # the /enhance contract end to end; needs fastapi
python3 images/check.py --resume && python3 images/calibrate.py   # thresholds vs the fixture set
```

# Current state

**The F1 image path is wired end to end as of 2026-08-28.** `POST /enhance` gates, queues and
returns 202; `GET /enhance/{job_id}` polls; the job runs gate → 2000px master → BiRefNet →
tier → crop → per-target JPEG. Start it with `uvicorn service:app` — `worker.py` is not
needed yet and says so.

Three stages inside that sequence are still unwritten and are **skipped explicitly**, with
every response naming them: `white_balance()`, `tone()`, `denoise_sharpen()`. Colour is the
significant absence. F2 (`/catalog`) and F3 (`/price`) are still stubs, so the app's
`enhance.failed` degrade path remains the common path for everything except images.

The job table is process-local (`ai/enhance/jobs.py`): one worker thread, because one GPU.
Restarting the service loses in-flight jobs and their ids. `docs/decisions.md` #2's Redis+RQ
is the fix and the swap surface is two functions.

See `docs/Abhay/CHANGELOG.md` for what moved most recently and what is still blocked.
