# images/ — calibration fixture set

The photographs the image pipeline's numbers are tuned against. This is a working
folder for the AI/image side, not an app asset directory. Nothing in `app/`,
`web/` or `ai/` reads from here at runtime.

## Why this exists

`ai/thresholds.json` used to carry a `_comment` claiming its numbers were
"calibrated in research/camera-thresholds/ on our own artisan photos". That
directory held a `.gitkeep` and nothing else. As of 2026-08-27 the calibration is
real and it is this folder: four of those numbers moved on the evidence of the
fixtures below, and the verdict is in `research/RESULTS.md`. The numbers in
`docs/Abhay/IMAGE_PIPELINE_SPEC_WEB.md` §14 are still guesses and say so.

What is settled and what is not: the framing and blur thresholds are calibrated
here and the fixtures support them. The **light** thresholds are not, and cannot
be from this set — synthetic underexposure and a genuinely dark-toned product have
nearly the same luma statistics.

A threshold that is wrong in the strict direction locks an artisan out of the app
with nothing they can do about it. `brightness_mean_min` is the clearest case: set
it too high and everyone who works indoors is refused. That is not a number anyone
should be guessing at, and it cannot be checked without real photographs of real
handicrafts taken on real phones.

## Layout

```
images/
  raw/          the fixtures themselves — gitignored, see MANIFEST.md
  out/          metrics.csv, contact sheets, per-stage dumps — gitignored
  MANIFEST.md   what is in raw/, who shot it, and what each image is meant to prove
```

`raw/` and `out/` are gitignored for the same reason `research/data/` is: they are
tens of megabytes of binary that git handles badly, and some of them are other
people's photographs. **The manifest is committed, the pixels are not.** Anyone who
needs the actual set copies it from shared storage using the manifest as the
packing list.

## What goes in raw/

Aim for 25+ images before trusting any number (spec §17, M0). The set is only
useful if it contains the cases that break things, so weight it towards the hard
ones rather than the photogenic ones:

| Case | Why it has to be in the set |
|---|---|
| Plain white or cream cloth, sharp | Scores "blurry" on Laplacian variance while being perfectly sharp. This is the case that decides whether blur can ever be a hard block |
| Undecorated pot, flat glaze | Same problem, non-textile |
| Dark product on a dark floor (black terracotta on mud) | Drives `crushed_pixel_fraction_max` |
| Brass, zari, mirror-work | Legitimate specular highlights vs. genuine overexposure — drives `blown_pixel_fraction_max` |
| Indoor, evening, single bulb | The `brightness_mean_min` lockout case |
| Fringed or netted textile (dupatta pallu, jaali) | Segmentation confidence floor — should route to the safe tier, never a chopped edge |
| Patterned floor or rug as background | Background texture joining the busy box — drives `cell_busy_ratio` |
| Same product with and without a sheet of white paper in frame | The only way to measure what the white-reference path is actually worth |
| A genuinely bad photo: motion blur, thumb over lens, half the product out of frame | The gate must reject these. If it does not, the numbers are too loose |

Shoot on a mid-range Android phone, not a laptop webcam and not a flagship. Keep
the original file straight off the device — do not crop, rotate or run it through
any editor first, because the thing being measured is what the sensor actually
produced.

## Naming

```
<category>-<subject>-<condition>-<nn>.jpg
textile-white-cotton-sharp-01.jpg
pottery-black-terracotta-darkfloor-02.jpg
brass-diya-specular-01.jpg
textile-dupatta-fringe-whitepaper-03.jpg
```

Condition is the part that matters — it is what the manifest, `check.py`'s coverage
report and `calibrate.py`'s false-reject table all group by.

## How the set is used

Two scripts, split so the expensive half runs once:

```bash
python3 images/check.py              # measure. ~80s for 591 images, writes out/metrics.csv
python3 images/check.py --resume     # ...skipping whatever metrics.csv already has
python3 images/calibrate.py --sweep  # score those numbers against ai/thresholds.json
python3 images/degrade.py --fill-gaps   # make only the fixtures that are missing
```

`check.py` runs every fixture through the same metrics `gate.js` computes and writes one
row per image to `out/metrics.csv`, flushed as it goes. `calibrate.py` reads that file and
answers the one question that moves a threshold: *how many images does this number get
wrong, and in which direction?* It knows which fixtures are supposed to fail — `degrade.py`
puts the degradation in the filename — so it separates a false reject from a correct one,
and flags a correct reject that says the wrong thing to the artisan.

Measuring is the only slow part and no argument about a threshold is settled in one pass,
so the numbers are written down rather than recomputed. Both scripts hold bounded memory:
full-resolution statistics are accumulated over row bands, not over whole decoded images.

A threshold is only allowed to change when a fixture image justifies it, and the
change is logged in `research/RESULTS.md` with the image names as evidence.
