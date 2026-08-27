import { useEffect, useRef } from 'react';
import { useVoice } from '../voice/useVoice.js';
import { cn } from '../lib/utils';

/**
 * Waiting, as something the artisan can understand without reading.
 *
 * What this replaces, and why each was wrong:
 *
 *   a centred spinner        A spinning ring is the same picture whether the app is
 *                            fetching fourteen products, saving a name, or hung. It says
 *                            "something is happening" to someone who can already see that
 *                            nothing is happening.
 *   a greyed-out button      Used on several screens as the only loading signal. It
 *                            communicates precisely nothing to a person who cannot read
 *                            the label that just went grey, and is indistinguishable from
 *                            a button that is simply not available yet. BANNED as a
 *                            loading state — see docs/app/DESIGN.md §10.
 *
 * ── The skeleton is the page with its content removed ───────────────────────────
 * Not a generic grey block. A products skeleton is four product rows at the real row
 * height; an orders skeleton is four order rows. Two things follow from that: the page
 * does not jump when the data lands, and the shape itself is a promise about what is
 * coming — which is information a spinner cannot carry.
 *
 * ── It speaks, once, if the wait is long ────────────────────────────────────────
 * Anything past `speakAfterMs` says what it is waiting for, in the artisan's language.
 * Rule 3: every failure degrades and speaks — and a wait long enough to look like a
 * failure has to speak too. Once only: a sentence repeating every two seconds is how an
 * app gets muted, and after that every spoken instruction in the flow is lost.
 */

/** One shimmering block. Sized by the caller, because only the caller knows the shape. */
export function Skel({ className }: { className?: string }) {
  return <span className={cn('skel', className)} aria-hidden="true" />;
}

/**
 * A list row: leading square, two lines of text, trailing value. The shape /products,
 * /orders, /earnings and /channels all share.
 */
function RowSkel() {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0">
      <Skel className="h-[var(--tap)] w-[var(--tap)] shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skel className="h-[21px] w-3/5 rounded-sm" />
        <Skel className="h-[13px] w-2/5 rounded-sm" />
      </div>
      <Skel className="h-[21px] w-12 shrink-0 rounded-sm" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
      {Array.from({ length: rows }).map((_, i) => (
        <RowSkel key={i} />
      ))}
    </div>
  );
}

/** /home: the summary panel, then two groups of rows. */
export function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface-1 p-3 shadow-e1">
        <Skel className="h-[13px] w-24 rounded-sm" />
        <Skel className="mt-2 h-[55px] w-44 rounded-md" />
      </div>
      <ListSkeleton rows={2} />
      <ListSkeleton rows={3} />
    </div>
  );
}

/**
 * The wrapper a screen actually renders.
 *
 * `label` is an i18n key describing what is being waited FOR — "loading your products",
 * not "loading". The difference is whether the artisan can tell a slow catalogue from a
 * stuck app.
 */
export function LoadState({
  label,
  children,
  speakAfterMs = 1500,
}: {
  label?: string;
  /** The skeleton. Defaults to a list, which is what most screens are. */
  children?: React.ReactNode;
  speakAfterMs?: number;
}) {
  const { say } = useVoice();
  const spoken = useRef(false);

  useEffect(() => {
    if (!label || spoken.current) return undefined;
    // A fast response must stay silent. Announcing a wait that has already finished is
    // the app talking over the screen the artisan is now looking at.
    const id = setTimeout(() => {
      spoken.current = true;
      say(label, undefined);
    }, speakAfterMs);
    return () => clearTimeout(id);
  }, [label, say, speakAfterMs]);

  return (
    <div role="status" aria-busy="true" aria-live="polite">
      {children ?? <ListSkeleton />}
    </div>
  );
}
