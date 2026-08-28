/**
 * Spoken numbers, in the three languages the app speaks.
 *
 * Lives here rather than in a screen because two features read it: `extractPincode()` in
 * screens/OnboardPlace.jsx wants a run of six digits, and the cataloguer's quantity reducer
 * in voice/interpret.js wants one value plus a unit ("gyarah din", "chaar foot"). Same
 * words, different questions asked of them — and Hindi names every value from 10 to 99
 * irregularly, so a second copy of this table would be a second thing to get wrong.
 *
 * Everything below was written for and proven by the PIN code parser's 34 assertions; see
 * the notes on each table for why an entry is or is not present.
 */

/**
 * Spoken digit words we accept, romanised and in script, across our three languages.
 * People do not read out a PIN code as a number — they say "saat panch teen shunya shunya
 * ek", and Bhashini will hand that back as words at least as often as as digits.
 *
 * "oh" is in here because English speakers say it for zero and always will.
 */
/** @type {Record<string, string>} */
export const DIGIT_WORDS = {
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
/** @type {Record<string, string>} */
export const NUMBER_WORDS = {
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
/** @type {Record<string, string>} */
export const TENS_EN = {
  twenty: '2', thirty: '3', forty: '4', fourty: '4', fifty: '5',
  sixty: '6', seventy: '7', eighty: '8', ninety: '9',
};

/** @type {Record<string, string>} */
export const UNITS_EN = {
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
/** @type {ReadonlySet<string>} */
export const JOINERS = new Set([
  'aur', 'and', 'phir', 'then', 'और', 'फिर', 'ଆଉ', 'ଏବଂ',
]);

/** @type {readonly number[]} */
/**
 * Digits arrive in whichever numeral system the ASR pipeline felt like using — ASCII,
 * Devanagari (७५३००१) or Odia (୭୫୩୦୦୧). Each block is ten consecutive codepoints starting
 * at its own zero, so one subtraction handles all three and every other Indic script we
 * might add later for free.
 */
/** @type {readonly number[]} */
export const ZEROS = [0x30 /* ASCII */, 0x966 /* Devanagari */, 0xb66 /* Odia */];

/**
 * @param {string} ch
 * @returns {string}
 */
export function digitOf(ch) {
  const c = ch.codePointAt(0);
  // An empty token has no codepoint. Returning '' rather than guarding at every call site:
  // the callers all treat '' as "not a digit", which is exactly what an empty string is.
  if (c === undefined) return '';
  for (const z of ZEROS) if (c >= z && c <= z + 9) return String(c - z);
  return '';
}
