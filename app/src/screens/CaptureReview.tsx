import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { stripExif, upload } from '../api/upload';
import { useDraft } from '../store';
import { useVoice } from '../voice/useVoice';
import { Screen, BigButton, Card, Spinner } from '../ui/kit';
import { IconYes, IconRetry } from '../ui/icons';

/**
 * /capture/review — the shot they just took, before it costs anybody anything.
 *
 * The camera gate (§4) already refused every photo it could measure as bad. What it cannot
 * measure is whether the artisan photographed the right thing, or whether their thumb is in
 * the frame. So one look, one decision: keep it or shoot it again. Retake is free here and
 * expensive three screens later, which is the entire reason this screen exists.
 *
 * On accept this screen does the only genuinely slow thing in the create flow — a multi-
 * megabyte upload over a rural tower — so it is also where the "never a silent spinner"
 * rule earns its keep. A progress ring means nothing to someone who cannot read the
 * percentage under it; the progress is spoken at quarters, and every retry inside
 * upload() speaks its own reason (see the onRetry hook there).
 */
export default function CaptureReview() {
  const nav = useNavigate();
  const { say } = useVoice();
  const draft = useDraft();
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  // Quarters, not every chunk. onProgress fires per 256KB chunk — speaking each one would
  // talk over itself for the whole upload and tell the artisan nothing new.
  const spokenQuarter = useRef(0);

  // Reload or deep link with no photo in hand. The draft is deliberately not persisted
  // (store.js), so the honest recovery is to shoot again, not to resurrect half a listing.
  if (!draft.photoUrl) return <Navigate to="/camera" replace />;

  async function accept() {
    setBusy(true);
    setFailed(null);
    setPct(0);
    spokenQuarter.current = 0;

    try {
      // 🔒 EXIF first, always. The blob from useCameraGate is canvas-encoded and therefore
      // already clean, but this path must not depend on that staying true — an artisan's
      // home GPS coordinates on a public listing is not a bug we get to fix afterwards.
      const clean = await stripExif(draft.photoBlob!);

      const { url } = await upload(clean, {
        onProgress: (f) => {
          setPct(f);
          const q = Math.floor(f * 4);
          if (q > spokenQuarter.current) {
            spokenQuarter.current = q;
            say('capture.upload_progress', { percent: q * 25 });
          }
        },
        onRetry: (key) => say(key),
      });

      // The product row is created here rather than at publish time because everything
      // downstream — enhance, prefill, the colour lock, the price — is keyed on a product
      // id. The catalog is ours whether or not this listing ever reaches a channel (§2).
      const { id } = await api.post('/products', {});
      useDraft.getState().setListing({ ...draft.listing, product_id: id, image_url: url });

      /*
       * Link the upload to the product. NOT optional, and deliberately outside the try
       * below.
       *
       * ⚠️ This call and the enhance call used to share one try/catch, whose comment said
       * that losing the enhancement "must never cost the artisan the listing" while the
       * code made exactly that trade. When the link failed the catch swallowed it, the
       * screen navigated on, and the product reached /publish with no rows in
       * product_images. `ChannelAdapter.preflight` refuses on `if not product.images`, so
       * **all seven channels failed at once**, with `error=NULL` because preflight returns
       * a message key rather than raising. One-click publishing was broken for every
       * product ever catalogued and nothing anywhere said so.
       *
       * It throws to the outer catch now, which speaks. A photo that did not attach is a
       * listing that cannot publish, and the artisan needs to hear that while they are
       * still holding the object — not three screens later.
       */
      await api.post(`/products/${id}/images`, { url, size_variant: 'raw', is_primary: true });

      // Fire and forget, and genuinely optional. Enhancement takes ~20s (ai/contracts.md)
      // and the artisan has nothing to decide while it runs, so they walk to the next
      // screen and it polls.
      try {
        const job = await api.post(`/products/${id}/enhance`, {});

        /*
         * 🐞 A gate REJECTION is not a failure, and it must not be spoken as one.
         *
         * `POST /enhance` answers 200 with `{status:'rejected', message_key}` when the
         * server refuses the photograph — too small, too dark, too blurry. There is no
         * `job_id` in that body, so this line used to store null, /catalog/prefill found
         * nothing to poll, and it degraded to `enhance.failed`: "we could not improve the
         * photo." The artisan was told the app had a problem, when what they had was a
         * fixable photograph and no idea which way to fix it.
         *
         * The reason is a message key precisely so it can be spoken — "the photo is too
         * small, take it closer" is an instruction; "we could not improve the photo" is an
         * apology. So we stay on THIS screen, where the shot is still on screen and the
         * retake button is already under their thumb, and say the real thing.
         */
        if (job.status === 'rejected') {
          setFailed(job.message_key ?? 'enhance.failed');
          return;
        }

        useDraft.getState().setEnhance(job.job_id ?? null);
      } catch {
        // AI service down. THIS is the failure that costs a prettier photo and nothing
        // else: /catalog/prefill degrades to the artisan's own photo and the flow carries
        // on. The listing is already publishable, because the link above succeeded.
        useDraft.getState().setEnhance(null);
      }

      nav('/catalog/prefill');
    } catch (e) {
      // Speaks itself: the failure key becomes the screen prompt, so it is heard once and
      // shown once, and it replaces the question rather than stacking under it (rule 4).
      setFailed((e as ApiError).messageKey ?? 'capture.failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen prompt={failed ?? (busy ? 'capture.uploading' : 'capture.confirm')}>
      <Card>
        <img
          src={draft.photoUrl ?? undefined}
          alt=""
          style={{ width: '100%', display: 'block', borderRadius: 14 }}
        />
      </Card>

      {busy ? (
        <Spinner label={`${Math.round(pct * 100)}%`} />
      ) : (
        <>
          <BigButton
            icon={IconYes}
            labelKey={failed ? 'common.retry' : 'capture.use'}
            onClick={accept}
            tone="yes"
          />
          <BigButton
            icon={IconRetry}
            labelKey="capture.retake"
            onClick={() => nav('/camera')}
            tone="no"
          />
        </>
      )}
    </Screen>
  );
}
