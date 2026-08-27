/**
 * The two sequences in the app, in one place.
 *
 * Most screens are destinations — you go there, you leave. These two are CHAINS: you are
 * part-way through something, and the most useful thing the chrome can tell you is how
 * much is left. "Is this nearly over" is what every first-time user of a form is actually
 * asking, and for someone who cannot read the question it is the only progress signal we
 * can give at all.
 *
 * Being in a chain buys a screen two things automatically, so no screen has to remember:
 *   - the progress bar in the header, instead of a title
 *   - a back button pointing at the previous step
 *
 * That second one is why this file exists rather than each screen passing `back`. It WAS
 * per-screen, and it was therefore missing on /onboard/craft, /onboard/place and every
 * screen in the create flow — which is to say, missing on exactly the screens a first-timer
 * most wants to reverse out of. A back button that appears only where somebody remembered
 * to add it is not a back button.
 */

/**
 * Onboarding. /lang and /consent are deliberately absent: language is chosen before the app
 * is in a language you can read, and consent is a decision rather than a step — putting a
 * progress bar over a DPDP notice frames a legal choice as a formality to get through.
 */
export const ONBOARDING = [
  '/auth',
  '/onboard/name',
  '/onboard/craft',
  '/onboard/place',
  '/onboard/ready',
];

/**
 * The create flow — everything after the shutter fires. This is the app's core loop and
 * the longest unbroken run of screens in it, so it is where "how much is left" matters
 * most and where being unable to go back hurts most.
 *
 * /camera is not in the list but IS where the first back button goes: the chain begins the
 * moment there is a photo, and the way to reject a photo is to take another one.
 */
export const CREATE = [
  '/capture/review',
  '/catalog/prefill',
  '/catalog/voice',
  '/catalog/review',
  '/price',
  '/publish',
];

/** Where the first step of each chain goes back to. Null means "nowhere you may return". */
const CHAIN_ENTRY = new Map([
  // /auth's way back is in PRELUDE below, not here — it leaves the chain rather than
  // stepping inside it.
  [ONBOARDING, null],
  [CREATE, '/camera'],
]);

/*
 * The three screens before onboarding proper: language, consent, phone.
 *
 * They are deliberately outside ONBOARDING — a progress bar over a DPDP notice frames a
 * legal choice as a formality to get through — but "not in a chain" was quietly also
 * meaning "no back button", and these are the first three screens anyone ever sees.
 * Choosing the wrong language is the most likely first mistake in this app, and it left
 * someone stranded on a consent notice they could not read, in a language they did not
 * pick, with nothing on screen that went back.
 *
 * /lang is absent because it is genuinely first. Everything else has a way out.
 */
const PRELUDE = new Map([
  ['/consent', '/lang'],
  ['/auth', '/consent'],
]);

function chainOf(pathname) {
  for (const chain of [ONBOARDING, CREATE]) {
    const i = chain.indexOf(pathname);
    if (i !== -1) return { chain, i };
  }
  return null;
}

/**
 * Where in a chain is this path? Null for anything not in one, which is how <Screen> knows
 * to draw an ordinary title instead of a progress bar.
 */
export function stepOf(pathname) {
  const found = chainOf(pathname);
  return found ? { step: found.i + 1, total: found.chain.length } : null;
}

/**
 * The previous screen in the chain.
 *
 * Returns a path rather than `true` (history.back) on purpose: history on these chains can
 * contain a redirect the route Guard performed, and popping into one lands the artisan
 * straight back where they started.
 */
export function backOf(pathname) {
  // PRELUDE first: /auth is both the first ONBOARDING step and a prelude screen, and the
  // prelude answer is the useful one.
  if (PRELUDE.has(pathname)) return PRELUDE.get(pathname);
  const found = chainOf(pathname);
  if (!found) return null;
  return found.i > 0 ? found.chain[found.i - 1] : (CHAIN_ENTRY.get(found.chain) ?? null);
}

/*
 * Self-check. Dev-only — Vite folds `import.meta.env.DEV` to false and drops the block.
 *
 * Guards the regression this file was written to fix: a screen silently having no back
 * button. Nothing in the UI fails loudly when that happens — it just quietly traps someone.
 */
if (import.meta.env.DEV) {
  const ok = (cond, why) => {
    if (!cond) console.error(`[onboarding] ${why}`);
  };
  for (const chain of [ONBOARDING, CREATE]) {
    chain.forEach((path, i) => {
      ok(stepOf(path) !== null, `${path} is in a chain but has no step`);
      // Every step after the first must lead somewhere. The first is allowed to be a dead
      // end only where the chain entry is explicitly null — see CHAIN_ENTRY.
      if (i > 0) ok(backOf(path) !== null, `${path} has no way back — nobody may be trapped`);
    });
  }
  ok(backOf('/auth') === '/consent', '/auth goes back to the notice it followed');
  ok(backOf('/consent') === '/lang', 'the wrong language must be escapable from consent');
  ok(backOf('/lang') === null, 'language is genuinely the first screen');
  ok(backOf('/capture/review') === '/camera', 'rejecting a photo means taking another one');
  ok(stepOf('/home') === null, 'a destination is not a chain and gets a title, not a bar');
  ok(backOf('/home') === null, 'a destination has no previous step');
}
