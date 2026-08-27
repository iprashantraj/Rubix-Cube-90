import { api } from '../api/client.js';

/**
 * Turn what someone actually said into the thing the app needs.
 *
 * The gap this closes: every voice screen in onboarding treated the transcript as if it
 * were the answer. /onboard/craft took `transcript.trim()` and stored it as the craft —
 * so an artisan who answered the question as a human being, "मैं साड़ी बुनता हूँ", had that
 * whole sentence written into a field that the category mapping, the pricing comparables
 * and every channel adapter read as a stable slug. It was only ever correct for someone
 * who replied with a single bare noun, which is not how anyone speaks.
 *
 * People do not answer in the shape of the question. They say more than was asked, they
 * answer a different question, they explain. That is not user error to be trained out —
 * it is the point of having a voice interface at all, and the transcript has to reach
 * something that can understand it.
 *
 * ── Two tiers, and the second one is not a stub ────────────────────────────────
 *
 *   1. the model.  POST /catalog/interpret hands the raw transcript, the question that was
 *      asked, and the allowed answers to the AI service. It is the only tier that can
 *      handle "my father had a loom and I do the same work now".
 *   2. keywords.   A synonym table, matched locally. Covers the common phrasings in all
 *      three languages and costs nothing, which matters because it runs on a phone whose
 *      network is the thing most likely to be missing.
 *
 * The local tier runs FIRST and its answer is used immediately when it is confident. That
 * ordering is deliberate and is not about saving money: an artisan who says "बुनाई" should
 * not wait on a round-trip to be told the app understood a word it already knew. The model
 * is for the sentences the table cannot reach.
 *
 * ⚠️ `raw` is always returned and must always be kept. Whatever we decide the answer was,
 * the artisan's own words are the record of what they actually said, and the confirmation
 * step reads them back. Never replace the transcript with our interpretation of it.
 */

/**
 * Craft synonyms, keyed by the stable English slug in OnboardCraft's CRAFTS list.
 *
 * Matched as substrings against a lowercased transcript, so stems rather than whole words:
 * "बुन" catches बुनता/बुनती/बुनाई/बुनकर without eight entries, and "weav" catches
 * weave/weaving/weaver. Latin stems must stay long enough not to fire inside an unrelated
 * word — this is why "pot" is absent and "pott" is present.
 *
 * These are the PRODUCTS people name, not the crafts. Asked what they do, nobody says
 * "metalwork"; they say "I make brass pots". So the objects are in here alongside the
 * verbs, and the objects are what actually match.
 */
const CRAFT_WORDS = {
  weaving: [
    'weav', 'loom', 'saree', 'sari', 'textile', 'cloth', 'fabric', 'dhurrie', 'durrie',
    'bunai', 'bunkar', 'bunta', 'kapda', 'kapra', 'kargha', 'chadar',
    'बुन', 'साड़ी', 'साडी', 'कपड़ा', 'करघा', 'बुनकर', 'दरी', 'चादर',
    'ବୁଣ', 'ଶାଢ଼ୀ', 'ଲୁଗା',
  ],
  pottery: [
    'pott', 'clay', 'terracotta', 'matka', 'kumhar', 'kumbhar', 'ceramic',
    'mitti', 'bartan', 'ghada', 'ghara',
    'मिट्टी', 'मटका', 'कुम्हार', 'बर्तन', 'घड़ा', 'मृत्तिका',
    'ମାଟି', 'କୁମ୍ଭାର',
  ],
  metalwork: [
    'metal', 'brass', 'bronze', 'copper', 'iron', 'silverware', 'dokra', 'dhokra', 'bell metal',
    'peetal', 'pital', 'kansa', 'tamba', 'lohar', 'loha',
    'धातु', 'पीतल', 'कांसा', 'तांबा', 'लोहा', 'लोहार', 'ढोकरा',
    'ଧାତୁ', 'ପିତ୍ତଳ', 'କାଁସା',
  ],
  woodwork: [
    'wood', 'carpent', 'carv', 'timber', 'furnitur',
    'lakdi', 'lakri', 'badhai', 'nakkashi', 'kaath',
    'लकड़ी', 'बढ़ई', 'नक्काशी', 'काठ',
    'କାଠ', 'ଦାରୁ',
  ],
  painting: [
    'paint', 'pattachitra', 'patachitra', 'madhubani', 'warli', 'canvas', 'artist',
    'chitra', 'chitr', 'rangai',
    'चित्र', 'पेंट', 'पट्टचित्र', 'मधुबनी', 'रंग', 'चित्रकार',
    'ଚିତ୍ର', 'ପଟ୍ଟଚିତ୍ର',
  ],
  jewellery: [
    'jewel', 'jewell', 'ornament', 'filigree', 'tarakasi', 'necklace', 'earring', 'bangle',
    'gehna', 'gahna', 'zevar', 'jevar', 'aabhushan', 'chudi', 'chudiyan',
    'गहन', 'ज़ेवर', 'जेवर', 'आभूषण', 'चूड़ी', 'हार',
    'ଗହଣା', 'ତାରକସି',
  ],
  leather: [
    'leather', 'hide', 'chappal', 'sandal', 'footwear', 'shoe', 'bag',
    'chamda', 'chamra', 'mochi', 'joota', 'jooti',
    'चमड़', 'चप्पल', 'जूत', 'बैग', 'मोची',
    'ଚମଡ଼ା',
  ],
  bamboo: [
    'bamboo', 'cane', 'basket', 'wicker', 'reed', 'mat',
    'baans', 'bans', 'tokri', 'tokra', 'chatai', 'bent',
    'बांस', 'बाँस', 'टोकर', 'बेंत', 'चटाई',
    'ବାଉଁଶ', 'ଟୋକେଇ',
  ],
};

/**
 * Carrier phrases people wrap an answer in, per language.
 *
 * "मेरा नाम उत्सव है" -> "उत्सव". This is the cheap half of the same job the model does,
 * and it exists for the same reason the craft table does: someone who answers in the most
 * ordinary phrasing there is should not have to wait on a network to be understood.
 *
 * Ordered longest-first within each language so "mera naam" is tried before "naam". Anchored
 * to the START only — a trailing "है"/"hai" is stripped separately, because Hindi and Odia
 * put the copula at the end and leaving it turns "Utsav" into "Utsav hai".
 */
const CARRIERS = [
  // English
  /^(my name is|my name's|i am called|i'm called|this is|i am|i'm|it is|it's|its)\s+/i,
  // Hindi, romanised and in script. `maro`/`mero`/`hamar` are not textbook Hindi — they are
  // what the ASR actually returns for regional pronunciations, and the transcript is what
  // this has to match, not the grammar.
  /^(mera naam|mera nam|meraa naam|maro naam|mero naam|hamara naam|hamar naam|mera naam hai)\s+/i,
  /^(मेरा नाम|मेरो नाम|हमारा नाम|हमार नाम|मै|मैं)\s+/,
  // Odia
  /^(mo naam|mora naam)\s+/i,
  /^(ମୋ ନାମ|ମୋର ନାମ)\s+/,
];

/** Trailing copulas and politeness that survive the carrier strip. */
const TAILS = [
  /\s+(hai|hain|he|ha)\s*[।.!]?$/i,
  /\s*(है|हूँ|हुँ|हूं)\s*[।.!]?$/,
  /\s*(ଅଟେ|ଅଟି)\s*[।.!]?$/,
];

/**
 * Pull a bare answer out of a sentence, locally.
 *
 * Returns '' when nothing was stripped AND the input still looks like a sentence, so the
 * caller escalates to the model rather than storing a phrase. A single word or two is
 * returned as-is: "Utsav" is already the answer and needs no interpretation at all.
 *
 * ⚠️ Conservative by design. It only removes phrasings we are certain about, because the
 * failure it prevents — "Mera naam Yash hai. My name is Yash." stored as a display name,
 * which is real data from our own dev database — is less bad than confidently trimming a
 * name down to the wrong word.
 */
export function stripCarrier(transcript) {
  let text = String(transcript ?? '')
    .replace(/[।]/g, '.')
    .trim();
  if (!text) return '';

  let stripped = false;
  for (const re of CARRIERS) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      stripped = true;
      break;
    }
  }
  for (const re of TAILS) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      stripped = true;
    }
  }
  text = text.replace(/[.!?,]+$/, '').trim();
  if (!text) return '';

  const words = text.split(/\s+/).length;

  /*
   * Nothing was stripped, so this is either a bare answer or a sentence phrased in a way
   * the table above does not know. Two words is the line: "Utsav" and "Utsav Sharma" are
   * answers, and by three we are almost certainly looking at a carrier phrase we failed to
   * recognise.
   *
   * This used to allow three, and "maro naam Utsav" — three words, a dialect form of "mera
   * naam" that is not in CARRIERS — was therefore returned WHOLE and stored as a display
   * name, without the model ever being asked. The local tier is supposed to be a fast path
   * for answers it is sure about, and returning the question's own words is not that.
   * Escalating instead costs one round trip and gets "Utsav".
   */
  if (!stripped) return words <= 2 ? text : '';
  return words <= 6 ? text : '';
}

/**
 * Local pass. Returns a slug only when exactly ONE craft matches.
 *
 * Two matches means ambiguity — "I weave bamboo mats" is genuinely both — and on ambiguity
 * we return null and let the model or the artisan decide. Guessing between two crafts that
 * were both named is how someone ends up in the wrong category with no idea why, and the
 * grid is one tap away the entire time. Same reasoning as classifyYesNo() and
 * extractPincode(): never guess, always re-ask.
 */
export function matchCraft(transcript) {
  const said = String(transcript ?? '').toLowerCase();
  if (!said.trim()) return null;
  const hits = Object.keys(CRAFT_WORDS).filter((slug) =>
    CRAFT_WORDS[slug].some((w) => said.includes(w)),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Interpret a free-spoken answer as one of `options`.
 *
 * Resolves `{ slug, raw, by }` — `by` is 'local' | 'model' | null, kept because "which tier
 * understood this" is the only way to tell a working model from a synonym table quietly
 * carrying the whole feature.
 *
 * Never throws. The AI service being absent is the normal state of a fresh clone (see
 * ai/README.md — the stubs are the contract), and an unreachable model must degrade to the
 * keyword tier rather than break a screen in the middle of onboarding.
 */
export async function interpretChoice({ transcript, question, options, lang }) {
  const raw = String(transcript ?? '').trim();
  if (!raw) return { slug: null, raw, by: null };

  const local = matchCraft(raw);
  if (local) return { slug: local, raw, by: 'local' };

  try {
    // Contract: ai/contracts.md § POST /catalog/interpret. The server proxies to the AI
    // service; both may be absent, which is what the catch is for.
    const res = await api.post('/catalog/interpret', {
      transcript: raw,
      question,
      options,
      language: lang,
    });
    const slug = options.includes(res?.choice) ? res.choice : null;
    return { slug, raw, by: slug ? 'model' : null };
  } catch {
    // No model reachable and the table did not know the words. The caller falls back to
    // the visual grid, which is why that grid is the primary path on this screen and not
    // an afterthought.
    return { slug: null, raw, by: null };
  }
}

/**
 * Interpret a free-spoken answer to an OPEN question — a name, a material, a size.
 *
 * Same two tiers as interpretChoice, same contract, but there is no allowlist to check the
 * answer against, so the model's output is trusted only as far as `raw` allows: the caller
 * shows both, and the artisan confirms. That confirmation step is doing real work here and
 * must not be optimised away.
 *
 * `shape` decides whether the LOCAL tier is even eligible, and it has to be asked for:
 *
 *   'name'  the answer is a person's name, so stripCarrier() applies — it exists for
 *           exactly this sentence and answers it without a round trip.
 *   'open'  anything else. Straight to the model. THE DEFAULT, deliberately.
 *
 * 🐞 Why the default is 'open'. stripCarrier() is a NAME reducer: CARRIERS is a list of
 * "my name is" phrasings and nothing else. Run it on a catalogue answer and the carrier
 * list misses entirely, but TAILS still strips the trailing copula — so "yeh cotton ki
 * saree hai" came back as "yeh cotton ki saree", non-empty, and was returned as a CONFIDENT
 * local answer. The model was never asked. The field that feeds the category mapping and
 * the pricing comparables got a whole sentence, which is the precise bug the header of this
 * file describes and claims to have fixed for onboarding.
 *
 * The model gets this right — POST /catalog/interpret answers "cotton" for that sentence —
 * and it is the one AI endpoint that is actually implemented today.
 *
 * Resolves `{ value, raw, by }`. `value` is null when neither tier could reduce the
 * sentence, and the caller then falls back to storing `raw` after showing it — which is the
 * old behaviour, kept as a floor rather than as the default.
 */
export async function interpretAnswer({ transcript, question, lang, shape = 'open' }) {
  const raw = String(transcript ?? '').trim();
  if (!raw) return { value: null, raw, by: null };

  if (shape === 'name') {
    const local = stripCarrier(raw);
    if (local) return { value: local, raw, by: 'local' };
  }

  try {
    const res = await api.post('/catalog/interpret', {
      transcript: raw,
      question,
      language: lang,
    });
    const value = typeof res?.choice === 'string' && res.choice.trim() ? res.choice.trim() : null;
    return { value, raw, by: value ? 'model' : null };
  } catch {
    return { value: null, raw, by: null };
  }
}

/*
 * Self-check. Dev-only — Vite folds `import.meta.env.DEV` to false and drops the block.
 *
 * These are the sentences people actually say, not single nouns. If the table ever stops
 * handling them, the model tier silently becomes load-bearing for the offline case, which
 * is the case our users are most often in.
 */
if (import.meta.env.DEV) {
  const ok = (got, want, why) => {
    if (got !== want) console.error(`[interpret] ${why}: got "${got}", want "${want}"`);
  };
  ok(matchCraft('मैं साड़ी बुनता हूँ'), 'weaving', 'hindi sentence, not a bare noun');
  ok(matchCraft('I make brass pots'), 'metalwork', 'named the product, not the craft');
  ok(matchCraft('hum mitti ke bartan banate hain'), 'pottery', 'romanised hindi');
  ok(matchCraft('ମୁଁ ପଟ୍ଟଚିତ୍ର କରେ'), 'painting', 'odia');
  ok(matchCraft('bamboo baskets'), 'bamboo', 'two words from one craft is still one craft');
  ok(matchCraft('weaving'), 'weaving', 'the bare noun still works');
  // Never guess.
  ok(matchCraft('I weave bamboo mats'), null, 'two crafts named -> ambiguous, do not pick');
  ok(matchCraft('kuch bhi'), null, 'nothing recognised');
  ok(matchCraft(''), null, 'silence');
  ok(matchCraft(null), null, 'no transcript at all');

  // Names. The empty string means "escalate to the model" — never "store the sentence".
  ok(stripCarrier('मेरा नाम उत्सव है'), 'उत्सव', 'hindi carrier and copula both stripped');
  ok(stripCarrier('mera naam Utsav hai'), 'Utsav', 'romanised hindi');
  ok(stripCarrier('my name is Utsav'), 'Utsav', 'english carrier');
  ok(stripCarrier('Utsav'), 'Utsav', 'a bare name needs no interpretation');
  ok(stripCarrier('Utsav Sharma'), 'Utsav Sharma', 'two words is still a name');
  // The one this file got wrong on a real phone: an unknown carrier, short enough to slip
  // through the old `words > 3` guard, stored verbatim as a display name.
  ok(stripCarrier('maro naam Utsav'), 'Utsav', 'dialect carrier is known now');
  ok(stripCarrier('naam mera Utsav ji'), '', 'unknown phrasing escalates, never stores');
  ok(stripCarrier('ମୋ ନାମ ଉତ୍ସବ ଅଟେ'), 'ଉତ୍ସବ', 'odia carrier and copula');

  /*
   * Why interpretAnswer defaults to shape:'open' and skips this function.
   *
   * These are catalogue answers, not names. CARRIERS matches none of them, but TAILS still
   * takes the trailing copula off — so the result is non-empty, looks confident, and is a
   * whole sentence. Locking the behaviour in an assertion so nobody "fixes" the empty-string
   * cases by loosening the word limit and silently re-enables this tier for /catalog/voice.
   */
  ok(stripCarrier('yeh cotton ki saree hai'), 'yeh cotton ki saree', 'copula stripped, sentence remains — not an answer');
  ok(stripCarrier('mitti ka matka hai'), 'mitti ka matka', 'same shape, same non-answer');
  ok(stripCarrier('chaar foot lamba hai'), 'chaar foot lamba', 'a size answer is not reduced either');
}
