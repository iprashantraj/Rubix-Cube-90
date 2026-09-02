# Prototype 1 — 90 second cut

| | |
|---|---|
| Length | 90 s hard cap |
| Rendered MP4 | `renders/video.mp4` — silent. Lay the VO over it. |
| Visuals | Built as a HyperFrames composition in this folder. `STORYBOARD.md` is the frame plan. |
| VO language | Hindi primary, English subtitles burned in. Record both; ship Hindi. |
| Word budget | 212 words across 90 s — 141 wpm, a comfortable read with pauses at the cuts. Every beat is inside its own window; do not borrow time from the next one. |

**House rule for this cut:** nothing on screen that the repo cannot do today.
`white_balance()`, `tone()`, `denoise_sharpen()` and `/catalog/prefill` are unwritten —
they do not appear, and the VO never implies them. See `../README.md`.

---

## Beat sheet

| # | Time | Beat | On screen | VO |
|---|---|---|---|---|
| 1 | 0:00–0:06 | Title | PS ID + title card | PS number read out |
| 2 | 0:06–0:22 | Problem | The 52-week strip, then the three asks | Background |
| 3 | 0:22–0:30 | Solution | The phone arrives with /home on it | What we built |
| 4 | 0:30–0:44 | F1 Image | The gate refuses, then goes green; real cutout | Feature 1 |
| 5 | 0:44–0:57 | F2 Catalog | One Hindi sentence, four slots filled | Feature 2 |
| 6 | 0:57–1:08 | F3 Price | Cost floor, then the comparable band | Feature 3 |
| 7 | 1:08–1:23 | USP | Three cards, each with its mechanism | Why ours is different |
| 8 | 1:23–1:30 | Impact + close | ONDC live, then the end card | Close |

---

## Script

### 1 — Title (0:00–0:06)

**On screen (no VO under the first 2 s, let the card land):**

> **Problem Statement 26090**
> AI-Driven Market Linkage and Smart Cataloging Mobile Application for Marginalized Artisans
> Ministry of Social Justice and Empowerment · Heritage & Culture

**VO:** "Problem statement two-six-zero-nine-zero. Market linkage and smart cataloging, for
marginalized artisans."

### 2 — Problem (0:06–0:22)

**Shots:** crowded Shilp Samagam stall, hands finishing a weave — then the same stall struck
down, empty ground. Cut to a phone held at arm's length: a dark, cluttered photograph of a
product.

**VO:** "Schemes fund the loom. Melas sell the output — one week a year. The other
fifty-one, she is offline. The market wants a clean photograph, an English description, a
defensible price. In a language she does not have."

### 3 — Solution (0:22–0:30)

**Shots:** app home screen. Big tiles, no dense text. One tap into the camera.

**VO:** "So we built the business manager she cannot hire. One phone, one voice, one live
listing on a government marketplace."

### 4 — F1, the image (0:30–0:44)

**Shots:** live camera, screen-recorded on device. The frame is dark; a single spoken line
appears — **light first, one problem at a time**. Artisan turns to the window; the shutter
unlocks. Cut to the returned image: cut out, straightened, on white, at channel size.

**VO:** "The phone coaches the shot before it is taken — one instruction, spoken aloud,
light first. It never uploads a photograph the server would reject. Then the server removes the
background and cuts it to every channel's size."

### 5 — F2, the catalog (0:44–0:57)

**Shots:** artisan holds the mic button, speaks one Hindi sentence. Fields fill in behind —
material, technique, size — more than one from that single sentence. Cut to the finished
listing in Hindi and English side by side.

**VO:** "She describes it once, in her own language. One sentence fills four more fields
on its own. Out comes a listing in Hindi and English, trimmed to each marketplace's real
limits."

### 6 — F3, the price (0:57–1:08)

**Shots:** the price screen with the breakdown visible: material cost, hours × cluster wage
rate, channel MRP, comparables.

**VO:** "A price she can defend — her material cost, her hours at the cluster wage rate,
checked against comparable work. They may raise it, never below what the work cost her."

### 7 — USP (1:08–1:23)

**Shots:** three cards, one at a time, each with the app behind it.

> **Nothing invented.** No generative background. No super-resolution.
> **Every failure speaks.** Losing the AI never costs the listing.
> **Her colour, her consent.** Nothing publishes until she confirms it.

**VO:** "Three things. We never invent product detail — what ships is what she
photographed. Every failure speaks: if the model is down, the listing is still built from her
own answers. And nothing publishes until she confirms the colour."

### 8 — Impact and close (1:23–1:30)

**Shots:** listing live on the channel. Pull back to the artisan at her loom, phone down,
working.

**VO:** "Year-round income. Without a middleman, without a laptop, without a word of
English."

**End card:** team name · PS 26090 · Ministry of Social Justice and Empowerment

---

## Shot list — what has to be captured

| Shot | Source | Status |
|---|---|---|
| Mela crowd, struck stall | Must be filmed or licensed. No stock artisan we did not film. | ☐ |
| Camera gate, dark → unlock | Screen recording, real device, real `gate.js` | ☐ |
| Enhanced result | Real `/enhance` output. Colour is untouched — do not colour-grade it in the edit either | ☐ |
| Voice → fields filling | Real Hindi audio through `/catalog/interpret` + `/catalog/harvest` | ☐ |
| Price breakdown | Real `/price` response with a real material cost and hours | ☐ |
| Live listing | Real channel adapter output | ☐ |

## Do not put in this cut

- White balance, tone, denoise/sharpen — skipped in code today.
- `/catalog/prefill` — unwritten. The demo speaks first, it does not pre-fill from the photo.
- Anything offline. The app is online-first by decision (`docs/decisions.md`).
