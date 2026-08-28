# What reaches a third-party model, and when

The app sends a small, fixed set of fields to OpenRouter (`deepseek/deepseek-v4-flash`) so
that a spoken sentence can be reduced to a field value. This document is the complete list.
If something is not in the "sent" table below, it is not sent — and that is enforced in
code, in two places, not left to whoever writes the next caller.

Read alongside [Questions-Asked.md](./Questions-Asked.md).

---

## The path

```
phone                web/api                       ai/                     OpenRouter
─────                ───────                       ───                     ──────────
transcript  ──POST──▶ /api/catalog/interpret
                      · requires a valid token
                      · FORWARDED_FIELDS allowlist   (filter 1)
                      · artisan id used HERE, not forwarded
                                    ──POST──▶ /catalog/interpret
                                              · build_payload allowlist  (filter 2)
                                              · KNOWN_QUESTIONS gate
                                              · NFKC + control-strip + length cap
                                                            ──HTTPS──▶ chat/completions
                                                            ◀── JSON ──
                                              · parsed, validated, allowlist-checked
                                    ◀── {choice, confidence}
                      ◀── {choice, confidence}
◀── choice
```

**Two independent filters, on purpose.** `web/api` holds the artisan's session — their id,
their token, their phone number are all in scope in that process. `ai/` holds the API key.
Neither trusts the other to have done the filtering, because the cost of one of them being
wrong is personal data leaving the country's jurisdiction with no way to recall it.

**The app never holds the OpenRouter key.** A key in a mobile bundle is a published key, and
rotating it means an app release rural users never install.

---

## Sent

Four fields. Built in `build_payload()` in `ai/interpret.py`, which is the only function
that constructs a request body.

| Field | Example | Why it must go |
|---|---|---|
| `transcript` | `"मेरा नाम उत्सव है"` | It is the thing being interpreted. Capped at 600 chars, NFKC-normalised, invisible and control characters stripped. |
| `question` | `"onboard.name"` | An id, not the text. The model needs to know what was asked. Must be in `KNOWN_QUESTIONS` or the request is refused. |
| `options` | `["weaving", "pottery", …]` | Our vocabulary, not the artisan's. Constrained to `[a-z0-9_.-]+` so this field cannot smuggle prose into the prompt. |
| `language` | `"hi"` | One of `hi` / `or` / `en`. Anything else becomes `hi`. |

### When

| Trigger | Question | Frequency |
|---|---|---|
| `/onboard/name`, after ASR | `onboard.name` | Once per artisan, **only if** the local carrier-strip fails |
| `/onboard/craft`, voice option | `onboard.craft` | Only if the artisan uses "something else" **and** the local synonym table finds nothing |
| `/catalog/voice`, each answer | `catalog.q_*` | Up to 5 per product, each only if the local strip fails |

**The local tier runs first and usually wins.** `stripCarrier()` and `matchCraft()` in
`app/src/voice/interpret.js` handle the ordinary phrasings in all three languages, offline,
for free. The model is for sentences a table cannot reach. So the common case sends
**nothing at all**.

---

## Never sent

Not "we try not to" — these are absent from the allowlists, and `build_payload` drops any
field it is handed that is not one of the four above. There is a self-check in
`ai/interpret.py` that passes an artisan id, phone number, token, PIN code and readiness
flag into it and asserts none of them survive.

| Withheld | Why |
|---|---|
| Artisan id, phone number | The transcript is then unlinkable to a person at the provider. This is the single most valuable property in this document. |
| Auth token | Never leaves our own services. |
| PIN code | Location data. Parsed locally by `extractPincode()`, which is deterministic, offline and better at it. |
| `has_pan`, `has_bank`, `has_gst`, `has_artisan_card` | Financial-inclusion facts about a named individual. Booleans answered by tap; no interpretation is needed and disclosing them buys nothing. |
| Consent artifact, erasure requests | DPDP records. Ours to hold, nobody else's to see. |
| Product ids, order data, prices, earnings | Commercial data, and no question about it is ever interpreted. **No LLM touches a price** — see `ai/README.md`. |
| **Images** | The chosen model has no vision. See [Future-Implementations.md](./Future-Implementations.md). |
| Anything from `/settings` | Including the spoken erasure consent. |

### The one piece of personal data that does go

**A name is personal data, and for the name question the transcript *is* the name.**

There is no way to interpret "what is your name" without sending it. It goes without an
identifier attached, so the provider receives a name and nothing to attach it to — but it
does go, and this document exists partly so that nobody discovers that by reading code.

Consequences somebody has to own, not me:

- The `/consent` notice says we keep the artisan's name. It does not currently say a
  third-party processor may see it during onboarding. **Under DPDP that is a disclosure
  that should be made.**
- The local carrier-strip handles the common phrasings, so most artisans' names are never
  sent at all. The fewer that go, the smaller this is.
- If that trade is not acceptable, set `onboard.name` to `"open"` → remove it from
  `KNOWN_QUESTIONS`. The screen keeps working; it falls back to the local strip and then to
  storing the raw sentence after confirmation.

---

## Prompt injection, and why the defence is not the prompt

The input is an ASR transcript of whatever was said near a microphone. The realistic risk is
not a weaver crafting an attack — it is ASR mishearing something that reads as an
instruction, a bystander or a television talking over the artisan, or this endpoint later
being pointed at a text field somebody can type into.

The system prompt does tell the model to treat the transcript as data. **Nothing downstream
trusts that it obeyed:**

1. The response is parsed as JSON; anything else becomes `null`.
2. For a choice question, `choice` must be a member of the caller's `options` or it is
   discarded — a model that returns `"blacksmithing"` when offered eight crafts produces a
   null, however confident it claims to be.
3. Free-text answers are length-capped and control-stripped on the way out.
4. The model has no tools, no URLs, no ids, no ability to act. It returns a string.
5. `temperature: 0` — extraction, not writing. The same sentence gives the same answer, or
   the confirmation step is meaningless.

The property that matters: **a model that ignores every instruction it was given can, at
worst, return a value the caller already declared acceptable — or nothing.**

And after all of it, the artisan sees what we heard and what we made of it, and taps yes or
no. That confirmation is the real backstop, and it is why it must never be optimised away.

---

## Turning it off

`OPENROUTER_API_KEY` unset is a **supported state**, not a failure. `/catalog/interpret`
answers 503, the app falls back to its local tables, then to the visual grid. Onboarding
completes either way. Nothing in the app is gated on a model being reachable.

That is deliberate: our users are offline often, and a feature that only works with a
working network is a feature that does not work.
