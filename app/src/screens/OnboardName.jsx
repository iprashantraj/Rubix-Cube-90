import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSession } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { record, transcribe } from '../voice/listen.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, YesNo, MicButton } from '../ui/kit.jsx';
import { IconRetry, IconNext } from '../ui/icons.jsx';

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
  const [error, setError] = useState(null);
  const recRef = useRef(null);

  /** Errors speak, never just render (spec §6.7). Server errors carry a key we can say. */
  function fail(e, fallbackKey) {
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
      recRef.current = await record();
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
      const name = (transcript ?? '').trim();
      if (!name) {
        setPhase('fail');
        return fail(new Error('empty'), 'voice.not_heard');
      }
      setHeard(name);
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

  async function save() {
    setError(null);
    setPhase('busy');
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

  const confirming = phase === 'confirm';

  return (
    <Screen prompt={confirming ? 'onboard.name_confirm' : 'onboard.name'} promptVars={{ name: heard }}>
      {error && <p className="warn">{t(lang, error)}</p>}

      {/* One control across all three voice phases, and it is the same control on every
          voice screen in the app. It is green and pulsing while the mic is open and grey
          while we transcribe, so "is it listening?" is answered by looking, not by
          remembering what the app said a moment ago. Tapping it while live is what stops
          the recording — the second button that used to do that is gone. */}
      {(phase === 'ask' || phase === 'rec' || phase === 'busy') && (
        <MicButton
          state={phase === 'rec' ? 'listening' : phase === 'busy' ? 'thinking' : 'idle'}
          onClick={phase === 'rec' ? stopRec : startRec}
        />
      )}

      {confirming && (
        <>
          {/* Shown large as well as spoken. The prompt string already contains the name,
              so Screen's replay button re-plays the name too — no extra control needed,
              and we stay at two taps. */}
          <p style={{ fontSize: 30, fontWeight: 700, margin: '8px 0 20px' }}>{heard}</p>
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
