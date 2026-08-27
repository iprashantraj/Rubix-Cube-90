import { useState } from 'react';
import { api } from '../api/client.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card } from '../ui/kit.jsx';
import { IconHelp, IconYes } from '../ui/icons.jsx';

/**
 * /help — one button, one promise. Spec §5 row 24.
 *
 * 🚫 Hard NO #1 in the spec: **remote support only, never a field visit.** That is not a
 * cost decision, it is the decision that makes the whole thing scale. A model that needs
 * someone to ride to a village to fix a listing serves a few hundred artisans and dies;
 * a coordinator on a phone serves a few thousand. Every other design choice in this app —
 * voice-first, no typing, no documents — exists so that support can be a phone call.
 *
 * So the screen says, out loud, that somebody will CALL, and that nobody will come. Half of
 * that sentence is reassurance and the other half is expectation-setting, and an artisan
 * who sits at home waiting for a visit that was never coming has been failed by us, not by
 * the coordinator.
 *
 * There is no form. Not a subject line, not a category dropdown, not "describe your
 * problem" — a user who cannot type cannot fill any of them, and a coordinator with a phone
 * number and a five-minute conversation will find out more than a dropdown ever would.
 *
 * 🔎 `POST /support/callback` does not exist on the server yet; it ships with the admin
 * console in phase 10, alongside the call log on /artisans/:id. The contract is pinned here
 * so landing it is one router file and no app change. Until then the request fails, and the
 * failure is SPOKEN rather than swallowed — a silent no-op that leaves someone waiting for
 * a call that was never requested is the worst outcome this screen has available to it.
 */
export default function Help() {
  const { lang, say } = useVoice();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function requestCallback() {
    setBusy(true);
    setError(null);
    try {
      // No payload: the token identifies the artisan, and their language, cluster and
      // readiness flags are already on the server. Anything else would have to be typed.
      await api.post('/support/callback');
      setSent(true);
      say('help.requested');
    } catch (e) {
      const key = e.messageKey ?? 'error.unknown';
      setError(key);
      say(key);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Same top as everywhere else, and a back button because /help is reachable from any
    // screen and draws no tab bar — someone who taps it out of curiosity needs a way out
    // that is not the hardware gesture.
    <Screen prompt={error ?? (sent ? 'help.requested' : 'help.title')} hero back={true}>
      <Card raised>
        {/* Both halves of the promise, in one sentence: they will call, nobody will visit. */}
        <p style={{ margin: 0 }}>{t(lang, 'help.explain')}</p>
      </Card>

      {error && <p className="warn">{t(lang, error)}</p>}

      {sent ? (
        <Card>
          <p style={{ margin: 0 }}>
            <IconYes size={20} aria-hidden /> {t(lang, 'help.requested_detail')}
          </p>
        </Card>
      ) : (
        <BigButton icon={IconHelp} labelKey="help.request" onClick={requestCallback} disabled={busy} />
      )}
    </Screen>
  );
}
