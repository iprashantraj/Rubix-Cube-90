"""Craft name -> region, the taxonomy behind category_l3_weave.

The request document (docs/Abhay/REQUEST-PRICING-DATASET.md) asks for weave-level labels —
`textiles.saree.sambalpuri` rather than `textiles.saree` — and names the GI registry at
search.ipindia.gov.in as the canonical source, because a government register is defensible
in a way that our own opinion is not.

This table was compiled BY HAND from that register's published list of registered
geographical indications, restricted to the craft names that actually occur in the scraped
titles and tags. It has not been checked entry by entry against the register, so:

    `gi` is True only where registration is not in doubt. Where a name is a craft
    tradition whose registration we have not confirmed, `gi` is False and the row still
    gets its region. A False here means "not verified", not "not GI".

`region` is the state the tradition belongs to, which is not always where a given piece was
made — a Sambalpuri saree woven in a Surat powerloom is still tagged Odisha. That is the
correct behaviour for a *style* label; the artisan's own location is a different field and
it never comes from a marketplace listing.

Names that are techniques rather than places (ikat, batik, bandhani) live in TECHNIQUES and
carry no region, because they are practised in several states and the region would be a
guess.
"""

# craft key -> (state, gi verified)
WEAVES = {
    # Odisha
    "sambalpuri": ("Odisha", True), "bomkai": ("Odisha", True), "khandua": ("Odisha", True),
    "nuapatna": ("Odisha", False), "pasapali": ("Odisha", False), "berhampuri": ("Odisha", True),
    "habaspuri": ("Odisha", True), "kotpad": ("Odisha", True), "dongria": ("Odisha", True),
    # Telangana / Andhra Pradesh
    "pochampally": ("Telangana", True), "narayanpet": ("Telangana", True),
    "narayanapet": ("Telangana", True), "gadwal": ("Telangana", True),
    "siddipet": ("Telangana", True), "uppada": ("Andhra Pradesh", True),
    "venkatagiri": ("Andhra Pradesh", True), "mangalagiri": ("Andhra Pradesh", True),
    "dharmavaram": ("Andhra Pradesh", True), "kalamkari": ("Andhra Pradesh", True),
    "srikalahasti": ("Andhra Pradesh", True), "machilipatnam": ("Andhra Pradesh", True),
    # West Bengal
    "baluchari": ("West Bengal", True), "tangail": ("West Bengal", True),
    "santipuri": ("West Bengal", True), "shantipuri": ("West Bengal", True),
    "dhaniakhali": ("West Bengal", True), "begampuri": ("West Bengal", False),
    "kantha": ("West Bengal", True), "nakshi": ("West Bengal", True),
    # Jamdani is registered in India as Uppada Jamdani (Andhra Pradesh); the Bengal
    # tradition of the same name is not the registered one, so the bare word gets a
    # region and no GI claim.
    "jamdani": ("West Bengal", False),
    # Madhya Pradesh
    "chanderi": ("Madhya Pradesh", True), "maheshwari": ("Madhya Pradesh", True),
    "bagh": ("Madhya Pradesh", True), "gond": ("Madhya Pradesh", True),
    # Uttar Pradesh
    "banarasi": ("Uttar Pradesh", True), "banaras": ("Uttar Pradesh", True),
    "chikankari": ("Uttar Pradesh", True), "zardozi": ("Uttar Pradesh", True),
    # Rajasthan
    "sanganeri": ("Rajasthan", True), "bagru": ("Rajasthan", True),
    "kota doria": ("Rajasthan", True), "leheriya": ("Rajasthan", False),
    "blue pottery": ("Rajasthan", True),
    # Gujarat
    "patola": ("Gujarat", True), "tangaliya": ("Gujarat", True),
    "mata ni pachedi": ("Gujarat", True), "ajrakh": ("Gujarat", False),
    "kutchi": ("Gujarat", False), "kachchh": ("Gujarat", False),
    # Maharashtra
    "paithani": ("Maharashtra", True), "warli": ("Maharashtra", True),
    "himroo": ("Maharashtra", False),
    # South
    "kanchipuram": ("Tamil Nadu", True), "kanjeevaram": ("Tamil Nadu", True),
    "arani": ("Tamil Nadu", True), "toda": ("Tamil Nadu", True),
    "molakalmuru": ("Karnataka", True), "ilkal": ("Karnataka", True),
    "udupi": ("Karnataka", True), "mysore": ("Karnataka", True),
    "bidri": ("Karnataka", True), "channapatna": ("Karnataka", True),
    "kasuti": ("Karnataka", True), "lambani": ("Karnataka", True),
    "kannur": ("Kerala", True), "balaramapuram": ("Kerala", True),
    "kasavu": ("Kerala", True), "chendamangalam": ("Kerala", True),
    # North and East
    "phulkari": ("Punjab", True), "pashmina": ("Jammu and Kashmir", True),
    "kani": ("Jammu and Kashmir", True), "kullu": ("Himachal Pradesh", True),
    "kinnauri": ("Himachal Pradesh", True), "muga": ("Assam", True),
    "eri": ("Assam", False), "bhagalpuri": ("Bihar", True),
    "madhubani": ("Bihar", True), "mithila": ("Bihar", True),
    "sikki": ("Bihar", False), "pattachitra": ("Odisha", True),
    "pipili": ("Odisha", True), "longpi": ("Manipur", True),
    "uttarakhand": ("Uttarakhand", False), "kumaun": ("Uttarakhand", False),
}

# Practised in several states. A region here would be invented, so there is none.
TECHNIQUES = {
    "ikat": "ikat", "ikkat": "ikat", "bandhani": "tie-dye", "bandhej": "tie-dye",
    "tie & dye": "tie-dye", "tie and dye": "tie-dye", "batik": "batik",
    "block print": "block-print", "handblock": "block-print", "hand block": "block-print",
    "jacquard": "jacquard", "patchwork": "patchwork", "embroider": "embroidery",
    "applique": "applique", "handpainted": "hand-painted", "hand painted": "hand-painted",
    "crochet": "crochet", "knitted": "knitted", "dhokra": "dhokra-cast",
    "handloom": "handloom", "handwoven": "handloom", "hand woven": "handloom",
    "handspun": "handspun", "khadi": "khadi", "natural dyed": "natural-dye",
}

MATERIALS = {
    "tussar": "tussar", "tussah": "tussar", "muga": "muga", "eri": "eri",
    "mulberry": "silk", "silk": "silk", "cotton": "cotton", "linen": "linen",
    "jute": "jute", "wool": "wool", "merino": "wool", "pashmina": "pashmina",
    "bamboo": "bamboo", "cane": "cane", "brass": "brass", "terracotta": "terracotta",
    "wood": "wood", "rosewood": "wood", "leather": "leather", "modal": "modal",
    "viscose": "viscose", "paper mache": "paper-mache", "sabai": "sabai-grass",
}

# product word -> (category_l1, category_l2). Order matters: the first hit in a title wins,
# so the specific words come before the general ones.
CATEGORIES = [
    ("saree", ("textiles", "saree")), ("sari", ("textiles", "saree")),
    ("dupatta", ("textiles", "dupatta")), ("stole", ("textiles", "stole")),
    ("shawl", ("textiles", "shawl")), ("dhoti", ("textiles", "dhoti")),
    ("dress material", ("textiles", "dress-material")),
    ("kurta", ("textiles", "kurta")), ("kurti", ("textiles", "kurta")),
    ("blouse", ("textiles", "blouse")), ("bedsheet", ("textiles", "bedsheet")),
    ("bed sheet", ("textiles", "bedsheet")), ("cushion", ("textiles", "cushion-cover")),
    ("pillow", ("textiles", "pillow-cover")), ("towel", ("textiles", "towel")),
    ("dhurrie", ("textiles", "dhurrie")), ("durrie", ("textiles", "dhurrie")),
    ("rug", ("textiles", "dhurrie")), ("carpet", ("textiles", "dhurrie")),
    ("fabric", ("textiles", "fabric")), ("scarf", ("textiles", "stole")),
    ("madhubani", ("painting", "madhubani")), ("mithila", ("painting", "madhubani")),
    ("pattachitra", ("painting", "pattachitra")), ("warli", ("painting", "warli")),
    ("painting", ("painting", "painting")),
    ("earring", ("jewellery", "earring")), ("necklace", ("jewellery", "necklace")),
    ("bangle", ("jewellery", "bangle")), ("jewellery", ("jewellery", "jewellery")),
    ("pottery", ("pottery", "pottery")), ("terracotta", ("pottery", "terracotta")),
    ("planter", ("pottery", "planter")), ("mug", ("pottery", "mug")),
    ("basket", ("basketry", "basket")), ("mat", ("basketry", "mat")),
    ("bag", ("accessories", "bag")), ("pouch", ("accessories", "pouch")),
    ("wallet", ("accessories", "wallet")), ("keychain", ("accessories", "keychain")),
    ("brass", ("metalwork", "brass")), ("dhokra", ("metalwork", "dhokra")),
    ("bidri", ("metalwork", "bidri")),
    ("furniture", ("woodwork", "furniture")), ("stool", ("woodwork", "furniture")),
    ("table", ("woodwork", "furniture")), ("chair", ("woodwork", "furniture")),
]
