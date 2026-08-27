"""Tier D. Meesho — assisted only.

No open third-party API; integration is partner-gated. But the onboarding is the
friendliest of any channel for our users: mobile OTP, GSTIN optional in several GST-exempt
categories under the small-online-seller provisions, and sellers with no registered brand
can list as "Unbranded".

So we generate the copy-paste block, deep-link to the Supplier Hub, and voice-guide it
step by step. Manual, and we say it is manual — but far easier than unaided.
"""

from .base import ChannelAdapter, PublishResult, Tier


class MeeshoAdapter(ChannelAdapter):
    id = "meesho"
    name = "Meesho"
    tier = Tier.D

    def map_category(self, product) -> dict:
        return {"meesho_cat": (product.category_map or {}).get("meesho_cat")}

    def map_attributes(self, product) -> dict:
        return {
            "name": product.title,
            "description": product.desc_hi or product.desc_en,
            "price": float(product.price or 0),
            "brand": "Unbranded",
        }

    def format_images(self, product) -> list[dict]:
        return [{"url": i.url} for i in product.images]

    async def render(self, product, status) -> PublishResult:
        if bad := self.preflight(product):
            return bad
        attrs = self.map_attributes(product)
        # Each step is one spoken instruction plus one clipboard value. The selector pack
        # for Supplier Hub, when it exists, upgrades these same steps to autofill.
        return PublishResult(
            channel=self.id,
            status="needs_help",
            message_key="publish.needs_help",
            instructions=[
                {"voice_key": "meesho.step.name", "copy": attrs["name"]},
                {"voice_key": "meesho.step.desc", "copy": attrs["description"]},
                {"voice_key": "meesho.step.price", "copy": str(attrs["price"])},
            ],
        )
