# web/ — API, marketplace, admin console

```
api/     FastAPI + Postgres + Redis/RQ + channel adapters
site/    Next.js — marketplace (SSR, public) + admin console (/admin)
```

Spec: `../docs/Master-Technical-Reference.md` · Architecture: `../docs/Application-Architecture.md`

## Run

```bash
cd api  && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd api  && .venv/bin/uvicorn api.main:app --reload --app-dir ..     # :8000/docs
cd site && npm install && npm run dev                              # :3000
```

Needs Postgres and Redis. `api/db.py:create_all()` bootstraps the schema in dev; anything
past that goes through Alembic, because `create_all` silently ignores every column you
altered.

Copy `api/.env.example` to `api/.env`. Nothing in `config.py` has a usable secret default.

Uploaded photos are assembled to `STORAGE_DIR` (default `api/.storage/`) and
`POST /uploads/{id}/complete` returns a `file://` url to the finished image. `ai/` opens
that url, so in dev both services have to see the same path. Object storage is a change to
`api/storage.py` and nothing else — no caller reads a path.

```bash
cd api && python3 test_uploads.py    # chunk assembly, no deps, no server
```

---

## The line that matters

**`web/` calls `ai/` over HTTP and never imports across it.** They are separate deploy
units and the AI box has a GPU that this one does not. `routers/products.py` is the only
place that talks to it.

---

## Channel adapters — `api/channels/`

One product in, many shapes out. Every platform has a different listing schema, and
normalising that difference *is* the product.

Adding a channel = adding a plugin. It must never mean touching core.

```python
class MyAdapter(ChannelAdapter):
    id, name, tier = "x", "X", Tier.C
    def map_category(self, product) -> dict: ...
    def map_attributes(self, product) -> dict: ...
    def format_images(self, product) -> list[dict]: ...
    async def render(self, product, status) -> PublishResult: ...
```

Then one line in `registry.py`. Import order there is display order on `/publish`, and the
two channels that need nothing from the artisan come first on purpose.

| Adapter | Tier | Reality |
|---|---|---|
| `marketplace` | A | Direct DB write. Live on return |
| `ondc` | A | **We are the Marketplace Seller Node.** Artisans are sub-sellers |
| `gem` | C | No seller API exists. Category `.xlsx` **is** the official integration |
| `amazon` | B | SP-API. Cannot create a seller account — only connect an existing one |
| `flipkart` | B | Seller API. 🚨 token expires in ~60 days — refresh job from day one |
| `meesho` | D | Partner-gated. Copy block + guided browser |
| `whatsapp` | D | Image + caption. How they already sell |

### Two rules every adapter inherits

`preflight()` runs before any channel-specific work, so neither can be forgotten in a new
adapter:

- **Colour lock.** No publish until the artisan has confirmed the colour survived white
  balance. This is how a maroon saree does not ship as orange, get returned, and take the
  artisan's rating with it.
- **`render()` must not raise for an expected refusal.** An artisan who has not connected
  Amazon is a `needs_connect` result, not an exception. `/publish` fans out in parallel and
  one channel's ordinary state must never take down a push that was going to succeed.

### GeM is the hard one, and the valuable one

10,700+ categories. Wrong category is the most common listing failure, and an entire
consultancy industry exists purely to fill these sheets correctly. Automating it is the
actual "AI-driven market linkage" — background removal is a commodity, this is not.

⚠️ **Blocking:** real category templates (spec §18 items 1–2) are not in the repo.
`channels/gem_templates/README.md` has the descriptor format. Do not invent columns — a
plausible sheet that GeM rejects is worse than no sheet, because the artisan spends three
days finding out.

`GeMAdapter.check_discount()` refuses to emit a file when GeM's mandated ~10% discount
would push the price below the floor. Under-pricing is the epidemic in this sector, not
over-pricing.

---

## Autofill selector packs — `api/selectorpacks/`

Served at runtime by `GET /api/channels/{id}/selectorpack`, **never compiled into the app**.
That is the whole design: a DOM change on the far side is a config push we ship in an hour,
not an app update rural users never install.

Four rules, all non-negotiable:

1. Selectors live here, on the server.
2. Every step degrades to spoken guided-paste on a selector miss. A stale pack slows a
   step down; it never breaks a screen.
3. **Never automate submit, login, OTP, payment, or CAPTCHA.** We fill fields; the artisan
   presses the button.
4. Track match-rate per step. Below threshold → revert that channel to guided-paste.

Ships `"enabled": false`. Turn on per channel once match-rate holds >95% for a week.

---

## Privacy, enforced in `models.py`

`Artisan` carries readiness **booleans** and never the underlying values. `has_pan` is true
or false; the PAN number has no column, in any table, ever. What we don't store cannot
leak — and it also cannot be left behind when someone taps "mera data mitaayein".

The only third-party credential we ever hold is an Amazon/Flipkart OAuth refresh token,
only when the artisan explicitly connects, encrypted at rest via `security.py`. **We never
ask for a platform password.**

## Honest gaps, stated rather than papered over

- **GeM has no order API.** Orders live on the GeM dashboard and nowhere else. A cluster
  coordinator reconciles them in `/admin/gem-recon`. We do not fake sync.
- **We cannot see an artisan's bank account.** We see what a marketplace *promised*. Hence
  "Amazon ne ₹4,200 bheje hain", never "aa gaye" — and the "Paisa aaya?" tap that turns the
  limitation into real settlement-delay data.
- **Oversell windows cannot be closed**, only shrunk. Optimistic locking on
  `InventoryLedger.version`, plus pushing artisans toward made-to-order, where the race
  does not exist at all.
