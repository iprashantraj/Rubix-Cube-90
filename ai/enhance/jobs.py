"""The job table behind `POST /enhance`.

Enhancement takes ~20s, so `contracts.md` makes it asynchronous: 202 with a job id, then
the app polls. This is the smallest thing that honours that contract and actually runs.

**One worker thread, deliberately.** There is one GPU and BiRefNet holds ~1.6GB of it while
running. Two concurrent jobs on a 4GB card is an out-of-memory crash, not double the
throughput, so jobs queue and run one at a time. That is the correct behaviour rather than
a limitation to fix later.

**Known limits, and they are real:** the table lives in this process's memory. Restart the
service and in-flight jobs are lost and their ids stop resolving. It does not survive more
than one service replica either, because a poll routed to the other one finds nothing.

`docs/decisions.md` #2 already settled Redis + RQ for production, which fixes both. This is
not a competing choice — it is the same interface with a dict where Redis goes, so that the
app can be unblocked before infrastructure exists. `submit()` and `get()` are the whole
surface a queue has to replace. The app polls `GET /enhance/{job_id}` and degrades to the
artisan's own photograph on any failure (`web/api/routers/products.py`), so a lost job id
costs the enhancement and never the listing — which is what makes shipping this acceptable.
"""

from __future__ import annotations

import threading
import traceback
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

# Finished jobs are kept so a poll after completion still answers. Bounded, because
# otherwise this is a memory leak with a slow fuse.
MAX_REMEMBERED = 512

_lock = threading.Lock()
_jobs: "OrderedDict[str, dict]" = OrderedDict()
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="enhance")


def submit(fn, *args, **kwargs) -> str:
    """Queue `fn` and return its job id immediately."""
    job_id = f"j_{uuid.uuid4().hex[:12]}"
    with _lock:
        _jobs[job_id] = {"status": "queued"}
        while len(_jobs) > MAX_REMEMBERED:
            _jobs.popitem(last=False)
    _pool.submit(_run, job_id, fn, *args, **kwargs)
    return job_id


def _run(job_id: str, fn, *args, **kwargs) -> None:
    _set(job_id, {"status": "running"})
    try:
        _set(job_id, fn(*args, **kwargs))
    except Exception as e:
        # Never let a worker thread die silently: the app would poll "running" forever and
        # sit on a spinner, which rule 3 forbids. A failed job must say so out loud.
        _set(job_id, {
            "status": "failed",
            "reason": f"{type(e).__name__}: {e}",
            "message_key": "enhance.failed",
        })
        traceback.print_exc()


def _set(job_id: str, body: dict) -> None:
    with _lock:
        if job_id in _jobs:
            _jobs[job_id] = body


def get(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None
