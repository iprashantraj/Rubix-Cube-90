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
 * ── Words, not only digits ──────────────────────────────────────────────────────────
 * This file used to say "digits only" and defer the word table until a real transcript
 * sample proved it necessary. Use proved it: ASR returns spelled-out numbers routinely, and
 * "बीस दिन" yielded null while the artisan had answered perfectly clearly.
 *
 * The table it was deferring already existed. `numberWords.js` was written for the PIN code
 * parser and carries 1–99 in Devanagari, Odia and romanised Hindi, plus composing English
 * tens. Two parsers for the same job, one of them blind. They share it now — which is also
 * why numberWords stopped being TypeScript: this file runs under bare `node` as its own
 * test and cannot import a `.ts`.
 *
 * Compounds are the part that matters. "do sau tirasi" is 283, not 2, and a material cost
 * read as 2 instead of 283 moves the price floor by two orders of magnitude in the one
 * direction that costs the artisan money.
 */

import { DIGIT_WORDS, NUMBER_WORDS, TENS_EN, UNITS_EN } from './numberWords.js';

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
/** Scale word -> multiplier, flattened from SCALE_WORDS so a token lookup is one map hit. */
const SCALE_BY_WORD = Object.fromEntries(
  Object.entries(SCALE_WORDS).flatMap(([mult, words]) => words.map((w) => [w, Number(mult)])),
);

/**
 * A number spelled out in words. Returns null when the sentence contains no number word.
 *
 * Composes the way the languages actually do:
 *
 *   "do sau tirasi"      2, ×100, +83   -> 283
 *   "ek hazaar do sau"   1, ×1000, 2×100 -> 1200
 *   "twenty five"        tens+unit       -> 25
 *   "बीस"                direct          -> 20
 *
 * A scale of 100 multiplies what is being built; a thousand or a lakh closes the group and
 * banks it, which is what makes "ek hazaar do sau" 1200 rather than 100000. That is the
 * whole difference between the two kinds of scale word and the only subtle thing here.
 *
 * Unknown words are skipped rather than treated as boundaries. A spoken sentence is mostly
 * unknown words — "mujhe do sau tirasi rupaye lage" — and splitting on them would find the
 * 2 and stop. That is the opposite trade from `extractPincode`, which needs an unknown word
 * to end the run so "ek minute, 753001" cannot become 175300; a PIN is a digit sequence and
 * this is an arithmetic value, so they genuinely want different rules.
 */
export function spokenNumber(text) {
  const words = toAsciiDigits(String(text ?? ''))
    .toLowerCase()
    // \p{M} matters: Devanagari matras are combining MARKS, not letters, so a class of
    // letters-and-digits alone splits "बीस" into "ब" and "स" and finds no number at all.
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean);

  let total = 0;
  let current = 0;
  let seen = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // English composes: a tens word takes the unit after it, if there is one.
    if (TENS_EN[w]) {
      const next = words[i + 1];
      const unit = next && UNITS_EN[next] ? UNITS_EN[next] : '0';
      if (unit !== '0') i++;
      current += Number(TENS_EN[w] + unit);
      seen = true;
      continue;
    }

    // Hindi and Odia do not compose below a hundred — 83 is its own word, `tirasi`.
    //
    // DIGIT_WORDS carries the romanised units (ek, do, teen) because it was built for the
    // PIN parser, where every digit is spoken separately; NUMBER_WORDS starts at the teens.
    // Both are needed, and consulting only one is why "do sau tirasi" came out as 183.
    const direct = NUMBER_WORDS[w] ?? DIGIT_WORDS[w] ?? UNITS_EN[w];
    if (direct !== undefined) {
      current += Number(direct);
      seen = true;
      continue;
    }

    const scale = SCALE_BY_WORD[w];
    if (scale) {
      // "sau" with nothing before it is a hundred, not zero hundreds.
      if (scale >= 1000) {
        total += (current || 1) * scale;
        current = 0;
      } else {
        current = (current || 1) * scale;
      }
      seen = true;
    }
  }

  return seen ? total + current : null;
}

export function numberFrom(text) {
  const said = toAsciiDigits(String(text ?? '')).toLowerCase();
  const m = /(\d+(?:\.\d+)?)/.exec(said);
  // No numeral anywhere: the answer may still be a number, spelled out. Digits first
  // because when ASR gives us both they agree, and a numeral is unambiguous.
  if (!m) return spokenNumber(said);

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
  /*
   * `m` is null whenever the number was spelled out — "बीस दिन लगे" has no numeral at all.
   * numberFrom answers that case now, so this line could no longer assume a match and was
   * throwing on every word-only answer: a crash where the old behaviour was merely null.
   *
   * With no numeral there is no "after the number" to prefer, so the unit is searched for
   * across the whole sentence, which is the fallback scope below anyway.
   */
  const after = m ? said.slice(m.index + m[1].length) : said;

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
  // This asserted `null` and called it "still out of reach". It is the sentence the whole
  // file opens with — twenty days of weaving — and it is now read correctly: 20 × 8 hours.
  // The old floor for it was ₹3,680 against a real ₹23,000.
  ok(hoursFrom('बीस दिन लगे'), 160, 'twenty days, spelled out, is 160 working hours');
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

  // ── Spelled-out numbers, which used to yield null ────────────────────────────────
  // Reported from the phone: numbers spoken as words were not recognised at all, and
  // compounds were the worst of it. Every case below returned null or a wrong value before
  // numberWords.js was shared with this file.
  ok(spokenNumber('बीस'), 20, 'a Devanagari number word');
  ok(spokenNumber('तिरासी'), 83, 'Hindi does not compose below a hundred — 83 is one word');
  ok(spokenNumber('ଚାଳିଶ'), 40, 'Odia');
  ok(spokenNumber('pachchis'), 25, 'romanised Hindi');
  ok(spokenNumber('twenty five'), 25, 'English composes: tens plus unit');
  ok(spokenNumber('forty'), 40, 'a tens word alone is the round number');

  // 🐞 The tokenizer split "बीस" into "ब" and "स" and found nothing, because Devanagari
  // matras are combining MARKS and the character class only allowed letters and digits.
  ok(numberFrom('बीस दिन लगे'), 20, 'a matra does not break the word apart');

  // 🐞 "do sau tirasi" came out as 183: the romanised units live in DIGIT_WORDS, written
  // for the PIN parser, and only NUMBER_WORDS was being consulted — so "do" was invisible
  // and "sau" multiplied an implicit 1.
  ok(spokenNumber('do sau tirasi'), 283, 'two hundred and eighty three');
  ok(spokenNumber('paanch sau'), 500, 'five hundred');
  ok(spokenNumber('ek hazaar do sau'), 1200, 'a thousand banks the group; a hundred scales it');
  ok(spokenNumber('ek lakh'), 100000, 'lakh');
  ok(spokenNumber('sau'), 100, 'a bare hundred is one hundred, not zero');

  // Unknown words are skipped rather than ending the run — a real sentence is mostly
  // unknown words, and stopping at the first would find the 2 in "do" and quit.
  ok(numberFrom('mujhe do sau tirasi rupaye lage'), 283, 'a number inside a sentence');
  ok(spokenNumber('kuch nahi'), null, 'no number word at all');

  // Digits still win when both are present: a numeral is unambiguous and ASR gives both.
  ok(numberFrom('2 hazaar'), 2000, 'digits are preferred over words');

  if (!process.exitCode) console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('numbers.js')) demo();
