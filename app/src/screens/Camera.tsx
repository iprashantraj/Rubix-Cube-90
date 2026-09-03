import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useCameraGate } from '../camera/useCameraGate';
import { useTilt } from '../camera/useTilt';
import { thresholdsNow, refreshThresholds } from '../api/client';
import { useDraft } from '../store';
import { useVoice, useSpeakOnChange } from '../voice/useVoice';
import { t } from '../i18n/index';
import { BigButton } from '../ui/kit';
import { IconBack } from '../ui/icons';

/**
 * /camera — the live quality gate. Spec §4.
 *
 * The phone's job is to STOP bad photos; the server's job is to beautify good ones. So
 * this screen is not a viewfinder with advice attached — the shutter is genuinely
 * disabled until the frame is good, and it fires itself once the frame has stayed good
 * for a second.
 *
 * Four feedback channels at once (§4.6), because any one of them can fail a given user:
 *   colour  ring around the whole frame — readable in sunlight at a glance
 *   icon    the shutter itself, grey vs green and glowing
 *   voice   the instruction, in their language
 *   haptic  a buzz on green — felt without looking at the screen at all
 */
export default function Camera() {
  const nav = useNavigate();
  // Never null. The bundled calibration is in force from the first frame and the server's
  // copy replaces it if and when it arrives — see thresholdsNow() in api/client.js.
  const [thresholds, setThresholds] = useState<Record<string, number> | null>(thresholdsNow);
  const tilt = useTilt();
  const { lang, say } = useVoice();
  const setPhoto = useDraft((s) => s.setPhoto);
  const mode = useDraft((s) => s.mode);
  const setMode = useDraft((s) => s.setMode);

  // Speak the change, because the artisan is holding the phone over a rug and cannot see a
  // label light up. Confirming out loud is also how they learn the toggle did anything.
  function pickMode(next: 'standing' | 'flat') {
    setMode(next);
    say(next === 'flat' ? 'camera.mode_flat_on' : 'camera.mode_standing_on');
  }

  /*
   * Upgrade to the server's calibration in the background. Silent either way.
   *
   * This screen used to BLOCK on this call — `.then(setThresholds)` with no rejection
   * handler, and a `if (!thresholds) return <Spinner />` above the viewfinder. With the API
   * unreachable the state stayed null forever, so the <video> was never in the tree, the
   * gate had nothing to attach a stream to, and the artisan got an endless spinner while
   * the app talked at them about moving into better light.
   *
   * Nothing here is worth telling anyone about: on success the numbers quietly get better,
   * on failure the bundled ones stay in force and the camera works exactly as well as it
   * did a second ago. A photographer does not need to know which JSON file won.
   */
  useEffect(() => {
    refreshThresholds().then(setThresholds, (e) =>
      console.warn('[camera] using bundled thresholds; server copy unavailable:', e),
    );
  }, []);

  /*
   * Gallery pick. Same destination as the shutter — a blob and an object URL in the draft,
   * then /capture/review — so nothing downstream has to know which one it came from.
   *
   * The input is reset afterwards so choosing the same file twice in a row still fires
   * onChange; without it the second pick is a no-op and looks like the button broke.
   */
  const fileRef = useRef<HTMLInputElement | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    say('camera.gallery_picked');
    setPhoto(file, URL.createObjectURL(file));
    nav('/capture/review');
  }

  const { videoRef, problem, isGreen, ready, error, capture } = useCameraGate({
    thresholds,
    mode,
    tilt,
    onCapture: (blob) => {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      setPhoto(blob, URL.createObjectURL(blob));
      nav('/capture/review');
    },
  });

  // `armed` is the honest state of this screen: the lens is open and frames are being
  // scored. It no longer waits on the network — the thresholds are already in hand — so
  // this is now purely "has the camera actually started".
  const armed = ready;

  // Speak only the committed problem, and only when it changes. The gate re-evaluates ten
  // times a second; without the change guard the artisan hears a stutter, not a sentence.
  //
  // Gated on `armed` because `problem` starts at 'photo.too_dark' before a single frame has
  // been looked at. That default was being read out loud over a spinner, so the app was
  // telling an artisan to find more light while the camera was not even open — the exact
  // "it makes noise but nothing happens" bug.
  useSpeakOnChange(armed ? problem : null);

  // The white-paper trick (spec §5.3) has to be asked for at capture time — it is a
  // physical instruction about the scene, useless once the photo is already taken. It
  // costs nothing and buys professional-grade white balance.
  //
  // The timer only starts once there is a viewfinder to say it about. On a fixed 2.5s delay
  // it fired into a dead screen, which is advice about a scene nobody can see.
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => say('camera.hint_paper'), 2500);
    return () => clearTimeout(id);
  }, [armed, say]);

  useEffect(() => {
    if (error) say(error);
  }, [error, say]);

  /*
   * A dead lens is the end of the screen — there is nothing to show, and nothing to retry
   * that leaving and coming back would not do better. It is also now the ONLY way this
   * screen can fail: an unreachable server no longer stops anything here.
   */
  if (error) {
    return (
      <div className="cam">
        <div className="cam__fail">
          <p>{t(lang, error)}</p>
          <BigButton icon={IconBack} labelKey="common.back" onClick={() => nav('/home')} />
        </div>
      </div>
    );
  }

  return (
    <div className="cam">
      {/*
        `cam__video--live` only once there is a stream. A <video> with no source is not
        blank — Chrome paints its own placeholder poster in it, a grey rounded box with a
        black play triangle, which is the single most misleading thing we could show here:
        it looks like a video the artisan is supposed to press, and pressing it does
        nothing at all. Hidden until it has something real to show.
      */}
      <video
        ref={videoRef}
        className={`cam__video${ready ? ' cam__video--live' : ''}`}
        playsInline
        muted
      />

      {/*
        Opening the lens takes a beat, and on first run it takes as long as the artisan
        takes to answer the permission dialog. Silent black in the meantime reads as a
        broken app, so the wait says what it is waiting for and keeps moving while it does.
      */}
      {!ready && (
        <div className="cam__wait">
          <div className="cam__waitRing" />
          <p>{t(lang, 'camera.opening')}</p>
        </div>
      )}

      <div className={`cam__ring${isGreen ? ' cam__ring--ok' : ''}`} />

      {/* One problem. Never a stack of four — that is how this feature gets uninstalled.
          Nothing is "wrong" with a frame we have not looked at yet, so the hint waits for
          the gate to actually be running rather than showing its initial guess. */}
      {armed && problem && (
        <div className="cam__hint">
          <span>{t(lang, problem)}</span>
        </div>
      )}

      {/*
        Standing vs flat, and it changes what "straight" MEANS to the tilt check:
        gate.js:206 targets 0° pitch for something stood up, 90° for something laid on the
        ground and shot from directly above, and skips the roll test entirely in flat mode
        because roll is undefined when a phone points straight down.

        All of that was written, tested (gate.js has a passing "dhurrie shot from above ->
        green" case) and completely unreachable — `setMode` in store.js had no caller
        anywhere in the app. So an artisan photographing a dhurrie, a pattachitra or a
        floor-spread saree the natural way was told "straighten the phone" forever, by a
        gate that already knew how to accept it.

        Two states, so it is a toggle rather than a menu. It speaks on change because the
        artisan is holding the phone over a rug and is not reading a label.
      */}
      <div className="cam__mode" role="group">
        <button
          className={`cam__modeBtn${mode === 'standing' ? ' cam__modeBtn--on' : ''}`}
          onClick={() => pickMode('standing')}
          aria-pressed={mode === 'standing'}
        >
          {t(lang, 'camera.mode_standing')}
        </button>
        <button
          className={`cam__modeBtn${mode === 'flat' ? ' cam__modeBtn--on' : ''}`}
          onClick={() => pickMode('flat')}
          aria-pressed={mode === 'flat'}
        >
          {t(lang, 'camera.mode_flat')}
        </button>
      </div>

      {/*
        Pick an existing photo instead of shooting one.

        A plain <input type="file">, not @capacitor/camera — the WebView hands this to
        Android's own photo picker, which needs no runtime permission and no plugin call.
        The gate does not run on what comes back, by definition: there is no live frame to
        score. That is not a hole. `ai/enhance/pipeline.py` gate() re-checks resolution,
        exposure and blur server-side and refuses what it cannot use, so the floor the
        camera gate defends is still there — it just arrives as a spoken rejection after
        the upload rather than as a locked shutter before it.

        EXIF is stripped in CaptureReview via api/upload.ts's stripExif, which matters far
        more here than on the camera path: a gallery photo carries the real capture GPS,
        where a canvas-encoded camera blob never had any.
      */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="cam__fileInput"
        onChange={onPick}
      />
      <button className="cam__gallery" onClick={() => fileRef.current?.click()}>
        {t(lang, 'camera.gallery')}
      </button>

      {/*
        The shutter. Green means the gate is happy and auto-capture is about to fire on its
        own; grey means it is not, and a press still takes the photo.

        ⚠️ This reverses the original rule, deliberately and on request. The gate used to
        HARD-BLOCK a red frame — `disabled={!isGreen}` — so an artisan could not take a bad
        photo even on purpose, and moved until the button lit up. That is still the design
        the coaching is built around, and it is still what happens if you simply wait: the
        colour ring, the spoken problem and the auto-fire are all untouched, and auto-capture
        remains green-only, because a photo the phone takes for you should still be one it
        would vouch for.

        What changed is only the manual override. Judgement the gate cannot make — this is
        the only light there will be today, the object cannot be moved, the "blur" is a
        flat white cloth the Laplacian always misreads (see the blur row in app/README.md)
        — now belongs to the person holding the phone.

        Still disabled until `ready`, because before the lens is open there is no frame to
        capture and a button that responds to nothing is worse than one that admits it.
      */}
      <button
        className={`cam__shutter${isGreen ? ' cam__shutter--ok' : ''}`}
        onClick={capture}
        disabled={!ready}
        aria-label={t(lang, isGreen ? 'photo.ready' : 'photo.take_anyway')}
      />
    </div>
  );
}
