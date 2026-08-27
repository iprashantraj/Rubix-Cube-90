# Research results

The deliverable of `research/` is this file, not the notebooks. One row per experiment.
Nothing goes on a slide until it has a verdict here.

| Experiment | Question | Verdict | Date |
|---|---|---|---|
| segmentation | BiRefNet vs SAM 2 vs rembg on **our** images | open | |
| whitebalance | gray-world vs learned vs white-paper reference | open | |
| camera-thresholds | blur/light cutoffs that don't false-reject plain fabric | **framing and blur settled, light still open** | 2026-08-27 |
| asr-bhashini | access terms, rate limits, does our use case qualify | open | |
| description-llm | prompt that reliably yields EN+HI + structured fields | open | |
| pricing | does cost-up land near real listing prices | open | |

Rules: benchmark on our own test photos, not blog rankings. Record the date — a verdict
from three months ago on a model that shipped a new version is not a verdict.

---

## camera-thresholds — first evidence, 2026-08-27

Not a verdict yet; the fixture set is still too small and too web-sourced to move a
threshold on. One result is solid enough to record now because it bears on the open blur
question in `docs/app/Camera-Pipeline.md` §11.1.

**The capture gate cannot see motion blur, because it measures a 240×180 downscale.**

A 24px horizontal smear applied to a clean 1600×1600 fixture
(`images/degrade.py --kind motion`, ground truth known):

| Measured on | Clean | 24px smear | `blur_laplacian_variance_min` = 100 |
|---|---|---|---|
| 240×180, what `gate.js` sees | 659 | 365 | **passes — blur not detected** |
| Full resolution, what the server sees | 141 | 46 | **rejected, correctly** |

Downscaling by ~7× turns a 24px smear into a ~3.5px one, and the Laplacian recovers. So the
capture-side blur check has both failure directions at once: it false-*rejects* a sharp
plain-weave subject that has no edges to measure, and it false-*accepts* genuine hand-shake
that a full-resolution measurement catches easily.

That is direct evidence for the split proposed in `docs/Abhay/PIPELINE-RECONCILIATION.md`
§5.3 — blur advisory at capture, hard reject only server-side at full resolution — and it
is a stronger argument than the one made there, which only had the false-reject half.

Reproduce: `python3 images/degrade.py --kind motion && python3 images/check.py`.

---

## camera-thresholds — calibrated on 591 fixtures, 2026-08-27

The set is now large enough to move numbers on: **93 photographs** somebody chose to publish
(the gate should pass these) and **498 degraded copies** of them, 83 each of motion blur,
defocus, under- and overexposure, off-centre and too-far, made by `degrade.py` with the
parameters recorded. The ground truth is a fact rather than a judgement. All eight
conditions from `images/README.md` are present.

Measure with `python3 images/check.py` (~2 min for 591 images, writes `images/out/metrics.csv`;
`--resume` skips what it already has), then score with `python3 images/calibrate.py --sweep`
(instant, reads the CSV). Full output of the run these numbers come from is in
`images/out/calibration.txt`.

### Four numbers changed

| Threshold | Was | Now | The fixture evidence |
|---|---|---|---|
| `fill_fraction_max` | 0.90 | 1.00, i.e. off | Refused **44 of the 93** good photographs as "too close", including 9/9 patterned and 15/18 fringe. Caught nothing that needed it |
| `fill_fraction_min` | 0.40 | 0.25 | All 83 too-far fixtures sit at fill ≤ 0.11, good photographs at a p25 of 0.67. 0.25 keeps every catch and takes the false rejects from 9 to 4 |
| `crushed_pixel_fraction_max` | 0.05 | 0.08 | Frees 3 good photographs and loses **none** of the 83 underexposed fixtures (63 caught either way). A free move |
| `blur_laplacian_variance_reject_min` | — | 20, new key | The server's hard reject, split from the capture advisory. See below |

Measured over the same 591 images, before and after:

| | Original | Calibrated |
|---|---|---|
| Good photographs the capture gate refuses | **65/93** | **21/93** |
| Good photographs the server refuses | 73/93 | 25/93 |
| Degraded fixtures given the *right* spoken message (capture) | 255/498 | 280/498 |
| Degraded fixtures given the *wrong* message (capture) | **200/498** | **79/498** |

### `fill_fraction_max` was the single worst number in the project

The metric it gates is the area of the busy box, and a busy box spanning the frame is not a
photograph taken too close — it is what a product photograph looks like. It tripped on 9 of
9 patterned backgrounds and 15 of 18 fringed textiles.

It was also drowning out the true verdict, which is the more expensive half. The gate speaks
one instruction and the artisan may not be able to read, so a reject with the wrong message
is close to no gate at all: 200 of 498 degraded fixtures were being told the wrong thing,
now 79. Off-centre fixtures correctly announced as off-centre went from **48/83 to 71/83**.
The gate became far more permissive and more accurate about what it does refuse, at once.

### Blur: the split is confirmed, and the server number is 20, not 100

Taking the blur metric on its own, against the 166 motion and defocus fixtures and the 93
good photographs:

| Laplacian variance below | 240×180, what `gate.js` sees | Full resolution, what the server sees |
|---|---|---|
| 100 — flags blurred | **23/166** | 152/166 |
| 100 — refuses good | 2/93 | **24/93** |
| 20 — flags blurred | 1/166 | 128/166 |
| 20 — refuses good | 1/93 | 3/93 |

At the resolution the phone works at, the measurement barely separates the two populations:
23 of 166, or 14%. The downscale is roughly 7× and it removes the defect being measured. So
the capture gate cannot hard-block on blur at any threshold and stays advisory — which is
what three comments in `gate.js` already say it should be.

The server can hard-block, but not at 100: that refuses a quarter of the good photographs.
The whole-gate trade, counting every check:

| `blur_..._reject_min` | blurred fixtures the server misses | good photographs the server refuses |
|---|---|---|
| 20 (chosen) | 32/166 | 25/93 |
| 30 | 24/166 | 30/93 |
| 40 | 21/166 | 33/93 |
| 100 (old) | 12/166 | 41/93 |

Above 20 the exchange rate is roughly **one good photograph refused per one extra blurred
photograph caught**, and rule 3 in `CLAUDE.md` prices that trade: a missed blur costs a
prettier photo, a false reject costs the artisan the listing. So 20.

All 32 misses are motion, not defocus — the server catches every one of the 83 defocused
fixtures. A horizontal smear leaves the vertical edges intact and the Laplacian partly
recovers, which is the same reason the capture gate cannot see motion at all. Closing that
gap needs a directional measure, not a lower threshold; nothing in the set argues for one
yet.

### Light: not settled, and this set cannot settle it

`brightness_mean_min` is the tightest trade in the project and the populations overlap:

| `brightness_mean_min` | underexposed caught | good photographs refused |
|---|---|---|
| 50 | 49/83 | 5/93 |
| 60 (kept) | 63/83 | 8/93 |
| 65 | 66/83 | 8/93 |
| 70 | 76/83 | 11/93 |

65 looks free on this set — three more catches at no cost — and it is **deliberately not
taken.** Moving stricter is the direction that locks an artisan out, and this set cannot see
the failure it would cause: every dark fixture here is a synthetic exposure change on a
well-lit original, with clean shadows where a real indoor capture has read noise.
`brass-diya-specular-02.jpg` (mean 58, *zero* crushed pixels) is already refused as too dark
while having no lost shadow detail at all, which is exactly the lockout `images/README.md`
was written to prevent. Left at 60 until somebody photographs dark products on a real phone
in real indoor light.

12 of the 83 underexposed fixtures pass both gates. That is the acknowledged cost of not
tightening.

### Two message bugs in `gate.js`, found by the fixtures

Both are wrong-instruction bugs, not wrong-verdict bugs. The image is correctly refused; the
artisan is told to do the wrong thing about it.

1. **`gate.js:186` puts the crushed-shadow check before the two too-bright checks.**
   `pottery-earthen-sharp-01.png` has mean 173 and 50.6% blown highlights and is announced
   as `photo.too_dark`. An artisan following that adds light to an already blown-out frame.
   Suggested order: mean-low, mean-high, blown, crushed.
2. **The blur rung sits above framing**, so at full resolution a too-far photograph is
   announced as blurry. Much less visible since the framing fix, but the ordering is the cause.

### What the set still cannot do

Every fixture is web-sourced or synthesised from one. Valid for the four luma statistics the
gate measures — `degrade.py` argues this in its header. Not valid for `denoise_sharpen()`,
not valid for the light thresholds above, and no substitute for a mid-range Android phone in
a courtyard at six in the evening.
