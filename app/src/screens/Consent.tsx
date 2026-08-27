import { useNavigate } from 'react-router-dom';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { Screen, BigButton } from '../ui/kit';
import { IconYes, IconReplay } from '../ui/icons';
import { ArtShield } from '../ui/illustrations';

/**
 * /consent — DPDP notice, spoken.
 *
 * DPDP requires the consent notice in plain language, with the user able to choose from
 * the Eighth Schedule languages. Our app is already multilingual, so we play the notice
 * BY VOICE in the language they just picked — one feature, two wins: compliance and
 * accessibility. A wall of legal text would satisfy neither for a user who cannot read it.
 *
 * We store an artifact, not a checkbox: when, in which language, against which version of
 * the notice.
 */
const NOTICE_VERSION = '1';

export default function Consent() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const setConsent = useSession((s) => s.setConsent);

  function accept() {
    setConsent({
      at: new Date().toISOString(),
      lang,
      notice_version: NOTICE_VERSION,
    });
    nav('/auth');
  }

  return (
    /*
      `speakAlso` plays the notice itself straight after the heading, with no button press.
      This screen used to say "Your data" and then go quiet, leaving the actual notice
      reachable only via "play it again" — which someone who cannot read the body has no
      reason to press, because they never learn there is a body. A DPDP notice nobody heard
      is not consent, and we store an artifact asserting they gave it.

      `back` goes to /lang. Choosing the wrong language is the easiest mistake in this app —
      the tiles are in scripts the artisan may not read — and this is the first screen where
      they would notice.
    */
    <Screen
      prompt="consent.title"
      speak="consent.body"
      speakOnEnter
      back="/lang"
      footer={
        <>
          <BigButton icon={IconYes} labelKey="consent.ok" onClick={accept} tone="yes" />
          <BigButton
            icon={IconReplay}
            labelKey="consent.again"
            tone="no"
            onClick={() => say('consent.body')}
          />
        </>
      }
    >
      {/*
        The drawing carries the sentence before the sentence is read or heard. On a slow
        connection the voice takes a second to arrive and the artisan is looking at the
        screen during it — a shield holding a spool is the only thing on this page that
        works in that second.
      */}
      <ArtShield className="illus" />

      {/*
        The notice itself. Short on purpose — it is short because we genuinely collect
        very little. Readiness is stored as booleans, so there is no PAN, no Aadhaar, no
        bank number and no document photo to disclose here.
      */}
      <p className="said said--notice">{t(lang, 'consent.body')}</p>
    </Screen>
  );
}
