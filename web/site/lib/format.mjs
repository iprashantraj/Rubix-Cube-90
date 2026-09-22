/**
 * Pure formatting and chart-scaling helpers for the admin console.
 *
 * Plain `.mjs` rather than `.ts` on purpose: `node lib/format.test.mjs` runs the checks
 * with no test framework, no bundler and no dependency, matching how every other
 * self-check in this repo runs. `lib/admin.ts` re-exports these, so callers import from
 * one place regardless.
 */

/** Indian digit grouping: 1,24,860 rather than 124,860. */
export function count(n) {
  return n.toLocaleString('en-IN');
}

/** Crore above ₹1 Cr, lakh above ₹1 L, grouped rupees below that. */
export function rupees(n) {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(1) + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' L';
  return '₹' + n.toLocaleString('en-IN');
}

/** A coordinator needs to recognise an artisan in a table, not to dial them from it. */
export function mask(phone) {
  return phone.length > 4 ? '•••••' + phone.slice(-5) : phone;
}

/**
 * Top of a chart's y-axis: the data max rounded up to a round figure, so the gridline
 * labels and the plotted path are scaled by the same number.
 *
 * 🐞 They were not. The labels were hardcoded 40Cr→0 from the mockup while the path
 * normalised to its own max, which drew ₹31.2 Cr sitting where ₹37 Cr belongs — a chart
 * that overstates the headline number in front of judges is the worst kind of bug here.
 */
export function ceiling(values) {
  const max = Math.max(...values);
  const step = 1e7 * (max > 1e8 ? 10 : 1); // 10 Cr steps above 10 Cr, else 1 Cr
  return Math.ceil(max / step) * step;
}

/** SVG polyline through `values`, scaled to `top` rather than to the series' own max. */
export function line(values, w, h, top) {
  // A one-point series divides by zero and emits a literal "MNaN", which SVG renders as
  // nothing at all — a silently empty chart rather than a visible break.
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${(h - (v / top) * h).toFixed(1)}`)
    .join(' ');
}
