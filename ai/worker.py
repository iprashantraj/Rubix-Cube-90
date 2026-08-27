"""Queue consumer for the slow work — image enhancement is ~20s, not a request.

**Not needed yet, and running it is not the way to start the service.** Enhancement jobs
currently run on a worker thread inside the service process (`enhance/jobs.py`), which is
correct while there is one GPU and one replica: BiRefNet holds ~1.6GB of a 4GB card, so
jobs have to be serialised anyway.

This file becomes real when `docs/decisions.md` #2's Redis + RQ is stood up — at which
point the queue moves out of process, ids survive a restart, and the service can run more
than one replica. The swap surface is deliberately tiny: `jobs.submit()` and `jobs.get()`.

Until then, `uvicorn service:app` is the whole service.
"""

import sys


def main():
    print(__doc__.strip(), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
