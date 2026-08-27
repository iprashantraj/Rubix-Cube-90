import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '../store.js';
import { resolve } from '../i18n/index.js';
import { stepOf } from '../ui/onboarding.js';
import { speak, shutUp, prefetch } from './speak.js';

/**
 * The voice layer, as hooks. Spec §6.7.
 *
 * Design law rule 2: every screen speaks on entry. Not a nicety — for a user who cannot
 * read, a silent screen is a blank screen.
 *
 * Everything here goes through `resolve()` rather than `t()` so a string always reaches the
 * voice paired with the language it is actually written in. Using `t()` here is what made
 * an Odia user hear English words in an Odia voice — see the comment on `resolve()`.
 */
export function useVoice() {
  const lang = useSession((s) => s.lang) ?? 'hi';

  const say = useCallback(
    (key, vars) => {
      const r = resolve(lang, key, vars);
      return speak(r.text, r.lang);
    },
    [lang],
  );
  // Raw text has no key to look up, so the caller owns the language. Callers pass strings
  // they got from `t()`/`resolve()` themselves — see ReplayButton, which passes both.
  const sayRaw = useCallback((text, textLang) => speak(text, textLang ?? lang), [lang]);
  const warm = useCallback(
    (keys) => {
      // Group by resolved language: prefetch warms the server clip cache, which is keyed
      // by (lang, text), so warming a fallback string under the wrong language would cache
      // a clip nothing ever asks for and still leave the real one cold.
      const byLang = {};
      for (const k of keys) {
        const r = resolve(lang, k);
        (byLang[r.lang] ??= []).push(r.text);
      }
      for (const [l, texts] of Object.entries(byLang)) prefetch(texts, l);
    },
    [lang],
  );

  return { say, sayRaw, warm, shutUp, lang };
}

/**
 * Speak the screen's prompt on mount, then any follow-on keys, and shut up on unmount.
 *
 * `also` exists because a heading is not always the whole message. /consent is the case
 * that proved it: the screen spoke "Your data" and stopped, leaving the actual DPDP notice
 * — the part that has to be heard for consent to mean anything — playable only by pressing
 * a button. Someone who cannot read the body never knew there was one. A consent notice
 * nobody heard is not consent.
 *
 * They are spoken in sequence, not fired together: speak() interrupts by design, so two
 * calls in a row means the second erases the first and only the tail is ever heard.
 *
 * Unmount cleanup matters more than it looks: without it, navigating away leaves the old
 * screen's prompt talking over the new one's, and two voices at once is worse than silence.
 */
/**
 * What each route has already said aloud this session. `pathname -> Set of keys`.
 *
 * Module-level and deliberately never persisted: it means "what the person holding this
 * phone has already heard", which is meaningless after a restart. It is also a record of
 * screens somebody visited, so it stays in memory and goes nowhere near the server or
 * storage — same reasoning as the privacy rules in the app README.
 */
const alreadySaid = new Map();

function isNews(pathname, keys) {
  const said = alreadySaid.get(pathname) ?? new Set();
  alreadySaid.set(pathname, said);
  // Fresh if ANY part has not been heard on this route before — tested before recording,
  // because the recording is what makes the second visit quiet.
  const fresh = keys.some((k) => !said.has(k));
  for (const k of keys) said.add(k);
  return fresh;
}

/**
 * Forget what has been said, so the app speaks like a first run again.
 *
 * Called on erasure. The next person to pick up this phone is a different person as far as
 * we are concerned, and a screen that stays silent because someone ELSE already heard it
 * has failed them completely.
 */
export function resetSpokenHistory() {
  alreadySaid.clear();
}

/*
 * ── News, not repetition ──────────────────────────────────────────────────────
 *
 * Design law 2 is "every screen speaks on entry", and taken literally it made the app
 * exhausting to use. The tab bar has five buttons: pressing three of them in ten seconds
 * meant hearing "Products", then "one moment", then "you have no orders" read aloud —
 * again — every single time. A voice that repeats what you already know, every time you
 * touch the phone, is a voice people learn to talk over. This app has nothing else with
 * which to reach someone who cannot read, so that is not a small loss.
 *
 * So a key is spoken the FIRST time a given route says it, and stays silent after that.
 * Nothing real is lost:
 *
 *   - a key that CHANGES is news, and is spoken. Returning to /orders after an order lands
 *     still says "you have a new order" — the one sentence on that screen that is worth
 *     interrupting somebody for.
 *   - the replay button is on every screen, in the same place, and always speaks.
 *   - genuinely repeating instructions (the camera gate) go through useSpeakOnChange and
 *     are untouched by any of this.
 *
 * Memory is per route AND per key, so /orders going quiet cannot make /earnings go quiet.
 *
 * ⚠️ CHAINS ARE EXEMPT, and forgetting that broke the app badly enough to be worth naming.
 *
 * Onboarding and the create flow (ui/onboarding.js) are walked start to finish, and the
 * create flow is walked again for every single product. The five cataloger questions live
 * on one route, /catalog/voice, so after the first product every one of those keys was in
 * the "already said" set — and the second product was catalogued in total silence. Five
 * questions, none of them asked, on the screen whose entire interface is being asked
 * questions.
 *
 * The distinction that matters is not route-vs-route, it is LABEL vs INSTRUCTION. On a
 * destination the prompt names the screen you just chose to open, and repeating it is
 * noise. In a chain the prompt IS the interface — it is a live question expecting an answer
 * right now, and it is new every time somebody starts a new listing, however many times
 * they have heard the words before.
 */
/**
 * @param onSpoken called once the prompt has finished, and NOT if the screen was left
 *   part-way through. It exists so a screen can act the moment the question stops playing —
 *   see /catalog/voice, which opens the microphone there so the artisan only has to speak.
 *   Held in a ref so an inline arrow does not restart the speech on every parent render.
 */
export function useSpeakOnEnter(key, vars, also, onSpoken) {
  const { say } = useVoice();
  const varsRef = useRef(vars);
  varsRef.current = vars;
  const doneRef = useRef(onSpoken);
  doneRef.current = onSpoken;
  // Arrays are re-created every render; keying the effect on the identity would restart the
  // speech on every parent render. The joined string is the thing that actually matters.
  const alsoKey = Array.isArray(also) ? also.join(' ') : (also ?? '');

  useEffect(() => {
    if (!key && !alsoKey) return undefined;

    const parts = [key, ...(alsoKey ? alsoKey.split(' ') : [])].filter(Boolean);
    // window.location, not useLocation: this hook is used by the UI kit, which has no
    // business importing the router, and by the time an effect runs the router has already
    // committed the new pathname.
    const here = window.location.pathname;
    // A suppressed key still reports "spoken": the caller's follow-on action is about the
    // question having been PUT, and one the artisan already heard has been put. Bailing out
    // here would silently disable the auto-microphone on a repeat visit.
    const silent = !stepOf(here) && !isNews(here, parts);

    let cancelled = false;
    (async () => {
      if (!silent) {
        if (key) await say(key, varsRef.current);
        for (const k of alsoKey ? alsoKey.split(' ') : []) {
          if (cancelled) return;
          await say(k);
        }
      }
      // Not after an unmount, and not after a navigation. Opening a microphone on a screen
      // the artisan has already left is exactly what the cancellation flag is here for.
      if (cancelled || window.location.pathname !== here) return;
      doneRef.current?.();
    })();
    return () => {
      cancelled = true;
      shutUp();
    };
  }, [key, alsoKey, say]);
}

/**
 * Speak a changing value, but only when it actually changes.
 *
 * This is what the camera gate uses. The gate re-evaluates ten times a second; without
 * the change guard it would restart "paas aayein" on every single frame and the artisan
 * would hear a stutter instead of an instruction.
 */
export function useSpeakOnChange(key, vars) {
  const { say } = useVoice();
  const last = useRef(undefined);
  const varsRef = useRef(vars);
  varsRef.current = vars;

  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    if (key) say(key, varsRef.current);
  }, [key, say]);
}
