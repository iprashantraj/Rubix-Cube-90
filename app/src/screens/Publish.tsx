import {useState} from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApiQuery } from '../api/useApi';
import type { Channel, PublishResult, PublishJob } from '../api/types';
import { useDraft } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { Screen, Card, Chip, BigButton, StatusDot } from '../ui/kit';
import { IconPublish, IconNext, IconForward, IconYes } from '../ui/icons';


/**
 * /publish — the screen this entire product exists for. Spec §8, architecture §1 and §6.
 *
 * ❌ What this used to be: one green "sabhi jagah bhejein" button.
 *
 * That button was wrong twice over. It implied a single uniform thing happens everywhere,
 * which is false — Meesho and WhatsApp have no API at all and never did — and it left the
 * artisan with nobody explaining what they were expected to do about that. Pressing it and
 * then discovering the catch is how a product loses trust it does not get back.
 *
 * ✅ What it is now: four sections, in tier order, each one stating the artisan's effort and
 * whether their own account is needed BEFORE they tap anything.
 *
 *   A  our marketplace, ONDC   "yahaan seedha aapka saamaan list ho jayega" — no account,
 *                              no paperwork, genuinely one tap. Never blocked on anything.
 *   B  Amazon, Flipkart        one tap, but only after a one-time connect. Not connected?
 *                              the section says so and routes to /channels/:id/setup.
 *   C  GeM                     no seller API exists. We make a category-correct .xlsx and
 *                              say plainly that the upload is theirs to do.
 *   D  Meesho, WhatsApp        no API at all. Guided browser, step by step.
 *
 * Sections reveal one at a time so the design law survives (<= 3 tappable things per
 * section, one problem at a time) and so each one gets its own spoken prompt on entry.
 * Tier A is section one and depends on nothing — a brand-new artisan with no accounts, no
 * GST and no paperwork still reaches a live listing without ever seeing sections B, C or D.
 * That is the demo, and moving past a section is always optional.
 *
 * 🔊 Honesty rule, from the adapters up: `live` means a listing exists that we could be
 * asked to show. `dry_run` means the mapping ran and nothing was transmitted. That
 * distinction is SPOKEN here (publish.partly_sent), not just coloured — an artisan who
 * cannot read the chip is exactly the person a fake "live" would fool.
 */

const TIERS = ['A', 'B', 'C', 'D'] as const;

/**
 * What each section promises. `tierKey` reuses the exact wording /channels and
 * /channels/:id/setup already use — an artisan who hears "aapko kuch nahin karna" on one
 * screen and something different two taps later stops trusting either.
 */
const SECTION = {
  A: { tone: 'done', bodyKey: 'publish.a_body', effortKey: 'publish.a_effort', sendKey: 'publish.a_send' },
  B: { tone: 'ready', bodyKey: 'publish.b_body', effortKey: 'publish.b_effort', sendKey: 'publish.b_send' },
  C: { tone: 'pending', bodyKey: 'publish.c_body', effortKey: 'publish.c_effort', sendKey: 'publish.c_send' },
  D: { tone: 'blocked', bodyKey: 'publish.d_body', effortKey: 'publish.d_effort', sendKey: null },
};

/** Adapter status -> what the row shows. Mirrors channels/base.py STATUSES exactly. */
const RESULT_STATE = {
  live: { status: 'done', key: 'publish.live' },
  dry_run: { status: 'pending', key: 'publish.dry_run' },
  file_ready: { status: 'ready', key: 'publish.file_ready' },
  needs_connect: { status: 'blocked', key: 'publish.connect' },
  needs_help: { status: 'pending', key: 'publish.guide_me' },
  failed: { status: 'error', key: 'publish.failed' },
};

/** What a channel shows before anything has been attempted on it. */
function pending(c: Channel) {
  if (c.tier === 'A') return { status: 'ready', key: 'publish.instant' };
  if (c.tier === 'B') return c.connected
    ? { status: 'ready', key: 'publish.instant' }
    : { status: 'blocked', key: 'publish.connect' };
  if (c.tier === 'C') return { status: 'pending', key: 'publish.file_ready' };
  return { status: 'pending', key: 'publish.guide_me' };
}

export default function Publish() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const draft = useDraft();
  const { data: channels, isPending, error } = useApiQuery<Channel[]>('/channels');
  const [results, setResults] = useState<Record<string, PublishResult>>({});
  const [stage, setStage] = useState(0); // index into TIERS
  const [busy, setBusy] = useState(false);
  // Query failures and publish failures are different facts — see the note in Earnings.
  const [mutError, setError] = useState<string | null>(null);
  const errKey =
    mutError ?? (error ? ((error as ApiError).messageKey ?? 'error.unknown') : null);

  // This is the last screen of the create flow and the artisan has already waited through a
  // capture, an upload and a voice interview to reach it. The channel list has not changed
  // in that time — serve it, and let the revalidation correct it behind them.
  //
  // The `/publish/{jobId}` poll further down stays a plain `api.get`: a job status is the
  // one thing in this app that must never be answered from a copy.

  const inTier = (tier: Channel['tier']) => channels?.filter((c: Channel) => c.tier === tier) ?? [];

  /** The channels in this tier we can actually fire right now, which is not all of them. */
  const sendable = (tier: Channel['tier']) =>
    inTier(tier).filter((c: Channel) => tier === 'A' || tier === 'C' || c.connected);

  /**
   * One utterance, never two. speak() interrupts whatever is playing, so a second say()
   * would simply erase the first — which is why the dry-run count rides in the SAME
   * sentence as the live count. "It did not go" must not be the half that gets cut off.
   */
  function speakOutcome(got: Record<string, PublishResult>) {
    const all = Object.values(got);
    const live = all.filter((r) => r.status === 'live').length;
    const dry = all.filter((r) => r.status === 'dry_run').length;
    const file = all.filter((r) => r.status === 'file_ready').length;

    if (dry && live) say('publish.partly_sent', { count: live, pending: dry });
    else if (dry) say('publish.nothing_sent');
    else if (live) say('publish.done', { count: live });
    else if (file) say('publish.file_made');
    else say('error.unknown');
  }

  async function send(tier: Channel['tier']) {
    const ids = sendable(tier).map((c: Channel) => c.id);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      let job = (await api.post('/publish', {
        product_id: draft.listing?.product_id,
        channels: ids,
      })) as PublishJob;
      // Each adapter reports independently. One channel failing must never take the others
      // down with it — a GeM schema mismatch cannot be allowed to block a marketplace write
      // that would have gone through fine. The POST already carries the finished results
      // today; the poll is here only so moving the fan-out to a worker needs no change here.
      const jobId = job.job_id;
      while (job.status === 'running') {
        await new Promise((r) => setTimeout(r, 1000));
        job = (await api.get(`/publish/${jobId}`)) as PublishJob;
      }
      setResults((prev) => ({ ...prev, ...job.results }));
      speakOutcome(job.results);
    } catch (e) {
      setError((e as ApiError).messageKey ?? 'error.unknown');
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <Screen prompt="common.loading" state="loading" loadingLabel="common.loading" />;

  const current = TIERS[stage];
  const last = stage === TIERS.length - 1;
  const attempted = (tier: Channel['tier']) => sendable(tier).length > 0 && sendable(tier).every((c: Channel) => results[c.id]);

  // The prompt is per-section, so advancing re-speaks — every screen speaks on entry, and a
  // section the artisan cannot read is a section they were never told about.
  const prompt = errKey ?? `publish.${current.toLowerCase()}_prompt`;

  /** A channel row. Tappable only when there is genuinely somewhere for it to go. */
  function row(c: Channel) {
    const state = RESULT_STATE[results[c.id]?.status as keyof typeof RESULT_STATE] ?? pending(c);
    const goesToSetup =
      (c.tier === 'B' && !c.connected) ||
      (c.tier === 'C' && results[c.id]?.status === 'file_ready') ||
      c.tier === 'D';
    return (
      <button
        key={c.id}
        className="chan"
        onClick={() => nav(`/channels/${c.id}/setup`)}
        disabled={!goesToSetup}
      >
        <StatusDot status={state.status} />
        <span className="chan__name">{c.name}</span>
        <span className="chan__state">
          {t(lang, c.tier === 'C' && goesToSetup ? 'publish.upload_now' : state.key)}
        </span>
        {goesToSetup && <IconForward size={20} aria-hidden />}
      </button>
    );
  }

  return (
    <Screen prompt={prompt}>
      {errKey && <p className="warn">{t(lang, errKey)}</p>}

      {/*
        Colour lock (spec §5.6). Publishing before the artisan has confirmed the colour is
        how a maroon saree ships as orange, gets returned, and takes their rating with it.
      */}
      {!draft.colourConfirmed && <p className="warn">{t(lang, 'colour.confirm')}</p>}

      {TIERS.slice(0, stage + 1).map((tr) => {
        const group = inTier(tr);
        if (group.length === 0) return null;
        const active = tr === current;
        const canSend = active && SECTION[tr].sendKey && sendable(tr).length > 0 && !attempted(tr);

        return (
          <Card key={tr} raised={active}>
            <p style={{ margin: '0 0 6px' }}>
              <Chip tone={SECTION[tr].tone}>{t(lang, `channels.tier_${tr.toLowerCase()}`)}</Chip>
            </p>
            {/* What actually happens, then what it costs them. Both before the tap. */}
            <p style={{ margin: '0 0 6px' }}>{t(lang, SECTION[tr].bodyKey)}</p>
            <p style={{ margin: '0 0 12px', color: 'var(--muted)' }}>
              {t(lang, SECTION[tr].effortKey)}
            </p>

            {/* The one thing nobody was telling them: which of these they have to join. */}
            {tr === 'B' && sendable('B').length === 0 && (
              <p style={{ margin: '0 0 12px' }}>{t(lang, 'publish.b_none_connected')}</p>
            )}

            {group.map(row)}

            {active && (
              <>
                {canSend && (
                  <BigButton
                    icon={IconPublish}
                    labelKey={SECTION[tr as keyof typeof SECTION].sendKey ?? undefined}
                    onClick={() => send(tr)}
                    disabled={busy || !draft.colourConfirmed}
                  />
                )}
                {last ? (
                  <BigButton
                    icon={IconYes}
                    labelKey="setup.done"
                    tone="yes"
                    onClick={() => nav('/products')}
                    disabled={busy}
                  />
                ) : (
                  <BigButton
                    icon={IconNext}
                    labelKey="common.next"
                    tone="yes"
                    onClick={() => setStage((s) => s + 1)}
                    disabled={busy}
                  />
                )}
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}
