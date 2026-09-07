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
| pricing | does cost-up land near real listing prices | **first evidence — depends entirely on labour hours; see below** | 2026-08-28 |

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

---

## pricing — 144 real listings, 2026-08-28

**Collected:** 144 listings from **indiahandmade.com**, the Ministry of Textiles' own D2C
marketplace for verified weavers and GI-tagged products. Every row carries a resolvable
product URL and the date seen — `research/pricing/observed.csv` (gitignored; the derived
`ai/price/comps_seed.json` is committed).

Chosen over Amazon or Flipkart deliberately: same artisans, same crafts, same handmade claim,
a public catalogue that needs no seller account — and for a government problem statement,
nobody has to be persuaded it is the right comparison class.

| Category | n | min | median | max |
|---|---|---|---|---|
| `textiles.saree` (cotton/handloom) | 39 | ₹750 | **₹2,140** | ₹10,999 |
| `textiles.saree.silk` (molakalmuru) | 9 | ₹15,000 | ₹30,000 | ₹43,500 |
| `textiles.dhurrie` | 48 | ₹250 | ₹3,230 | ₹18,499 |
| `painting.madhubani` | 30 | ₹499 | ₹3,225 | ₹15,500 |
| `painting` (other) | 18 | ₹650 | ₹4,122 | ₹100,000 |

### The verdict flips on one input, and it is our least reliable one

`pricing.py check`, same materials (₹800), same cluster (Sambalpur, ₹120/h):

| Labour hours | Floor | vs `textiles.saree` |
|---|---|---|
| 12 h | ₹2,576 | **inside** the observed spread |
| 160 h (20 days) | ₹23,000 | **above** the entire spread (p90 ₹5,000) |

So the formula is not wrong or right on its own — **it is a lever on `labour_hours`, which is
the input we trust least.** It arrives as a spoken answer through a first-number-wins parser
that cannot read *"बीस दिन"* spelled out. The arithmetic is sound; the accuracy of the whole
feature rests on the number we are worst at capturing.

### The finding worth putting on a slide

At the **median listed price of ₹2,140**, minus ₹800 of materials, ₹1,340 is left for labour:

| Time taken | Implied wage |
|---|---|
| 1 day (8 h) | ₹167/hour |
| 2 days (16 h) | ₹84/hour |
| 3 days (24 h) | ₹56/hour |
| 5 days (40 h) | ₹34/hour |
| 20 days (160 h) | **₹8/hour** |

> **To clear the Sambalpur cluster wage of ₹120/hour, a handloom cotton saree would have to
> be woven in 11.2 hours.**

That is on the government's own artisan marketplace, not a discount consumer platform. It is
direct evidence for the premise the floor guard is built on — under-pricing, not over-pricing,
is the problem in this sector (Master ref §7.2 ④).

### Three caveats, none of which are hidden

1. **Listed ≠ sold.** These are asking prices. A listing at ₹2,140 that never sells is not a
   clearing price. Sold data would need marketplace cooperation.
2. **`textiles.saree` is too broad a comparison class.** A plain Santipuri and a Sambalpuri
   bandha ikat are both "handloom cotton saree" and differ perhaps tenfold in labour. Some of
   the 160 h "floor above market" result is that mismatch, not exploitation. The taxonomy
   walk-up exists for this; the fix is collecting at the weave-specific level.
3. **`default_wage_per_hour = 120` is unsourced** (`ai/price/rates.json` says so). It is the
   denominator of every number above. Sourcing it per cluster is a field question and it
   moves this whole result.

### What this does not settle

Whether ₹120/h is the right rate, and whether 160 h is realistic for the sarees actually
observed. Both are field questions. **What it does settle is that the pipeline works on real
data end to end**, and that the gap between listed prices and any plausible fair wage is large
enough to be the story rather than a rounding error.

Reproduce: `python3 research/pricing/pricing.py check --material-cost 800 --labour-hours 160`.

---

## camera-thresholds — blur was measuring megapixels, 2026-09-07

Found by `haat-v1`, the first fixtures in this project that are not stock photography: 34
photographs from artisan stalls at Ekamra Haat, Bhubaneswar, shot on an iPhone 17.

**Five sharp photographs were refused as blurry**, and the products in them are not remotely
blurry:

| fixture | whole frame | the product region alone | threshold |
|---|---|---|---|
| `dhokra-fish-01` | 7.6 | 644.6 | 20 |
| `brass-bowl-01` | 12.3 | 182.7 | 20 |
| `textile-mirrorwork-wall-01` | 14.7 | 175.4 | 20 |
| `dhokra-ganesha-01` | 16.4 | 525.0 | 20 |
| `brass-rickshaw-inlay-01` | 15.5 | 187.7 | 20 |

**Laplacian variance is not scale-invariant, and the gate was measuring it at whatever size
the phone produced.** Neighbouring pixels in an oversampled photograph are nearly identical,
so the variance falls as the image grows:

| fixture | at full resolution | at 2000px | at 1000px |
|---|---|---|---|
| `dhokra-ganesha-01` (24.5MP) | 16.4 | 436.1 | 1068.7 |
| `brass-bowl-01` (24.5MP) | 12.3 | 310.0 | 710.5 |
| `textile-shawl-fringe-01` (1.9MP, existing fixture) | 2259.5 | 2259.5 | — |

Every fixture in `gate-v1` is around 2MP, which is why this survived a full calibration: the
set never contained an image large enough to expose it. A 2026 phone shoots 6–12× more
pixels than the photographs the threshold was set on. **The number was refusing megapixels,
not blur.**

### The fix, and what it cost

`metrics.full_res()` now measures blur at a fixed 2000px — the same long edge
`segmenter.MASTER_LONG_EDGE` uses, so one threshold can serve a feature phone and a flagship.
Exposure still runs over every pixel at full resolution: a clipping fraction *is*
scale-invariant, and a downscale could average a blown highlight away.

Whole-gate effect on the unchanged 591-fixture set, threshold held at 20:

| | good photographs refused | degraded fixtures caught |
|---|---|---|
| full resolution (before) | 25/93 | 291/498 |
| fixed 2000px (after) | **24/93** | **278/498** |

Blur alone: 114/166 blurred fixtures flagged against 2/93 good photographs refused, improved
from 128/166 against 3/93. **All 52 misses are motion, none are defocus** — the same split as
before, and the same conclusion: closing it needs a directional measure, not a lower number.

**The threshold did not move, deliberately.** The sweep now favours 30 (26 good refused, 293
caught — 15 extra catches for 2 extra refusals, a better exchange rate than the 1:1 that
argued for 20). It is left at 20 because the metric's *meaning* changed in this pass, and
moving the number in the same breath would leave neither attributable. 30 is the candidate
for a follow-up with its own fixture.

### Two more findings from the same set, neither about blur

**HEIC could not be opened at all.** Every one of the 17 iPhone originals raised
`UnidentifiedImageError` in `storage.open_image()` before a single stage ran. iPhones shoot
HEIC by default. `pillow-heif` is now a requirement and registered where uploads are opened.

**Sharing an image through a phone app breaks it.** The other 17 files are the same afternoon
after being shared: every tag stripped and downscaled to 720×1280, under the 1000px floor.
All 17 refused on resolution. If artisans send photographs through a messaging app before
uploading, none of them will ever pass.

Reproduce: `python3 images/check.py && python3 images/calibrate.py --sweep`.

---

## whitebalance — the neutral path damages real photographs, 2026-09-07

**The first thing `haat-v1` measured, and it reversed a decision made the same day.**

`images/wb_check.py` said the white-balance stage was a clear win: 179 fixtures, three
synthetic cast strengths, mean chroma error cut from 15.29 to 4.48. That test asks one
question — *given a photograph with a known cast, can the stage undo it?*

It never asks the opposite. **Handed a photograph that is already correct, does the stage
leave it alone?** Every image the sweep scores has been given a cast that wants undoing, so
the sweep can only ever reward correcting. `--control` mode is that missing half: no cast
applied, correct answer is to change nothing.

Run against the 33 readable `haat-v1` photographs, measured **inside the product mask** —
measuring the whole frame hides it, because a dhokra figure on a blue cloth is mostly blue
cloth:

| fixture | product chroma | hue moved |
|---|---|---|
| `dhokra-keyholder-01` | 3.7 → **1.4** | 5.1° |
| `dhokra-ganesha-01` | 3.4 → **1.5** | 8.0° |
| `dhokra-handles-01` | 7.6 → **3.4** | 3.9° |
| `brass-mermaid-handle-01` | 7.4 → **4.2** | 3.7° |
| `textile-pattachitra-cloth-01` | 19.2 → **10.6** | **29.6°** |

**20 of 33 damaged.** Every dhokra piece lost between 43% and 62% of its chroma: gold went
pewter. A cream pattachitra cloth moved 29.6° of hue, from warm orange-cream to yellow-green,
and that one is visible at a glance in a side-by-side.

The cause is not a bug in the estimator. **No reference-free method can separate warm light
from a warm object.** Brass really is gold and undyed cotton really is cream; the method sees
warm pixels, concludes the light was warm, and neutralises them. Odisha's crafts are
overwhelmingly warm, so the guess is wrong here more often than it is right.

### What changed

`wb_neutral_enabled` is **false**. White balance now runs only from a tapped white reference
(`white_ref`), where the correction is a reading rather than an inference. Without one the
stage declines and the colour is left exactly as photographed.

The estimator is kept and still tested: the method is sound where a cast is *known* to exist,
and it is the baseline the white-reference path will be measured against.

**This reverses the recommendation made earlier the same day** that the `white_ref` tap was
not worth building until `wb-v1` existed. It is now the only way this stage runs at all.
`PIPELINE-RECONCILIATION.md` §5 finding 2 asked for that tap on 2026-08-27; this is the
evidence for it.

Reproduce: `python3 images/wb_check.py --control images/haat`.
