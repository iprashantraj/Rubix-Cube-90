/**
 * What is waiting on the artisan, derived from what /home already fetched.
 *
 *   node src/screens/homeTodos.js
 *
 * ── Why this is a file and not four lines inside Home.tsx ────────────────────────
 * These four counts are the whole reason /home stopped being three totals and started
 * being a screen you can act on, and every one of them is a filter that has to agree
 * exactly with the tab that owns it — Orders.tsx for `placed`, Earnings.tsx for what
 * counts as a payment still owed, the publish gate for `colour_confirmed`. A count on the
 * dashboard that disagrees with the tab it links to is worse than no count at all: the
 * artisan taps "3 new orders", lands on a list of two, and stops believing the number.
 *
 * That is a real failure with no visible symptom in a diff, which is what earns it a
 * check. Plain .js and stdlib-only for the reason api/policy.js and camera/gate.js are:
 * bare `node` cannot import a .tsx module, and a check that needs a build step to run is
 * a check nobody runs. Listed in tsconfig's allowJs note alongside the other four.
 *
 * ⚠️ This file returns i18n KEYS and route paths, never sentences. It has no opinion about
 * language and no way to acquire one.
 */

/**
 * @param products rows from `GET /products`, or null while it is still in flight
 * @param orders   rows from `GET /orders`, or null
 * @param me       `GET /me`, or null/undefined
 * @returns the rows to render, in priority order. Empty means nothing is waiting.
 */
export function todosFor(products, orders, me) {
  const ps = products ?? [];
  const os = orders ?? [];

  // Orders.tsx filters on exactly this. 🐞 It was `state === 'new'` here once, which is not
  // one of the six states, so the dashboard's new-order count was permanently zero.
  const newOrders = os.filter((o) => o.state === 'placed').length;

  // Earnings.tsx's definition, verbatim: money is "sent" once the goods are delivered or
  // the channel has settled, and it is still the artisan's to confirm until they say so.
  // Anything earlier is work in progress, not money.
  const toConfirm = os.filter(
    (o) => ['delivered', 'settled'].includes(o.state) && !o.artisan_confirmed_payment,
  ).length;

  // 🔒 `=== false`, not `!p.colour_confirmed`. The field is optional: a product the server
  // did not send it for is UNKNOWN, not unconfirmed, and nagging an artisan about a product
  // that is actually fine is how a "waiting for you" list stops being read.
  const unchecked = ps.filter((p) => p.colour_confirmed === false).length;

  // Bank details only. has_pan and has_gst are genuinely optional for a small seller, and a
  // home screen carrying a chore that can never be finished trains people to ignore it.
  const setupDue = me ? me.has_bank === false : false;

  return [
    newOrders > 0 && {
      key: 'orders',
      // Amber, not accent: this is the only row that costs money to ignore. A missed order
      // is a cancelled order, a cancelled order is a rating hit, and a rating hit is income.
      urgent: true,
      labelKey: 'home.todo_orders',
      subKey: 'home.todo_orders_sub',
      count: newOrders,
      to: '/orders',
    },
    toConfirm > 0 && {
      key: 'pay',
      urgent: false,
      labelKey: 'home.todo_pay',
      subKey: 'home.todo_pay_sub',
      count: toConfirm,
      to: '/earnings',
    },
    unchecked > 0 && {
      key: 'colour',
      urgent: false,
      labelKey: 'home.todo_colour',
      subKey: 'home.todo_colour_sub',
      count: unchecked,
      to: '/products',
    },
    setupDue && {
      key: 'setup',
      urgent: false,
      labelKey: 'home.todo_setup',
      subKey: 'home.todo_setup_sub',
      // No count. "Finish your setup" is one job, and a "1" beside it reads as one of
      // several.
      count: null,
      to: '/settings',
    },
  ].filter(Boolean);
}

// ── self-check ──────────────────────────────────────────────────────────────────
function demo() {
  const assert = (c, m) => {
    if (!c) throw new Error(m);
  };
  const keys = (r) => r.map((x) => x.key).join(',');

  // Nothing fetched yet must not be read as "nothing is waiting". /home renders this band
  // on the first frame from the last visit's cache, before either query has resolved.
  assert(todosFor(null, null, null).length === 0, 'no data yet -> no rows, no crash');
  assert(todosFor(undefined, undefined, undefined).length === 0, 'undefined is survivable too');
  assert(todosFor([], [], {}).length === 0, 'a genuinely clear day shows nothing');

  // The state the count was silently wrong about for the entire life of the old screen.
  const placed = [{ id: '1', state: 'placed' }, { id: '2', state: 'placed' }];
  assert(todosFor([], placed, null)[0].count === 2, "'placed' is what a new order is");
  assert(
    todosFor([], [{ id: '1', state: 'new' }], null).length === 0,
    "'new' is not one of the six states and must never count as one",
  );
  assert(todosFor([], placed, null)[0].urgent === true, 'a waiting order is the urgent row');

  // Money owed matches Earnings.tsx: delivered/settled AND not yet confirmed by the artisan.
  const money = [
    { id: '1', state: 'delivered', artisan_confirmed_payment: false },
    { id: '2', state: 'settled' },
    { id: '3', state: 'settled', artisan_confirmed_payment: true },
    { id: '4', state: 'shipped' },
  ];
  const pay = todosFor([], money, null).find((r) => r.key === 'pay');
  assert(pay.count === 2, 'confirmed money and in-transit money are both excluded');
  assert(pay.to === '/earnings', 'the money row goes to the money screen');

  // 🔒 The publish gate. Unknown is not the same as unconfirmed.
  const prods = [
    { id: 'a', colour_confirmed: false },
    { id: 'b', colour_confirmed: true },
    { id: 'c' },
  ];
  const colour = todosFor(prods, [], null).find((r) => r.key === 'colour');
  assert(colour.count === 1, 'a product with no colour_confirmed field is not nagged about');

  // Setup: only a server that has actually said "no bank" produces the row.
  assert(!todosFor([], [], {}).find((r) => r.key === 'setup'), 'an absent flag is not a chore');
  assert(!todosFor([], [], { has_bank: true }).find((r) => r.key === 'setup'), 'a bank on file is done');
  assert(todosFor([], [], { has_bank: false }).find((r) => r.key === 'setup'), 'no bank is a chore');
  assert(
    todosFor([], [], { has_bank: false }).find((r) => r.key === 'setup').count === null,
    'the setup row carries no numeral',
  );

  // Order is the priority order, and it does not depend on which rows are present.
  assert(
    keys(todosFor(prods, money.concat(placed), { has_bank: false })) === 'orders,pay,colour,setup',
    'rows come out in priority order: what earns, then what pays, then what blocks, then admin',
  );
  assert(
    keys(todosFor(prods, [], { has_bank: false })) === 'colour,setup',
    'absent rows collapse without disturbing the order of the rest',
  );

  // Every row has to be renderable and tappable — a row with no destination is a dead end.
  for (const r of todosFor(prods, money.concat(placed), { has_bank: false })) {
    assert(r.labelKey?.startsWith('home.todo') && r.subKey?.startsWith('home.todo'), `${r.key} has both strings`);
    assert(r.to?.startsWith('/'), `${r.key} leads somewhere`);
  }

  console.log('all passed');
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('homeTodos.js')) demo();
