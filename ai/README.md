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

    pip install -r requirements.txt
    uvicorn service:app --reload
