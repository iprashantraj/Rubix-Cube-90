"""One line per upload, so the thresholds can be re-tuned against real photographs.

Every number in `thresholds.json` was calibrated against `images/raw` — 591 files, but only
**93 distinct scenes**, and most of those are stock photographs rather than an artisan's
phone in an artisan's workshop. That set cannot answer the question production will ask:
*if `blur_laplacian_variance_reject_min` moved to 90, how many real uploads stop being
refused, and were they any good?*

Only real traffic answers that, and **only if it was written down at the time**. A threshold
argued from 93 scenes when 50,000 uploads have already passed through unrecorded is the
avoidable version of this mistake, which is why this is in before launch rather than after.

**Numbers, never pixels.** A row is a few hundred bytes and holds no photograph, no
description and nothing an artisan typed — so keeping it costs nothing and reveals nothing.
`product_id` is here only to join the two rows one upload writes, and to let the web side
line a refusal up against what the artisan did next.

**The retake is the signal worth waiting for**, and it is the one this file cannot see. A
refusal followed by a retake that passes is a *correct* refusal. A refusal followed by three
more and then silence is a false one that cost a seller. Both live in the web side's own
records, joined to these rows by `product_id` — see docs/Abhay/CHANGELOG.md.

stdlib only, and **every failure here is swallowed**: a full disk, a read-only mount or a
bad path must never turn into a failed enhancement. Observation that can break the thing it
observes is worse than no observation.

    AI_OBSERVE_LOG=/var/log/rubix/observe.jsonl   # default: <AI_OUTPUT_DIR>/observe.jsonl
    AI_OBSERVE=0                                  # off entirely
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path


def _path() -> Path | None:
    """None when observation is off. Read per call, so a deployment can move or disable
    the log without a restart, and so tests can point it somewhere disposable."""
    if os.environ.get("AI_OBSERVE", "1") == "0":
        return None
    explicit = os.environ.get("AI_OBSERVE_LOG")
    if explicit:
        return Path(explicit)
    # 🐞 Same default as storage.py's OUTPUT_DIR, and the `or` form is deliberate: with
    # AI_OUTPUT_DIR set but empty, `.get(name, default)` returns "" and the log lands in the
    # working directory while the renders land under home. The two must agree.
    base = os.environ.get("AI_OUTPUT_DIR") or (Path.home() / ".local" / "share" / "rubix-ai-out")
    return Path(base) / "observe.jsonl"


def write(event: str, product_id: str = "unknown", **fields) -> None:
    """Append one JSON object. Never raises, never blocks on anything but the write."""
    try:
        path = _path()
        if path is None:
            return
        row = {"t": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
               "event": event, "product_id": product_id, **fields}
        path.parent.mkdir(parents=True, exist_ok=True)
        # One open per row rather than a held handle: uploads are seconds apart, the cost is
        # irrelevant next to segmentation, and nothing is lost if the process is killed.
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":"), default=str) + "\n")
    except Exception:  # noqa: BLE001 — see the module docstring. Nothing here may propagate.
        pass


def read(path=None) -> list[dict]:
    """Every row, for `images/` and for anything that wants to re-tune. Skips a torn last
    line rather than failing on it — the log is append-only and a killed process can leave
    one, and losing that row matters far less than being unable to read the other 50,000."""
    p = Path(path) if path else _path()
    if p is None or not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows
