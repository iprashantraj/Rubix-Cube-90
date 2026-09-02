/*
 * The resume decisions that cost the artisan real money when they are wrong.
 *
 *   node src/api/resume.test.mjs
 *
 * Stdlib-only and free of React, Capacitor and the api client — same reason
 * queries.test.mjs and web/api/test_uploads.py are written the way they are.
 */

import { planResume, resumeKey } from './resume.js';

const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ── 1. A finished upload is never re-sent ────────────────────────────────────────
// The drop was on `complete`'s response. The bytes are already assembled server-side, and
// re-uploading spends the artisan's metered data to be handed back the same url.
{
  const p = planResume({ url: 'file:///x.jpg', received: [0, 1, 2] });
  assert(p.action === 'done', 'a completed upload is done, not resumed');
  assert(p.url === 'file:///x.jpg', 'the url it already has is the answer');
}

// ── 2. Acknowledged chunks are not re-sent ───────────────────────────────────────
// This is the entire point of the chunking. If this branch breaks, a drop at 90% silently
// costs a full re-upload and nothing reports it.
{
  const p = planResume({ url: null, received: [0, 1] });
  assert(p.action === 'resume', 'chunks the server has are chunks we skip');
  assert(p.done.join() === '0,1', `resumed from the wrong set: ${p.done}`);
}

// ── 3. Every "we do not know" ends in a clean upload, never a throw ──────────────
// A resume cushion must never become the reason a photo cannot be uploaded at all
// (CLAUDE.md rule 3: losing the optimisation must not cost the artisan the listing).
for (const [label, prior] of [
  ['no remembered id', null],
  ['a 404 that was swallowed', undefined],
  ['an id that never got a chunk in', { url: null, received: [] }],
  ['a server answer missing the field', { url: null }],
]) {
  const p = planResume(prior);
  assert(p.action === 'fresh', `${label} must start fresh, got ${p.action}`);
  assert(p.done.length === 0, `${label} must skip nothing`);
}

// ── 4. The key is content, not size ─────────────────────────────────────────────
// ⚠️ The one that corrupts data rather than wasting it. Two photos of the same saree can
// be identical in byte count; keying on size resumes photo B onto photo A's parts and
// assembles half of each, with every request having returned 200.
{
  const a = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const b = new Blob([new Uint8Array([4, 3, 2, 1])]);
  const [ka, kb, ka2] = await Promise.all([resumeKey(a), resumeKey(b), resumeKey(a)]);

  assert(a.size === b.size, 'the fixture is pointless unless the sizes match');
  assert(ka !== kb, 'same size, different bytes MUST NOT share an upload id');
  assert(ka === ka2, 'the same photo must find its own id again, or resume never fires');
  assert(ka.startsWith('up:'), `namespaced so it cannot collide in sessionStorage: ${ka}`);
}

console.log('all passed');
