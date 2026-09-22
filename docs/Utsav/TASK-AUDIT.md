# Task audit — A–S

Read-only verification against the working tree at commit `c1e4304` (branch `main`).
Nothing here is taken from a claim; every row cites the file and line that proves it.

⚠️ **The working tree moved three times while this audit ran.** A second editing session is
actively editing `ai/interpret.py`, `ai/service.py`, `web/api/routers/catalog.py`,
`web/api/routers/publish.py` and `app/src/screens/CatalogVoice.tsx` right now. Uncommitted
line numbers in `ai/service.py` have already shifted by +24. See §R.

## The table

| Item | State | Evidence | What remains |
|---|---|---|---|
| **A** Research marketplace listing fields | **DONE** | `docs/Utsav/Product_Questions.md:84` §1 the count, `:101` §2, `:135` §3 — per-platform field inventories for GeM, ONDC, Amazon(+Karigar), Flipkart, Meesho, Myntra, WhatsApp. `:225` §5 documents Myntra as impossible (trademark, registered entity, 20–50 SKU floor) rather than "coming soon" | Nothing |
| **B** Segment common vs unique | **DONE** | `Product_Questions.md:105` "asked by all seven", `:117` "six of seven", `:126` "four or five", `:135` §3 unique-to-one | Nothing |
| **C** Compare against Product_Questions.md | **DONE** | `Product_Questions.md:168` §4 buckets A–E; Bucket E `:206` is the nine slots, and `app/src/catalog/slots.js:62` `SLOTS` is that list in code. `slots.js:339` asserts every `CHANNEL_NEEDS` field has a slot | Nothing |
| **D** Fewest-questions strategy | **DONE (code) / half-wired (persistence)** | `app/src/catalog/slots.js:175` `plan()`, `:38` `CHANNEL_NEEDS`, `:153` `neededFields()`; 20+ assertions in `slots.js:217` `demo()` all pass. Consumed at `app/src/screens/CatalogVoice.tsx:134` | **The new answers are never saved.** `CatalogReview.tsx:97` `accept()` PATCHes title/desc/category/material/technique/dye_type/cost_material/labour_hours and `dimensions` **from `draft.prefill`, not from `answers.size`** (`CatalogReview.tsx:111`). `answers.weight`, `answers.stock`, `answers.lead_time`, `answers.size` are asked, spoken, stored in the draft — and thrown away. Knock-on: `Product.weight_grams` and `lead_time_days` are never written, so `CARRY_FORWARD` (item F) can only ever return `material` |
| **E** AI reduces questions from name + platforms | **PARTIAL** | Platform half works: `CatalogVoice.tsx:140` filters `/channels` to `tier === 'A' \|\| c.connected` and feeds it to `plan()`. AI half does not exist: `POST /catalog/prefill` is `raise NotImplementedError` (`ai/service.py:117`, now `:141` in the dirty tree) and `ai/catalog/nlp.py:42` `prefill()` likewise. `Product_Questions.md:310` owns this ("Bucket C is worth ~8 fields and one whole question") | Implement `catalog/prefill` vision. Until then §6.4's budget (4 questions on product 1) is unreachable |
| **F** Don't re-ask what we know | **DONE** | `web/api/routers/products.py:130` `GET /catalog/defaults` exists, is under the `/api` prefix (`main.py:78-82` includes `products`), and is called at `CatalogVoice.tsx:111`. `products.py:123` `CARRY_FORWARD` mirrors `carriesForward` in `slots.js` | Endpoint is correct but starved — see item D. It reads `Product.material`, `lead_time_days`, `weight_grams`; only `material` is ever written |
| **G** Vector DB analysis + "learns with you" | **ANALYSIS DONE / LOOP HALF BUILT** | `Product_Questions.md:292` §6.6 rejects a vector store for memory (it is a SQL lookup) and scopes pgvector to category mapping only. Memory half is built (`products.py:130`). Learning half is not: `grep pgvector\|embedding` over `web/ ai/ app/src` returns only an unrelated hit | The category-mapping index does not exist. `Product.category_map` (`models.py:148`) is **read by four adapters and written by nothing** — `gem.py:51`, `amazon.py:27`, `flipkart.py:24`, `meesho.py:21`, `ondc.py:29` all `.get(...)` a key nobody sets |
| **H** Merge teammates' work | **DONE** | `9416ae4` "Merge remote-tracking branch 'origin/main'", 26 files, conflicts in `ai/README.md`, `ai/service.py`, `app/package.json`, `CatalogReview.tsx`, `Price.tsx` all resolved. No `<<<<<<<`/`>>>>>>>` markers anywhere in the tree | Nothing |
| **I** HARVEST — one answer, several slots | **IN PROGRESS BY THE OTHER SESSION (uncommitted)** | Committed state: `slots.js:201` `absorb()` and `:213` `harvestTargets()` exist and are exercised only by `slots.js`'s own `demo()`; `CatalogVoice.tsx:9` imported `plan` alone; `ai/interpret.py:180` `KNOWN_QUESTIONS` takes one `question` id. **Uncommitted right now:** `ai/interpret.py` +269 lines (`HARVESTABLE_SLOTS`, `build_harvest_payload`, `validate_harvest`), `ai/service.py` `POST /catalog/harvest`, `web/api/routers/catalog.py` `HARVEST_FIELDS` + proxy, `CatalogVoice.tsx` `harvestFrom()` | Do not start this — it is being written. **One bug to hand over:** the app sends `lang` (`CatalogVoice.tsx` `harvestFrom`) but both allowlists name `language` (`catalog.py` `HARVEST_FIELDS`, `interpret.py` `ALLOWED_HARVEST_FIELDS`), so language is silently dropped and every harvest defaults to `hi` |
| **J** Correction capture | **NOT STARTED** | `CatalogReview.tsx:52` `compose()` builds the guess; a re-record calls `setLocal` and the pair is discarded. `accept()` (`:97`) PATCHes only final values. No table, no column, no endpoint: nothing in `models.py` stores a (guess, correction, craft) triple | Everything. The cheapest version is one table and one write inside the existing PATCH — the guess is already in `draft.prefill` on the same screen |
| **K** POST /catalog — SEO title/desc/keywords | **NOT STARTED** | `ai/service.py:111` (`:135` dirty) `raise NotImplementedError`; `ai/catalog/nlp.py:47` `describe()` same. `web/api` has **no proxy route for it at all** — `routers/catalog.py:41` proxies `/catalog/interpret` only, and `CatalogReview.tsx:29` says so in a comment. No per-platform shaping exists anywhere: `grep generic_keywords\|249\|search_terms` over `channels/` returns nothing; `amazon.py:29` `map_attributes` has six keys and no keyword field, `flipkart.py:27` likewise, `gem.py:53` likewise | All of it, both halves (ai implementation + web proxy). Today `CatalogReview.tsx:52` joins the artisan's raw answers with `". "` and writes the same string to `desc_en` and `desc_hi` (`:105-106`) |
| **L** Onboarding asks which platforms | **NOT STARTED — and the research argues against it** | Onboarding is `/onboard/name`, `/craft`, `/place`, `/ready` (`routes.tsx:98-101`); none mentions a channel. `OnboardReady.tsx:19` collects PAN/bank/GST booleans only. But `Product_Questions.md:264` §6.3 explicitly decides the other way: *"The lazy version: default to tier A and ask nothing… The extra fields Amazon and Flipkart want get asked once, at connect time, not per product"* — which is exactly what `CatalogVoice.tsx:140` does | Decide whether L overrides §6.3. If it does, §6.3 needs rewriting first — the two are in direct contradiction |
| **M** Per-platform output blocks with copy buttons | **PARTIAL — backend only** | `meesho.py:41` returns three `instructions` entries each with a `copy` string; `whatsapp.py:38` returns one. `PublishResult.instructions` is declared at `base.py:53`. **Nothing in the app ever reads it**: `grep -rn instructions app/src` returns one unrelated comment (`useVoice.ts:92`). The only clipboard code in the app is `ChannelSetup.tsx:168` `copyStep()`, which copies **onboarding** fields from the selector pack (`selectorpacks/gem.json`: pan, business_name, pincode), not listing content | Render `results[c.id].instructions` on `/publish` or `/channels/:id/setup` with a copy button per entry. The data is already on the wire |
| **N** General description, expandable to per-platform SEO | **NOT STARTED** | `CatalogReview.tsx:35` `FIELDS` is four flat rows (title, desc, category, material). One description, no expander, no per-platform view. Depends on K, which produces the per-platform text that would go inside the expander | Blocked on K |
| **O** One-click listing broken | **BROKEN — diagnosed below** | `web/api/dev.db` `listings`: both rows are `status='failed'`, `error=NULL`, from a real run. See Diagnoses §O | See Diagnoses §O |
| **P** Amazon/Flipkart gated on `connected` | **DONE (rows shown, not hidden)** | `GET /channels` returns `connected` (`routers/channels.py:34`, from `refresh_token_enc`). `Publish.tsx:103` `sendable()` excludes tier B unless `c.connected`; `Publish.tsx:73` shows `publish.connect` when not; `Publish.tsx:165` makes the row tappable to `/channels/:id/setup`; `Publish.tsx:214` speaks `publish.b_none_connected`. Server agrees: `registry.py:53` `one_tap_channels` takes tier A plus connected tier B, `publish.py:63` computes `connected` the same way | The row is **shown-and-disabled**, not hidden. That is the better design (it is how the artisan discovers the channel exists) and the integrate/skip choices are both present — integrate at `:173`, skip via the Next button at `:239`. Only change this if hiding is genuinely wanted |
| **Q** GeM .xlsx generation broken | **BROKEN — diagnosed below. Partial fix uncommitted by the other session** | `web/api/channels/gem_templates/` contains one file, `README.md`, and no JSON. `gem.py:166` returns a fabricated `s3://` URL. See Diagnoses §Q | See Diagnoses §Q |
| **R** Second-session collision | **ACTIVE HAZARD — different files than expected** | `git diff` on `ai/enhance/storage.py`, `web/api/objectstore.py`, `web/api/storage.py` is **empty** — all three are clean and tracked. The live edits are elsewhere, listed in §R below | Stay out of the five files in §R |
| **S** Rebuild + install APK | **NOT STARTED — but fully unblocked** | Toolchain verified, device attached. Existing APK is stale. See Build environment | Run the build |

---

## Diagnoses

### O — why one-click listing produces nothing

**Root cause: `ChannelAdapter.preflight` rejects every channel because the product has no
linked images.**

The evidence is in `web/api/dev.db` from a real run on 2026-08-27:

```
listings:  (…, '0288…', 'marketplace', 'failed', NULL, NULL, NULL, '2026-08-27 12:22:31')
           (…, '0288…', 'ondc',        'failed', NULL, NULL, NULL, '2026-08-27 12:22:31')
products:  colour_confirmed = 1  for all three rows
uploads:   3 rows, all chunks received, url set
product_images: 0 rows
```

Trace it: `channels/base.py:93` `preflight()` has exactly two refusals. The first
(`:100`, `colour_confirmed`) cannot be it — all three products have `colour_confirmed = 1`,
and `CatalogPrefill.tsx:112` does POST `/products/{id}/confirm-colour` properly. The second
(`:105`, `if not product.images`) is it. `error` is `NULL` on both rows, which is the
signature of a `preflight` return — it sets `message_key` and never `error` — and rules out
every adapter-level failure, all of which set `error`.

`preflight` runs first in every adapter (`marketplace.py:40`, `ondc.py`, `gem.py:145`,
`amazon.py:46`, `flipkart.py:41`, `meesho.py`, `whatsapp.py:34`), so this fails **all seven
channels simultaneously** on a product with an uploaded photo. The green button does exactly
nothing and cannot report why.

Why `product_images` is empty: `CaptureReview.tsx:75` calls
`POST /products/{id}/images` — but inside a `try` whose `catch` at `:78` swallows the
failure with the comment *"AI service down, or the link failed"*, then navigates on at `:84`
regardless. So the one call that makes a publish possible fails **silently**, and the artisan
walks the entire flow — questions, price, publish — to a product the server considers
photoless.

`add_image` (`products.py:204`) can reject in two ways: `_own` 404s, or `:222`
`db.query(Upload).filter_by(artisan_id=…, url=body.url).first()` returns `None` and it 400s.
Both land in the same silent `catch`.

**The fix has two parts, and the second is the important one:**
1. Split the `try` at `CaptureReview.tsx:72`. The image link is not optional the way
   enhancement is — losing enhancement costs a prettier photo (CONTRIBUTING.md rule 3), losing the
   link costs the listing. Speak on failure and do not navigate.
2. `base.py:105`'s `photo.missing` is the correct refusal, but it arrives four screens too
   late. The check belongs at the end of capture, where retaking is still possible.

### Q — why the GeM .xlsx cannot work

Three defects stacked, in increasing severity.

**1. There are no templates.** `web/api/channels/gem_templates/` holds `README.md` and
nothing else — zero `.json` files. `_load_template` (`gem.py:36-42`) does
`TEMPLATE_DIR / f"{gem_category_id}.json"` and `if not path.exists(): return None`, so it
returns `None` on every call ever made. `build_workbook` (`gem.py:114`) then falls to
`columns = [{"header": k, "field": k} for k in attrs]` — a sheet whose headers are our
**internal Python keys** (`product_name`, `local_content_percent`, `weight_grams`), not GeM's
real column names. As `gem_templates/README.md` itself warns: *"a plausible-looking sheet
that GeM rejects is worse than no sheet."*

**2. The category id is always `None`, so a template could never be found even if one
existed.** `map_category` (`gem.py:51`) reads `(product.category_map or {}).get("gem_id")`.
`Product.category_map` (`models.py:148`) is written **nowhere in the repo** — grep finds five
readers (`gem.py:51`, `amazon.py:27`, `flipkart.py:24`, `meesho.py:21`, `ondc.py:29`) and no
writer. The thing that was supposed to fill it is the vision pre-fill, which is
`raise NotImplementedError` (`ai/service.py:117`). So the single step `gem.py:7-16` calls
"the part that is genuinely hard and therefore genuinely valuable" — the 10,700-category
mapping — is a `dict.get` against an empty dict.

**3. The bytes are generated and then discarded. This is the actual "broken".**
`render()` (`gem.py:159`) calls `build_workbook`, binds `data`, **never uses it**, and returns
`artifact_url=f"s3://{self.id}/{product.id}.xlsx"` (`:166`) — a string composed on the spot,
pointing at an object nobody wrote, in a URI scheme nothing in this repo produces
(`ai/enhance/storage.py:84` explicitly refuses `s3://` sources). The `TODO(phase 7)` at
`:160` admits it. `publish.py:83` stores that string on the Listing row and no route, and no
line of app code, ever reads it back: `grep -rn artifact_url app/src` returns nothing. The
artisan is told `publish.file_ready` and there is no file to be ready.

Note the ordering trap: `render` calls `check_discount` (`gem.py:148`) **before**
`build_workbook`, and `check_discount` returns `"missing mrp or floor price"` unless both are
set. `Price.tsx:147` does PATCH them, but all three products in `dev.db` have
`mrp = NULL, floor_price = NULL`, so on today's data GeM fails at the discount guard and never
reaches the workbook at all. Fixing defect 3 without walking the price flow will just move the
failure one line up.

> **The other session is fixing defect 3 right now.** Uncommitted in
> `web/api/routers/publish.py`: `GET /publish/gem/{product_id}.xlsx`, which rebuilds the
> workbook on demand, enforces ownership in the query, re-runs `check_discount` as a 409, and
> returns warnings in an `X-Gem-Warnings` header. Its docstring names the same root cause
> found here. **Defects 1 and 2 are untouched by that fix** and remain blocking — a real GeM
> upload still needs real category templates and a real `category_map` writer.

---

## Build environment (item S)

An APK build is **possible today**. Nothing is missing.

| Check | Result |
|---|---|
| `app/android/` | Present — `gradlew`, `build.gradle`, `settings.gradle`, `variables.gradle`, `local.properties`, `app/`, `gradle/` |
| `local.properties` | `sdk.dir=/home/justutsav/Android/Sdk` — set, so `ANDROID_HOME` being unset does not matter |
| `which gradle` | **not found** — irrelevant, the wrapper is used |
| `./gradlew --version` | Gradle 8.14.3, wrapper resolves offline (`--offline tasks` exits 0), daemon JVM 21.0.12 |
| `which java` | `/usr/bin/java`, OpenJDK 21.0.12 |
| `JAVA_HOME` | **unset**. `/usr/lib/jvm/java-21-openjdk-amd64` and `java-17-openjdk-amd64` both exist; Gradle falls back to the current Java home, so this is a nit, not a blocker |
| Android SDK | `~/Android/Sdk` — `platforms/android-35`, `android-36`; `build-tools/34.0.0, 35.0.0, 36.1.0, 37.0.0`; `licenses/`, `platform-tools/` |
| `compileSdkVersion` | 36 (`variables.gradle`) — **present** in `platforms/`. `minSdk 26`, `targetSdk 36` |
| `which adb` | `/usr/bin/adb` |
| `adb devices -l` | `ZA222XGRVM  device  model:motorola_edge_60_stylus` — **one real device attached over USB, authorised** |
| Existing APK | `app/android/app/build/outputs/apk/debug/app-debug.apk`, 16.8 MB, **2026-08-28 14:04:38** |
| Existing web bundle | `app/dist/index.html`, **2026-08-28 14:04:25** |

**The APK is stale.** It was built at 14:04; commit `c1e4304` (the whole `slots.js` question
engine, the `CatalogVoice` rewrite, `_new_catalog_slots.json`, 232 lines of new CSS) landed at
**16:31**. Nothing from item D is in the installed binary.

Sequence when the tree is quiet: `npm run build` in `app/`, `npx cap sync android`,
`./gradlew assembleDebug`, `adb install -r …/app-debug.apk`.

⚠️ **Do not build yet.** `app/src/screens/CatalogVoice.tsx` is dirty and mid-edit by the
other session (§R). Building now ships a half-written harvest path to the phone.

---

## R — what the second session is touching

`git diff` is **clean** on all three files named in the brief — `ai/enhance/storage.py`,
`web/api/objectstore.py`, `web/api/storage.py`. All three are tracked and unmodified. The
Supabase work is either committed or abandoned; the object-store surface is not the collision
risk.

The live, uncommitted edits are elsewhere, and they overlap items **I** and **Q** directly:

| File | Change | Item |
|---|---|---|
| `ai/interpret.py` | +269. `HARVESTABLE_SLOTS`, `ALLOWED_HARVEST_FIELDS`, `SYSTEM_PROMPT_HARVEST`, `build_harvest_payload`, `validate_harvest`, `harvest` | I |
| `ai/service.py` | +24. `POST /catalog/harvest`. Shifts the `NotImplementedError` lines from 111/117 to 135/141 | I, K |
| `web/api/routers/catalog.py` | +53. `HARVEST_FIELDS`, `POST /catalog/harvest` proxy | I |
| `app/src/screens/CatalogVoice.tsx` | +50. Imports `absorb`/`harvestTargets`, adds `harvestFrom()` fired after the direct answer | I |
| `web/api/routers/publish.py` | +57. `GET /publish/gem/{product_id}.xlsx` | Q |

**Rules for this session:** touch none of the five. Everything left in this audit lives
safely outside them — `CaptureReview.tsx` and `channels/base.py` (item O),
`channels/gem.py` + `gem_templates/` (item Q defects 1 and 2),
`CatalogReview.tsx` (items D, J, N), `ai/catalog/nlp.py` (item K).

Two bugs to hand back to that session rather than fix here:
- `harvestFrom()` posts `lang`; `HARVEST_FIELDS` and `ALLOWED_HARVEST_FIELDS` both name
  `language`. The key is dropped and every harvest silently runs as `hi`.
- Its GeM download route fixes defect 3 only. Defects 1 and 2 above still make the emitted
  sheet unusable on the real portal.
