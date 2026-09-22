#!/usr/bin/env python3
"""Shoot the mid-flow artisan screens — the ones Speaker 3 actually narrates.

Those screens (/capture/review, /catalog/voice, /catalog/review, /price, /publish) read
`useDraft`, which is in-memory and NOT persisted: seeding localStorage cannot reach it, so
the first pass at this only ever produced the camera's "कैमरा नहीं खुला" error state.

Two things make it work without touching app code:

  1. `Products.tsx` sends a DRAFT row (no title) through `resume(p)` and into
     /catalog/voice. Clicking that row is what seeds the draft, photo and all.
  2. Once seeded, `history.pushState` + a synthetic `popstate` moves React Router
     client-side. A normal navigation would reload the bundle and wipe the draft;
     this keeps it.

/camera needs a real frame or the gate has nothing to measure, so Chrome is given one:
`--use-file-for-fake-video-capture` with a y4m built from this repo's own fixtures. The
well-lit pot arms the shutter; `gate-dark-vase.png` is the frame `images/MANIFEST.md`
keeps precisely because the gate should refuse it.

    npm --prefix app run build
    npm --prefix app run preview -- --port 5199 &
    ai/.venv/bin/python video/prototype-1/capture/shoot_flow.py --out <dir> --feed good
"""

import argparse
import asyncio
import base64
import json
import pathlib
import subprocess
import sys
import urllib.request

import websockets

HERE = pathlib.Path(__file__).parent
CHROME = (HERE / "../../motion/node_modules/.remotion/chrome-headless-shell/linux64/"
                 "chrome-headless-shell-linux64/chrome-headless-shell").resolve()

# ⚠️ The camera gate's numbers, from the one file both gates read (CLAUDE.md: never a second
# copy). Served rather than defaulted because `{}` is NOT a harmless answer here:
# `refreshThresholds()` overwrites the bundled copy with whatever /thresholds returns, and
# `GateState`'s commit test is `now - since >= t.state_hold_seconds * 1000`, which is
# `>= NaN` — false forever. The gate then never leaves the red `photo.too_dark` it starts on,
# no matter how good the frame is, and /camera photographs as a refusal with a perfectly
# well-lit pot in the viewfinder.
THRESHOLDS = json.loads((HERE / "../../../ai/thresholds.json").resolve().read_text())

WIDTH, HEIGHT, SCALE = 375, 812, 3
ORIGIN = "http://127.0.0.1:5199"

# The draft row is FIRST and has no title — `isDraft()` in screens/homeTodos.js keys off
# exactly that, and it is what routes the click into the interview instead of the detail
# page. Its image is the photo the rest of the video uses, so the same pot follows Sunita
# through every screen.
FIXTURES = {
    "/thresholds": THRESHOLDS,
    "/products": [
        {"id": "d1", "title": None, "image": f"{ORIGIN}/__shot-pot.png",
         "price": None, "colour_confirmed": False},
        {"id": "p1", "title": "हस्तनिर्मित मिट्टी की सुराही, 2 लीटर — अजमेर",
         "image": f"{ORIGIN}/__shot-pot.png", "price": 1049, "colour_confirmed": True},
        {"id": "p2", "title": "बांधनी दुपट्टा, लाल — कच्छ",
         "image": f"{ORIGIN}/__shot-saree.png", "price": 2400, "colour_confirmed": False},
    ],
    "/orders": [
        {"id": "o1", "state": "placed", "amount": 1049, "quantity": 1, "channel": "Hamara Bazaar",
         "artisan_confirmed_payment": False},
        {"id": "o2", "state": "delivered", "amount": 1049, "quantity": 1, "channel": "Amazon",
         "artisan_confirmed_payment": True, "payment_state": "settled"},
    ],
    "/channels": [
        {"id": "marketplace", "name": "Hamara Bazaar", "tier": "A", "connected": True},
        {"id": "ondc", "name": "ONDC", "tier": "A", "connected": True},
        {"id": "gem", "name": "GeM", "tier": "C", "signup_status": "registered"},
        {"id": "amazon", "name": "Amazon", "tier": "B", "connected": True},
        {"id": "flipkart", "name": "Flipkart", "tier": "B", "connected": False},
        {"id": "meesho", "name": "Meesho", "tier": "D", "signup_status": None},
        {"id": "whatsapp", "name": "WhatsApp", "tier": "D", "signup_status": None},
    ],
    "/me": {"display_name": "सुनीता देवी", "craft": "pottery", "pincode": "305001",
            "language": "hi", "has_pan": True, "has_bank": True,
            "has_gst": False, "has_artisan_card": True},
    # POST bodies. /price is ai/price/compute.py quote(180, 4, "sambalpur", "gem") verbatim,
    # so the screen and the price scene in the video cannot disagree.
    "/price": {
        "floor": 759, "suggested_price": 1049, "mrp": 1166,
        "market_range": {"low": 799.0, "high": 1299.0, "sample_size": 11},
        "below_floor_warning": False,
        "breakdown": {"material": 180, "labour": 480, "margin": 99,
                      "note": "mrp is set so the price still clears the floor after GEM's 10% mandated discount"},
        "breakdown_voice_hi": "180 रुपये का सामान, 4 घंटे का काम। 1049 रुपये सही रहेगा।",
    },
    "/catalog": {
        "title": "हस्तनिर्मित मिट्टी की सुराही, 2 लीटर — अजमेर",
        "desc_hi": "अजमेर, राजस्थान की हाथ से बनी मिट्टी की सुराही। दो लीटर। बिना ग्लेज़ वाली मिट्टी पानी को प्राकृतिक रूप से ठंडा रखती है।",
        "desc_en": "A hand-thrown terracotta matka from Ajmer, Rajasthan. Two litres.",
        "keywords": ["terracotta matka", "clay water pot", "handmade pottery"],
        "confidence": 0.9,
    },
    "/catalog/harvest": {"slots": {"material": "मिट्टी", "size": "2 लीटर",
                                   "origin": "अजमेर", "time": "दो दिन"}},
    "/catalog/defaults": {},
    # The app posts the recorded clip here. Returning her sentence is what makes the
    # read-back screen ("हम यही लिखेंगे। क्या यह सही है?") appear through the real path.
    "/asr": [
        "यह मिट्टी की सुराही है, हाथ से बनी, अजमेर की, दो लीटर की",
        "गर्मियों में पानी ठंडा रखती है, बिना ग्लेज़ के",
        "सुराही",
        "मिट्टी",
        "दो लीटर",
        "दो दिन",
        "हाँ",
    ],
}

STUB_JS = r"""
(() => {
  const FIX = __FIXTURES__;
  const never = () => new Promise(() => {});

  const pick = (url, method) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '').split('?')[0];
    if (path === '/asr') {
      const list = FIX['/asr'];
      const t = list[Math.min(window.__asrN = (window.__asrN ?? -1) + 1, list.length - 1)];
      return {transcript: t, confidence: 0.94};
    }
    /*
     * The upload path, which /capture/review's accept button walks in full.
     *
     * Method matters here and nowhere else: `/products` is a LIST on GET and a create on
     * POST, and answering the create with the list hands CaptureReview `id: undefined`,
     * which it then puts in the url of every call after it. `pick` used to ignore the
     * method entirely, which is fine for read-only screens and wrong the moment a screen
     * writes something.
     */
    if (path === '/uploads' && method === 'POST') return {upload_id: 'u1'};
    if (/^\/uploads\/[^/]+\/chunk\/\d+$/.test(path)) return {};
    if (/^\/uploads\/[^/]+\/complete$/.test(path)) return {url: FIX['/products'][0].image};
    if (path === '/products' && method === 'POST') return {id: 'd1'};
    if (/^\/products\/[^/]+\/images$/.test(path)) return {};
    if (/^\/products\/[^/]+\/enhance$/.test(path)) return {job_id: 'j1', status: 'queued'};

    if (path in FIX) return FIX[path];
    const m = /^\/products\/([^/]+)$/.exec(path);
    if (m) return FIX['/products'].find((p) => p.id === m[1]) ?? {};
    if (path === '/me/gst-route') return {route: 'enrolment_only', voice_key: 'gst.enrolment_only'};
    if (path.startsWith('/publish')) {
      return {id: 'job1', status: 'done', results: [
        {channel: 'marketplace', status: 'live', url: 'https://hamarabazaar.in/p/d1'},
        {channel: 'gem', status: 'file_ready'},
        {channel: 'amazon', status: 'live'},
        {channel: 'meesho', status: 'needs_help'}]};
    }
    return {};
  };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(location.origin) && !url.includes('/api/')) return real(input, init);
    const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method) ?? 'GET')
      .toUpperCase();
    /*
     * Freeze the upload on its last call, to photograph the screen mid-send.
     *
     * The captured frame is a ~50KB JPEG, which is one 256KB chunk — so the chunk loop
     * finishes in one round trip and `onProgress` has only ever reported 0 or 1. There is
     * no honest way to show 45% here without making the photograph bigger than the camera
     * actually produces, so we hold `complete` instead: the bytes are up, the ring reads
     * 100%, and the prompt is still `capture.uploading` because that is genuinely the state
     * the app is in while it waits for the server to answer.
     *
     * Hanging rather than erroring on purpose — a rejected promise takes the screen to its
     * `capture.failed` branch, which is a different screenshot.
     */
    if (window.__hangComplete && /\/uploads\/[^/]+\/complete$/.test(String(url))) return never();
    return new Response(JSON.stringify(pick(url, method)),
      {status: 200, headers: {'content-type': 'application/json'}});
  };
})();
"""


class CDP:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def send(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expr):
        res = await self.send("Runtime.evaluate", expression=expr,
                              returnByValue=True, awaitPromise=True)
        return res.get("result", {}).get("value")

    async def shot(self, path):
        data = await self.send("Page.captureScreenshot", format="png",
                               captureBeyondViewport=False)
        path.write_bytes(base64.b64decode(data["data"]))
        print(f"  {path.name:26} {path.stat().st_size // 1024} kB")


async def settle(cdp, ms=1400):
    await asyncio.sleep(ms / 1000)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--feed", choices=["good", "dark", "bright"], default="good")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    feed = (HERE / "feeds" / f"{args.feed}.y4m").resolve()
    proc = subprocess.Popen(
        [str(CHROME), "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         "--remote-debugging-port=9225", "--remote-allow-origins=*",
         "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
         f"--use-file-for-fake-video-capture={feed}",
         "--host-resolver-rules=MAP 10.169.219.181 127.0.0.1, MAP 10.42.0.1 127.0.0.1",
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        target = None
        for _ in range(40):
            await asyncio.sleep(0.25)
            try:
                with urllib.request.urlopen("http://127.0.0.1:9225/json/list", timeout=1) as r:
                    pages = [t for t in json.load(r) if t.get("type") == "page"]
                if pages:
                    target = pages[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                continue
        if not target:
            sys.exit("chrome never came up on :9225")

        async with websockets.connect(target, max_size=64 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.send("Page.enable")
            await cdp.send("Runtime.enable")
            await cdp.send("Emulation.setDeviceMetricsOverride",
                           width=WIDTH, height=HEIGHT, deviceScaleFactor=SCALE, mobile=True)
            await cdp.send("Page.addScriptToEvaluateOnNewDocument",
                           source=STUB_JS.replace("__FIXTURES__",
                                                  json.dumps(FIXTURES, ensure_ascii=False)))

            # ── the camera, with a real frame in front of it ──────────────────────
            #
            # Polled, not slept. A well-lit frame does not sit at green waiting to be
            # photographed: `shouldAutoCapture` fires about a second after green commits,
            # because pressing a button shakes the phone. So a fixed 4s wait lands on
            # /capture/review every time and photographs the wrong screen — which is what
            # it did, and the shot looked like a gate refusal because before the
            # /thresholds fix the gate never armed at all and never auto-fired either.
            #
            # `cam__ring--ok` is the class `isGreen` puts on the viewfinder ring, so this
            # waits for the app's own verdict rather than for a duration.
            #
            # It takes TWO visits to /camera to photograph one. The splash is a sibling
            # overlay of the router rather than part of a route, so on a cold load it is
            # still painted over the viewfinder for the whole of the green window — wait
            # for the splash and the auto-capture has already fired, shoot before it and
            # you photograph the launch animation. So: let the first visit run its course,
            # then re-enter /camera inside the same document, where the gate re-arms
            # against the same feed and there is no splash left to sit through.
            await cdp.send("Page.navigate", url=f"{ORIGIN}/__seed.html?to=/camera")
            for _ in range(60):
                await asyncio.sleep(0.15)
                if not await cdp.js("!!document.querySelector('.splash')"):
                    break
            await cdp.js(
                "(() => { history.pushState({}, '', '/camera');"
                " window.dispatchEvent(new PopStateEvent('popstate')); return 1; })()")
            for _ in range(60):
                await asyncio.sleep(0.12)
                if await cdp.js("!!document.querySelector('.cam__ring--ok')"):
                    break
            print(f"  camera armed on {await cdp.js('location.pathname')}")
            await cdp.shot(args.out / f"cam-{args.feed}.png")

            # ── seed the draft the only way the app allows: tap a draft row ───────
            await cdp.send("Page.navigate", url=f"{ORIGIN}/__seed.html?to=/products")
            await settle(cdp, 2200)
            tapped = await cdp.js(
                "(() => { const b = document.querySelectorAll('button.chan');"
                " if (!b.length) return 'no rows'; b[0].click(); return 'ok'; })()")
            await settle(cdp, 2200)
            where = await cdp.js("location.pathname")
            print(f"  draft row tap: {tapped} -> {where}")
            if where != "/catalog/voice":
                print("  !! draft did not seed; later screens will be wrong", file=sys.stderr)
            await cdp.shot(args.out / "voice-listening.png")

            # Stop the recording the screen auto-started; the stubbed /asr answers and
            # the app moves itself to the read-back phase.
            await cdp.js("""
              (() => { const m = document.querySelector('button.mic, .mic button, button[class*=mic]');
                       if (m) { m.click(); return 'ok'; }
                       const b = [...document.querySelectorAll('button')]
                         .find((x) => x.querySelector('svg') && x.offsetHeight > 80);
                       if (b) { b.click(); return 'fallback'; } return 'none'; })()
            """)
            await settle(cdp, 2600)
            await cdp.shot(args.out / "voice-heard.png")

            # ── answer every question through the real screen ───────────────────
            # Each question auto-starts the mic; stopping it posts to the stubbed /asr,
            # which puts the screen in its read-back phase. "आगे" accepts. Repeat until
            # CatalogVoice decides the plan is answered and routes itself onward.
            for step in range(14):
                if await cdp.js("location.pathname") != "/catalog/voice":
                    break
                moved = await cdp.js("""
                  (() => {
                    const byText = (t) => [...document.querySelectorAll('button')]
                      .find((b) => !b.disabled && b.textContent.includes(t));
                    const next = byText('आगे');
                    if (next) { next.click(); return 'next'; }
                    const big = [...document.querySelectorAll('button')]
                      .find((b) => b.querySelector('svg') && b.offsetHeight > 80);
                    if (big) { big.click(); return 'stop-rec'; }
                    return 'stuck';
                  })()
                """)
                if moved == "stuck":
                    print(f"  interview stuck at step {step}")
                    break
                await settle(cdp, 2000)
            print(f"  interview ended on {await cdp.js('location.pathname')}")
            await cdp.shot(args.out / "catalog-review.png")

            # ── accept the catalogue, which is also the only way onto /price ──────
            # Pressed rather than pushState'd: CatalogReview.accept() is what writes the
            # finished listing — title included — onto the draft, and /price now shows the
            # title beside the price. Arriving by pushState renders the price against a
            # listing that was never committed, so the strip has no name in it.
            accepted = await cdp.js(
                "(() => { const b = [...document.querySelectorAll('button')]"
                ".find((x) => !x.disabled && x.textContent.includes('हाँ, सही है'));"
                " if (!b) return 'no accept button'; b.click(); return 'ok'; })()")
            await settle(cdp, 2600)
            print(f"  catalogue accept: {accepted} -> {await cdp.js('location.pathname')}")
            await cdp.shot(args.out / "price.png")

            # ── walk the rest client-side so the in-memory draft survives ─────────
            for name, route in (("publish", "/publish"),
                                ("capture-review", "/capture/review"),
                                ("orders", "/orders")):
                # One plain string with %s: an f-string spliced onto a normal string leaves
                # the normal half's braces doubled, which is a JS SyntaxError that fails
                # silently through Runtime.evaluate and leaves you on the previous route.
                await cdp.js(
                    "(() => { history.pushState({}, '', '%s');"
                    " window.dispatchEvent(new PopStateEvent('popstate')); return 1; })()" % route)
                await settle(cdp, 1800)
                got = await cdp.js("location.pathname")
                if got != route:
                    print(f"  !! {route} redirected to {got}", file=sys.stderr)
                await cdp.shot(args.out / f"{name}.png")

            # ── /publish, where the one tap actually is ──────────────────────────────
            #
            # Two more frames, because the default one misses the feature. /publish opens
            # on its explainer — "first the place where you have to do nothing" — and the
            # green button, the channel count and the channel list are all below the fold
            # on a 812px viewport. A slide about publishing in one tap has to show the tap.
            #
            # The scroll goes on whichever element actually overflows rather than on
            # `window`: the layout scrolls `.app__body`, so `window.scrollTo` moves nothing
            # and returns quietly.
            await cdp.js(
                "(() => { history.pushState({}, '', '/publish');"
                " window.dispatchEvent(new PopStateEvent('popstate')); return 1; })()")
            await settle(cdp, 1800)
            scrolled = await cdp.js("""
              (() => {
                const el = [...document.querySelectorAll('*')]
                  .find((e) => e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 300);
                if (!el) return -1;
                el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, 360);
                return el.scrollTop;
              })()
            """)
            await settle(cdp, 900)
            print(f"  publish scrolled to {scrolled}")
            await cdp.shot(args.out / "publish-tap.png")

            # What the tap actually does here, which is NOT to publish.
            #
            # Nothing publishes without `colour_confirmed` (CLAUDE.md rule 4) — white
            # balance moved the colour, and only the person holding the object can say it
            # is still true — so the tap routes to "क्या यह असली रंग है?" instead. This is
            # the rule working, so it is worth its own frame.
            #
            # The four-channels-live result is deliberately NOT shot: answering the colour
            # question hands the flow back to the next unanswered cataloguer slot rather
            # than to /publish, so reaching it means driving the whole rest of the
            # interview, and a screenshot rig that walks that far is a rig that breaks
            # whenever a question is added.
            tapped = await cdp.js(
                "(() => { const b = [...document.querySelectorAll('button')]"
                ".find((x) => !x.disabled && x.textContent.includes('मेरा सामान भेजिए'));"
                " if (!b) return 'no publish button'; b.click(); return 'ok'; })()")
            await settle(cdp, 2600)
            print(f"  publish tap: {tapped}")
            await cdp.shot(args.out / "publish-colour-lock.png")

            # ── /capture/review mid-upload, the real way ─────────────────────────────
            # This one cannot be reached by pushState: `busy` is component state set by
            # accept(), so the only way to photograph it is to press the button. The
            # camera has to be walked again first, because accept() reads
            # `draft.photoBlob` — which the products-row path above never sets, since a
            # resumed draft has a url and no bytes.
            await cdp.send("Page.addScriptToEvaluateOnNewDocument",
                           source="window.__hangComplete = true;")
            # The gate fires its own shutter once green has held, so this waits for the
            # navigation rather than clicking: a click that races the auto-capture is a
            # second capture() on a screen that has already left.
            await cdp.send("Page.navigate", url=f"{ORIGIN}/__seed.html?to=/camera")
            for _ in range(80):
                await asyncio.sleep(0.15)
                if await cdp.js("location.pathname") == "/capture/review":
                    break
            print(f"  auto-captured -> {await cdp.js('location.pathname')}")
            await settle(cdp, 800)
            # By label, not by position: /capture/review renders accept and retake as two
            # BigButtons with the same markup, and the wrong one goes back to the camera.
            pressed = await cdp.js(
                "(() => { const b = [...document.querySelectorAll('button')]"
                ".find((x) => x.textContent.includes('यही तस्वीर भेजें'));"
                " if (!b) return 'no accept button'; b.click(); return 'ok'; })()")
            await settle(cdp, 2600)
            print(f"  accept: {pressed}")
            await cdp.shot(args.out / "uploading.png")
    finally:
        proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
