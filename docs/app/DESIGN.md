# Design System: Kaarigar

Status: **proposal**. Nothing here is implemented yet. Written 2026-08-28.

Reference studied: `SplitFree/splitfreeapp` — the dashboard, `EmptyState`, `PageHeader`,
`skeletons`, `bottom-nav`, and the sheet family.

---

## 0. Where this document overrides the taste-design skill

The skill this was generated from is tuned for premium **web** work generated through
Google Stitch. Four of its rules are wrong for this app and are deliberately not followed.
They are listed here so nobody "fixes" the design later by applying them.

| Skill rule | Why it is overridden |
|---|---|
| Fonts must be `Geist` / `Satoshi` / `Cabinet Grotesk`; `Inter` banned | **None of them ship Devanagari or Odia glyphs.** Two of our three languages would fall back mid-sentence to a system font. The stack stays `system-ui, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Oriya'`. Script coverage outranks brand character when the user cannot read Latin. |
| "No emojis anywhere" — and by extension, decorative pictograms | Our users **may not read at all**. Pictograms are not ornament here, they are the primary channel. The rule is kept only in its real sense: no emoji *characters* (they render differently per device and are unreadable at a glance). Drawn SVG icons stay. |
| Spring physics, perpetual micro-loops, staggered cascades, motion 6/10 | Target device is a 2–3GB Android phone and the camera gate already spends its frame budget on `getImageData`. Perpetual loops on a dashboard would compete with it. Motion drops to **3/10**: transitions only, no infinite loops except the one mic pulse that signals recording. |
| Asymmetric / banned centered heroes, 1400px max-width, 65ch body | Desktop rules. This is a single-column phone app, one decision per screen, centred by design. |

Kept from the skill, and enforced: one accent only, no pure black, no neon glow, no
gradient headline text, no fabricated numbers, no AI copy clichés, skeletal loaders over
spinners, composed empty states over "No data".

---

## 1. Visual Theme & Atmosphere

Warm, plain, and slow. The app should feel like a **well-lit workshop shelf**, not a
fintech dashboard: clay surfaces, generous air, one thing to do per screen, and type large
enough to read at arm's length in courtyard sunlight with a cracked screen protector.

- **Density 3/10** — airy. One question, one answer, one button.
- **Variance 2/10** — predictable and symmetric on purpose. A user who cannot read
  navigates by *position memory*. A control that moves between screens is a control they
  have to find again every time. Symmetry is an accessibility feature here.
- **Motion 3/10** — transitions carry meaning (progress filling, mic listening) or they do
  not happen.

Everything already true of the codebase and kept: the four palettes, the `Screen`
primitive, the segmented `Steps` progress, spoken prompts, `--tap: 56px`.

---

## 2. Colour Palette & Roles

Unchanged — the existing palette is already WCAG-checked and is not the problem. Recorded
here so the rest of the document can reference it by name.

- **Clay** (`#9c3d24`) — the accent. Default palette, launcher icon, native splash.
- **Clay Ink** (`#7a2e1a`) — accent-coloured text, deep end of the hero band.
- **Clay Whisper** (`#f7e7e1`) — accent-soft, chip and selected-tile fill.
- **Warm Canvas** (`#f8f3f1`) — `--surface-0`, the page behind cards.
- **Pure Surface** (`#ffffff`) — `--surface-1/2`, card fill.
- **Hairline** (`#ecdfd9`) — `--line`, 1px structure.
- **Ink** (`#1c1917`) — primary text. Not pure black, per the skill.
- **Muted** (`#6b625d`) — secondary text. 5.4:1 on the lightest surface.
- **Status:** Green `#1f9d55`, Amber `#d68910`, Red `#c0392b`, each with an `-ink` variant
  for text use. Large fills only for the bright pair.

Three alternate palettes (`forest`, `indigo`, `plum`) stay as-is.

**Unchanged rule:** the launcher icon and native splash cannot follow the in-app theme —
Android caches the icon at install. Both are always Clay.

---

## 3. Typographic Architecture — the Fibonacci scale

Requested explicitly. Fibonacci: 8, 13, 21, 34, 55, 89.

The current scale is `34 / 24 / 17 / 13` — already Fibonacci at both ends and off in the
middle. Two values move.

```css
--t-micro:   13px;  /* tab labels, chips, meta, the dot-heading            */
--t-body:    21px;  /* body, button labels, list rows, answers  (was 17)   */
--t-title:   34px;  /* screen title, and the asked question     (was 24/34)*/
--t-display: 55px;  /* ONE number per screen. Earnings total, final price. */
```

Line heights stay off the ladder — they are ratios, not sizes: `1.2` display, `1.3` title,
`1.5` body, `1.4` micro. Weights unchanged (`700 / 650 / 500 / 600`).

**Why body moves 17 → 21.** This app has very few words per screen — a question and an
answer. The space exists. 21px is roughly the size at which a 45-year-old weaver reading a
second language on a scratched 720p panel in daylight stops squinting. The cost is more
wrapping in Devanagari and Odia; the screens are short enough to absorb it.

**Why 55 exists and is rationed.** Exactly one number per screen may use it, and only when
that number *is* the screen: the earnings total, the confirmed price, the PIN read back.
Two things at 55px means neither is the answer.

**Spacing, same ladder:**

```css
--s-1:  8px;   /* icon-to-label, chip padding        */
--s-2: 13px;   /* inside a card, between stacked rows*/
--s-3: 21px;   /* page gutter (replaces --pad: 20px) */
--s-4: 34px;   /* between sections                   */
--s-5: 55px;   /* hero breathing, empty-state margins*/
```

Tap targets stay **off** the ladder at `--tap: 56px` / `--tap-big: 72px`. They are ergonomic
constants, not typographic ones, and both already exceed the 44px floor.

---

## 4. Icon system — sizes, and where they sit

The instruction was *don't keep the icons very big*. The reference app runs 20px nav icons
and 16px inline icons. Ours run 30px in the tab bar today.

**One ladder, four rungs. No other size is permitted.**

| Token | Size | Used for |
|---|---|---|
| `--i-sm` | **18px** | Inline with body text: `.help` links, chip leading, `Heard` marker |
| `--i-md` | **24px** | The default. Back chevron, list-row leading, `BigButton` leading, tab bar |
| `--i-lg` | **32px** | The camera shutter glyph and the tab-bar create button only |
| `--i-art` | **89px** | Empty-state illustrations. Art, not an icon — Fibonacci, matches `h-24` in the reference |

Stroke weight `2` inactive, `2.5` active — the reference's trick for showing selection
without moving anything.

**Placement law, applied to every screen:**

- **Leading position only.** An icon sits to the *left* of its label at `--s-1` gap. Never
  above it (that stacks and doubles row height), never trailing except the single
  disclosure chevron on a navigable list row.
- **Icons never appear alone** on a control an artisan must understand, except the four
  that are already learned by position: back, replay, mic, shutter.
- **Icon colour is `currentColor`,** always. One class recolours a whole composition and
  the four palettes need no second copy. This is the reference app's rule and it is right.
- **Corner slots are absolutely positioned** so they never contribute to header height —
  directly from `PageHeader`. Our current header row lets the replay button set the row
  height on screens with no title.

---

## 5. Component contracts

Five components carry the whole redesign. Three exist and change; two are new.

### 5.1 `Screen` — exists, gains one prop

Already the right primitive (hero / dim / steps / footer variants, spoken prompt, derived
back and progress). One addition: **`state`**, taking `'ready' | 'loading' | 'empty' | 'error'`.
Today each screen hand-rolls this, which is exactly why loaders and empty states drifted.

`Screen` renders the skeleton, the empty composition, or the error itself. A screen body
only ever renders the ready state.

### 5.2 `ActionBar` — **new**, and this is the consistency fix

The complaint was that buttons are on the sheet, in the centre, at the bottom, differently
per page. The rule:

> **Every primary action in this app lives in one place: a bar pinned to the bottom of the
> viewport, above the safe-area inset, full-bleed, `--s-3` padding.**

- **One primary button**, full width, `--tap-big` (72px) tall, accent fill.
- **At most one secondary**, directly beneath, ghost/outline, `--tap` (56px).
- **Tertiary actions are `.help` text links**, `--t-micro`, never buttons.
- The bar is opaque with a hairline top border, and casts the same opacity-only scroll
  shadow the reference uses on its header — so content scrolling under it is visible.
- `YesNo` becomes a two-up variant of this bar, not a separate layout.

Anything that is currently a centred mid-page button moves here. Nothing else changes
position between screens — an artisan's thumb learns one location.

### 5.3 `LoadState` — **new**

Replaces every spinner and every greyed-out button.

- **Skeleton, shaped like the page it is replacing** — the reference's rule. A products
  skeleton is four product rows, not a circle. Cards keep their real dimensions so the page
  does not jump on load.
- **Never a bare spinner** except inside a button that is mid-submit.
- **It speaks.** Any wait over ~1.5s says what it is waiting for, in the artisan's
  language, once. Silent waiting is the failure mode this app cannot afford — the existing
  `enhance.still_working` pattern generalised to every long operation.
- **Determinate when we know the fraction** (upload). Indeterminate shimmer otherwise.
- Greying out a button is **banned** as a loading signal. It communicates nothing to
  someone who cannot read the button.

### 5.4 `EmptyState` — **new**, ported wholesale from the reference

Inline SVG art at `--i-art`, drawn in `currentColor` from theme tokens. Never a PNG, never
a stock illustration, never "No data".

Structure: art → title (`--t-body`, semibold) → one line of body (`--t-micro`, muted, max
17rem) → action, which routes into the `ActionBar`, not a floating button.

Five compositions needed: **products**, **orders**, **earnings**, **channels**, **search /
nothing found**. Each is four flat shapes with one element drawn as a dashed outline — the
reference's idea that *the missing thing is drawn as the gap*, which reads correctly
without a caption.

Empty states also **speak their title on entry**, because a first-run artisan looking at an
empty catalogue is exactly the person who most needs to be told what to do next.

### 5.5 `PageHeader` behaviour — folded into `Screen`

Adopt three things from the reference:

1. **Sticky**, with `top` at the status-bar inset — not 0. The system tray stays untouched,
   which was an explicit requirement.
2. **Corner slots absolutely positioned**, floor the header at `min-height: --tap` only when
   a slot is present.
3. **Scroll shadow on opacity only**, never animating the shadow itself.

---

## 6. Navigation, and the missing account button

**Finding: `/settings` is unreachable.** Nothing in the app navigates to it. It is a route
with no entry point — the answer to "where is the accounts page button" is that there
isn't one. `/help`, `/channels` and `/wizard/gst` are similarly reachable only from inside
other flows.

The reference solved the same problem with one line in its nav:

```js
// Account moved out of the tab bar — reachable from the Home top-left icon.
```

**Adopt exactly that.** The five tabs stay as they are — Home, Catalog, **Create**, Orders,
Money — because a fifth tab for settings would cost the create button its centre position.
Instead:

- **`/home` gains a top-left avatar/account button** (`--i-md`, in a `--tap` slot) → `/settings`.
- **`/settings` becomes the account hub**, and is the only screen that links onward to
  `/help`, `/channels`, and `/wizard/gst`. Those three stop being orphans.
- Tab icons drop **30px → 24px** (`--i-md`); the create button stays `--i-lg` 32px so it
  still reads as the primary action.

---

## 7. The two generalized chains

### 7.1 Onboarding — 7 screens, one template

`/lang`, `/consent`, `/auth`, `/onboard/name`, `/onboard/craft`, `/onboard/place`,
`/onboard/ready`.

Every one renders the identical skeleton, and only the middle slot differs:

```
┌─────────────────────────────────┐
│ ‹        ▓▓▓▓▓░░░░         ↻    │  back · segmented progress · replay
├─────────────────────────────────┤
│                                 │
│   The question, --t-title 34px  │  centred, max 2 lines
│                                 │
│   ┌─────────────────────────┐   │
│   │   ANSWER SLOT           │   │  mic · tile grid · OTP field
│   └─────────────────────────┘   │
│                                 │
│   what we heard, --t-micro      │  only after an answer exists
├─────────────────────────────────┤
│   ▐  PRIMARY, 72px           ▌  │  ActionBar
│      secondary, 56px            │
└─────────────────────────────────┘
```

Four answer slots cover all seven screens: **mic** (name, place), **tile grid** (language,
craft), **yes/no** (consent, readiness), **typed** (OTP only — the one documented
exception). No screen invents a fifth.

### 7.2 Post-capture questions — 5 screens, one template

`catalog.q_what` → `q_material` → `q_time` → `q_special` → `q_size`.

Same skeleton as onboarding with two differences, both already correct in the code and
worth keeping: the **photo sits above the question** (turning a memory test into a caption
task) and progress is **five dots**, not segments — matching the five questions rather than
a generic chain.

The answer slot is always the mic. Type and skip stay as quiet `.help` links in the
`ActionBar` tertiary row — reachable, never the obvious path.

### 7.3 After the questions — the publish chain

`/catalog/review`, `/price`, `/publish` currently vary in where their controls sit. All
three adopt the `ActionBar`. Publish's channel tiers become one scrollable list of rows
(icon `--i-md` leading, name, status chip trailing) with a single "send" primary in the
bar — replacing per-tier buttons scattered down the page.

---

## 8. Loaders, page by page

Every wait in the app, and what replaces the current treatment:

| Where | Wait | Now | Becomes |
|---|---|---|---|
| `/home` | products + orders | full-page spinner | Dashboard skeleton: balance card + two row groups |
| `/products` | catalogue | spinner | 4 product-row skeletons |
| `/orders`, `/earnings` | orders | spinner | 4 row skeletons |
| `/capture/review` | upload, 5–40s | % spinner | Determinate bar over the photo + spoken quarters *(already correct — keep)* |
| `/catalog/prefill` | enhance, ~20s | spinner | Skeleton of the coming result + spoken progress *(pattern already correct)* |
| `/catalog/voice` | ASR + model, 3–9s | mic "thinking" | Keep the mic state, add a spoken cue past 3s |
| `/publish` | per-channel fan-out | greyed buttons | Per-row status chips, live |
| `/channels`, `/settings`, `/wizard/gst` | fetch | greyed / nothing | Row skeletons |

Rule: **the skeleton is the page with its content removed**, never a generic block.

---

## 9. Splash and launcher icon

I rendered both. Diagnosis:

**The icon is a white lozenge with an inner diamond and a detached chevron above it, on
clay.** Two problems. The chevron reads as a separate glyph rather than a thread lifting
off the cloth — at 48dp it looks like a caret accidentally sitting on top of a diamond.
And the inner diamond is a thin stroke inside another thin stroke; at launcher size on a
cheap panel it fills in and the mark becomes a blob.

**The splash is the same mark, at the same colour, with a faint loom grid behind it.**
That is the interference: you tap a clay tile with a white diamond, and you get a clay
screen with a white diamond. Nothing appears to have happened. Then the React `Splash`
plays a 2.1s loom animation of *the same shape again* — so the sequence is three
consecutive clay-and-diamond frames before the app appears.

**Fix, in order of leverage:**

1. **Make the native splash and the icon visually distinct.** The native `splash.png`
   should be **clay and nothing else** — no mark. The mark's entrance belongs to the React
   animation, which is the one that can actually animate it. This alone removes the
   "interfering" effect and costs one regenerated PNG.
2. **Thicken and simplify the mark for the icon only.** Drop the inner diamond at launcher
   sizes; raise stroke from 7 to ~10 on the 120 grid; attach the lift-thread to the lozenge
   so it reads as one object. `tools/make_icons.py` already exists, is documented, and
   regenerates all 26 rasters from one geometry change — this is a small edit to constants
   in that file, not a redraw.
3. **Delete the two stale Android Studio template files** — `drawable/ic_launcher_background.xml`
   (a `#26A69A` teal vector) and `drawable-v24/ic_launcher_foreground.xml` (stock clipart).
   Neither is referenced: the adaptive icon uses `@color/ic_launcher_background` (correctly
   `#9C3D24`) and `@mipmap/ic_launcher_foreground`. They are dead files that make the icon
   config look wrong to anyone reading it, and the teal is almost certainly where the
   "clashing" impression comes from when browsing the resources.
4. **Shorten the React splash 2100ms → ~1200ms.** It is not a loading screen (it says so
   itself) and it currently runs after a native splash that already showed the mark.

Everything about the status bar stays: accent-tinted, `Style.Dark`, `setOverlaysWebView(false)`,
`--sa-top` respected by the sticky header. The system tray is untouched.

---

## 10. Anti-patterns — banned in this app

Beyond the skill's list (no emoji characters, no pure black, no neon glow, no gradient
headlines, no fabricated metrics, no AI copy clichés):

- **No numerals as the only signal.** "3 of 5" is reading. Dots and segments instead.
- **No greyed-out control as a loading state.** It says nothing to a non-reader.
- **No bare spinner** outside a submitting button.
- **No control that changes position between screens.** Position is how this app is
  navigated.
- **No icon above its label.** Leading, always.
- **No two things at `--t-display`** on one screen.
- **No English string rendered when a translation is missing** — `resolve()` already guards
  this and it must keep guarding it.
- **No silent wait over 1.5 seconds.**
- **No text-only error.** Every error speaks.
