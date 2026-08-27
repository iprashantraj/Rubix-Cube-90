/*
 * Screen illustrations. Bigger than icons and doing a different job.
 *
 * An icon labels a control. These carry the MEANING of a screen for someone who cannot read
 * the paragraph under them — the shield says "your things are held safely" before a single
 * word is spoken, and it says it while the voice is still loading on a slow connection.
 *
 * Rules, same as ui/icons.jsx:
 *   - inline SVG, no dependency, no raster, no icon font
 *   - `currentColor` for line work so the palette in ui/theme.js drives them, and one accent
 *     prop for the single warm fill each one is allowed
 *   - a square viewBox and no fixed size: the CSS decides how big, because the same drawing
 *     is used on a 4-inch phone and a tablet
 *   - stroke, not fill, for structure. A line drawing survives being scaled down to a thumb
 *     and stays legible on the cheap low-contrast panels our users actually own.
 *
 * Deliberately not clip-art: three or four shapes each, generous negative space, and the
 * same 2px-at-100px stroke weight throughout so a screen never looks like it borrowed art
 * from somewhere else.
 */

const base = {
  viewBox: '0 0 100 100',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/**
 * /consent — a shield holding a spool of thread.
 *
 * The shield is the promise; the thread is whose promise it is. A padlock would have said
 * "security" in the abstract, which is a bank's word, not a weaver's.
 */
export function ArtShield({ className }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <path d="M50 12 82 24v26c0 18-13 31-32 38-19-7-32-20-32-38V24z" />
      <circle cx="50" cy="52" r="13" opacity="0.9" />
      <path d="M50 39v26M37 46h26M37 58h26" opacity="0.55" />
    </svg>
  );
}

/**
 * /lang — one word in three scripts, radiating from a single point.
 *
 * Not a globe and not a pair of flags: the choice on that screen is which script the app
 * will speak in, and a globe says "international" to someone who has never left the district.
 */
export function ThreeScripts({ className }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <circle cx="50" cy="50" r="30" opacity="0.35" />
      <path d="M50 20v60M20 50h60" opacity="0.25" />
      <text
        x="50"
        y="44"
        textAnchor="middle"
        fontSize="20"
        fill="currentColor"
        stroke="none"
        fontWeight="700"
      >
        अ
      </text>
      <text
        x="35"
        y="70"
        textAnchor="middle"
        fontSize="17"
        fill="currentColor"
        stroke="none"
        fontWeight="700"
        opacity="0.75"
      >
        ଅ
      </text>
      <text
        x="66"
        y="70"
        textAnchor="middle"
        fontSize="17"
        fill="currentColor"
        stroke="none"
        fontWeight="700"
        opacity="0.75"
      >
        A
      </text>
    </svg>
  );
}

/**
 * /auth — a phone with a message arriving.
 *
 * This screen asks for a number and then for a code that will arrive on that number. Both
 * halves of that are in one drawing, so the illustration explains the screen rather than
 * decorating it.
 */
export function PhoneAndCode({ className }: { className?: string }) {
  return (
    <svg {...base} className={className}>
      <rect x="30" y="14" width="40" height="72" rx="8" />
      <path d="M44 24h12" opacity="0.6" />
      <rect x="38" y="38" width="42" height="26" rx="5" fill="var(--surface-0, #fff)" />
      <path d="M38 43l21 13 21-13" opacity="0.8" />
    </svg>
  );
}
