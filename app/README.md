# app/ — Artisan mobile app

React + Vite + Capacitor. Android first. **This folder is mobile only** — the admin
console, the marketplace and the API all live in `web/`.

Product spec: `../docs/Master-Technical-Reference.md`
Screens and build order: `../docs/Application-Architecture.md`
What is settled and why: `../docs/decisions.md`

---

## Toolchain

| Need | Version | Why |
|---|---|---|
| **JDK** | **21** | Capacitor 8 compiles at source level 21. JDK 17 fails with `invalid source release: 21` |
| Android SDK | 36 | `androidx.core:1.17` (pulled by the Capacitor plugins) requires compileSdk 36 |
| AGP / Gradle | 8.13.0 / 8.14.3 | Same dependency. The Capacitor template ships 8.7.2, which is too old |
| minSdk | 26 | Floor set by `@capacitor/inappbrowser`. Android 8.0 — below the target ₹7k phone anyway |

```bash
sudo apt install -y openjdk-21-jdk    # or any JDK 21
```

## Run

```bash
npm install
npm run dev            # http://localhost:5173, proxies /api -> localhost:8000
npm test               # camera gate self-check, no device needed
```

### On a device

The API must be reachable. A relative `/api` resolves into Capacitor's own bundled assets
on a device, so `client.js` no longer uses one there — a native build defaults to
`http://localhost:8000/api`, which is what `adb reverse` provides:

```bash
adb reverse tcp:8000 tcp:8000                       # device localhost:8000 -> your machine
npm run build
python3 tools/make_icons.py                         # only after `npx cap add android`
npx cap sync android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant in.gov.sih.kaarigar android.permission.CAMERA
adb shell pm grant in.gov.sih.kaarigar android.permission.RECORD_AUDIO
```

Set `VITE_API_BASE` (see `.env.example`) when the API is anywhere other than a
laptop-tethered `adb reverse` — a LAN box, staging, a tunnel.

#### Off the cable

`adb reverse` only holds while the USB cable does, which rules out handing the phone to
someone and letting them walk around with it. To run untethered, put the phone and the
laptop on the same WiFi and point the app at the laptop's LAN address instead of loopback:

```bash
ip -4 -o addr show scope global                     # or `ipconfig getifaddr en0` on macOS
echo 'VITE_API_BASE=http://<that-ip>:8000/api' > .env.local

cd ../web/api && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000   # not 127.0.0.1
```

Then rebuild — `VITE_API_BASE` is read at build time, so an edit to `.env.local` does not
reach an APK that is already installed:

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`ai/` does not need to be reachable from the phone. The app only ever talks to `web/api`,
which calls `ai/` on `localhost:8001` from the server side.

Two things that make this look like a broken app rather than a misconfigured one:

- **A stale IP.** DHCP reassigns the laptop's address and every request fails as
  `net.offline` — full signal, "no network". Re-check the IP before blaming anything else.
- **The host firewall.** `ufw`/`firewalld` will drop the phone's connection to :8000
  silently. `curl http://<that-ip>:8000/health` from another machine says which it is.

> **If the app says "no network" on a phone with full signal, this is why.** Every `fetch`
> failure becomes `net.offline`, and a request that 404s against the WebView's own assets
> fails exactly like an unreachable server. Check `adb reverse` is up and the API is
> actually running on `:8000` before looking anywhere else.

Cleartext to `localhost` is allowed by `android/app/src/main/res/xml/network_security_config.xml`
and **only** to loopback — nothing else on the network can reach it, so it cannot quietly
become a plaintext channel in the field.

The LAN case above needs more than loopback, so it gets its own config in
`android/app/src/debug/res/xml/`, which Gradle merges over `src/main/res` for the **debug
variant only**. `assembleRelease` still gets the loopback-only file, and the argument above
holds unchanged for anything that ships.

> Anything that calls the API must go through `apiUrl()` in `src/api/client.js`, including
> modules that use bare `fetch`. A hardcoded `'/api/...'` works in the browser and then
> 404s against the app's own assets on device.

> ⚠️ **The camera gate cannot be meaningfully tested in a desktop browser.** Framing
> assumes a product on a plain surface and the tilt check needs a real accelerometer.
> `vite.config.js` sets `server.host` so a phone on the same LAN can load the dev server —
> use that, not your laptop webcam.

## Layout

```
src/
  camera/
    gate.js            pure logic — 4 checks, priority ladder, hysteresis. Has its own tests
    useCameraGate.js   the frame loop: getUserMedia -> canvas -> gate -> gated shutter
    useTilt.js         accelerometer, smoothed
  voice/
    speak.js           TTS via Bhashini, cached, falls back to Web Speech
    listen.js          MediaRecorder -> server ASR; yes/no classifier
    useVoice.js        useSpeakOnEnter / useSpeakOnChange
  i18n/
    index.js           t(lang, key, vars)
    strings/           hi · en · or
  api/
    client.js          fetch wrapper, message_key errors, getThresholds()
    upload.js          resumable chunked upload + EXIF strip
  ui/
    kit.jsx            Screen · BigButton · YesNo · Tile · StatusDot · BottomNav
    styles.css         palettes, type scale, 56px minimum targets
    theme.js           the palette list + applyTheme()
    Mark.jsx           the Kaarigar mark (placeholder geometry)
    Splash.jsx         the opening loom animation
  screens/             24 screens
  routes.jsx           the route table + onboarding guard
  store.js             zustand: session (persisted) + draft (not)
tools/
  make_icons.py        launcher icons + native splash, rasterised from the mark
```

---

## Four rules this codebase enforces

Not style preferences. A screen that breaks one of these gets rejected in review.

1. **≤ 3 tappable things per screen.** Needs four? It is two screens.
2. **Every screen speaks on entry — once.** `<Screen prompt="...">` does it for you. Text is
   the fallback, never the default.

   Amended from "every time". A key is spoken the first time a route says it and is silent
   on repeat, because pressing three tab-bar buttons in ten seconds meant hearing
   "Products", "one moment", "you have no orders" read out again every single time, and a
   voice that repeats what you already know is one people learn to talk over. A key that
   *changes* is news and is still spoken — coming back to /orders after an order lands
   still announces it. The replay button always speaks. See `useSpeakOnEnter` in
   `voice/useVoice.js`.

   **Never announce the microphone before opening it.** `record()` resolves only once it is
   genuinely capturing and sounds a 140ms tone at that moment. Every voice screen used to
   `await say('voice.listening')` first, so the app claimed to be listening about a second
   before it was, and swallowed whatever the artisan said in reply to the question.
3. **Nothing is typed except the OTP.** Voice, tap, or camera.
4. **One problem at a time.** Never stack two errors. Applies to the camera gate *and* to
   forms.

---

## The camera gate

The single most important thing in this folder, and the thing most likely to be
accidentally broken by a well-meaning change.

**The phone's job is to STOP bad photos. The server's job is to BEAUTIFY good ones.**

The shutter is genuinely disabled while the frame is bad, and it fires itself once the
frame has held good for one second. The artisan does not need to understand any of the
checks — they move until the button lights up. Zero literacy required.

| Check | How | Note |
|---|---|---|
| Blur | Laplacian variance | Content-dependent. Plain white cloth scores "blurry" while being sharp — **suggestion only, never hard-blocks** |
| Light | 256-bucket histogram | Matters most. A blown-out white region contains no information and no AI recovers it |
| Framing | 12×9 grid variance | Detects *where something is happening*, not what the product is |
| Tilt | Accelerometer | Free — separate event stream, no image work |

### Do not raise `GATE_W` / `GATE_H`

`useCameraGate.js` runs every check on a **240×180 grayscale buffer**. This is not a
rough-and-ready shortcut, it is what makes the feature possible at all:

| Resolution | ms/frame (desktop) |
|---|---|
| **240×180** | **0.30** |
| 640×480 | 1.99 |
| 1920×1080 | 14.37 |

At full resolution the canvas readback alone drops you to ~2fps and the gate stops feeling
live. We are measuring the photo's *condition* — "is it dark", "is it blurry" — and that is
just as visible small.

### Thresholds are fetched, never bundled

`getThresholds()` reads `ai/thresholds.json` from the server. The app's camera gate and the
server's quality gate **must** read the same numbers — two copies drift, and then the phone
accepts photos the server rejects, which is the exact frustration the gate exists to
prevent. Recalibration is a JSON edit, not an app release rural users never install.

The corollary: **with the API down there is no gate, and the screen has to say so.** Opening
the lens and scoring the frames are two separate effects in `useCameraGate.js` for exactly
this reason — the preview comes up regardless, and a failed threshold fetch locks the
shutter behind a spoken message and a retry instead of a spinner that never ends.

⚠️ Current values are **guesses**. Calibrate on our own photos in `research/camera-thresholds/`.

---

## Theming

The app's colour is a setting. `/settings` offers four palettes; the choice persists with
the session and applies instantly.

The whole mechanism is `data-theme` on `<html>` plus five CSS variables:

```css
[data-theme='indigo'] {
  --accent: #2f4b8f;
  --accent-ink: #22376a;   /* accent-coloured TEXT — the bright accent fails AA at body size */
  --accent-soft: #e6ebf7;  /* tinted fill behind accent-ink */
  --surface-0: #f1f3f8;    /* the page, faintly tinted towards the accent */
  --line: #dde1ec;
}
```

To add one: paste that block into `src/ui/styles.css` with new values, add
`{ id, labelKey }` to `THEMES` in `src/ui/theme.js`, and add the label to
`src/i18n/strings/_new_ui.json`. Nothing else — no component knows a colour.

⚠️ **Check the contrast before you add a palette, do not pick by eye.** Accent on white,
accent on its own `--surface-0`, and `-ink` on `-soft` all have to clear WCAG AA (4.5:1).
The shipped four sit between 5.6:1 and 10.4:1. Our users are outdoors, in glare, on cracked
screens, and there is no way to warn someone about a contrast ratio when the premise is
that they cannot read the warning.

Two things follow the palette by reading it back out of the stylesheet rather than keeping
a second copy of the hex — the native status bar (`App.jsx`) and the browser
`theme-color`. The launcher icon and the native splash **cannot** follow it: Android caches
both at install time, so `tools/make_icons.py` always renders the default palette.

### The mark and the splash

`src/ui/Mark.jsx` is the app mark — an ikat lozenge woven from a warp and a weft, with one
thread lifting clear of the cloth. **It is deliberate placeholder geometry, not an
identity**, and it exists because the app was shipping the stock Capacitor logo. It lives in
exactly two places, `Mark.jsx` and `tools/make_icons.py`, so replacing it is one path and
one command.

`src/ui/Splash.jsx` animates a loom threading itself, then the motif, then the wordmark —
about 2.1s, fixed. It is **not** a loading screen: nothing is fetched there, the router is
mounted behind it the whole time, and it must never grow a dependency on the network.

```bash
python3 tools/make_icons.py           # 26 rasters -> android/app/src/main/res
python3 tools/make_icons.py --check    # render to /tmp and print sizes, touch nothing
```

Re-run it after `npx cap add android` — `android/` is gitignored, and Capacitor restores
its own logo whenever it regenerates the native project.

---

## Privacy rules that live in this folder

- **EXIF is stripped before upload** (`api/upload.js`). An artisan's home GPS must never
  reach a public listing. We re-encode through a canvas rather than editing tags — no
  parser to keep correct, no field we forgot.
- **Readiness is booleans.** `has_pan: true` — never the number. Nothing in `store.js`
  holds a document value, and nothing should.
- **We never ask for a platform password.** OAuth redirect only. A demo that shows
  "enter your Amazon password" is a disqualification-level flaw.
- **No `AccessibilityService`.** Not now, not as a stretch goal. See
  `../docs/Application-Architecture.md` §6.3 for why it would get the app suspended.

---

## Online-first

There is **no offline queue, no local database, and no sync engine** — this reverses the
v1 spec, see `../docs/decisions.md`. Network handling is exactly two things:

- resumable chunked upload with retry and backoff (`api/upload.js`)
- a **spoken** failure message, never a silent spinner (`App.jsx`)

Every AI feature is a server call anyway. Offline capture without offline inference gets
the artisan a photo and nothing else.

---

## Adding a language

1. `src/i18n/strings/<code>.json`
2. one row in `LANGUAGES` in `src/i18n/index.js`

Nothing else. Missing keys fall back to English rather than rendering blank.

> **Do not machine-translate a file and ship it.** A wrong instruction spoken confidently
> to someone who cannot read the screen is worse than an English one they ignore. Pipeline
> is: Bhashini drafts → native speaker reviews → key lands in the file. `or.json` is
> deliberately partial for this reason.

---

## Status

| Area | State |
|---|---|
| Camera gate logic + tests | ✅ 19 assertions |
| Frame loop, tilt, gated shutter, burst-and-pick | ✅ **verified on a real device** |
| Onboarding: `/lang` `/consent` `/auth` | ✅ walked end to end on device |
| Routing, guard, store, UI kit, i18n | ✅ |
| Voice layer | 🟡 client done, falls back to Web Speech; needs Bhashini keys |
| 19 of 24 screens | 🔴 stubs — real: `LangPick` `Consent` `Auth` `Camera` `Publish` |
| Threshold calibration | 🔴 blocking, `research/camera-thresholds/` |

Verified on a Motorola Edge 60 Stylus (Android 16 / API 36): language picker →
Hindi DPDP consent → phone+OTP against the live API over `adb reverse` → live camera gate
showing a red ring, a single spoken instruction, and a disabled shutter.
