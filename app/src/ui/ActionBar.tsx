import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Where every action in this app lives.
 *
 * The rule, and it has no exceptions: **the primary action of a screen is a full-width
 * button pinned to the bottom of the viewport.** Not centred in the page, not floating
 * beside the content, not halfway down under a card.
 *
 * ── Why a rule and not a preference ─────────────────────────────────────────────
 * Before this, the primary control sat in a different place on nearly every screen: some
 * centred, some at the bottom, some inline after the content. For a user who reads the
 * screen that is untidy. For a user who CANNOT read the screen it is the whole problem —
 * they navigate this app by remembering where things are, so a control that moves is a
 * control they have to hunt for again every single time. Consistent position is not
 * styling here, it is the affordance.
 *
 * Bottom rather than centre because the phone is held one-handed by someone who may be
 * standing over a loom, and the bottom third is the only part of a 6.7" screen a thumb
 * reaches without regripping.
 *
 * ── The hierarchy is fixed at three, and only one of them is loud ───────────────
 *   primary    72px, accent fill, full width. Exactly one. Never optional.
 *   secondary  56px, outline. At most one. The way back, or the other choice.
 *   tertiary   text links at caption size. Skip, type instead, help.
 *
 * A screen that wants two primary actions has two questions on it and should be two
 * screens — that is design law rule 4 (one problem at a time), enforced by the component
 * rather than by everyone remembering it.
 *
 * ── Safe area ───────────────────────────────────────────────────────────────────
 * `--sa-bottom` is the gesture bar. Padding, not margin, so the bar's own background still
 * reaches the physical bottom edge and no strip of page shows through underneath it.
 */
export function ActionBar({
  primary,
  secondary,
  tertiary,
  className,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  /** Quiet text links. Rendered in one row, centred, below the buttons. */
  tertiary?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Opaque, not translucent: a blurred bar over a photo of a saree is unreadable in
        // sunlight, and this app's content is very often a photograph.
        'sticky bottom-0 z-30 border-t border-line bg-surface-1 px-3 pt-2',
        className,
      )}
      style={{ paddingBottom: 'calc(var(--sa-bottom, 0px) + var(--s-2))' }}
    >
      <div className="flex flex-col gap-2">
        {primary}
        {secondary}
        {tertiary && (
          <div className="flex items-center justify-center gap-3 pt-1">{tertiary}</div>
        )}
      </div>
    </div>
  );
}
