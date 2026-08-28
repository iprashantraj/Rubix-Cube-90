import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cachedGet } from '../api/client.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Spinner, HelpButton } from '../ui/kit.jsx';
import { IconNext, IconYes, IconAlert } from '../ui/icons.jsx';

/**
 * /wizard/gst — the screen that removes a legal wall instead of making one easier to climb.
 *
 * 🔑 **Most artisans do not need GST registration at all.** Notification 34/2023-Central
 * Tax, effective 1 Oct 2023, exempts a person supplying goods through an e-commerce
 * operator from mandatory registration where the supplies are intra-state only, they hold
 * a PAN, and they obtain an enrolment number on the common portal. Because we are the ECO
 * — and, for ONDC, the Marketplace Seller Node — that exemption reaches our artisans.
 *
 * Almost nobody knows this notification exists. "GST chahiye" is the single most common
 * reason a weaver decides selling online is not for them, and it is usually wrong. Telling
 * them so, out loud, in their own language, in under ten seconds, is the most direct answer
 * to "drastically lower the barrier to entry" anywhere in this app.
 *
 * The decision is NOT made here. `GET /me/gst-route` owns it, from the four booleans
 * collected at /onboard/ready, and returns `{route, voice_key}`. Two copies of a tax rule
 * drift, and the copy that drifts is always the one on the phone that never gets updated.
 * This screen renders four outcomes and speaks the key the server chose.
 *
 * ⚠️ Guidance, not legal advice — and that is said ALOUD, not printed in grey at the
 * bottom. The turnover threshold is state-specific, and the enrolment number must be
 * obtained before supplying through an ECO. A user who cannot read a disclaimer has not
 * been given one.
 */

/**
 * The four routes. `voice_key` comes from the server, so it is not repeated here — this
 * table is only what the artisan should DO next, which is a UI question.
 *
 * `tone` matters more than it looks: `enrolment_only` is genuinely good news and must not
 * be rendered in the same grey as "you need a full registration". The two outcomes feel
 * completely different to the person hearing them, and the screen should agree.
 */
const ROUTES = {
  already_registered: { tone: 'done', actionKey: null, detailKey: 'gst.already_detail' },
  enrolment_only: { tone: 'ready', actionKey: 'gst.start_enrolment', detailKey: 'gst.enrolment_detail' },
  needs_pan_first: { tone: 'pending', actionKey: 'gst.pan_how', detailKey: 'gst.needs_pan_detail' },
  full_registration: { tone: 'blocked', actionKey: 'gst.start_full', detailKey: 'gst.full_detail' },
};

const PORTAL = {
  // The enrolment (no-registration) path and the full registration path are different
  // journeys on the same portal. Sending someone down the wrong one costs them a day.
  enrolment_only: 'https://reg.gst.gov.in/registration/',
  full_registration: 'https://reg.gst.gov.in/registration/',
  needs_pan_first: 'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html',
};

export default function GstWizard() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);

  // Under `/me`, so it inherits the 30-minute TTL and — more importantly — a `PATCH /me`
  // clears this too: `invalidate()` matches on the first path segment, so a readiness answer
  // that changes the artisan's GST route cannot leave the old route on screen.
  useEffect(() => {
    let alive = true;
    cachedGet('/me/gst-route', { onUpdate: (d) => alive && setRoute(d) }).then(
      (d) => alive && setRoute(d),
      (e) => alive && setError(e.messageKey ?? 'error.unknown'),
    );
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The disclaimer is spoken after the answer, not before it. Before, it is noise the
   * artisan sits through to reach the point; after, it is the caveat on an answer they are
   * already holding. Deliberate 2.5s gap so the two do not run together into one sentence.
   */
  useEffect(() => {
    if (!route) return;
    const timer = setTimeout(() => say('gst.disclaimer'), 2500);
    return () => clearTimeout(timer);
  }, [route, say]);

  const meta = route ? ROUTES[route.route] : null;

  async function openPortal() {
    const url = PORTAL[route.route];
    if (!url) return;
    try {
      const { InAppBrowser } = await import('@capacitor/inappbrowser');
      await InAppBrowser.openInWebView({ url, options: { showURL: true, showToolbar: true } });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  // The server's own voice_key is the heading AND the audio — one string, so the sentence
  // an artisan hears is provably the sentence a reviewer can read off the screenshot.
  const prompt = error ?? (route == null ? 'common.loading' : route.voice_key);

  return (
    <Screen prompt={prompt} footer={<HelpButton />}>
      {route == null && !error && <Spinner label={t(lang, 'common.loading')} />}
      {error && <p className="warn">{t(lang, error)}</p>}

      {route && (
        <>
          <Card raised>
            <Chip tone={meta.tone}>{t(lang, `gst.route.${route.route}`)}</Chip>
            <p style={{ margin: '12px 0 0' }}>{t(lang, meta.detailKey)}</p>
          </Card>

          {/*
            Not legal advice, and it is said out loud (see the effect above) as well as
            shown. A disclaimer only a literate user can consume is not a disclaimer.
          */}
          <Card>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              <IconAlert size={18} aria-hidden /> {t(lang, 'gst.disclaimer')}
            </p>
          </Card>

          {meta.actionKey ? (
            <BigButton icon={IconNext} labelKey={meta.actionKey} onClick={openPortal} />
          ) : (
            // already_registered: there is nothing to do, and a disabled button would
            // suggest otherwise. Send them back instead.
            <BigButton icon={IconYes} labelKey="common.back" onClick={() => nav('/channels')} tone="yes" />
          )}
        </>
      )}
    </Screen>
  );
}
