import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSession } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { record, transcribe } from '../voice/listen.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, YesNo, MicButton, Heard } from '../ui/kit.jsx';
import { IconRetry, IconNext } from '../ui/icons.jsx';

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
 * Spoken digit words we accept, romanised and in script, across our three languages.
 * People do not read out a PIN code as a number — they say "saat panch teen shunya shunya
 * ek", and Bhashini will hand that back as words at least as often as as digits.
 *
 * "oh" is in here because English speakers say it for zero and always will.
 */
const DIGIT_WORDS = {
  // English
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  // Hindi, romanised
  shunya: '0', sunya: '0', ek: '1', do: '2', teen: '3', char: '4', chaar: '4',
  paanch: '5', panch: '5', chah: '6', chhah: '6', chhe: '6', che: '6',
  // "no" is deliberately absent as a spelling of nau — it is the English negative, and a
  // stray "no" turning into a 9 inside a PIN code is not a mistake worth risking.
  saat: '7', sat: '7', aath: '8', ath: '8', nau: '9',
  // Hindi, Devanagari
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5',
  'पाँच': '5', 'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9',
  // Odia
  'ଶୂନ୍ୟ': '0', 'ଏକ': '1', 'ଦୁଇ': '2', 'ତିନି': '3', 'ଚାରି': '4', 'ପାଞ୍ଚ': '5',
  'ଛଅ': '6', 'ସାତ': '7', 'ଆଠ': '8', 'ନଅ': '9',
};

/**
 * Digits arrive in whichever numeral system the ASR pipeline felt like using — ASCII,
 * Devanagari (७५३००१) or Odia (୭୫୩୦୦୧). Each block is ten consecutive codepoints starting
 * at its own zero, so one subtraction handles all three and every other Indic script we
 * might add later for free.
 */
const ZEROS = [0x30 /* ASCII */, 0x966 /* Devanagari */, 0xb66 /* Odia */];

function digitOf(ch) {
  const c = ch.codePointAt(0);
  for (const z of ZEROS) if (c >= z && c <= z + 9) return String(c - z);
  return '';
}

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
export function extractPincode(transcript) {
  // Digits are grouped into RUNS, broken by any word we do not recognise. Concatenating
  // every digit in the transcript into one string is what makes "ek minute, 753001" come
  // back as 175300: "ek" is 1, and the six-digit window then slides one place left. That
  // is not a near miss — 175300 is a real-looking PIN code that passes every check below,
  // gets read back as six plausible digits, and gets confirmed. The artisan then has the
  // wrong courier serviceability and the wrong cluster, and nothing ever says why.
  // "ek" is not an edge case either; "ek minute" and "ek baar" are ordinary Hindi filler.
  const runs = [];
  let run = '';
  for (const tok of String(transcript ?? '').toLowerCase().split(/[\s,.\-–—]+/)) {
    if (DIGIT_WORDS[tok] !== undefined) {
      run += DIGIT_WORDS[tok];
      continue;
    }
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
  const [error, setError] = useState(null);
  const recRef = useRef(null);

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
    setPhase('busy');
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

  const confirming = phase === 'confirm';
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
  const ok = (got, want, why) => {
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
  ok(extractPincode('75300'), '', 'five digits is not a pincode');
  ok(extractPincode(''), '', 'silence');
  ok(extractPincode(null), '', 'no transcript at all');
}
