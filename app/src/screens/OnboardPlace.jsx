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
 * Numbers people say as ONE word for TWO digits.
 *
 * "छह दो छह दो इक्कीस" is 626221, and the old parser heard 6262 followed by a word it did
 * not know, threw the run away and re-asked — for a perfectly clear answer.
 *
 * ⚠️ This table used to stop at 30 plus the round tens, on the theory that a grouped number
 * only ever appears at the END of a spoken PIN code. That was wrong about how people say
 * these. A six-digit code is very commonly read as THREE PAIRS all the way through —
 * "बाईस पैंतालीस छत्तीस" for 224536 — so every value from 10 to 99 is reachable, not just
 * the tail. With the table stopping at 30, "पैंतालीस" was an unknown word, it broke the run,
 * and a perfectly clear answer was re-asked. Hindi and Odia both name every one of these
 * irregularly, so there is no arithmetic shortcut: it has to be the table.
 *
 * A number word we do not know still breaks the run, which is the safe direction: a re-ask
 * costs eight seconds and a wrong district costs a delivery. That is also why nothing here
 * is guessed — see the Odia note below.
 *
 * English is NOT in this table above 19. It composes regularly ("forty five"), so it is
 * handled by TENS_EN/UNITS_EN instead — see the note there, it was an actual bug.
 */
const NUMBER_WORDS = {
  // English — only the irregular 10-19. The rest composes; see TENS_EN.
  ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15',
  sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',

  // Hindi, romanised. Bhashini's romanisation is not stable, so common alternate spellings
  // are included where they are unambiguous. Deliberately NOT included: bare 'sath' (60),
  // because 'saat' is 7 and the two collapse together in careless romanisation — a 7/60
  // confusion inside a PIN code is exactly the silent wrong answer this file exists to avoid.
  das: '10', gyarah: '11', gyara: '11', barah: '12', bara: '12', terah: '13', tera: '13',
  chaudah: '14', chaudha: '14', pandrah: '15', pandra: '15', solah: '16', sola: '16',
  satrah: '17', satra: '17', atharah: '18', athara: '18', unnis: '19', unis: '19',
  bees: '20', bis: '20', ikkis: '21', ikkees: '21', baees: '22', bais: '22',
  teis: '23', chaubis: '24', chaubees: '24', pachchis: '25', pachis: '25',
  chhabbis: '26', chabbis: '26', sattais: '27', atthais: '28', untis: '29', unatis: '29',
  tees: '30', ikattis: '31', ikatis: '31', battis: '32', batis: '32',
  taintis: '33', tentis: '33', chauntis: '34', chautis: '34', paintis: '35', pentis: '35',
  chhattis: '36', chattis: '36', chhatis: '36', saintis: '37', sentis: '37',
  adtis: '38', artis: '38', untalis: '39', unchalis: '39',
  chalis: '40', chaalis: '40', iktalis: '41', ektalis: '41', bayalis: '42', bayalees: '42',
  taintalis: '43', tentalis: '43', chauvalis: '44', chawalis: '44',
  paintalis: '45', pentalis: '45', chhiyalis: '46', chiyalis: '46',
  saintalis: '47', sentalis: '47', adtalis: '48', artalis: '48',
  unchas: '49', unanchas: '49',
  pachas: '50', pachaas: '50', ikyavan: '51', ikavan: '51', bavan: '52', baavan: '52',
  tirpan: '53', tirepan: '53', chauvan: '54', chawan: '54', pachpan: '55',
  chhappan: '56', chappan: '56', sattavan: '57', satavan: '57',
  atthavan: '58', athavan: '58', unsath: '59', unasath: '59',
  saath: '60', iksath: '61', ekasath: '61', basath: '62', baasath: '62',
  tirsath: '63', tiresath: '63', chausath: '64', painsath: '65', pensath: '65',
  chhiyasath: '66', chiyasath: '66', sarsath: '67', sadsath: '67',
  adsath: '68', arsath: '68', unhattar: '69', unahattar: '69',
  sattar: '70', satar: '70', ikhattar: '71', ekahattar: '71', bahattar: '72', bahatar: '72',
  tihattar: '73', tihatar: '73', chauhattar: '74', chauhatar: '74',
  pachhattar: '75', pichhattar: '75', chhihattar: '76', chihattar: '76',
  satahattar: '77', sathattar: '77', athhattar: '78', athahattar: '78',
  unyasi: '79', unasi: '79',
  assi: '80', ikyasi: '81', ekasi: '81', bayasi: '82', bayaasi: '82',
  tirasi: '83', tiraasi: '83', chaurasi: '84', pachasi: '85', pichasi: '85',
  chhiyasi: '86', chiyasi: '86', sattasi: '87', satasi: '87',
  athasi: '88', atthasi: '88', navasi: '89', nawasi: '89',
  nabbe: '90', nabbey: '90', ikyanve: '91', ikanve: '91', banve: '92', baanve: '92',
  tiranve: '93', tiraanve: '93', chauranve: '94', panchanve: '95', pachanve: '95',
  chhiyanve: '96', chiyanve: '96', sattanve: '97', satanve: '97',
  atthanve: '98', athanve: '98', ninyanve: '99', ninanve: '99',

  // Hindi, Devanagari
  'दस': '10', 'ग्यारह': '11', 'बारह': '12', 'तेरह': '13', 'चौदह': '14', 'पंद्रह': '15',
  'सोलह': '16', 'सत्रह': '17', 'अठारह': '18', 'उन्नीस': '19', 'बीस': '20',
  'इक्कीस': '21', 'बाईस': '22', 'तेईस': '23', 'चौबीस': '24', 'पच्चीस': '25',
  'छब्बीस': '26', 'सत्ताईस': '27', 'अट्ठाईस': '28', 'उनतीस': '29', 'तीस': '30',
  'इकत्तीस': '31', 'बत्तीस': '32', 'तैंतीस': '33', 'चौंतीस': '34', 'पैंतीस': '35',
  'छत्तीस': '36', 'सैंतीस': '37', 'अड़तीस': '38', 'उनतालीस': '39', 'चालीस': '40',
  'इकतालीस': '41', 'बयालीस': '42', 'तैंतालीस': '43', 'चौवालीस': '44', 'पैंतालीस': '45',
  'छियालीस': '46', 'सैंतालीस': '47', 'अड़तालीस': '48', 'उनचास': '49', 'पचास': '50',
  'इक्यावन': '51', 'बावन': '52', 'तिरपन': '53', 'चौवन': '54', 'पचपन': '55',
  'छप्पन': '56', 'सत्तावन': '57', 'अट्ठावन': '58', 'उनसठ': '59', 'साठ': '60',
  'इकसठ': '61', 'बासठ': '62', 'तिरसठ': '63', 'चौंसठ': '64', 'पैंसठ': '65',
  'छियासठ': '66', 'सड़सठ': '67', 'अड़सठ': '68', 'उनहत्तर': '69', 'सत्तर': '70',
  'इकहत्तर': '71', 'बहत्तर': '72', 'तिहत्तर': '73', 'चौहत्तर': '74', 'पचहत्तर': '75',
  'छिहत्तर': '76', 'सतहत्तर': '77', 'अठहत्तर': '78', 'उन्यासी': '79', 'अस्सी': '80',
  'इक्यासी': '81', 'बयासी': '82', 'तिरासी': '83', 'चौरासी': '84', 'पचासी': '85',
  'छियासी': '86', 'सत्तासी': '87', 'अठासी': '88', 'नवासी': '89', 'नब्बे': '90',
  'इक्यानवे': '91', 'बानवे': '92', 'तिरानवे': '93', 'चौरानवे': '94', 'पंचानवे': '95',
  'छियानवे': '96', 'सत्तानवे': '97', 'अट्ठानवे': '98', 'निन्यानवे': '99',

  /*
   * Odia — 10-30 and the round tens only.
   *
   * ⚠️ INCOMPLETE, and deliberately so. Odia names 31-99 as irregularly as Hindi does, and
   * I could not verify those forms to the standard the rest of this table is held to.
   * A missing entry breaks the run and costs a re-ask; a WRONG entry produces a valid-looking
   * PIN code for a different district and nothing ever says why. Missing is the safe failure
   * and guessing is not, so the gap is left open and written down instead.
   *
   * TODO: fill 31-99 with a native speaker. Until then an Odia artisan saying their code as
   * pairs above thirty gets re-asked, and the digit-by-digit path still works for them.
   */
  'ଦଶ': '10', 'ଏଗାର': '11', 'ବାର': '12', 'ତେର': '13', 'ଚଉଦ': '14', 'ପନ୍ଦର': '15',
  'ଷୋହଳ': '16', 'ସତର': '17', 'ଅଠର': '18', 'ଊଣେଇଶ': '19', 'କୋଡ଼ିଏ': '20',
  'ଏକୋଇଶି': '21', 'ବାଇଶି': '22', 'ତେଇଶି': '23', 'ଚବିଶି': '24', 'ପଚିଶି': '25',
  'ଛବିଶି': '26', 'ସତାଇଶି': '27', 'ଅଠାଇଶି': '28', 'ଅଣତିରିଶ': '29', 'ତିରିଶ': '30',
  'ଚାଳିଶ': '40', 'ପଚାଶ': '50', 'ଷାଠିଏ': '60', 'ସତୁରି': '70', 'ଅଶୀ': '80', 'ନବେ': '90',
};

/**
 * English tens, and the units that may follow one.
 *
 * 🐞 This is a fix, not an addition. English used to sit in NUMBER_WORDS with `twenty: '20'`,
 * and the parser appends whatever a word maps to — so "twenty two" appended '20' then '2'
 * and produced "202". Read as three pairs, "twenty two forty five thirty six" came out as
 * 202405306: nine digits, no six-digit run, silently re-asked forever. The artisan says the
 * number correctly, three times, and the screen keeps asking.
 *
 * Unlike Hindi, English composes, so a lookahead is all this needs. A tens word with no unit
 * after it is the round number: "forty" alone is 40.
 */
const TENS_EN = {
  twenty: '2', thirty: '3', forty: '4', fourty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};

const UNITS_EN = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Words that may sit BETWEEN digits without ending the number.
 *
 * "छह दो छह दो और इक्कीस" — the "और" is not a boundary, it is how the sentence breathes.
 * Deliberately tiny and deliberately not "any unknown word": an unknown word still splits
 * the run, because that is what stops "ek minute, 753001" from becoming 175300 (see below).
 */
const JOINERS = new Set([
  'aur', 'and', 'phir', 'then', 'और', 'फिर', 'ଆଉ', 'ଏବଂ',
]);

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
