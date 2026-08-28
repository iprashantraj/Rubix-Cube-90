import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n/index';
import { useVoice } from '../voice/useVoice';
import { Card, Chip, BigButton } from '../ui/kit';
import { IconForward, IconYes, IconNext, IconWrite, IconPublish } from '../ui/icons';
import type { Lang } from '../i18n/index';

/**
 * One marketplace, and exactly what is going to it.
 *
 * ── Why the general listing is the headline and the per-platform text is folded away ──
 * An artisan does not want to read seven versions of their own description. They want to
 * know what their product says. So the shared copy is shown once, at the top of /publish,
 * and each channel row stays a row until they ask it to open.
 *
 * The per-platform text is genuinely different, though, and that is the point of letting
 * them see it: Amazon's title is cut to 75 characters, GeM's has their own name stripped
 * out of it because GeM rejects listings carrying seller identity, and Flipkart gets three
 * search words where Amazon gets a 249-byte string. Somebody who wants to check that is
 * usually somebody about to paste it into a form by hand, and they should be able to.
 *
 * ── Copy is per field, not one blob ─────────────────────────────────────────────────
 * The artisan is holding their phone in one hand and looking at a marketplace form in the
 * other. A single "copy everything" button hands them a block they then have to split into
 * the right boxes — and splitting text is reading, which is the thing we cannot assume.
 * One button per field, in the order the form asks for them.
 *
 * ── Three different asks, and a row must only ever make one ─────────────────────────
 *   connected      we hold a token, so: publish, or skip this one.
 *   has an account we can do nothing yet, so: connect it.
 *   file only      GeM has no seller API at all, so: download the sheet.
 */

export type CopyItem = { field: string; voice_key: string; copy: string };

export type ChannelView = {
  id: string;
  name: string;
  tier: string;
  connected?: boolean;
  /** They told us in onboarding that they have an account here. */
  owned?: boolean;
  status?: string;
  artifactUrl?: string | null;
  copy?: CopyItem[];
};

/** Copy, and say so out loud — a silent clipboard write is indistinguishable from a dead button. */
function useCopy() {
  const { say } = useVoice();
  const [copied, setCopied] = useState<string | null>(null);

  return {
    copied,
    async copy(item: CopyItem) {
      try {
        await navigator.clipboard.writeText(item.copy);
        setCopied(item.field);
        say('publish.copied');
        // Long enough to read, short enough that two fields in a row do not blur together.
        setTimeout(() => setCopied((c) => (c === item.field ? null : c)), 2000);
      } catch {
        // Clipboard denied or unavailable in this WebView. The text is on screen and
        // selectable, which is the honest fallback — better than a button that lies.
        say('publish.copy_failed');
      }
    },
  };
}

export function ChannelBlock({
  channel,
  lang,
  onPublish,
  onSkip,
  busy,
}: {
  channel: ChannelView;
  lang: Lang;
  onPublish?: (id: string) => void;
  onSkip?: (id: string) => void;
  busy?: boolean;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();

  const isFile = channel.tier === 'C';
  const needsConnect = channel.tier === 'B' && !channel.connected;
  const canPublish = channel.tier === 'A' || (channel.tier === 'B' && channel.connected);

  return (
    <Card>
      <p style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong className="chan__name">{channel.name}</strong>
        {channel.connected && <Chip tone="done">{t(lang, 'channels.connected')}</Chip>}
      </p>

      {/* The fold. Closed by default: seven open blocks is a wall of text nobody reads. */}
      <button className="help" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconForward size={18} aria-hidden="true" />
        <span>{t(lang, open ? 'publish.hide_platform' : 'publish.see_platform')}</span>
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {(channel.copy ?? []).map((item) => (
            <div key={item.field} style={{ marginBottom: 12 }}>
              <p style={{ margin: '0 0 4px', color: 'var(--muted)' }}>
                {t(lang, `field.${item.field}`)}
              </p>
              {/* Selectable, so a failed clipboard is still a recoverable situation. */}
              <p style={{ margin: '0 0 6px', userSelect: 'text', wordBreak: 'break-word' }}>
                {item.copy}
              </p>
              <button className="help" onClick={() => copy(item)}>
                {copied === item.field ? (
                  <IconYes size={18} aria-hidden="true" />
                ) : (
                  <IconWrite size={18} aria-hidden="true" />
                )}
                <span>{t(lang, copied === item.field ? 'publish.copied' : 'publish.copy')}</span>
              </button>
            </div>
          ))}
          {(channel.copy ?? []).length === 0 && (
            <p style={{ color: 'var(--muted)' }}>{t(lang, 'publish.nothing_yet')}</p>
          )}
        </div>
      )}

      {/* GeM has no seller API, so the sheet IS the integration. A real download, from
          GET /publish/gem/{id}.xlsx, which builds it on request. */}
      {isFile && channel.artifactUrl && (
        <BigButton
          icon={IconNext}
          labelKey="publish.download_file"
          onClick={() => nav(`/channels/${channel.id}/setup`)}
        />
      )}

      {needsConnect && (
        <BigButton
          icon={IconForward}
          labelKey="publish.integrate"
          onClick={() => nav(`/channels/${channel.id}/setup`)}
        />
      )}

      {canPublish && onPublish && (
        <BigButton
          icon={IconPublish}
          labelKey="publish.publish_now"
          onClick={() => onPublish(channel.id)}
          disabled={busy}
          tone="yes"
        />
      )}

      {/* Skip is always available and always quiet. "Not this one" is a real answer, and
          an artisan who does not want to be on Amazon today should not have to fight the
          screen about it. */}
      {onSkip && (
        <div className="alt">
          <button className="help" onClick={() => onSkip(channel.id)}>
            <IconNext size={18} aria-hidden="true" />
            <span>{t(lang, 'publish.skip')}</span>
          </button>
        </div>
      )}
    </Card>
  );
}
