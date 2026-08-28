import { useEffect, useState } from 'react';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { BigButton, MicButton } from './kit';
import { IconWrite, IconYes, IconMic } from '../ui/icons';

/**
 * How every question in the app gets answered: speak it, or type it.
 *
 * Three things were wrong before this existed, and all three were reported from a phone.
 *
 * ── 1. Onboarding had no way to type at all ─────────────────────────────────────────
 * The cataloguer grew a keyboard escape months ago, for the honest reason that ASR is 503
 * until Bhashini is keyed and "skip" is a data-loss button dressed as a fallback. The four
 * onboarding screens never got one. So an artisan whose microphone is denied — which is
 * every artisan on first launch, before they tap Allow — reached "what is your name?" with
 * one dead button and no way past it. That is the first screen of the app.
 *
 * ── 2. Reaching for the keyboard once should be enough ──────────────────────────────
 * `prefersTyping` in the session remembers it for the rest of the run. Somebody who typed
 * their name has told us something durable about their microphone or their room, and making
 * them find the quiet escape again on the next three screens is the app arguing with them.
 * The mic stays on screen throughout as the way back — this is a preference, not a mode
 * they get locked into.
 *
 * ── 3. Permission has to be ASKED for, not assumed ──────────────────────────────────
 * `record()` triggers the browser prompt as a side effect of trying to capture, so the very
 * first question doubled as a permission dialog nobody had explained. Worse, a denial is
 * sticky at the OS level: pressing the mic again silently fails forever, looking identical
 * to a broken app. So we ask first, in their language, before anything is captured — and
 * every later press re-asks rather than giving up, because a denial made in confusion on
 * screen one should not be permanent.
 */

export type AnswerBoxProps = {
  /** Open the microphone. Should resolve once genuinely capturing. */
  onRecord: () => void;
  /** Stop and transcribe. */
  onStop: () => void;
  /** Store a typed answer and move on. */
  onTyped: (value: string) => void;
  /** 'ask' | 'rec' | 'busy' — mirrors the caller's own phase machine. */
  phase: string;
  /** Rendered under the keyboard, for screens that have somewhere else to go. */
  extra?: React.ReactNode;
  placeholderKey?: string;
};

export function AnswerBox({
  onRecord,
  onStop,
  onTyped,
  phase,
  extra,
  placeholderKey = 'voice.type_placeholder',
}: AnswerBoxProps) {
  const { lang, say } = useVoice();
  const prefersTyping = useSession((s) => s.prefersTyping);
  const setPrefersTyping = useSession((s) => s.setPrefersTyping);

  const [typing, setTyping] = useState(prefersTyping);
  const [typed, setTyped] = useState('');

  // A preference set on an earlier screen opens this one straight into the keyboard.
  useEffect(() => {
    if (prefersTyping) setTyping(true);
  }, [prefersTyping]);

  /**
   * Ask for the microphone, out loud, before trying to use it.
   *
   * Deliberately re-asks on every press. A denied permission is sticky at the OS level, so
   * the naive "we already asked" guard turns one confused tap on the first screen into a
   * permanently dead button — and the artisan cannot read the browser's own dialog either
   * way. Pressing the mic again is exactly the moment they have decided they DO want it.
   */
  async function ask() {
    try {
      say('voice.mic_ask');
    } catch {
      // TTS is optional infrastructure; the prompt still opens.
    }
    onRecord();
  }

  if (typing) {
    return (
      <>
        <textarea
          className="type"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={t(lang, placeholderKey)}
          rows={2}
          autoFocus
        />
        <BigButton
          icon={IconYes}
          labelKey="voice.type_done"
          onClick={() => {
            const v = typed.trim();
            if (!v) return;
            setTyped('');
            onTyped(v);
          }}
          disabled={!typed.trim()}
          tone="yes"
        />
        {/* Voice is still the design and stays one tap away. Turning the preference back
            off here is what stops "I typed once" becoming "I can never speak again". */}
        <div className="alt">
          <button
            className="help"
            onClick={() => {
              setPrefersTyping(false);
              setTyping(false);
            }}
          >
            <IconMic size={20} aria-hidden="true" />
            <span>{t(lang, 'voice.tap_to_speak')}</span>
          </button>
        </div>
        {extra}
      </>
    );
  }

  return (
    <>
      <MicButton
        state={phase === 'rec' ? 'listening' : phase === 'busy' ? 'thinking' : 'idle'}
        onClick={phase === 'rec' ? onStop : ask}
      />
      {/* Hidden mid-answer: that is not the moment to offer two ways to abandon it. */}
      {phase === 'ask' && (
        <div className="alt">
          <button
            className="help"
            onClick={() => {
              setPrefersTyping(true);
              setTyping(true);
            }}
          >
            <IconWrite size={20} aria-hidden="true" />
            <span>{t(lang, 'voice.type_instead')}</span>
          </button>
        </div>
      )}
      {phase === 'ask' && extra}
    </>
  );
}
