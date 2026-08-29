# video/

Scripts, shot lists and assets for the SIH demo videos. One folder per prototype cut.

| Folder | What | Length |
|---|---|---|
| `prototype-1/` | First submission cut — problem statement, solution, three features, USP | 90 s |

Rendered MP4s and raw screen recordings are **not** committed. Keep them in Drive and put
the link in the prototype's `SCRIPT.md` header.

House rules for every cut:

- Nothing on screen that the repo cannot actually do today. If a stage is skipped in code,
  it is not in the video. `docs/Abhay/CHANGELOG.md` is the source of truth for what works.
- Real artisan-facing copy in the UI shots, real regional-language audio for the voice
  feature. No Lorem Ipsum, no English-only screens where the app speaks Hindi.
- No stock footage of an artisan we did not film or licence.

## Rebuilding a cut

Each prototype folder is a HyperFrames project — the video is HTML, rendered to MP4.

```bash
cd video/prototype-1
npx hyperframes check      # lint + layout + contrast, must be clean before a render
npx hyperframes render --quality high --output renders/video.mp4
```

The app screens in `assets/shots/` were captured from the real app, not mocked up: run
`npm --prefix app run dev`, drive the screens in a 375×812 browser with the API stubbed,
snapshot the DOM to `assets/screens/*.html`, and render those to PNG with headless Chrome.
Re-capture whenever a screen's copy or layout changes — the video should never show a
screen the app no longer has.
