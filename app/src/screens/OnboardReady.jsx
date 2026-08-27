import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSession } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { record, transcribe, classifyYesNo } from '../voice/listen.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, YesNo, Spinner } from '../ui/kit.jsx';
import { IconMic, IconYes, IconRetry } from '../ui/icons.jsx';

/**
 * /onboard/ready — the last four questions, and the entire rest of the signup.
 *
 * 🔒 BOOLEANS ONLY. has_pan is true or false. The PAN number itself never enters this
 * screen, this app, this store or our database — there is no field to type one into and
 * there is no camera path to photograph one. Same for Aadhaar, bank account, GST number
 * and the artisan card. See the lock comments at store.js:12 and web/api/models.py:100;
 * this is spec §14.1 and it is not up for negotiation. What we do not store cannot leak,
 * and knowing *whether* they have a PAN is the only thing the channel router ever needs.
 *
 * One question per screenful, never a list of four (design law rule 4). A four-row form
 * is a reading task; four spoken questions are a conversation, and the difference decides
 * whether this screen is completable at all by our user.
 */
const QUESTIONS = [
  { field: 'has_pan', key: 'onboard.has_pan' },
  { field: 'has_bank', key: 'onboard.has_bank' },
  { field: 'has_gst', key: 'onboard.has_gst' },
  { field: 'has_artisan_card', key: 'onboard.has_artisan_card' },
];

export default function OnboardReady() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const patchArtisan = useSession((s) => s.patchArtisan);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [phase, setPhase] = useState('ask'); // ask | rec | busy
  const [error, setError] = useState(null);
  const recRef = useRef(null);

  const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)];

  function fail(e, fallbackKey) {
    const key = e instanceof ApiError ? e.messageKey : null;
    setError(key ?? fallbackKey);
    say(key ?? fallbackKey);
  }

  /**
   * Record the answer and move on. The final answer carries the whole set with it —
   * `answers` state will not have updated by the time we would read it back, and a PATCH
   * that silently drops the last question is exactly the kind of bug nobody notices until
   * the channel router starts routing on three booleans and a default.
   */
  function answer(value) {
    setError(null);
    const next = { ...answers, [q.field]: value };
    setAnswers(next);
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1);
      setPhase('ask');
    } else {
      save(next);
    }
  }

  async function save(all) {
    setPhase('busy');
    try {
      await api.patch('/me', all);
      patchArtisan({ readiness: all });
      // Straight into the camera. No tour, no dashboard, no "you're all set" screen — the
      // first product matters more than any summary we could show (§4).
      nav('/home');
    } catch (e) {
      // Every answer is still held in state, so the retry button re-sends the same four
      // booleans. Nothing is re-asked.
      setPhase('ask');
      fail(e, 'net.offline');
    }
  }

  const saveFailed = phase === 'ask' && step === QUESTIONS.length - 1 && q.field in answers;

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
      setPhase('ask');
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
      const yn = classifyYesNo(transcript);
      if (yn === null) {
        // Never guess. A wrong answer to "do you have a PAN card" sends someone down the
        // GeM paperwork path — or away from one they qualify for — for days. Re-ask, and
        // say why first, so it does not feel like the app simply ignored them.
        //
        // Said in sequence rather than in one call: speak() supersedes whatever is playing,
        // so a second say() without the await would cut the first one off mid-word.
        setPhase('ask');
        setError('voice.not_understood');
        await say('voice.not_understood');
        return say(q.key);
      }
      setPhase('ask');
      answer(yn);
    } catch (e) {
      // ASR is 503 until Bhashini is keyed, so in dev this fires every time. It costs us
      // nothing: the two big yes/no buttons are the primary path on this screen and voice
      // is the accelerator. We say what went wrong and the artisan taps.
      setPhase('ask');
      fail(e, 'voice.unavailable');
    }
  }

  return (
    <Screen prompt={q.key}>
      {error && <p className="warn">{t(lang, error)}</p>}

      {/*
        Progress as four dots rather than "3 / 4" — a count is a reading task, and this
        only has to answer "how much more of this is there".
        Drawn as elements, not as ●/○ glyphs: those are font-dependent and render at three
        different weights across Android OEM skins, same trap as emoji.
      */}
      <div style={{ display: 'flex', gap: 10, margin: '0 0 20px' }}>
        {QUESTIONS.map((item, i) => (
          <span
            key={item.field}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: i <= step ? 'var(--accent)' : 'var(--line)',
            }}
          />
        ))}
      </div>

      {phase === 'busy' && <Spinner label={t(lang, 'voice.thinking')} />}

      {phase === 'rec' && (
        <>
          <Spinner label={t(lang, 'voice.listening')} />
          <BigButton icon={IconYes} labelKey="voice.stop" onClick={stopRec} tone="yes" />
        </>
      )}

      {phase === 'ask' &&
        (saveFailed ? (
          <BigButton icon={IconRetry} labelKey="common.retry" onClick={() => save(answers)} />
        ) : (
          <>
            {/* Tap or speak — both always available, never one or the other. Three
                tappable things exactly, which is the ceiling (design law rule 1). */}
            <YesNo onYes={() => answer(true)} onNo={() => answer(false)} />
            <BigButton icon={IconMic} labelKey="voice.tap_to_speak" onClick={startRec} tone="no" />
          </>
        ))}
    </Screen>
  );
}
