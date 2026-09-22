# Judge Q&A pack — SIH 2026 · PS 26090

**Team RUBIXCUBE · AI-Driven Market Linkage and Smart Cataloging for Marginalized Artisans**

Every answer is written from the repository as it stands on **2026-09-03**, not from the slides.
Where the slides and the code disagree, **the code wins and Part 0 records the disagreement.**

---

## The documents

| # | File | What it covers |
|---|---|---|
| 0 | `00-slide-audit.md` | **Read first.** Nine things on the submitted PPT that are wrong, unbuilt, or contradicted by our own code — with the corrected wording for each |
| 1 | `01-positioning-and-app-ux.md` | Why the app exists against IndiaHandmade · demand-side gap · Capacitor · voice-first · shared phones · online-first · app size · our worst screen |
| 2 | `02-feature1-image.md` | PS Feature 1 · BiRefNet benchmark · the 591-fixture calibration · the missing colour stage · latency profile · single-GPU capacity · enhancement vs misrepresentation |
| 3 | `03-feature2-voice.md` | PS Feature 2 · the unbuilt vision pre-fill · Bhashini risk · dialects · SEO claim · cost-DoS · what leaves the country · prompt injection |
| 4 | `04-feature3-pricing.md` | PS Feature 3 · why there is no ML model · the floor as ethical core · self-reported labour hours · thin comparables · GeM discount math |
| 5 | `05-channels-and-linkage.md` | What "one tap" really means · the 10,700-category GeM story · GST Notification 34/2023 · ONDC MSN · autofill legality · the GeM order gap · inventory races |
| 6 | `06-scalability-and-privacy.md` | What breaks first, in order · demo-day surge math · multi-tenancy · booleans-only storage · DPDP dates · observability · QC · counterfeits · blockchain |
| 7 | `07-impact-and-hardest-questions.md` | Adoption without field agents · proving income · who pays · RTO · the cut line · **the five questions we would struggle with** |
| 8 | `08-costing-unit-economics.md` | **Costing A** — measured basis · workload model · per-product marginal cost · GPU vs per-image API · the ASR variable |
| 9 | `09-costing-buildout.md` | **Costing B** — four deployment scales · buy vs rent · the lines bigger than the servers · TCO · ten cost-reduction levers · procurement verify list |

Each is also generated as `.docx` and `.pdf` in this folder.

---

## Answer format

Every question follows the same four beats, so an answer can be given under pressure without
losing the thread:

- **Think** — the reasoning, out loud, before the answer
- **Today** — what the code actually does, cited by file
- **At scale** — what changes, and what it costs
- **Breaks when** — the honest failure condition

---

## The three numbers to have memorised

| | |
|---|---|
| **0.1%** | IndiaHandmade onboarded 4,186 artisans in three years against ~35 lakh handloom workers. **The storefront was never the bottleneck** |
| **10,700+** | GeM product categories. An artisan cannot navigate them; an entire consultancy industry exists because most sellers cannot either |
| **₹136** | Cost per artisan per year at national scale — ₹76 if GeM ships an order API |

---

## The four sentences that carry the pitch

1. *"The government already built the storefront. It didn't scale, because getting a product
   **ready to be listed** is the actual work — and that is what we automated."*
2. *"One tap is tiered and we will tell you which tier each channel is in. A flat claim does not
   survive an industry judge; knowing which Indian platforms have APIs and which do not **is** the
   product."*
3. *"Pricing is arithmetic, not a model — because no training data exists for what a handicraft
   should cost, and every number has to survive **'how did you get that?'**"*
4. *"Our largest cost is not compute. It is a human reading the GeM dashboard, because GeM has no
   order API — and one MoU removes ₹6 crore a year."*

---

## Standing rules for the room

- **Never claim a channel is live when it returns `dry_run`.** Our own code says it: *"a demo claim
  that outruns the code is how you lose the room."*
- **Name the limit before the judge finds it.** Every gap in this pack has a true statement that is
  more impressive than the false one it replaces.
- **Nothing unverified goes on a judged slide.** The verify lists are §18 of the Master Technical
  Reference and §8 of Costing Part B.
