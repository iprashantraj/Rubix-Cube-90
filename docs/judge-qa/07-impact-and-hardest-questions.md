# Part 7 — Impact, adoption, and the questions we would struggle with

---

## Q7.1 — "No field agents, no home visits. Then who shows a 52-year-old weaver how to open your app the first time?"

**Think.** This is the adoption question and our answer is a constraint, not a plan — so be honest
that it is a bet, and name what the bet rests on.

**The constraint, and it is deliberate** (`docs/Master-Technical-Reference.md` §2, three hard NOs):
**no field agents, no human visits** — because a solution requiring a visit breaks the PS's own
words, *"without requiring advanced technical knowledge."* If the app only works when someone sits
beside them, we have built a training programme with a login screen.

**So the first run has to carry itself, and that is what the eight-screen onboarding is for:**
language tiles that **speak their own name on tap**, a spoken consent notice, and **the camera by
screen eight** — no tour, no dashboard, no feature list. The very first thing that happens is the
thing they came for.

**And the camera is the part that genuinely needs no teaching.** Red ring, shutter greyed out and
dead. Green ring, shutter glows. Hold green one second, it fires itself. **They move until the
button lights up.** No instruction, no literacy, no helper.

**What exists behind it when that is not enough:**

- **`/help` — one button, one callback request to a cluster coordinator.** Remote, a phone call,
  never a visit.
- **The admin console** is built for exactly this: assisted onboarding support, remote
  (`docs/Application-Architecture.md` §9).
- **Existing human infrastructure we did not have to build:** ~5.4 lakh **CSC Village Level
  Entrepreneurs**, ≈4.35 lakh of them in gram panchayats, plus cluster coordinators at Common
  Facility Centres. **These people already exist, are already funded, and already sit where our
  users are.**

**Breaks when.** The bet is that a spoken, gated, three-tap flow clears the first-run barrier
without a person present. **We have not tested it with a single artisan.** That is the largest
untested assumption in the project and it is not a technical one. One afternoon in one cluster
would tell us more than another week of code.

---

## Q7.2 — "Your impact goal is higher income. How would you prove it, and what if you are wrong?"

**Think.** Give the measurement design, then state the falsification condition. A team that names
what would prove it wrong is more credible than one that only names what would prove it right.

**What we can measure honestly:**

| Signal | Source | Honest? |
|---|---|---|
| Listings created per artisan | Ours | Yes — but it is an output, not an outcome |
| **Orders per artisan per channel** | `Order` | Yes. **The real number** |
| Realised price vs the computed floor | `floor_price` vs `price` | Yes — **directly measures whether we stopped a loss-making sale** |
| **`artisan_confirmed_payment`** | The "Paisa aaya?" tap | Yes — settlement reality, not the marketplace's promise |
| Total annual income | — | **No. We cannot see their bank account** |

**So the defensible claim is narrower than the PS's phrasing and we should use the narrow one:**
we can prove **channel access created**, **orders received**, and **sales prevented below cost**.
We cannot prove total household income, and any team claiming they can is not counting the
middleman sales that never touch a platform.

**The falsification condition, stated up front:** if listings per artisan rise and **orders per
artisan stay flat**, then cataloging was not the bottleneck and our thesis is wrong. That number is
in the schema from day one specifically so it can embarrass us.

**The counterfactual problem, conceded:** an artisan who adopts our app is already more motivated
than one who does not. Any income difference is partly selection. **The only clean answer is a
staggered rollout across comparable clusters** — cluster A onboards in month 1, cluster B in month
4 — which a ministry pilot can actually do and a hackathon cannot.

---

## Q7.3 — "Who pays for this? Your slide says government support, white-label licensing and marketplace. Which one is real?"

**Think.** Answer the constraint first, because it is the part that binds.

**The hard constraint** (`docs/Master-Technical-Reference.md` §2): **we never charge artisans.
Anything.** That is a locked no, and it removes the obvious revenue line.

**Which leaves, in order of realism for a government deployment:**

1. **Government-funded, per-artisan-onboarded.** The natural fit for MoSJE / DC-Handicrafts /
   PM Vishwakarma, and it is the only model where incentives align — the ministry wants artisans
   digitised, we are paid to digitise them. **Costing document gives the per-artisan figure**, and
   it is small enough that this is a rounding error against existing scheme outlays.
2. **White-label to state handicraft boards and cooperatives.** Odisha, Gujarat, UP each run their
   own emporium and cluster programmes. Same code, per-tenant, and multi-tenancy is already in the
   design.
3. **Marketplace commission on our own surface only** — never on GeM or ONDC, where the artisan's
   sale is theirs.

**The uncomfortable honest note:** if the government funds it and then stops, the running cost
falls on whoever holds the servers. That is why the costing document's most important number is not
the total — it is **cost per artisan per year**, and why every cost-reduction lever in it matters.

---

## Q7.4 — "Environmental benefit through reduced travel. Is that a real claim or a slide filler?"

**Answer. Directionally true, unquantified, and I would not lead with it.**

The mechanism is real: an artisan who sells year-round from a phone travels less to periodic fairs
and melas, and **the Cluster Hub consolidates fifty rural courier pickups into one stop** — that
second one is a genuine, countable reduction in vehicle-kilometres.

**But we have measured nothing**, and there is an offsetting cost we do not currently count: parcel
shipping for individual online orders, which fair-based selling does not incur. **A claim that
ignores its own counter-term is not a claim.**

**Keep it on the slide, phrase it as the hub consolidation** — that one survives scrutiny. Drop the
general travel-emissions framing.

---

## Q7.5 — "Return to origin. A buyer refuses delivery. Who eats the cost?"

**Think.** This is the question that quietly decides whether the artisan is better or worse off,
and it deserves a straight answer.

**The decision:** **prepaid only at launch.** COD is huge in India and carries huge RTO risk, and
**artisans cannot absorb return-to-origin costs.** One refused COD parcel can erase the margin on
five sales.

**And the rule that follows:** return-shipping liability is **defined explicitly per channel and
shown to the artisan BEFORE they list — never a surprise.** Also enforced before listing:
**pincode serviceability.** If their pincode is not serviceable, we block self-ship channels and
route to the Cluster Hub only. **Discovering that after a sale is a disaster**, and it is why
pincode is collected on onboarding screen 6 rather than at checkout.

**Who inspects a returned item?** The Cluster Hub. **We track RTO rate per artisan and per
category**, because it is the metric that predicts whether a category is viable online at all.

---

## Q7.6 — "You have four weeks. What are you cutting?"

**Think.** Show the build order, and show that the cut line was drawn before the pressure arrived.

**Phases 1–6 are the defensible core**, and each phase ends in something demoable with nothing
built that a later phase rewrites:

| Phase | Ships | Proves |
|---|---|---|
| 1 | Onboarding, camera gate, resumable upload, schema | An artisan can sign up and take a good photo |
| 2 | `ai/enhance` real + colour lock | The main image is marketplace-grade |
| 3 | Bhashini ASR/TTS + `ai/catalog` | **PS feature 2 done** |
| 4 | `ai/price` cost-up + floor + GeM discount math | **PS feature 3 done** |
| 5 | Marketplace SSR + `/publish` | **First real one-tap listing** |
| 6 | ONDC MSN on staging + adapter | **Tier A complete. The USP is real** |

**Phases 11 and 12 — the guided browser with autofill, and generative secondary images — are
upside. If either slips, nothing in the PS goes unanswered.** That sentence is in
`docs/Application-Architecture.md` §11, written before the deadline pressure, which is the only
time a cut line means anything.

**And the generative feature specifically is scoped as what it is:** *"a demo weapon, not a product
foundation. 20 seconds on stage. Build the boring pipeline properly."*

---

# The five questions we would struggle with

Written down so nobody is surprised on stage. **Each one has a real answer that is a concession.**

### 1. "Have you put this in front of a single artisan?"
**No.** Every threshold is calibrated on **web-sourced** fixtures, not photographs taken by
artisans on ₹7,000 phones in Indian light. Our own `research/RESULTS.md` says the fixture set is
"too web-sourced." **This is the honest ceiling on every number in Part 2**, and no amount of
further engineering removes it.

### 2. "Your slide says ML pricing and your code has none."
Concede immediately, explain that arithmetic is the defensible choice with no training data, and
**fix the slide before the presentation** (Part 0, A0.1). If the panel finds it first, everything
else we say gets re-read as marketing.

### 3. "Show me a live listing on GeM or Amazon."
**We cannot.** GeM has no API and we have **zero real category templates**. Amazon's SP-API `PUT`
is unimplemented, public-app publication requires Amazon review that is not achievable in this
timeframe, and public apps are capped at 25 seller authorisations until then. **We can show our own
marketplace end to end**, and we should offer that proactively rather than be walked into the gap.

### 4. "Prove your app increases income."
We can prove orders, channel access, and losses prevented at the floor. **We cannot prove income**
— we cannot see their bank account, and middleman sales never touch a platform. Only a staggered
ministry pilot answers this properly.

### 5. "What if listing was never the bottleneck?"
The honest answer is that IndiaHandmade's 0.1% is **consistent** with our thesis and does not
**prove** it. If listings rise and orders stay flat, we automated the wrong half. We built the
metric that would tell us, and we would rather find out than not.

> **The pattern in all five: we know exactly where the edge is.** A team that can point at its own
> edge is more trustworthy than one that claims not to have one — and on a government problem
> statement, trustworthiness is the thing being procured.
