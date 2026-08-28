import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cachedGet } from '../api/client.js';
import { record, transcribe } from '../voice/listen.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Spinner, HelpButton } from '../ui/kit.jsx';
import { IconMic, IconNext, IconChannel, IconYes } from '../ui/icons.jsx';
import { TIER } from './Channels.jsx';

/**
 * /channels/:id/setup — getting an artisan an account they do not have. Architecture §6.
 *
 * The principle, unchanged from Master ref §1.4: **we teach, they act. We hold no
 * documents.** Nothing on this screen ever asks for a PAN number, an Aadhaar number or a
 * password. We do not store them, so we cannot leak them, so we cannot lose them.
 *
 * The screen is entirely tier-shaped, because the tiers are not a taxonomy — they are four
 * genuinely different amounts of work, and pretending otherwise is the failure mode this
 * whole document exists to avoid:
 *
 *   A  there is nothing to do, and saying so IS the feature. We are the ONDC Marketplace
 *      Seller Node; the artisan is a sub-seller under our node. No registration, no
 *      DigiReady, no GST. This branch renders a congratulation, not a form.
 *   B  a one-time OAuth. They make the seller account on the platform's own site, then tap
 *      connect. We never see a password — only an encrypted refresh token.
 *   C  GeM. Register on gem.gov.in, then upload the .xlsx we generate. Starts with the name
 *      pre-check below, which is the highest-value 20 seconds in the app.
 *   D  no API exists. Voice-guided browser on their own account, their own session.
 *
 * 🔎 Known gaps, stated rather than papered over:
 *   - There is no endpoint yet to persist `signup_status = self_reported_done`, so "maine
 *     kar diya" currently only speaks back and returns. The row in ChannelStatus exists;
 *     the write does not. One POST when the channels router grows it.
 *   - §6.3 specifies the guided bar PINNED to the bottom of the in-app browser. That needs
 *     a native overlay on the WebView, which Capacitor's InAppBrowser does not give us from
 *     React. Until it does, the steps live on this screen and the portal opens on top of
 *     it. Slower, never broken — which is rule 2 of §6.4 applied to ourselves.
 */

/**
 * Where each channel's signup actually lives. Public, stable URLs — they sit here rather
 * than on the server only because they have never changed; the selector packs that DO
 * change are already served at runtime for exactly that reason.
 */
const PORTAL = {
  gem: 'https://gem.gov.in/register',
  amazon: 'https://sellercentral.amazon.in/',
  flipkart: 'https://seller.flipkart.com/',
  meesho: 'https://supplier.meesho.com/',
  whatsapp: 'https://business.whatsapp.com/',
};

/** The three documents whose names must agree before GeM will accept a registration. */
const NAME_SOURCES = ['setup.name_pan', 'setup.name_bank', 'setup.name_aadhaar'];

/** ASR noise is not a name mismatch. Strip everything that is not a letter, then compare. */
const normalise = (s) => (s ?? '').toLowerCase().replace(/[^\p{L}]/gu, '');

async function openPortal(url) {
  // Capacitor's in-app browser on device, a plain tab on the dev web build. Wrapped
  // because a missing plugin must not take the screen down with it — losing the browser
  // costs a tap, losing the screen costs the whole registration.
  try {
    const { InAppBrowser } = await import('@capacitor/inappbrowser');
    await InAppBrowser.openInWebView({ url, options: { showURL: true, showToolbar: true } });
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

export default function ChannelSetup() {
  const { id } = useParams();
  const nav = useNavigate();
  const { lang, say } = useVoice();

  const [channel, setChannel] = useState(null);
  const [me, setMe] = useState(null);
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);

  // GeM only. `verdict` is deliberately three-valued: "we could not check" is not the same
  // as "they match", and collapsing the two would hand someone a false all-clear on the
  // most expensive mistake this screen exists to prevent.
  const [names, setNames] = useState([]);
  const [verdict, setVerdict] = useState(null); // null | 'match' | 'mismatch' | 'unchecked'
  const [listening, setListening] = useState(false);
  const [step, setStep] = useState(0); // index into the selector pack's guided steps

  // Three reads, all cached. This screen is entered from /channels — which just filled the
  // first of them — and the artisan walks in and out of it repeatedly while following the
  // guided steps on their other hand. The selector pack in particular is static config that
  // was being re-fetched on every one of those returns.
  useEffect(() => {
    let alive = true;
    const pick = (chans) => chans.find((c) => c.id === id) ?? false;
    Promise.all([
      cachedGet('/channels', { onUpdate: (d) => alive && setChannel(pick(d)) }),
      cachedGet('/me', { onUpdate: (d) => alive && setMe(d) }),
      cachedGet(`/channels/${id}/selectorpack`, { onUpdate: (d) => alive && setPack(d) }),
    ]).then(
      ([chans, profile, p]) => {
        if (!alive) return;
        setChannel(pick(chans));
        setMe(profile);
        setPack(p);
      },
      (e) => alive && setError(e.messageKey ?? 'error.unknown'),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  /**
   * 🎯 The GeM name pre-check (architecture §6.1) — say your name three times, as printed
   * on PAN, on the bank passbook, on the Aadhaar card.
   *
   * Name mismatch across those three is the single most common GeM rejection cause. Twenty
   * seconds of voice here saves three days of registration that was always going to be
   * refused, and it is the cheapest high-value thing on this screen by a wide margin.
   *
   * 🔒 We compare and then discard. The RESULT is what matters — matched or not — and the
   * names themselves are never stored, never uploaded beyond the ASR call, never shown to
   * a coordinator. Holding three official-document names would make us a data controller
   * for exactly the class of data spec §14 says we refuse to hold.
   */
  async function sayName() {
    setListening(true);
    setError(null);
    try {
      const rec = await record();
      await new Promise((r) => setTimeout(r, 3000)); // one short utterance, not a paragraph
      const { transcript } = await transcribe(await rec.stop(), lang);
      const next = [...names, transcript];
      setNames(next);
      if (next.length < 3) {
        say(NAME_SOURCES[next.length]);
        return;
      }
      // ponytail: exact match after normalising. Upgrade to an edit-distance ratio if real
      // transcripts throw false mismatches — the verdict is advisory either way.
      const v = new Set(next.map(normalise)).size === 1 ? 'match' : 'mismatch';
      setVerdict(v);
      say(v === 'match' ? 'setup.name_match' : 'setup.name_mismatch');
    } catch {
      // Mic denied, or ASR down (/api/tts and /api/asr are both degraded without a
      // Bhashini key today). The pre-check is advisory, so a failure must not become a wall
      // in front of a registration the artisan is entitled to attempt.
      setVerdict('unchecked');
      say('setup.name_skipped');
    } finally {
      setListening(false);
    }
  }

  const tier = channel ? channel.tier : null;
  const needsPrecheck = tier === 'C' && verdict === null;

  const steps = pack?.steps ?? [];
  const current = steps[step];

  /**
   * Resolve a selector-pack field against what we actually hold.
   *
   * 🔒 Returns undefined for `artisan.pan_input` and friends on purpose — readiness is
   * BOOLEANS ONLY, so we know they have a PAN and have no idea what it says. That step
   * degrades to a spoken instruction with no copy button, which is §6.4 rule 2 working
   * exactly as designed rather than a hole.
   */
  const valueFor = (field) =>
    field?.split('.').reduce((o, k) => (o == null ? undefined : o[k]), { artisan: me });

  async function copyStep() {
    const value = valueFor(current?.field);
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
      say('setup.copied');
    } catch {
      say('setup.copy_failed');
    }
  }

  function done() {
    // See the "known gaps" note above: no endpoint to persist self_reported_done yet.
    say('setup.thanks');
    nav('/channels');
  }

  const prompt = error ?? (channel == null
    ? 'common.loading'
    : channel === false
      ? 'setup.not_found'
      : tier === 'A'
        ? 'setup.a_nothing'
        : channel.connected
          ? 'setup.already_connected'
          : needsPrecheck
            ? NAME_SOURCES[names.length]
            : current?.voice_key ?? 'setup.title');

  return (
    <Screen prompt={prompt} promptVars={{ name: channel?.name ?? '' }} footer={<HelpButton />}>
      {channel == null && !error && <Spinner label={t(lang, 'common.loading')} />}
      {error && <p className="warn">{t(lang, error)}</p>}

      {channel && (
        <Card raised>
          <p style={{ margin: '0 0 8px', fontWeight: 700 }}>
            <IconChannel size={22} aria-hidden /> {channel.name}
          </p>
          {/* The tier is named on every surface that names a channel — same words, every
              time, so the promise made on /channels is the promise kept here. */}
          <Chip tone={TIER[tier].tone}>{t(lang, TIER[tier].labelKey)}</Chip>
          <p style={{ margin: '12px 0 0', color: 'var(--muted)' }}>
            {t(lang, TIER[tier].whyKey)}
          </p>
        </Card>
      )}

      {/* --- Tier A: the whole point is that this branch has no work in it -------- */}
      {tier === 'A' && (
        <>
          <Card>
            <p style={{ margin: 0 }}>{t(lang, 'setup.a_explained', { name: channel.name })}</p>
          </Card>
          <BigButton icon={IconYes} labelKey="common.back" onClick={() => nav('/channels')} tone="yes" />
        </>
      )}

      {/* --- Tier B/C/D, already connected --------------------------------------- */}
      {tier !== 'A' && channel?.connected && (
        <>
          <Card>
            <p style={{ margin: 0 }}>{t(lang, 'setup.already_connected', { name: channel.name })}</p>
          </Card>
          <BigButton icon={IconYes} labelKey="common.back" onClick={() => nav('/channels')} tone="yes" />
        </>
      )}

      {/* --- Tier C step 0: the name pre-check, before a single form is opened ---- */}
      {needsPrecheck && !channel.connected && (
        <>
          <Card>
            <p style={{ margin: '0 0 8px' }}>{t(lang, 'setup.name_why')}</p>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              {t(lang, NAME_SOURCES[names.length])}
            </p>
          </Card>
          <BigButton
            icon={IconMic}
            labelKey={listening ? 'setup.listening' : 'setup.speak'}
            onClick={sayName}
            disabled={listening}
          />
        </>
      )}

      {/* --- The guided path: B connect, C registration, D listing ---------------- */}
      {tier && tier !== 'A' && !channel.connected && !needsPrecheck && (
        <>
          {verdict === 'mismatch' && (
            // Advisory, and loud. They may still register — but going in knowing the names
            // disagree is worth three days.
            <p className="warn">{t(lang, 'setup.name_mismatch')}</p>
          )}

          {tier === 'C' && (
            // Said out loud because it is a pleasant surprise that also contains a catch,
            // and a catch discovered later feels like a lie (§6.2).
            <Card>
              <p style={{ margin: 0 }}>{t(lang, 'setup.gem_fees')}</p>
            </Card>
          )}

          {current && (
            <Card>
              <p style={{ margin: '0 0 8px' }}>{t(lang, current.voice_key)}</p>
              {!valueFor(current.field) && (
                <p style={{ margin: 0, color: 'var(--muted)' }}>{t(lang, 'setup.we_dont_have_it')}</p>
              )}
            </Card>
          )}

          {/*
            Two tappable things, never three (design law rule 1): open the site once, then
            walk the steps. The portal button disappears after the first step because by
            then the browser is already open behind us, and a button that re-opens it is a
            button that loses their half-filled form.
          */}
          {step === 0 && (
            <BigButton
              icon={IconNext}
              label={t(lang, 'setup.open_portal', { name: channel.name })}
              onClick={() => openPortal(PORTAL[id] ?? PORTAL.gem)}
            />
          )}

          {current ? (
            <BigButton
              icon={IconNext}
              // Copy only when we actually hold the value. Otherwise it is a plain "next"
              // over a spoken instruction — §6.4 rule 2: every step degrades, never fails.
              labelKey={valueFor(current.field) ? 'setup.copy_next' : 'common.next'}
              onClick={async () => {
                await copyStep();
                setStep((s) => s + 1);
              }}
              tone="yes"
            />
          ) : (
            // Self-reported, and worded that way. We cannot verify a GeM account exists.
            <BigButton icon={IconYes} labelKey="setup.done" onClick={done} tone="yes" />
          )}
        </>
      )}
    </Screen>
  );
}
