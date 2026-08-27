# seg-v1 — the segmentation benchmark set

Closes, or rather sets up closing, open decision #1 in `docs/decisions.md`:
*"Segmentation model (BiRefNet / SAM 2 / rembg) — open — benchmark in `research/segmentation/`."*

The machine-readable list is `seg-v1.txt`. 41 images, all drawn from the existing
`images/raw/` fixtures. Nothing new was downloaded.

## Why a subset, and not all 93

The 591 fixtures were collected to calibrate the **capture and quality gates** — brightness,
blur, framing. For that purpose the content of a photograph does not matter at all; only its
luma statistics do. A page of a 19th-century book on cotton finishing is a perfectly valid
fixture for measuring whether a Laplacian variance threshold is too strict.

It is worthless for choosing a segmentation model, because there is no product in it to cut out.

Of the 93 non-degraded originals, roughly half are in that category. This is not a defect in
the set — it is the set being used for the job it was built for, and now being asked to do a
different one.

## What was excluded, and why

| Excluded | Count | Reason |
|---|---|---|
| Book pages, plates, engravings, title pages | ~14 | `textile-cotton-sharp-02..06`, `pottery-earthen-sharp-01`, `pottery-wheel-indoor-01`, `textile-weaver-indoor-04`, `misc-chart-whitepaper-01..03`, `textile-blockprint-patterned-04..05`. No object, no background |
| Flat full-frame fabric texture | ~9 | The cloth *is* the whole frame. There is no background to remove, so every model scores a perfect 100% by outputting "all foreground" and we learn nothing |
| People at work — looms, wheels, workshops | ~11 | Documentary photographs. The craft is the activity, not a purchasable object |
| Crowds, landscapes, buildings | ~4 | `textile-dupatta-fringe-01` (a crowd), `textile-dupatta-fringe-02` (a shrine), `textile-dupatta-fringe-04` (a mountain valley) |

### A real problem found while picking

**Four files under `textile-zari-specular-*` are not textiles and not Indian crafts.** They are
a guitarist, a drummer, a man in an Adidas jacket, and a runner at an athletics meet.
`textile-dupatta-fringe-04` is a photograph of forested mountains. These were mislabelled at
collection time — the filename claims a subject the pixels do not contain.

This did **no harm** to the threshold calibration in `research/RESULTS.md`, because that work
only ever read luma statistics and never needed the subject to be what the name said. It would
have quietly poisoned this benchmark. They are excluded, and `images/MANIFEST.md` should be
corrected.

## What is in, and what each group is for

**11 · real listing-style photographs** (the UUID-named `.jpeg` files) — the only images in the
whole collection that look like what an artisan or a small seller would actually upload: a pot
on a table with a blurred room behind it, a saree on a mannequin, a dupatta hanging against a
patterned wall. Every other image is a museum record or a stock photograph. If a model wins on
these and loses elsewhere, it still wins.

**8 · specular metal** — brass and bidri. Polished metal reflects the room, so patches of the
product carry background colours, and the rim carries a highlight brighter than anything behind
it. Models trained on matte objects cut into the reflection.

**9 · low contrast** — blackware and dark clay against dark grounds, terracotta in an unlit
tunnel. The case where an edge detector has almost nothing to find. `1816d85d` (a near-black pot
on a near-black ground) is the hardest single image in the set.

**7 · fringe and thread** — four museum tassels, a cream linen fringe on white, a rug with
knotted borders. This group decides whether we need alpha matting or can live with a hard mask.
A binary cut through a tassel looks obviously fake at any size; this is the group most likely to
force the answer.

**2 · person or hand in frame** — a bride holding out a saree, a woman wearing one. Plus
`6b1e313f` in the listing group, a cup held in a hand. Every one of these models was trained
heavily on people, so the failure mode is predictable: it segments the human and discards the
product. Worth measuring before it surprises us in a demo.

**4 · adversarial** — a museum display case of many objects, a row of pots on a rail, a shop
full of stacked textiles, a potter at a wheel. There is no single product to extract. We are not
scoring accuracy here. We want to see whether a model returns something obviously empty or
low-confidence — which the tier system can catch — or something confident and wrong, which it
cannot.

## What this set still cannot tell us

Same limitation as `research/RESULTS.md`, and it is worth repeating: **nothing here was
photographed on a mid-range Android phone by an artisan.** The listing-style images are the
closest, and they are still professional or semi-professional work. Sensor noise in a dim
courtyard is exactly the thing that degrades a matte at the edges, and we cannot see it here.

The model chosen from this set is chosen on the best evidence available. It is not chosen on
the evidence we actually want.
