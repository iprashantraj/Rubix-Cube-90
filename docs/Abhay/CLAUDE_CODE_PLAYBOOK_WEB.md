# Claude Code Playbook — Vite + React + Capacitor

Drives the build in `IMAGE_PIPELINE_SPEC_WEB.md`.

> ⚠️ **Superseded in part.** This document was written before the repository existed and
> assumes the image processing runs on the device. It does not. Read
> `docs/Abhay/PIPELINE-RECONCILIATION.md` first — it says which sections of this file are
> still authoritative, which have moved into `ai/enhance/`, and which are withdrawn.

---

## Part 0 — Setup before any prompt

### 0.1 CONTRIBUTING.md in the repo root

Claude Code reads this at the start of every session. Without it you re-explain
the project each time and it drifts.

```markdown
# Project

AI cataloging app for artisans (SIH PS 26090). Voice + camera in, published
marketplace listing out. User may not read, may have no network for days.

Image pipeline spec: IMAGE_PIPELINE_SPEC_WEB.md — read before any image work.

# Stack

Vite + React + TypeScript, packaged for Android with Capacitor.
Processing runs in the WebView: OpenCV.js (WASM) for colour, ONNX Runtime Web
for segmentation. Server is FastAPI + PostgreSQL.

# Platform constraints — do not try to work around these

- No NPU/NNAPI access from WebView. Segmentation is ~300ms-1s, not 50ms.
- No reliable background execution when the app is closed. Sync is
  foreground-triggered only. Do not claim true background sync.
- getImageData is a blocking GPU readback. Frame sampling is ~5fps, not 30fps.
- Never process at full sensor resolution. Downscale to 2000px first.

# Non-negotiable rules

1. Artisan is never blocked and never sees a blank state. Progressive reveal
   is mandatory (spec §1.2). Total target under 3 seconds.
2. Never fabricate product detail. No super-resolution, generative backgrounds,
   diffusion relighting, or saturation boost > 10%.
3. Never destroy the original. Store a recipe, render on demand.

If a task conflicts with these, stop and flag it. Do not silently resolve.

# Rejected approaches — do not propose these

Real-ESRGAN, generative backgrounds, diffusion relighting, virtual models,
auto fabric-type detection, aggressive denoise, SAM 2, EdgeSAM (post-MVP),
Web Speech API for Indic TTS, service worker for offline, full-res WASM
processing. Reasons in spec §13.

# Working style

- Plan before code. Show the plan, wait for approval.
- One milestone per session.
- All tunable numbers live in src/config/thresholds.ts. Never inline a
  threshold anywhere else.
- Heavy work goes in Web Workers. The UI thread must never block.
- Every OpenCV.js Mat must be explicitly deleted in a finally block.
- Prefer boring, readable code. This must be debuggable at 3am by a teammate
  who didn't write it.
- Do not add features not in the spec. Ask first.
```

### 0.2 Fixture images — collect before you prompt anything

25–30 real photos in `fixtures/`:

- 5 clay pots / brass, clean edges → must route to Tier A
- 5 fringed textiles → must route to Tier C
- 5 patterned or low-contrast backgrounds → hard cases
- 5 deliberately bad: blurry, too dark, blown out → must be rejected
- 5 good textiles with reasonable edges → should route to Tier B

Every threshold in the spec is a guess until tested against these.

---

## Part 1 — M0: Python prototype (day 1)

This is throwaway code with one deliverable: a calibrated `thresholds.ts`.
Do not skip it. Tuning eight constants inside a Capacitor rebuild loop will
cost you days.

### Prompt 1.1

```
Read IMAGE_PIPELINE_SPEC_WEB.md fully, especially §14 and §15.

Build a throwaway Python prototype in prototype/ that implements the quality
checks (§3.1, §4), colour correction (§5), segmentation with rembg u2netp (§6.1),
confidence scoring (§6.2), and the three tier renders (§6.3, §6.4).

Then write a calibration script that runs over every image in fixtures/ and
prints a table: filename, blur score, dark fraction, bright fraction, mask
confidence, each component score from maskConfidence, and the assigned tier.

Also write out a contact sheet per image showing original / colour-corrected /
all three tier renders side by side.

Keep every tunable constant in one module at the top. Show me your plan first.
```

### Prompt 1.2 — after you look at the output

```
Here are the corrected thresholds: [your values]

Update the prototype, re-run the calibration, and confirm that:
- all 5 bad photos are rejected
- all 5 pots route to Tier A
- all 5 fringed textiles route to Tier C

If any are misrouted, show me which component score in maskConfidence is
causing it before changing weights.

Then emit src/config/thresholds.ts with the final calibrated values and inline
comments explaining what each one controls.
```

**This verification is the make-or-break check of the whole build.** If a pot
lands in Tier C or a fringed saree lands in Tier A, your "the system grades its
own confidence" demo does not work. Fix it here.

Save the contact sheets — they are your PPT before/after images.

---

## Part 2 — M1: Foundation (days 2–3)

### Prompt 2.1 — Scaffold and storage

```
Scaffold the app: Vite + React + TypeScript + Capacitor targeting Android.

Then implement the data model from spec §2 and nothing else:

- Recipe type with serialization
- Capacitor Filesystem wrapper for binary assets under products/{id}/
- IndexedDB (or SQLite) for the products, corrections and uploadQueue stores
- A renderer stub that throws NotImplemented

Requirements:
- original.jpg must be write-once. Add a guard that throws loudly if anything
  attempts to overwrite it.
- Vitest tests for recipe round-trip and the write-once guarantee.

Show me your plan before writing code.
```

### Prompt 2.2 — OpenCV.js loader

```
Implement src/processing/opencv.ts:

- Lazy-load the OpenCV.js WASM module in the background at app start
- Expose a ready promise; the app must gate its ready state on it
- Provide a helper that wraps a function with automatic Mat cleanup, so callers
  cannot leak. Something like withMats(fn) that tracks created Mats and deletes
  them in a finally block.

Per spec §5.3, Mat leaks are the most common OpenCV.js bug and will OOM the app
after ~10 photos. Make it hard to leak by design, not by discipline.

Write a test that creates and processes 50 images in a loop and asserts memory
does not grow monotonically.
```

That memory test is acceptance criterion #10 and the failure most likely to go
unnoticed until demo day.

### Prompt 2.3 — Camera

```
Implement spec §3 guided capture using @capacitor-community/camera-preview.

First: check the plugin's current API in node_modules and tell me what it
actually supports for focus control and capture resolution. The spec assumes
capabilities that may have changed across versions — do not implement against
assumptions.

Then:
- Native preview behind a transparent WebView, React overlay on top
- Frame sampling every ~200ms into a Web Worker using OffscreenCanvas
- Blur + exposure checks on 160x120 grayscale frames
- Green/red border, audio prompt announcing the specific reason
- Single large shutter button, no settings or menus
- Tap-to-set white reference patch

Use the calibrated values from src/config/thresholds.ts. Do not invent new ones.
Log per-frame analysis time in dev builds.
```

### Prompt 2.4 — Downscale, gate, colour

```
Implement spec §4 and §5.

- Multi-step halving downscale to a 2000px long edge (§9.2)
- Full-quality quality gate on the downscaled image
- OpenCV.js colour correction: white balance, CLAHE on L channel of LAB, gamma
- All parameters written to the Recipe, never applied destructively
- Every Mat released via the withMats helper

Budget is under 500ms on a 2000x2000 image. Instrument it and report the actual
timing on a real device. If it exceeds budget, tell me before optimising — we
may move gamma and white balance to a WebGL shader.
```

---

## Part 3 — M2: Segmentation and quality (days 4–5)

### Prompt 3.1 — Model and worker

```
Set up U2Netp with ONNX Runtime Web in a Web Worker.

- Backend selection at runtime: WebGPU -> WebGL -> WASM SIMD+threads,
  logging which was chosen
- float32 or float16 weights, NOT INT8 (spec §6.1)
- Warm the session at app start with a dummy inference to avoid cold start
- Keep the mask soft, do not threshold

Then write a benchmark that runs all fixtures through each available backend
and reports per-image latency. I need to know what we're actually getting on
the target device before we design the reveal timing around it.
```

### Prompt 3.2 — Confidence, tiers, shadow

```
Implement spec §6.2, §6.3, §6.4.

- maskConfidence exactly as specified, running on a 256px downscaled mask
- The three tier renders on canvas
- Contact shadow for Tier A

Then verify against fixtures: pots must hit Tier A, fringed textiles Tier C.
Report any misroutes with component scores before adjusting anything.

Build the contact shadow early — it is the largest visual quality gain per line
of code in the pipeline.
```

### Prompt 3.3 — Progressive reveal

```
Implement the three-stage progressive reveal from spec §1.2:

- Captured frame shown immediately
- Colour-corrected version fades in when ready
- Tier treatment applies when segmentation completes

Hard requirement: no spinner over the image, no blank state, at any point.
Each stage replaces the previous in place.

Add a dev overlay showing per-stage timing so I can verify the reveal timings
against acceptance criterion #2.
```

### Prompt 3.4 — Review UI

```
Implement spec §7.1 and §7.2:

- Three tier results as ~300px thumbnails side by side, tap to choose
- Never display "Tier A/B/C" or any technical label
- Confidence sets the default; record tierSource when overridden
- Erase/restore brush painting on a separate mask canvas
- Re-composite on stroke end, not on every pointer move
- Every stroke logged to the corrections store per §8

Constraint: every action on this screen must be completable without reading any
text. Walk through the screen and tell me if anything violates that.
```

Include that last line on every UI prompt. Text-only affordances slip in by
habit.

---

## Part 4 — M3: Flow (days 6–7)

### Prompt 4.1 — Audio

```
Implement spec §7.3 readback.

Do NOT use the Web Speech API — see §13 for why.

- Define the fixed prompt set (capture guidance, approval questions, errors)
- Structure src/audio/prompts/{lang}/ for pre-generated Bhashini clips
- Playback via HTML audio, fully offline
- A separate path for dynamic text that calls Bhashini TTS and caches the
  result to the filesystem

For now, stub the clips with placeholder audio so the flow is testable. Give me
the exact list of strings I need generated per language.
```

### Prompt 4.2 — Export and sync

```
Implement spec §9 and §10.

- Three named export buttons with icons, zero sliders, zero numeric inputs
- Dimensions from src/config/exportTemplates.ts, never in the UI
- Multi-step halving downscale for quality
- Capacitor Filesystem writes
- Upload queue: persisted, exponential backoff, idempotent, triggered on app
  resume and on @capacitor/network connectivity change
- Optimistic UI, no blocking upload state
- Delete capture_full.jpg after server confirms receipt

Be explicit in code comments that this is foreground-triggered sync, not true
background sync, per §10.1.

Acceptance test: complete a full capture-to-export in airplane mode and verify
all files land correctly.
```

---

## Part 5 — M4: Server (days 8–9)

### Prompt 5.1

```
Implement spec §11 steps 1-2: FastAPI endpoint accepting an image and running
BiRefNet at 1024x1024, returning a mask. Include a fallback that returns a
u2netp mask if BiRefNet fails to load, so the endpoint never hard-fails.
```

### Prompt 5.2

```
Implement spec §11 steps 3-5: trimap generation, alpha solving in the unknown
band, foreground colour decontamination.

Test specifically with the fringed textile fixtures. Show me the plain BiRefNet
mask composited on white next to the matted version — I need to see the halo
disappear.
```

### Prompt 5.3

```
Implement spec §11 steps 6-8.

Critical: the server re-renders FROM THE EXISTING RECIPE. It must not rerun the
device pipeline and must not discard the artisan's tier choice or brush
corrections.

Test: create a product, apply a tier override and three brush strokes on the
device, run the server upgrade, assert the override and all three strokes are
present in the new render.
```

---

## How to run the sessions

**One milestone per session.** Fresh session between M0/M1/M2/M3/M4. Long
sessions accumulate context and drift from the spec.

**Always ask for a plan first** on anything non-trivial. Correcting a plan is
cheaper than correcting a diff.

**Re-anchor when it drifts:**
```
Re-read IMAGE_PIPELINE_SPEC_WEB.md §6 and check your implementation against it.
List any deviations.
```

**When it proposes something rejected:**
```
Check §13. Is what you're proposing on the rejected list?
```

**Before each commit:**
```
Run the tests. Then check the §18 acceptance criteria relevant to what we just
built and tell me which now pass and which don't yet.
```

**Give it evidence, not conclusions.** Paste the actual error, the input that
caused it, what you expected. "It looks wrong" produces guessing; a failing
test produces a fix.

---

## The six things most likely to go wrong on this stack

**1. OpenCV.js Mat leaks.** The app works fine for 8 photos then dies. Catch it
with the memory loop test in Prompt 2.2, not on stage.

**2. It builds a destructive pipeline.** The natural way to write canvas
processing is draw → save → draw → save. That breaks §11 entirely. Check early:
`"Show me how tier switching works. Does it re-run segmentation?"`

**3. Everything ends up on the UI thread.** Segmentation and frame analysis
must be in workers. If the preview stutters, this is why.

**4. Thresholds stay at the spec's guessed defaults.** They are placeholders.
Skip M0 and tier assignment will be wrong on real handicrafts.

**5. It adds features you didn't ask for.** Sliders, filter presets, a crop
tool. Every one violates the zero-settings rule. Push back and cite §9.1.

**6. Text creeps into the UI.** Ask the "completable without reading" question
on every screen.

---

## Final verification

Walk §18 on a real mid-range device, not an emulator. These four break
silently:

- **#7** — tier change requires no re-segmentation
- **#8** — original byte-identical after any number of edits
- **#10** — memory stable across 20 photos
- **#11** — server upgrade preserves tier choice and brush strokes

If those hold, the architecture is intact.

---

## Before you commit to plugin choices

I could not browse when writing this. Verify against current docs:

1. `@capacitor-community/camera-preview` — current API, focus control support,
   capture resolution options
2. ONNX Runtime Web — Android WebView backend support, especially WebGPU
   availability on your target devices
3. OpenCV.js — current build size and whether a slimmer custom build covers
   your needed functions (cvtColor, split, merge, createCLAHE, LUT, resize)
4. Bhashini — TTS API access, registration process, supported languages
5. Capacitor Filesystem — storage quota behaviour on Android for large binaries
