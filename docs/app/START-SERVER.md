# Start the server (for an untethered phone)

Copy-paste these. Every path is absolute, so it does not matter which directory your
terminal is in.

**Run each block in its own terminal tab.** They stay in the foreground; closing the tab
stops the server.

---

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

## Finding the IPs

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

## ⚠️ When the laptop's IP changes, the app breaks

`VITE_API_BASE` is baked in at **build time**, so a new DHCP lease means the installed APK
is pointing at an address that no longer exists. The symptom is the app saying "no network"
on a phone with full signal — see `app/src/api/client.ts` for why that failure looks
identical to a real outage.

This is not hypothetical: this laptop moved from `172.29.35.240` to `10.169.219.181` within
an hour of the first build.

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
