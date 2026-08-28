import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { stripExif, upload } from '../api/upload.js';
import { useDraft } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { Screen, BigButton, Card, Spinner } from '../ui/kit.jsx';
import { IconYes, IconRetry } from '../ui/icons.jsx';

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
  const [failed, setFailed] = useState(null);

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
      const clean = await stripExif(draft.photoBlob);

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

      // Fire and forget. Enhancement takes ~20s (ai/contracts.md) and the artisan has
      // nothing to decide while it runs, so they walk to the next screen and it polls.
      try {
        // Link the upload to the product first. POST /enhance looks for exactly this
        // size_variant and answers "no raw image" without it.
        await api.post(`/products/${id}/images`, { url, size_variant: 'raw', is_primary: true });
        const job = await api.post(`/products/${id}/enhance`, {});
        useDraft.getState().setEnhance(job.job_id ?? null);
      } catch {
        // AI service down, or the link failed. Losing the enhancement costs us a prettier
        // photo; it must never cost the artisan the listing.
        useDraft.getState().setEnhance(null);
      }

      nav('/catalog/prefill');
    } catch (e) {
      // Speaks itself: the failure key becomes the screen prompt, so it is heard once and
      // shown once, and it replaces the question rather than stacking under it (rule 4).
      setFailed(e.messageKey ?? 'capture.failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen prompt={failed ?? (busy ? 'capture.uploading' : 'capture.confirm')}>
      <Card>
        <img
          src={draft.photoUrl}
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
