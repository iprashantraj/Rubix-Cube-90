"""ASR and TTS. Two providers, tried in order: Sarvam AI, then Bhashini (MeitY).

Recognition never runs on the phone. The target device is a 2-3GB handset, and the whole
argument of spec §5.1 is that a cheap phone and an expensive one must produce the same
result — on-device ASR would make transcript quality a function of what the artisan could
afford.

## Why two providers, in this order

**Sarvam first.** One documented REST call, one key, good Indian-language coverage. It is
what a fresh clone can actually turn on today.

**Bhashini second.** Government-aligned, broader dialect coverage, dramatically cheaper at
volume — but it is two hops (ask ULCA which model serves this task+language, then call the
endpoint it names) and its commercial access terms are still unconfirmed (spec §18 item 5).

Neither being configured is a supported state, not a crash: the endpoint returns 503 and
the client walks down its own ladder to native device TTS. That degradation is the whole
point — for a user who cannot read, a silent screen is a blank screen, so every layer here
fails loudly downward instead of throwing.

⚠️ The Sarvam request/response shapes below are written against their published REST API.
If they version it, `_sarvam_tts`/`_sarvam_asr` are the only two functions that change —
everything else keys off the returned bytes and text.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..config import settings

router = APIRouter()
log = logging.getLogger(__name__)

# MeitY's public inference pipeline. Not a secret and not per-deployment, so it is a
# constant rather than another setting nobody would ever change.
PIPELINE_ID = "64392f96daac500b55c543cd"

# Disk cache, not memory: the prompt set is small and repetitive (the camera gate says the
# same seven sentences forever) so the hit rate approaches 1 — and surviving a restart is
# what stops a deploy from re-buying every clip.
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "tts"

_pipelines: dict[tuple[str, str], dict] = {}
_pipeline_lock = asyncio.Lock()


class TTSRequest(BaseModel):
    text: str
    lang: str = "hi"


# Sarvam speaks BCP-47, our app speaks two-letter codes. Unknown languages fall back to
# Hindi rather than erroring: the artisan hears the wrong language, which is bad, but they
# hear *something*, which beats a dead screen while a new language is being added.
SARVAM_LANGS = {"hi": "hi-IN", "or": "od-IN", "en": "en-IN"}

# ⚠️ en-IN is right for ASR — our English speakers are Indian — and is the only English
# Sarvam's bulbul model offers for TTS. The app deliberately SPEAKS English with a
# non-Indian voice (see the `en` entry in app/src/i18n/index.js: someone who picked English
# as their interface language did so because they read it, and a heavy accent makes the one
# language they chose the hardest to follow). This tier is 503 without a key today, so the
# device voice wins and that fix holds. The moment a key is added, English TTS silently
# reverts. Route English TTS past Sarvam then, or accept the regression knowingly.

# bulbul:v3 is the current TTS model; `ritu` is one of its supported speakers. Both are
# constants rather than settings because changing them changes how the app *sounds*, which
# is a product decision, not a deployment one.
#
# This was `bulbul:v2` / `anushka`, and both had to move together on 2026-09-01: Sarvam
# answers v2 with "Model 'bulbul:v2' has been deprecated. Please use 'bulbul:v3' instead",
# and v3 rejects `anushka` outright — the speaker lists do not overlap. Every spoken prompt
# in the app was therefore a 400, turned into a 503 by the handler below, which the client
# correctly read as "provider is down" and answered with the device voice. The voice layer
# never went silent, which is why a deprecation that broke server TTS entirely was invisible
# from the phone. Same failure shape as the `saarika:v2` ASR note above: a wrong string in
# one constant, hidden by a fallback doing its job.
SARVAM_TTS_MODEL = "bulbul:v3"
SARVAM_TTS_SPEAKER = "ritu"

# saaras:v3 is the documented default; saaras:v4 also exists. Named explicitly rather than
# omitted so an upstream default change cannot silently alter transcript quality under us.
#
# This was `saarika:v2` — a model id that does not exist. Sarvam rejected every request,
# the handler below turned that into a 503, and the app read the 503 as "voice is down" and
# offered the tap fallback. TTS worked throughout, so the failure looked like a microphone
# problem rather than a wrong string in one constant. Verified against
# https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
SARVAM_ASR_MODEL = "saaras:v3"


def _require_any_key() -> None:
    """503 rather than a silent empty body.

    The client's fallback ladder keys off this failure — an empty 200 would just play
    nothing, which is the worst of both worlds.
    """
    s = settings()
    if not (s.sarvam_api_key or s.bhashini_api_key):
        raise HTTPException(503, "no speech provider configured")


async def _sarvam_tts(text: str, lang: str) -> bytes:
    s = settings()
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{s.sarvam_base_url}/text-to-speech",
            headers={"api-subscription-key": s.sarvam_api_key},
            json={
                "inputs": [text],
                "target_language_code": SARVAM_LANGS.get(lang, "hi-IN"),
                "speaker": SARVAM_TTS_SPEAKER,
                "model": SARVAM_TTS_MODEL,
                # Slower than default: these are instructions, not narration, and they are
                # heard once by someone who cannot fall back to reading them.
                "pace": 0.9,
                "speech_sample_rate": 22050,
                "enable_preprocessing": True,
            },
        )
        res.raise_for_status()
        return base64.b64decode(res.json()["audios"][0])


async def _sarvam_asr(clip: bytes, filename: str, lang: str) -> dict:
    s = settings()
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(
            f"{s.sarvam_base_url}/speech-to-text",
            headers={"api-subscription-key": s.sarvam_api_key},
            files={"file": (filename or "clip.webm", clip, "audio/webm")},
            data={
                "model": SARVAM_ASR_MODEL,
                "language_code": SARVAM_LANGS.get(lang, "hi-IN"),
            },
        )
        res.raise_for_status()
        body = res.json()
    # Sarvam does not return a confidence score. Default to 0.0, never 1.0 — the cataloger
    # uses this to decide whether to re-ask, and a fabricated high score would silently
    # skip the confirmation step on a transcript nobody checked.
    return {"transcript": body.get("transcript", ""), "confidence": body.get("confidence", 0.0)}




async def _pipeline(task: str, lang: str) -> dict:
    """Which service serves this (task, language)? Returns endpoint, auth header, id."""
    key = (task, lang)
    if key in _pipelines:
        return _pipelines[key]

    async with _pipeline_lock:
        if key in _pipelines:  # another request resolved it while we waited
            return _pipelines[key]

        s = settings()
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(
                s.bhashini_pipeline_url,
                headers={"userID": s.bhashini_user_id, "ulcaApiKey": s.bhashini_api_key},
                json={
                    "pipelineTasks": [
                        {"taskType": task, "config": {"language": {"sourceLanguage": lang}}}
                    ],
                    "pipelineRequestConfig": {"pipelineId": PIPELINE_ID},
                },
            )
            res.raise_for_status()
            body = res.json()

        endpoint = body["pipelineInferenceAPIEndPoint"]
        auth = endpoint["inferenceApiKey"]
        service = body["pipelineResponseConfig"][0]["config"][0]["serviceId"]
        _pipelines[key] = {
            "url": endpoint["callbackUrl"],
            "headers": {auth["name"]: auth["value"]},
            "service_id": service,
        }
        return _pipelines[key]


async def _compute(task: str, lang: str, config: dict, input_data: dict) -> dict:
    p = await _pipeline(task, lang)
    payload = {
        "pipelineTasks": [
            {
                "taskType": task,
                "config": {
                    "language": {"sourceLanguage": lang},
                    "serviceId": p["service_id"],
                    **config,
                },
            }
        ],
        "inputData": input_data,
    }
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(p["url"], headers=p["headers"], json=payload)
        res.raise_for_status()
        return res.json()


def _cache_path(lang: str, text: str) -> Path:
    # Hashed, not slugified: the text is arbitrary Devanagari/Odia and can be long, and a
    # filename built from it would hit path-length and encoding limits on some hosts.
    digest = hashlib.sha256(f"{lang}\x00{text}".encode()).hexdigest()
    return CACHE_DIR / f"{digest}.wav"


async def _bhashini_tts(text: str, lang: str) -> bytes:
    body = await _compute(
        "tts",
        lang,
        {"gender": "female", "samplingRate": 22050},
        {"input": [{"source": text}]},
    )
    return base64.b64decode(body["pipelineResponse"][0]["audio"][0]["audioContent"])


@router.post("/tts")
async def tts(req: TTSRequest) -> Response:
    _require_any_key()

    # English is spoken by the DEVICE, never by a provider here. Both of ours offer English
    # only as en-IN, and the note above SARVAM_LANGS predicted exactly what happened when a
    # key was finally added: English TTS silently reverted to a heavy Indian accent, for the
    # one group of users who chose English *because* they read it. 503 is the client's
    # "use the next tier" signal (voice/engine.js), and the next tier is the phone's own
    # voice at whatever tag i18n asks for.
    if req.lang == "en":
        raise HTTPException(503, "english is spoken by the device voice")

    # Cache lookup precedes provider choice on purpose: a clip already on disk is correct
    # no matter which provider produced it, and re-buying it because the primary changed
    # would be pure waste.
    cached = _cache_path(req.lang, req.text)
    if cached.exists():
        return Response(cached.read_bytes(), media_type="audio/wav")

    s = settings()
    audio = None
    for name, key, fn in (
        ("sarvam", s.sarvam_api_key, _sarvam_tts),
        ("bhashini", s.bhashini_api_key, _bhashini_tts),
    ):
        if not key:
            continue
        try:
            audio = await fn(req.text, req.lang)
            break
        except Exception as e:
            # Try the next provider rather than giving up. One provider being down or
            # rate-limited should cost quality, not the whole voice layer.
            log.warning("%s tts failed (lang=%s): %s", name, req.lang, e)

    if audio is None:
        # Never a 500. The client reads any failure here as "use the next tier", and a 500
        # would look to it like a bug worth retrying rather than a signal to fall back —
        # which would leave the screen silent while it retried.
        raise HTTPException(503, "tts unavailable")

    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(audio)
    return Response(audio, media_type="audio/wav")


async def _bhashini_asr(clip: bytes, _filename: str, lang: str) -> dict:
    body = await _compute(
        "asr",
        lang,
        {"audioFormat": "webm", "samplingRate": 16000},
        {"audio": [{"audioContent": base64.b64encode(clip).decode()}]},
    )
    output = body["pipelineResponse"][0]["output"][0]
    # Confidence is optional in the ULCA response. Default to 0.0 rather than 1.0 — see
    # the note in _sarvam_asr; a fabricated score skips a confirmation nobody performed.
    return {"transcript": output.get("source", ""), "confidence": output.get("confidence", 0.0)}


@router.post("/asr")
async def asr(audio: UploadFile = File(...), lang: str = Form("hi")) -> dict:
    _require_any_key()

    clip = await audio.read()
    if not clip:
        # An empty clip is the artisan tapping stop before saying anything, not a provider
        # failure. 422 keeps it out of the 503 path, which the client treats as "voice is
        # down" and would send them to the wrong error entirely.
        raise HTTPException(422, "empty audio")

    s = settings()
    for name, key, fn in (
        ("sarvam", s.sarvam_api_key, _sarvam_asr),
        ("bhashini", s.bhashini_api_key, _bhashini_asr),
    ):
        if not key:
            continue
        try:
            return await fn(clip, audio.filename or "clip.webm", lang)
        except Exception as e:
            log.warning("%s asr failed (lang=%s): %s", name, lang, e)

    raise HTTPException(503, "asr unavailable")
