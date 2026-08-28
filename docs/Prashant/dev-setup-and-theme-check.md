# The theme check that cried wolf, and the Python version nobody wrote down

**Date:** 2026-08-28 · **Touches:** `app/src/ui/theme.js`, `README.md`, `ai/README.md`,
`web/README.md`

Two things found by running the app rather than reading it.

---

## 1. The palette self-check was failing on every load, and the palettes were fine

Every dev page load printed three red console errors:

```
palette "forest" resolves to the same accent as "terracotta" — its [data-theme] block is missing
palette "indigo" resolves to the same accent as "forest"     — …
palette "plum"   resolves to the same accent as "indigo"     — …
```

**I first read this as three missing CSS blocks. It was not.** All four palettes are present
and correct in `styles.css` — verified in the browser after load:

```
terracotta #9c3d24   forest #1f6f43   indigo #2f4b8f   plum #6b3a8f
```

The tell is in the error text itself: each palette matches *the one before it*. That is the
signature of every read returning the same value — here, the empty string.

**Cause:** the self-check ran at module-import time. In dev, Vite injects `styles.css` from
JavaScript, and `theme.js` is imported before that has happened, so
`getComputedStyle(...).getPropertyValue('--accent')` returned `""` for all four and the
distinctness loop reported each as a duplicate of the last.

**Why it mattered more than three stray log lines.** A check that always fails is worse than
no check at all:

- it trains everyone on the team to ignore that logger, so the *next* real error is invisible
- it can never catch the bug it exists for — a palette that genuinely lost its CSS block
  would look exactly like the existing noise
- it cost real time: I reported it to the team twice as "styles.css defines one palette",
  which was wrong, and would have sent whoever picked it up looking for a bug that isn't there

**Fix:** run it on `load` rather than at import — the stylesheet is what it needs, not the
DOM — and bail with one clear message if `--accent` still resolves to nothing, instead of
blaming three innocent palettes for a missing stylesheet.

> Both self-checks in this app now have the same property: they fail when something is
> actually wrong, and are silent otherwise. `comps.py` needed the same treatment on the same
> day — an uncollected price snapshot used to warn on every single request.

---

## 2. Python 3.10+ was a hard requirement and appeared in no README

`X | None` annotations are used throughout `ai/` and `web/api/`. On 3.9 pydantic raises

```
TypeError: unable to evaluate type annotation 'float | None'
```

at import, before any request, and `from __future__ import annotations` does **not** save it —
pydantic still evaluates the string. macOS ships 3.9, so this bites every fresh clone on a
Mac, and `web/api` has a lot of setup behind it before you find out.

Now documented in all three READMEs, along with the rest of the local setup, which was also
undocumented and which I worked out the hard way getting the stack up:

- Postgres role + database + `alembic upgrade head`
- `.env` from `.env.example`, with the two secrets that have no default
- **Redis is not needed to run the API** — only `worker.py` touches it
- the AI service on **8001**, without which `/price` answers 503

The venv lines say `python3.12 -m venv` explicitly rather than `python3`, because on the
machine this bites, `python3` is the 3.9 that caused it.
