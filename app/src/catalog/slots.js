/**
 * What to ask, and what not to. Research and reasoning: docs/Utsav/Product_Questions.md.
 *
 * The cataloguer used to hold a fixed array of five questions, asked in the same order to
 * everybody, every time. That array had two problems and they pull in opposite directions:
 * it asked for `special`, which fills no field any marketplace requires, and it never asked
 * for weight, stock or a measurable size, which five of the seven make mandatory. So an
 * artisan answered six questions and still could not be published on Meesho.
 *
 * The fix is to stop hardcoding the list and compute it. A slot is asked when it is still
 * empty AND some channel we are actually publishing to needs it. Everything else — country
 * of origin, currency, HSN, GST rate, seller type, consumer care contact, the whole
 * `@ondc/org/*` block — is a constant or a lookup, and asking a human for it is a bug.
 *
 * The three ways a slot gets filled without a question:
 *   prefill    the vision model read it off the photo        (POST /catalog/prefill)
 *   defaults   this artisan already told us on a past product (their profile / last product)
 *   harvest    one open answer mentioned four things at once   (interpretMany)
 *
 * `defaults` is the one that makes the app get quieter over time. Product one asks four
 * questions; product five asks one, because by then we know what they weave, how long they
 * take and roughly what it weighs. That is a SQL lookup, not a vector search.
 */

/** Ranked by consequence. Lower is asked first. */
export const BLOCKS_PUBLISH = 0; // a channel rejects the listing without it
export const AFFECTS_PRICE = 1; // the floor guard is wrong without it
export const IMPROVES_LISTING = 2; // the listing is duller without it

/**
 * Which slots each channel refuses to publish without.
 *
 * Taken from the mandatory columns in docs/Utsav/Product_Questions.md §2 — not from what
 * the adapters happen to send today, because several of them send fields nobody ever
 * collected. Where a channel needs a field we can derive (HSN, category, colour) it is not
 * listed here: this map is only the things a human has to say out loud.
 */
export const CHANNEL_NEEDS = {
  // Ours. We set our own rules, and they are the loosest that still makes a real listing.
  marketplace: ['what', 'material'],
  // `stock` is quantity.available.count, `lead_time` is @ondc/org/time_to_ship. Both are
  // Required on the item in B2C Retail 1.2.5 and both currently ship as a guess.
  ondc: ['what', 'material', 'size', 'stock', 'lead_time'],
  gem: ['what', 'material', 'size', 'weight', 'stock'],
  amazon: ['what', 'material', 'size', 'weight', 'stock'],
  flipkart: ['what', 'material', 'size', 'weight', 'stock', 'lead_time'],
  meesho: ['what', 'material', 'size', 'weight', 'stock'],
  // Image plus caption. A name is the only thing it genuinely needs.
  whatsapp: ['what'],
};

/**
 * Every slot we are willing to ask for, in the order they are asked.
 *
 * `open: true` means the answer is a sentence we reduce afterwards. `open: false` means the
 * answer is a number or a count and `voice/numbers.js` parses it locally, no model involved.
 *
 * `harvestedBy` names the slot whose open answer can supply this one for free. "yeh cotton
 * ki saree hai, teen din laga" answers `what`, `material` and `time` in one breath, so those
 * three never need to be three questions.
 */
export const SLOTS = [
  {
    field: 'what',
    key: 'catalog.q_what',
    rank: BLOCKS_PUBLISH,
    open: true,
    // The broad one. Everything below that says harvestedBy: 'what' may fall out of it.
    harvests: ['material', 'time', 'special', 'size'],
  },
  {
    field: 'material',
    key: 'catalog.q_material',
    rank: BLOCKS_PUBLISH,
    open: true,
    harvestedBy: 'what',
    // Weavers weave the same fibre for years. Second product onwards this is a confirmation.
    carriesForward: true,
  },
  {
    field: 'size',
    key: 'catalog.q_size',
    rank: BLOCKS_PUBLISH,
    open: true,
    harvestedBy: 'what',
  },
  {
    // ⚠️ Needs a weighing scale. There is no way to derive this and no way to degrade past
    // it: Meesho's Net Weight column is mandatory and drives the return shipping slab.
    field: 'weight',
    key: 'catalog.q_weight',
    rank: BLOCKS_PUBLISH,
    open: false,
    carriesForward: true,
  },
  {
    field: 'stock',
    key: 'catalog.q_stock',
    rank: BLOCKS_PUBLISH,
    open: false,
  },
  {
    field: 'lead_time',
    key: 'catalog.q_lead_time',
    rank: BLOCKS_PUBLISH,
    open: false,
    carriesForward: true,
  },
  {
    // Never reaches a buyer. It is what the artisan spent on materials, and it is half of
    // the price floor — the number that says "do not sell this for ₹1,800".
    field: 'cost',
    key: 'catalog.q_cost',
    rank: AFFECTS_PRICE,
    open: false,
  },
  {
    field: 'time',
    key: 'catalog.q_time',
    rank: AFFECTS_PRICE,
    open: false,
    harvestedBy: 'what',
  },
  {
    // Fills no mandatory field anywhere. Kept, and kept last, because it is the whole
    // difference between a handmade listing and a factory one.
    field: 'special',
    key: 'catalog.q_special',
    rank: IMPROVES_LISTING,
    open: true,
    harvestedBy: 'what',
  },
];

const bySlot = Object.fromEntries(SLOTS.map((s) => [s.field, s]));

/** A value that is present and not an empty string. `0` and `false` count as answers. */
function has(bag, field) {
  const v = bag?.[field];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

/**
 * The union of what the chosen channels demand, plus the two price-floor slots and the
 * story slot, which are ours and are not any channel's business.
 *
 * An unknown channel id contributes nothing rather than throwing. A typo in a channel list
 * must not be able to stop an artisan cataloguing a product.
 *
 * @param {string[]} [channels]
 * @returns {Set<string>}
 */
export function neededFields(channels) {
  const needed = new Set(['cost', 'time', 'special']);
  for (const c of channels ?? []) for (const f of CHANNEL_NEEDS[c] ?? []) needed.add(f);
  return needed;
}

/**
 * The questions still worth asking, in the order to ask them.
 *
 * Each entry is `{ field, key, open, confirm }`. `confirm` is set when we already believe we
 * know the answer — from the photo or from what this artisan said last time — and it turns
 * an open question into "cotton again?", which is a tap instead of a sentence.
 *
 * Returns [] when there is nothing left to ask, which is the signal to move to /catalog/review.
 *
 * @param {object} [state]
 * @param {Record<string, unknown>} [state.prefill]   what the vision model read off the photo
 * @param {Record<string, unknown>} [state.defaults]  what this artisan said on past products
 * @param {Record<string, unknown>} [state.answers]   what they have said so far this session
 * @param {string[]} [state.channels]                 channel ids we intend to publish to
 * @returns {{ field: string, key: string, open: boolean, confirm: string | null, fromPrefill: boolean }[]}
 */
export function plan({ prefill = {}, defaults = {}, answers = {}, channels = [] } = {}) {
  const needed = neededFields(channels);

  return SLOTS.filter((s) => needed.has(s.field))
    // Answered this session. Nothing more to do with it.
    .filter((s) => !has(answers, s.field))
    .map((s) => {
      // A slot we can pre-fill is still asked, but as a yes/no. Skipping it outright would
      // publish a guess under the artisan's name, and the vision model is a guess.
      const known = has(prefill, s.field)
        ? prefill[s.field]
        : s.carriesForward && has(defaults, s.field)
          ? defaults[s.field]
          : null;
      // Which guesser produced it. learning.py scores the vision model and the artisan's
      // own history separately — a model that is unreliable for this person says nothing
      // about whether their history is, and averaging the two hides both problems.
      return {
        field: s.field,
        key: s.key,
        open: s.open,
        confirm: known == null ? null : String(known),
        fromPrefill: has(prefill, s.field),
      };
    })
    .sort((a, b) => bySlot[a.field].rank - bySlot[b.field].rank);
}

/**
 * Fold a harvest — the several fields one open sentence turned out to contain — into the
 * answers bag without letting it overwrite anything the artisan said directly.
 *
 * Direction matters and is deliberate: an explicit answer to "how big is it" beats the same
 * fact inferred from a sentence about something else. The inference is cheaper, not better.
 */
export function absorb(answers, harvested) {
  const out = { ...answers };
  for (const [field, value] of Object.entries(harvested ?? {})) {
    if (!bySlot[field]) continue; // never invent a slot from a model response
    if (has(out, field)) continue; // never overwrite a direct answer
    if (value === undefined || value === null || String(value).trim() === '') continue;
    out[field] = String(value).trim();
  }
  return out;
}

/** Which slots an answer to `field` might also supply, for the interpreter to look for. */
export function harvestTargets(field) {
  return bySlot[field]?.harvests ?? [];
}

function demo() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const fields = (p) => p.map((q) => q.field).join(',');
  const A = ['marketplace', 'ondc']; // what one press of the green button actually fires

  // ── The default artisan: no photo pre-fill, nothing carried forward ────────────────
  assert(
    fields(plan({ channels: A })) === 'what,material,size,stock,lead_time,cost,time,special',
    'tier A asks the ONDC-blocking slots first, then the price floor, then the story',
  );
  assert(
    plan({ channels: A }).every((q) => q.confirm === null),
    'with nothing known, nothing is offered as a confirmation',
  );

  // Weight is not in that list, and that is the point: no tier A channel needs it. It
  // appears the moment a channel that does is selected.
  assert(!fields(plan({ channels: A })).includes('weight'), 'ONDC does not need a weight');
  assert(
    fields(plan({ channels: ['meesho'] })).includes('weight'),
    'Meesho does, because Net Weight is a mandatory column',
  );

  // ── Ranking is by consequence, not by the order slots are declared ─────────────────
  const ranks = plan({ channels: A }).map((q) => bySlot[q.field].rank);
  assert(
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    'blocking slots come before price slots, which come before the story',
  );
  assert(fields(plan({ channels: A })).endsWith('special'), 'the story question is always last');

  // ── Answers remove questions ───────────────────────────────────────────────────────
  assert(
    !fields(plan({ channels: A, answers: { material: 'cotton' } })).includes('material'),
    'an answered slot is not asked again',
  );
  assert(
    fields(plan({ channels: A, answers: { stock: 0 } })) === 'what,material,size,lead_time,cost,time,special',
    'zero is an answer — "I have none left" is not the same as saying nothing',
  );
  assert(
    plan({
      channels: A,
      answers: { what: 'a', material: 'b', size: 'c', stock: 1, lead_time: 2, cost: 3, time: 4, special: 'e' },
    }).length === 0,
    'a fully answered draft asks nothing and falls through to review',
  );

  // ── What we know becomes a confirmation, never a silent fill ───────────────────────
  const withPhoto = plan({ channels: A, prefill: { material: 'cotton' } });
  assert(
    fields(withPhoto).includes('material'),
    'a vision guess is still put to the artisan — it is a guess, and it publishes under their name',
  );
  assert(
    withPhoto.find((q) => q.field === 'material').confirm === 'cotton',
    'but it arrives as a confirmation rather than an open question',
  );
  assert(
    withPhoto.find((q) => q.field === 'material').fromPrefill === true,
    'and is marked as the vision model\'s guess, so a wrong one is scored against vision',
  );
  assert(
    plan({ channels: A, defaults: { material: 'cotton' } }).find((q) => q.field === 'material')
      .fromPrefill === false,
    'a carried-forward value is scored against history, not against the photo',
  );

  // The second product is the whole "grows with you" claim, so it gets its own assertion.
  const secondProduct = plan({
    channels: A,
    defaults: { material: 'cotton', lead_time: 3 },
    answers: { what: 'saree', size: '5.5m', stock: 1, cost: 800, time: 12 },
  });
  assert(
    fields(secondProduct) === 'material,lead_time,special',
    'by the second product the carried-forward slots are all that stand between them and review',
  );
  assert(
    secondProduct.filter((q) => q.confirm).length === 2,
    'and two of those three are taps, not sentences',
  );

  // Only slots marked carriesForward may be answered from history. Last week's stock count
  // and last week's material cost are facts about a different object.
  assert(
    plan({ channels: A, defaults: { stock: 9, cost: 500 } }).every((q) => q.confirm === null),
    'stock and cost never carry forward — they belong to the product, not the artisan',
  );

  // ── Harvesting: one sentence, several slots ────────────────────────────────────────
  assert(
    harvestTargets('what').join(',') === 'material,time,special,size',
    'the broad opening question is the one allowed to supply others',
  );
  assert(harvestTargets('weight').length === 0, 'a number answer harvests nothing');

  const absorbed = absorb({ what: 'saree' }, { material: 'cotton', time: '3 din' });
  assert(absorbed.material === 'cotton' && absorbed.time === '3 din', 'a harvest fills empty slots');
  assert(
    absorb({ material: 'silk' }, { material: 'cotton' }).material === 'silk',
    'a harvest never overwrites what the artisan actually said',
  );
  assert(
    absorb({}, { hsn_code: '5007', nonsense: 'x' }).hsn_code === undefined,
    'a model cannot invent a slot by naming one in its response',
  );
  assert(absorb({}, { material: '  ' }).material === undefined, 'whitespace is not an answer');
  assert(absorb({}, null).what === undefined, 'a failed harvest is not a crash');

  // ── Robustness at the edges ────────────────────────────────────────────────────────
  assert(plan().length > 0, 'called with nothing at all, it still asks the price-floor questions');
  assert(
    fields(plan({ channels: [] })) === 'cost,time,special',
    'with no channel chosen we still protect the floor and the story, and ask nothing else',
  );
  assert(
    fields(plan({ channels: ['typo'] })) === 'cost,time,special',
    'an unknown channel contributes nothing rather than throwing',
  );

  // Every slot has to be renderable and interpretable, or it is a screen that cannot draw.
  for (const s of SLOTS) {
    assert(s.key.startsWith('catalog.q_'), `${s.field} has a question string`);
    assert(typeof s.open === 'boolean', `${s.field} says whether its answer is a sentence`);
    assert(s.rank >= BLOCKS_PUBLISH && s.rank <= IMPROVES_LISTING, `${s.field} has a real rank`);
  }
  // Every field any channel demands must be a slot we know how to ask for, or that channel
  // can never be published to and nothing in the app would say so.
  for (const [channel, needs] of Object.entries(CHANNEL_NEEDS)) {
    for (const f of needs) assert(bySlot[f], `${channel} needs ${f}, which no slot asks for`);
  }

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('slots.js')) demo();
