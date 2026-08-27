import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * The picture and the pitch every "you have nothing here yet" panel shows.
 *
 * A brand-new artisan sees four of these before they see a single product — /home,
 * /products, /orders and /earnings are all empty on the day the app is installed. They are
 * the app's real first impression, and until now each screen wrote its own version: a bare
 * line of grey text under a spinner that had stopped. On a screen someone cannot read,
 * "no data" and "this app is broken" look identical.
 *
 * ── The art is inline SVG, never a file ─────────────────────────────────────────
 * Four flat shapes drawn in `currentColor`, so one class recolours a whole illustration
 * and all four palettes need no second copy. It costs no request, cannot be the 200KB PNG
 * a "nice illustration" usually turns into, and cannot 404 on a rural connection and leave
 * a broken-image glyph as the empty state. Purely decorative — aria-hidden, never focusable.
 *
 * ── The missing thing is drawn as the gap ───────────────────────────────────────
 * Every composition draws what you HAVE solid and what you are MISSING as a dashed
 * outline. That is the whole reason these read without a caption: the hole is the message,
 * and a hole does not need translating into Hindi or Odia.
 *
 * 🔇 It does NOT speak, and that is deliberate.
 *
 * The person looking at an empty catalogue is exactly the person who most needs to be told
 * what to do next — but the SCREEN already tells them. Every caller of this component sets
 * its own prompt to the empty-case key (`products.empty`, `orders.empty`), and `Screen`
 * speaks the prompt. Speaking here as well would say the same sentence twice, and because
 * `say()` interrupts whatever is playing, the second call would cut the first one off
 * mid-word. One voice per screen, and it belongs to the prompt.
 */
export type EmptyArt = 'products' | 'orders' | 'earnings' | 'channels' | 'notFound';

/* One ink at different opacities. The ink is whatever the wrapper sets. */
const P = 'currentColor';

function Art({ art }: { art: EmptyArt }) {
  return (
    <svg
      viewBox="0 0 120 92"
      className="mx-auto h-[var(--i-art)] w-auto"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* The ground shadow every variant shares. Without it the shapes float in the middle
          of the card with nothing holding them down. */}
      <ellipse cx="60" cy="82" rx="34" ry="5" fill={P} opacity="0.09" />
      {art === 'products' && <ProductsArt />}
      {art === 'orders' && <OrdersArt />}
      {art === 'earnings' && <EarningsArt />}
      {art === 'channels' && <ChannelsArt />}
      {art === 'notFound' && <NotFoundArt />}
    </svg>
  );
}

/* A photographed pot, and the frame where the next one goes. The app's core loop is
   "photograph a thing", so the empty catalogue is a picture of one thing photographed. */
function ProductsArt() {
  return (
    <g>
      <rect x="16" y="26" width="44" height="46" rx="8" fill={P} opacity="0.85" />
      <path d="M27 60c0-7 6-13 11-13s11 6 11 13z" fill="var(--surface-1, #fff)" opacity="0.9" />
      <circle cx="38" cy="40" r="5" fill="var(--surface-1, #fff)" opacity="0.9" />
      <rect x="66" y="26" width="44" height="46" rx="8" stroke={P} strokeWidth="2.5" strokeDasharray="5 4" />
      <path d="M88 42v14M81 49h14" stroke={P} strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
    </g>
  );
}

/* An envelope with nothing in it yet — one order arriving is the shape of this screen. */
function OrdersArt() {
  return (
    <g>
      <rect x="22" y="30" width="76" height="46" rx="8" fill={P} opacity="0.14" />
      <rect x="22" y="30" width="76" height="46" rx="8" stroke={P} strokeWidth="2.5" opacity="0.6" />
      <path d="M22 36l38 26 38-26" stroke={P} strokeWidth="2.5" strokeLinejoin="round" opacity="0.85" />
      <circle cx="94" cy="26" r="11" stroke={P} strokeWidth="2.5" strokeDasharray="4 4" />
    </g>
  );
}

/* Coins stacking. Two solid, the third still an outline — money that has not arrived. */
function EarningsArt() {
  return (
    <g>
      <ellipse cx="60" cy="66" rx="26" ry="9" fill={P} opacity="0.85" />
      <ellipse cx="60" cy="52" rx="26" ry="9" fill={P} opacity="0.55" />
      <ellipse cx="60" cy="38" rx="26" ry="9" stroke={P} strokeWidth="2.5" strokeDasharray="5 4" />
      <path d="M60 20v-8M52 16l8-6 8 6" stroke={P} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </g>
  );
}

/* One shop connected, three waiting. The product goes out to places, not to a place. */
function ChannelsArt() {
  return (
    <g>
      <circle cx="60" cy="46" r="14" fill={P} opacity="0.85" />
      <circle cx="24" cy="30" r="9" stroke={P} strokeWidth="2.5" strokeDasharray="4 4" />
      <circle cx="96" cy="30" r="9" stroke={P} strokeWidth="2.5" strokeDasharray="4 4" />
      <circle cx="96" cy="66" r="9" fill={P} opacity="0.5" />
      <path d="M47 40L33 33M73 40l14-7M73 54l14 7" stroke={P} strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
    </g>
  );
}

/* A magnifier over nothing. Used when a filter or a lookup came back with no rows —
   a different fact from "you have not made anything yet", and it must not share art. */
function NotFoundArt() {
  return (
    <g>
      <circle cx="54" cy="40" r="22" stroke={P} strokeWidth="3" opacity="0.75" />
      <path d="M70 56l16 16" stroke={P} strokeWidth="4" strokeLinecap="round" opacity="0.75" />
      <path d="M44 40h20" stroke={P} strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
    </g>
  );
}

export function EmptyState({
  art,
  /**
   * Already-resolved text, not an i18n key — the caller has a `lang` and this component
   * deliberately does not. It must be the SAME sentence the screen's prompt speaks, or the
   * artisan hears one thing and sees another.
   */
  title,
  body,
  action,
  className,
}: {
  art: EmptyArt;
  title: string;
  body?: string;
  /**
   * Rendered by the CALLER into its ActionBar, not here.
   *
   * An empty state with its own button would put a primary action in the middle of the
   * page, which is the exact inconsistency the ActionBar exists to remove. This slot is
   * for a quiet inline hint only.
   */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-line bg-surface-1 px-3 py-5 text-center',
        className,
      )}
    >
      <div className="text-accent">
        <Art art={art} />
      </div>
      <p className="mt-3 text-body font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-[17rem] text-cap text-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
