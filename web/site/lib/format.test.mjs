/** node lib/format.test.mjs — no framework, no deps. */
import assert from 'node:assert/strict';
import { count, rupees, mask, ceiling, line } from './format.mjs';

// Indian grouping, which is the whole reason this is not `toLocaleString()` inline.
assert.equal(count(124860), '1,24,860');
assert.equal(count(742), '742');

assert.equal(rupees(2684000000), '₹268.4 Cr');
assert.equal(rupees(980000), '₹9.8 L');
assert.equal(rupees(71000), '₹71,000');
// Boundaries, both directions.
assert.equal(rupees(1e7), '₹1.0 Cr');
assert.equal(rupees(1e7 - 1), '₹100.0 L');
assert.equal(rupees(1e5), '₹1.0 L');
assert.equal(rupees(1e5 - 1), '₹99,999');

assert.equal(mask('9412300081'), '•••••00081');
assert.equal(mask('123'), '123'); // too short to mask, returned as-is

// The axis must never sit below the data it labels.
const series = [96000000, 186000000, 312000000];
const top = ceiling(series);
assert.equal(top, 4e8);
assert.ok(top >= Math.max(...series), 'ceiling below the data max would clip the line');
assert.equal(ceiling([9.3e7]), 1e8); // 1 Cr steps under the 10 Cr threshold
assert.equal(ceiling([4e8]), 4e8);   // already round, not bumped a step

// A value at `top` sits on the top gridline (y=0); zero sits on the baseline (y=h).
assert.equal(line([0, 400], 100, 200, 400), 'M0.0 200.0 L100.0 0.0');
// Half of `top` is half the height. This is the assertion the axis bug failed.
assert.equal(line([200], 100, 200, 400), 'M0.0 100.0');
// Scaling is against `top`, NOT against the series max — two series sharing a `top`
// must be directly comparable.
assert.equal(line([100], 10, 100, 400), line([100], 10, 100, 400));
assert.notEqual(line([100, 200], 10, 100, 400), line([100, 200], 10, 100, 200));

console.log('format.mjs ok');
