import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LANGUAGES, t, resolve } from '../i18n/index.js';
import { speak, unlockAudio, isUnlocked, onUnlock } from '../voice/speak.js';
import { useSession } from '../store.js';
import { Screen, Grid, Tile } from '../ui/kit.jsx';
import { IconLanguage, IconReplay } from '../ui/icons.jsx';

/**
 * /lang — the first screen anyone ever sees.
 *
 * Two rules here that are easy to get wrong:
 *
 *   1. No English default. Defaulting to English tells a Odia speaker the app was not
 *      built for them, on screen one.
 *   2. Every tile is self-voicing — tapping plays the language's own name in that
 *      language. Someone who cannot read any script on this screen can still find theirs
 *      by ear, which is the whole point.
 *
 * The prompt is spoken in every language in turn on entry, because at this exact moment
 * we do not yet know which one they speak.
 */

/**
 * The tap-to-begin gate.
 *
 * Browsers refuse to make any sound before a user gesture, and this screen speaks on
 * mount — so on a laptop the very first prompt was being swallowed silently, which is
 * what made the whole app look mute. One tap buys the audio path for the entire session.
 *
 * It never appears on a phone: engine.js starts native platforms unlocked, so `isUnlocked`
 * is already true there. That matters — an artisan who cannot read has no way to act on
 * "tap to begin", so a gate they could not get past would be the very bug we are fixing.
 *
 * Labelled in all three languages at once because this is the one moment in the app where
 * we genuinely do not know which one they speak. The speaker icon carries it for anyone
 * who reads none of them.
 *
 * Deduped by resolved string, not by language code: `t()` falls back to English for any
 * key a language has not been reviewed for yet (see the _note in strings/or.json), so
 * mapping over LANGUAGES blindly renders "Tap to begin" two or three times over. The set
 * grows back to three lines on its own as translations land.
 */
function Begin({ onBegin }) {
  const labels = [...new Set(LANGUAGES.map((l) => t(l.code, 'lang.begin')))];
  return (
    <button className="begin" onClick={onBegin}>
      <IconReplay size={44} strokeWidth={2} aria-hidden />
      {labels.map((label) => (
        <span key={label} className="begin__label">
          {label}
        </span>
      ))}
    </button>
  );
}

export default function LangPick() {
  const nav = useNavigate();
  const setLang = useSession((s) => s.setLang);

  // Initialised from isUnlocked() rather than `false`: onUnlock does not fire
  // retroactively, so a screen that mounts already-unlocked (every native launch, and any
  // browser return visit where something was tapped earlier) would otherwise wait forever
  // for an event that has already happened.
  const [ready, setReady] = useState(isUnlocked);
  useEffect(() => onUnlock(() => setReady(true)), []);

  // Say the prompt in each language in turn, and only once audio is actually permitted —
  // starting the rotation before the unlock would burn all three prompts on a muted
  // output and leave the screen looking broken.
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      for (const l of LANGUAGES) {
        if (cancelled) return;
        // resolve(), not t(): if a language is missing `lang.title` we would otherwise
        // read the English string in that language's voice — which on this screen is
        // precisely the wrong signal, since the whole point is "this is what your language
        // sounds like". Better an honest English voice than a mangled Odia one.
        const r = resolve(l.code, 'lang.title');
        await speak(r.text, r.lang);
        await new Promise((rs) => setTimeout(rs, 1400));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  function choose(code) {
    setLang(code);
    nav('/consent');
  }

  if (!ready) {
    return (
      <Screen>
        <Begin onBegin={unlockAudio} />
      </Screen>
    );
  }

  return (
    <Screen>
      <h1 className="lang__title">{t('en', 'lang.title')}</h1>
      <Grid>
        {LANGUAGES.map((l) => (
          <Tile key={l.code} icon={IconLanguage} label={l.label} onClick={() => choose(l.code)} />
        ))}
      </Grid>
    </Screen>
  );
}
