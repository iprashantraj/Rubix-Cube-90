"""Adapter registry.

Import order here is the order channels appear on /publish, and that order is deliberate:
the two that need nothing from the artisan come first, so the very first thing they see is
the thing that already works for them.
"""

from .amazon import AmazonAdapter
from .base import ChannelAdapter, Tier
from .flipkart import FlipkartAdapter
from .gem import GeMAdapter
from .marketplace import MarketplaceAdapter
from .meesho import MeeshoAdapter
from .ondc import ONDCAdapter
from .whatsapp import WhatsAppAdapter

ADAPTERS: dict[str, ChannelAdapter] = {
    a.id: a
    for a in (
        MarketplaceAdapter(),
        ONDCAdapter(),
        GeMAdapter(),
        AmazonAdapter(),
        FlipkartAdapter(),
        MeeshoAdapter(),
        WhatsAppAdapter(),
    )
}


def get(channel_id: str) -> ChannelAdapter:
    if channel_id not in ADAPTERS:
        raise KeyError(f"unknown channel: {channel_id}")
    return ADAPTERS[channel_id]


def one_tap_channels(connected: set[str]) -> list[ChannelAdapter]:
    """What the big green button actually fires.

    Every tier A channel (no artisan account needed at all), plus every tier B channel the
    artisan has already connected.

    A brand-new artisan with zero channel accounts gets **one** genuinely live listing out
    of one press — our own marketplace, which `routers/publish.py` persists and
    `routers/marketplace.py` then serves. ONDC is the second tier A channel and returns
    `dry_run` until the beckn-onix subscriber id is issued: the catalog is mapped, nothing
    is signed or pushed, so there is no listing anyone could be shown.

    This said "two live listings ... and it is real" while ONDC was returning a fabricated
    `ondc:{id}`. Put the two back when the push is real. The number here is the demo claim,
    and a demo claim that outruns the code is how you lose the room.
    """
    return [
        a
        for a in ADAPTERS.values()
        if a.tier is Tier.A or (a.tier is Tier.B and a.id in connected)
    ]
