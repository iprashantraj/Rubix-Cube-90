"""Fetch openly-licensed fixtures into images/raw, with the licence recorded.

    python3 images/fetch.py --list
    python3 images/fetch.py --preset fringe -n 12
    python3 images/fetch.py -q "brass diya lamp" --category brass --subject diya \
                            --condition specular -n 8

Why Wikimedia Commons and not Google Images:

  * Google Images has no API, forbids scraping in its terms, and returns thumbnails —
    which is exactly the failure the first fixture batch hit: 14 of 16 under 1000px.
  * Commons serves real photographs at real resolution (4000px+ originals are normal),
    needs no key, and hands back the licence and the creator with every result.
    `images/MANIFEST.md` asks for consent per fixture; this fills that column honestly
    rather than leaving it blank.
  * Openverse is kept as `--source openverse`, but its anonymous tier starts answering
    401 after a handful of queries, so it cannot carry a whole collection run.

Every download is filtered on real decoded dimensions, not the metadata, and deduplicated
by SHA against everything already in `raw/`. Files are named with the condition token
`check.py` reads, so coverage updates itself.

⚠️ This cannot fetch the `gate-v1` set. See `degrade.py` and the note at the bottom of
this file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
MANIFEST = ROOT / "MANIFEST.md"
API = "https://api.openverse.org/v1/images/"
# Wikimedia's robot policy requires a descriptive agent with a way to contact whoever is
# running it, and asks for roughly one request a second. Both are honoured below. Without
# them the upload servers answer 429 and the collection run dies halfway through.
UA = ("kaarigar-research/0.1 (SIH PS 26090 handicraft fixture collection; "
      "contact: piyush.456beast@gmail.com)")
DELAY_S = 1.1

# The subjects that actually decide something. Each preset is (query, category, subject,
# condition) — the condition token is what check.py reads back for coverage.
PRESETS = {
    "fringe": [
        ("saree pallu fringe tassel", "textile", "pallu", "fringe"),
        ("dupatta net sheer fabric", "textile", "dupatta", "fringe"),
        ("shawl tassels handloom", "textile", "shawl", "fringe"),
    ],
    "specular": [
        ("brass diya oil lamp", "brass", "diya", "specular"),
        ("brass urli bowl", "brass", "urli", "specular"),
        ("zari border silk saree", "textile", "zari", "specular"),
    ],
    "darkfloor": [
        ("black terracotta pottery", "pottery", "terracotta", "darkfloor"),
        ("black clay pot nizamabad", "pottery", "blackclay", "darkfloor"),
    ],
    "patterned": [
        ("handloom textile on patterned rug", "textile", "handloom", "patterned"),
        ("block print fabric background", "textile", "blockprint", "patterned"),
    ],
    "sharp": [
        ("plain white cotton cloth", "textile", "cotton", "sharp"),
        ("undecorated clay pot plain", "pottery", "plainpot", "sharp"),
    ],
    "indoor": [
        ("weaver loom workshop india", "textile", "loom", "indoor"),
        ("potter workshop wheel india", "pottery", "wheel", "indoor"),
    ],
}


COMMONS = "https://commons.wikimedia.org/w/api.php"

# Our working size (spec §4: downscale to a 2000px long edge before anything else). Commons
# originals run to 4608px and several megabytes; asking for the 2000px rendition is a
# smaller download and is exactly the resolution the pipeline operates at anyway.
THUMB_PX = 2000


def _get(url: str, timeout: int = 45, attempts: int = 4) -> bytes:
    """One polite GET. Sleeps between calls and backs off on 429 rather than retrying into
    a block — being rate-limited by Commons is a rudeness problem, not a network problem."""
    for n in range(attempts):
        time.sleep(DELAY_S)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503) or n == attempts - 1:
                raise
            wait = 2 ** n * 3
            print(f"  rate limited, waiting {wait}s")
            time.sleep(wait)
    raise RuntimeError("unreachable")


def search_commons(query: str, want: int, min_px: int) -> list[dict]:
    """Wikimedia Commons. No key, no rate limit worth worrying about, and the originals are
    real photographs at real resolution rather than the thumbnails an image search returns.

    Default source because Openverse's anonymous tier starts answering 401 after a handful
    of queries, which is how the first run of this script died halfway through.
    """
    params = {
        "action": "query",
        "generator": "search",
        "gsrsearch": f"file: {query}",
        "gsrnamespace": "6",  # File:
        "gsrlimit": str(min(want * 8, 50)),
        "prop": "imageinfo",
        "iiprop": "url|size|extmetadata|mime",
        "iiurlwidth": str(THUMB_PX),
        "format": "json",
    }
    payload = json.loads(_get(COMMONS + "?" + urllib.parse.urlencode(params), timeout=30))

    out = []
    for page in payload.get("query", {}).get("pages", {}).values():
        info = (page.get("imageinfo") or [{}])[0]
        if not info.get("mime", "").startswith("image/"):
            continue
        if info.get("mime") in {"image/svg+xml", "image/tiff"}:
            continue  # a diagram or a scan, not a photograph
        ow, oh = info.get("width", 0), info.get("height", 0)
        if min(ow, oh) < min_px:
            continue

        # Take the 2000px rendition when it still clears the floor, the original when it
        # does not. THUMB_PX caps the WIDTH, so a wide image's 2000px rendition can be only
        # a few hundred pixels tall — filtering on the original's size and then downloading
        # the thumb silently threw away most of what the search found.
        tw, th = info.get("thumbwidth", 0), info.get("thumbheight", 0)
        if info.get("thumburl") and min(tw, th) >= min_px:
            url, w, h = info["thumburl"], tw, th
        else:
            url, w, h = info.get("url"), ow, oh

        meta = info.get("extmetadata", {})
        out.append({
            "url": url,
            "width": w,
            "height": h,
            "license": meta.get("LicenseShortName", {}).get("value", "see source"),
            "license_version": "",
            "creator": _strip_html(meta.get("Artist", {}).get("value", "")) or "unknown",
            "foreign_landing_url": info.get("descriptionurl", ""),
        })
    return out


def _strip_html(s: str) -> str:
    """Commons returns the creator as an HTML fragment with a link in it."""
    return re.sub(r"<[^>]+>", "", s).strip().replace("|", "/")[:60]


def search(query: str, want: int, min_px: int) -> list[dict]:
    """Openverse pages at 20 by default. Ask for more than we need — most results fail the
    size filter, which is the whole point of filtering here rather than at download time."""
    params = {
        "q": query,
        "page_size": str(min(want * 6, 100)),
        "license_type": "all-cc",
        "mature": "false",
    }
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.load(r)
    results = payload.get("results", [])
    # Metadata width/height is often absent or wrong; treat it as a cheap pre-filter only.
    return [
        x for x in results
        if not (x.get("width") and x.get("height"))
        or min(x["width"], x["height"]) >= min_px
    ]


def known_hashes() -> set[str]:
    return {
        hashlib.sha256(p.read_bytes()).hexdigest()
        for p in RAW.iterdir()
        if p.is_file() and p.name != ".gitkeep"
    }


def next_index(category: str, subject: str, condition: str) -> int:
    stem = f"{category}-{subject}-{condition}-"
    used = [
        int(p.stem[len(stem):]) for p in RAW.glob(f"{stem}*")
        if p.stem[len(stem):].isdigit()
    ]
    return max(used, default=0) + 1


def manifest_row(name: str, subject: str, condition: str, hit: dict) -> str:
    lic = f"{hit.get('license', '?')} {hit.get('license_version', '')}".strip().upper()
    creator = (hit.get("creator") or "unknown").replace("|", "/")
    src = hit.get("foreign_landing_url") or hit.get("url") or ""
    return f"| `{name}` | {subject} | {condition} | web | {creator} | {lic} | [source]({src}) |\n"


def fetch_one(hit: dict, category: str, subject: str, condition: str, min_px: int,
              seen: set[str]) -> tuple[str, str] | None:
    url = hit.get("url")
    if not url:
        return None
    blob = _get(url)

    sha = hashlib.sha256(blob).hexdigest()
    if sha in seen:
        return None  # already have this exact file

    try:
        img = Image.open(BytesIO(blob))
        img.load()
    except Exception:
        return None  # an HTML error page, a SVG, a truncated download

    if min(img.size) < min_px:
        return None

    name = f"{category}-{subject}-{condition}-{next_index(category, subject, condition):02d}.jpg"
    # Re-encoding would be a second generation loss and would strip the very sensor
    # characteristics the set exists to capture. Write the original bytes.
    ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}.get(img.format, ".jpg")
    name = name[:-4] + ext
    (RAW / name).write_bytes(blob)
    seen.add(sha)
    return name, f"{img.size[0]}x{img.size[1]}"


SOURCES = {"commons": search_commons, "openverse": search}


def run(jobs: list[tuple[str, str, str, str]], want: int, min_px: int, source: str) -> int:
    seen = known_hashes()
    rows: list[str] = []
    got = 0

    for query, category, subject, condition in jobs:
        print(f"\n{query!r}  ->  {category}-{subject}-{condition}")
        hits = []
        # Try the chosen source, then the other one. Openverse answers 401 once its
        # anonymous tier is exhausted, and a half-finished set is worse than a slow one.
        order = [source] + [s for s in SOURCES if s != source]
        for name in order:
            try:
                hits = SOURCES[name](query, want, min_px)
            except Exception as e:
                print(f"  {name} failed: {type(e).__name__} {e}")
                continue
            if hits:
                if name != source:
                    print(f"  (fell back to {name})")
                break
        if not hits:
            continue

        taken = 0
        for hit in hits:
            if taken >= want:
                break
            try:
                result = fetch_one(hit, category, subject, condition, min_px, seen)
            except Exception as e:
                print(f"  skip: {type(e).__name__}")
                continue
            if result is None:
                continue
            name, size = result
            print(f"  ok  {name:<44} {size}")
            rows.append(manifest_row(name, subject, condition, hit))
            taken += 1
            got += 1
        if taken < want:
            print(f"  only {taken}/{want} cleared {min_px}px — widen the query or lower --min-px")

    if rows:
        with MANIFEST.open("a") as f:
            f.write("".join(rows))
        print(f"\n{got} images, {len(rows)} manifest rows appended to images/MANIFEST.md")
        print("Run `python3 images/check.py` to score the set.")
    else:
        print("\nNothing downloaded.")
    return 0 if got else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="show the presets and exit")
    ap.add_argument("--preset", choices=sorted(PRESETS))
    ap.add_argument("-q", "--query")
    ap.add_argument("--category", default="misc")
    ap.add_argument("--subject", default="item")
    ap.add_argument("--condition", default="web")
    ap.add_argument("-n", type=int, default=6, help="images per query")
    ap.add_argument("--source", choices=sorted(SOURCES), default="commons")
    ap.add_argument("--min-px", type=int, default=1000,
                    help="minimum short edge. Below resolution_min_px the server gate "
                         "drops it and BiRefNet upscales the edges we are judging")
    args = ap.parse_args()

    if args.list:
        for name, jobs in PRESETS.items():
            print(f"{name}:")
            for q, c, s, cond in jobs:
                print(f"    {q!r}  ->  {c}-{s}-{cond}")
        return 0

    if args.preset:
        jobs = PRESETS[args.preset]
    elif args.query:
        jobs = [(args.query, args.category, args.subject, args.condition)]
    else:
        ap.error("give --preset or -q")

    RAW.mkdir(parents=True, exist_ok=True)
    return run(jobs, args.n, args.min_px, args.source)


if __name__ == "__main__":
    sys.exit(main())

# The gate-v1 set is not fetchable from anywhere, and no amount of scraping changes that.
# The web is a filter that has already removed every blurry, dark and badly-framed photo:
# nobody publishes their failures. Those fixtures come from `degrade.py`, or from a phone.
