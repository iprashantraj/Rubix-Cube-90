import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSession } from '../store.js';
import { record, transcribe, classifyYesNo } from '../voice/listen.js';
import { useVoice } from '../voice/useVoice.js';
import { LANGUAGES, t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Grid, Tile, YesNo, Spinner } from '../ui/kit.jsx';
import { THEMES, DEFAULT_THEME } from '../ui/theme.js';
import { IconLanguage, IconMic, IconAlert, IconNo } from '../ui/icons.jsx';

/**
 * /settings — language, what we hold, and the DPDP erasure. Spec §5 row 25, §14.
 *
 * Two things live here and they could not be less alike: one is reversible in a tap, the
 * other cannot be undone by anyone, ever. So they do not share a screen. Picking a language
 * happens on the main view; erasure takes over the whole screen the moment it starts, in
 * the dim variant, with nothing else reachable.
 *
 * Not built, on purpose: editing the name and the readiness flags. Both already have voice
 * flows at /onboard/name and /onboard/ready, and a second way to set the same field is a
 * second way to get it wrong. The flags are shown here read-only because they are the
 * honest answer to "what do you have on me?" — and the answer being this short is the
 * entire point of spec §14.1.
 *
 * ⚠️ ERASURE. Irreversible, and treated like it.
 *
 *   1. entry tap        "mera data mitaayein" from the main view
 *   2. plain statement  every category we hold, read out loud, BEFORE any confirmation is
 *                       offered — an artisan cannot consent to deleting something they were
 *                       never told we had
 *   3. spoken consent   they must SAY "haan". Voice, not a tap, so a pocket press or a
 *                       child with the phone cannot reach the next step
 *   4. final tap        one last explicit confirm, in the danger tone
 *
 * A single tap can never destroy anything here, and steps 3 and 4 are deliberately in
 * different modalities — the failure mode we are guarding against is repeated tapping, and
 * two taps in a row are not two decisions.
 *
 * 🔇 Voice degrades, the right does not. /api/tts and /api/asr are both down without a
 * Bhashini key, and a DPDP right that only works when a government API is up is not a
 * right. If the mic or ASR fails, step 3 falls back to a second explicit yes/no on a screen
 * that restates the whole deletion — still two decisions, still no single tap, and the
 * spoken statement is retried through the device's own TTS by the voice engine anyway.
 *
 * Cheap for us precisely because of the boolean design: no documents to shred, no PAN to
 * expunge, no bank number hiding in a backup. What we don't store cannot leak, and it also
 * cannot be left behind.
 */

const FLAGS = ['has_pan', 'has_bank', 'has_gst', 'has_artisan_card'];

export default function Settings() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const { setLang, setConsent, signOut, setTheme } = useSession();
  const theme = useSession((s) => s.theme) ?? DEFAULT_THEME;

  const [me, setMe] = useState(null);
  const [phase, setPhase] = useState('main'); // main | explain | consent | final | erasing
  const [micFailed, setMicFailed] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/me').then(setMe, (e) => setError(e.messageKey ?? 'error.unknown'));
  }, []);

  function chooseLang(code) {
    // Local first, server second. The artisan hears the change immediately, and a flaky
    // network must never be the reason someone is stuck reading a language they cannot.
    // The PATCH matters for the NEXT device and for anything the server speaks to them.
    setLang(code);
    api.patch('/me', { language: code }).catch(() => {});
  }

  /** Step 3. Voice consent, with a spoken-word gate rather than another button. */
  async function listenForConsent() {
    setListening(true);
    setError(null);
    try {
      const rec = await record();
      await new Promise((r) => setTimeout(r, 3000));
      const { transcript } = await transcribe(await rec.stop(), lang);
      const answer = classifyYesNo(transcript);
      if (answer === true) {
        setPhase('final');
      } else {
        // null (not understood) is treated exactly like "no". On an irreversible action,
        // an ambiguous transcript is not consent, and re-asking costs nothing.
        say('settings.erase_not_heard');
        setPhase('main');
      }
    } catch {
      // Mic denied or ASR unreachable. Degrade to a second explicit tap — see the 🔇 note.
      setMicFailed(true);
      say('settings.erase_mic_off');
    } finally {
      setListening(false);
    }
  }

  async function erase() {
    setPhase('erasing');
    try {
      await api.del('/me');
      say('settings.erased');
      // Erasure means the local copy too. Token, profile, language and the consent artifact
      // all live in localStorage; leaving them behind would mean the phone still knows who
      // they were after the server has forgotten.
      signOut();
      setConsent(null);
      setLang(null);
      // The colour too. It is not personal data, but an app that says "everything has been
      // erased" and comes back still wearing the palette they chose has visibly kept
      // something, and that is the only evidence they have either way.
      setTheme(null);
      useSession.persist?.clearStorage?.();
      nav('/lang', { replace: true });
    } catch (e) {
      const key = e.messageKey ?? 'error.unknown';
      setError(key);
      say(key);
      setPhase('main');
    }
  }

  // -- the destructive path takes the whole screen ---------------------------
  // `dim` is not decoration: it removes every other affordance from view so there is
  // nothing here but the decision. Design law rule 4, applied to a consequence.

  if (phase === 'erasing') {
    return (
      <Screen prompt="settings.erasing" dim>
        <Spinner label={t(lang, 'settings.erasing')} />
      </Screen>
    );
  }

  if (phase === 'explain' || phase === 'consent' || phase === 'final') {
    return (
      <Screen prompt={PROMPT[phase]} dim>
        <Card>
          {/* Step 2 — said before any confirmation is offered, and itemised. "Your data"
              is not informed consent; a list someone can hear and check off is. */}
          <p style={{ margin: 0 }}>
            <IconAlert size={20} aria-hidden /> {t(lang, 'settings.erase_what')}
          </p>
        </Card>

        {phase === 'explain' && (
          <YesNo onYes={() => setPhase('consent')} onNo={() => setPhase('main')} />
        )}

        {phase === 'consent' &&
          (micFailed ? (
            // The fallback second decision. Still not a repeat tap on the same button —
            // different screen, different words, and the deletion is restated above it.
            <>
              <Card>
                <p style={{ margin: 0 }}>{t(lang, 'settings.erase_mic_off')}</p>
              </Card>
              <YesNo onYes={() => setPhase('final')} onNo={() => setPhase('main')} />
            </>
          ) : (
            <>
              <Card>
                <p style={{ margin: 0 }}>{t(lang, 'settings.erase_say')}</p>
              </Card>
              <BigButton
                icon={IconMic}
                labelKey={listening ? 'setup.listening' : 'setup.speak'}
                onClick={listenForConsent}
                disabled={listening}
              />
              <BigButton icon={IconNo} labelKey="common.no" onClick={() => setPhase('main')} tone="no" />
            </>
          ))}

        {phase === 'final' && (
          <>
            <BigButton
              icon={IconAlert}
              labelKey="settings.erase_confirm"
              onClick={erase}
              tone="danger"
            />
            <BigButton icon={IconNo} labelKey="common.no" onClick={() => setPhase('main')} tone="no" />
          </>
        )}
      </Screen>
    );
  }

  // -- the ordinary screen ---------------------------------------------------
  return (
    // `back` because /settings is not a tab root — the bottom nav is not drawn here, so
    // without it the only way out is the hardware gesture, which is the one convention a
    // first-time phone user is least likely to have.
    <Screen prompt={error ?? 'settings.title'} hero back="/home">
      {error && <p className="warn">{t(lang, error)}</p>}

      <Card>
        <p style={{ margin: '0 0 12px' }}>{t(lang, 'settings.language')}</p>
        <Grid>
          {LANGUAGES.map((l) => (
            // Each tile is labelled in its own script, never translated — "हिन्दी" is
            // recognisable to a Hindi speaker who reads nothing else on this screen.
            <Tile
              key={l.code}
              icon={IconLanguage}
              label={l.label}
              selected={l.code === lang}
              onClick={() => chooseLang(l.code)}
            />
          ))}
        </Grid>
      </Card>

      {/*
        The app's colour. Purely local — it is not sent to the server and never will be:
        it changes nothing about the artisan's listings, and a preference that needs a
        round-trip is a preference that fails on a train.

        Four palettes, same Grid/Tile as the language picker above, so the interaction is
        one someone has already learned two inches higher up the screen. Each swatch paints
        itself in the palette it offers (see .swatch in styles.css) — the preview IS the
        thing, which is the only honest way to offer a choice to someone who cannot read
        the word "terracotta".
      */}
      <Card>
        <p style={{ margin: '0 0 12px' }}>{t(lang, 'settings.theme')}</p>
        <Grid>
          {THEMES.map((th) => (
            <Tile
              key={th.id}
              icon={<span className="swatch" data-theme={th.id} aria-hidden="true" />}
              label={t(lang, th.labelKey)}
              selected={th.id === theme}
              onClick={() => setTheme(th.id)}
            />
          ))}
        </Grid>
      </Card>

      {me && (
        // "What do you have on me?" answered literally. It is a short list on purpose.
        <Card>
          <p style={{ margin: '0 0 10px' }}>{t(lang, 'settings.we_hold')}</p>
          <p style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FLAGS.map((f) => (
              <Chip key={f} tone={me.readiness?.[f] ? 'done' : 'blocked'}>
                {t(lang, `onboard.${f}`)}
              </Chip>
            ))}
          </p>
        </Card>
      )}

      <BigButton
        icon={IconAlert}
        labelKey="settings.erase"
        onClick={() => setPhase('explain')}
        tone="danger"
      />
    </Screen>
  );
}

/** One spoken line per gate. The heading and the audio are the same string, always. */
const PROMPT = {
  explain: 'settings.erase_what',
  consent: 'settings.erase_say',
  final: 'settings.erase_confirm_ask',
};
