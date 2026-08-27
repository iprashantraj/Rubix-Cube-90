import en from './strings/en.json';
import hi from './strings/hi.json';
import or from './strings/or.json';

/**
 * Launch languages. Spec §17 decision 8 is still open; these three cover the demo
 * (Odisha / Sambalpuri examples run through the whole spec) plus the two the PS names
 * explicitly. Adding a language is one JSON file and one row here — nothing else.
 */
export const LANGUAGES = [
  { code: 'hi', label: 'हिन्दी', bcp47: 'hi-IN', tts: 'hi-IN' },
  { code: 'or', label: 'ଓଡ଼ିଆ', bcp47: 'or-IN', tts: 'or-IN' },
  /*
   * English is the one language whose SPEAKING tag differs from its writing tag.
   *
   * `bcp47` is for text: `<html lang>`, font selection, date formatting. en-IN is right
   * there — this is an Indian app and "27 August" is the local order.
   *
   * `tts` is the voice. en-IN selects the device's Indian-English voice, which reads
   * English with a heavy Hindi prosody. For a Hindi or Odia speaker that is fine and
   * probably preferable, but somebody who has chosen English as their interface language
   * has chosen it because they read and understand English, and an accent that mangles it
   * makes the one language they picked the hardest one to follow.
   *
   * en-US rather than en-GB: it is Android's default English voice, so it is the one least
   * likely to be missing on a cheap phone. The tag only decides anything once the server
   * tier declines — web/api/routers/voice.py returns 503 for English precisely so that the
   * device voice, not Sarvam's en-IN, is what speaks it.
   */
  { code: 'en', label: 'English', bcp47: 'en-IN', tts: 'en-US' },
];

/**
 * Base bundles, plus anything dropped in as `strings/_new_*.json`.
 *
 * The `_new_*` files exist so that several people adding strings at once do not all edit
 * the same three JSON files and spend the afternoon resolving conflicts in Devanagari. The
 * shape is `{ en: { key: "..." }, hi: { key: "..." } }` — one file, every language, folded
 * in here at build time and indistinguishable from the base bundles afterwards.
 *
 * A language absent from one of those files (Odia usually is — see or.json's note) simply
 * falls through to English via t(), which is the behaviour we want and not a bug.
 *
 * Glob rather than a list of imports: adding strings should be one new file and no edit to
 * this one.
 */
/**
 * The three launch languages. A bare `string` would let a typo reach `BUNDLES[lang]` and
 * silently render English, which is the one failure this module exists to make loud.
 */
export type Lang = 'hi' | 'or' | 'en';

/** Interpolation values for `{name}` placeholders. Numbers are formatted by `fill`. */
export type Vars = Record<string, string | number | null | undefined>;

/*
 * `as` on each bundle: the JSON files carry `_note` and `_reviewed` metadata keys, one of
 * which is an ARRAY. They are documentation for translators and are never looked up, but
 * they make the literal type wider than Record<string, string>. Asserting here keeps the
 * lookup type honest for the 240 real strings rather than widening the map to `unknown`
 * and pushing a cast onto every caller.
 */
const BUNDLES: Record<Lang, Record<string, string>> = {
  en: ({ ...en } as unknown) as Record<string, string>,
  hi: ({ ...hi } as unknown) as Record<string, string>,
  or: ({ ...or } as unknown) as Record<string, string>,
};

for (const mod of Object.values(
  import.meta.glob<Record<string, Record<string, string>>>('./strings/_new_*.json', {
    eager: true,
  }),
)) {
  for (const [code, keys] of Object.entries(mod.default ?? mod)) {
    if (BUNDLES[code as Lang]) Object.assign(BUNDLES[code as Lang], keys);
  }
}

function fill(raw: string, vars?: Vars): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name] ?? '') : m,
  );
}

/**
 * Resolve a key AND report which language actually produced the string.
 *
 * The second half is not a nicety. `t()` falls back to English when a language is missing
 * a key, but every caller then went on to speak the result in the language the artisan
 * PICKED — so an Odia user got English words pushed through an Odia TTS voice. That is not
 * "degrading to English", it is unintelligible in both languages at once, and it is worse
 * than either. It is what an Odia user actually heard: `catalog.q_what` read aloud as
 * English text by an Odia voice.
 *
 * So the voice layer asks for the resolved language and speaks the string in the language
 * it is actually written in. A fallback is then plain English in an English voice —
 * imperfect, but a real sentence. Text-only callers can keep using `t()`.
 */
export function resolve(lang: Lang, key: string, vars?: Vars): { text: string; lang: Lang } {
  if (BUNDLES[lang]?.[key] !== undefined) {
    return { text: fill(BUNDLES[lang][key], vars), lang };
  }
  if (BUNDLES.en[key] !== undefined) {
    return { text: fill(BUNDLES.en[key], vars), lang: 'en' as const };
  }
  // The key itself. Visible in testing, and spoken as English rather than mangled by a
  // voice for a language it is definitely not written in.
  return { text: key, lang: 'en' as const };
}

/**
 * Resolve a key to text. Falls back to English, then to the key itself — a missing string
 * shows up as a visible key rather than a blank screen, which is what you want in testing.
 *
 * For anything that will be SPOKEN, use `resolve()` instead: this returns the string but
 * throws away which language it is in, and speaking it in the wrong voice is the bug
 * described above.
 */
export function t(lang: Lang, key: string, vars?: Vars): string {
  return resolve(lang, key, vars).text;
}

export function bcp47(lang: Lang): string {
  return LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? 'en-IN';
}

/**
 * The tag to SPEAK this language with, which is not always the tag to write it with.
 *
 * Only the voice layer should call this — see the note on the `en` entry above. Falls back
 * to the writing tag, so a language that does not need the distinction needs no `tts` field.
 */
export function ttsTag(lang: Lang): string {
  const l = LANGUAGES.find((x) => x.code === lang);
  return l?.tts ?? l?.bcp47 ?? 'en-GB';
}

/*
 * Self-check, in the same spirit as camera/gate.js. Dev-only — Vite folds
 * `import.meta.env.DEV` to false and drops the block from the production bundle.
 *
 * It guards one specific regression, because this one shipped to a real phone: a key the
 * artisan's language does not have must come back tagged `en`, so the voice layer speaks it
 * in an English voice. Tagging it `or` is what made an Odia user hear English words read by
 * an Odia TTS engine — unintelligible in both languages at once.
 */
if (import.meta.env.DEV) {
  const ok = (cond: boolean, why: string) => {
    if (!cond) console.error(`[i18n] ${why}`);
  };
  // A key Odia definitely has (native-reviewed) stays Odia.
  ok(resolve('or', 'photo.too_dark').lang === 'or', 'a present Odia key must stay Odia');
  // A key Odia does not have falls back to English AND says so.
  const miss = resolve('or', '__definitely_missing__');
  ok(miss.lang === 'en', 'a missing key must resolve as English, never as the asked language');
  ok(miss.text === '__definitely_missing__', 'an unknown key shows itself, not a blank');
  // Hindi is complete, so nothing should silently fall back out of it.
  ok(resolve('hi', 'common.yes').lang === 'hi', 'hi is complete; common.yes must not fall back');
  // Placeholders survive substitution in whichever language answered.
  ok(
    !resolve('hi', 'orders.new_many', { count: 3 }).text.includes('{count}'),
    'vars must be substituted after the language is chosen',
  );
  // t() and resolve() must never disagree about the text itself.
  ok(
    t('or', 'photo.blurry') === resolve('or', 'photo.blurry').text,
    't() must be resolve().text — if they drift, screens and voice say different things',
  );
}
