# Admin console — screen spec

**Status: the front page is superseded.** A separate design for the overview screen was
built and is the one we ship. `page.tsx` here is the earlier take on it — keep it for the
chart scaling and the copy, not for the layout.

**The other six screens are not superseded, because nothing else covers them yet.** They
are implemented in this directory against demo fixtures, and this file is why each one
exists and what it has to show. Build them on top of the new front-page design; do not
re-derive the content from scratch.

Everything below is typed in `../../lib/admin.ts`, shaped field-for-field from
`web/api/models.py`. That file is the only data source any page here touches — see its
header for how to point it at a real API.

---

## The rule that governs every screen

**Readiness is booleans, never values.** `Artisan` carries `has_pan`, `has_bank`,
`has_gst`, `has_artisan_card` — the PAN number, the account number and the GSTIN have no
column in any table, in any service, ever. So there is nothing behind those cells to drill
into and no detail view to build. A coordinator learns who needs help without the console
ever holding something that can leak.

If a future screen wants to show a document, that is not a UI task. Read the header of
`models.py` first.

---

## `/admin` — overview

Superseded by the new design. What it was carrying, in case it is useful:

- Hero band: realised GMV, artisans onboarded, listings published, median income uplift,
  craft clusters live. **Realised** means an order a buyer placed, not a listing view.
- 12-month listings (bars) + GMV (line), Apr → Mar.
- Onboarding language split, `%` of artisans by spoken language, plus two outcome
  figures: listings created with zero typing, median photo → live.
- Channel split by GMV.
- Activity ledger — and deliberately not only good news: the floor guard refusing a
  listing and the camera gate refusing photographs belong here, because those are the
  system working.
- A **"What we do not claim"** panel. Keep this idea somewhere on the new design. It is
  the thing that makes every other number on the page credible.

⚠️ If the new front page plots a chart, scale the axis labels and the path by the *same*
number. The version here hardcoded `40Cr → 0` from the mockup while the path normalised to
its own max, drawing ₹31.2 Cr where ₹37 Cr sits. `ceiling()` and `line()` in
`../../lib/format.mjs` do it correctly and `npm test` checks them.

---

## `/admin/artisans` — roster

**Answers: who needs a coordinator today.**

Columns: name + masked phone + craft · cluster/district/state · language · readiness flags
· "also sells on" · live listings of total · realised GMV.

- A **"Needs a coordinator"** panel floats anyone missing a bank linkage or who failed
  `name_check_passed`. Name mismatch across Aadhaar/PAN/GST/bank is the top GeM rejection
  cause — catching it before they list is worth more than any single listing.
- `name_check_passed` is three-state: passed / failed / **not run**. Do not collapse to a
  boolean.
- Phones are masked (`mask()`). A coordinator needs to recognise a row, not dial it.
- `sells_on` is a **question-reduction field** before it is a display field: an artisan
  with no Amazon or Flipkart account is never asked for a shipping weight. Worth a line of
  explanation on screen, because it looks decorative and is not.

## `/admin/artisans/[id]` — one artisan

Their queue rows, their orders, their readiness, their channels. Nothing new — it is the
roster's three data sources filtered to one person.

`generateStaticParams` is what lets this prerender with no backend. Delete it when the API
lands and the route goes dynamic; nothing else changes.

## `/admin/queue` — listing queue

**Answers: why is that listing stuck.**

Split into **Blocked** and **Moving**. The reason a row is blocked is on the row, not
behind a click — that is the entire job of this screen.

The blocking reasons worth seeding into any rebuild, because they are the product working
rather than faults to clear:

| Reason | Why it is correct |
|---|---|
| Colour not confirmed after white balance | White balance moves colour. Only the person holding the object can say it is still true. A maroon saree shipping as orange is a return and a rating hit. |
| Price below floor — publish refused | Under-pricing is the epidemic in this sector. A week of work does not sell at a loss. |
| No price set — floor computed, artisan has not chosen | We computed a floor; we do not pick their price. |
| GeM category template missing | A plausible sheet GeM rejects is worse than no sheet — the artisan spends three days finding out. |
| Flipkart refresh token expired (~60 days) | Known, dated, needs a refresh job from day one. |
| Meesho is partner-gated | Degrades to guided paste, never silently fails. |

The colour lock lives in `preflight()`, which every channel adapter inherits and none can
skip. Surface it as an expected state, never as an error.

## `/admin/orders` — orders across channels

**Answers: did the money actually reach the artisan.**

The **Paid?** column is the point. Three states, never two:

- `arrived` — the artisan tapped "Paisa aaya?" and confirmed
- `not yet` — the marketplace says it paid, the artisan says it has not come
- `not asked` — we have not asked yet

We can see what a marketplace **promised**; we cannot see an artisan's bank account. A
**Settlement gap** panel lists the `not yet` rows. This is why the app says *"Amazon ne
₹4,200 bheje hain"* and never *"aa gaye"* — and across thousands of artisans those rows
are the only honest dataset anyone has on real settlement delay.

## `/admin/gem-recon` — GeM reconciliation

**Answers: what has GeM done that we do not know about.**

**GeM has no order API.** Orders live on the GeM seller dashboard and nowhere else. A
coordinator reads the state there and sets it here, by hand. The mismatch *is* the screen:
what GeM says next to what we hold, including `no record` when an order never reached us at
all. We do not fake a sync.

Two panels of context to keep: 10,700+ categories with wrong-category as the top listing
failure (automating that mapping is the actual "AI-driven market linkage"), and the
discount guard — GeM's mandated ~10% off MRP, refused when it would push below the floor.

## `/admin/hub` — cluster hub

**Answers: which clusters are live rather than merely registered.**

Per cluster: artisans, listings, GMV, **digital adoption** (share who published in the last
30 days), income uplift, and `wage_rate_per_hour`.

The wage rate is per cluster because the price floor is `material cost + local wage ×
hours`. A national average sets a floor too low in Srinagar and too high in Ashoknagar, and
a floor of the wrong size clamps nothing while sounding authoritative. Pricing returns
**422** rather than guessing when there is neither a material cost nor labour hours.

A CFC/BLC is government infrastructure that already exists. We plug into it; we do not
build a logistics operation.

## `/admin/reports` — programme reports

**Answers: what a funder or a ministry asks for.**

Derived from the same rows the operational screens show — never a second pipeline, or the
report and the queue eventually disagree and nobody trusts either.

Carries accessibility outcomes (zero-typing share, photo → live, languages in use,
listings held for colour, publishes refused by the floor), reach by state, settlement
honesty, and an **Honest gaps** panel: no GeM order API, no visibility into bank accounts,
oversell windows shrunk rather than closed.

---

## Demo mode

`DEMO` in `lib/admin.ts` is true while `API_BASE` is unset, and the rail shows a loud
badge saying every figure is a fixture. Keep that badge on any build that ships fixtures.
A demo number mistaken for a live one in front of a judge or a coordinator is the failure
this guards against.
