import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '../store';
import { resolve } from '../i18n/index';
import type { Lang, Vars } from '../i18n/index';
import { stepOf } from '../ui/onboarding';
import { speak, shutUp, prefetch } from './speak';

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
    (key: string, vars?: Vars) => {
      const r = resolve(lang, key, vars);
      return speak(r.text, r.lang);
    },
    [lang],
  );
  // Raw text has no key to look up, so the caller owns the language. Callers pass strings
  // they got from `t()`/`resolve()` themselves — see ReplayButton, which passes both.
  const sayRaw = useCallback(
    (text: string, textLang?: Lang) => speak(text, textLang ?? lang),
    [lang],
  );
  const warm = useCallback(
    (keys: string[]) => {
      // Group by resolved language: prefetch warms the server clip cache, which is keyed
      // by (lang, text), so warming a fallback string under the wrong language would cache
      // a clip nothing ever asks for and still leave the real one cold.
      const byLang: Partial<Record<Lang, string[]>> = {};
      for (const k of keys) {
        const r = resolve(lang, k);
        (byLang[r.lang] ??= []).push(r.text);
      }
      for (const [l, texts] of Object.entries(byLang)) prefetch(texts as string[], l);
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
/*
 * ── A question is spoken. A title is not. ─────────────────────────────────────
 *
 * Design law 2 says "every screen speaks on entry". Taken literally it meant the app read
 * its own navigation aloud: open Products, hear "Products". Open Orders, hear "Orders".
 * The artisan pressed that button — they know where they are, and being told anyway is a
 * voice people learn to talk over. This app has nothing else with which to reach someone
 * who cannot read, so a voice they tune out is the whole interface lost.
 *
 * (An earlier attempt spoke each title only the FIRST time per route. Still wrong, just
 * less often: the problem was never the repetition, it was announcing a label nobody
 * asked for.)
 *
 * The distinction is LABEL vs INSTRUCTION:
 *
 *   destination  the prompt names the screen you chose to open. Silent. The replay button
 *                is on every screen, in the same place, and speaks it on demand — which is
 *                what "say the contents if the user wants it" means.
 *   chain        the prompt IS the interface. Onboarding and the create flow (ui/
 *                onboarding.js) ask live questions expecting an answer right now, and they
 *                are new every time somebody starts a new listing however often they have
 *                heard the words. Always spoken.
 *   force        a destination whose content is the point rather than its name — /consent,
 *                where a notice nobody heard is not consent. Opt in explicitly.
 *
 * Repeating instructions (the camera gate) go through useSpeakOnChange and are untouched.
 */
/**
 * @param onSpoken called once the prompt has finished, and NOT if the screen was left
 *   part-way through. It exists so a screen can act the moment the question stops playing —
 *   see /catalog/voice, which opens the microphone there so the artisan only has to speak.
 *   Held in a ref so an inline arrow does not restart the speech on every parent render.
 */
export function useSpeakOnEnter(
  key?: string | null,
  vars?: Vars,
  also?: string | string[],
  onSpoken?: () => void,
  force = false,
) {
  const { say } = useVoice();
  const varsRef = useRef<Vars | undefined>(vars);
  varsRef.current = vars;
  const doneRef = useRef<(() => void) | undefined>(onSpoken);
  doneRef.current = onSpoken;
  // Arrays are re-created every render; keying the effect on the identity would restart the
  // speech on every parent render. The joined string is the thing that actually matters.
  const alsoKey = Array.isArray(also) ? also.join(' ') : (also ?? '');

  useEffect(() => {
    if (!key && !alsoKey) return undefined;

    // window.location, not useLocation: this hook is used by the UI kit, which has no
    // business importing the router, and by the time an effect runs the router has already
    // committed the new pathname.
    const here = window.location.pathname;
    // A suppressed key still reports "spoken": the caller's follow-on action is about the
    // question having been PUT, and one the artisan already heard has been put. Bailing out
    // here would silently disable the auto-microphone on a repeat visit.
    const silent = !force && !stepOf(here);

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
export function useSpeakOnChange(key?: string | null, vars?: Vars) {
  const { say } = useVoice();
  const last = useRef<string | null | undefined>(undefined);
  const varsRef = useRef<Vars | undefined>(vars);
  varsRef.current = vars;

  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    if (key) say(key, varsRef.current);
  }, [key, say]);
}
