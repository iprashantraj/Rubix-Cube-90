# Open decisions

Spec §17. Close each with evidence from `research/`, then log the verdict here.

| # | Decision | Status |
|---|---|---|
| 1 | Segmentation model | **closed 2026-08-28 — BiRefNet** (`ZhengPeng7/BiRefNet`, MIT, self-hosted, 1024², 1615 MiB, ~645 ms). Benchmarked 5 models over 41 fixtures: `research/segmentation/RESULTS.md` |
| 2 | Backend framework | **closed — FastAPI + Postgres + Redis/RQ + S3.** Same language as `ai/` |
| 3 | LLM choice | leaning Claude (`claude-sonnet-5`) for description + category mapping |
| 4 | Framing check method | grid variance (cheap) — spec recommends it |
| 5 | Bhashini access | ULCA portal self-serve keys, free prototyping tier — confirm commercial terms |

## Settled

Reasoning for the block below is in `docs/Application-Architecture.md`.

- **Online-first, not offline-first.** Reverses the v1 spec. No offline queue, no local DB, no sync
  engine. Network handling is resumable upload with retry plus a spoken failure message. Every AI
  feature is a server call anyway — offline capture without offline inference gets the artisan a
  photo and nothing else.
- **We become the ONDC Marketplace Seller Node.** Artisans are sub-sellers under our node: no ONDC
  registration, no DigiReady, no GST for them. The only channel where "one tap" is literally true
  for a zero-paperwork artisan. Price: we are a seller-side ECO, so TCS + monthly GSTR-8 is ours
  (CBIC Circular 194/06/2023).
- **One-click is tiered, and we say so.** A = marketplace + ONDC (no account needed). B = Amazon +
  Flipkart (one-time OAuth, then real API push). C = GeM (perfect `.xlsx`; no seller API exists).
  D = Meesho/IndiaMART (guided). A flat "one-click everywhere" claim does not survive a judge from
  industry.
- **No AccessibilityService overlay on marketplace apps.** Play Store permits that API only for
  genuine disability tools; enforcement tightened 28 Jan 2026 and Android 17 blocks non-accessibility
  apps outright. Suspension-level risk. Replaced by an in-app guided browser.
- **Autofill injection is a layer on the guided browser, not a replacement.** Selector packs are
  versioned JSON fetched from our server, never compiled into the app, so a DOM change is a config
  push rather than an app update. Every step degrades to guided-paste on selector miss. We never
  automate submit, login, OTP, payment, or CAPTCHA. Ships off, per-channel flag, GeM first.
- **Generative images outpaint, never inpaint — then the original subject pixels are composited back
  verbatim.** This is how PhotoRoom does AI Backgrounds, and it turns "never misrepresent" from a
  hope into a mathematical guarantee. Contact shadow is ~20 lines of OpenCV, not a model.
- **Marketplace is SSR (Next.js).** Public catalog pages have to be indexable.
- **Pricing is arithmetic, not a model.** No training data exists for "what should this handicraft cost."
  The LLM never produces a price; it only normalizes comparable listings. See `ai/price/`.
- **CV models self-hosted, LLM via API.** Per-image API pricing kills unit economics on the
  background-removal path, which runs on every photo.
- **No agent framework for now.** Every LLM call is one turn in, one JSON out.
