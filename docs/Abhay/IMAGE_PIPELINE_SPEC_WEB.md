# Image Pipeline — Engineering Spec (Vite + React + Capacitor)

**Project:** AI cataloging app for marginalized artisans (SIH PS 26090)
**Scope:** image capture and processing pipeline only.
Voice cataloging, pricing, and marketplace publishing are separate specs.

**Stack:** Vite + React + TypeScript, packaged for Android via Capacitor.
Processing runs in the WebView. Server is FastAPI + PostgreSQL.

> ⚠️ **Superseded in part.** This document was written before the repository existed and
> assumes the image processing runs on the device. It does not. Read
> `docs/Abhay/PIPELINE-RECONCILIATION.md` first — it says which sections of this file are
> still authoritative, which have moved into `ai/enhance/`, and which are withdrawn.


---

## 0. Read this first

You are implementing an image pipeline for a user who:

- may not be able to read
- may have no network for days at a time
- is photographing handmade goods (textiles, pottery, brass, bamboo, jewelry)
  in a workshop or courtyard, not a studio
- is often assisted by a helper (SHG coordinator, family member)

Three rules override every other decision in this document:

1. **The artisan is never blocked and never sees a blank state.** Progressive
   reveal is mandatory (§1.2). Total capture-to-result target: under 3 seconds.
2. **Never fabricate product detail.** No super-resolution, no generative
   backgrounds, no diffusion relighting, no saturation boost beyond +10%.
   If the delivered product looks different from the photo, the artisan takes
   the bad review.
3. **Never destroy the original.** The pipeline stores a recipe and renders on
   demand. The original file is written once and never modified.

If a requirement conflicts with one of these three, the rule wins. Flag the
conflict rather than silently resolving it.

---

## 1. Architecture

### 1.1 Platform constraints — read before designing anything

This app runs in a WebView. The following native capabilities are **not
available**, and the design already accounts for them. Do not attempt to work
around them:

| Constraint | Consequence |
|---|---|
| No NNAPI / NPU access from WebView | Segmentation runs on WASM or WebGL, ~300ms–1s (native would be ~50ms) |
| INT8 poorly supported on WebGL backend | Ship float32 or float16 ONNX (~4.7 MB), not INT8 |
| `getImageData` is a synchronous GPU→CPU readback | Frame sampling runs at ~5fps, not 30fps |
| `getUserMedia` gives no reliable AE/AF lock or full-res stills | Use `@capacitor-community/camera-preview` for preview and capture |
| No reliable background execution when app is closed | Upload sync runs on app resume and while foregrounded only |
| Canvas resampling is bilinear, not Lanczos | Use multi-step downscale for quality (§9) |

**Do not process at full sensor resolution.** Downscale to a 2000px long edge
immediately after capture. That is the export size anyway, so nothing is lost,
and it cuts processing cost by roughly 3×.

### 1.2 Progressive reveal — mandatory

Native apps can show a finished result at once. This stack cannot. The UI
reveals in three stages:

| t | What the artisan sees |
|---|---|
| ~0ms | Captured frame, immediately, unprocessed |
| ~400ms | Colour-corrected version fades in |
| ~1200ms | Cutout / tier treatment applies |

Never show a spinner over the image. Never show an empty state. Each stage
replaces the previous in place.

### 1.3 Pipeline shape

```
Guided capture (native plugin) → downscale to 2000px → quality gate
  → colour correction (OpenCV.js)     ─── reveal stage 2
  → segmentation (ONNX Runtime Web)   ─── reveal stage 3
  → confidence scoring → tier → contact shadow
  → artisan approval → export → local save
  → [app foregrounded + network] → server upgrade → silent swap
```

Two segmentation models, same job, different quality/latency points:

| Model | Where | Format | Input | Latency | Role |
|---|---|---|---|---|---|
| U²-Netp | Device (WebView) | ONNX f32/f16, ~4.7 MB | 320×320 | ~300ms–1s | Every photo, automatic |
| BiRefNet + matting | Server | PyTorch, ~200 MB | 1024×1024 | ~2.5s | Background upgrade |
| EdgeSAM | — | — | — | — | PLANNED, do not build |

EdgeSAM is documented for architecture completeness only. Tier C (§6) already
covers the auto-segmentation failure case.

---

## 2. Data model — implement this first

Everything depends on it. Nothing downstream is destructive.

Binary assets go to the **Capacitor Filesystem** (real files on device), not
IndexedDB. Metadata goes to IndexedDB or SQLite.

```
Filesystem (Directory.Data):
  products/{productId}/
    original.jpg          # downscaled 2000px master — written once, never modified
    capture_full.jpg      # optional full-res, kept only until upload succeeds
    mask_v1.png           # 8-bit grayscale alpha from on-device model
    mask_v2.png           # from server (may be absent)
    renders/
      marketplace.jpg
      social.jpg
      whatsapp.jpg

IndexedDB / SQLite:
  products    — id, createdAt, recipe (JSON), maskVersion, uploadState, pHash
  corrections — productId, strokes (JSON)
  uploadQueue — productId, attempts, nextAttemptAt
```

**Naming note:** `original.jpg` is the 2000px downscaled master. It is the
artisan's reference image and is never modified. `capture_full.jpg` is the raw
sensor capture, retained only until the server has it, then deleted to save
device storage.

### Recipe type

```ts
type Recipe = {
  version: 2;
  maskVersion: 'v1' | 'v2';
  whiteBalance: { method: 'patch' | 'grayworld'; gains: [number, number, number] };
  clahe:        { clipLimit: number; tileGrid: [number, number] };
  gamma:        number;
  tier:         'A' | 'B' | 'C';
  tierSource:   'auto' | 'user';
  confidence:   number;
  shadow:       { enabled: boolean; opacity: number; blur: number; offsetY: number };
  crop:         { x: number; y: number; w: number; h: number; paddingPct: number };
};
```

### Why this model matters

- Undo = change one field and re-render. No image history stack.
- Tier switching costs nothing — no re-segmentation.
- Server upgrade = set `maskVersion: 'v2'` and re-render. The artisan's tier
  choice and brush corrections survive automatically.
- "Untouched original always attached" is true by construction.

**Do not** write a pipeline that applies edits sequentially to a canvas and
saves the result each time. That design breaks §11 entirely.

---

## 3. Stage 1 — Guided capture

Use `@capacitor-community/camera-preview`. It renders a native camera preview
behind a transparent WebView, so React draws the overlay on top and the plugin
handles focus and full-resolution capture.

Verify the plugin's current API before implementing — it has changed across
major versions.

### 3.1 Frame sampling for coaching

Sample a frame roughly **every 200ms** (~5fps). Do not attempt per-frame
analysis at 30fps — `getImageData` readback will stall the UI thread.

Downscale each sampled frame to **160×120 grayscale** before analysis. That is
19,200 pixels; the checks below complete in a few milliseconds in plain JS.

Run the analysis in a **Web Worker** with `OffscreenCanvas` where available, so
readback never blocks the preview.

**Blur — variance of Laplacian**

```ts
// 3x3 Laplacian kernel: [0,1,0, 1,-4,1, 0,1,0]
// Compute response per pixel, then variance across the frame.
// Blurry if variance < BLUR_THRESHOLD
```

Start with `BLUR_THRESHOLD = 80`. **This is a guess and must be calibrated**
against real device photos (§14). Keep it in one constants module.

**Exposure — histogram**

```ts
tooDark   = fraction(gray < 15)  > 0.35
tooBright = fraction(gray > 240) > 0.10
```

### 3.2 UI behaviour

- Guide box overlay drawn in React over the native preview
- Border **green** when both checks pass, **red** when either fails
- Audio prompt announces the specific reason in the artisan's language
  ("too dark, move near the window" / "hold steady, photo is blurry")
- Single large shutter button. No settings, no modes, no menus.
- Tap-to-focus via the plugin's focus API if available; if not available on the
  installed plugin version, omit it — do not attempt a `getUserMedia` fallback,
  it is unreliable in WebView.

### 3.3 White reference

On first run, an audio prompt asks the artisan to place a plain sheet of white
paper in frame and tap it once. Store the tapped region's mean RGB.

Do not attempt to auto-detect the paper. The tap is more reliable and is a
single action.

### 3.4 Batch capture

Artisans work from a pile of stock, not one item. Allow 5–10 captures in
sequence, queued for description afterwards. Each capture runs the quality gate
independently.

---

## 4. Stage 2 — Downscale and quality gate

**Downscale first.** Resize the capture to a 2000px long edge using multi-step
halving (§9.2) before any analysis or processing.

Then re-run blur and exposure checks on the downscaled image at full quality
(not the 160×120 preview version).

On failure: do not process, do not save. Play the audio reason, offer retake.

Rationale to preserve in code comments: once the sensor clips a highlight to
255, the detail is physically gone. No downstream model recovers it. A false
negative (rejecting a fine photo) is annoying; a false positive poisons every
later stage.

---

## 5. Stage 3 — Colour and light correction

Use **OpenCV.js** (WASM). Same API as the Python prototype, so tuned parameters
transfer directly.

Budget: **under 500ms** on a 2000×2000 image. Measure it; if OpenCV.js is
slower than this on target devices, move gamma and white balance to a WebGL
fragment shader and keep only CLAHE in WASM.

Load the OpenCV.js WASM module **lazily on app start, in the background**, not
on first capture. It is ~8–10 MB and the initialization is slow. Show the app
as ready only after it resolves.

### 5.1 Crop

Detect subject bounding box, crop with 8% padding. Write to recipe.

EXIF is not a concern on this stack — canvas output carries no metadata, so
exports are automatically clean. Note this as a privacy win: the artisan's GPS
location cannot leak through an exported image.

### 5.2 White balance

If a reference patch was tapped, compute per-channel gains so the patch becomes
neutral, then apply to all pixels. Otherwise fall back to gray-world (assume
the scene averages to neutral). Record which method was used.

### 5.3 Local contrast — CLAHE

**Run on the L channel of LAB only.** Never on RGB channels directly — that
shifts hue, and a saree changing shade is a misrepresentation problem.

```
cvtColor(src, BGR2Lab) → split → createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
  → apply to L only → merge → cvtColor(Lab2BGR)
```

The clip limit caps amplification. Without it, flat dark regions amplify sensor
noise into visible grain.

**Memory warning:** OpenCV.js Mats are not garbage collected. Every `Mat` must
be explicitly `.delete()`d. Wrap the pipeline in try/finally and delete in the
finally block, or the app will OOM after a handful of photos. This is the most
common OpenCV.js bug.

### 5.4 Gamma

Target a median luminance near 128 via a lookup table:
`output = (input/255)^gamma * 255`. Lifts midtones while leaving pure black and
pure white fixed.

### 5.5 Hard limits

- Saturation boost: **max +10%**
- No sharpening beyond a mild unsharp mask
- No denoise strong enough to smooth weave texture

**→ Reveal stage 2 here.** Show the corrected image before segmentation starts.

---

## 6. Stage 4 — Segmentation and tier selection

### 6.1 Model and runtime

**U²-Netp** via **ONNX Runtime Web**.

Chosen because it does **salient object detection** — find the dominant subject
with no fixed class list. Class-based models (DeepLab, MediaPipe Selfie) are
wrong here: a Dokra figurine is not in any standard class list.

Backend selection at runtime, in this order:
1. **WebGPU** if available (fastest, but Android WebView support is
   inconsistent — treat as a bonus, never a dependency)
2. **WebGL** (expect ~300–600ms)
3. **WASM with SIMD + threads** (expect ~600ms–1.5s)

Log which backend was selected. Ship float32 or float16 weights — INT8 gives
little benefit on WebGL and is poorly supported.

Run inference in a **Web Worker**. It must not block the UI thread.

Pipeline: resize to 320×320 → normalize → infer → sigmoid → upsample mask to
2000px → slight blur to soften the staircase edge.

**Keep the mask soft (0.0–1.0). Do not threshold to binary.** The intermediate
values are the confidence signal §6.2 depends on.

### 6.2 Confidence scoring

```ts
function maskConfidence(alpha: Float32Array, w: number, h: number): number {
  const uncertain = fraction(alpha, v => v > 0.1 && v < 0.9);
  const nBlobs    = connectedComponents(alpha, 0.5);
  const area      = mean(alpha);
  let score = 1.0;
  if (uncertain > 0.08)          score -= 0.4;  // hairy, undecided edges
  if (nBlobs > 3)                score -= 0.3;  // product fragmented
  if (area <= 0.15 || area >= 0.85) score -= 0.3;  // subject too small/large
  return Math.max(score, 0);
}
```

Connected-components on a 2000×2000 mask in JS is slow. **Run it on a
downscaled 256×256 version of the mask** — blob counting does not need full
resolution.

### 6.3 Three tiers

| Score | Tier | Treatment | Typical subject |
|---|---|---|---|
| > 0.75 | A | Full cutout on #FFFFFF + contact shadow | Pottery, brass, wood |
| 0.45–0.75 | B | Feathered mask on soft studio gradient | Most textiles |
| < 0.45 | C | No removal — background blurred + dimmed | Fringe, net, chains |

**Tier C must never fail.** It removes nothing, so it cannot damage the
product. It is the safety net for the entire pipeline.

Design rationale: a chewed-up saree edge looks worse than no edit at all. The
system measures its own confidence and degrades gracefully rather than forcing
a cutout it cannot do cleanly.

Tier C background blur: use `ctx.filter = 'blur(Npx)'` on a copy, then
composite the sharp product over it using the mask. Canvas filter blur is
GPU-accelerated and fast.

### 6.4 Contact shadow (Tier A only)

**Highest visual quality gain per line of code in the whole pipeline. Build it
early.**

Take the bottom third of the mask → heavy blur (~40px) → offset down ~18px →
composite onto the background at ~25% opacity using `multiply`.

Without it, cutouts look pasted on. With it, they read as photographed.

**→ Reveal stage 3 here.**

---

## 7. Stage 5 — Artisan approval

### 7.1 Tier selection by picture

Present the three tier results as **three thumbnails side by side**. The
artisan taps the one they prefer.

- Confidence score sets the default selection
- Never display "Tier A/B/C" or any technical label anywhere in the UI
- Selection by looking, not by reading
- Record `tierSource: 'user'` when overridden

Render tier thumbnails at ~300px, not full size. All three at full resolution
is wasted work.

### 7.2 Tap-to-fix brush

Two buttons only: **erase** and **restore**. Painting modifies the mask canvas,
never the pixels.

Implementation: keep the mask in a separate `<canvas>`, paint with pointer
events using `globalCompositeOperation`, and re-composite the preview on each
stroke end (not on every pointer move — that will drop frames).

### 7.3 Spoken readback

The app speaks the result summary in the artisan's language, then asks a
yes/no question.

**Do not use the Web Speech API for this.** Indic voice availability in Android
WebView depends on which TTS engines the device has installed, and Odia and
several others are commonly missing.

Instead: **pre-generate the fixed prompt set as audio files** using Bhashini,
ship them as app assets, and play them with the HTML `<audio>` element. This
is more reliable, works fully offline, and gives consistent pronunciation.

Dynamic text (the generated product description) needs a Bhashini TTS call and
should be cached to the filesystem after the first fetch.

This stage is not optional polish. The user may not be able to read. Without
readback they cannot verify what is about to be published in their name.

On "no": fall back to a lighter recipe, then to the original.

---

## 8. Correction logging

Every brush stroke is appended to the `corrections` store:

```ts
{ strokeId, mode: 'erase' | 'restore', points: [[x,y]...],
  brushRadius, maskVersion, timestamp }
```

These are labelled examples of exactly where the model failed, on the hardest
cases (fringe, low contrast, patterned backgrounds). They accumulate into a
handicraft segmentation dataset that does not currently exist.

Store them. Do not discard after render.

---

## 9. Stage 6 — Export

### 9.1 Templates

Named buttons with icons. **Zero sliders, zero numeric inputs, no technical
vocabulary anywhere in the UI.**

| Button | Spec |
|---|---|
| Marketplace | 1:1, 2000×2000, product ≈85% of frame, #FFFFFF, JPEG q88 |
| Social | 4:5, backdrop, JPEG q88 |
| WhatsApp | 1:1, 1000×1000, JPEG q75, target under 200 KB |

Export via `canvas.toBlob('image/jpeg', quality)`, then write to the filesystem
with the Capacitor Filesystem plugin.

Marketplace dimension rules live in a config module, never in the UI.

### 9.2 Resampling quality

Canvas `drawImage` downscaling is bilinear and produces visible aliasing on
large reductions. For any reduction greater than 2×, **halve repeatedly** until
within 2× of the target, then do the final step. Set
`ctx.imageSmoothingQuality = 'high'`.

### 9.3 Metadata

Canvas exports carry no EXIF, so location and device data are stripped
automatically. Note this in code comments — it is a privacy property worth
keeping deliberate rather than accidental.

---

## 10. Stage 7 — Persistence and sync

**Offline-first.** The pipeline must complete end to end in airplane mode.

- Capacitor bundles the web assets locally, so the app shell works offline with
  no service worker required
- Recipe, masks, and renders written immediately via Capacitor Filesystem
- Product record and upload queue in IndexedDB or SQLite
- Optimistic UI: the listing shows as complete straight away. No spinner, no
  blocking "uploading…" state

### 10.1 Sync limitations — be honest about this

A Capacitor WebView app **cannot reliably upload while closed.** Do not claim
true background sync.

What to implement instead:
- Attempt upload on app resume and while foregrounded
- Use `@capacitor/network` to detect connectivity changes and trigger a retry
- Exponential backoff (1s, 2s, 4s, 8s…), persisted across launches
- Idempotent uploads — retries must not duplicate assets
- Nothing breaks if the device has no network for days

If a judge asks, the accurate framing is: *"sync resumes automatically whenever
the app is opened; a true background service would need a native module, which
is on the roadmap."*

### 10.2 Storage hygiene

Delete `capture_full.jpg` once the server confirms receipt. Full-resolution
captures will fill a budget device quickly if retained.

---

## 11. Server upgrade path

Runs in the background on the server. The artisan takes no action.

1. Receive `capture_full.jpg` (or the 2000px master if full-res was not kept)
2. **BiRefNet** at 1024×1024. Its bilateral-reference design runs a separate
   branch for boundaries that can consult full-resolution patches — this is
   what the on-device model lacks.
3. **Alpha matting** over a trimap:
   - certain foreground / certain background / narrow unknown band
   - solve `observed = α·F + (1−α)·B` for α in the unknown band
   - required because a fringe thread can be thinner than one pixel; that
     pixel is genuinely part thread and part wall
4. **Foreground colour estimation / decontamination** — remove background
   colour bleed from edge pixels. This prevents halo artifacts.
5. Write `mask_v2.png`
6. Set `recipe.maskVersion = 'v2'` and **re-render from the existing recipe**

**Critical:** step 6 re-renders using the recipe. It does not rerun the device
pipeline and does not discard the artisan's tier choice or brush corrections.

7. Silent swap of rendered assets. Tier C items frequently promote to a clean
   Tier A cutout, since the server has resolution and matting the device never
   had.
8. Invalidate any CDN cache for the replaced asset.

---

## 12. Integrity

Compute a **pHash** of the master image on ingest. Detects stock photos pulled
from the web and the same image reused across accounts. Store alongside the
product record.

---

## 13. Explicit non-goals

Do not implement any of the following. Each has been considered and rejected.

| Rejected | Reason |
|---|---|
| Super-resolution (Real-ESRGAN) | Invents weave patterns that do not exist. Fabrication. |
| Generative backgrounds | Slow, inconsistent; marketplaces require plain white. |
| Diffusion relighting | Alters apparent colour and weave on fabric. |
| Virtual model / draping | Weeks of work; misrepresents the actual item. |
| Auto-detect fabric type | Unreliable. Ask the artisan — they already know. |
| Aggressive denoise | Smooths away the texture that signals handmade. |
| EdgeSAM / MobileSAM | Good idea, not MVP. Tier C covers the failure case. |
| SAM 2 | Video model, 150 MB+, GPU-only. Cannot run in a WebView. |
| Web Speech API for Indic TTS | Voice availability unreliable across devices. Use pre-generated Bhashini audio (§7.3). |
| Service worker for offline | Capacitor already bundles assets locally. Redundant complexity. |
| Full-resolution WASM processing | Seconds per image. Downscale to 2000px first. |

If asked to add any of these, push back and cite this section.

---

## 14. Threshold calibration — required before the app is usable

Every numeric threshold in this spec is a **starting guess**:

| Constant | Guess | Section |
|---|---|---|
| BLUR_THRESHOLD | 80 | §3.1 |
| dark fraction | 0.35 | §3.1 |
| bright fraction | 0.10 | §3.1 |
| uncertainty band | 0.08 | §6.2 |
| blob count | 3 | §6.2 |
| area bounds | 0.15 / 0.85 | §6.2 |
| tier boundaries | 0.75 / 0.45 | §6.3 |
| CLAHE clip limit | 2.0 | §5.3 |

These must be calibrated against real photographs of real handicrafts on a real
device before the pipeline is trustworthy. Keep all of them in a single
`src/config/thresholds.ts` module.

Calibrate in the Python prototype (§15) where iteration takes seconds, then
copy the values across. OpenCV.js uses the same API, so they transfer directly.

---

## 15. Python prototype — build this first

Before writing any React, build a Python prototype of §4–§6 using OpenCV and
`rembg` with the `u2netp` session.

Purpose: tune the eight thresholds in §14 against real images. Iterating in
Python takes seconds; iterating inside a Vite/Capacitor rebuild loop takes
minutes to hours.

The prototype is throwaway code with one deliverable: **a calibrated
`thresholds.ts`**, plus before/after contact sheets you will need for the
presentation anyway.

---

## 16. Suggested module layout

```
src/
  config/
    thresholds.ts           # ALL tunable constants, calibrated from prototype
    exportTemplates.ts      # marketplace dimension rules
  capture/
    GuidedCamera.tsx        # camera-preview plugin + React overlay
    useFrameQuality.ts      # ~5fps sampling, worker-backed
    whiteReference.ts
    batchQueue.ts
  workers/
    frameQuality.worker.ts  # blur + exposure on OffscreenCanvas
    segmentation.worker.ts  # ONNX Runtime Web
  processing/
    recipe.ts               # Recipe type + serialization
    opencv.ts               # OpenCV.js loader, Mat lifecycle helpers
    colour.ts               # wb, clahe, gamma  (delete Mats in finally!)
    segmentation.ts         # worker wrapper
    confidence.ts           # mask scoring, runs on 256px mask
    tiers.ts                # A/B/C canvas rendering
    shadow.ts               # contact shadow
    renderer.ts             # recipe + mask -> canvas
    downscale.ts            # multi-step halving
  review/
    TierPicker.tsx          # three thumbnails
    FixBrush.tsx            # erase/restore, logs strokes
    Readback.tsx            # pre-generated audio playback
  export/
    templates.ts
  storage/
    filesystem.ts           # Capacitor Filesystem wrapper
    db.ts                   # IndexedDB / SQLite
    uploadQueue.ts          # backoff, idempotent, foreground-triggered
  audio/
    prompts/                # pre-generated Bhashini clips per language

prototype/                  # Python, throwaway, produces thresholds.ts
server/
  segmentation/birefnet.py
  matting/{trimap,solve_alpha,decontaminate}.py
  render/from_recipe.py
  integrity/phash.py
```

---

## 17. Build order

Do not reorder. Each milestone depends on the previous.

**M0 — calibration (day 1)**
Python prototype of quality checks, colour correction, segmentation and tier
logic. Run against 25+ real fixture images. Output: calibrated `thresholds.ts`.

**M1 — foundation (days 2–3)**
Vite + React + Capacitor scaffold → Recipe type and storage layer → camera-preview
integration → frame quality worker → downscale → quality gate → OpenCV.js
colour correction. End to end but rough.

**M2 — segmentation and quality (days 4–5)**
ONNX Runtime Web in a worker → backend selection and logging → confidence
scoring → three tiers → contact shadow → progressive reveal → tier thumbnails →
fix brush → correction logging.

**M3 — the flow (days 6–7)**
Pre-generated audio prompts → readback approval → export templates → multi-step
downscale → batch capture → upload queue with backoff.

**M4 — server (days 8–9)**
BiRefNet → trimap alpha matting → decontamination → re-render from recipe →
silent swap → pHash.

**M5 — freeze (day 10)**
No new features. Performance profiling on a real mid-range device and rehearsal.

---

## 18. Acceptance criteria

On a real mid-range Android device, in airplane mode:

1. Capture-to-final-result completes in **under 3 seconds**.
2. The colour-corrected image appears within **~500ms** of the shutter; the
   cutout applies by **~1.5s**. No blank state or spinner over the image at any
   point.
3. Live camera coaching updates at least 4 times per second without visible
   preview stutter.
4. A blurry or blown-out photo is rejected with a **spoken** reason.
5. A fringed textile routes to Tier C automatically and the result is visibly
   better than the original.
6. A clay pot routes to Tier A with a contact shadow.
7. Changing tier after the fact requires **no re-segmentation**.
8. `original.jpg` is byte-identical after any number of edits.
9. Marketplace export is exactly 2000×2000, under 1 MB, no EXIF.
10. Processing 20 photos in one session does not increase memory monotonically
    (OpenCV.js Mats are being released).
11. With network restored and the app foregrounded, the server mask replaces v1
    and the artisan's tier choice and brush strokes are preserved.
12. Every UI action is reachable without reading any text.

Criterion 10 is specific to this stack and is the one most likely to fail
silently. Test it explicitly.

---

## 19. Known failure modes

| Failure | Handling |
|---|---|
| OpenCV.js Mat leak → OOM after ~10 photos | Explicit `.delete()` in a finally block for every Mat |
| WASM module load blocks first capture | Preload on app start, gate the ready state on it |
| `getImageData` stalls the preview | Worker + OffscreenCanvas, 5fps sampling, 160×120 frames |
| WebGPU unavailable on target device | Runtime backend fallback chain, log the selection |
| Segmentation slower than expected | Progressive reveal means the artisan already has a usable image |
| Device TTS lacks the target language | Pre-generated Bhashini audio assets, not Web Speech API |
| App killed mid-upload | Queue persisted, retried on next launch, idempotent |
| Model cold start on first capture | Warm the ONNX session at app start with a dummy inference |
| Server unreachable | Device result is always sufficient; server is an upgrade, never a dependency |

---

## 20. Glossary

- **Salient object detection** — find the dominant subject with no fixed class list.
- **Alpha mask** — per-pixel 0.0–1.0: how much of this pixel is product.
- **Uncertainty band** — fraction of mask pixels between 0.1 and 0.9. High means fuzzy edges.
- **Graceful degradation** — falling back to a simpler, safer output instead of failing.
- **Trimap** — three-zone map: certain foreground, certain background, unknown band.
- **Alpha matting** — solving for true transparency in the unknown band.
- **Colour decontamination** — removing background colour bleed from edge pixels.
- **Progressive enhancement** — ship a working basic result, improve it when resources allow.
- **Progressive reveal** — showing partial results as each stage completes (§1.2).
- **Optimistic UI** — show the action as complete immediately, sync later.
