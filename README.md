# Rubix-Cube-90

SIH 2026 · PS 26090 — AI-Driven Market Linkage & Smart Cataloging for Marginalized Artisans

Full spec: `docs/Master-Technical-Reference.pdf`

## Layout

| Folder | What | Owner |
|---|---|---|
| `app/` | Artisan mobile app (React + Vite + Capacitor) | app dev |
| `web/` | Admin console, marketplace, backend API | web dev |
| `ai/` | The three PS features — deployed as its own service | AI/ML |
| `research/` | Experiments that decide what `ai/` ships. Never imported | AI/ML |
| `docs/` | Spec and decisions | everyone |

`web/` calls `ai/` over HTTP. Do not import across that line — they are separate deploy units.

## The three features

1. **AI Image Enhancer & Studio** — `ai/enhance/`
2. **Multilingual Auto-Cataloger** — `ai/catalog/`
3. **Dynamic Pricing Assistant** — `ai/price/`

Contracts for all three: `ai/contracts.md`. Code against it; stubs work today.
