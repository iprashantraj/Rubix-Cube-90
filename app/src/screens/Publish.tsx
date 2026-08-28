import {useState} from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useApiQuery } from '../api/useApi';
import type { Channel, PublishResult, PublishJob } from '../api/types';
import { useDraft, useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { ChannelBlock, type CopyItem } from './ChannelBlock';
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

  /*
   * 🐞 The colour lock has to be read from the SERVER, not from the draft.
   *
   * `draft.colourConfirmed` lives in memory and store.ts deliberately does not persist it.
   * So a reload, or reaching this screen for a product catalogued earlier, produced
   * `false` — and the send button rendered `disabled`, which meant tapping it did nothing,
   * forever, while the database said colour_confirmed = true. There was no way out of that
   * screen and nothing on it said why.
   *
   * `/products` already carries the flag, so this costs a cached list read and no new
   * endpoint. The draft still wins when it is set, because it is fresher than the list.
   */
  const { data: products } = useApiQuery<{ id: string; colour_confirmed: boolean }[]>('/products');
  // What they told us on /onboard/channels. Read from the session, not fetched: it is
  // answered once and a network hiccup must not silently put Amazon back on their screen.
  const sellsOn = useSession((s) => s.artisan?.sells_on);
  const productId = draft.listing?.product_id as string | undefined;
  const colourOk =
    draft.colourConfirmed ||
    Boolean(products?.find((p) => p.id === productId)?.colour_confirmed);
  const [results, setResults] = useState<Record<string, PublishResult>>({});
  const [stage, setStage] = useState(0); // index into TIERS
  const [busy, setBusy] = useState(false);
  // "Not this one" is a real answer. Kept in memory rather than persisted: it is a decision
  // about this listing today, not a standing preference, and a channel silently disabled
  // forever by one tap months ago is worse than being asked again.
  const [skipped, setSkipped] = useState<string[]>([]);

  /*
   * The per-channel listing text from POST /catalog, if it has arrived.
   *
   * Read out of the draft rather than re-fetched: /catalog/review already asked for it and
   * the shaping is deterministic, so a second call would return the same strings and cost
   * the artisan a wait on a rural network.
   */
  const copyFor = (id: string) =>
    ((draft.listing?.copy_blocks as Record<string, CopyItem[]> | undefined) ?? {})[id] ?? [];

  // The shared listing, shown at the top. Hindi first when that is the artisan's language:
  // the description they will be read back and the one a buyer sees should be the same one.
  const listingTitle = (draft.listing?.title as string | undefined) ?? '';
  const listingDesc =
    ((lang === 'hi' ? draft.listing?.desc_hi : draft.listing?.desc_en) as string | undefined) ||
    ((draft.listing?.desc_en as string | undefined) ?? '');
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

  /*
   * ⚠️ Only channels this artisan has anything to do with.
   *
   * /publish listed all seven regardless, so somebody who told us on /onboard/channels that
   * they have no Amazon and no Flipkart account was still shown both, with Connect buttons,
   * on every product. We asked the question and then ignored the answer, which is worse
   * than never asking — it teaches them their answers do not matter.
   *
   * What survives the filter:
   *   tier A       ours and ONDC. No account, no paperwork, always available to everyone.
   *   tier C       GeM, which produces a file anybody can upload.
   *   connected    we hold a token, so it is live whatever they said in onboarding.
   *   sells_on     they told us they have an account there.
   *
   * `sells_on` empty (or a pre-migration account) shows tier A and C only, which is exactly
   * the set that needs nothing from them.
   */
  /*
   * ⚠️ `owns` must be declared BEFORE anything that calls it.
   *
   * `readyNow` below used to sit above this line, and `const` bindings are in the temporal
   * dead zone until their declaration is evaluated — so the filter threw "Cannot access
   * 'owns' before initialization" on the first render and took the whole screen down. The
   * artisan finished pricing, tapped through, and got a blank page.
   *
   * TypeScript does not flag it (it permits the reference and trusts the ordering), and
   * neither does any test that never renders this component. Ordering is the guard.
   */
  const owns = (c: Channel) =>
    c.tier === 'A' || c.tier === 'C' || c.connected || (sellsOn ?? []).includes(c.id);

  /*
   * Everything the hero button will actually fire: tier A (needs nothing), tier C (produces
   * a file), and any tier B the artisan has connected. Deliberately excludes tier D and
   * unconnected B — the count under the button has to be a promise we keep, and claiming
   * seven when two can go is exactly the "one click everywhere" lie the tiering exists to
   * avoid.
   */
  const readyNow = (channels ?? []).filter(
    (c: Channel) =>
      !skipped.includes(c.id) &&
      owns(c) &&
      (c.tier === 'A' || c.tier === 'C' || (c.tier === 'B' && c.connected)),
  );

  const inTier = (tier: Channel['tier']) =>
    channels?.filter((c: Channel) => c.tier === tier && owns(c)) ?? [];

  /** The channels in this tier we can actually fire right now, which is not all of them. */
  const sendable = (tier: Channel['tier']) =>
    inTier(tier).filter(
      (c: Channel) =>
        !skipped.includes(c.id) && (tier === 'A' || tier === 'C' || c.connected),
    );

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

  /*
   * Every channel that can genuinely go, in one press.
   *
   * `send(tier)` still exists and still drives the per-section buttons below — this is not
   * a replacement for the tiered flow, it is the shortcut past it for the common case. The
   * distinction the adapters make is preserved exactly: a channel we cannot push to is not
   * in `readyNow`, so pressing this never claims to have sent something it did not.
   */
  async function sendAll() {
    const ids = readyNow.map((c) => c.id);
    if (ids.length === 0) return;
    await sendChannels(ids);
    // Past the sections, since they have just been fired. Anything needing a connect or a
    // manual upload is still below, and the rows now say so.
    setStage(TIERS.length - 1);
  }

  async function send(tier: Channel['tier']) {
    await sendChannels(sendable(tier).map((c: Channel) => c.id));
  }

  /** The actual fan-out. One implementation, so the hero button and the per-tier buttons
   *  cannot drift into behaving differently. */
  async function sendChannels(ids: string[]) {
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
    const result = results[c.id];
    const generic = RESULT_STATE[result?.status as keyof typeof RESULT_STATE] ?? pending(c);
    /*
     * ⚠️ A failure has to say WHICH failure.
     *
     * Every refusal in ChannelAdapter.preflight carries a message_key — `photo.missing`,
     * `colour.confirm` — and this row was throwing all of them away and rendering the same
     * "publish.failed" for every one. So the two most common problems in the system, both
     * of them fixable by the artisan in about ten seconds, looked identical and looked
     * permanent. Nine rows in the database say exactly this happened.
     */
    const state =
      result?.status === 'failed' && result.message_key
        ? { ...generic, key: result.message_key }
        : generic;
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
      {!colourOk && <p className="warn">{t(lang, 'colour.confirm')}</p>}

      {/*
        ⚠️ The listing itself, which this screen did not show at all.

        The artisan was being asked to press "send" on a page of channel names and status
        dots, with no sight of the words about to go out under their name. /catalog/review
        read the listing aloud several screens earlier, and between there and here they
        answered a pricing question — so as far as they could tell, the last page before
        publishing had nothing in it.

        Shown once, because it is the same text everywhere. What differs per channel is
        folded into each block below, for whoever wants to check it.
      */}
      {(listingTitle || listingDesc) && (
        <Card>
          <p style={{ margin: '0 0 6px' }}>
            <Chip tone="done">{t(lang, 'publish.general')}</Chip>
          </p>
          {listingTitle && (
            <p style={{ margin: '0 0 6px' }}>
              <strong>{listingTitle}</strong>
            </p>
          )}
          {listingDesc && (
            <p style={{ margin: 0, color: 'var(--muted)', userSelect: 'text' }}>{listingDesc}</p>
          )}
        </Card>
      )}

      {/*
        The one control this screen exists for, on its own and centred.

        It used to be the third element inside the first of four stacked cards, at roughly
        60% of the page height and the same visual weight as "connect your Amazon account".
        Somebody who has just spent four minutes photographing and describing a product is
        here to do one thing, and the screen made them hunt for it. Everything else is still
        below — the order just matches what people came for.
      */}
      <div className="pub-hero">
        <BigButton
          icon={IconPublish}
          labelKey="publish.send_all"
          onClick={() => {
            if (!colourOk) {
              say('colour.confirm');
              nav('/catalog/prefill');
              return;
            }
            sendAll();
          }}
          disabled={busy}
          tone="yes"
        />
        <p className="pub-hero__note">
          {t(lang, 'publish.send_all_note', { count: String(readyNow.length) })}
        </p>
      </div>

      <div className="pub-rest">
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

            {/*
              The active section shows full blocks — what is going to each app, foldable,
              with a copy button per field — because that is the section the artisan is
              deciding about right now. Sections already dealt with collapse back to one
              row each, so finishing tier A does not leave three cards of text above the
              thing they are being asked to do next.
            */}
            {active
              ? group.map((c) => (
                  <ChannelBlock
                    key={c.id}
                    channel={{
                      ...c,
                      status: results[c.id]?.status,
                      artifactUrl: results[c.id]?.artifact_url ?? null,
                      copy: copyFor(c.id),
                    }}
                    lang={lang}
                    busy={busy}
                    onPublish={() => send(tr)}
                    onSkip={() => setSkipped((sk) => [...sk, c.id])}
                  />
                ))
              : group.map(row)}

            {active && (
              <>
                {canSend && (
                  /*
                   * Disabled ONLY while a send is in flight. Never for the colour lock.
                   *
                   * Design law rule 3: every failure degrades and speaks. A greyed-out
                   * primary button is the most silent failure a screen can have — it looks
                   * identical to a broken app, and someone who cannot read the warning
                   * above it has no way to discover what it wants. So it stays pressable
                   * and, when the colour is not confirmed, says so and takes them to the
                   * one screen that can fix it.
                   */
                  <BigButton
                    icon={IconPublish}
                    labelKey={SECTION[tr as keyof typeof SECTION].sendKey ?? undefined}
                    onClick={() => {
                      if (!colourOk) {
                        say('colour.confirm');
                        nav('/catalog/prefill');
                        return;
                      }
                      send(tr);
                    }}
                    disabled={busy}
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
      </div>
    </Screen>
  );
}
