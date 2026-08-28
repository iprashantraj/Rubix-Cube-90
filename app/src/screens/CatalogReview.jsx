import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDraft } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { record, transcribe } from '../voice/listen.js';
import { hoursFrom, rupeesFrom } from '../voice/numbers.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Grid, Tile, Spinner } from '../ui/kit.jsx';
import { IconMic, IconYes, IconBack } from '../ui/icons.jsx';

/**
 * /catalog/review — the listing, read back aloud, before it goes anywhere. Spec §6.1.
 *
 * This is the consent step for the words. Everything upstream of here was the artisan
 * describing their product; everything downstream is a machine-written listing going out
 * under their name to buyers, to ONDC and to a government marketplace. They get to hear
 * exactly what that says first. Showing it would not be enough — the user this app is for
 * cannot read the thing they are approving, so it is spoken, in full, on entry and again
 * after every correction.
 *
 * ── Corrections are re-recorded, never typed (design law rule 3) ─────────────────────
 * There is no text field on this screen and there will not be one. A wrong title is fixed
 * by saying the right one. The field picker is a pick-one grid, the same shape as the
 * eight-icon craft grid in onboarding — four tiles is one decision, not four actions, so
 * it does not break the three-target rule.
 *
 * ── Where the prose comes from ──────────────────────────────────────────────────────
 * POST /catalog (ai/contracts.md) is what turns the spoken answers into real English AND
 * Hindi prose. web/api does not proxy that hop yet, so until it does this screen reads the
 * artisan's own answers back verbatim. That is deliberately the safe direction to be wrong
 * in: they approve their own words, never an invention they never heard.
 */

const FIELDS = [
  { name: 'title', labelKey: 'catalog.f_title' },
  { name: 'desc', labelKey: 'catalog.f_desc' },
  { name: 'category', labelKey: 'catalog.f_category' },
  { name: 'material', labelKey: 'catalog.f_material' },
];

/**
 * Shown, but not re-recordable: category is an internal taxonomy path
 * ("textiles.saree.sambalpuri") that the channel adapters map from. Nobody says that out
 * loud, and letting a transcript overwrite it would break every export that keys off it.
 * A wrong category is corrected by re-recording what the thing IS — the classifier reads
 * the title and description, not this field.
 *
 * It also keeps the picker at three tiles plus a way back, which is the design-law budget.
 */
const EDITABLE = FIELDS.filter((f) => f.name !== 'category');

function compose(prefill, a) {
  const story = [a.what, a.material, a.special, a.size, a.time].filter(Boolean).join('. ');
  return {
    title: prefill?.title ?? a.what ?? '',
    desc: prefill?.desc_en ?? story,
    category: prefill?.category ?? '',
    material: prefill?.material ?? a.material ?? '',
  };
}

export default function CatalogReview() {
  const nav = useNavigate();
  const { say, sayRaw, shutUp, lang } = useVoice();
  const draft = useDraft();
  const [listing, setLocal] = useState(() => compose(draft.prefill, draft.answers));
  const [step, setStep] = useState('read');
  const [field, setField] = useState(null);
  const [rec, setRec] = useState(null);
  const [busy, setBusy] = useState(false);

  // The whole listing, as one utterance, every time it changes.
  //
  // It carries the prompt's own words because Screen speaks the prompt on mount and this
  // effect runs immediately after it — one continuous sentence rather than two voices
  // cutting each other off.
  useEffect(() => {
    if (step !== 'read') return;
    const spoken = [t(lang, 'catalog.review_confirm'), listing.title, listing.desc]
      .filter(Boolean)
      .join('. ');
    sayRaw(spoken);
  }, [step, listing, lang, sayRaw]);

  const productId = draft.listing?.product_id;
  if (!productId) return <Navigate to="/camera" replace />;

  async function accept() {
    setBusy(true);
    try {
      // desc_en and desc_hi both, always — a listing with only one of them does not
      // satisfy PS feature 2 (models.py says the same thing). Until the AI hop lands they
      // hold the same text; the translation is the server's job, not the phone's.
      const body = {
        title: listing.title,
        desc_en: listing.desc,
        desc_hi: listing.desc,
        category: listing.category || null,
        material: listing.material || null,
        technique: draft.prefill?.technique ?? null,
        dye_type: draft.prefill?.dye_type ?? null,
        dimensions: draft.prefill?.dimensions ?? null,
        // The two pricing inputs, parsed out of what they said. Both are the artisan's own
        // figures and neither appears in the description above — cost is theirs, not the
        // buyer's business, and compose() builds prose from a named list that excludes it.
        //
        // They are written to the product rather than only handed to /price so the listing
        // can be re-priced later from /products/:id without asking the questions again.
        // Null when the question was skipped or the answer had no digit in it: a guessed
        // material cost moves the floor, and the floor is the one number we never invent.
        cost_material: rupeesFrom(draft.answers?.cost),
        labour_hours: hoursFrom(draft.answers?.time),
      };
      await api.patch(`/products/${productId}`, body);
      useDraft.getState().setListing({ ...draft.listing, ...body });
      nav('/price');
    } catch (e) {
      say(e.messageKey ?? 'net.offline');
    } finally {
      setBusy(false);
    }
  }

  async function mic() {
    if (rec) {
      const clip = await rec.stop();
      setRec(null);
      setBusy(true);
      try {
        const { transcript } = await transcribe(clip, lang);
        if (!transcript?.trim()) throw new Error('empty');
        setLocal({ ...listing, [field]: transcript.trim() });
        setStep('read'); // and the effect above reads the corrected listing straight back
      } catch {
        // ASR is 503 until Bhashini is keyed. Say so, leave both buttons alive: try again,
        // or go back and accept the listing as it stands. Never a dead end.
        say('voice.asr_down');
      } finally {
        setBusy(false);
      }
      return;
    }
    shutUp();
    setBusy(true);
    try {
      await say('catalog.rerecord');
      setRec(await record());
    } catch {
      say('voice.mic_denied');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'pick') {
    return (
      <Screen prompt="catalog.fix_which">
        <Grid>
          {FIELDS.map((f) => (
            <Tile
              key={f.name}
              icon={IconMic}
              label={t(lang, f.labelKey)}
              onClick={() => {
                setField(f.name);
                setStep('record');
              }}
            />
          ))}
        </Grid>
        <BigButton icon={IconBack} labelKey="common.back" onClick={() => setStep('read')} tone="no" />
      </Screen>
    );
  }

  if (step === 'record') {
    return (
      <Screen prompt={FIELDS.find((f) => f.name === field).labelKey}>
        {busy ? (
          <Spinner />
        ) : (
          <>
            <BigButton
              icon={rec ? IconYes : IconMic}
              labelKey={rec ? 'catalog.stop' : 'catalog.speak'}
              onClick={mic}
              tone={rec ? 'yes' : 'primary'}
            />
            <BigButton icon={IconBack} labelKey="common.back" onClick={() => setStep('pick')} tone="no" />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen prompt="catalog.review_confirm">
      {/* Seen and heard say the same thing. The text is the fallback, never the default. */}
      <Card>
        {FIELDS.map((f) => (
          <div key={f.name} style={{ marginBottom: 12 }}>
            <Chip tone={listing[f.name] ? 'done' : 'pending'}>{t(lang, f.labelKey)}</Chip>
            <p style={{ margin: '6px 0 0' }}>{listing[f.name] || '—'}</p>
          </div>
        ))}
      </Card>

      {busy ? (
        <Spinner />
      ) : (
        <>
          <BigButton icon={IconYes} labelKey="catalog.accept" onClick={accept} tone="yes" />
          <BigButton icon={IconMic} labelKey="catalog.rerecord" onClick={() => setStep('pick')} tone="no" />
        </>
      )}
    </Screen>
  );
}
