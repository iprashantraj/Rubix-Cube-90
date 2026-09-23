# Rubix-Cube-90 — Kala Setu

SIH 2026 · PS 26090 — AI-Driven Market Linkage & Smart Cataloging for Marginalized Artisans

| Doc | What |
|---|---|
| `docs/Master-Technical-Reference.md` | Full spec — PS alignment, pipelines, channels, privacy |
| `docs/Application-Architecture.md` | Screens, routes, onboarding flow, build order |
| `docs/decisions.md` | What's settled and why |
| `docs/app/Camera-Pipeline.md` | Photo path end to end — gate, thresholds, EXIF strip, enhance, colour lock |
| `docs/app/Pricing.md` | Cost-up formula, rates, comparables, and the price floor |
| `docs/app/Questions-Asked.md` | Every question the app asks, categorized |
| `docs/app/AI-Data-Flow.md` | **What reaches a third-party model, when, and what never does** |
| `docs/app/Future-Implementations.md` | Vision, remaining questions, known gaps |
| `docs/Abhay/PIPELINE-RECONCILIATION.md` | Image pipeline — what runs on device vs. server, and why. Read before the other files in `docs/Abhay/` |
| `docs/Prashant/` | Change notes — what landed, when, and what it left open |
| `CONTRIBUTING.md` | Architecture, the settled decisions, the non-negotiable rules, and every test command |

## Layout

| Folder | What | Owner | Docs |
|---|---|---|---|
| `app/` | Artisan mobile app (React + Vite + Capacitor). **Mobile only** | app dev | `app/README.md` |
| `web/api/` | FastAPI backend + channel adapters | web dev | `web/README.md` |
| `web/site/` | Next.js — marketplace (SSR) + admin console | web dev | `web/README.md` |
| `web/dashboard/` | Monitoring dashboard demo — one static HTML file, mock data | web dev | [below](#monitoring-dashboard-demo) |
| `ai/` | The three PS features — deployed as its own service | AI/ML | `ai/README.md` |
| `research/` | Experiments that decide what `ai/` ships. Never imported | AI/ML | `research/README.md` |
| `docs/` | Spec and decisions | everyone | |
| `images/` | Calibration fixtures for the image thresholds. Pixels gitignored, manifest committed | AI/ML | `images/README.md` |

`web/` calls `ai/` over HTTP. Do not import across that line — they are separate deploy units.

## Prerequisites

**Python 3.10 or newer.** `web/api/` and `ai/` both use `X | None` type annotations, which
do not evaluate on 3.9 — pydantic raises `TypeError: unable to evaluate type annotation`
before the first request, and `from __future__ import annotations` does not save it. macOS
ships 3.9, so this bites a fresh clone on a Mac every time:

```bash
brew install python@3.12
```

Node 20+, and Postgres for the API:

```bash
brew install postgresql@16 && brew services start postgresql@16
psql -d postgres -c "CREATE ROLE kalasetu LOGIN PASSWORD 'kalasetu' SUPERUSER;"
createdb -O kalasetu kalasetu
cd web/api && cp .env.example .env      # then fill JWT_SECRET and TOKEN_ENCRYPTION_KEY
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/alembic upgrade head
```

Redis is only needed for the background worker; the API starts without it.

## Run all three

```bash
# AI service   http://localhost:8001/docs
cd ai       && .venv/bin/uvicorn service:app --port 8001

# API          http://localhost:8000/docs
cd web/api  && .venv/bin/uvicorn api.main:app --reload --app-dir ..

# Marketplace + admin   http://localhost:3000
cd web/site && npm run dev

# Artisan app  http://localhost:5173  (open on a phone on the same LAN)
cd app      && npm run dev
```

`web/` calls `ai/` on port 8001, so `/price` answers 503 until the AI service is up — the
app then offers "set the price later" rather than blocking the listing.

## Monitoring dashboard (demo)

**Live:** https://kalasetu-web-dashboard.vercel.app

The district monitoring officer's view: beneficiary verification, listing queue, orders,
gap analysis, schemes and reports. It is a single static file, `web/dashboard/index.html`,
with no build step and no backend — every number is mock data held in the page.

Every control works against that mock state: approve or reject an artisan, publish
listings, ship or resolve orders, assign gap actions, send scheme reminders, and download
CSV reports built from whatever you just changed. KPIs move with each action. Reload to
reset. Works on phones — tables stack into cards below 900px.

```bash
python3 -m http.server 4173 -d web/dashboard    # http://localhost:4173
```

**Deploy:** push to `main`. The Vercel project `kalasetu-web-dashboard` is linked to this
repo with Root Directory `web/dashboard`, so `vercel --prod` run from inside that folder
fails — let the git push deploy it.

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
