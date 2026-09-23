# Part 5 — Market linkage: the channels, and what "one tap" actually means

---

## Q5.1 — "One tap to Amazon, Flipkart, Meesho, GeM and ONDC. Which of those have you actually published a listing to?"

**Think.** One. Say "one" first. Then give the tier table, because the tiering is the answer and it
is stronger than the claim it replaces.

**Answer. One — our own marketplace. Everything else is mapped, rendered or connected, and I will
tell you exactly which is which.**

| Channel | Tier | State today | Blocker |
|---|---|---|---|
| **Our marketplace** | A | **Live.** `routers/publish.py` persists it, `routers/marketplace.py` serves it | — |
| **ONDC** | A | Catalog **mapped**, returns `dry_run` | No beckn-onix subscriber id issued yet |
| **GeM** | C | `.xlsx` renderer built, `openpyxl` | **Zero real category templates in the repo** — `gem_templates/` holds a README and nothing else |
| **Amazon** | B | OAuth real, payload real, **`PUT` not implemented** | `TODO(phase 8)` in `channels/amazon.py` |
| **Flipkart** | B | Same shape, 51 lines | Same |
| **Meesho** | D | Copy-paste block + guided browser | No public API exists |
| **WhatsApp** | D | Image + caption | — |

**Our own registry says it, unprompted, in a docstring** (`web/api/channels/registry.py`):

> *"This said 'two live listings … and it is real' while ONDC was returning a fabricated
> `ondc:{id}`. Put the two back when the push is real. **The number here is the demo claim, and a
> demo claim that outruns the code is how you lose the room.**"*

**The Amazon adapter refuses to lie for the same reason**, and I would read this line aloud if
asked: *"An artisan who has done the work of connecting their Seller Central account has earned an
accurate answer about what we then did with it."* It returns `dry_run` with the message
*"SP-API listings PUT not implemented — nothing was sent to Amazon."*

**Why the tiering is the better pitch.** A flat "one-click everywhere" claim does not survive one
industry judge. **The tiering proves we know which Indian platforms have APIs and which do not** —
and that knowledge is the actual product. Anyone can call an API. Knowing that GeM has none, that
Meesho is partner-gated, that Myntra requires a **trademark certificate a weaver cannot possibly
have** — that is the work.

**Dropped deliberately, and this matters:** Myntra, Nykaa, Ajio. Myntra onboarding requires GST,
PAN, Aadhaar, **a trademark certificate or brand authorisation letter**, address proof and
incorporation documents. **A weaver has no trademark.** If an industry judge is in the room,
claiming Myntra integration is instant credibility loss. They are off every slide.

---

## Q5.2 — "GeM has no seller API. So how is uploading a spreadsheet 'AI-driven market linkage'?"

**Think.** This is where our best story is, and it is counter-intuitive enough that it needs the
number up front.

**Answer. GeM has 10,700+ product categories.**

Choosing the wrong one is the single most common listing failure — errors in category selection and
attribute accuracy cause delayed approvals, repeated rejections and lost opportunities. **An
artisan cannot navigate 10,700 categories. Neither can most educated sellers: an entire consultancy
industry exists purely to fill GeM catalogues correctly.**

A vision model maps a photograph of a Sambalpuri saree to the right GeM category. NLP fills the
attribute schema. We look up the HSN code.

> **That is a consultancy industry, automated, free, in the artisan's own language.**
> Background removal is a commodity. **This is not.** This is what "AI-driven market linkage"
> actually means.

**And the Excel path is the official one, not a workaround.** Per GeM's own Catalogue Management
guidance: sellers may use the bulk upload facility with the category-specific Excel format, and
once filled accurately and saved, **the item is automatically listed on GeM 3.0**. So our job is
precisely stated: **generate a perfect, category-correct GeM Excel from a photograph and a voice
note.**

**The blocker, and it is in the adapter's own docstring as ⚠️ BLOCKING:** the real category
templates are `docs/Master-Technical-Reference.md` §18 items 1 and 2 and **are not in the repo.**
`_load_template` reads a JSON descriptor per category *"so that when the real templates arrive,
adding one is dropping in a file — never editing this adapter."* The architecture is right and the
data is missing. **Phase 7 cannot start without it**, and it is the single highest-priority
unassigned task in the project.

**The GeM facts that make this channel the right primary**, and which most teams will not know:

| Fact | Detail |
|---|---|
| Caution money | **Artisans and weavers FULLY EXEMPT** |
| Transaction charges | **Zero up to ₹10 lakh** order value |
| Annual Milestone Charge | One-time ₹10,000 only after ₹20 lakh Seller Merchandise Value in a FY |
| Registration | Free, online, paperless, 1–3 working days |
| MSE quota | **Minimum 25% of government procurement reserved for MSMEs** — guaranteed demand |
| Already on GeM | ~1.5 lakh weavers and handloom entities |
| Top rejection cause | **Name mismatch** across Aadhaar / PAN / GST / bank |

> **An artisan will never cross ₹20 lakh SMV. GeM is completely free for our users.** No caution
> money, no transaction charges, no milestone charge, free registration. **The only remaining
> barrier is knowing how — and that is exactly the barrier we remove.**

**Still unverified and we say so:** Vendor Assessment (~₹11,200 + GST) applies to
manufacturers/OEMs, and **an artisan is an OEM, not a reseller.** Exemption route exists;
**Vendor Validation is still required.** We need it in writing from GeM and we do not have it.

---

## Q5.3 — "The top GeM rejection is a name mismatch. What do you do about it?"

**Think.** Small feature, disproportionate value, and it demonstrates that we researched failure
modes rather than happy paths.

**Today.** Before an artisan starts *any* government signup, `/channels/gem/setup` asks them to
**say their name three times** — as printed on the PAN, on the bank passbook, on the Aadhaar card.
We compare the three transcripts.

**Twenty seconds of voice, before they spend three days on a registration that will be rejected.**
It costs us almost nothing and it is the single highest-value thing on that screen.

**And it is privacy-clean by construction:** we store the **comparison result**, never the
names-as-documents. `docs/Application-Architecture.md` §6.1.

---

## Q5.4 — "You said artisans need no GST. That is a strong claim. On what authority?"

**Think.** Cite the notification number. This is the one place a specific legal citation wins the
room outright, because almost nobody else will know it exists.

**Answer. Notification 34/2023-Central Tax, effective 1 October 2023.**

Persons supplying goods **through an e-commerce operator** are **exempt from mandatory GST
registration** where:

- (a) supplies are within a single State/UT
- (b) no inter-state supply
- (c) they have a PAN
- (d) the PAN is declared on the GST portal with place of business and State/UT
- (e) they obtain an **enrolment number** on the common portal after PAN validation — and cannot
  supply through an ECO before that

Applicable where aggregate turnover in the previous and current FY is below the State/UT
registration threshold. **GSTN has built the enrolment functionality.**

**So we built the GST Enrolment Wizard** (`/wizard/gst`, route 20). Three spoken questions —
*"Kis rajya me hain? Doosre rajya me bhejenge? Saal me kitna kaam?"* — routing to one of three
outcomes:

| Situation | Path |
|---|---|
| Intra-state only, below threshold | **No GST needed** — enrolment number only. The wizard walks them through |
| Inter-state intent | Full GST registration required — no exemption |
| Above threshold | Full registration |

> This feature **literally, legally** addresses "drastically lower the barrier to entry," and
> almost no other team will know this notification exists.

**The reciprocal obligation, which we state rather than hide.** Because we become the ONDC
Marketplace Seller Node, **we** are the e-commerce operator. Per **CBIC Circular 194/06/2023**,
where the supplier-side ECO is not itself the supplier, **it carries the TCS liability** — so TCS
collection and **monthly GSTR-8 filings are ours, not the artisan's.**

**That is a real, recurring compliance obligation on us. It is the price of Tier A and it is worth
it** — because it is the only mechanism by which a weaver with a phone and a PAN card can be
selling on a national network with no registration of their own. Cost of that compliance is a line
item in the costing document, not a footnote.

---

## Q5.5 — "Explain the ONDC claim. Why does an artisan need nothing at all?"

**Think.** This is our strongest architectural decision. State the mechanism, then the consequence.

**Today — the posture, decided and recorded** (`docs/decisions.md`): **we become the ONDC
Marketplace Seller Node.** An MSN does not hold its own inventory; it offers other sellers' goods.
That is an exact fit. **We register once. Every artisan is a sub-seller under our node.**

Consequences, and each one is a barrier deleted:

- No ONDC registration for the artisan
- No DigiReady certification
- **No GST** — Notification 34/2023 applies because *we* are the ECO
- One tap → visible across **every ONDC buyer app simultaneously** (Paytm, Magicpin, Mystore, …).
  **One integration, many buyer apps. Amazon offers nothing comparable**

> A weaver with a phone and a PAN card goes from zero to sellable on a national network in one tap.

**What it costs technically.** Self-signed certificates with **separate key pairs for signing and
encryption**, separate certs for buyer node (BAP) and seller node (BPP), registration on the
registry portal with Subscriber ID, country, cities, domain and type; then the subscription
workflow and registrar approval. After that we hold `subscriber_id`, `signing_public_key`,
`encryption_public_key`, used in every request.

**State today: `dry_run`.** The catalog is mapped; **nothing is signed or pushed**, because the
subscriber id has not been issued. There is a staging environment and it is the most demoable of
all our channels — that is phase 6 and it is the phase that makes the USP real.

**Breaks when.** Registrar approval is an external dependency on someone else's timeline. If it
does not land, Tier A collapses to one channel — our own marketplace — and the "zero paperwork"
claim loses its national reach. That is the largest single external risk in the project.

---

## Q5.6 — "You are filling forms on government websites with an injected script. Is that not automation of a portal you do not own?"

**Think.** They are probing for a Play Store / terms-of-service problem. There is one nearby, we
already rejected it, and saying so is the answer.

**What we rejected, explicitly and by name** (`CONTRIBUTING.md`, rejected list): an
**`AccessibilityService` overlay on top of the real Amazon/Flipkart apps.** Google Play permits
that API only for genuine disability tools; **enforcement tightened 28 January 2026, and Android 17
blocks non-accessibility apps from the API outright.** Misuse means app suspension and
developer-account termination. **On a government problem statement that is disqualifying. The idea
is dead.**

**What we built instead — our WebView, their site.** The artisan taps *"GeM par register karein"*,
an in-app browser opens gem.gov.in in a container we control, and a bar pins to the bottom that
speaks each instruction and puts the exact value on the clipboard. The artisan self-reports done.

**Autofill is a layer on top of that, not a replacement.** It is legitimate because it is **the
artisan's own browser session, on the artisan's own account, filling the artisan's own data, at the
artisan's explicit request** — materially different from automating a third party's app from
outside.

**Four non-negotiable rules, and rule 3 is the one that answers the question:**

1. **Selectors live on the server** — versioned JSON, fetched at runtime, never compiled into the
   app. A DOM change is a config push we ship in an hour.
2. **Every step degrades, never fails.** Selector misses → that step falls back to guided-paste,
   speaks the instruction, and carries on. The artisan sees a slower step, never a broken screen.
3. **We never automate submit, login, OTP, payment or CAPTCHA.** **We fill fields. The artisan
   presses the button.** A human stays in the loop on every consequential action.
4. **Health telemetry per selector.** Match-rate per step per pack version; below threshold →
   alert, and the channel **auto-reverts to guided-paste** until a new pack ships.

**Ships off. Per-channel flag. Turns on only after its selector pack holds >95% match for a week.**
Rollout order is cheapest DOM first: GeM registration → GST enrolment → Meesho Supplier Hub. Never
Amazon or Flipkart *listing* forms, because Tier B already has a real API.

**The honest framing for judges**, verbatim from `docs/Application-Architecture.md` §6.4:

> *"Tier A and B are one tap through APIs we control. Tier C and D are one tap plus a confirm,
> through an assisted browser that fills the artisan's own forms on the artisan's own account —
> and degrades to spoken step-by-step guidance the moment a page changes."*

**Breaks when.** A portal redesign. That is *when*, not *if* — which is exactly why selectors are
server-side config and why the fallback is the default rather than the exception.

---

## Q5.7 — "You call it a virtual business manager. GeM has no order API. So where do GeM orders appear?"

**Think.** There is a real hole here. `docs/Master-Technical-Reference.md` §9.3 tells us how to
answer it, and the instruction is to not pretend.

**Answer. They do not appear automatically. GeM orders land on the GeM seller dashboard and
nowhere else.**

**How we handle it, in preference order:**

1. **A cluster coordinator checks the GeM dashboard and marks the order in the admin console**
   (`/gem-recon`, admin page 5). **A real, fundable job — remote, over a phone call, never a field
   visit.**
2. **Email parsing**, if GeM sends order notification emails.
3. **Roadmap:** "GeM order API pending MoU."

> **Do not pretend we have GeM order sync. Stating the gap and showing the workaround reads as
> maturity. Faking it is a question we cannot survive.**

**What *is* automatic, so the manager claim is not empty:**

| Channel | Mechanism |
|---|---|
| Our marketplace | Direct DB write — instant, we own it |
| ONDC | Beckn callbacks (`on_confirm`, `on_status`) — **true push** |
| Amazon | Notifications API → queue; Orders API as fallback poll |
| Flipkart | **Order Management Notification webhooks — confirmed to exist** (closed §18 item 7) |
| GeM | ❌ none — coordinator reconciles |
| Meesho | ❌ none — manual |

All of them normalise into **one canonical `Order`** with one state machine — placed → packed →
shipped → delivered → settled — and one artisan inbox in their language with a voice notification.
The unification is the product; the ingestion mechanism differs per channel and always will.

---

## Q5.8 — "Two buyers on two platforms buy the same one-of-a-kind saree in the same second. What happens?"

**Think.** Do not claim to solve it. Nobody solves it. Say that, then show the mitigation that
actually shrinks the problem, because that part is genuinely good.

**Answer. One of them loses, and there is a window in which that is unavoidable.** Propagation to
Amazon and ONDC takes seconds to minutes. **That window cannot be closed. Every multichannel tool
in the world lives with it.**

**What we build** (`docs/Master-Technical-Reference.md` §10.2):

- **Central inventory ledger** — single source of truth in our DB. **No channel is authoritative**
- **Atomic reserve-on-order with optimistic locking** — a `version` column; first write wins,
  second rejected
- **Immediate fan-out** to all channels on any change
- **Oversell resolution flow** — auto-cancel the losing order, apology plus priority-restock offer
  to that buyer, and **never let the artisan absorb the account-health hit silently**

**The mitigation that actually shrinks the problem, and it is a product decision not a technical
one:** **most handicrafts are replicable, not unique.** A weaver can make another gamcha; a
specific antique brass piece he cannot.

| Type | Behaviour |
|---|---|
| **Made-to-order** (qty > 1 + lead time) | **No race condition at all** |
| **Unique piece** (qty = 1) | Reserve-and-race, small window |

**So we push artisans toward made-to-order wherever the craft allows** — which is better for them
anyway, because they never have to turn down demand. `is_made_to_order` and `lead_time_days` are
in the schema from day one.

**Breaks when.** Genuinely unique pieces — antiques, one-off commissions, a single GI-tagged
heirloom. There the window is real, the losing buyer is cancelled, and someone is disappointed.
We chose to make that visible and compensated rather than invisible.
