# Asset inventory

No website was captured — there is no public site for this app. The assets below were
produced from the repository itself and from the running app.

## App screens — `assets/shots/*.png` (1125×2436, 3× of a 375×812 phone)

Captured from the real Kaarigar app running on `vite dev` at a mobile viewport, with the
API mocked locally and a synthetic camera frame fed to the real `gate.js`. Every string on
screen is the app's own Hindi copy; no screen was redrawn.

| File | What it shows |
|---|---|
| `01-home.png` | /home — "waiting for you" todos, the catalogue, the big add-product button |
| `02-camera-dark.png` | /camera refusing a dim frame: red ring, dead shutter, "रोशनी में लाएं" |
| `03-camera-green.png` | /camera on green: green ring, armed shutter, same object in light |
| `04-capture-review.png` | "क्या यह तस्वीर ठीक है?" — the photograph the gate let through |
| `05-colour-confirm.png` | "क्या यह असली रंग है?" — the publish gate, rule 4 |
| `06-voice-heard.png` | /catalog/voice — one Hindi sentence transcribed back, 10 slots as dots |
| `07-catalog-review.png` | The composed listing, built from her own answers |
| `08-price.png` | /price — ₹1450 with material / labour / margin and the comparable range |
| `09-publish.png` | /publish — the tier-A channels that need no account |
| `10-publish-live.png` | ONDC reported live |
| `11-products.png` | The catalogue, with the unconfirmed-colour product flagged |
| `12-earnings.png` | /earnings before the first sale |

## Product stills — `assets/*.png` (320×320)

Cropped from `research/segmentation/out/sheet-real-listing-style-photographs.png`, this
repo's own BiRefNet benchmark. `*-original.png` is the photograph as shot; `*-cutout.png`
is that model's real output composited on white — a genuine before/after from the pipeline,
not an illustration of one.

| File | What it shows |
|---|---|
| `pot-original.png` / `pot-cutout.png` | Terracotta water pot, blurred street background → clean cutout |
| `cup-original.png` / `cup-cutout.png` | Clay cup held in a hand → hand and background removed |
| `saree-original.png` / `saree-cutout.png` | Gold-and-orange saree drape → cutout |
| `gate-dark-vase.png` | A severely underexposed vase — the kind of frame the gate refuses |
