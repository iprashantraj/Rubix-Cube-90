# Application Architecture

### SIH 2026 · PS 26090 · Screen-by-screen build plan

**Status:** v1 · supersedes nothing in `Master-Technical-Reference.md`, extends §3 of it
**Read this after** §1–§3 of the Master Technical Reference.
**Deeper dives:** `docs/app/Camera-Pipeline.md` (the photo path, sensor to published image, extends §7) · `docs/app/Pricing.md` (route 14 `/price` — the formula and the floor)

---

## 0. Decisions locked before this document

| # | Decision | Verdict |
|---|---|---|
| 1 | Offline-first | ❌ **Dropped. Online-first.** Resumable upload + spoken network errors only. Master ref §3.1 amended |
| 2 | ONDC posture | ✅ **We become the Marketplace Seller Node.** Artisans are our sub-sellers |
| 3 | Horizon | 4–8 week internal build, then demo. Tier A/B/C all genuinely working |
| 4 | Image generation | Hosted API (fal / Replicate), opt-in, hard-capped. Enhancement pipeline stays self-hosted |
| 5 | Assisted listing | Voice-guided in-app browser, **with autofill injection layered on top** (§6.4) |
| 6 | Mobile stack | React + Vite + Capacitor |
| 7 | Web stack | Next.js (SSR — marketplace needs to be indexable, Master ref §17.7) |
| 8 | Backend | FastAPI + Postgres + Redis/RQ + S3-compatible object store. Same language as `ai/`, one less stack to run |

---

## 1. The two USPs, stated precisely

### USP 1 — One tap, many channels

The word "one-click" only survives contact with judges if we tier it. Four tiers, and we say which is which:

| Tier | Channels | Artisan effort | Mechanism | Needs artisan account? |
|---|---|---|---|---|
| **A — true one tap** | Our marketplace · **ONDC** | 1 tap | We own the write path | ❌ **No. None. Zero paperwork** |
| **B — one tap after a one-time connect** | Amazon (SP-API) · Flipkart (Seller API) | 1 tap, forever after | OAuth token → real API push | ✅ Yes, one-time |
| **C — one tap to a perfect file** | **GeM** | 1 tap → category-correct `.xlsx` + 3 spec-exact images | No seller API exists. Bulk upload *is* the official path | ✅ Yes |
| **D — guided** | Meesho · IndiaMART · WhatsApp | Voice-guided browser (+ autofill where we have a selector pack) | No public API | ✅ Yes |

#### 🔑 Why Tier A is the whole pitch

**ONDC MSN = the "clustering" idea, made real.**

A Marketplace Seller Node does not hold its own inventory — it offers other sellers' goods. We register **once**. Every artisan on our platform is a sub-seller under our node. Consequence:

- Artisan needs **no** ONDC registration
- Artisan needs **no** DigiReady certification
- Artisan needs **no** GST — Notification 34/2023 exemption applies because *we* are the ECO; they need PAN + an enrolment number, and our GST wizard (§5.7) gets them that
- One tap → live across **every** ONDC buyer app simultaneously (Paytm, Magicpin, Mystore, …)

> A weaver with a phone and a PAN card goes from zero to sellable on a national network in one tap. **No other channel in India can say that, and no other team will have built it.**

**The cost, stated openly:** becoming a seller-side ECO means TCS collection and monthly GSTR-8 filings (CBIC Circular 194/06/2023 — where the supplier-side ECO is not itself the supplier, it carries the TCS liability). That is a real compliance obligation on us, not on the artisan. It is the price of Tier A and it is worth it.

### USP 2 — Our marketplace

Already justified in Master ref §3.3. One addition from this plan: it is also the **Tier A demo surface**. We cannot make a real Amazon listing go live on stage; we can absolutely demo photo → catalog → live listing → buyer RFQ → artisan voice notification, in under three minutes.

---

## 2. Surface map

| Surface | Stack | Routes | Who |
|---|---|---|---|
| Artisan app | React + Vite + Capacitor (Android first) | **25** | Artisan |
| Admin console | Next.js | **8** | Cluster coordinator, agency staff |
| Marketplace | Next.js (SSR) | **9** | B2B buyers, consumers |
| | | **42 total** | |

Backend: one FastAPI service (`web/api`) + the existing `ai/` service. `web/` calls `ai/` over HTTP — do not import across that line (README rule, still holds).

---

## 3. Design law — the constraint that makes this usable

Four rules. Any screen that breaks one gets rejected in review.

1. **≤ 3 tappable things per screen.** If a screen needs four, it is two screens.
2. **Every screen speaks on entry.** Text is the fallback, never the default (Master ref §6.7).
3. **Nothing is typed except the OTP.** Everything else is voice, tap, or camera.
4. **One problem shown at a time.** Never stack two errors. Applies to the camera gate *and* to forms.

Visual: one accent colour, white background, icon + voice always paired, minimum 56dp touch targets, no bottom sheets stacked on modals. Minimal is not an aesthetic here — it is the accessibility requirement in the PS.

---

## 4. Onboarding flow — 8 screens, ~90 seconds, zero typing except OTP

The goal is **first product photographed before any tour, feature list, or dashboard.** Nobody who cannot read wants a product tour.

```
 1  /lang        Language tiles. Each tile plays its own name aloud on tap.
                 No English default. Nothing on this screen is text-only.
                          ↓
 2  /consent     DPDP notice, spoken in the language just chosen.
                 Two buttons: samajh gaya / phir se suno.
                 Stores { timestamp, language, notice_version } — the consent artifact.
                          ↓
 3  /auth        Phone + OTP. This IS the account. No password. No email.
                 ← the only typing in the entire app
                          ↓
 4  /onboard/name    "Aapka naam kya hai?" → voice → ASR → confirm aloud.
                          ↓
 5  /onboard/craft   "Aap kya banate hain?" → 8-icon grid + "kuch aur" voice option.
                          ↓
 6  /onboard/place   Pincode. Drives: courier serviceability, cluster auto-link,
                     intra-state check for the GST route.
                          ↓
 7  /onboard/ready   Four spoken yes/no questions:
                       PAN hai? · bank khata hai? · GST hai? · artisan card hai?
                     🔒 Stores BOOLEANS ONLY. Never a number, never a document photo.
                          ↓
 8  /camera          Straight into the camera. No tour. No dashboard.
```

**If they have no account with us** — steps 3–7 *are* the account creation. There is nothing else. A phone number and four booleans is the entire signup.

**If they have no account on a channel** — that is a separate, later, per-channel flow (§6). It never blocks onboarding, because Tier A needs no channel account at all. **An artisan can complete onboarding, photograph a product, and be selling on ONDC and our marketplace before they have ever heard the word "GeM."**

---

## 5. Artisan app — all 25 routes

Bottom nav, four tabs: **Banao** (create) · **Samaan** (catalog) · **Order** · **Paisa**.

### Onboarding (8)
| # | Route | What |
|---|---|---|
| 1 | `/lang` | Language picker, self-voicing tiles |
| 2 | `/consent` | Spoken DPDP notice → consent artifact |
| 3 | `/auth` | Phone + OTP |
| 4 | `/onboard/name` | Voice → display name |
| 5 | `/onboard/craft` | Icon grid + voice |
| 6 | `/onboard/place` | Pincode |
| 7 | `/onboard/ready` | Four booleans |
| 8 | *(→ `/camera`)* | Straight to first product |

### Create — the core loop (7)
| # | Route | What | Spec |
|---|---|---|---|
| 9 | `/camera` | Live quality gate. Gated shutter, auto-capture on 1s stable green. One problem at a time, hysteresis 0.5s | §4 |
| 10 | `/capture/review` | Rough local cutout instantly; server result replaces it. **Colour lock:** *"kya yeh asli rang hai?"* → publish blocked until confirmed | §5.6 |
| 11 | `/catalog/prefill` | Vision pre-fill spoken back: *"Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?"* → yes = done | §6.4 |
| 12 | `/catalog/voice` | Five voice questions, one per sub-step. Skippable individually | §6.3 |
| 13 | `/catalog/review` | Title + `desc_en` + `desc_hi`, both spoken. Structured fields as removable chips. Correct by voice | §6.1 |
| 14 | `/price` | Cost-up breakdown spoken. **Floor guard warning is always spoken, never silent.** MRP set so GeM's mandated discount still clears floor | §7.2, §7.3 |
| 15 | `/publish` | **The one-tap screen.** See below | §8 |

#### `/publish` — the screen the whole product exists for

```
┌─ Ek click me bhejein ──────────────────┐
│                                        │
│   ╭──────────────────────────────────╮ │
│   │   🟢   SABHI JAGAH BHEJEIN       │ │  ← one button, ~30% of screen
│   ╰──────────────────────────────────╯ │
│                                        │
│   ✅ Hamara Bazaar          turant     │  Tier A
│   ✅ ONDC · 50+ apps        turant     │  Tier A
│   ⚪ GeM               file taiyar hai │  Tier C
│   🔗 Amazon               jodna hai    │  Tier B — not connected
│   🔗 Flipkart             jodna hai    │  Tier B — not connected
│   📋 Meesho             madad chahiye  │  Tier D
└────────────────────────────────────────┘
```

The big button fires **every Tier A channel plus every already-connected Tier B channel**, in parallel. Tier C and D become follow-up cards afterwards — they never block the tap.

A brand-new artisan with zero channel accounts still gets **two live listings** from that one tap. That is the demo.

### Catalog (2)
| # | Route | What |
|---|---|---|
| 16 | `/products` | Grid, large thumbnails, one status dot per product. No table, no text list |
| 17 | `/products/:id` | Detail · edit · re-publish · per-channel status. Edit once → all exports regenerate (§2 rule 1) |

### Channels & account help (3)
| # | Route | What |
|---|---|---|
| 18 | `/channels` | The unlock map. Per channel: `ready` / `needs X` / `connected` |
| 19 | `/channels/:id/setup` | Per-channel guided flow — §6 |
| 20 | `/wizard/gst` | GST enrolment wizard. Three spoken questions → one of three routes (§8.7 of Master ref) |

### Orders (2)
| # | Route | What |
|---|---|---|
| 21 | `/orders` | Unified inbox, grouped by state, newest first. Voice notification on new order |
| 22 | `/orders/:id` | Detail · per-craft packing SOP video · shipping label with DPP QR |

### Money & support (3)
| # | Route | What |
|---|---|---|
| 23 | `/earnings` | Expected vs confirmed. *"Amazon ne ₹4,200 bheje hain"* — never *"aa gaye"*. The **"Paisa aaya?"** tap lives here |
| 24 | `/help` | One button → callback request to cluster coordinator. Remote, never a field visit |
| 25 | `/settings` | Language · name · readiness flags · **"mera data mitaayein"** (DPDP erasure) |

---

## 6. Helping them get accounts — per channel

This is Master ref §1.4 made concrete. Principle unchanged: **we teach, they act. We hold no documents.**

### 6.1 The pre-check that saves the most pain

Before an artisan starts *any* government signup, `/channels/gem/setup` asks them to **say their name three times** — as printed on PAN, on the bank passbook, on the Aadhaar card. We compare the three transcripts.

Name mismatch across Aadhaar / PAN / GST / bank is the **top GeM rejection cause**. Catching it in 20 seconds of voice, *before* they spend three days on a registration that will be rejected, costs us almost nothing and is the single highest-value thing on this screen. We store the comparison **result**, never the names-as-documents.

### 6.2 Per-channel setup

| Channel | What the artisan must do | What we do |
|---|---|---|
| **Our marketplace** | Nothing | Already done at signup |
| **ONDC** | **Nothing** | We are the MSN. They are a sub-seller under our node |
| **GeM** | Register (free, Aadhaar/PAN, 1–3 days), then upload our `.xlsx` | Name pre-check → voice-guided browser through gem.gov.in → we hand them a category-correct file. **Artisans are exempt from caution money and from paid Vendor Assessment — but still complete Vendor Validation.** We say that out loud so it isn't a surprise |
| **Amazon** | Create Seller Central account, then tap "Amazon se jodein" | Voice-guided browser through signup → then LWA OAuth. **We never see a password.** Only a refresh token, encrypted |
| **Flipkart** | Create seller account, then connect | Same pattern. ⚠️ Token `expires_in ≈ 60 days` — automated refresh job from day one |
| **Meesho** | Supplier Hub signup (mobile OTP, GSTIN optional in exempt categories, "Unbranded" allowed) | Voice-guided browser + copy block |
| **GST** | Depends on the route | `/wizard/gst` decides: no-GST enrolment / full registration / above-threshold |

### 6.3 The guided browser — how it works

Not an overlay on their app. **Our WebView, their site.**

```
artisan taps "GeM par register karein"
        ↓
in-app browser opens gem.gov.in (Capacitor WebView, we control the container)
        ↓
our bar pins to the bottom of the screen:
  ┌──────────────────────────────────────────┐
  │ 🔊 "Yahan apna PAN number daalein"       │
  │ [ 📋 COPY ]  [ ← peeche ]  [ aage → ]    │
  └──────────────────────────────────────────┘
        ↓
each step speaks the instruction and puts the exact value on the clipboard
        ↓
artisan self-reports done → ChannelStatus = self_reported_done
```

🚫 **Explicitly NOT doing:** `AccessibilityService`-based overlay on top of the real Amazon/Flipkart apps. Google Play only permits that API for genuine disability tools; enforcement tightened **28 Jan 2026**, and **Android 17 blocks non-accessibility apps from the API outright.** Misuse means app suspension and developer-account termination. On a government problem statement that is disqualifying. The idea is dead — the guided browser gets ~90% of the benefit with none of the risk.

### 6.4 🎯 Autofill injection — the "Auto-bharo" layer

Layered **on top of** §6.3, not instead of it. Same WebView, but we also inject a content script that fills the fields.

This is legitimate — it is the artisan's own browser session, on the artisan's own account, filling the artisan's own data, at the artisan's explicit request. That is materially different from automating a third party's app from outside.

**The engineering decision that makes it survivable:**

```
Selector pack  =  versioned JSON, fetched from OUR server at runtime
                  never compiled into the app

{
  "channel": "gem",
  "pack_version": 14,
  "steps": [
    { "id": "pan",
      "selector": "#panNumber",
      "field": "artisan.pan_input",
      "voice_key": "gem.step.pan",
      "verify": "input[value.length==10]" },
    ...
  ]
}
```

Rules, all four non-negotiable:

1. **Selectors live on the server.** A DOM change is a config push we ship in an hour — not an app update rural users will never install. This single choice is the difference between a feature that survives and one that silently rots.
2. **Every step degrades, never fails.** Selector doesn't match → that step automatically falls back to §6.3 guided-paste, speaks the instruction, and carries on. The artisan sees a slightly slower step, never a broken screen.
3. **Never automate submit, login, OTP, payment, or CAPTCHA.** We fill fields. The artisan presses the button. That keeps a human in the loop on every consequential action and keeps us clearly on the right side of every platform's terms.
4. **Health telemetry per selector.** Match-rate per step, per pack version. Drop below threshold → alert, and the channel auto-reverts to guided-paste until a new pack ships.

**Rollout order** — cheapest DOM first, so we learn on the low-risk one:
`GeM registration` → `GST enrolment portal` → `Meesho Supplier Hub` → *(Amazon/Flipkart signup only if the first three prove stable — and never their listing forms, since Tier B already has a real API)*

**Honest framing for judges:** *"Tier A and B are one tap through APIs we control. Tier C and D are one tap plus a confirm, through an assisted browser that fills the artisan's own forms on the artisan's own account — and degrades to spoken step-by-step guidance the moment a page changes."*

Feature-flagged per channel. Ships **off**; turns on per channel once its selector pack holds >95% match for a week.

---

## 7. Image pipeline — the PhotoRoom question, answered

### 7.1 What PhotoRoom actually does

Not one magic model. A pipeline of specialists, plus one architectural choice we should copy exactly:

| Piece | Theirs |
|---|---|
| Foundation model | "Photoroom Instant Diffusion" — DiT-style transformer in latent space, **~1B params deliberately** (sub-second on mobile), 90M curated images from a ~1B pool, re-captioned with CogVLM/LLaVA, LCM-style distilled to few steps |
| Extra conditioning | A BERT/MAE-style **masking task** — the model *reads* the preserved subject and derives lighting and perspective from it |
| AI Backgrounds | Trained as **outpainting, not inpainting.** Mask boundaries are rigid — the model cannot regenerate anything inside the mask |
| Shadows, relight | Separate dedicated models |

### 7.2 🔑 The one thing to copy

**Outpaint, never inpaint. Then composite the original subject pixels back on top, verbatim.**

This gives us Master ref §5.6 — *never change colour or shape* — as a **mathematical guarantee rather than a hope**. Even if the generative model hallucinates wildly, the product region is bit-identical to what the artisan photographed. Return rates stay low, listings don't get pulled for misrepresentation, and we can state the guarantee on a slide without hedging.

### 7.3 Our pipeline

```
photo
  ↓  BiRefNet                       matting (self-hosted — runs on EVERY photo)
  ↓  white balance                  white-paper reference trick where used
  ↓  auto-levels · CLAHE            product region only
  ↓  denoise · unsharp              product region only
  ↓  composite on #FFFFFF           assert corner pixels == (255,255,255)
  ↓  auto-crop to 85% fill          pure math
  ↓  per-channel variants + EXIF strip
  └──────────────────────────────── MAIN IMAGE. Never generative.

opt-in, capped, SECONDARY images only:
  ↓  Qwen-Image-Edit-2511 or FLUX.1 Kontext [dev]   background, subject masked
  ↓  IC-Light                                        relight to match scene
  ↓  geometric contact shadow                        mask blur + skew + multiply
  ↓  composite original subject pixels back, verbatim
```

The contact shadow is **~20 lines of OpenCV, not a model.** PhotoRoom trained a volumetric shadow diffusion model; we do not need to. Blur the mask, skew it by the light angle, multiply. Nobody on a phone screen can tell, and it costs nothing.

**Do not train a foundation model.** 90M images across 16 A100 nodes is not our budget, our timeline, or our problem. Self-host the boring layer that runs on every photo; rent the generative layer that runs occasionally.

**Cap enforcement:** hosted-API generation is opt-in and hard-capped per artisan (2 free, or unlocked after first sale). One enthusiastic user must not be able to burn the budget.

---

## 8. Backend shape

```
                    ┌──────────────┐
  Capacitor app ───▶│              │
  Admin (Next)  ───▶│  FastAPI     │──▶ Postgres   (catalog, orders, ledger)
  Marketplace   ───▶│  web/api     │──▶ Redis/RQ   (jobs)
                    │              │──▶ S3         (images)
                    └──────┬───────┘
                           │ HTTP (never an import)
                    ┌──────▼───────┐
                    │  ai/service  │  F1 enhance · F2 catalog · F3 price
                    └──────────────┘

  Publish fan-out:
    POST /publish { product_id, channels[] }
        → one queued job per adapter, parallel
        → each returns { channel, status, external_id | artifact_url | instructions }
        → app polls /publish/{id}, speaks each result as it lands

  Inbound:
    ONDC      Beckn callbacks (on_confirm, on_status)      ← true push
    Amazon    Notifications API → queue                    ← near real-time
    Flipkart  Order Management Notification webhooks       ← confirmed to exist; closes §18 item 7
    GeM       ❌ none — coordinator reconciles in admin console (Master ref §9.3)
```

Adapters stay exactly as Master ref §8.8 specifies — plugin per channel, `map_category` / `map_attributes` / `format_images` / `render`. Adding a channel never touches core.

---

## 9. Admin console — 8 pages (Next.js)

| # | Page | What |
|---|---|---|
| 1 | `/login` | Staff auth. Email + password — these users can read |
| 2 | `/artisans` | Multi-tenant list. Each agency sees only its own |
| 3 | `/artisans/:id` | Readiness flags · catalog · channel status · call log |
| 4 | `/queue` | Assisted-listing queue — pending GeM/Meesho uploads, bulk actions |
| 5 | `/gem-recon` | The §9.3 gap, handled honestly. Coordinator reads the GeM dashboard, marks orders here |
| 6 | `/orders` | Board across all artisans in the tenant |
| 7 | `/hub` | Cluster hub — pickup consolidation, QC checklist, weigh-in |
| 8 | `/reports` | Impact exports (CSV) for the ministry |

## 10. Marketplace — 9 pages (Next.js SSR)

| # | Page | Why SSR |
|---|---|---|
| 1 | `/` | Indexable |
| 2 | `/browse` | Filter by craft · cluster · GI tag · material |
| 3 | `/p/:slug` | Product + craft story + DPP QR. **Must be indexable — this is the SEO surface** |
| 4 | `/artisan/:id` | Profile, provenance |
| 5 | `/cluster/:id` | Cluster page |
| 6 | `/rfq/:productId` | **Bulk RFQ** → voice notification to artisan, cluster CC'd. The direct-B2B proof |
| 7 | `/buyer/auth` | Buyer login |
| 8 | `/buyer/orders` | Buyer order history |
| 9 | `/s/:shareCode` | Digital Sahayak share-link landing + attribution |

---

## 11. Build order

Each phase ends in something demoable. Nothing is built that a later phase would rewrite.

| Phase | Ships | Proves |
|---|---|---|
| **1** | Onboarding 8 screens · camera gate · resumable upload · Postgres schema | An artisan can sign up and take a good photo |
| **2** | `ai/enhance` real (BiRefNet + WB + crop) · `/capture/review` + colour lock | The main image is marketplace-grade |
| **3** | Bhashini ASR/TTS · `ai/catalog` · voice flow 11–13 | EN + HI descriptions from a voice note. **PS feature 2 done** |
| **4** | `ai/price` cost-up + floor guard + GeM discount math | **PS feature 3 done** |
| **5** | Marketplace SSR + MarketplaceAdapter + `/publish` | **First real one-tap listing** |
| **6** | ONDC MSN on staging (beckn-onix) + ONDCAdapter | **Tier A complete. The USP is real** |
| **7** | GeMAdapter → category `.xlsx` + GeM image specs | Tier C. The 10,700-category story |
| **8** | Amazon + Flipkart OAuth + adapters, sandbox | Tier B |
| **9** | Order inbox · webhooks · settlement · "Paisa aaya?" | "Virtual business manager" is no longer a claim |
| **10** | Admin console · GeM reconciliation · cluster hub | Institutional users have a surface |
| **11** | Guided browser (§6.3) → then Auto-bharo selector packs (§6.4), GeM first | Tier D, and the stretch goal |
| **12** | Generative secondary images, capped | The 20-second stage weapon |

Phases 1–6 are the defensible core. **11 and 12 are upside — if either slips, nothing in the PS goes unanswered.**

---

## 12. What this document closed from Master ref §17 / §18

| Ref | Item | Now |
|---|---|---|
| §17.2 | Backend framework | ✅ FastAPI + Postgres + Redis/RQ |
| §17.7 | Marketplace SSR vs SPA | ✅ SSR (Next.js) |
| §17.9 | Blockchain scope | ✅ One slide. DPP QR on the label only |
| §18.7 | Flipkart webhooks or polling? | ✅ **Webhooks exist** — Order Management Notification service |
| §18.3 | GeM Vendor Assessment for artisans | 🟡 Exemption route exists for artisans/weavers; **Vendor Validation still required.** Confirm in writing |
| §18.5 | Bhashini access | 🟡 ULCA portal self-serve API keys, free tier for prototyping. Confirm commercial terms |
| — | Offline-first | ✅ **Dropped.** Online-first |
| — | Overlay on marketplace apps | ✅ **Dropped.** Play policy + Android 17 |

**Still open, and it needs an owner this week:** §18 items 1 and 2 — **download 2–3 real GeM category Excel templates and the handicraft category tree.** The entire GeM render layer is built against those schemas. Phase 7 cannot start without them.
