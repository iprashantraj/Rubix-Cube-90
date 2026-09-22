# Start the server

Copy-paste these. Every path is absolute, so it does not matter which directory your
terminal is in.

**Run each block in its own terminal tab.** They stay in the foreground; closing the tab
stops the server.

---

## Which mode are you in?

Two ways the phone reaches the API, and **they are configured differently.** Check
`app/.env.local` first — it decides, and it is read at **build time**.

| | **Tethered — USB** | **Untethered — WiFi** |
|---|---|---|
| `app/.env.local` | `VITE_API_BASE` **unset/commented** | `VITE_API_BASE=http://<laptop-ip>:8000/api` |
| App dials | `http://localhost:8000/api` | that address |
| Needs | `adb reverse tcp:8000 tcp:8000` | same subnet, correct IP |
| Survives a DHCP change | **yes** | **no — rebuild required** |
| Mixed-content risk | none (`localhost` is trustworthy) | real, see below |

**Tethered is the current setting and the recommended one for a demo.** No lease can move
under it, and the whole "Finding the IPs" section below stops applying. Untethered is only
needed when the phone must come off the cable.

---

## 0. The USB tunnel — tethered mode only, and the step everyone forgets

```bash
adb reverse tcp:8000 tcp:8000
```

This forwards the phone's own `localhost:8000` down the cable to the laptop. Without it the
app has no route to the API at all and reports **"no network" on a phone with full signal** —
indistinguishable from a real outage from inside the app.

🔁 **It does not persist. Re-run it after every one of these:**

- unplugging and replugging the cable
- `adb kill-server`, or anything that restarts the adb daemon
- the phone rebooting
- the phone locking and re-authorising USB debugging

**No rebuild is needed** — it is a transport, not a build setting. One second, any time.

Check it in one command:

```bash
adb shell curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/health
```

`200` means the phone can see the API. Anything else — `000`, empty, `curl: not found` —
is the tunnel or the server, never the app.

## 1. The API — the only thing the phone talks to

```bash
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/web/api && .venv/bin/uvicorn api.main:app --app-dir .. --host 0.0.0.0 --port 8000 --reload
```

Two parts of that are load-bearing:

- **`--host 0.0.0.0`.** The default binds to loopback, and a phone on WiFi cannot reach
  loopback. This is the whole difference between tethered and untethered.
- **`api.main:app --app-dir ..`, not `main:app`.** `web/api/main.py` imports its siblings
  relatively (`from .config import settings`), so it has to be loaded as a member of the
  `api` package. Loading it as a top-level module fails with
  `ImportError: attempted relative import with no known parent package`.

## 2. The AI service — photo enhancement, cataloging, pricing

The phone never calls this directly. `web/api` calls it on loopback, so it stays on
`127.0.0.1` and does **not** need `--host 0.0.0.0`.

```bash
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/ai && .venv/bin/uvicorn service:app --port 8001
```

Without it, `/price` answers 503 and the app offers "set the price later" rather than
blocking the listing. Everything else still works.

## 3. Marketplace + admin console — optional

Not needed for the phone. Only start it to look at a published listing in a browser.

```bash
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/web/site && npm run dev
```

---

## Before you shoot — 30 seconds, and it decides how fast the demo looks

Two things are cold at startup and both land on the first take.

**1. Is the segmentation model warm?**

```bash
curl -s http://127.0.0.1:8001/health
```

`{"ok":true,"warm":"cuda"}` — ready, ~0.9s per photo.
`"warm":null` — still loading, wait ~5s and ask again.
`"warm":false` or it stays null — prewarm gave up. Enhancement still works, but the first
photo stalls about four seconds while it loads. Check the AI service log.

Restarting the AI service re-arms this, so check it AFTER the last restart, not before.

**2. Warm the database connection pool.**

```bash
curl -s -o /dev/null http://localhost:8000/api/shop/products
```

The database is in Supabase `ap-southeast-2` (Sydney). First connection measured 4441ms;
every query after it, 200–400ms. One throwaway request pays that once, off camera.

Measured 2026-09-02, both warm: **~0.9s from photo to rendered listing image.** If a take is
slower than that, one of these two is cold — not the model, and not the network.

---

## 🎯 The address that does not move: run the hotspot from the LAPTOP

**This is the recommended setup, and it is the one currently configured.**

There are two ways to put the phone and the laptop on one network, and they are not equally
stable:

| Who hosts the WiFi | Laptop's address | Stable? |
|---|---|---|
| **The laptop** (NetworkManager "shared") | **always `10.42.0.1`** | ✅ **Fixed.** It is the gateway address of the shared connection, not a lease |
| The phone's hotspot | whatever the phone's DHCP hands out | ❌ moves between sessions, and Android changes the subnet on some restarts |

When the laptop shares its connection, **it is always `10.42.0.1`** — so `VITE_API_BASE` can
be pinned once and never revisited. No lease to chase, no rebuild after reconnecting, and
**no `adb reverse`**, which is the thing that kept silently dropping.

```bash
ip -4 -o addr show wlo1     # reads 10.42.0.1/24 while the laptop is the hotspot
```

Set it once:

```
VITE_API_BASE=http://10.42.0.1:8000/api
```

Then rebuild and reinstall once, and the cable is only ever needed for installing.

> **Why this beats the cable.** `adb reverse` drops on every replug, adb-daemon restart,
> phone reboot and USB re-authorisation — three times in one session while debugging this —
> and each drop looks exactly like "no network" on a phone with full signal. The hotspot
> address survives all of them.

**Verified 2026-09-03:** with `adb reverse --remove-all` and the cable contributing nothing,
the app made six successful API calls and zero failed fetches.

---

## Finding the IPs — **untethered mode only**

> ⏭️ **On USB? Skip this whole section.** With `VITE_API_BASE` unset the app dials
> `localhost:8000` and `adb reverse` carries it. No address to find, nothing to rebuild when
> the lease moves. Everything below applies only when the phone comes off the cable.

**You do not need a public IP, a tunnel, or any external service.** The phone and the laptop
only have to sit on the same private network. A phone hotspot *is* such a network — the
phone runs the DHCP server and acts as the router, and the laptop gets a private address
from it. Nothing goes out to the internet and back.

They do not share one address. They get two addresses on the same subnet. What the app
needs is **the laptop's**, because the laptop is what runs the API.

### The laptop's address — this is the one that goes in `VITE_API_BASE`

```bash
ip -4 -o addr show wlo1 | awk '{print $4}'
```

### The phone's address, and proof you are on its hotspot

```bash
adb shell ip -4 addr show wlan0 | grep -o 'inet [0-9.]*/[0-9]*'
ip route | grep default
```

If the `default via` address equals the phone's address, the laptop is on the phone's
hotspot and the phone is the router. That is the working configuration.

The two addresses must share a subnet: `10.169.219.181` and `10.169.219.175` are both on
`10.169.219.0/24`, so they can reach each other. `172.29.x.x` and `10.169.x.x` could not —
that mismatch is what "no network" looks like.

### After every reconnect: one command that updates the config for you

The hotspot hands out a fresh lease each session, so do this instead of editing the file by
hand. It writes `app/.env.local` from whatever address the laptop currently holds:

```bash
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90 && IP=$(ip -4 -o addr show wlo1 | awk '{split($4,a,"/"); print a[1]}') && printf 'VITE_API_BASE=http://%s:8000/api\n' "$IP" > app/.env.local && cat app/.env.local
```

Then rebuild and reinstall — `VITE_API_BASE` is read at build time, so the installed APK
does not pick up the change on its own:

```bash
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/app && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Confirm the two can actually see each other

```bash
adb shell ping -c 2 -W 2 $(ip -4 -o addr show wlo1 | awk '{split($4,a,"/"); print a[1]}')
```

`0% packet loss` means the network is fine and any remaining failure is the server or the
app, not the connection.

---

## Check it before you blame the app

From this laptop:

```bash
curl -s http://10.169.219.181:8000/health && echo
```

Expect `{"ok":true,"env":"..."}`. From the **phone's** browser, open the same URL:

```
http://10.169.219.181:8000/health
```

If the laptop answers and the phone does not, it is the network — different WiFi, AP client
isolation, or a host firewall — not the app.

### If the browser works but the app still says "no network"

Then the network is fine and the WebView is refusing the request. Read the console:

```bash
adb logcat -c && adb shell am force-stop in.gov.sih.kaarigar
adb shell monkey -p in.gov.sih.kaarigar -c android.intent.category.LAUNCHER 1
sleep 10 && adb logcat -d | grep -E "Mixed Content|\[api\] request failed"
```

`[api] request failed ... TypeError: Failed to fetch` is what the artisan hears as "no
network", and on its own it says nothing about the cause. The line above it does.

**`Mixed Content: ... has been blocked`** means Chromium refused the call because the app is
served from `https://localhost` and the dev API is plain `http://`. This is a WebView
policy, not an Android one — it fires before `network_security_config` is consulted, so the
cleartext permission being correct does not help. `MainActivity.java` disables mixed-content
blocking for debug builds; if you are seeing this, the APK on the phone predates that fix,
so rebuild and reinstall.

Note that `adb reverse` never triggers it: `http://localhost` is a "potentially trustworthy"
origin and is exempt. A LAN address is not. **This failure only exists once the phone comes
off the cable**, which is exactly when it is hardest to debug.

---

## ⚠️ When the laptop's IP changes, the app breaks — **untethered only**

`VITE_API_BASE` is baked in at **build time**, so a new DHCP lease means the installed APK
is pointing at an address that no longer exists. The symptom is the app saying "no network"
on a phone with full signal — see `app/src/api/client.ts` for why that failure looks
identical to a real outage.

This is not hypothetical, and it has now happened twice. The laptop moved from
`172.29.35.240` to `10.169.219.181` within an hour of the first build; later it moved back to
`172.29.32.131` while `.env.local` still said `10.169.219.181`, and **every request failed at
the transport for a day.**

> 🩹 **It got worse than a rebuild, once.** `_publish_local` used to write that same address
> into `product_images.url`, so 36 rows pointed at a host that no longer answered — blank
> thumbnails, and `/catalog/prefill` asking *"kya yeh asli rang hai?"* over an empty frame.
> Rebuilding could not fix it, because the dead host was in the **database**. Both halves are
> fixed now: stored urls are root-relative, and a `load` listener on `ProductImage` strips any
> host left in an old row. **Nothing persists a laptop address any more.**

**Tethered mode makes this section moot** — that is the argument for using it.

Use the one-command fix in **Finding the IPs** above — it rewrites `app/.env.local` from the
laptop's current address, and the rebuild/reinstall command follows it.

The reinstall needs the USB cable for about a minute. The phone runs untethered afterwards.

### Making the address stop moving

Since the laptop joins the *phone's* hotspot, the phone's DHCP decides the laptop's address,
and Android picks a fresh hotspot subnet on some restarts. Two ways out, neither required:

- **Pin the laptop's address.** On the hotspot connection (`Not Working`, the SSID as of
  2026-09-02), set a manual IPv4 address instead of DHCP:

  ```bash
  nmcli con mod "Not Working " ipv4.method manual ipv4.addresses 10.169.219.181/24 ipv4.gateway 10.169.219.175
  ```

  ⚠️ Only do this if you are willing to undo it. If Android later moves the hotspot to a
  different subnet, a pinned address on the old one means the laptop cannot reach the phone
  *or* the internet, and the failure gives no hint why. Undo with
  `nmcli con mod "Not Working " ipv4.method auto`.

- **Just re-run the two commands.** Reconnect, run the `.env.local` one-liner, rebuild,
  reinstall. Roughly a minute, and nothing can silently break. This is the recommended one
  unless you are reconnecting constantly.

---

## Stopping everything

Ctrl-C in each tab is the normal way. If they were started somewhere you cannot reach, or a
tab was closed without stopping them:

```bash
pkill -f "uvicorn api.main:app"    # the API, port 8000
pkill -f "uvicorn service:app"     # the AI service, port 8001
```

Confirm both ports are actually free, rather than trusting the kill:

```bash
for p in 8000 8001; do curl -s -m 2 -o /dev/null http://127.0.0.1:$p/health && echo "$p STILL UP" || echo "$p closed"; done
```

⚠️ **A stopped server and a missing `adb reverse` look identical from the phone** — both are
"no network". Check the ports before re-reading any app code.

---

## The whole thing, tethered, from cold

Three terminals plus one command. This is the demo path.

```bash
# terminal 1 — API
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/web/api && .venv/bin/uvicorn api.main:app --app-dir .. --host 0.0.0.0 --port 8000 --reload

# terminal 2 — AI service
cd /home/justutsav/projects/Personal_Work/SIH/Rubix-Cube-90/ai && .venv/bin/uvicorn service:app --port 8001

# terminal 3 — tunnel, then the two warm-ups, then the check
adb reverse tcp:8000 tcp:8000
curl -s http://127.0.0.1:8001/health                        # want {"ok":true,"warm":"cuda"}
curl -s -o /dev/null http://localhost:8000/api/shop/products  # pays the Sydney cold connect
adb shell curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/health   # want 200
```

If the last line prints `200`, the phone can reach the API and anything still failing is the
app or the data — not the connection.

**If the phone does not appear to `adb devices` at all:** check that the USB descriptor is
actually publishing an ADB interface, not only MTP.

```bash
lsusb -v -d 22b8: 2>/dev/null | grep -iE "iProduct|iInterface"
```

Seeing `iInterface  MTP` **and nothing saying ADB** means USB debugging is not really on for
this cable session. Toggle Developer options → USB debugging off and on, **then unplug and
replug** — the interface list is fixed at enumeration, so toggling alone does not republish
it. Accept the *"Allow USB debugging?"* prompt with the phone unlocked.
