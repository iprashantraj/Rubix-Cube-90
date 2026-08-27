import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSession } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton } from '../ui/kit.jsx';
import { IconNext, IconYes } from '../ui/icons.jsx';
import { PhoneAndCode } from '../ui/illustrations.jsx';

/**
 * /auth — phone + OTP. This IS the account. No password, no email, no profile to fill in.
 *
 * The only screen in the entire app where anything is typed, and even here it is two
 * numeric fields with `inputMode="numeric"` so the keyboard comes up as a keypad rather
 * than a QWERTY layout nobody on this device can navigate.
 */
export default function Auth() {
  const nav = useNavigate();
  const { lang, say, sayRaw } = useVoice();
  const { signIn, consent } = useSession();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const phoneRef = useRef(null);
  const otpRef = useRef(null);

  /*
   * Raise the keyboard ourselves.
   *
   * `autoFocus` is not enough in an Android WebView: focus lands on the input but the IME
   * does not come up, so the artisan sees a highlighted empty box and no way to fill it.
   * This is the one screen where typing IS the interaction, and a keyboard they have to
   * discover by tapping a box is a dead end for someone who cannot read the box.
   *
   * The delay is not superstition — the WebView ignores a focus() issued during the same
   * frame as the navigation, and the OTP field does not exist until `sent` flips.
   */
  useEffect(() => {
    const el = sent ? otpRef.current : phoneRef.current;
    const timer = setTimeout(() => el?.focus({ preventScroll: true }), 250);
    return () => clearTimeout(timer);
  }, [sent]);

  function fail(e) {
    const key = e instanceof ApiError ? e.messageKey : null;
    setError(key ?? e.message);
    if (key) say(key);
    else sayRaw(e.message);
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/start', { phone });
      setSent(true);
      // Dev builds echo the code back so a device test does not need a live SMS gateway.
      if (res.dev_otp) setOtp(res.dev_otp);
      say('auth.otp');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/verify', {
        phone,
        otp,
        language: lang,
        notice_version: consent?.notice_version ?? '1',
      });
      signIn(res.token, res.artisan);
      // Still no product tour — nobody who cannot read wants one. But /home rather than
      // /camera: opening the lens unasked meant a returning artisan's first words from the
      // app were "move into the light", before they had said what they came to do.
      nav(res.created ? '/onboard/name' : '/home');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      prompt={sent ? 'auth.otp' : 'auth.title'}
      footer={
        !sent ? (
          <BigButton
            icon={IconNext}
            labelKey="common.next"
            onClick={start}
            disabled={busy || phone.length !== 10}
          />
        ) : (
          <BigButton
            icon={IconYes}
            labelKey="common.next"
            onClick={verify}
            disabled={busy || otp.length !== 6}
            tone="yes"
          />
        )
      }
    >
      {/* A phone with a message arriving: the number goes in, the code comes back. Both
          halves of this screen in one drawing, above the only typing in the app. */}
      <PhoneAndCode className="illus" />

      <input
        ref={phoneRef}
        className="field"
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        maxLength={10}
        placeholder="9876543210"
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
        disabled={sent}
      />

      {sent && (
        <input
          ref={otpRef}
          className="field"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        />
      )}

      {error && <p className="warn">{t(lang, error)}</p>}
    </Screen>
  );
}
