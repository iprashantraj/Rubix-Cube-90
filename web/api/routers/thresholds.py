"""Serve the shared calibration file.

The app's camera gate and the server's quality gate MUST read the same numbers. Two copies
drift, and then the phone happily accepts photos the server turns around and rejects —
which is precisely the frustration the on-device gate exists to prevent.

Serving it rather than bundling it also means recalibrating is a JSON edit and a deploy,
not an app release that rural users never install.
"""

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

# ai/ is a separate deploy unit and web/ never imports across that line, but thresholds.json
# is shared data rather than code, and one file is the entire point.
THRESHOLDS = Path(__file__).resolve().parents[3] / "ai" / "thresholds.json"


@router.get("/thresholds")
def get_thresholds() -> dict:
    data = json.loads(THRESHOLDS.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}
