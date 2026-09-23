---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Kaarigar turns one photo and one spoken sentence into a live marketplace listing — without inventing anything the artisan did not make"
destination: youtube
aspect: 1920x1080
language: en
length: 90s
angle: problem-then-proof
audience: SIH 2026 evaluation panel, Ministry of Social Justice and Empowerment
---

## Intent

The Smart India Hackathon submission film for problem statement 26090. Ninety seconds,
silent — the team records the Hindi voiceover separately and lays it over this cut, so the
render carries no narration and no music bed that would fight it.

Eight beats, timed exactly to `VOICEOVER.md`. The visuals must hold each beat for its full
window so the recorded read lands on the right picture: title card, the problem, the
solution line, then one beat each for the three PS features (image, catalog, price), then
the three USP cards, then the close.

Tone: government-submission serious, but not a slide deck. The app's own terracotta brand
carries it.

## Assets

- capture/screenshots/*.png — real screens from the running Kaarigar app (Vite dev server,
  mobile viewport, mocked API). These are the app beats; nothing here is a mockup.

## Customizations

- **Silent render.** No narration, no BGM (`music: none`, no project `SCRIPT.md`). The VO
  and any bed are added by the team in the edit.
- On-screen card text in English; the app screens show the real Hindi UI.
- Beat timings are fixed by `VOICEOVER.md` and may not drift — the voiceover is being
  recorded against them.

## Notes

- Repo house rules apply to this cut (`../README.md` and the project `CONTRIBUTING.md`):
  nothing on screen the repo cannot do today. `white_balance()`, `tone()`,
  `denoise_sharpen()` and `/catalog/prefill` are unwritten, so they never appear.
- No stock footage of an artisan we did not film. Beats 2 and 8 are therefore typographic
  and product-still, not people footage.
- `VOICEOVER.md` is the human voiceover script, not a HyperFrames `SCRIPT.md`. Do not
  rename it into place — its presence as `SCRIPT.md` would switch TTS on.
