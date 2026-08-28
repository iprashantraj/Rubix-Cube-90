/**
 * The app's colour, as a setting.
 *
 * Everything visual lives in styles.css — this file holds the LIST and the one line that
 * applies it. That split is the point: a palette is five CSS variables under a
 * `[data-theme]` selector, so adding one never means touching JavaScript, and reading the
 * current accent means asking the browser rather than keeping a second copy of the hex in
 * here. Two copies of a colour is how the status bar ends up green in a purple app.
 *
 * `terracotta` is also what plain `:root` declares, so the app is clay before this module
 * has run at all — during the native splash and on first paint. There is no unthemed frame
 * to flash through.
 */

/**
 * `id` matches the `[data-theme]` selector in styles.css. `labelKey` is spoken and shown,
 * so it is a key, never a literal — a colour name is one of the few things in this app a
 * user might genuinely have a word for in their own language.
 */
export const THEMES = [
  { id: 'terracotta', labelKey: 'theme.terracotta' },
  { id: 'forest', labelKey: 'theme.forest' },
  { id: 'indigo', labelKey: 'theme.indigo' },
  { id: 'plum', labelKey: 'theme.plum' },
];

/**
 * Clay. Must match the `:root` block in styles.css, the SplashScreen colour in
 * capacitor.config.json, the `theme-color` meta in index.html, and ACCENT in
 * tools/make_icons.py — those four are the app's colour BEFORE this module can run.
 */
export const DEFAULT_THEME = 'terracotta';

/**
 * Apply a palette to the document.
 *
 * An unknown id falls back to the default rather than being written through, because an
 * attribute that matches no rule is not "unthemed" — it inherits whatever the parent had,
 * which on a re-theme is the previous palette. A build that drops a palette must degrade
 * to a whole app in one colour, never to a half-repainted one.
 */
export function applyTheme(id: string | null) {
  const known = THEMES.some((th) => th.id === id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = known ?? undefined;
  return known;
}

/**
 * The accent colour as the browser has actually resolved it.
 *
 * Read, never stored. The native status bar and the browser theme-color both have to match
 * the header they sit above, and the only way to guarantee that without a second copy of
 * every hex is to ask for the computed value after the attribute is set.
 */
export function accentColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
}

/*
 * Self-check. Dev-only — Vite folds `import.meta.env.DEV` to false and drops this.
 *
 * It guards the one thing that is easy to get wrong and invisible when it is: an id that
 * no longer has a CSS block must land on the default, not on a document carrying an
 * attribute nothing matches.
 *
 * ⚠️ It must not run at module-import time, and this is not a style preference.
 *
 * In dev Vite injects styles.css from JavaScript, and this module is imported before that
 * has happened. Every custom property therefore resolved to the empty string, so the
 * distinctness loop below saw "" four times and reported each palette as a duplicate of the
 * one before it:
 *
 *     palette "forest" resolves to the same accent as "terracotta"
 *     palette "indigo" resolves to the same accent as "forest"
 *     palette "plum"   resolves to the same accent as "indigo"
 *
 * All four blocks were present and correct the whole time — verified in the browser after
 * load: #9c3d24, #1f6f43, #2f4b8f, #6b3a8f. The check was reading a document with no
 * stylesheet in it yet.
 *
 * That made it worse than useless. Three red console errors on every single page load train
 * everyone to ignore this logger, and a check that always fails cannot ever catch the real
 * bug it exists for — a palette that genuinely lost its CSS block would look exactly like
 * the noise. So: wait for load, and bail loudly if the stylesheet still is not there rather
 * than blaming the palettes for it.
 */
function selfCheck() {
  const before = document.documentElement.dataset.theme;

  console.assert(applyTheme('plum') === 'plum', 'a known palette must be applied as asked');
  console.assert(
    document.documentElement.dataset.theme === 'plum',
    'applyTheme must write the palette onto <html>',
  );
  console.assert(
    applyTheme('chartreuse-disco') === DEFAULT_THEME,
    'an unknown palette must fall back to the default, not be written through',
  );
  console.assert(
    document.documentElement.dataset.theme === DEFAULT_THEME,
    'an unknown palette must leave the document on the default, never on the previous one',
  );
  /*
   * Every palette must resolve to a DIFFERENT accent.
   *
   * Checking for a non-empty value would pass whatever happens: `:root` declares --accent
   * unconditionally, so an id with no CSS block silently inherits forest and the picker
   * grows a second green tile that does nothing. Distinctness is the property that
   * actually fails when a block is missing or misspelled.
   */
  const seen = new Map();
  for (const th of THEMES) {
    applyTheme(th.id);
    const accent = accentColour();
    // No stylesheet means every palette reads "" and every comparison below is meaningless.
    // Say that, once, instead of naming three innocent palettes.
    if (!accent) {
      console.error(
        '[theme] --accent resolves to nothing: styles.css is not applied to the document. ' +
          'The palette check cannot run and is being skipped, not passed.',
      );
      break;
    }
    console.assert(
      !seen.has(accent),
      `palette "${th.id}" resolves to the same accent as "${seen.get(accent)}" — its ` +
        '[data-theme] block in styles.css is missing or the id does not match',
    );
    seen.set(accent, th.id);
  }

  applyTheme(before ?? DEFAULT_THEME);
}

if (import.meta.env.DEV && typeof document !== 'undefined') {
  // `load` rather than DOMContentLoaded: the stylesheet is what this needs, not the DOM.
  if (document.readyState === 'complete') selfCheck();
  else window.addEventListener('load', selfCheck, { once: true });
}
