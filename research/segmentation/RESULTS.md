# Segmentation model benchmark — the verdict

**Decision #1 is closed. We use BiRefNet.**

Repository `ZhengPeng7/BiRefNet`, MIT licensed, self-hosted, run at 1024×1024 on the
server's GPU. Measured on this machine's RTX 2050: **1615 MiB peak VRAM, ~645 ms per
image.** Both fit the 4GB card with headroom.

Pinned revisions, so a later upstream change cannot silently move this result:

    ZhengPeng7/BiRefNet       e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4
    ZhengPeng7/BiRefNet_lite  7838f1c3472f827cd8ce13ab5ccc2ce48077360f

Both repositories ship `trust_remote_code` model definitions — the code that builds the
network is downloaded along with the weights. Pin the revision in `ai/enhance/` rather than
tracking `main`.

Chosen 2026-08-28 by looking at 41 photographs cut out five different ways. The numbers
below support that choice; they did not make it, and §"What the numbers got wrong" says
where they actively misled.

## What was compared

| Model | Licence | Peak VRAM | Median | Verdict |
|---|---|---|---|---|
| **BiRefNet** | MIT | 1615 MiB | 645 ms | **chosen** |
| BiRefNet-lite | MIT | 851 MiB | 273 ms | held in reserve |
| InSPyReNet | MIT | 2924 MiB | ~500 ms | close second |
| u2net | Apache-2.0 | CPU | ~450 ms | rejected — weakest on fringe |
| isnet-general-use | Apache-2.0 | CPU | ~950 ms | rejected — 48 holes per image |
| RMBG-2.0 | CC BY-NC 4.0 | — | — | never ran, and could not have shipped |

**RMBG-2.0** is gated behind a Hugging Face account approval and returned 401. Not pursued:
its licence is non-commercial, so a good score would have changed nothing. Worth stating
plainly because it is the model most often recommended for this task online, and someone
will ask why it is absent.

**u2net and isnet timings are CPU numbers** and are not comparable to the three GPU rows.
They were not moved to the GPU because both lose on quality regardless of speed.

The set is `seg-v1` — 41 fixtures, defined in `seg-v1.txt`, chosen and argued in `seg-v1.md`.
Reproduce with `bench.py` then `consolidate.py`; contact sheets come from `sheets.py`.

## Agreement by group

Mean consensus IoU — how closely each model matches the majority of the other four. It
measures agreement, **not correctness**. Five models can agree and all be wrong.

| Group | BiRefNet | lite | InSPyReNet | isnet | u2net |
|---|---|---|---|---|---|
| Real listing-style photographs | 0.814 | 0.814 | 0.820 | 0.725 | 0.821 |
| Specular metal | 0.931 | 0.945 | 0.933 | 0.968 | 0.958 |
| Low contrast | **0.992** | 0.972 | 0.991 | 0.987 | 0.937 |
| Fringe and thread | 0.843 | 0.851 | 0.847 | **0.742** | 0.801 |
| Person or hand in frame | 0.987 | 0.988 | 0.983 | 0.965 | 0.969 |
| Adversarial | 0.616 | 0.574 | 0.608 | 0.632 | 0.561 |

## The three findings that decided it

**1. Fringe works, and that was the open question.**
A tassel is hundreds of loose threads. A model that cuts a straight line through them
produces something visibly fake at any size, and the four museum tassels were in the set
precisely to force this. BiRefNet traced individual threads on all four, kept the stray
wisps, and removed the museum accession card underneath. This is the single result that
most changes what steps 7 and 8 have to be. **Alpha matting as a separate stage may not be
needed at all** — the model's own output is already soft where it matters.

**2. Dark-on-dark was not the hard case. Pale-on-pale is.**
`1816d85d`, a near-black pot on a near-black ground, was picked as the hardest image in the
set. Every model handled it; BiRefNet cut it cleanly including the gaps under both handles.
The low-contrast group scored **0.992**, the highest of any group.

The actual failure is `textile-shawl-fringe-03` — cream linen on a white background. BiRefNet
kept a few fringe threads and **discarded the entire cloth**, scoring 0.329. A pale product
on a pale surface is the case to worry about, and no one predicted it, including me.

**3. On an ambiguous frame, every model invents a boundary rather than reporting doubt.**
The adversarial group scores 0.57–0.63 across the board — the models do not agree with each
other because there is no right answer to agree on. Worse, two full-frame textile close-ups
(`291e88c5`, `b4b717b2`) drove BiRefNet to 0.017 and 0.042 consensus: it returned a confident
mask carving an arbitrary chunk out of the middle of the cloth.

**This is a design input for step 8, not a defect.** The tier system must derive confidence
from the mask's own shape, because the model will not tell us when it is guessing.

## What the numbers got wrong

**Soft-edge fraction was a bad proxy and nearly misled the decision.** The reasoning going in
was that a higher share of partly-transparent boundary pixels means better fringe handling.
BiRefNet has the *lowest* soft-edge fraction of the five (1.3% against InSPyReNet's 4.4% and
isnet's 7.9%) and produced *visibly the best* fringe. What the metric actually rewards is an
uncertain, smeared boundary — isnet's 7.9% is blur, not detail.

**Hole count is meaningless inside the fringe group.** Every model scores 20–250 holes there.
A tassel genuinely has gaps between its threads; correctly following them registers as damage.
Hole count is a real signal in the other five groups and noise in this one.

Both are kept in `consolidate.py` because they catch degenerate answers — "everything is
product", "nothing is product" — which they do reliably. Neither should be used to rank
models, which is what they were originally added for.

## Why the full model over lite

Lite is genuinely close: 0.866 mean agreement against 0.870, at a third of the memory and
2.4× the speed. It loses on holes — 8.8 per image against 5.6, and 36.1 against 20.0 in the
fringe group — and a hole punched in the middle of a product is the error a customer notices
first.

Enhancement is a server-side background job, not an interactive path. 645 ms is not a budget
we are anywhere near, and 1615 MiB fits the card. **We are not paying for lite's speed with
anything we need, so we take the quality.** If GPU memory ever becomes the binding constraint,
lite is a drop-in swap and this is the file that says so.

## What this benchmark cannot tell us

Unchanged from `research/RESULTS.md`, and it still matters most:

**Not one fixture was photographed by an artisan on a mid-range Android phone.** The 11
listing-style images are the closest and are still professional work. Sensor noise in a dim
courtyard degrades a matte exactly at the edges — the thing this whole benchmark is about —
and none of these images contain it.

Three further limits, stated so nobody quotes these numbers past them:

- **Everything ran at a 2048px cap.** This machine has 7GB of RAM and some fixtures are 22MP;
  the run was OOM-killed before the cap. Full-resolution behaviour is inferred, not measured.
- **Consensus IoU is agreement, not accuracy.** There are no hand-drawn ground-truth masks in
  this project. Building 41 of them is days of work and was judged not worth it against
  contact sheets — a defensible call, but it means no number here is an accuracy figure.
- **The adversarial group has no correct answer** by construction. Its scores describe spread
  between models and nothing else.

---

# Follow-up: does a 1024 mask survive being upscaled?

**Run 2026-08-28, after the verdict.** This was the open question left blocking step 7.
`upscale_test.py` reproduces it.

**Answer: yes at the resolution the pipeline actually uses, and no at full sensor
resolution.** The spec already forbids the second case, which turns out to matter more than
the spec knew.

## Method

BiRefNet always infers at 1024×1024 — that is fixed by the weights. What varies is how far
its output is stretched to cover the photo. With no ground truth, each region is measured
against a **detail ceiling**: the same region cut out at native resolution and fed to the
model directly at ~1024, so its mask comes back 1:1 with no upscaling. The gap between the
two is what upscaling costs.

`band` is the mean thickness in pixels of the partly-transparent edge. Real detail keeps it
roughly constant as resolution rises; interpolated softness makes it grow with the factor.

## At full sensor resolution — the case the spec forbids

| Image | MP | Upscale | band, pipeline | band, ceiling | ratio | IoU |
|---|---|---|---|---|---|---|
| textile-pallu-fringe-01 | 22.1 | 5.62× | 13.20px | 9.04px | 1.46 | 0.984 |
| brass-bidri-specular-04 | 15.7 | 4.33× | 7.27px | 3.45px | 2.11 | 0.998 |
| brass-bidri-specular-02 | 12.0 | 3.91× | 6.86px | 2.24px | 3.06 | 0.991 |
| textile-blockprint-patterned-03 | 10.0 | 3.56× | 6.67px | 2.56px | 2.61 | 0.617 |

**The outline is in the right place — the detail is not.** IoU near 0.99 says the boundary
does not move. But at 100% on `textile-pallu-fringe-01`, a wire-thin nose ring becomes a
blurred blob and individual hair strands smear into a fuzzy band, where the native run
resolves both cleanly. A smooth hard edge (the brass pot) survives; anything thinner than
the upscale factor does not.

## At the 2000px master — the case the pipeline actually uses

`IMAGE_PIPELINE_SPEC_WEB.md:230` requires a downscale to a 2000px long edge before
processing, and `ai/contracts.md:31` delivers 2000×2000. So the real upscale is **1.95×**,
not 4–6×.

| Image | Upscale | band, pipeline | band, ceiling | ratio | IoU |
|---|---|---|---|---|---|
| textile-pallu-fringe-01 | 1.95× | 4.48px | 2.78px | 1.61 | 0.994 |
| brass-bidri-specular-04 | 1.95× | 3.32px | 1.77px | 1.88 | 0.998 |
| brass-bidri-specular-02 | 1.95× | 3.23px | 1.50px | 2.15 | 0.999 |
| textile-blockprint-patterned-03 | 1.95× | 12.99px | 6.52px | 1.99 | 0.763 |

Edge band drops from 7–13px to 3–4px, and side by side at 100% the two masks are close
enough that the difference is a few loose hair strands. **This is the same ~1.9× regime the
four museum tassels were measured in during the benchmark**, which is why they looked as
good as they did — and it means that result transfers to production rather than being an
artefact of small fixtures.

## What this changes

1. **Step 7 probably does not need a separate matting stage** — the original finding stands,
   now with the resolution caveat attached rather than assumed away.
2. **The spec's "downscale to 2000px first" rule is load-bearing for mask quality, not only
   for speed.** It is justified on performance grounds at `IMAGE_PIPELINE_SPEC_WEB.md:61` and
   `:230`. Segmenting the raw sensor image would be slower *and* visibly worse on fine detail.
   Anyone tempted to "improve quality" by skipping the downscale would get the opposite.
3. **If a future channel ever wants images above ~2000px**, this measurement stops applying
   and edge refinement comes back on the table. Re-run `upscale_test.py --master <N>` first.

## Caveats

- **The crop run sees a fragment, not the whole object**, so this compares *edge detail*, not
  segmentation quality. `textile-blockprint-patterned-03` shows the limit: IoU 0.617 and 0.763
  because the fragment is ambiguous on its own. Its band numbers are still informative; its
  IoU is not.
- Four images, one model. Enough to answer a yes/no question about resolution, not enough to
  characterise anything else.
- Still no photograph taken by an artisan on a real phone.

---

# Step 8: calibrating the tier thresholds

**Run 2026-08-28.** `tiers.py` reproduces it. The values scored here are the ones the
reconciliation proposed; this is the first time they have been measured against anything.

## The problem being solved

The benchmark's third finding was that BiRefNet never reports doubt — handed a photograph
with no single clear product, it returns a confident outline around an arbitrary region.
Nothing downstream can ask the model how sure it is, so confidence is inferred from the
**shape of the mask**: how much of the frame it covers, how much of it is undecided alpha,
and how many separate pieces it came back in.

## Labels

Seven of the 41 masks are ones a person would not ship. **These labels are mine, assigned by
eye from the contact sheets** — that is a weaker instrument than a measurement, and the
question it can answer is narrow: do these thresholds separate masks a person would refuse
from masks a person would ship, on this set.

| Fixture | Why it is unshippable |
|---|---|
| `291e88c5` | frame-filling saree — arbitrary chunk cut from the middle |
| `b4b717b2` | frame-filling textile — same failure |
| `textile-shawl-fringe-03` | cream linen on white — kept the fringe, threw the cloth away |
| `pottery-blackware-darkfloor-01` | museum case, many objects |
| `pottery-earthen-sharp-02` | row of pots on a rail |
| `textile-blockprint-patterned-02` | shop interior, stacked textiles |
| `pottery-potter-indoor-01` | person at a wheel |

## Result

**Caught 5 of 7. Missed 2. Demoted 2 good masks to tier B.**

A grid search over `mask_area_min` (0.02–0.15), `mask_area_max` (0.80–0.98),
`mask_uncertain_fraction_max` (0.04–0.12) and `mask_blob_count_max` (2–6) found **nothing
better on this set** — the best alternative also missed 2 and demoted 2. So the
reconciliation's values stand, now measured rather than reasoned.

The two demotions are cheap: `pottery-terracotta-darkfloor-01` (a correctly-cut pot in a dark
tunnel, 11.7% of frame) and `textile-dhurrie-patterned-01` (a rug filling 96% of it). Both are
correct masks on genuinely unusual photographs, and tier B feathers the edge rather than
refusing to enhance. That is the right way to be wrong.

## What it does not catch, and why that matters

**`b4b717b2` scores a perfect 1.00 and goes to tier A.** Its mask covers 57% of the frame in
one clean piece with almost no undecided alpha. By every shape measure it is an excellent
mask. It is also completely wrong — it cuts an arbitrary line through uniform fabric.

This is the failure mode that matters most for textiles, because filling the frame with cloth
is how people photograph cloth. `291e88c5` is caught only because its mask happened to land at
92% coverage; `b4b717b2` landed at 57% and nothing fires.

**An edge-alignment signal was tried and rejected.** The idea: a correct silhouette follows
strong image gradients, an invented one cuts through flat colour, so compare median image
gradient along the mask boundary against the image's overall gradient. Measured across all 41:
the seven bad masks span 0.98–9.66 and the good ones span 0.76–24.87. `b4b717b2` sits at 3.29,
squarely inside the good range, and the *lowest* score of all belongs to a correct mask. **No
separation. Not adopted**, and recorded here so nobody spends another afternoon on it.

What would actually catch it is knowing there is no background in the frame — which the
capture gate already measures as `fill_fraction`, on the phone, before the shutter. That
signal exists and does not currently reach the server. It is the obvious next thing to try
and it needs the app side, so it is a request rather than a change.

## Two divergences from spec §6.3

**Tier B is feathered-on-white, not "a soft studio gradient".** A gradient cannot be a
marketplace primary — `contracts.md` and spec §9.1 both require #FFFFFF — so a gradient would
produce the rejection the tier exists to avoid.

**Tier C removes nothing at all, rather than "background blurred + dimmed".** The spec asks
for the blur two lines after guaranteeing that C *"removes nothing, so it cannot damage the
product"*. Blurring the background requires the mask, and C is precisely the case where the
mask is not to be trusted; blurring with a bad mask smears the product. The guarantee is worth
more than the nicety.

## The shape of the scoring, which is not obvious

Deductions are 0.4, 0.3 and 0.3 from a start of 1.0, and tier B begins at 0.45 — so **any
single anomaly lands at 0.6 or 0.7 and demotes only to B. Reaching C takes two independent
failures.** That is deliberate: one odd measurement is usually a legitimately odd photograph,
and refusing to enhance on one signal would cost more listings than it saves.
