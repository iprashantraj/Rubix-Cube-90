import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useDraft } from '../store';
import { useVoice } from '../voice/useVoice';
import { record, transcribe, type RecHandle } from '../voice/listen';
import { interpretAnswer } from '../voice/interpret';
import { t } from '../i18n/index';
import { Screen, BigButton, Card, MicButton, Heard } from '../ui/kit';
import { IconWrite, IconNext, IconYes, IconBack, IconRetry } from '../ui/icons';

/**
 * /catalog/voice — the multilingual auto-cataloger. Spec §6.3, PS feature 2.
 *
 * Five questions, one at a time (design law rule 4). A single screen asking all five is a
 * form, and a form is a literacy test with extra steps.
 *
 * ── The photo is on screen, and that is the point ───────────────────────────────────
 * This screen used to ask "yeh kya hai?" with the product nowhere to be seen. Think about
 * what that actually asks of someone: hold in your head which of five questions is running,
 * remember that it refers to the object you photographed two screens ago, and answer into a
 * phone that gives you no sign it is listening. The photo above the question turns a memory
 * test into a caption task — you look at the thing, you say what it is. It is the same
 * photo they framed themselves thirty seconds ago, so it needs no explaining.
 *
 * ── Progress is dots, not a sentence ────────────────────────────────────────────────
 * "सवाल 3, कुल 5" is a sentence containing two numerals, which is precisely the thing our
 * users cannot read. Five dots filling up is understood by everyone who has ever seen a
 * phone.
 *
 * ── Typing is an escape hatch, never the path ───────────────────────────────────────
 * Design law rule 3 says nothing is typed except the OTP, and that rule is right. But the
 * only alternative this screen used to offer a broken microphone was "skip", i.e. lose the
 * answer. With ASR down that is not a fallback, it is a data-loss button dressed as one.
 *
 * So typing exists, and it is deliberately hard to reach by accident: never rendered until
 * asked for, never the first thing on screen, drawn in `.help` — the quietest style in the
 * app — and sat next to skip rather than under the mic on its own. Someone who can speak
 * will never find themselves in it. Someone whose mic is dead has a way to finish. Skip
 * stays as the last resort, because "this question does not apply to my product" is still a
 * real answer.
 *
 * ── ASR is 503 today ────────────────────────────────────────────────────────────────
 * /api/asr answers 503 until a Bhashini key exists (web/api/routers/voice.py), so
 * transcribe() throwing is the live path in dev, not an edge case. Every failure speaks,
 * returns to a pressable mic, and leaves both alternatives visible. Nothing here dead-ends,
 * and with five skips the artisan still reaches /catalog/review, where the vision pre-fill
 * from the previous screen is waiting to carry the listing on its own.
 */

const QUESTIONS = [
  { field: 'what', key: 'catalog.q_what' },
  { field: 'material', key: 'catalog.q_material' },
  { field: 'time', key: 'catalog.q_time' },
  { field: 'special', key: 'catalog.q_special' },
  { field: 'size', key: 'catalog.q_size' },
];

/**
 * Same rule as /catalog/prefill: the AI service returns `s3://` URLs (ai/contracts.md),
 * which no <img> renders, and on a dev box there is no enhancement at all. The artisan's
 * own photo is always displayable and is always the same object.
 */
function displayable(url?: string | null, fallback?: string | null) {
  return url && /^https?:/.test(url) ? url : fallback;
}

export default function CatalogVoice() {
  const nav = useNavigate();
  const { say, shutUp, lang } = useVoice();
  const productId = useDraft((s) => s.listing?.product_id);
  const photoUrl = useDraft((s) => s.photoUrl);
  const images = useDraft((s) => s.images);
  const answer = useDraft((s) => s.answer);

  // ask -> rec -> busy -> (next question)
  //   └-> type -> (next question)
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState('ask');
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecHandle | null>(null);

  if (!productId) return <Navigate to="/camera" replace />;

  const q = QUESTIONS[i];

  /** Errors speak, never just render (spec §6.7). */
  function fail(key: string) {
    setError(key);
    say(key);
  }

  function next() {
    setError(null);
    setTyped('');
    setHeard('');
    setPhase('ask');
    if (i + 1 < QUESTIONS.length) setI(i + 1);
    else nav('/catalog/review');
  }

  /*
   * The question finished playing — open the microphone.
   *
   * The artisan should not have to find and press a button between hearing a question and
   * answering it. Nobody does that in a conversation, and for a user who cannot read the
   * screen, "now press the round thing" is an extra instruction we would have to give in
   * order to ask a question we have already asked.
   *
   * Guarded on phase because the prompt also finishes in situations where an open mic
   * would be wrong: after an error has been spoken, while a previous clip is transcribing,
   * or while they are typing an answer instead.
   */
  function autoListen() {
    if (phase === 'ask' && !recRef.current) startRec();
  }

  // MicButton swallows a second tap while this is still running, so a double press cannot
  // start two recordings.
  async function startRec() {
    setError(null);
    try {
      // The prompt is very likely still playing, and an open microphone would record it and
      // hand our own question back to the recogniser as the artisan's answer. So: stop
      // talking, THEN open the mic.
      //
      // It used to also `await say('catalog.listening')` here, which meant a second of
      // "ab boliye" between the tap and the microphone existing — and an artisan who
      // started answering during that second was recorded from halfway through their own
      // sentence. record() now sounds a 140ms tone at the exact moment capture begins
      // (voice/listen.js), which is the same promise kept honestly.
      shutUp();
      // `onSilence` is what closes the microphone when they stop talking, and leaving it off
      // meant this screen never closed it at all — the recording ran until somebody tapped
      // the button a second time. That is a convention learned from other apps, and the
      // whole premise of listen.js is that our users do not have those apps. They answer the
      // question and then wait, which here was an open mic recording the room until they
      // gave up. Every onboarding screen passed this; the two cataloguer screens did not.
      recRef.current = await record({ onSilence: stopRec });
      setPhase('rec');
    } catch {
      fail('voice.mic_denied');
    }
  }

  async function stopRec() {
    const handle = recRef.current;
    recRef.current = null;
    if (!handle) return;
    setPhase('busy');
    try {
      const { transcript } = await transcribe(await handle.stop(), lang);
      const said = (transcript ?? '').trim();
      if (!said) {
        setPhase('ask');
        return fail('voice.not_heard');
      }
      /*
       * Show it back before moving on.
       *
       * This used to `answer(field, said)` and advance immediately, so the artisan never
       * once saw what had been recorded — five questions answered into a phone that gave no
       * sign of what it had understood, and the first sight of any of it was on
       * /catalog/review at the end, as a finished listing. If the recogniser misheard
       * question two, they found out four questions later with no idea which one was wrong.
       *
       * The answer is still stored here rather than on confirm: it is theirs either way,
       * and re-recording overwrites it. What the extra beat buys is the chance to notice.
       */
      /*
       * Reduce the sentence to the answer before storing it.
       *
       * "yeh cotton ki saree hai" is an answer to "what is it made of", but the field that
       * feeds the category mapping and the pricing comparables wants "cotton", not the
       * sentence. Same interpreter as the name screen — local carrier-strip first, model
       * only when that cannot reduce it. See voice/interpret.js.
       *
       * Falls back to the raw sentence rather than dropping it: an un-reduced answer is
       * still the artisan's answer, and /catalog/review is a second chance to fix it.
       */
      const { value, raw } = await interpretAnswer({
        transcript: said,
        question: q.key,
        lang,
      });
      answer(q.field, value ?? raw);
      // Show the sentence they actually said, not our reduction of it — the reduction is
      // what we are asking them to trust, so the evidence has to be the original.
      setHeard(raw);
      setPhase('heard');
      return undefined;
    } catch {
      // Server 503, no network, or nothing intelligible in the clip. All three mean the
      // same thing to the artisan and get the same sentence: we did not hear you — say it
      // again, write it, or leave it out.
      setPhase('ask');
      return fail('voice.asr_down');
    }
  }

  function saveTyped() {
    const v = typed.trim();
    if (v) answer(q.field, v);
    next();
  }

  const image = displayable(images?.[0]?.url, photoUrl);

  /*
   * Actions live in the footer, pinned to the bottom of the screen. They used to sit
   * directly under the heading, which on a 6.7" phone put the primary control at roughly
   * 40% of the height with a void below it and out of comfortable thumb reach.
   */
  const footer =
    phase === 'type' ? (
      <>
        <textarea
          className="type"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t(lang, 'voice.type_placeholder')}
          rows={3}
          autoFocus
        />
        <BigButton
          icon={IconYes}
          labelKey="voice.type_done"
          onClick={saveTyped}
          disabled={!typed.trim()}
        />
        <div className="alt">
          {/* Back to the mic, not out of the question. Voice stays the way home. */}
          <button className="help" onClick={() => setPhase('ask')}>
            <IconBack size={20} aria-hidden="true" />
            <span>{t(lang, 'voice.tap_to_speak')}</span>
          </button>
        </div>
      </>
    ) : phase === 'heard' ? (
      <>
        {/* What we got, in their own words, before it counts. The mic is still the way to
            fix it — re-recording overwrites the answer — so "say it again" is the quiet
            option and moving on is the loud one. */}
        <Heard text={heard} lang={lang} />
        <BigButton icon={IconNext} labelKey="common.next" onClick={next} />
        <div className="alt">
          <button className="help" onClick={startRec}>
            <IconRetry size={20} aria-hidden="true" />
            <span>{t(lang, 'common.retry')}</span>
          </button>
        </div>
      </>
    ) : (
      <>
        <MicButton
          state={phase === 'rec' ? 'listening' : phase === 'busy' ? 'thinking' : 'idle'}
          onClick={phase === 'rec' ? stopRec : startRec}
        />
        {/* Hidden while recording and while transcribing: mid-answer is not the moment to
            offer someone two ways to abandon it, and it keeps the screen at one target. */}
        {phase === 'ask' && (
          <div className="alt">
            <button className="help" onClick={() => setPhase('type')}>
              <IconWrite size={20} aria-hidden="true" />
              <span>{t(lang, 'voice.type_instead')}</span>
            </button>
            <button className="help" onClick={next}>
              <IconNext size={20} aria-hidden="true" />
              <span>{t(lang, 'common.skip')}</span>
            </button>
          </div>
        )}
      </>
    );

  return (
    <Screen prompt={q.key} footer={footer} onPromptSpoken={autoListen}>
      <div className="qdots">
        {QUESTIONS.map((item, n) => (
          <i
            key={item.field}
            className={n === i ? 'qdots--now' : n < i ? 'qdots--done' : undefined}
          />
        ))}
      </div>

      {/* alt="" on purpose: the photo is not describable by us — describing it is literally
          the question being asked — and a screen reader announcing a filename here would be
          noise on top of the spoken prompt. */}
      {image && (
        <Card>
          <img className="subject" src={image ?? undefined} alt="" />
        </Card>
      )}

      {error && <p className="warn">{t(lang, error)}</p>}
    </Screen>
  );
}
