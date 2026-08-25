# Open decisions

Spec §17. Close each with evidence from `research/`, then log the verdict here.

| # | Decision | Status |
|---|---|---|
| 1 | Segmentation model (BiRefNet / SAM 2 / rembg) | open — benchmark in `research/segmentation/` |
| 2 | Backend framework | web dev's call |
| 3 | LLM choice | leaning Claude (`claude-sonnet-5`) for description + category mapping |
| 4 | Framing check method | grid variance (cheap) — spec recommends it |
| 5 | Bhashini access | unverified — `research/asr-bhashini/` |

## Settled

- **Pricing is arithmetic, not a model.** No training data exists for "what should this handicraft cost."
  The LLM never produces a price; it only normalizes comparable listings. See `ai/price/`.
- **CV models self-hosted, LLM via API.** Per-image API pricing kills unit economics on the
  background-removal path, which runs on every photo.
- **No agent framework for now.** Every LLM call is one turn in, one JSON out.
