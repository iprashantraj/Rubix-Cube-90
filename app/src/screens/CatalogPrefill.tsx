import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useDisplayImage } from '../api/useDisplayImage';
import { useDraft } from '../store';
import { useVoice } from '../voice/useVoice';
import { Screen, BigButton, Card, YesNo, Spinner } from '../ui/kit';
import { IconRetry } from '../ui/icons';

/**
 * /catalog/prefill — the wait, the colour lock, and the vision shortcut. Spec §5.6, §6.4.
 *
 * Three things happen here, strictly one at a time (design law rule 4):
 *
 *   1. enhancing   the ~20s enhancement job, with its progress SPOKEN. Twenty silent
 *                  seconds on a screen you cannot read is indistinguishable from a hung
 *                  app, and the artisan's response to a hung app is to close it.
 *   2. colour      🔒 the colour lock. The one gate in the whole flow that blocks publish.
 *   3. guess       "Sambalpuri saree lag rahi hai, cotton ki. Sahi hai?" — the artisan
 *                  corrects a guess instead of describing a saree from scratch.
 *
 * ── Why the colour lock is a hard gate ──────────────────────────────────────────────
 * White balance moves colour. That is what it is for. On a natural-dye product it can move
 * it out of truth — a madder-red gets pulled towards orange, the buyer receives something
 * that does not match the listing, and the artisan eats a return, a refund and a rating
 * they will never recover. Only the person holding the object can settle it, so we ask
 * them, and Publish.jsx refuses to send anywhere until they have answered (Publish.jsx:90).
 *
 * The local flag is set only after the server has recorded the confirmation. It is a
 * publish gate, so it has to reflect what the server knows, not what this phone hoped —
 * a dropped POST that still unlocked the button would defeat the entire mechanism.
 */

const POLL_MS = 2000;
const MAX_POLLS = 30; // ~60s. Beyond that the job is not coming back on this screen.

/**
 * The AI service returns `s3://` URLs (ai/contracts.md), which no <img> can render, and on
 * a dev box there is no enhancement at all. The local photo is always displayable and is
 * always the same product, so it is the fallback for both cases.
 *
 * `useDisplayImage` also carries the fix for plain-http server images being auto-upgraded
 * and dropped inside the WebView — see the docstring there, it is not obvious.
 */

export default function CatalogPrefill() {
  const nav = useNavigate();
  const { say } = useVoice();
  const draft = useDraft();
  const [step, setStep] = useState('enhancing');
  const [reject, setReject] = useState<string | null>(null); // a message_key from the enhance gate
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);

  const productId = draft.listing?.product_id;

  useEffect(() => {
    if (step !== 'enhancing') return undefined;
    let alive = true;

    // Degrading is not an error path here, it is the common path in dev: with no job id
    // there is nothing to poll, so say so out loud and carry on with the artisan's own
    // photo. Awaited so the sentence finishes before the colour question interrupts it.
    const degrade = async () => {
      await say('enhance.failed');
      if (alive) setStep('colour');
    };

    (async () => {
      if (!draft.enhanceJobId) return degrade();

      for (let i = 0; i < MAX_POLLS && alive; i++) {
        try {
          // Contract path (ai/contracts.md), proxied by web/api at products.py. It 404s
          // unless this artisan owns the job, and any failure degrades — which is exactly
          // the behaviour we want the day the AI box is unreachable in production too.
          const job = await api.get(`/enhance/${draft.enhanceJobId}`);

          if (job.status === 'done') {
            if (!alive) return undefined;
            useDraft.getState().setImages(job.images ?? []);
            return setStep('colour');
          }
          if (job.status === 'rejected') {
            // Rejected at the gate, no GPU spent. The reason is a message key precisely so
            // it can be spoken in their language — "resolution_below_1000px" is not.
            if (!alive) return undefined;
            setReject(job.message_key ?? 'enhance.failed');
            return setStep('rejected');
          }
        } catch {
          return degrade();
        }

        // Every fifth poll, roughly every ten seconds. Enough to prove the app is alive,
        // rare enough not to nag.
        if (i && i % 5 === 0) say('enhance.still_working');
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      return alive ? degrade() : undefined;
    })();

    return () => {
      alive = false;
    };
  }, [step, draft.enhanceJobId, say]);

  // Above the early return, and it has to stay there: hooks may not be called
  // conditionally, and `productId` is null on a cold open of this route.
  const image = useDisplayImage(draft.images?.[0]?.url, draft.photoUrl);

  if (!productId) return <Navigate to="/camera" replace />;

  async function confirmColour() {
    setBusy(true);
    try {
      await api.post(`/products/${productId}/confirm-colour`, {});
      useDraft.getState().confirmColour();
      await askVision();
    } catch (e) {
      // Not confirmed locally either — see the header comment. They tap yes again.
      say((e as ApiError).messageKey ?? 'net.offline');
    } finally {
      setBusy(false);
    }
  }

  /**
   * The vision pre-fill is a shortcut, never a requirement. If it is slow, down, or has
   * nothing useful to say, the artisan simply answers the six questions unaided — which
   * is what they would have done anyway.
   */
  async function askVision() {
    try {
      const p = await api.post(`/products/${productId}/prefill`, {});
      const words = [p.title ?? p.category, p.material].filter(Boolean).join(', ');
      if (words) {
        useDraft.getState().setPrefill(p);
        setGuess(words);
        return setStep('guess');
      }
    } catch {
      /* vision said nothing useful; the voice questions cover it */
    }
    return nav('/catalog/voice');
  }

  function rejectColour() {
    // We cannot un-enhance server-side and we will not publish a colour the artisan has
    // told us is wrong. Re-shooting with the white-paper reference (§5.3) is the only
    // thing that actually fixes the white balance, so that is where they go.
    say('colour.retake');
    nav('/camera');
  }

  if (step === 'enhancing') {
    return (
      <Screen prompt="enhance.working">
        <Card>
          <img src={draft.photoUrl ?? undefined} alt="" style={{ width: '100%', display: 'block', borderRadius: 14 }} />
        </Card>
        <Spinner />
      </Screen>
    );
  }

  if (step === 'rejected') {
    return (
      <Screen prompt={reject}>
        <BigButton icon={IconRetry} labelKey="capture.retake" onClick={() => nav('/camera')} />
      </Screen>
    );
  }

  return (
    <Screen
      prompt={step === 'colour' ? 'colour.confirm' : 'catalog.prefill_confirm'}
      promptVars={{ guess }}
    >
      <Card>
        <img src={image ?? undefined} alt="" style={{ width: '100%', display: 'block', borderRadius: 14 }} />
      </Card>

      {step === 'colour' ? (
        <YesNo onYes={confirmColour} onNo={rejectColour} disabled={busy} />
      ) : (
        // "Sahi hai?" — yes keeps the guess, no throws it away and they describe it
        // themselves. Either way the next screen is the same six questions: vision can
        // name a saree, but it cannot know it took eleven days or that the dye is madder.
        <YesNo
          onYes={() => nav('/catalog/voice')}
          onNo={() => {
            useDraft.getState().setPrefill(null);
            nav('/catalog/voice');
          }}
        />
      )}

      {/* The spoken guess, in text, for anyone who missed or could not hear the audio.
          Full body size and full ink: this is the thing being confirmed, not a caption. */}
      {step === 'guess' && <p className="said">{guess}</p>}
    </Screen>
  );
}
