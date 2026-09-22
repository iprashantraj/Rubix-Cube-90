# Speaker 3 — the workflow walk-through

One artisan, one product, start to finish. Clip `t=0` sits at **1:30** on the master
timeline. Runtime **68 s** (the script says 60 s for 151 words; at a conversational
2.2 words/sec it lands nearer 68 — trim from beats 2, 6 and 8 if the take comes in short).

The left rail is the Technical Approach flowchart, artisan path only, walked as a timeline.
The right stage is the real app. Three beats take the whole screen, then collapse back into
their rail node and the walk continues.

## Beats

| # | t (s) | Narration | Rail node | Stage |
|---|-------|-----------|-----------|-------|
| 1 | 0.0 – 3.5 | "Sunita makes clay matkas." | — (title) | Name card + `ILLUSTRATIVE` tag |
| 2 | 3.5 – 12.5 | "She logs in with the beneficiary ID she already has — verification routes to the existing government officer. No second identity system." | Login → Beneficiary ID? → ID Verification | Beneficiary-ID card; officer shown as a **routing destination**, never a screen |
| 3 | 12.5 – 22.0 | "She points her phone at the matka. Before she presses the button, the app checks blur, light and framing — and tells her out loud: *roshni mein laayein*, *phone sthir rakhein*." | Add New Product → Guided Capture | **FULL SCREEN** — `s3-camera-reject`, the real gate refusing: red ring, dead shutter |
| 4 | 22.0 – 30.0 | "Then it cleans the background and fixes the lighting. If the enhanced image isn't right, it makes her retake it." | Enhanced image good? **(decision + retry arc)** | `s3-capture-review` + before/after wipe |
| 5 | 30.0 – 39.5 | "Then she talks. The app reads her own sentence back and waits for a yes. It never guesses. 'Matka' stays 'matka'." | Voice catalogue | **FULL SCREEN** — `s3-voice-listening` → `s3-voice-heard` |
| 6 | 39.5 – 47.0 | "It suggests a price. She accepts." | AI dynamic pricing | `s3-price` — ₹1049 over floor ₹759 |
| 7 | 47.0 – 57.5 | "One tap — and the same catalogue goes out in seven marketplace formats. Where an API exists it's automatic; where it doesn't, the app hands her the exact text for the exact field." | SEO catalogue → One-tap listing → Marketplaces | **FULL SCREEN** — `s3-publish` + seven-format fan-out |
| 8 | 57.5 – 65.0 | "All of it on one database. An order lands. She tracks it from the same screen, and the price assistant learns from what sold." | Database → Order placed → Track order | `s3-home` — नए ऑर्डर 1 |
| 9 | 65.0 – 68.0 | "She typed nothing." | rail completes | Closing line |

## The three guards this section must not break

1. **No Government Dashboard on screen, ever.** It is not built. Verification *routes to*
   the officer; beat 2 shows that as an arrow leaving the artisan app, not as a screen.
   Speaker 4 states build status honestly sixty seconds later — this must not pre-empt it.
2. **`ILLUSTRATIVE` tag** the first time Sunita's name appears. Section 5 is real field
   work, so a judge will otherwise assume she is one of the three interviewees.
3. **No ONDC logo in the fan-out.** It is not a built channel. Beat 7 shows it as
   *mapped · dry run*, which is what `web/api/channels/ondc.py` actually returns.

## Where the screens came from

Every phone frame is the real app, driven by `capture/shoot_flow.py` — not a mock-up:

- a draft row's `resume()` seeds the in-memory draft, which is the only way in
- `/asr` is stubbed with her sentence, so the read-back is the app's own screen
- `/camera` gets a real frame via `--use-file-for-fake-video-capture`, so `gate.js`
  is genuinely measuring and genuinely refusing

`/orders` is **excluded**: it renders raw i18n keys (`order.state.placed`) and an
unsubstituted `{count} नग`. That is a real app bug — beat 8 uses `/home` instead.

## Icons

`lucide-react`, the same set `app/src/ui/icons.tsx` already pins. Not sourced from the web:
the app's own icon vocabulary is the consistency baseline, and matching it costs nothing.
