# F3 — the price snapshot: everything except the numbers

**Date:** 2026-08-28 · **Touches:** `ai/price/comps.py`, `ai/price/comps_seed.json` (new),
`research/pricing/` (new), `research/RESULTS.md`
**Follows:** [F3-comparables.md](F3-comparables.md)

---

## The problem this closes, and the one it does not

Our own marketplace is queried live and is **empty until artisans list**. GeM, Amazon and
Flipkart have no queryable price search — GeM has no API at all, and the other two are seller
APIs that authenticate *as one shop*. So on demo day `market_range` is `null` and the price
sits exactly on the floor.

The fix is a dated snapshot somebody collected by hand. **The mechanism is now written. The
numbers are not, and I did not write them.**

## 🔴 Why the numbers are absent on purpose

Every price in that file becomes two things at once: the market rate an artisan is shown while
deciding what to charge, and the evidence behind any claim that our floor is calibrated.

A plausible-looking invented number is therefore **worse than an empty file**. The empty file
prices honestly on cost alone and the app says so. A guess does neither, and is
indistinguishable from research once it is committed.

Enforced, not just documented:

- `pricing.py` refuses any row with no `seen_on` date or no `url_or_note` — provenance is the
  whole difference between research and a number somebody felt was about right
- the committed seed ships empty, with a test asserting it stayed that way
- `research/pricing/observed.csv` is gitignored: commit the derived file, not the collection,
  same rule as `research/data/`

## What landed

**`comps.fetch()` for amazon / flipkart / gem** reads `comps_seed.json`. Per-source lists, so
a price seen on two platforms is not counted twice. The `market` source is untouched — it is
our own database, live.

**Taxonomy walk-up.** `textiles.saree.sambalpuri` → `textiles.saree` → `textiles`. A snapshot
will realistically hold the broad key long before it holds every weave, and comparing a
Sambalpuri saree against sarees generally beats comparing it against nothing. Most specific
wins, so adding the narrow key later takes precedence with no code change.

**Staleness handled asymmetrically, on purpose.**

| State | Behaviour | Why |
|---|---|---|
| Nothing collected yet | Silent, `[]` | The shipped state. Warning on every price request would train everyone to ignore this logger |
| Prices, no date | Warn, refuse | An undated price is not evidence, and this one is about to be shown as the market rate |
| Prices, older than 180 days | Warn, **still use** | Returning `[]` would silently drop the price back to the floor — which looks identical to everything working |
| Missing or malformed file | Silent, `[]` | A broken file must not cost an artisan their suggestion |

**`research/pricing/pricing.py`** — stdlib only, two subcommands:

```bash
python3 research/pricing/pricing.py build --collector "name"    # observed.csv -> seed
python3 research/pricing/pricing.py check --labour-hours 160    # the experiment
```

`check` is the open `pricing` row in `RESULTS.md`. It prints, per category, whether the floor
sits inside the observed spread, above all of it, or below it — and flags any category with
fewer than 10 observations as too thin to conclude from.

## Verified

Exercised end to end with a throwaway CSV containing five deliberately broken rows (negative
price, missing provenance, unknown source, non-numeric, undated) — all five rejected with
specific reasons, the good rows written, the taxonomy walk-up resolving, and the live stack
still pricing correctly afterwards. **The throwaway data was then deleted and the seed
restored empty**, which a test now guards.

`test_price.py`: 21 → **29**.

## What is left, and it needs a person

An afternoon of browsing. `research/pricing/README.md` has the protocol — how many per
category (10 minimum, 20–30 ideally), what to record, and the one counter-intuitive rule:

> **Keep the cheap listings.** A ₹900 powerloom saree sold as "Sambalpuri" is not noise. It is
> the market our artisans are actually compared against, and it is exactly the case
> `below_floor_warning` exists to catch. Dropping it would flatter our numbers.

Worth stating plainly to the team: the camera thresholds were calibrated against 591 fixtures
yesterday. **The pricing floor has been validated against zero real transactions.** Both feed
a number an artisan acts on; only one has evidence behind it.

---

## Postscript — 2026-08-28, later the same day

**Collected.** 144 listings from indiahandmade.com, the Ministry of Textiles' own marketplace for
verified weavers, chosen over Amazon and Flipkart because it is a genuine comparison class and needs
no seller account. It was added as a fifth source.

The rule above held: every number came off a real listing with a resolvable URL and a date, and none
were invented. What is written above about *why* the numbers were left blank is the record of the
decision, not a description of the current state.

Verdict, method and caveats: [`research/RESULTS.md`](../../research/RESULTS.md).
