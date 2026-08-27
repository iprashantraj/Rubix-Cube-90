"""Tier A. Our own marketplace — a direct DB write, so it is live the instant it returns.

Why this channel exists at all (spec §3.3): it is the only *direct* B2B surface, the only
channel that works with zero paperwork, and the only place a bulk RFQ or a craft story can
live. An artisan with no PAN cannot onboard to GeM, Amazon or ONDC. Drop this and we
abandon exactly the demographic the PS targets.
"""

from .base import ChannelAdapter, PublishResult, Tier


class MarketplaceAdapter(ChannelAdapter):
    id = "marketplace"
    name = "Hamara Bazaar"
    tier = Tier.A

    def map_category(self, product) -> dict:
        # Our own taxonomy is the canonical one — nothing to map.
        return {"category": product.category}

    def map_attributes(self, product) -> dict:
        return {
            "title": product.title,
            "desc_en": product.desc_en,
            "desc_hi": product.desc_hi,
            "material": product.material,
            "technique": product.technique,
            "dimensions": product.dimensions,
            "gi_claim": product.gi_claim,
            "certifications": product.certifications,
            "price": float(product.price or 0),
            "is_made_to_order": product.is_made_to_order,
            "lead_time_days": product.lead_time_days,
        }

    def format_images(self, product) -> list[dict]:
        return [{"url": i.url, "is_primary": i.is_primary} for i in product.images]

    async def render(self, product, status) -> PublishResult:
        if bad := self.preflight(product):
            return bad
        # The listing row IS the marketplace listing — routers/publish.py writes it from
        # this result, and routers/marketplace.py serves the storefront from exactly those
        # rows where status == "live". So `live` here is a checkable claim: the product is
        # on our shop the moment this returns, and the row can be produced on demand.
        # No external system, no latency, nothing that can be pending — which is why this
        # is the channel we can demo end to end on stage.
        return PublishResult(
            channel=self.id,
            status="live",
            external_id=product.id,
            message_key="publish.instant",
        )
