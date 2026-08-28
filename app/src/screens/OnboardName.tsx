import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { record, transcribe, type RecHandle } from '../voice/listen';
import { interpretAnswer } from '../voice/interpret';
import { t } from '../i18n/index';
import { Screen, BigButton, YesNo, Heard } from '../ui/kit';
import { AnswerBox } from '../ui/AnswerBox';
import { IconRetry, IconNext } from '../ui/icons';

/**
 * /onboard/name — "Aapka naam kya hai?" → voice → ASR → confirm aloud.
 *
 * Why the confirm step is not optional: this name goes on every listing, every invoice
 * and every ONDC record we create for them. ASR on a noisy courtyard mic mishears names
 * constantly, and a wrong one accepted silently is not discovered until weeks later when
 * a buyer reads it. So we say back exactly what we heard and make them agree. Hearing
 * their own name mispronounced is the cheapest possible error report.
 *
 * The prompt key swaps between ask and confirm. Screen speaks whatever key it is given on
 * entry, so the swap does the confirmation announcement for us — and the heading on
 * screen and the words in the ear are, as always, literally the same string.
 */
export default function OnboardName() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const patchArtisan = useSession((s) => s.patchArtisan);

  // ask -> rec -> busy -> confirm -> (save) -> /onboard/craft
  //                         └-> fail (retry | skip)
  const [phase, setPhase] = useState('ask');
  const [heard, setHeard] = useState('');
  // Their whole sentence, kept beside the extracted name so the confirmation shows
  // both — what we heard, and what we made of it.
  const [rawHeard, setRawHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecHandle | null>(null);

  /** Errors speak, never just render (spec §6.7). Server errors carry a key we can say. */
  function fail(e: unknown, fallbackKey: string) {
    const key = e instanceof ApiError ? e.messageKey : null;
    setError(key ?? fallbackKey);
    say(key ?? fallbackKey);
  }

  async function startRec() {
    setError(null);
    try {
      // Mic FIRST, state second. record() resolves only once it is genuinely capturing
      // and sounds a short tone at that exact moment (voice/listen.js), so "listening" is
      // true from the frame it appears. This used to `await say('voice.listening')` first,
      // which announced the microphone about a second before opening it and swallowed
      // whatever the artisan said in reply to the question.
      // onSilence: the artisan answers and then waits. Nobody told them to press the button
      // again, and pressing-to-stop is a habit from apps they have never used.
      recRef.current = await record({ onSilence: stopRec });
      setPhase('rec');
    } catch (e) {
      setPhase('fail');
      fail(e, 'voice.mic_denied');
    }
  }

  async function stopRec() {
    const handle = recRef.current;
    recRef.current = null;
    if (!handle) return;
    setPhase('busy');
    try {
      const { transcript } = await transcribe(await handle.stop(), lang);

      /*
       * The sentence is not the name.
       *
       * This stored `transcript.trim()` straight into `display_name`, and the dev database
       * still has the receipts: one artisan row reads "Mera naam Yash hai. My name is
       * Yash." Nobody answers "what is your name" with a bare noun — they answer like a
       * person. See voice/interpret.js.
       */
      const { value, raw } = await interpretAnswer({
        transcript,
        question: 'onboard.name',
        lang,
        // The one place the local carrier table applies — it is built out of "mera naam X
        // hai" and nothing else. Everywhere else defaults to the model; see interpret.js.
        shape: 'name',
      });
      if (!raw) {
        setPhase('fail');
        return fail(new Error('empty'), 'voice.not_heard');
      }
      // Falling back to the whole sentence is deliberate: a name we could not reduce is
      // still better than losing what they said, and the confirm step below shows them
      // exactly what will be saved before it is.
      setHeard(value ?? raw);
      setRawHeard(raw);
      setPhase('confirm');
    } catch (e) {
      // /api/asr answers 503 until a Bhashini key is configured, so this is the LIVE path
      // in dev, not a corner case. It must never dead-end: we say what happened and leave
      // two taps on screen — try again, or move on without a name. The name is editable
      // in /settings later; a stuck onboarding is not recoverable at all.
      setPhase('fail');
      fail(e, 'voice.unavailable');
    }
  }

  /** Save an explicit value — the typed path, which has no confirm step to read `heard`. */
  async function saveName(name: string) {
    setError(null);
    setPhase('saving');
    try {
      await api.patch('/me', { display_name: name });
      patchArtisan({ display_name: name });
      nav('/onboard/craft');
    } catch (e) {
      // Back to the question with what they wrote still on screen, not to a dead end.
      setPhase('confirm');
      fail(e, 'net.offline');
    }
  }

  async function save() {
    setError(null);
    // 'saving', not 'busy'. `busy` drops the confirm UI, so for as long as the PATCH was in
    // flight the screen went back to asking the question — heading, voice and all. The
    // artisan had just answered it; being asked again reads as "that did not work", and the
    // natural response is to say their name a second time into a screen already saving the
    // first one.
    setPhase('saving');
    try {
      await api.patch('/me', { display_name: heard });
      patchArtisan({ display_name: heard });
      nav('/onboard/craft');
    } catch (e) {
      // Back to confirm rather than to a dead error screen: the name we captured is still
      // good, so "yes" simply retries the save and "no" re-records. The confirm UI is the
      // retry UI.
      setPhase('confirm');
      fail(e, 'net.offline');
    }
  }

  async function skip() {
    await say('onboard.skipped');
    nav('/onboard/craft');
  }

  const confirming = phase === 'confirm' || phase === 'saving';

  return (
    <Screen prompt={confirming ? 'onboard.name_confirm' : 'onboard.name'} promptVars={{ name: heard }}>
      {error && <p className="warn">{t(lang, error)}</p>}

      {/* One control across all three voice phases, and it is the same control on every
          voice screen in the app. It is green and pulsing while the mic is open and grey
          while we transcribe, so "is it listening?" is answered by looking, not by
          remembering what the app said a moment ago. Tapping it while live is what stops
          the recording — the second button that used to do that is gone. */}
      {(phase === 'ask' || phase === 'rec' || phase === 'busy') && (
        <AnswerBox
          phase={phase}
          onRecord={startRec}
          onStop={stopRec}
          onTyped={(value) => {
            // A typed name needs no confirmation step. They read it as they wrote it, and
            // the confirm exists because ASR mishears — a keyboard does not.
            setHeard(value);
            setRawHeard(value);
            saveName(value);
          }}
        />
      )}

      {confirming && (
        <>
          {/* Shown large as well as spoken. The prompt string already contains the name,
              so Screen's replay button re-plays the name too — no extra control needed,
              and we stay at two taps. */}
          <p style={{ fontSize: 30, fontWeight: 700, margin: 0 }}>{heard}</p>
          {/* Their whole sentence, faint, under the name we pulled out of it. Confirming a
              name you cannot see the source of is not really confirming anything — and this
              screen now extracts, so there is a source to show. Hidden when the two are the
              same, because repeating it adds nothing. */}
          {rawHeard !== heard && <Heard text={rawHeard} lang={lang} />}
          <YesNo onYes={save} onNo={startRec} />
        </>
      )}

      {phase === 'fail' && (
        <>
          <BigButton icon={IconRetry} labelKey="common.retry" onClick={startRec} />
          <BigButton icon={IconNext} labelKey="common.skip" onClick={skip} tone="no" />
        </>
      )}
    </Screen>
  );
}
