# ai/

The three PS features. Deployed as one service; `web/` calls it over HTTP.

    service.py      one endpoint per feature
    worker.py       queue consumer — image enhancement takes ~20s, not a request
    enhance/        F1  image pipeline (self-hosted CV models)
    catalog/        F2  voice -> EN+HI description (LLM)
    price/          F3  cost-up pricing (plain arithmetic)
    contracts.md    request/response shapes — the API dev codes against
    thresholds.json calibrated numbers, shared with the app's camera gate

    requirements.txt          the service. Small, no GPU stack
    requirements-enhance.txt  the enhancement worker only. ~3GB, torch + CUDA

## Rules

- The app's camera gate and the server's quality gate read the **same** `thresholds.json`.
  Two copies drift, and then the phone accepts photos the server rejects.
- No LLM touches a price. Money math is deterministic and unit-tested.
- Generated images are always secondary, never the main product image.
- Never change a product's colour or shape. Enhance, don't misrepresent.

## Run

    pip install -r requirements.txt
    uvicorn service:app --reload

The enhancement worker needs more:

    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt -r requirements-enhance.txt \
      --extra-index-url https://download.pytorch.org/whl/cu128

`enhance/pipeline.py` imports none of that at module scope, so the service and the fixture
tools keep working without it. `python3 test_gate.py` runs with no virtualenv at all, and
`python3 test_segment.py` runs its geometry half the same way and skips the model half.

## Segmentation

`enhance/segmenter.py` is BiRefNet, pinned to the revision the benchmark measured. Two
things in it are conclusions, not settings — the pinned revision (the repo ships
`trust_remote_code`, so upstream could otherwise change our pipeline silently) and the
2000px master (**the model's mask is stretched to fit the image, so the master's size is
the edge quality**). Both are argued in `research/segmentation/RESULTS.md`.
