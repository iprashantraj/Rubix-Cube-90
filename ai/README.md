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

⚠️ **Python 3.10+.** The `X | None` annotations in `service.py` do not evaluate on 3.9 and
pydantic fails at import, before any request. macOS ships 3.9 — use `brew install python@3.12`.

    python3.12 -m venv .venv
    .venv/bin/pip install -r requirements.txt
    .venv/bin/uvicorn service:app --port 8001

`web/api` expects this service on **8001** (`AI_BASE_URL`). `/price` needs nothing but the
standard library underneath; the heavier requirements are for the F1/F2 pipelines.

The enhancement worker needs more:

    .venv/bin/pip install -r requirements-enhance.txt \
      --extra-index-url https://download.pytorch.org/whl/cu128

`enhance/pipeline.py` imports none of that at module scope, so the service and the fixture
tools keep working without it. `python3 test_gate.py` runs with no virtualenv at all, and
`python3 test_segment.py` runs its geometry half the same way and skips the model half.

## The image path, end to end

    POST /enhance          gate (synchronous, no GPU) -> 202 + job_id, or an immediate rejection
    GET  /enhance/{job_id} queued -> running -> done | failed
    job                    master 2000px -> BiRefNet -> tier A/B/C -> crop -> per-target JPEG

`uvicorn service:app` is the whole service. `worker.py` is not needed yet — jobs run on one
worker thread inside the process, because there is one GPU and BiRefNet holds ~1.6GB of it.
That makes the job table process-local: a restart loses in-flight ids. Decision #2's Redis+RQ
is the fix, and `jobs.submit()` / `jobs.get()` is the entire swap surface.

`white_balance()`, `tone()` and `denoise_sharpen()` are unwritten and skipped explicitly;
every response lists them under `skipped`.

## The recipe

Stages compute **parameters**, not images. `enhance/renderer.py` `render(original, mask,
recipe)` is the only thing in the pipeline that produces pixels, which is what makes
CONTRIBUTING.md rule 2 hold by construction rather than by care.

    POST /enhance/rerender   replay a stored recipe — no GPU while the mask is cached

The alpha is kept beside the outputs under the recipe's `mask_version`, so switching tier
costs ~200ms instead of a model pass. `enhance/recipe.py` owns the shape; the web side left
it undefined on purpose.

## Segmentation

`enhance/segmenter.py` is BiRefNet, pinned to the revision the benchmark measured. Two
things in it are conclusions, not settings — the pinned revision (the repo ships
`trust_remote_code`, so upstream could otherwise change our pipeline silently) and the
2000px master (**the model's mask is stretched to fit the image, so the master's size is
the edge quality**). Both are argued in `research/segmentation/RESULTS.md`.

## Tests

    .venv/bin/python -m pytest test_price.py      # 30 tests, the floor guard and comparables
    python3 test_gate.py                          # runs with no virtualenv at all
    python3 test_segment.py                       # geometry half only without a venv
