# Camera Pipeline

### Sensor → gate → capture → upload → enhance → colour lock → published image

**Status:** v1 · handoff document. Extends Master ref §4 (on-device gate) and §5 (server pipeline)
**Read this after** §4 and §5.6 of the Master Technical Reference, and `docs/Application-Architecture.md` §7.
**Audience:** someone building a new workflow on top of this code who has not seen it before.

Everything below was verified by reading the files and running the self-tests. Where something is
stubbed or currently broken, this document says so in those words — see §10, which you should read
**before** you plan your first day.

---

## 0. The one thing to understand before you change any number

**Thresholds are fetched from the server at runtime. They are not bundled in the app.**

```
ai/thresholds.json          ← the single source of truth, one file
        │
        ├── GET /api/thresholds  (web/api/routers/thresholds.py)
        │            ↓
        │      app/src/api/client.js  getThresholds()   → the phone's live gate
        │
        └── ai/enhance/pipeline.py  gate()              → the server's quality gate
```

Both gates must read the same numbers. If they don't, the phone accepts a photo, the artisan waits
through an upload on a rural tower, and *then* the server rejects it — which is precisely the
frustration the on-device gate exists to eliminate. A second copy of these numbers anywhere is a bug
waiting for a deploy to trigger it.

The second reason is distribution. Recalibrating is a JSON edit and a server deploy. Bundling would
make it an app release, and rural users do not install app updates. This is the same argument that
governs selector packs in `docs/Application-Architecture.md` §6.4 — configuration that changes lives
on the server, always.

Where this is enforced, and what you must not "simplify":

| Place | Rule |
|---|---|
| `app/src/api/client.js:76-80` | `getThresholds()` memoises one in-flight promise. One fetch per app session, shared by every caller |
| `app/src/camera/gate.js` | **Zero imports.** Pure functions. Thresholds arrive as an argument, never as a module constant |
| `app/src/camera/useCameraGate.js:36` | `thresholds` is a required option; the effect returns early without it (`:50`) |
| `app/src/screens/Camera.jsx:74` | Renders a spinner until thresholds land. The camera does not open on guessed numbers |
| `web/api/routers/thresholds.py:26` | Strips `_`-prefixed keys, so the JSON can carry comments the client never sees |

`thresholds.py:20` reaches across into `ai/` by path. That is a deliberate, documented exception to
the "`web/` never imports `ai/`" rule in the root README — `thresholds.json` is shared *data*, not
code, and one file is the entire point.

---

## 1. The whole path, end to end

```
 ┌─ DEVICE ────────────────────────────────────────────────────────────────────┐
 │                                                                             │
 │  getUserMedia  1920x1080 ideal, facingMode environment                      │
 │        │                        useCameraGate.js:124-132                    │
 │        ▼                                                                    │
 │  requestAnimationFrame loop ── every 3rd frame (~10 Hz off 30fps preview)   │
 │        │                                                                    │
 │        ▼                                                                    │
 │  drawImage(video → 240x180 canvas)   GPU downscale, 43k px readback         │
 │        │                             NOT the full frame — see §3            │
 │        ▼                                                                    │
 │  toGray()  Rec.601 luma, integer math                                       │
 │        │                                                                    │
 │        ▼                          ┌──────────────────────────────┐          │
 │  analyse(gray, w, h, t, tilt) ◄───┤ useTilt()  devicemotion @10Hz│          │
 │        │  blur · exposure ·       │ exponentially smoothed       │          │
 │        │  framing · tilt          └──────────────────────────────┘          │
 │        ▼                                                                    │
 │  findProblem(metrics, t, {mode, relaxed})   ← the priority ladder, §4.4     │
 │        │  returns ONE problem key, or null                                  │
 │        ▼                                                                    │
 │  GateState.update(problem, now)   0.5s hysteresis, committed vs candidate   │
 │        │                                                                    │
 │        ├──► setProblem() → ring colour · shutter enabled · spoken hint      │
 │        │                                                                    │
 │        ▼  green held ≥ 1000ms                                               │
 │  shouldAutoCapture() → capture()                                            │
 │        │  3 full-res stills, 20ms apart → pickSharpest() → toBlob q0.92     │
 │        ▼                                                                    │
 │  Camera.jsx onCapture: haptic buzz → setPhoto(blob) → nav /capture/review   │
 │        │                                                                    │
 │        ▼                                                                    │
 │  🔒 stripExif(blob)   decode → canvas → re-encode. GPS gone. §6             │
 │        │                                                                    │
 │        ▼                                                                    │
 │  upload()  256KB chunks · resume from server's `received` set · backoff     │
 └────────┼────────────────────────────────────────────────────────────────────┘
          │
 ┌─ web/api ───────────────────────────────────────────────────────────────────┐
 │        ▼                                                                    │
 │  POST /uploads            → upload_id, chunk_size          uploads.py:30    │
 │  GET  /uploads/{id}       → { received: [...] }  ← resume  uploads.py:54    │
 │  POST /uploads/{id}/chunk/{i}                              uploads.py:64    │
 │  POST /uploads/{id}/complete → { url: "s3://raw/..." }     uploads.py:86    │
 │        │                                                                    │
 │        ▼                                                                    │
 │  POST /products → product_id            CaptureReview.jsx:71                │
 │  POST /products/{id}/enhance            products.py:126                     │
 │        │        httpx → AI_BASE_URL (default http://localhost:8001)         │
 └────────┼────────────────────────────────────────────────────────────────────┘
          │
 ┌─ ai/ ───┼───────────────────────────────────────────────────────────────────┐
 │        ▼                                                                    │
 │  POST /enhance   ⛔ raise NotImplementedError   ai/service.py:16            │
 │        │                                                                    │
 │        ▼  (the design, once you build it — pipeline.py)                     │
 │  gate → segment → matte → white_balance → tone → denoise_sharpen            │
 │       → composite(#FFFFFF) → crop(85% fill, 2000sq) → export(+EXIF strip)   │
 └────────┼────────────────────────────────────────────────────────────────────┘
          │
          ▼
   /catalog/prefill  polls GET /enhance/{job_id}, then:
          │
          ▼
   🔒 COLOUR LOCK  "kya yeh asli rang hai?"  → POST /products/{id}/confirm-colour
          │
          ▼
   /publish  — the big button is disabled until colour_confirmed  Publish.jsx:84
```

**Today that diagram breaks at the `ai/` box.** See §10.

---

## 2. `/camera` — the screen · `app/src/screens/Camera.jsx`

The screen is thin on purpose. It fetches thresholds, wires `useTilt()` into `useCameraGate()`, and
renders four simultaneous feedback channels. All the judgement lives in `gate.js`.

**Four feedback channels at once** (Master ref §4.6), because any one of them fails for some user:

| Channel | Code | Why it is not redundant |
|---|---|---|
| Colour | `cam__ring--ok` class, `Camera.jsx:80` | A ring around the whole frame is readable in direct sunlight at a glance |
| Icon | shutter grey vs green, `Camera.jsx:95-99` | The artisan moves until the button lights up. Zero literacy required |
| Voice | `useSpeakOnChange(problem)`, `Camera.jsx:51` | The instruction, in their language |
| Haptic | `Haptics.impact()`, `Camera.jsx:43` | Felt without looking at the screen at all |

Three details that look removable and are not:

- **`useSpeakOnChange(problem)`, not `say(problem)`** (`:49-51`). The gate re-evaluates ten times a
  second. Speaking on every evaluation produces a stutter, not a sentence. Only the *committed*
  problem, and only on change.
- **The shutter is genuinely `disabled` while red** (`:97`). This is not advice attached to a
  viewfinder. The artisan cannot take a bad photo even by trying. Auto-capture normally fires first;
  the button stays for anyone who wants to press it.
- **The white-paper hint fires at 2500ms** (`:56-59`). It has to be asked for *at capture time* — it
  is a physical instruction about the scene ("put a sheet of white paper next to the product") and it
  is useless once the photo exists. It costs nothing and buys the server a real white point to
  calibrate against (Master ref §5.2 ③).

Camera failure is mapped to two spoken keys at `useCameraGate.js:144`: `NotAllowedError` →
`camera.denied`, everything else → `camera.failed`. `Camera.jsx:65-73` renders the error *instead of*
the viewfinder, never stacked on top of it (design law rule 4: one problem at a time).

---

## 3. The capture loop · `app/src/camera/useCameraGate.js`

Plain `getUserMedia` + canvas. Deliberately **not** a camera-preview plugin: no native bridge per
frame, no base64 round-trip.

| Constant | Value | Line | Why |
|---|---|---|---|
| `GATE_W` × `GATE_H` | 240 × 180 | `:16-17` | 43k pixels instead of two million |
| `SAMPLE_EVERY` | 3 | `:18` | ~10 checks/sec off a 30fps preview, which reads as live |
| `BURST` | 3 | `:19` | Stills per capture; sharpest wins |

> ⚠️ **Do not raise `GATE_W`/`GATE_H` "for accuracy."** The `getImageData` readback is the expensive
> step in a WebView (Master ref §4.9). At 240×180 it benchmarks at 0.30ms/frame on desktop and roughly
> 6ms on a low-end phone, against a 66–100ms budget. At full resolution the readback alone costs
> ~14ms, you get ~2fps, and the feature is worthless. We are measuring the photo's **condition** —
> "is it dark", "is it blurry" — and that is just as visible at 240×180. This is the single most
> common well-intentioned change that would destroy this feature.

**Refs, not state** (`:42-47`). `tiltRef`, `capturingRef` and `onCaptureRef` change every frame. Putting
any of them in `useState` re-renders React ten times a second underneath a live video element.

**The loop** (`:101-122`) bails early in three ways before doing any work: video not ready
(`readyState < 2`), not the sampled frame (`frameNo++ % SAMPLE_EVERY`), or a capture already in
flight. Then one `drawImage` + one `getImageData` + `toGray` into a **reused** `Uint8Array` (`:61`) —
no per-frame allocation.

**`relaxed: state.isGreen`** (`:113`) is the hysteresis input. See §4.5.

**Burst-and-pick** (`:82-99`): three full-resolution stills 20ms apart, scored by `pickSharpest()`,
best one encoded at JPEG q0.92. Costs ~60ms, needs no model and no network, and removes the residual
hand-shake blur that survives the live gate. Free quality.

**Effect deps are `[thresholds, mode]`** (`:151`). Changing either tears the stream down and rebuilds
it — correct, because `GateState` is constructed from thresholds. Tilt deliberately does *not* appear
there; it flows through `tiltRef`.

---

## 4. The gate itself · `app/src/camera/gate.js`

409 lines, zero imports, no DOM, no camera. The caller supplies the downscaled grayscale buffer, the
accelerometer reading, and the thresholds. That is what makes it testable without a device, and what
keeps thresholds coming from the server rather than being duplicated as constants here.

### 4.1 `blurScore(gray, w, h)` — `:21`

Laplacian variance. For each interior pixel, `up + down + left + right − 4·centre`, then the variance
of that field. Sharp = brightness jumps hard between neighbours (a saree edge, black → white). Blurry
= everything changes gradually. High number = sharp.

⚠️ **Content-dependent.** A plain white cloth has few edges and scores "blurry" while being perfectly
sharp. Master ref §4.4 ①, the `thresholds.json` comment and the code comment at `:190-191` all say
this should therefore be a *suggestion*, never a hard block. **It is currently a hard block** — see
§11, discrepancy 1.

### 4.2 `exposure(gray)` — `:44`

One 256-bucket histogram, three signals out:

| Signal | Computed from | Why it matters more than the mean |
|---|---|---|
| `mean` | intensity-weighted sum ÷ pixels | Under/over-exposed overall |
| `blownFraction` | buckets 250–255 | **A blown-out white region contains no information at all.** No server-side AI recovers it |
| `crushedFraction` | buckets 0–5 | Same, at the black end |

This is why light is checked before everything else in the ladder: blur can be partly sharpened,
clipped highlights are gone forever.

### 4.3 `framing(gray, w, h, busyRatio)` — `:70`

We do not detect the product. We detect **where something is happening**. 12 × 9 = 108 cells
(`GRID_COLS`/`GRID_ROWS`, `:17-18`), variance per cell. Empty floor or wall → flat → low variance. A
woven product → texture, pattern, edges → high variance.

The cell cutoff is `maxVar × busyRatio` — **relative to the busiest cell, not absolute** (`:101`). That
one choice is why a dark matka and a bright dupatta both work without recalibration. Bounding box
around the surviving cells → `fraction` (box area ÷ frame area), `offsetX`/`offsetY` (distance of the
box centre from frame centre, 0–0.5 each).

Returns `found: false` when the frame is perfectly flat (`maxVar === 0`) or no cell clears the cutoff.
`findProblem` treats that identically to "too far" — there is nothing to photograph.

Master ref §4.4 ④ considered a 160×160 TFLite segmentation model instead. Decision (`docs/decisions.md`
#4): build the cheap one. It handles ~80% of cases, especially when the product is on a plain surface,
which is what we are telling them to do anyway.

### 4.4 `tiltFrom({x, y, z})` — `:142`

Trigonometry on the gravity vector. **Completely free** — it rides a separate event stream and does no
image work at all.

- `pitch = atan2(z, hypot(x, y))` — the camera axis relative to horizontal. **90 = looking straight
  down** (what a dhurrie or pattachitra on the floor wants). **0 = looking straight ahead** (what a
  standing matka or murti wants).
- `roll = atan2(x, y)` — horizon tilt.

Roll is *meaningless* when the phone is near-horizontal: `x` and `y` both collapse toward zero and the
angle becomes numerically unstable. That is exactly the `mode === 'flat'` case, and that is exactly
when `findProblem` skips the roll check (`:210-213`).

Pass `accelerationIncludingGravity` straight through — no unit conversion, no normalisation.

### 4.5 `findProblem(metrics, t, { mode, relaxed })` — `:180`

**Returns the single highest-priority problem, or `null` when the frame is good.** The ladder:

```
1.  exposure.mean        < brightness_mean_min          → photo.too_dark
2.  exposure.crushedFrac > crushed_pixel_fraction_max   → photo.too_dark
3.  exposure.mean        > brightness_mean_max          → photo.too_bright
4.  exposure.blownFrac   > blown_pixel_fraction_max     → photo.too_bright
5.  blur                 < blur_laplacian_variance_min  → photo.blurry
6.  !frame.found || fraction < fill_fraction_min        → photo.too_far
7.  frame.fraction       > fill_fraction_max            → photo.too_close
8.  |offsetX| or |offsetY| > center_offset_max          → photo.off_centre
9.  |pitch − targetPitch| > tilt_degrees_max            → photo.tilted
10. |roll| > tilt_degrees_max   (standing mode only)    → photo.tilted
── none of the above ──────────────────────────────────→ null  🟢
```

`targetPitch` is 90 in `mode: 'flat'`, 0 in `mode: 'standing'` (`:206`). `mode` comes from the draft
store via `Camera.jsx:32`.

> **Why one problem and not four.** "Photo blurry hai, andhera hai, phone tedha hai, product door hai"
> is how this feature gets the app uninstalled (Master ref §4.5, design law rule 4). Only reveal the
> next problem once the current one clears. Light comes first because every other check is meaningless
> in the dark — the self-test asserts exactly this at `gate.js:362-363`.

**`relaxed` — asymmetric thresholds.** `const s = relaxed ? t.hysteresis_slack : 1` (`:181`). Minimum
thresholds are divided by `s`, maximum thresholds multiplied by it, so a slack of 1.25 widens the
green band by 25% in both directions. The caller passes `relaxed: state.isGreen`
(`useCameraGate.js:113`) — **different thresholds entering green than leaving it.** A borderline frame
that just went green does not immediately bounce back out.

### 4.6 `Smoothed` — `:154`

`new = (1 − α)·old + α·reading`, α = 0.1. The accelerometer jitters constantly even when the phone is
perfectly still; without this the on-screen indicator vibrates and users give up (Master ref §4.4 ③).
First reading seeds the value rather than being blended with zero.

### 4.7 `GateState` — `:226`

Two-level debounce, one level above the threshold hysteresis:

- `committed` — what the UI shows. **Initialised to `photo.too_dark`** (`:229`), never `null`. The
  shutter is never open on frame one.
- `candidate` + `since` — the state currently trying to take over. A candidate must hold for
  `state_hold_seconds` before it is committed.
- `greenSince` — set when `committed` becomes `null`, cleared otherwise.

`shouldAutoCapture(nowMs)` (`:258`) is true once green has held **1000ms** — a hardcoded literal, not
a threshold, deliberately: it is a UX constant, not a calibration.

Timestamps are passed in rather than read from the clock, which is what makes the whole class
testable without waiting in real time.

### 4.8 `pickSharpest(frames)` — `:269`

Returns the **index** of the frame with the highest `blurScore`. Callers index back into their own
array to keep the full-resolution canvas (`useCameraGate.js:91`).

### 4.9 `analyse(gray, w, h, t, tilt)` — `:283`

Runs all four checks over one frame and returns `{ blur, exposure, frame, tilt }`. `tilt` is passed
through untouched, so a device with no accelerometer yields `null` and the ladder simply skips steps
9 and 10 (`:205`).

---

## 5. Tilt · `app/src/camera/useTilt.js`

```
devicemotion (60Hz)  →  tiltFrom()  →  two Smoothed filters  →  throttle to 10Hz  →  setTilt()
```

The filters see **every** raw sample; only the React state update is throttled to 100ms (`:29-32`).
Smoothing quality is unaffected and we do not re-render sixty times a second.

**iOS 13+** gates `DeviceMotion` behind a user gesture, so `:38-42` calls
`DeviceMotionEvent.requestPermission()` when it exists. Android and Capacitor's WebView fire the event
immediately, so the `else` branch just listens. We target Android first; the iOS branch is there so
the hook is not a landmine later.

### What happens on a device with no accelerometer

Nothing breaks, and nothing is bypassed:

| Step | Behaviour |
|---|---|
| `devicemotion` never fires, or fires with `g.x === null` | Guard at `useTilt.js:22` returns early |
| `useTilt()` returns | `null` — the initial state, forever |
| `analyse(..., tilt = null)` | `metrics.tilt` is `null` |
| `findProblem` `:205` | `if (tilt)` is false → the tilt checks are **skipped entirely** |
| Net effect | The gate runs on light, blur and framing only. It is slightly more permissive, never stuck |

This matters for two real cases: a desktop browser (which is why `app/README.md` warns the gate cannot
be meaningfully tested on a laptop webcam) and cheap handsets with no motion sensor. The failure mode
is degradation, never a red state the artisan cannot clear — which is the same principle as
`enhance.failed` degrading to the artisan's own photo.

---

## 6. Upload · `app/src/api/upload.js` → `web/api/routers/uploads.py`

### 6.1 🔒 EXIF-GPS strip — a privacy requirement, not an optimisation

```js
// app/src/api/upload.js:27
export async function stripExif(blob) { … createImageBitmap → canvas → toBlob … }
```

**An artisan's home GPS coordinates must never reach a public listing.** That is not a bug we get to
fix after the fact — once the coordinates are on a listing that has been crawled, they are public
permanently, and the people this product serves are the people least able to absorb that.

The mechanism is deliberately blunt: decode to a canvas and re-encode. That discards **every** metadata
block. There is no EXIF parser to keep correct and no tag we forgot to clear — a whitelist-based
stripper would be smaller code and would fail the first time a vendor wrote GPS into a maker note.

Rules for anyone touching this path:

- **Every** upload path calls `stripExif` first. `CaptureReview.jsx:47-50` does it before `upload()`,
  and the comment there is load-bearing: photos from `useCameraGate` are already canvas-encoded and
  therefore already clean, **but this path must not depend on that staying true.** Any future
  gallery-picker, retake-from-file or share-target flow needs the same call.
- Do not "skip the re-encode when the source is our own canvas." That optimisation saves a few hundred
  milliseconds once and removes the guarantee permanently.
- The re-encode quality (0.92) matches the capture encode, so this is not a second generation loss of
  any consequence.

The server-side `export()` stage in `ai/enhance/pipeline.py:74` strips again on every channel variant.
Belt and braces, on purpose — the two strips protect different failure modes (a compromised or
bypassed client vs. metadata we add ourselves during processing).

### 6.2 Resumable chunked upload

This replaces the offline queue from the v1 spec. **We are online-first** (`docs/decisions.md`,
Application-Architecture §0 decision 1): there is no local database and no sync engine. What this does
handle is the connection dropping in the middle of a 3MB photo on a rural tower.

| Constant | Value | Where |
|---|---|---|
| `CHUNK` | 256 KB | `upload.js:12` (server echoes the same at `uploads.py:44`) |
| `MAX_ATTEMPTS` | 5 per chunk | `upload.js:13` |
| Backoff | `min(1000 · 2^(n−1), 8000)` ms | `upload.js:81` |
| `MAX_BYTES` | 25 MB → HTTP 413 | `uploads.py:21` |

Sequence:

```
POST /uploads {size, chunks, content_type}   → { upload_id, chunk_size }
GET  /uploads/{id}                           → { received: [0,1,2], chunks, url }
     └─ the resume point. Fresh upload = []; after a drop, this is how we
        avoid re-sending the first two megabytes.  upload.js:57
for each chunk not in received:
     POST /uploads/{id}/chunk/{i}  (multipart)  with retry + backoff
POST /uploads/{id}/complete                  → { url: "s3://raw/{id}" }
     └─ 409 with the missing indices if any chunk is absent.  uploads.py:93-95
```

**Retry classification** (`upload.js:78`) is the part to preserve: a 4xx means this request is wrong
and will stay wrong, so only transport failures (`ApiError` status 0, produced by `client.js:48`) and
5xx are retried. Retrying a 4xx just hammers the API for no reason.

**Never a silent spinner.** `onProgress` fires per chunk; `CaptureReview.jsx:53-60` speaks at
*quarters* only, because speaking every 256KB chunk would talk over itself for the entire upload and
tell the artisan nothing new. `onRetry` speaks its own reason (`net.retrying` / `net.offline`).

**Two open server-side TODOs, stated plainly:**

1. `uploads.py:76-77` — `await chunk.read()` and throws the bytes away. Nothing is persisted yet. The
   TODO says "stream to object storage as a multipart part rather than buffering", and the `s3://raw/`
   URL at `:96` is synthesised, not real.
2. **No endpoint links an upload to a product.** `CaptureReview.jsx:66-70` documents this: the product
   row is created with the URL held only in the client draft, so `POST /products/{id}/enhance`
   currently answers `400 "no raw image"` at `products.py:135`. That is caught, not fatal.

---

## 7. Enhancement · `ai/enhance/` and `ai/contracts.md`

### 7.1 The contract

Async, because enhancement takes ~20s and that is not a request.

```
POST /enhance  { product_id, image_url, targets: ["amazon","gem","whatsapp"] }
  → 202  { job_id, status: "queued" }

GET /enhance/{job_id}
  → { status: "done", images: [{ target, url, width, height, is_primary }],
      warnings: ["colour shifted during white balance — confirm with artisan…"] }

  → { status: "rejected", reason: "resolution_below_1000px",
      message_key: "photo.too_small" }
```

`reason` is for us; **`message_key` is for the artisan.** `"resolution_below_1000px"` cannot be spoken
in Odia; `photo.too_small` can. `CatalogPrefill.jsx:83-88` reads exactly that field.

### 7.2 The pipeline design · `ai/enhance/pipeline.py`

Every function in this file is `raise NotImplementedError`. The file is a specification with a
rejection-reason mapping in its header — build backwards from the list of things marketplaces reject.

| Stage | Line | What it must do | The rejection it defeats |
|---|---|---|---|
| `gate` | `:18` | Resolution, blur, extreme exposure — **before** any GPU is spent. Reads `../thresholds.json` | blurry / under 1000px |
| `segment` | `:23` | BiRefNet baseline, SAM 2 tap-to-refine when auto fails | — |
| `matte` | `:31` | Alpha matting with trimap refinement | Binary masks slice the pallu off muslin, net, chanderi |
| `white_balance` | `:40` | Calibrate from the white reference paper if present, then crop it out | **Inaccurate colour vs. what ships** |
| `tone` | `:50` | Auto-levels, shadow lift, CLAHE — **product region only** (we have the mask) | — |
| `denoise_sharpen` | `:55` | Weave, knot and grain must pop. Texture *is* the selling point | — |
| `composite` | `:60` | Pure `#FFFFFF`. **Sample corner pixels and assert** | Marketplaces flag (252,252,252) even when the eye can't tell |
| `crop` | `:69` | Bounding box → padding → 85–90% fill → square 2000×2000. Pure math, no AI | Product not filling 85% of frame |
| `export` | `:74` | Per-channel variants + EXIF strip | Wrong dimensions per channel |

`ai/enhance/studio.py` is the opt-in generative layer, also entirely stubbed. Three rules from its
header that are not negotiable: generated images are **always secondary, never primary** (a generated
main image is "inaccurate representation" and gets the listing pulled); generation is opt-in and
hard-capped (2 per artisan, or unlocked after first sale); `detail_crops()` derives from the mask, so
it is free and needs no generation at all.

The architectural rule from `docs/Application-Architecture.md` §7.2 governs the generative layer:
**outpaint, never inpaint, then composite the original subject pixels back verbatim.** That turns
"never change colour or shape" from a hope into a mathematical guarantee.

---

## 8. 🔒 The colour lock

### Why it is a hard gate

White balance moves colour. That is what it is *for*. On a natural-dye product it can move colour out
of truth — a madder-red or a maroon Sambalpuri shot under a tungsten bulb gets pulled towards orange
(Master ref §5.2 ③). The buyer receives something that does not match the listing, and the artisan
eats a return, a refund, and a rating they will never recover.

Practically: **return rate destroys artisan income.** Legally: **misrepresentation is a listing
violation.** Both point the same way, which is why Master ref §5.6 calls this the line we do not cross.

Only the person holding the object can settle whether the colour is right. So we ask them.

### How it is enforced

| Step | Code | Detail |
|---|---|---|
| Ask, by voice | `CatalogPrefill.jsx:174` | `colour.confirm` — *"kya yeh asli rang hai?"* Rendered as a `YesNo`, spoken on entry |
| Record on the server | `POST /products/{id}/confirm-colour` → `products.py:96-111` | Sets `Product.colour_confirmed = True` (`models.py:174`) |
| Only then set the local flag | `CatalogPrefill.jsx:112-113` | **Order matters.** A dropped POST that still unlocked the button would defeat the whole mechanism. It is a publish gate, so it must reflect what the server knows, not what this phone hoped |
| Block publish | `Publish.jsx:84` | `disabled={busy \|\| !draft.colourConfirmed \|\| oneTap.length === 0}` |
| Say why it is blocked | `Publish.jsx:91-93` | The `colour.confirm` warning, so a disabled button is never unexplained |
| "No" is not an error | `CatalogPrefill.jsx:143-149` | Says `colour.retake` and navigates to `/camera`. We cannot un-enhance server-side, and re-shooting with the white-paper reference is the only thing that actually fixes white balance |

`GET /api/products` also returns `colour_confirmed` per product (`products.py:68`), so the catalog can
show which listings are still gated.

**If you are building a new workflow that reaches `/publish`, it must respect `colour_confirmed`.**
An enhancement that shifts a natural-dye colour and ships anyway is a returned order and a bad review,
and the artisan carries both.

---

## 9. Every threshold, and what moving it does

From `ai/thresholds.json`. `_`-prefixed keys are comments and are stripped before the client ever sees
them (`thresholds.py:26`).

### Shared — read by both the app gate and the server gate

| Key | Value | What it does | Raise it → | Lower it → |
|---|---|---|---|---|
| `blur_laplacian_variance_min` | 100 | Minimum Laplacian variance to pass as sharp | Stricter. Plain-weave and flat-colour products (white cloth, undecorated pottery) get stuck on `photo.blurry` with nothing they can do | Motion-blurred photos pass, reach the server, and produce a soft 2000px listing image |
| `brightness_mean_min` | 60 | Underexposure floor | Rejects evening and indoor shots. Many artisans work indoors — this is the threshold most likely to lock someone out entirely | Dark, noisy photos pass; `denoise_sharpen` cannot invent detail that was never captured |
| `brightness_mean_max` | 200 | Overexposure ceiling | Rejects legitimate shots of white/cream textiles on white cloth — a common and correct setup | Washed-out photos pass |
| `blown_pixel_fraction_max` | 0.05 | Max fraction of pixels at 250–255 | Stricter about clipped highlights. Zari, mirror-work and metal *legitimately* produce specular highlights; too strict and brassware becomes unphotographable | Detail in the highlights is permanently lost and no server stage recovers it |
| `crushed_pixel_fraction_max` | 0.05 | Max fraction at 0–5 | Rejects dark products against dark backgrounds (a black terracotta on a mud floor) | Shadow detail lost the same way |
| `fill_fraction_min` | 0.40 | Min share of the frame the busy box must cover | Forces the artisan closer. Below the raw crop budget, `crop()` cannot reach 85% fill without upscaling | Product photographed too small; the 2000×2000 crop upscales and looks soft |
| `fill_fraction_max` | 0.90 | Max share before "step back" | More permissive on tight shots | Edges get cut off, and `crop()` has no padding to work with |
| `tilt_degrees_max` | 8 | Max deviation from the target pitch (and roll, standing only) | Very hard to satisfy handheld; the gate sits red on `photo.tilted` | Perspective distortion the server's (unimplemented) `perspective correction` stage would have to fix |
| `resolution_min_px` | 1000 | Server-side minimum. **Below 1000px marketplaces disable zoom, which directly hurts conversion** | Rejects more phones | Listings with zoom disabled |
| `state_hold_seconds` | 0.5 | How long a candidate state must hold before it commits | Sluggish, unresponsive feel | Below ~0.3 the ring and the voice flicker and the app looks broken |

⚠️ `resolution_min_px` is served to the client but **the app gate never reads it** — nothing in
`gate.js` or `useCameraGate.js` references it. The camera requests 1920×1080 ideal, so it is
effectively satisfied by construction. It is the server gate's threshold (`pipeline.py:18`), and it
maps to `photo.too_small` in `en.json:10`.

### Camera-only — the server has no preview frames to run these against

| Key | Value | What it does | Raise it → | Lower it → |
|---|---|---|---|---|
| `cell_busy_ratio` | 0.2 | Cell counts as "busy" at ≥ 20% of the busiest cell's variance | Only the strongest texture counts; a subtle-weave product reads as a smaller box → spurious `photo.too_far` | Background texture (a patterned floor, a rug) joins the box → spurious `photo.too_close` and a wrong centre |
| `center_offset_max` | 0.15 | Max distance of the box centre from frame centre, per axis (0–0.5) | More permissive framing | Below ~0.1 the artisan chases a target they cannot hit handheld |
| `hysteresis_slack` | 1.25 | Threshold widening while already green | Green becomes very sticky — a genuinely degraded frame stays green too long and a bad photo gets captured | At 1.0 hysteresis is off and borderline frames oscillate red/green ten times a second |

**Recalibration procedure.** Numbers were calibrated in `research/camera-thresholds/` on our own
artisan photos (the `_comment` in the JSON says so; the directory currently holds only a `.gitkeep`).
To change one: edit `ai/thresholds.json`, run the gate self-test, redeploy the API. Both gates pick it
up. Do not edit a copy in the app — there isn't one, and adding one is the failure mode §0 exists to
prevent.

---

## 10. Current state — read this before you plan your first day

**`POST /products/{id}/enhance` does not work today.** Not "is slow", not "is unreliable" — it cannot
succeed. Three independent reasons, all verified:

| # | Claim | Verified how |
|---|---|---|
| 1 | Every endpoint in `ai/service.py` is `raise NotImplementedError` — `/enhance` (`:16`), `/enhance/{job_id}` (`:20`), `/catalog` (`:27`), `/catalog/prefill` (`:33`), `/price` (`:38`). Only `/health` returns anything | Read the file |
| 2 | There is no `ai/.venv`. `ai/requirements.txt` has never been installed | `ls -a ai/` |
| 3 | Nothing listens on port 8001. `AI_BASE_URL` defaults to `http://localhost:8001` (`config.py:37`, `.env.example:7`), so `products.py:119-123` raises a connection error | `ss -ltn` — only :8000 (the web API) is bound |
| 4 | Every stage of `ai/enhance/pipeline.py` and `ai/enhance/studio.py` is `raise NotImplementedError` | Read both files |
| 5 | `ai/worker.py` — the queue consumer the ~20s job needs — is also `raise NotImplementedError` | Read the file |
| 6 | Independently of all of the above, no endpoint links an upload to a product, so `products.py:133-135` would answer `400 "no raw image"` even with the AI service running | Grepped every `@router` in `web/api/routers/` |
| 7 | `GET /enhance/{job_id}` is **not proxied by `web/api` at all** — no such route exists. `CatalogPrefill.jsx:76` calls the contract path and it 404s | Same grep |

### What the artisan actually experiences today

`CaptureReview.jsx:76-83` catches the failure and stores `enhanceJobId = null`. `CatalogPrefill.jsx:69`
sees no job id and calls `degrade()` (`:63-66`), which speaks **`enhance.failed`** and moves straight
to the colour lock:

| Language | String |
|---|---|
| `hi` | तस्वीर सुधर नहीं पाई। आपकी अपनी तस्वीर चलेगी |
| `en` | We could not improve the photo. We will use your own photo |
| `or` | ଫଟୋ ଭଲ ହୋଇପାରିଲା ନାହିଁ। ଆପଣଙ୍କ ନିଜ ଫଟୋ ବ୍ୟବହାର ହେବ |

**The flow completes.** The artisan's own photo is used, the colour lock still runs, and they can
publish. This is deliberate — "losing the enhancement costs us a prettier photo; it must never cost
the artisan the listing" (`CaptureReview.jsx:80-82`). Note also that `degrade()` is `await`ed so the
sentence finishes before the colour question interrupts it.

⚠️ `degrade()` is the *common path in dev*, not an error path. Do not treat hearing `enhance.failed`
during development as a bug you have introduced.

### What you have to implement to make it work

In dependency order:

1. **Persist chunks.** `uploads.py:76` currently discards them. Write to object storage (or the local
   filesystem for dev) and make `complete()` return a URL that actually resolves.
2. **Link the upload to the product.** Add the endpoint that writes a `ProductImage` row with
   `size_variant = "raw"` — that is exactly what `products.py:133` looks for. Without this, nothing
   downstream can start.
3. **Implement `ai/enhance/pipeline.py`.** `gate()` first (it is cheap, it is pure numpy, and it saves
   GPU on everything else), then `crop()` and `composite()` (pure math, no models, and between them
   they defeat two of the most common rejection reasons). `segment()`/`matte()` need BiRefNet and are
   the real work. `docs/decisions.md` #1 is still open — benchmark BiRefNet / SAM 2 / rembg on our own
   test images in `research/segmentation/` before committing.
4. **Implement `ai/service.py` `/enhance` and `/enhance/{job_id}`** to the shapes in `ai/contracts.md`.
   `POST` must return **202 with a job id**, not the result — the app is built to poll.
5. **Implement `ai/worker.py`.** A ~20s job cannot be a request.
6. **Add the `GET /enhance/{job_id}` proxy in `web/api`.** The app calls `/api/enhance/{job_id}` and
   nothing serves it. This one is a handful of lines and unblocks the entire polling path.

Keep the degrade path working the whole time. `CatalogPrefill.jsx:74-75` puts it well: today's 404
behaviour "is exactly the behaviour we want the day the AI box is unreachable in production too."

### Running the AI service once you have implemented it

```bash
cd ai
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn service:app --reload --port 8001      # must be 8001 — see config.py:37
```

`ai/README.md` says `uvicorn service:app --reload`, which defaults to port **8000** and collides with
the web API. Use `--port 8001`, or set `AI_BASE_URL` in `web/api/.env` to match whatever you run.

Full local stack:

```bash
# API           http://localhost:8000/docs
cd web/api  && .venv/bin/uvicorn api.main:app --reload --app-dir ..
# AI service    http://localhost:8001/docs
cd ai       && .venv/bin/uvicorn service:app --reload --port 8001
# Artisan app   http://localhost:5173   (open on a phone on the same LAN)
cd app      && npm run dev
```

### Running the camera gate self-test

**19 assertions** (counted in the file and in its output — if you have seen "14 asserts" quoted
somewhere, that number is stale). **No device, no browser, no test framework, no dependencies** — it is
a plain `node` run of the file itself, guarded at `gate.js:409`.

```bash
node app/src/camera/gate.js      # from the repo root
# or
cd app && npm test               # package.json: "test": "node src/camera/gate.js"
```

Verified passing. Expected output:

```
camera gate
  ok  dark frame -> too_dark
  ok  blown frame -> too_bright
  ok  no texture -> blurry
  ok  small product -> too_far
  ok  product fills frame -> too_close
  ok  well-framed textured product -> green
  ok  dark beats blur in the ladder
  ok  phone face-down -> pitch 90
  ok  phone upright -> pitch 0
  ok  dhurrie shot from above -> green
  ok  matka shot from above -> tilted
  ok  accelerometer smoothing settles on the mean
  ok  sustained good frames -> green
  ok  green held past 1s -> auto-capture
  ok  one bad frame does not break green
  ok  flicker absorbed
  ok  sustained bad frames -> red
  ok  red never auto-captures
  ok  burst picks the sharpest frame
all passed
```

The synthetic frames come from `frame(bg, span, texA, texB)` at `gate.js:321` — a flat field with an
optional checkerboard "product" covering `span` of each dimension. If you add a check to the ladder,
add an assert here; it costs nothing to run and it is the only thing standing between you and a
regression you cannot reproduce without a phone in a specific light.

⚠️ **The self-test uses its own hardcoded threshold object** (`gate.js:302-315`), currently identical
to `ai/thresholds.json`. That is correct — the test must be independent of a file that is meant to be
recalibrated. It also means the test will not tell you that you have broken a threshold value.

> **The gate cannot be meaningfully tested in a desktop browser** (`app/README.md`). Framing assumes a
> product on a plain surface and the tilt check needs a real accelerometer. `vite.config.js` sets
> `server.host: true` so a phone on the same LAN can load the dev server — use that, not your laptop
> webcam.

---

## 11. Discrepancies found while writing this

Documented rather than fixed, because this is a read-only handoff. All three are verified.

1. **Blur hard-blocks the shutter, contrary to three separate comments saying it must not.**
   `gate.js:190-191`, the `_comment` in `ai/thresholds.json`, and Master ref §4.4 ① all state that blur
   is content-dependent and must be a *suggestion*, never a hard block. In code, `findProblem` returns
   `'photo.blurry'` (`gate.js:192`), which makes `committed` non-null, which makes `isGreen` false,
   which disables the shutter (`Camera.jsx:97`) **and** prevents auto-capture. A plain white cloth or
   an undecorated pot can therefore be genuinely unphotographable. Either the comments or the code is
   wrong; decide which before you build on top of this.
2. **`resolution_min_px` is served to the app but never read by it.** Harmless today (the camera
   requests 1920×1080), but a reader will reasonably assume the app enforces it.
3. **`ai/README.md`'s run command uses the default port 8000**, which collides with the web API that
   `AI_BASE_URL` expects on 8001.

---

## 12. If you are building a new workflow on this

The parts that are load-bearing, in one list:

- Thresholds come from the server. Never bundle, never hardcode, never keep a second copy (§0).
- 240×180 is a performance floor, not a placeholder (§3).
- One problem at a time, and light before everything else (§4.5).
- Hysteresis in two places: asymmetric thresholds (`hysteresis_slack`) *and* time-based commit
  (`state_hold_seconds`). Removing either makes the UI flicker (§4.5, §4.7).
- `stripExif` runs on every upload path, unconditionally (§6.1).
- Retry transport and 5xx only, never 4xx (§6.2).
- Nothing publishes without `colour_confirmed` (§8).
- Every failure degrades and speaks. Nothing is a silent spinner, and no AI outage costs the artisan
  their listing (§10).

`gate.js` is pure and importable from anywhere — no DOM, no camera, no imports. If your workflow needs
to score a still image (a gallery pick, a re-check before publish, a server-side JS path), call
`analyse()` and `findProblem()` directly with your own grayscale buffer. That is what the shape of
that file is for.
