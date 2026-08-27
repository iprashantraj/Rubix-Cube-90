"""Background jobs. RQ over Redis.

Three things belong here and nothing else yet:

  1. Image enhancement — ~20s per photo, which is a job and not a request.
  2. 🚨 Flipkart token refresh. The token response carries `expires_in: 5183999` seconds,
     about 60 days. Teams that hard-code it discover the problem two months later when
     every call starts returning 401. This runs from day one.
  3. Channel order polling, for the channels that have no webhook.
"""

from __future__ import annotations

import logging

from redis import Redis
from rq import Queue

from .config import settings

log = logging.getLogger(__name__)
queue = Queue(connection=Redis.from_url(settings().redis_url))


def refresh_channel_tokens() -> None:
    """Renew OAuth refresh tokens well before expiry.

    Scheduled daily. Renewing at the halfway point rather than at the deadline means a
    transient failure has weeks of slack instead of hours.
    """
    raise NotImplementedError("phase 8")


def poll_orders(channel: str) -> None:
    """For channels without a webhook. ONDC, Amazon and Flipkart all push, so this is a
    fallback path rather than the main one. GeM has no API at all — that gap is
    reconciled by a human in the admin console, and we say so."""
    raise NotImplementedError("phase 9")


def enhance_image(product_id: str, image_url: str) -> None:
    raise NotImplementedError("phase 2")
