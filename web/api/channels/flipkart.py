"""Tier B. Flipkart Marketplace Seller API.

We register a `third_party_application` (authorization-code flow), not a self-access one —
we manage the API on behalf of other sellers.

🚨 The gotcha that silently breaks teams two months in: the token response carries
`expires_in: 5183999` seconds, about 60 days. Never hard-code it. The refresh job is built
from day one (worker.py), not added after everything starts returning 401.

Confirmed during research: Flipkart has an Order Management Notification service, so
orders are webhooks rather than polling — this closes spec §18 item 7.
"""

from .base import ChannelAdapter, PublishResult, Tier


class FlipkartAdapter(ChannelAdapter):
    id = "flipkart"
    name = "Flipkart"
    tier = Tier.B
    requires_oauth = True

    def map_category(self, product) -> dict:
        return {"vertical": (product.category_map or {}).get("flipkart_vertical")}

    def map_attributes(self, product) -> dict:
        return {
            "title": product.title,
            "description": product.desc_en,
            "brand": product.artisan.display_name,
            "mrp": float(product.mrp or 0),
            "selling_price": float(product.price or 0),
            "hsn": product.hsn_code,
        }

    def format_images(self, product) -> list[dict]:
        return [{"url": i.url} for i in product.images if not i.is_generated]

    async def render(self, product, status) -> PublishResult:
        if bad := self.preflight(product):
            return bad
        if not status or not status.refresh_token_enc:
            return PublishResult(
                channel=self.id, status="needs_connect", message_key="publish.connect"
            )
        # TODO(phase 8): POST /sellers/skus then /sellers/listings against the Flipkart
        # sandbox. Not wired up, so this reports a dry run rather than an FSN that does not
        # exist anywhere but in this f-string.
        return self.dry_run(
            "Flipkart listings call not implemented — nothing was sent to Flipkart"
        )
