"""Does the interpreter actually cope with dialects? Ask it, do not assume.

    cd ai && .venv/bin/python probe_dialects.py

Needs OPENROUTER_API_KEY and the network. NOT part of the test suite: it spends money and
its result is a measurement of a third-party model on a given day, not an invariant of this
code. Re-run it when the model changes; record what it says in research/DIALECTS.md.

Why it exists. Every prompt in interpret.py names "Hindi, Odia, Tamil, Bengali or English",
and roughly none of our users speak those. They speak Bhojpuri, Chhattisgarhi, Awadhi,
Magahi, Maithili — languages a Delhi form calls "Hindi" and a Bhojpuri speaker does not.
The design assumes the model is forgiving about this. That assumption was never tested, and
an interview that mishears the material is an interview that publishes the wrong material.
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

from dotenv import load_dotenv

# Same as service.py: the key lives in ai/.env, which is gitignored.
load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

from interpret import InterpretError, harvest, interpret  # noqa: E402

# (label, transcript, question or slots, what a person would say it means)
#
# Sentences are written the way they are actually spoken, not the way a textbook writes
# them. The point is dialect, so the vocabulary that differs from standard Hindi is the
# point too: `banal ba` not `banaya hai`, `kaikan` not `kitna`.
CASES = [
    ("bhojpuri / what", "ee sutti ke saari ha, hamar gaon me banal ba",
     {"question": "catalog.q_what"}, "a cotton saree"),
    ("bhojpuri / material", "ee resham ke ba, hathe se bunal",
     {"question": "catalog.q_material"}, "silk"),
    ("chhattisgarhi / what", "ye maati ke matka ye, hamar hath ke banae hoy",
     {"question": "catalog.q_what"}, "a clay pot"),
    ("awadhi / time", "ehi ma teen din lag gawa",
     {"question": "catalog.q_time"}, "three days"),
    ("maithili / material", "ee sikki ke banal aich",
     {"question": "catalog.q_material"}, "sikki grass"),
    ("magahi / name", "hamar naam Utsav Mohanty hau",
     {"question": "onboard.name"}, "Utsav Mohanty"),
    # The two new languages, in spoken register rather than written register — the gap
    # between them is wider in Tamil than in anything else we accept.
    ("tamil spoken / what", "idhu kaithari pruthi pudavai, naanga veetla senjadhu",
     {"question": "catalog.q_what", "language": "ta"}, "a handloom cotton saree"),
    ("tamil script / what", "இது கைத்தறி பருத்தி புடவை, எங்க வீட்ல செஞ்சது",
     {"question": "catalog.q_what", "language": "ta"}, "a handloom cotton saree"),
    ("bengali colloquial / what", "eta hate bona sutir shari, amader gramer kaj",
     {"question": "catalog.q_what", "language": "bn"}, "a handwoven cotton saree"),
    ("bengali script / what", "এটা হাতে বোনা সুতির শাড়ি, আমাদের গ্রামের কাজ",
     {"question": "catalog.q_what", "language": "bn"}, "a handwoven cotton saree"),
    # Harvest, which is where a rich dialect sentence pays for itself or does not.
    ("bhojpuri / harvest", "ee sutti ke saari ha, teen din lagal, chhau gaj ke ba",
     {"slots": ["material", "time", "size"]}, "cotton + three days + six gaz"),
    ("chhattisgarhi / harvest", "maati ke matka ye, do din ma banaen, bada he",
     {"slots": ["material", "time", "size"]}, "clay + two days + (size vague)"),
]


async def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        print("OPENROUTER_API_KEY is not set — nothing to measure.", file=sys.stderr)
        return 2

    worked = 0
    for label, transcript, ask, meaning in CASES:
        req = {"transcript": transcript, "language": "hi", **ask}  # `hi` unless the case says otherwise
        # Three attempts: OpenRouter drops a connection often enough that a single timeout
        # would otherwise be recorded as "the model cannot read Chhattisgarhi".
        got = None
        for _ in range(3):
            try:
                got = await (harvest(req) if "slots" in ask else interpret(req))
                break
            except InterpretError as e:
                failure = e
        if got is None:
            print(f"  ✗ {label:28} unreachable: {failure}")
            continue
        try:
            pass
        except ValueError as e:
            print(f"  ✗ {label:28} refused: {e}")
            continue

        value = got.get("slots") if "slots" in ask else got.get("value")
        # Judged by a human reading the output, deliberately. "cotton" and "sutti" are both
        # right, "saree" for a material question is not, and no assertion written here can
        # tell those apart as well as the person reading this table can.
        ok = "?" if not value else "·"
        print(f"  {ok} {label:28} -> {value!r}")
        print(f"    {'':28}    said: {transcript}")
        print(f"    {'':28}    means: {meaning}  (confidence {got.get('confidence')})")
        worked += bool(value)

    print(f"\n{worked}/{len(CASES)} produced a value. Read them — a confident wrong answer "
          f"counts as a failure, and only a person can see that.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
