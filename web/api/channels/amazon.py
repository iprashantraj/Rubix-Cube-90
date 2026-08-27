"""Tier B. Amazon SP-API.

Prerequisite the docs are blunt about: the artisan must already have a Seller Central
account. SP-API cannot create one. So /channels/amazon/setup walks them through signup in
the guided browser first, and only then runs the OAuth connect.

🔒 Login with Amazon gives us a refresh token. We store it encrypted and mint short-lived
access tokens per call. We never see, ask for, or store a platform password — a demo that
shows "enter your Amazon password" is a disqualification-level flaw.

Publishing a public app to the Selling Partner Appstore needs Amazon review, and public
apps are capped at 25 seller authorisations until then. We demo on sandbox and say so.
"""

from .base import ChannelAdapter, PublishResult, Tier


class AmazonAdapter(ChannelAdapter):
    id = "amazon"
    name = "Amazon"
    tier = Tier.B
    requires_oauth = True

    def map_category(self, product) -> dict:
        # Product Type Definitions is called FIRST — it returns the attribute schema this
        # product type actually requires. Guessing the schema is how listings get rejected.
        return {"product_type": (product.category_map or {}).get("amazon_node")}

    def map_attributes(self, product) -> dict:
        return {
            "item_name": product.title,
            "product_description": product.desc_en,
            "brand": product.artisan.display_name,
            "material": product.material,
            "country_of_origin": "IN",
            "list_price": float(product.mrp or 0),
        }

    def format_images(self, product) -> list[dict]:
        # 2000x2000 square, pure white, sRGB. Generated images are never eligible to be
        # the main image — that is "inaccurate representation" and pulls the listing.
        main = [i for i in product.images if i.is_primary and not i.is_generated]
        rest = [i for i in product.images if not i.is_primary]
        return [{"url": i.url, "variant": i.size_variant} for i in main + rest]

    async def render(self, product, status) -> PublishResult:
        if bad := self.preflight(product):
            return bad
        if not status or not status.refresh_token_enc:
            return PublishResult(
                channel=self.id, status="needs_connect", message_key="publish.connect"
            )
        # TODO(phase 8): PUT /listings/2021-08-01/items/{sellerId}/{sku} against sandbox.
        # The OAuth connect above is real and the payload is real; the call is not made yet.
        # An artisan who has done the work of connecting their Seller Central account has
        # earned an accurate answer about what we then did with it.
        return self.dry_run(
            "SP-API listings PUT not implemented — nothing was sent to Amazon"
        )
