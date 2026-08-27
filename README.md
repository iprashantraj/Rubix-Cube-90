# Rubix-Cube-90

SIH 2026 · PS 26090 — AI-Driven Market Linkage & Smart Cataloging for Marginalized Artisans

| Doc | What |
|---|---|
| `docs/Master-Technical-Reference.md` | Full spec — PS alignment, pipelines, channels, privacy |
| `docs/Application-Architecture.md` | Screens, routes, onboarding flow, build order |
| `docs/decisions.md` | What's settled and why |
| `docs/app/Camera-Pipeline.md` | Photo path end to end — gate, thresholds, EXIF strip, enhance, colour lock |
| `docs/app/Pricing.md` | Cost-up formula, rates, comparables, and the price floor |

## Layout

| Folder | What | Owner | Docs |
|---|---|---|---|
| `app/` | Artisan mobile app (React + Vite + Capacitor). **Mobile only** | app dev | `app/README.md` |
| `web/api/` | FastAPI backend + channel adapters | web dev | `web/README.md` |
| `web/site/` | Next.js — marketplace (SSR) + admin console | web dev | `web/README.md` |
| `ai/` | The three PS features — deployed as its own service | AI/ML | `ai/README.md` |
| `research/` | Experiments that decide what `ai/` ships. Never imported | AI/ML | `research/README.md` |
| `docs/` | Spec and decisions | everyone | |

`web/` calls `ai/` over HTTP. Do not import across that line — they are separate deploy units.

## Run all three

```bash
# API          http://localhost:8000/docs
cd web/api  && .venv/bin/uvicorn api.main:app --reload --app-dir ..

# Marketplace + admin   http://localhost:3000
cd web/site && npm run dev

# Artisan app  http://localhost:5173  (open on a phone on the same LAN)
cd app      && npm run dev
```

## The one-tap tiering

"One click" is real, but it is tiered, and every surface says which tier a channel is in.
A flat one-click-everywhere claim does not survive a judge who has worked in e-commerce.

| Tier | Channels | Artisan effort | Needs their own account? |
|---|---|---|---|
| **A** | Our marketplace · **ONDC** | one tap | ❌ **none — we are the ONDC seller node** |
| **B** | Amazon · Flipkart | one tap after a one-time OAuth | ✅ |
| **C** | **GeM** | one tap → category-correct `.xlsx` | ✅ |
| **D** | Meesho · WhatsApp | guided browser | ✅ |

A brand-new artisan with no seller account, no GST and no paperwork still gets **two live
listings** from one press. That is the demo.

## The three features

1. **AI Image Enhancer & Studio** — `ai/enhance/`
2. **Multilingual Auto-Cataloger** — `ai/catalog/`
3. **Dynamic Pricing Assistant** — `ai/price/`

Contracts for all three: `ai/contracts.md`. Code against it; stubs work today.
