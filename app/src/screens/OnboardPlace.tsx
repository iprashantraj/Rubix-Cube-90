import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { record, transcribe, type RecHandle } from '../voice/listen';
import { t } from '../i18n/index';
import { Screen, BigButton, YesNo, MicButton, Heard } from '../ui/kit';
import { IconRetry, IconNext } from '../ui/icons';
import {
  DIGIT_WORDS,
  JOINERS,
  NUMBER_WORDS,
  TENS_EN,
  UNITS_EN,
  digitOf,
} from '../voice/numberWords';

/**
 * /onboard/place — the PIN code. By voice. There is no text field on this screen and
 * there must never be one: design law rule 3 says nothing is typed except the OTP, and a
 * six-digit numeric field is exactly the kind of "but it's only six digits" exception
 * that puts a QWERTY keyboard in front of someone who cannot read.
 *
 * The PIN code earns its place in onboarding because three later things need it: courier
 * serviceability, cluster auto-link, and the intra-state check that decides the GST route
 * (§6.1). None of them can be inferred from anything else we hold.
 */

/**
 * Pull a PIN code out of whatever was said. Tolerant on purpose: the transcript is
 * routinely "mera pincode 753001 hai" or six separate words with filler between them, and
 * re-asking someone who answered correctly is its own kind of failure.
 *
 * We take the first run of six digits that does not start with 0, because no Indian PIN
 * code does — that single constraint is what lets us survive a stray leading digit from a
 * mis-heard filler word instead of blindly slicing the first six.
 *
 * Returns '' when we did not get six digits. Never a guess: the caller re-asks. The
 * confirmation step is what catches everything this misses.
 */
export function extractPincode(transcript: string | null | undefined): string {
  // Digits are grouped into RUNS, broken by any word we do not recognise. Concatenating
  // every digit in the transcript into one string is what makes "ek minute, 753001" come
  // back as 175300: "ek" is 1, and the six-digit window then slides one place left. That
  // is not a near miss — 175300 is a real-looking PIN code that passes every check below,
  // gets read back as six plausible digits, and gets confirmed. The artisan then has the
  // wrong courier serviceability and the wrong cluster, and nothing ever says why.
  // "ek" is not an edge case either; "ek minute" and "ek baar" are ordinary Hindi filler.
  const runs = [];
  let run = '';
  const toks = String(transcript ?? '').toLowerCase().split(/[\s,.\-–—]+/);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (DIGIT_WORDS[tok] !== undefined) {
      run += DIGIT_WORDS[tok];
      continue;
    }
    // English composes: "forty" + "five" is one two-digit number, not 40 followed by 5.
    // Consume both. A tens word with nothing after it is the round number.
    if (TENS_EN[tok] !== undefined) {
      const unit = UNITS_EN[toks[i + 1]];
      if (unit !== undefined) {
        run += TENS_EN[tok] + unit;
        i++;
      } else {
        run += TENS_EN[tok] + '0';
      }
      continue;
    }
    // "इक्कीस" contributes two digits at once. Same run, because it is the same number.
    if (NUMBER_WORDS[tok] !== undefined) {
      run += NUMBER_WORDS[tok];
      continue;
    }
    // A joiner is not a boundary and not a digit — skip it and keep the run alive.
    if (JOINERS.has(tok)) continue;
    // A bare numeral token ("753001", "७५३"). Anything with letters mixed in is a word we
    // do not know, and guessing at it is how you end up shipping to the wrong district.
    let numeral = '';
    for (const ch of tok) {
      const d = digitOf(ch);
      if (!d) {
        numeral = '';
        break;
      }
      numeral += d;
    }
    if (/^[1-9]\d{5}$/.test(numeral)) {
      // A single token that is already a whole valid PIN code. The ASR emitting all six
      // digits as one token is the strongest signal we get that this is the number and not
      // part of one, so it stands alone rather than joining whatever was said next to it —
      // otherwise "zero 753001" and "753001 ek baar" both dissolve into an ambiguous run.
      if (run) runs.push(run);
      runs.push(numeral);
      run = '';
    } else if (numeral) {
      run += numeral;
    } else if (run) {
      runs.push(run);
      run = '';
    }
  }
  if (run) runs.push(run);

  // Exactly one run of exactly six digits, not starting with 0 (no Indian PIN does). Any
  // other shape is ambiguous, and on an ambiguous answer we return nothing and re-ask —
  // the caller already speaks `onboard.place_bad` for this. Re-asking someone costs eight
  // seconds; a confidently wrong PIN code costs them a delivery they never find out about.
  // Same reasoning as classifyYesNo() in voice/listen.js returning null rather than guessing.
  const valid = runs.filter((r) => /^[1-9]\d{5}$/.test(r));
  return valid.length === 1 ? valid[0] : '';
}

export default function OnboardPlace() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const patchArtisan = useSession((s) => s.patchArtisan);

  const [phase, setPhase] = useState('ask');
  const [pin, setPin] = useState('');
  // The transcript the digits were pulled OUT of. extractPincode() is a parser, and a
  // parser's output is worth nothing to someone who cannot see its input.
  const [rawHeard, setRawHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecHandle | null>(null);

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
      const found = extractPincode(transcript);
      if (!found) {
        // We heard something, it just was not six digits. Different message from "ASR is
        // down" and different from "say it again" — one problem at a time, named exactly.
        setPhase('ask');
        return fail(new Error('no_pin'), 'onboard.place_bad');
      }
      setPin(found);
      setRawHeard((transcript ?? '').trim());
      setPhase('confirm');
    } catch (e) {
      // The 503 path — live in dev. Retry, or move on: the PIN code is asked for again by
      // the courier setup the first time a product actually sells, so a miss here costs a
      // later prompt, while a dead end here costs the whole onboarding.
      setPhase('fail');
      fail(e, 'voice.unavailable');
    }
  }

  async function save() {
    setError(null);
    // See OnboardName.save() — 'busy' re-asks the question mid-save.
    setPhase('saving');
    try {
      await api.patch('/me', { pincode: pin });
      patchArtisan({ pincode: pin });
      nav('/onboard/ready');
    } catch (e) {
      setPhase('confirm');
      fail(e, 'net.offline');
    }
  }

  async function skip() {
    await say('onboard.skipped');
    nav('/onboard/ready');
  }

  const confirming = phase === 'confirm' || phase === 'saving';
  // Spaced so TTS reads it back digit by digit — "seven five three zero zero one", not
  // "seven hundred and fifty-three thousand and one", which nobody can check against the
  // number on their own post office board.
  const spaced = pin.split('').join(' ');

  return (
    <Screen
      prompt={confirming ? 'onboard.place_confirm' : 'onboard.place'}
      promptVars={{ pincode: spaced }}
    >
      {error && <p className="warn">{t(lang, error)}</p>}

      {/* The same mic as every other voice screen — see MicButton in ui/kit.jsx. Six
          digits spoken into a phone that shows no sign of listening is the single most
          re-recorded thing in the flow, so this screen benefits from it most. */}
      {(phase === 'ask' || phase === 'rec' || phase === 'busy') && (
        <MicButton
          state={phase === 'rec' ? 'listening' : phase === 'busy' ? 'thinking' : 'idle'}
          onClick={phase === 'rec' ? stopRec : startRec}
        />
      )}

      {confirming && (
        <>
          {/* Wide letter-spacing for the same reason the voice is spaced: six digits in a
              block are one shape, six spread out are six things you can check one by one. */}
          <p style={{ fontSize: 40, fontWeight: 700, letterSpacing: 8, margin: 0 }}>{pin}</p>
          {/* The sentence the digits were pulled out of. extractPincode() deliberately
              tolerates filler — "ek minute, 753001" — so the artisan needs to see what it
              was working from to know whether it took the right six. */}
          <Heard text={rawHeard} lang={lang} />
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

/*
 * Self-check for the parser, in the same spirit as camera/gate.js. Dev-only: Vite folds
 * `import.meta.env.DEV` to false and drops the whole block from the production bundle, so
 * this costs the artisan's phone nothing. It runs on every dev load of this route, which
 * is exactly when someone is likely to be editing DIGIT_WORDS.
 */
if (import.meta.env.DEV) {
  const ok = (got: unknown, want: unknown, why: string) => {
    if (got !== want) console.error(`[onboard/place] ${why}: got "${got}", want "${want}"`);
  };
  ok(extractPincode('753001'), '753001', 'bare digits');
  ok(extractPincode('mera pincode 753001 hai'), '753001', 'digits with filler');
  ok(extractPincode('saat panch teen shunya shunya ek'), '753001', 'romanised hindi words');
  ok(extractPincode('सात पांच तीन शून्य शून्य एक'), '753001', 'devanagari words');
  ok(extractPincode('ସାତ ପାଞ୍ଚ ତିନି ଶୂନ୍ୟ ଶୂନ୍ୟ ଏକ'), '753001', 'odia words');
  ok(extractPincode('७५३००१'), '753001', 'devanagari numerals');
  ok(extractPincode('୭୫୩୦୦୧'), '753001', 'odia numerals');
  ok(extractPincode('seven five three zero zero one'), '753001', 'english words');
  ok(extractPincode('zero 753001'), '753001', 'leading stray zero skipped');
  // Regressions. An earlier version concatenated every digit in the transcript into one
  // string and took the first six-digit match, so "ek minute, 753001" came back as 175300
  // — a valid-looking PIN code, confirmed by a user who had answered correctly. "ek" and
  // "do" are ordinary Hindi filler, not contrived input. Do not merge the runs again.
  ok(extractPincode('ek minute, 753001'), '753001', 'leading filler digit-word');
  ok(extractPincode('do teen 753001'), '753001', 'two leading filler digit-words');
  ok(extractPincode('753001 ek baar'), '753001', 'trailing filler digit-word');
  ok(extractPincode('753001 110001'), '', 'two candidates is ambiguous — re-ask');
  // Grouped tails. Nobody reads all six digits separately to the end; the last two get
  // said as one word, and this failed on a real phone for a perfectly clear answer.
  ok(extractPincode('छह दो छह दो इक्कीस'), '626221', 'two-digit word finishes the code');
  ok(extractPincode('chhe do chhe do ikkis'), '626221', 'romanised, same answer');
  ok(extractPincode('छह दो छह दो और इक्कीस'), '626221', '"aur" joins, it does not break');
  ok(extractPincode('seven five three zero zero one'), '753001', 'english is unaffected');
  /*
   * Three pairs, all the way through. This is how a PIN code is most often actually said,
   * and every one of these failed before: the Hindi table stopped at 30, and English built
   * "202" out of "twenty two". Nobody reads six digits singly to the end.
   */
  ok(extractPincode('twenty two forty five thirty six'), '224536', 'english as three pairs');
  ok(extractPincode('बाईस पैंतालीस छत्तीस'), '224536', 'devanagari as three pairs');
  ok(extractPincode('bais paintalis chhattis'), '224536', 'romanised hindi as three pairs');
  ok(extractPincode('ninety nine ninety nine ninety nine'), '999999', 'top of the english range');
  ok(extractPincode('निन्यानवे निन्यानवे निन्यानवे'), '999999', 'top of the hindi range');
  ok(extractPincode('forty five thirty six twenty two'), '453622', 'order is preserved');
  ok(extractPincode('seventy five three zero zero one'), '753001', 'a pair then singles');
  ok(extractPincode('twenty two forty five thirty six aur'), '224536', 'trailing joiner');
  // A tens word with no unit after it is the round number, not a dangling 2.
  ok(extractPincode('twenty forty fifty ten'), '', 'four pairs is eight digits — re-ask');
  ok(extractPincode('forty fifty sixty'), '405060', 'round tens compose to six digits');
  // Regression on the composition itself: this used to append '20' then '2' and make "202".
  ok(extractPincode('twenty two'), '', 'two digits alone is not a PIN code');
  ok(extractPincode('bees'), '', 'a number word alone is not a PIN code');
  ok(extractPincode('75300'), '', 'five digits is not a pincode');
  ok(extractPincode(''), '', 'silence');
  ok(extractPincode(null), '', 'no transcript at all');
}
