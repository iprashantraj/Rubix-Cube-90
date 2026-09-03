#!/usr/bin/env python3
"""One recorded sentence -> a real listing. The end-to-end F2 check.

    clip.webm -> web/api /api/asr -> transcript
              -> ai /catalog/interpret (one field)
              -> ai /catalog          -> title, desc_en, desc_hi, per-channel copy

Everything in F2 is written and nothing in it has been run against a live provider, because
no ASR key has ever existed in this repo. That is the single largest unknown in the feature:
whether Sarvam hears a real artisan's Hindi or Odia at all. This script is the smallest thing
that answers it.

    ai/.venv/bin/python scripts/f2_smoke.py clip.webm --lang hi

Needs, in web/api/.env:  SARVAM_API_KEY
Needs, in ai/.env:       OPENROUTER_API_KEY
Without the first this exits on a 503 from /api/asr, which is the state the repo is in today.
Without the second the listing still comes back, composed from the transcript by
compose_fallback and marked confidence 0 — worth seeing, and clearly labelled below.

--text skips the microphone half and feeds a sentence straight in, for when you want to test
the writing without recording anything.
"""

import argparse
import json
import pathlib
import sys

import httpx

WEB = "http://localhost:8000"
AI = "http://localhost:8001"


def die(msg: str) -> None:
    print(f"\n✗ {msg}", file=sys.stderr)
    sys.exit(1)


def transcribe(clip: pathlib.Path, lang: str) -> str:
    with httpx.Client(timeout=90) as c:
        try:
            r = c.post(
                f"{WEB}/api/asr",
                files={"audio": (clip.name, clip.read_bytes(), "audio/webm")},
                data={"lang": lang},
            )
        except httpx.ConnectError:
            die(f"nothing answering at {WEB}. Start it: cd web/api && uvicorn main:app")
    if r.status_code == 503:
        die("/api/asr says 503 — no SARVAM_API_KEY (or BHASHINI_API_KEY) in web/api/.env.\n"
            "  This is the whole point of the script. Get a key from dashboard.sarvam.ai.")
    if r.status_code != 200:
        die(f"/api/asr {r.status_code}: {r.text[:300]}")
    body = r.json()
    if not body.get("transcript", "").strip():
        die("ASR returned an empty transcript. The provider heard nothing in this clip.")
    return body["transcript"]


def post_ai(path: str, body: dict, soft: bool = False) -> dict:
    with httpx.Client(timeout=120) as c:
        try:
            r = c.post(f"{AI}{path}", json=body)
        except httpx.ConnectError:
            die(f"nothing answering at {AI}. Start it: cd ai && .venv/bin/uvicorn service:app --port 8001")
    if r.status_code == 404 and soft:
        # The route exists in service.py. A 404 means the running process is older than it —
        # uvicorn was started before this endpoint was written. Restart it.
        print(f"  ({path} 404 — the running service predates this route, restart uvicorn)")
        return {}
    if r.status_code == 503 and soft:
        # No OPENROUTER_API_KEY. Not fatal here: /catalog composes from the answers anyway,
        # and seeing that degraded listing is worth as much as seeing the model's.
        print(f"  ({path} 503 — no model configured, skipping)")
        return {}
    if r.status_code != 200:
        die(f"{path} {r.status_code}: {r.text[:300]}")
    return r.json()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("clip", nargs="?", type=pathlib.Path, help="audio file (webm/mp4/wav)")
    ap.add_argument("--lang", default="hi", choices=["hi", "or", "en"])
    ap.add_argument("--text", help="skip ASR, use this sentence as the transcript")
    ap.add_argument("--channels", default="amazon,whatsapp,gem")
    args = ap.parse_args()

    if args.text:
        transcript = args.text
        print(f"transcript (given)  {transcript}")
    elif args.clip and args.clip.exists():
        transcript = transcribe(args.clip, args.lang)
        print(f"transcript ({args.lang})     {transcript}")
    else:
        die("pass an audio file, or --text 'a sentence'")

    # One field, the way /catalog/voice asks for it. Proves the transcript survives the
    # model round trip before we spend a longer call on the whole listing.
    got = post_ai("/catalog/interpret",
                  {"transcript": transcript, "question": "catalog.q_what", "language": args.lang},
                  soft=True)
    if got:
        # "choice", not "value" — contracts.md names the interpret response field that way,
        # and reading the wrong key here made a working extraction look like a null.
        print(f"interpreted 'what'  {got.get('choice')!r}  confidence {got.get('confidence')}")

    # Whatever else that same sentence happened to contain.
    harvest = post_ai("/catalog/harvest",
                      {"transcript": transcript,
                       "slots": ["material", "colour", "size", "technique"],
                       "language": args.lang},
                      soft=True)
    print(f"harvested           {json.dumps(harvest.get('slots', harvest), ensure_ascii=False)}")

    fields = {"what": got.get("choice") or transcript}
    for k, v in (harvest.get("slots") or {}).items():
        if isinstance(v, str) and v.strip():
            fields[k] = v

    listing = post_ai("/catalog", {"fields": fields, "language": args.lang,
                                   "channels": args.channels.split(",")})

    print("\n── listing " + "─" * 58)
    print(f"title    {listing.get('title')}")
    print(f"desc_en  {listing.get('desc_en')}")
    print(f"desc_hi  {listing.get('desc_hi')}")
    print(f"keywords {', '.join(listing.get('keywords') or [])}")

    if listing.get("confidence") == 0:
        print("\n⚠ confidence 0 — the model was unreachable and this was composed from the\n"
              "  artisan's own words by compose_fallback. Set OPENROUTER_API_KEY in ai/.env.")

    for ch, shaped in (listing.get("channels") or {}).items():
        print(f"\n{ch}: title {len(shaped.get('title',''))} chars, "
              f"desc {len(shaped.get('desc_hi') or shaped.get('desc_en') or '')} chars")

    # The three things only a human can score, and the reason this script prints rather
    # than asserts. Read them before saying F2 works.
    print("\nJudge, honestly:")
    print("  1. is the transcript what you actually said?")
    print("  2. is desc_hi natural Hindi, or translated English wearing a Devanagari coat?")
    print("  3. does anything in either description name a detail the product does not have?")
    print("     (rule 1 — a fabricated detail is a return the artisan pays for)")


if __name__ == "__main__":
    main()
