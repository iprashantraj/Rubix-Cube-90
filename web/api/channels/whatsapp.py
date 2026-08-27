"""Tier D. WhatsApp — image plus caption.

Not a marketplace, and not pretending to be one. It is how an artisan already sells: to a
shopkeeper two districts over, in a group, to a repeat buyer. Giving them a
professionally-enhanced photo and a written caption for that existing channel costs us one
adapter and immediately improves the sales they were already making.
"""

from .base import ChannelAdapter, PublishResult, Tier


class WhatsAppAdapter(ChannelAdapter):
    id = "whatsapp"
    name = "WhatsApp"
    tier = Tier.D

    def map_category(self, product) -> dict:
        return {}

    def map_attributes(self, product) -> dict:
        lines = [product.title or "", ""]
        if product.desc_hi:
            lines.append(product.desc_hi)
        if product.material:
            lines.append(f"सामग्री: {product.material}")
        if product.dimensions:
            lines.append(f"नाप: {product.dimensions}")
        if product.price:
            lines.append(f"दाम: ₹{int(product.price)}")
        return {"caption": "\n".join(lines).strip()}

    def format_images(self, product) -> list[dict]:
        return [{"url": i.url} for i in product.images if i.size_variant == "social_1080"]

    async def render(self, product, status) -> PublishResult:
        if bad := self.preflight(product):
            return bad
        return PublishResult(
            channel=self.id,
            status="file_ready",
            message_key="publish.file_ready",
            instructions=[{"voice_key": "whatsapp.share", "copy": self.map_attributes(product)["caption"]}],
        )
