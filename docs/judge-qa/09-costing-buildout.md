# Costing, Part B — The build-out: servers, cloud, people, and the levers

Markers as in Part A: 📏 measured · 💲 vendor list price, verify · 🧮 derived.

---

## 1. Four deployment scales

🧮 Sized from Part A §2 — one GPU ≈ 100,000 artisans, 40% of onboarded artisans active.

| | **S1 · Pilot** | **S2 · State** | **S3 · National** | **S4 · Full TAM** |
|---|---|---|---|---|
| Artisans onboarded | 2,000 | 250,000 | 10,00,000 | ~1 crore |
| Active (40%) | 800 | 100,000 | 4,00,000 | 40,00,000 |
| Photos/month | 8,000 | 10 lakh | 40 lakh | 4 crore |
| **GPUs needed (full model)** | **1 (shared)** | **1 + 1 HA** | **4 + 2 HA** | **40 + 8 HA** |
| GPUs with **lite** | 1 | 1 + 1 | 3 + 1 | 26 + 5 |
| App tier (vCPU) | 4 | 32 | 128 | 1,024 |
| Postgres | 1 managed | HA + 1 replica | HA + 3 replicas + partitioning | Sharded by state |
| Object storage | 30 GB | 35 TB | 140 TB | 1.4 PB |

**Note the shape.** From S1 to S4 artisan count multiplies by **5,000×**; GPU count multiplies by
**48×**. **The AI is the sub-linear part of this system.** What scales linearly is storage,
bandwidth and — the point of §4 — people.

---

## 2. Option A — Buy the servers (capex, government-owned)

The right model for a ministry that wants an asset on its own books, and the cheaper model at
sustained high utilisation.

### 2.1 ⚠️ The licensing trap, before any price

💲 **NVIDIA's GeForce driver EULA prohibits datacenter deployment of consumer cards.** An RTX 4090
is roughly a third the price of an L4 and is **not licensable for a government datacenter.** A
procurement built on RTX pricing will be rejected at compliance review or, worse, deployed and later
found non-compliant.

**So all capex below uses datacenter-class cards.** Our benchmark numbers came from consumer cards
(RTX 4060 / 2050) — 🧮 an **L4 is roughly 1.5–2× an RTX 4060** for this workload, so the capacity
figures in §1 are **conservative** on L4, which is the direction we want an estimate to err.

### 2.2 💲 Per-node hardware, India list — verify with an OEM before quoting

| Component | Spec | ~₹ |
|---|---|---|
| GPU × 2 | NVIDIA L4 24 GB (72 W, single-slot, no extra cooling) | 5,00,000 |
| Server chassis | 2U, dual Xeon Silver / EPYC, 24–32 cores | 2,50,000 |
| RAM | 256 GB ECC | 90,000 |
| NVMe | 2 × 3.84 TB, RAID 1 | 90,000 |
| NIC, rails, PSU | 25 GbE redundant | 40,000 |
| **Per GPU node** | **2 GPUs ⇒ ~2 lakh artisans** | **≈ ₹9,70,000** |

🧮 **Amortised over 4 years: ₹20,200/month per node, or ₹10,100 per GPU per month.**

💲 Running costs per node: power (~450 W under load ⇒ 324 kWh/month at ₹8/unit ≈ **₹2,600**) +
colocation 2U with redundant power and 1 Gbps commit (**₹8,000–15,000/month**).

🧮 **All-in per GPU node: ≈ ₹32,000/month.** Serving ~2 lakh artisans ⇒ **₹0.16 per artisan per
month** for AI compute.

### 2.3 🧮 Capex by scale

| | S1 Pilot | S2 State | S3 National | S4 Full TAM |
|---|---|---|---|---|
| GPU nodes | 1 | 1 | 3 | 24 |
| App/DB/cache nodes | 1 | 4 | 12 | 80 |
| **Hardware capex** | **₹15 L** | **₹40 L** | **₹1.6 Cr** | **₹11 Cr** |
| 🧮 Amortised/month (4 yr) | ₹31,000 | ₹83,000 | ₹3.3 L | ₹23 L |
| Colo + power + bandwidth/month | ₹20,000 | ₹1.2 L | ₹4.5 L | ₹32 L |
| **Total infra/month** | **₹51,000** | **₹2.0 L** | **₹7.8 L** | **₹55 L** |

**Add for a government deployment, and these are not optional:** a second site for DR (~60% of
primary), MeitY-empanelled cloud or a STQC-audited datacenter, and an annual security audit
(💲 ₹3–8 lakh).

---

## 3. Option B — Rent it (opex, cloud)

Right for the pilot, right for burst, and right until utilisation is provably sustained.

💲 List prices, `ap-south-1` / Indian regions — **verify**. Indian MeitY-empanelled alternatives
(E2E Networks, Yotta, CtrlS, NxtGen) typically quote **30–50% below hyperscaler list** and satisfy
data-localisation procurement conditions — get quotes before assuming AWS pricing.

| Line | S1 Pilot | S2 State | S3 National |
|---|---|---|---|
| GPU (T4/L4, 1-yr reserved) | ₹20,000 | ₹40,000 | ₹2.4 L |
| App tier (stateless, autoscaled) | ₹8,000 | ₹65,000 | ₹2.6 L |
| Postgres (managed, HA + replicas) | ₹6,000 | ₹1.1 L | ₹4.0 L |
| Redis | ₹2,000 | ₹12,000 | ₹45,000 |
| Object storage (**R2**) | ₹100 | ₹46,000 | ₹1.85 L |
| Egress / CDN (**R2 = ₹0 egress**) | ₹1,700 | ₹1,700 | ₹20,000 |
| Monitoring, logs, backups | ₹3,000 | ₹25,000 | ₹90,000 |
| **Total/month** | **₹41,000** | **₹3.0 L** | **₹12.4 L** |
| 🧮 **Per artisan/month** | ₹20.50 | **₹1.20** | **₹1.24** |

### 3.1 🧮 Buy vs rent — the crossover

| | Cloud/month | Own/month | Verdict |
|---|---|---|---|
| S1 Pilot | ₹41,000 | ₹51,000 | **Rent.** Utilisation is low and lumpy |
| S2 State | ₹3.0 L | ₹2.0 L | **Own** — if the programme is committed ≥3 years |
| S3 National | ₹12.4 L | ₹7.8 L | **Own the steady state, rent the peak** |

> **🧮 The honest recommendation: hybrid.** Own the baseline GPU capacity (utilisation is
> predictable and high), rent the burst. **The enhancement queue is asynchronous by contract, so it
> tolerates preemption** — 💲 spot/preemptible GPU is **60–70% below on-demand** and is *safe* for
> this workload specifically because `ai/enhance/jobs.py` already treats a lost job as recoverable
> and rule 3 already guarantees a lost enhancement never costs the listing. **An architectural
> decision taken for reliability turns out to unlock the cheapest compute tier available.**

---

## 4. The lines that are bigger than the servers

🧮 At S3, infrastructure is ₹7.8–12.4 lakh/month. **These three are larger.**

### 4.1 🔴 GeM order reconciliation — the largest cost in the entire programme

**GeM has no order API.** Orders appear on the GeM seller dashboard and nowhere else, so a human
reads it and marks the order in the admin console (`/gem-recon`).

🧮 Assume 25% of active artisans transact on GeM, and one coordinator handles 500 such artisans:

| | S2 State | S3 National |
|---|---|---|
| GeM-active artisans | 25,000 | 100,000 |
| Coordinators needed | 50 | 200 |
| 💲 At ₹25,000/month each | **₹12.5 L/month** | **₹50 L/month** |
| **Per year** | **₹1.5 Cr** | **₹6 Cr** |

> **🧮 A GeM order-notification API — one MoU, zero engineering on their side beyond what already
> exists — removes ₹6 crore a year of recurring public expenditure.**
>
> **This is the single most valuable thing to put in front of a ministry panel.** It costs them
> nothing, it is entirely within their gift, and it converts a permanent operating expense into a
> webhook. We should ask for it in the room.

**And the counter-argument, stated fairly:** those 200 coordinator posts are 200 rural jobs, and
the same person also runs the Cluster Hub — quality check, packing, consolidated pickup. **The
role does not disappear if the API arrives; the reconciliation half of it does**, which is the
half that produces no value for anyone.

### 4.2 🟡 ECO compliance — TCS and monthly GSTR-8

Because we become the ONDC Marketplace Seller Node, **we** are the e-commerce operator. Per **CBIC
Circular 194/06/2023**, where the supplier-side ECO is not itself the supplier, **it carries the
TCS liability**. That means TCS collection at 0.5% CGST + 0.5% SGST on net taxable supplies, and
**monthly GSTR-8 filing**.

💲 Compliance retainer: ₹40,000–₹1,00,000/month at S2, scaling to **₹3–5 lakh/month at S3** plus
reconciliation tooling. 🧮 **₹35–60 lakh a year at national scale.**

> **This is the price of Tier A and it is worth it** — it is the mechanism by which an artisan with
> no GST registration can sell nationally. **But it is a real, recurring, non-technical obligation
> and a costing that omits it is wrong.**

### 4.3 🟡 DPDP and security

| Line | 💲 Annual |
|---|---|
| Named Data Protection Officer (1 FTE at S3) | ₹18–25 L |
| Consent-manager integration + audit | ₹8–15 L |
| Annual security audit / VAPT (STQC or CERT-In empanelled) | ₹3–8 L |
| Breach-response retainer | ₹5–10 L |
| **Total at S3** | **₹35–58 L/year** |

**Non-negotiable, not discretionary.** DPDP penalties reach **₹250 crore** for serious violations
and **₹200 crore** for failure to notify a breach. 🧮 **The entire compliance budget is 0.2% of a
single maximum penalty.**

### 4.4 🧮 Engineering and support

| | S2 State | S3 National |
|---|---|---|
| Engineers (backend, app, ML, infra) | 5 | 12 |
| 💲 At ₹18 L/year loaded | ₹90 L | ₹2.16 Cr |
| Support / helpline (multilingual) | 4 | 20 |
| 💲 At ₹4.5 L/year | ₹18 L | ₹90 L |
| **Total/year** | **₹1.08 Cr** | **₹3.06 Cr** |

---

## 5. 🧮 Total cost of ownership — the number a ministry actually needs

| | **S1 Pilot** | **S2 State** | **S3 National** |
|---|---|---|---|
| Artisans onboarded | 2,000 | 2,50,000 | 10,00,000 |
| Infrastructure | ₹6 L | ₹24 L | ₹94 L |
| Marginal (LLM/ASR/storage), **with Bhashini** | ₹0.6 L | ₹65 L | ₹2.6 Cr |
| GeM reconciliation | ₹6 L | ₹1.5 Cr | ₹6.0 Cr |
| ECO compliance | ₹3 L | ₹12 L | ₹50 L |
| DPDP + security | ₹5 L | ₹25 L | ₹50 L |
| Engineering + support | ₹60 L | ₹1.08 Cr | ₹3.06 Cr |
| **TOTAL / YEAR** | **≈ ₹81 L** | **≈ ₹3.84 Cr** | **≈ ₹13.6 Cr** |
| 🧮 **Per artisan / year** | ₹4,050 | **₹154** | **₹136** |
| 🧮 Per artisan / year, **if GeM ships an order API** | ₹3,750 | **₹94** | **₹76** |

**Read the last two rows together.** Cost per artisan **falls by 96% from pilot to state scale**
and then flattens — because the fixed engineering and compliance base is spread wider while the
variable lines stay tiny. **This system gets dramatically cheaper per head as it grows, which is
exactly the property a national programme needs and exactly what per-image API pricing would have
destroyed.**

### 5.1 The comparison that frames it

💲 Context figures — verify against current budget documents before quoting:

| Reference | Scale |
|---|---|
| PM Vishwakarma scheme outlay | ~₹13,000 crore |
| 🧮 This system, national, 10 lakh artisans, per year | **₹13.6 crore** |
| 🧮 **As a share of that outlay** | **≈ 0.1%** |

> **🧮 One-tenth of one percent of an existing scheme's outlay digitises ten lakh artisans —
> permanently, with a catalog they own, on channels the government already runs.**

---

## 6. Cost-reduction levers, ranked by rupees saved

**The ministry will ask how to spend less. This is the answer, in order.**

| # | Lever | 🧮 Annual saving at S3 | Effort |
|---|---|---|---|
| 1 | **Confirm Bhashini commercial terms** — avoids commercial ASR entirely | **₹18 Cr avoided** | **One email.** Unassigned today |
| 2 | **Self-host CV** (already decided) — vs a per-image API | **₹17.6 Cr avoided** | Done |
| 3 | **GeM order API MoU** | **₹6.0 Cr** | A ministry conversation, no code |
| 4 | **Self-host the description LLM** past crossover (§6.1) | **₹1.4 Cr** | ~2 weeks |
| 5 | **Cloudflare R2 instead of S3** — zero egress | **₹1.2 Cr** | One afternoon |
| 6 | **Pipeline CPU/GPU separately** — 3.2× throughput | ~₹25 L, and defers GPU purchases | A refactor |
| 7 | **BiRefNet-lite** — 1.47× on top, half the VRAM | ~₹15 L | A config flag. Already benchmarked |
| 8 | **Spot/preemptible GPU for the enhance queue** | 60–70% of burst compute | Safe by existing design |
| 9 | **Archive originals after 90 days** | ~₹10 L | A lifecycle rule |
| 10 | **Client-side downscale before upload** | Artisan's own data cost, and our ingress | The single highest-value unbuilt app item |

> **Levers 1, 3 and 5 together are worth ₹25 crore a year and none of them is an engineering
> problem.** Two are conversations and one is a vendor choice. **That is the costing insight worth
> saying out loud in the room.**

### 6.1 🧮 The self-hosted-LLM crossover, worked

Description generation costs **₹1.66/product** on a frontier API (Part A §3.2). A self-hosted
open-weights model (an Indic-capable 7–12B, served on a GPU we already own) costs 🧮 roughly
**₹0.05/product** in amortised compute, plus one dedicated GPU node at ₹32,000/month.

```
Crossover:  monthly_products × (₹1.66 − ₹0.05)  >  ₹32,000
            monthly_products > 19,900
```

🧮 **Past ~20,000 products a month — reached at roughly 6,700 active artisans — self-hosting the
description model is cheaper.** S2 and S3 are both far past it.

**The caveat that decides whether to actually do it:** quality. EN + HI SEO descriptions plus
structured field extraction is the hardest language task in the system, and a cheaper model that
produces a rejected listing has saved nothing. **The right sequencing is: keep the API until we
have a held-out evaluation set from real listings, then migrate on measured quality, not on the
crossover date.** 🎯 And an Indian open-weights model here is both the cheaper answer and the
better political one on a government deployment — which is the honest argument for putting Sarvam
on the slide *after* wiring it, not before (Part 0, A0.4).

---

## 7. Cost questions a judge will ask

**Q — "Your AI costs will explode when you scale."**
🧮 No — they are sub-linear and we can show why. The model that runs on **every** photograph is
self-hosted, so its marginal cost is electricity: **₹0.005 per photograph.** One GPU serves ~100,000
artisans. The per-image API alternative would cost **₹1.76 per photograph — 345× more** — and that
is the decision that determines whether this scales, not the model choice.

**Q — "What is the cheapest way to run this?"**
Own the baseline GPUs, rent the burst on preemptible instances, Cloudflare R2 for storage and
egress, Bhashini for speech, self-host the description model past ~20,000 products/month. 🧮 That
combination takes national cost from ~₹13.6 crore to **~₹6 crore a year** — before the GeM API,
which takes it to **~₹5.5 crore.**

**Q — "What if the government wants everything on Indian soil?"**
It already almost is, and it makes us *cheaper*, not dearer. Self-hosted CV runs anywhere we put
it. Postgres, Redis and object storage go to a MeitY-empanelled Indian provider — 💲 typically
**30–50% below hyperscaler list.** The **only** cross-border dependency is the LLM API, and §6.1
shows we should self-host it past 20,000 products/month anyway. **Data localisation and cost
reduction point the same direction here**, which is unusual and worth saying.

**Q — "What happens if funding stops?"**
🧮 The artisan's catalog is portable by design — products live in our DB and export to GeM Excel,
ONDC, and platform payloads. **The minimum survivable configuration is read-only serving of
existing catalogs plus GeM export: one small GPU node and one app node, ~₹60,000/month.** New
enhancement stops; nothing already published disappears. **That is a deliberate property of the
factory model** (`docs/Master-Technical-Reference.md` §2): *the catalog is ours, and edit once →
all exports regenerate.*

**Q — "Your per-artisan cost is ₹136. Prove it is not ₹1,360."**
🧮 The number rests on three things, and only one is uncertain. **GPU capacity is measured**
(402 ms, 1615 MiB, on named hardware). **Storage and egress are vendor list prices.** The
uncertain one is **ASR** — Bhashini free versus commercial is the difference between ₹136 and
₹316 per artisan-year, and it is `docs/decisions.md` #5, still open. **We have given you both
numbers rather than the flattering one.**

---

## 8. 🚫 What must be verified before any of this is quoted in a procurement conversation

| # | Item | Owner |
|---|---|---|
| 1 | 🔴 **Bhashini commercial terms, rate limits, eligibility** — the single largest cost variable | |
| 2 | 🔴 NVIDIA L4 / L40S India OEM quotes, and datacenter licensing confirmation | |
| 3 | 🔴 MeitY-empanelled provider quotes (E2E, Yotta, CtrlS, NxtGen) vs hyperscaler list | |
| 4 | 🟡 Current OpenRouter / Anthropic list prices — they move | |
| 5 | 🟡 Cloudflare R2 India egress and any regional caveats | |
| 6 | 🟡 GeM Vendor Assessment (~₹11,200) — **are artisan OEMs exempt?** In writing | |
| 7 | 🟡 ONDC network participant fees and any transaction levy | |
| 8 | 🟡 Coordinator salary norms under existing cluster schemes — §4.1 rests on ₹25,000/month | |
| 9 | 🟡 PM Vishwakarma outlay, from the current budget document, for the §5.1 comparison | |

> Same rule as `research/pricing/`: **a dated vendor quote is research. A remembered price is a
> guess.** Every 💲 in this document is a remembered price until someone replaces it with a quote.
