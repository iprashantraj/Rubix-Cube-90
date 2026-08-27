/**
 * The Kaarigar mark.
 *
 * ⚠️ Placeholder, and honestly so. It is geometry we can draw ourselves rather than a
 * designed identity, and it exists because the app was shipping the stock Capacitor logo —
 * a generic developer-tool glyph on the launcher of an app for artisans. Replace it. The
 * shape lives in exactly two places, this file and tools/make-icons.py, so replacing it is
 * one path and one regeneration.
 *
 * What it is trying to say, so a real designer has somewhere to start:
 *
 *   the diamond   the ikat/phoda-kumbha lozenge that runs through Sambalpuri weaving,
 *                 Pattachitra borders and half the textile traditions the PS names. It is
 *                 the most widely shared motif our users would actually recognise, and it
 *                 is not any one craft's property.
 *   the weave     the lozenge is built from a warp and a weft crossing, not drawn as an
 *                 outline. The craft is the structure, not a picture of a product.
 *   the chevron   one thread lifted clear of the cloth, above the motif. That is the whole
 *                 product in one stroke: the work leaves the loom and reaches a market.
 *
 * Drawn on a 120x120 grid with everything on 15px multiples so it stays crisp when it is
 * rasterised down to a 48px mdpi launcher icon. `currentColor` throughout — the splash
 * paints it white on the accent, and the icon generator paints it white on the accent too.
 */
export default function Mark({ size = 120, ...rest }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {/* The lozenge, as two crossed threads rather than one closed outline. */}
      <path d="M60 34 L86 60 L60 86 L34 60 Z" />
      {/* The cross inside it — warp meeting weft, and what makes it read as woven cloth
          rather than as a plain rhombus at 48px. */}
      <path d="M60 47 L73 60 L60 73 L47 60 Z" fill="currentColor" stroke="none" />
      {/* The lifted thread. Detached on purpose: it is leaving. */}
      <path d="M44 22 L60 8 L76 22" />
    </svg>
  );
}
