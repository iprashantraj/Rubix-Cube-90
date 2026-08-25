"""AI service. One endpoint per PS feature. web/ calls this over HTTP."""

from fastapi import FastAPI

app = FastAPI(title="Rubix AI", version="0.1.0")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/enhance")
def enhance(req: dict):
    """F1. Queues the job — enhancement takes ~20s. See contracts.md."""
    raise NotImplementedError


@app.get("/enhance/{job_id}")
def enhance_status(job_id: str):
    raise NotImplementedError


@app.post("/catalog")
def catalog(req: dict):
    """F2. Voice note -> listing in English and Hindi."""
    raise NotImplementedError


@app.post("/catalog/prefill")
def catalog_prefill(req: dict):
    """F2. Vision-only pre-fill, before the artisan speaks."""
    raise NotImplementedError


@app.post("/price")
def price(req: dict):
    """F3. Cost-up suggestion with a floor guard."""
    raise NotImplementedError
