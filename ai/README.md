# ai/

The three PS features. Deployed as one service; `web/` calls it over HTTP.

    service.py      one endpoint per feature
    worker.py       queue consumer — image enhancement takes ~20s, not a request
    enhance/        F1  image pipeline (self-hosted CV models)
    catalog/        F2  voice -> EN+HI description (LLM)
    price/          F3  cost-up pricing (plain arithmetic)
    contracts.md    request/response shapes — the API dev codes against
    thresholds.json calibrated numbers, shared with the app's camera gate

## Rules

- The app's camera gate and the server's quality gate read the **same** `thresholds.json`.
  Two copies drift, and then the phone accepts photos the server rejects.
- No LLM touches a price. Money math is deterministic and unit-tested.
- Generated images are always secondary, never the main product image.
- Never change a product's colour or shape. Enhance, don't misrepresent.

## Run

⚠️ **Python 3.10+.** The `X | None` annotations in `service.py` do not evaluate on 3.9 and
pydantic fails at import, before any request. macOS ships 3.9 — use `brew install python@3.12`.

    python3.12 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/uvicorn service:app --port 8001

`web/api` expects this service on **8001** (`AI_BASE_URL`). `/price` needs nothing but the
standard library underneath; the heavier requirements are for the F1/F2 pipelines, which are
still stubs.

    .venv/bin/python -m pytest test_price.py      # 30 tests, the floor guard and comparables
