---
format: 1920x1080
duration: 90s
message: "Kaarigar turns one photo and one spoken sentence into a live marketplace listing — without inventing anything the artisan did not make"
arc: "Problem statement → the 51 weeks offline → the app → three features → three promises → live"
audience: "SIH 2026 evaluation panel, Ministry of Social Justice and Empowerment"
mode: autonomous
music: none
---

## Video direction

**The look.** `code-editorial`, remixed onto the app's own palette: cream `#f8f3f1` paper,
ink `#1c1917`, terracotta `#9c3d24` as the single voltage colour, and the app's green
`#1f9d55` reserved for exactly two things — the camera gate turning green and a channel
reporting live. Never decorative, never a third accent. EB Garamond display, Inter body,
JetBrains Mono chrome.

**The device.** Every app screen appears inside the same phone shell — 1125×2436 plate,
drawn at 470×1018 in frame, ink hairline, 44px radius, one soft warm shadow. It sits at the
same x in frames 3–6 so the app reads as one continuous thing rather than six screenshots.

**Motion doctrine.** Slow, editorial, no bounce. Text arrives by mask-up (`clip-path` reveal
from the baseline) at 0.5–0.7s, `power3.out`. The phone arrives once, in frame 3, and then
only its screen changes — never re-animate the shell. Hairline rules draw left-to-right.
Nothing loops, nothing pulses, nothing spins.

**The silence is deliberate.** There is no narration and no music track. The team records
the Hindi voiceover to `VOICEOVER.md` and lays it over this cut, so every frame's duration
is fixed to that script's beat and must not drift.

**Honesty constraints, from the repo's own house rules.** No white balance, tone or
denoise/sharpen appears anywhere — those functions are unwritten. No `/catalog/prefill`.
The before/after in frame 4 is a real BiRefNet result from `research/segmentation/`, not an
illustration of one. Every Hindi string is the app's own.

---

## Frame 1 — Problem statement card

- status: animated
- src: compositions/frames/01-title.html
- duration: 6s
- transition_in: cut
- scene: The PS number lands as a headline; the title and the ministry sit under it.
- voiceover: "Problem statement two-six-zero-nine-zero. Market linkage and smart cataloging, for marginalized artisans."
- asset_candidates: none — typographic

Cream field, generous left margin at `slide-pad`. Mono kicker top-left, `✱ SMART INDIA
HACKATHON · PROBLEM STATEMENT`. Under it the number **26090** at `display-cover`, terracotta,
the only voltage in the frame. Under that, the full PS title at `headline` in ink, two
lines, sentence case. A hairline rule, then two mono lines: `MINISTRY OF SOCIAL JUSTICE AND
EMPOWERMENT` / `CATEGORY: SOFTWARE · THEME: HERITAGE & CULTURE`.

- 0.0–0.5s — kicker fades up in place.
- 0.5–1.4s — `26090` mask-up from the baseline, per-glyph stagger 0.05s.
- 1.4–2.4s — title lines mask-up, 0.18s apart.
- 2.4–3.0s — rule draws left to right; ministry lines fade in behind it.
- 3.0–6.0s — held. Nothing moves. The card is being read aloud.

## Frame 2 — Fifty-one weeks offline

- status: animated
- src: compositions/frames/02-problem.html
- duration: 16s
- transition_in: crossfade
- scene: A 52-week year strip with one terracotta cell; then the three things the market asks for.
- voiceover: "Schemes fund the loom. Melas sell the output — one week a year. The other fifty-one, she is offline. The market wants a clean photograph, an English description, a defensible price. In a language she does not have."
- asset_candidates: none — typographic + data

Two movements in one frame, and the second must not start before the voice reaches it.

**Movement A (0–7s) — the year.** A single row of 52 squares across the frame, 18px, 8px
gaps, ink at 12%. One square — week 9, Surajkund — fills terracotta. Above: `display`
"One week a year." Below the strip, `lead` in muted ink: "the mela. The other fifty-one, she
is offline."

- 0.0–0.8s — the 52 cells fade in as one block, no stagger (they are a mass, not a list).
- 0.8–1.4s — one cell fills terracotta and lifts 4px.
- 1.4–2.2s — "One week a year." mask-up.
- 2.2–3.0s — the line beneath fades in.

**Movement B (7–15s) — what the market asks for.** The strip shrinks to a quarter-scale
marker at the top; three `card-hairline` rows stack under it, each a mono label and an ink
line: `A CLEAN PHOTOGRAPH` / `AN ENGLISH DESCRIPTION` / `A DEFENSIBLE PRICE`. A terracotta
rule under the third, then one line at `lead`: "in a language and a literacy she does not
have."

- 7.6–8.3s — the strip scales down and moves up; the three rows are not yet present.
- 8.4, 9.2, 10.0s — the rows mask-up in turn, 0.55s each.
- 11.2–12.0s — the closing line fades in under a terracotta rule.
- 12.0–16.0s — held.

## Frame 3 — The app

- status: animated
- src: compositions/frames/03-solution.html
- duration: 8s
- transition_in: cut
- scene: The phone arrives with /home on it; one line names what the app is.
- voiceover: "So we built the business manager she cannot hire. One phone, one voice, one live listing on a government marketplace."
- asset_candidates: assets/shots/01-home.png

Phone shell enters from the right third and settles at x=1180. Left column: mono kicker
`✱ KAARIGAR`, then at `display` — "The business manager she cannot hire." Under it, three
mono chips on one row: `ONE PHONE` · `ONE VOICE` · `NO ENGLISH`.

- 0.0–1.0s — phone rises 60px and fades in, `power3.out`. It will not move again until frame 8.
- 0.6–1.5s — headline mask-up, two lines.
- 1.8–2.4s — the three chips fade in 0.12s apart.
- 2.4–8.0s — held.

## Frame 4 — The photograph

- status: animated
- src: compositions/frames/04-image.html
- duration: 14s
- transition_in: cut
- scene: The gate refuses a dim frame, then goes green; beside it a real cutout replaces a real photograph.
- voiceover: "The phone coaches the shot before it is taken — one instruction, spoken aloud, light first. It never uploads a photograph the server would reject. Then the server removes the background and cuts it to every channel's size."
- asset_candidates: assets/shots/02-camera-dark.png, assets/shots/03-camera-green.png, assets/pot-original.png, assets/pot-cutout.png
- handoff_in: phone shell — x 1180, y 31, scale 1, opacity 1, static (continues from frame 3)

The phone holds its position from frame 3 and only its screen changes. Left column carries
the two claims in sequence, each with its own proof beside it.

- 0.0–3.0s — screen shows `02-camera-dark.png`. Left: mono label `ON THE PHONE`, then at
  `headline` "It coaches the shot before it is taken." A terracotta callout pill under it
  reads `रोशनी में लाएं — bring it into the light`, which is the app's own string.
- 3.0–3.5s — the screen crossfades to `03-camera-green.png`; the ring colour is the only
  thing that changes in the plate, so the cut reads as the gate deciding. The callout pill
  swaps to the app green and reads `shutter armed`.
- 4.5–5.2s — the left column clears.
- 5.2–6.0s — mono label `ON THE SERVER`, headline "Then the server does the work."
- 6.0–9.5s — the before/after: `pot-original.png` sits at 460×460 with a hairline border and
  a mono caption `AS PHOTOGRAPHED`; a terracotta wipe travels left-to-right across it and
  leaves `pot-cutout.png` behind, caption `AS LISTED`. One wipe, 1.1s, `power2.inOut`.
- 9.5–10.3s — three mono chips fade in beneath: `BACKGROUND REMOVED` · `FRAMED` · `EVERY
  CHANNEL'S SIZE`.
- 10.3–14.0s — held.

## Frame 5 — The sentence

- status: animated
- src: compositions/frames/05-catalog.html
- duration: 13s
- transition_in: cut
- scene: One Hindi sentence on screen; four field chips separate out of it; the listing lands in both languages.
- voiceover: "She describes it once, in her own language. One sentence fills four more fields on its own. Out comes a listing in Hindi and English, trimmed to each marketplace's real limits."
- asset_candidates: assets/shots/06-voice-heard.png
- handoff_in: phone shell — x 1180, y 31, scale 1, opacity 1, static

Phone screen is `06-voice-heard.png` for the whole frame — the transcript is legible on the
plate itself, which is the point.

- 0.0–1.2s — the sentence appears left as a `pull-quote` in Devanagari, the app's own
  transcript: "यह मिट्टी की सुराही है, हाथ से बनी, अजमेर की, दो लीटर की".
- 2.0–4.4s — four `card-hairline` chips separate downward out of the quote, 0.3s apart, each
  a mono field name and its harvested value: `MATERIAL मिट्टी` · `SIZE 2 लीटर` ·
  `TIME दो दिन` · `SPECIAL हाथ से बनी, अजमेर की`. A hairline connector draws from the
  quote to each chip as it lands.
- 4.6–5.4s — a mono line under them: `ONE ANSWER · FOUR SLOTS FILLED`.
- 6.4–8.6s — the chips fade to 25% and the finished listing rises in their place: the Hindi
  title over the English title, both at `card-title`, with a mono caption
  `TRIMMED TO EACH CHANNEL'S LIMIT · GeM 200 · ONDC 100`.
- 8.6–13.0s — held.

## Frame 6 — The price

- status: animated
- src: compositions/frames/06-price.html
- duration: 11s
- transition_in: cut
- scene: The price is built up from her costs, then checked against the market — never below the floor.
- voiceover: "A price she can defend — her material cost, her hours at the cluster wage rate, checked against comparable work. They may raise it, never below what the work cost her."
- asset_candidates: assets/shots/08-price.png
- handoff_in: phone shell — x 1180, y 31, scale 1, opacity 1, static

Phone screen is `08-price.png`. Left column is the arithmetic, drawn as it is spoken.

- 0.0–2.4s — three rows count up in place, 0.6s apart, mono label + `number-unit` figure:
  `MATERIAL ₹380` · `LABOUR ₹640` · `MARGIN ₹160`. Each figure counts from 0 with
  `snap: 1` so no fractional rupee is ever on screen.
- 2.4–3.2s — a hairline rule draws under them and `FLOOR ₹1180` lands at `number-hero`.
- 3.6–5.4s — a horizontal band draws from ₹1300 to ₹2100 in ink at 12%, captioned
  `COMPARABLE WORK`. The floor marker sits below its left end.
- 5.4–6.4s — `₹1450` lands on the band in terracotta at `number-hero`, with the mono caption
  `SUGGESTED`.
- 6.4–7.2s — one line at `lead`: "Comparables may raise it. Never below what the work cost her."
- 7.2–11.0s — held.

## Frame 7 — Three promises

- status: animated
- src: compositions/frames/07-usp.html
- duration: 15s
- transition_in: crossfade
- scene: The three rules the build actually enforces, each with the mechanism that enforces it.
- voiceover: "Three things. We never invent product detail — what ships is what she photographed, or she takes the return. Every failure speaks: if the model is down, the listing is still built from her own answers. And nothing publishes until the person holding the object confirms the colour is true."
- asset_candidates: assets/shots/05-colour-confirm.png
- handoff_out: phone shell — leaves at 12.2s, fading to opacity 0 over 0.8s

Three `card-hairline` cards on a row, each 520px wide. Card head at `card-title`, body at
`body`, and a mono proof line at the foot in terracotta — the mechanism, not the promise.

1. **Nothing is invented.** No generative background. No super-resolution. What ships is
   what she photographed. — `NO DIFFUSION IN THE PIPELINE`
2. **Every failure speaks.** If the model is unreachable the listing is still built, from
   her own answers, and says so. — `compose_fallback · confidence: 0`
3. **Her colour, her consent.** Correcting light moves colour, so nothing publishes until
   the person holding the object confirms it. — `colour_confirmed · the publish gate`

- 0.0–0.7s, 1.6–2.3s, 3.2–3.9s — the cards mask-up in turn.
- Each card's mono proof line fades in 0.35s after its own card settles.
- 6.0–7.0s — the phone returns at the right edge, screen `05-colour-confirm.png`, at 0.72
  scale, so promise three has the actual screen beside it.
- 7.0–12.2s — held. 12.2–13.0s — the phone fades out.
- 13.0–15.0s — the three cards hold alone.

## Frame 8 — Live

- status: animated
- src: compositions/frames/08-close.html
- duration: 7s
- transition_in: cut
- scene: The listing is live on ONDC; the card resolves to the app name and the ministry.
- voiceover: "Year-round income. Without a middleman, without a laptop, without a word of English."
- asset_candidates: assets/shots/10-publish-live.png

- 0.0–2.6s — `10-publish-live.png` fills a 560×1212 plate centre-left, the app's own
  `ONDC · अभी लाइव है` visible on it. One line at `headline` to its right: "Live on a
  government marketplace." The word *live* is the frame's only green.
- 2.6–3.4s — the plate fades to 12% and slides behind the end card.
- 3.4–4.4s — end card: `KAARIGAR` at `display-cover` in terracotta, a hairline rule, then
  two mono lines — `PROBLEM STATEMENT 26090 · AI-DRIVEN MARKET LINKAGE AND SMART CATALOGING`
  and `MINISTRY OF SOCIAL JUSTICE AND EMPOWERMENT`.
- 4.4–7.0s — held. The last frame is the end card, still — no fade to black.
