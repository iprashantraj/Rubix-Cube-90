/**
 * Numbers out of spoken answers.
 *
 * Two questions in the cataloger produce a number that money depends on: "how long did it
 * take" and "what did the materials cost". Both arrive as a transcript of a sentence, in
 * one of three languages, and both feed `floor_price()` — the figure that decides whether
 * an artisan is told they are about to sell at a loss.
 *
 * ── Why this is not `parseFloat(transcript)` ────────────────────────────────────────
 * It used to be. `Price.jsx` took the first number out of the answer and called it hours.
 * A weaver saying "बीस दिन लगे" — twenty days — produced 20 hours:
 *
 *     parsed  20 hours   ->  floor = (800 + 20×120)  × 1.15 = ₹3,680
 *     real    160 hours  ->  floor = (800 + 160×120) × 1.15 = ₹23,000
 *
 * Six times too low, in the one direction that costs the artisan money. Real Sambalpuri
 * ikat sarees sell for ₹8,000–₹25,000, so ₹23,000 is the honest number and ₹3,680 is us
 * handing a weaver to the middleman with a receipt. The unit word was sitting right there
 * in the sentence the whole time.
 *
 * The same failure exists on the rupee side and is worse: "2 हज़ार" read as 2 understates
 * the material cost by a thousandfold.
 *
 * ── What it does not do, deliberately ───────────────────────────────────────────────
 * ponytail: digits only. "बीस दिन" spelled out in words still yields null, because a
 * spoken-number table for three languages is ~80 entries of data whose value depends
 * entirely on whether Bhashini returns numerals or words — and that is an open question
 * (research/RESULTS.md, asr-bhashini). Build the table when a real transcript sample says
 * it is needed, not before. Null is safe here: the caller sends null and the server prices
 * on what it does have. A wrong number is worse than no number.
 */

/**
 * Working hours per unit. These are a calibration, not a fact — a "day" of weaving is a
 * working day, not 24 hours, and a "month" is working days rather than calendar ones.
 * Tune against what artisans actually mean when field testing says they mean something
 * else; both errors here move the floor, so they are worth getting right per craft.
 */
const HOURS_PER = {
  hour: 1,
  day: 8,
  week: 48, // six working days
  month: 200, // ~25 working days
};

/**
 * Unit words, matched as lowercased substrings so stems cover inflections: "दिन" catches
 * दिनों, "ghant" catches ghanta/ghante, "month" catches months.
 *
 * Latin stems must stay long enough not to fire inside an unrelated word — the same rule
 * the craft table in interpret.js follows.
 */
const UNIT_WORDS = {
  hour: ['hour', 'hrs', 'ghant', 'घंट', 'घण्ट', 'ଘଣ୍ଟ'],
  day: ['day', 'din', 'roz', 'दिन', 'रोज़', 'रोज', 'ଦିନ'],
  week: ['week', 'haft', 'saptah', 'हफ़्त', 'हफ्त', 'सप्ताह', 'ସପ୍ତାହ'],
  month: ['month', 'mahin', 'mahee', 'महीन', 'महिन', 'ମାସ'],
};

/** Scale words. "2 हज़ार" is 2000, and reading it as 2 is the worst bug in this file. */
const SCALE_WORDS = {
  100: ['sau', 'सौ', 'ଶହ'],
  1000: ['hazaar', 'hazar', 'hajar', 'thousand', 'हज़ार', 'हजार', 'ହଜାର'],
  100000: ['lakh', 'lac', 'लाख', 'ଲକ୍ଷ'],
};

/**
 * Devanagari (०-९) and Odia (୦-୯) digits to ASCII.
 *
 * Indic ASR returns these routinely and `/\d/` does not match them, so without this a
 * perfectly clear "२० दिन" is silently no answer at all.
 */
function toAsciiDigits(s) {
  return s.replace(/[०-९୦-୯]/g, (d) => {
    const code = d.codePointAt(0);
    return String((code - (code >= 0x0b66 ? 0x0b66 : 0x0966)).toString());
  });
}

const has = (said, words) => words.some((w) => said.includes(w));

/**
 * The first number in a spoken answer, times any scale word that follows it.
 *
 * Returns null when there is no digit — silence, a skipped question, or a number spelled
 * out in words. Zero is a real answer and is returned as 0: a potter who digs their own
 * clay genuinely spent nothing on materials, and that is not the same as not answering.
 */
export function numberFrom(text) {
  const said = toAsciiDigits(String(text ?? '')).toLowerCase();
  const m = /(\d+(?:\.\d+)?)/.exec(said);
  if (!m) return null;

  let n = Number(m[1]);
  // Only a scale word AFTER the number scales it: "2 hazaar" is 2000, but "hazaar rupaye
  // ka 2 metre kapda" is 2 metres of cloth and must not become 2000.
  const after = said.slice(m.index + m[1].length);
  for (const [mult, words] of Object.entries(SCALE_WORDS)) {
    if (has(after, words)) {
      n *= Number(mult);
      break;
    }
  }
  return n;
}

/**
 * Hours of work out of an answer like "बीस दिन लगे" or "took about 3 weeks".
 *
 * The unit taken is the one that FOLLOWS the number, same rule as the scale words above,
 * because that is the one the number belongs to. Falling back to a search of the whole
 * sentence covers the rarer "din bees" word order rather than silently reading it as hours.
 *
 * Mixed units undercount: "एक हफ्ते और 2 दिन" resolves as two days and loses the week,
 * because the week has no digit attached to it. That is an undercount of a week against a
 * sixfold one if units were ignored altogether, and it is the safe direction to be crude
 * in only because the sixfold error is gone.
 *
 * A bare number with no unit anywhere is read as hours — what the old parser assumed for
 * every answer, now the narrow fallback rather than the rule.
 */
export function hoursFrom(text) {
  const n = numberFrom(text);
  if (n === null) return null;

  const said = toAsciiDigits(String(text ?? '')).toLowerCase();
  const m = /(\d+(?:\.\d+)?)/.exec(said);
  const after = said.slice(m.index + m[1].length);

  for (const scope of [after, said]) {
    for (const [unit, words] of Object.entries(UNIT_WORDS)) {
      if (has(scope, words)) return n * HOURS_PER[unit];
    }
  }
  return n;
}

/**
 * Rupees out of an answer like "800 रुपये का धागा" or "2 हज़ार".
 *
 * No unit conversion — rupees are rupees — but the scale words matter enormously, so this
 * is `numberFrom` under a name that says what it is for at the call site.
 */
export function rupeesFrom(text) {
  return numberFrom(text);
}

/*
 * Self-check: `node src/voice/numbers.js`, wired into `npm test`.
 *
 * Same shape as camera/gate.js — this file imports nothing, so plain node runs it. Every
 * case below is a sentence somebody would actually say into the microphone.
 */
function demo() {
  const ok = (got, want, why) => {
    if (got !== want) {
      console.error(`[numbers] ${why}: got ${got}, want ${want}`);
      process.exitCode = 1;
    }
  };

  // The bug this file exists for.
  ok(hoursFrom('बीस दिन लगे'), null, 'spelled-out number is still out of reach — and null, not wrong');
  ok(hoursFrom('20 दिन लगे'), 160, 'twenty days is 160 working hours, not 20');
  ok(hoursFrom('20 din'), 160, 'romanised hindi');
  ok(hoursFrom('took 20 days'), 160, 'english');
  ok(hoursFrom('୨୦ ଦିନ'), 160, 'odia digits and odia unit');
  ok(hoursFrom('२० दिन'), 160, 'devanagari digits');

  ok(hoursFrom('12 घंटे'), 12, 'hours stay hours');
  ok(hoursFrom('3 हफ्ते'), 144, 'weeks');
  ok(hoursFrom('2 महीने'), 400, 'months');
  ok(hoursFrom('12'), 12, 'bare number falls back to hours, as the old parser assumed');
  ok(hoursFrom('din bees, 20'), 160, 'unit before the number is still found');
  ok(hoursFrom('एक हफ्ते और 2 दिन'), 16, 'mixed units take the one attached to the number');
  ok(hoursFrom(''), null, 'silence');
  ok(hoursFrom(null), null, 'question skipped');

  // Rupees. The scale words are the whole point.
  ok(rupeesFrom('800 रुपये का धागा'), 800, 'plain rupees');
  ok(rupeesFrom('2 हज़ार'), 2000, 'two thousand is not two');
  ok(rupeesFrom('2 hazaar rupaye'), 2000, 'romanised');
  ok(rupeesFrom('5 सौ'), 500, 'hundreds');
  ok(rupeesFrom('1 लाख'), 100000, 'lakh');
  ok(rupeesFrom('hazaar rupaye ka 2 metre kapda'), 2, 'scale word BEFORE the number does not scale it');
  ok(rupeesFrom('kuch nahi laga'), null, 'no number at all');
  ok(rupeesFrom('0'), 0, 'zero is a real answer — the potter digs their own clay');

  if (!process.exitCode) console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('numbers.js')) demo();
