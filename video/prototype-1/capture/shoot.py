#!/usr/bin/env python3
"""Re-shoot the app screens in video/*/assets/shots — 1125x2436, 3x of a 375x812 phone.

Why this exists: the previous shots were captured at a viewport narrower than the layout
they were rendering, so every screen was clipped on the right — headings cut mid-word, the
bottom nav missing its last tab. Nothing downstream could fix that, because the pixels were
never in the file. This pins the viewport with CDP's setDeviceMetricsOverride instead of
relying on a window-size flag, which is what drifted.

Run it with the ai venv's python (it has `websockets`) against a built, served app:

    npm --prefix app run build && npm --prefix app run preview -- --port 5199 &
    ai/.venv/bin/python video/prototype-1/capture/shoot.py --out video/prototype-1/assets/shots

`public/__seed.html` must be present: the routes are auth-guarded and it seeds the session.
Delete it again once the shots are taken.
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

CHROME = pathlib.Path(
    "video/motion/node_modules/.remotion/chrome-headless-shell/linux64/"
    "chrome-headless-shell-linux64/chrome-headless-shell"
)

WIDTH, HEIGHT, SCALE = 375, 812, 3

ORIGIN = "http://127.0.0.1:5199"

# What the stub API answers with. Shapes come from app/src/api/types.ts; the numbers are
# the same ones the video quotes, so a screen and a caption can never disagree.
FIXTURES = {
    "/products": [
        {"id": "p1", "title": "हस्तनिर्मित मिट्टी की सुराही, 2 लीटर — अजमेर",
         "image": f"{ORIGIN}/__shot-pot.png", "price": 1049, "colour_confirmed": True},
        {"id": "p2", "title": "बांधनी दुपट्टा, लाल — कच्छ",
         "image": f"{ORIGIN}/__shot-saree.png", "price": 2400, "colour_confirmed": False},
        {"id": "p3", "title": "मिट्टी का कुल्हड़, छह का सेट",
         "image": f"{ORIGIN}/__shot-cup.png", "price": None, "colour_confirmed": True},
    ],
    "/orders": [
        {"id": "o1", "state": "delivered", "amount": 1049, "quantity": 1, "channel": "Hamara Bazaar",
         "artisan_confirmed_payment": True, "payment_state": "settled"},
        {"id": "o2", "state": "shipped", "amount": 2400, "quantity": 1, "channel": "Amazon",
         "artisan_confirmed_payment": False, "expected_settlement_date": "2026-10-02"},
        {"id": "o3", "state": "placed", "amount": 2098, "quantity": 2, "channel": "GeM",
         "artisan_confirmed_payment": False},
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
    "/me": {
        "display_name": "सुनीता देवी", "craft": "pottery", "pincode": "305001",
        "language": "hi", "has_pan": True, "has_bank": True,
        "has_gst": False, "has_artisan_card": True,
    },
}

# filename -> route. Only screens that render truthfully from persisted session + the stub
# API. The mid-flow screens (/capture/review, /catalog/review, /price) read an in-memory
# draft that only exists after a real camera-and-voice run, so they are NOT shot here —
# faking one would put a screen in the video that the app never shows.
SHOTS = {
    "01-home": "/home",
    "09-publish": "/publish",
    "11-products": "/products",
    "12-earnings": "/earnings",
    "13-orders": "/orders",
    "14-product-detail": "/products/p1",
    "15-channels": "/channels",
}

# Installed before any app script runs, so the very first render already has data.
STUB_JS = """
(() => {
  const FIX = __FIXTURES__;
  const pick = (url) => {
    const path = String(url).replace(/^https?:\\/\\/[^/]+/, '').replace(/^\\/api/, '').split('?')[0];
    if (path in FIX) return FIX[path];
    const m = /^\\/products\\/([^/]+)$/.exec(path);
    if (m) return FIX['/products'].find((p) => p.id === m[1]) ?? null;
    if (path === '/me/gst-route') return {route: 'enrolment_only', voice_key: 'gst.enrolment_only'};
    if (path === '/catalog/defaults') return {};
    return null;
  };
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(location.origin) && !url.includes('/api/')) return real(input, init);
    const body = pick(url);
    if (body === null) return new Response('{}', {status: 404, headers: {'content-type': 'application/json'}});
    return new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
  };
})();
"""


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def send(self, method, **params):
        self.n += 1
        msg_id = self.n
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            reply = json.loads(await self.ws.recv())
            if reply.get("id") == msg_id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply.get("result", {})


async def shoot(cdp, base, route, path):
    # Pin the viewport on the page itself. A window-size flag is advisory; this is not,
    # and it is the whole reason the old shots were clipped.
    await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        width=WIDTH, height=HEIGHT, deviceScaleFactor=SCALE, mobile=True,
    )
    await cdp.send("Page.navigate", url=f"{base}/__seed.html?to={route}")

    # The seed page redirects, React mounts, fonts load. Poll for the app's own root having
    # painted something rather than sleeping a fixed amount and hoping.
    for _ in range(60):
        await asyncio.sleep(0.25)
        res = await cdp.send(
            "Runtime.evaluate",
            expression=(
                "(() => { const r = document.getElementById('root');"
                " return !!r && r.children.length > 0 && location.pathname !== '/__seed.html'; })()"
            ),
            returnByValue=True,
        )
        if res.get("result", {}).get("value"):
            break
    await asyncio.sleep(1.2)  # settle: webfont swap and any entrance transition

    shot = await cdp.send("Page.captureScreenshot", format="png", captureBeyondViewport=False)
    path.write_bytes(base64.b64decode(shot["data"]))
    return path


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--base", default="http://127.0.0.1:5199")
    ap.add_argument("--only", nargs="*", help="filenames to re-shoot; default all")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen(
        [
            str(CHROME), "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
            "--remote-debugging-port=9223", "--remote-allow-origins=*",
            # A synthetic camera, so /camera renders its viewfinder instead of
            # "कैमरा नहीं खुला". The real gate.js still measures the frame.
            "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
            # The app probes three API addresses; two are off-LAN here and would hang the
            # page for the full TCP timeout. Send them somewhere that refuses immediately.
            "--host-resolver-rules=MAP 10.169.219.181 127.0.0.1, MAP 10.42.0.1 127.0.0.1",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        target = None
        for _ in range(40):
            await asyncio.sleep(0.25)
            try:
                with urllib.request.urlopen("http://127.0.0.1:9223/json/list", timeout=1) as r:
                    tabs = json.load(r)
                page = [t for t in tabs if t.get("type") == "page"]
                if page:
                    target = page[0]["webSocketDebuggerUrl"]
                    break
            except Exception:
                continue
        if not target:
            sys.exit("chrome never came up on :9223")

        wanted = {k: v for k, v in SHOTS.items() if not args.only or k in args.only}
        async with websockets.connect(target, max_size=64 * 1024 * 1024) as ws:
            cdp = CDP(ws)
            await cdp.send("Page.enable")
            await cdp.send("Runtime.enable")
            await cdp.send(
                "Page.addScriptToEvaluateOnNewDocument",
                source=STUB_JS.replace("__FIXTURES__", json.dumps(FIXTURES, ensure_ascii=False)),
            )
            for name, route in wanted.items():
                path = await shoot(cdp, args.base, route, args.out / f"{name}.png")
                print(f"  {name:22} {route:20} {path.stat().st_size // 1024} kB")
    finally:
        proc.terminate()


if __name__ == "__main__":
    asyncio.run(main())
