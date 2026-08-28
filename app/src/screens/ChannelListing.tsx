import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useDraft } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { Screen, Card, BigButton } from '../ui/kit';
import { IconYes, IconWrite, IconBack } from '../ui/icons';

/**
 * /publish/:channelId — exactly what goes to one marketplace, one field at a time.
 *
 * ── Why this is a page and not a fold ───────────────────────────────────────────────
 * It started as an expander inside the channel row on /publish. Wrong shape for what the
 * artisan is actually doing here: they have their phone in one hand and a marketplace form
 * in the other, and they are going to be on this screen for a couple of minutes, tabbing
 * out to another app and back. That is a destination, not a disclosure triangle — a fold
 * collapses the moment anything re-renders, and it shares the screen with six other
 * channels' worth of noise while they are trying to find one field.
 *
 * ── One button per field, in the order the form asks ────────────────────────────────
 * Not one "copy everything" button. That hands them a block they then have to split into
 * the right boxes, and splitting text is reading — the thing we cannot assume. Each field
 * is its own card with its own copy button, in the order that platform's form presents
 * them, so the artisan works down this screen and down that form together.
 *
 * ── The text is visible, not just copyable ──────────────────────────────────────────
 * Selectable and on screen, because clipboard access fails in a WebView more often than
 * anyone expects and a copy button that silently did nothing is indistinguishable from a
 * broken app. If the button fails they can still select it by hand.
 *
 * What differs per platform is real and worth seeing: Amazon's title is cut to 75
 * characters, GeM's has the artisan's own name stripped out because GeM rejects listings
 * carrying seller identity, Flipkart gets three search words where Amazon gets a 249-BYTE
 * string. All of that is computed in ai/catalog/seo.py and arrives here already shaped.
 */

type CopyItem = { field: string; voice_key: string; copy: string };

export default function ChannelListing() {
  const { channelId = '' } = useParams();
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const draft = useDraft();
  const [copied, setCopied] = useState<string | null>(null);

  const blocks =
    ((draft.listing?.copy_blocks as Record<string, CopyItem[]> | undefined) ?? {})[channelId] ?? [];

  // Deep-linked, or reloaded after the draft was cleared. The listing lives in memory only
  // (store.ts), so there is nothing to show and nothing to recover — back to the list.
  if (!draft.listing) return <Navigate to="/publish" replace />;

  async function copy(item: CopyItem) {
    try {
      await navigator.clipboard.writeText(item.copy);
      setCopied(item.field);
      say('publish.copied');
      setTimeout(() => setCopied((c) => (c === item.field ? null : c)), 2000);
    } catch {
      // The text is on screen and selectable. Saying so is better than a button that lies.
      say('publish.copy_failed');
    }
  }

  return (
    <Screen prompt="publish.see_platform" back="/publish">
      {blocks.length === 0 && <p className="warn">{t(lang, 'publish.nothing_yet')}</p>}

      {blocks.map((item) => (
        <Card key={item.field}>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)' }}>
            {t(lang, `field.${item.field}`)}
          </p>
          <p
            style={{
              margin: '0 0 12px',
              userSelect: 'text',
              wordBreak: 'break-word',
              lineHeight: 1.45,
            }}
          >
            {item.copy}
          </p>
          <BigButton
            icon={copied === item.field ? IconYes : IconWrite}
            labelKey={copied === item.field ? 'publish.copied' : 'publish.copy'}
            onClick={() => copy(item)}
            tone={copied === item.field ? 'yes' : undefined}
          />
        </Card>
      ))}

      <div className="alt">
        <button className="help" onClick={() => nav('/publish')}>
          <IconBack size={20} aria-hidden="true" />
          <span>{t(lang, 'common.back')}</span>
        </button>
      </div>
    </Screen>
  );
}
