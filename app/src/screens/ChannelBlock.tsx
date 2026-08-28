import { useNavigate } from 'react-router-dom';
import { t } from '../i18n/index';
import { Card, Chip, BigButton } from '../ui/kit';
import { IconForward, IconNext, IconPublish } from '../ui/icons';
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
 * ── The per-platform text lives on its own page ─────────────────────────────────────
 * This row links to /publish/:channelId rather than expanding. The artisan will be there
 * for a couple of minutes with a marketplace form open in another app, copying one field
 * at a time — a destination, not a disclosure triangle. See ChannelListing.
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

  const isFile = channel.tier === 'C';
  const needsConnect = channel.tier === 'B' && !channel.connected;
  const canPublish = channel.tier === 'A' || (channel.tier === 'B' && channel.connected);

  return (
    <Card>
      <p style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong className="chan__name">{channel.name}</strong>
        {channel.connected && <Chip tone="done">{t(lang, 'channels.connected')}</Chip>}
      </p>

      {/* Goes to a page, not a fold. The artisan is about to spend a couple of minutes
          here with a marketplace form open in another app, and a disclosure triangle that
          collapses on the next render — sharing a screen with six other channels — is the
          wrong shape for that. See ChannelListing. */}
      {(channel.copy ?? []).length > 0 && (
        <button className="help" onClick={() => nav(`/publish/${channel.id}`)}>
          <IconForward size={18} aria-hidden="true" />
          <span>{t(lang, 'publish.see_platform')}</span>
        </button>
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
