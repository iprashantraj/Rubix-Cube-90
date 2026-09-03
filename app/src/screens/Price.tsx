import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { Quote } from '../api/types';
import { api, ApiError } from '../api/client';
import { useDraft, useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { hoursFrom } from '../voice/numbers';
import { resolve, t } from '../i18n/index';
import { Screen, BigButton, Card, Chip, Spinner } from '../ui/kit';
import { IconYes, IconRetry, IconAlert } from '../ui/icons';

/**
 * /price — the dynamic pricing assistant. Spec §7.2, §7.3, PS feature 3.
 *
 * ── The floor is the entire point of this screen ────────────────────────────────────
 * The problem being solved here is not "artisans do not know the market rate". It is that
 * artisans routinely price below what the thing cost them to make, because their own labour
 * is the one input they were never taught to count. A middleman offers ₹1,800 for eleven
 * days of work and ₹800 of thread, and it gets accepted, because ₹1,800 feels like money
 * and the eleven days feel like Tuesday.
 *
 * So the floor is spoken, not shown. A red panel is a decoration to someone who cannot
 * read it; a sentence in their own language saying "at this price you will lose money, it
 * cost you two thousand one hundred and fifty six rupees to make" is the actual feature.
 * It is spoken on entry when the market itself sits below the floor, and again every
 * single time the artisan tries to press the price under it.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────────────
 * ai/price/compute.py, and deliberately no model: cost-up first (material + hours × the
 * cluster wage rate + margin), market comparables only ever move the suggestion UP, never
 * below cost. Every number survives "how did you get that?", which matters on a government
 * problem statement.
 *
 * MRP is not decoration either — GeM mandates a minimum discount off MRP, so the MRP is
 * set high enough that the price after that discount is still the price we meant. Moving
 * the price here keeps that ratio (see accept()), or we would recommend loss-making prices
 * on our headline channel.
 */

/** 10% steps, rounded to the nearest ten rupees. Fine-grained control is not the ask. */
const stepFor = (p: number) => Math.max(10, Math.round((p * 0.1) / 10) * 10);

export default function Price() {
  const nav = useNavigate();
  const { say, sayRaw, lang } = useVoice();
  const draft = useDraft();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [atFloor, setAtFloor] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);

  const productId = draft.listing?.product_id;

  // Read through getState() rather than closing over the draft: this must fire once per
  // product (and once per retry), not every time an unrelated part of the draft moves.
  useEffect(() => {
    if (!productId) return undefined;
    let alive = true;
    (async () => {
      const d = useDraft.getState();
      try {
        const res = await api.post('/price', {
          product_id: productId,
          // Set by the sixth cataloger question and written to the product at
          // /catalog/review. Still nullable: the artisan can skip the question, and a
          // fabricated material cost would move the floor — the one figure in this feature
          // that must never be guessed.
          material_cost: d.listing?.cost_material ?? null,
          // The product first, the draft second. /catalog/review already parsed and saved
          // both figures, and the draft's raw answers are gone once the flow ends — so a
          // product re-priced later from /products/:id has hours here rather than null.
          labour_hours: d.listing?.labour_hours ?? hoursFrom(d.answers?.time),
          cluster_id: useSession.getState().artisan?.cluster_id ?? null,
          category: d.listing?.category ?? null,
          // GeM has the strictest MRP maths of any channel, so price for it and every
          // other channel is safe by construction.
          channel: 'gem',
        });
        if (!alive) return;
        setQuote(res);
        setPrice(res.suggested_price);
        useDraft.getState().setPricing(res);
      } catch (e) {
        if (alive) setFailed((e as ApiError).messageKey ?? 'price.unavailable');
      }
    })();
    return () => {
      alive = false;
    };
  }, [productId, attempt]);

  // Spoken the moment the numbers land. breakdown_voice_hi is a sentence the service wrote
  // for exactly this — use it when it is in the artisan's language rather than reciting
  // three separate figures at them.
  useEffect(() => {
    if (!quote) return;
    /*
     * `resolve`, not `t`: this text is spoken, and a bundle that does not carry `price.*`
     * yet — Tamil and Bengali are drafted only along the photo-to-listing path — falls back
     * to ENGLISH text. Speaking English words through a Tamil voice is unintelligible in
     * both languages at once, which is the failure i18n/index.ts's own self-check exists to
     * catch. So the voice tag comes from whichever bundle actually answered.
     */
    const spoken =
      lang === 'hi' && quote.breakdown_voice_hi
        ? { text: quote.breakdown_voice_hi, lang: 'hi' as const }
        : resolve(lang, 'price.suggested', { price: quote.suggested_price });
    const parts = [spoken.text];
    // The market will not pay what this cost to make. That is not a detail to bury in a
    // panel — it is the one thing they need to hear before they agree to anything.
    if (quote.below_floor_warning) {
      // Same bundle as the line above, so it resolves to the same language; joined into one
      // utterance rather than two so the warning cannot be cut off by the first finishing.
      parts.push(resolve(lang, 'price.floor_warning', { floor: quote.floor }).text);
    }
    sayRaw(parts.join(' '), spoken.lang);
  }, [quote, lang, sayRaw]);

  if (!productId) return <Navigate to="/camera" replace />;

  function lower() {
    // Guard, not a cast: these handlers are only reachable from controls rendered after a
    // quote lands, but a null here would be a silent NaN on a price rather than a crash.
    if (price == null || quote == null) return;
    const next = price - stepFor(price);
    if (next < quote.floor) {
      // 🔒 The floor guard. It clamps AND it speaks — silently refusing to move would read
      // as a broken button, and moving silently would be us watching someone give their
      // work away. They can still price at the floor; below it, this screen says no.
      setPrice(quote.floor);
      setAtFloor(true);
      say('price.floor_warning', { floor: quote.floor });
      return;
    }
    setAtFloor(false);
    setPrice(next);
  }

  function raise() {
    if (price == null) return;
    setAtFloor(false);
    setPrice(price + stepFor(price));
  }

  async function accept() {
    if (price == null || quote == null) return;
    setBusy(true);
    try {
      // Keep the MRP ratio the service computed, so the GeM mandated discount still clears
      // the floor after the artisan has moved the price.
      const mrp = quote.suggested_price
        ? Math.round((price * quote.mrp) / quote.suggested_price)
        : price;
      // The floor goes with them. GeM's adapter re-checks it at publish time — after the
      // mandated discount — and it reads the value off the product, not out of this screen.
      await api.patch(`/products/${productId}`, { price, mrp, floor_price: quote.floor });
      useDraft.getState().setPricing({ ...quote, price, mrp });
      nav('/publish');
    } catch (e) {
      say((e as ApiError).messageKey ?? 'net.offline');
    } finally {
      setBusy(false);
    }
  }

  if (failed) {
    return (
      <Screen prompt={failed}>
        <BigButton
          icon={IconRetry}
          labelKey="common.retry"
          onClick={() => {
            setFailed(null);
            setAttempt((n) => n + 1);
          }}
        />
        {/* The AI service being down must not strand a finished listing. Publish blocks on
            the colour lock, not on the price — an unpriced product can be priced later
            from /products/:id, which is a far better outcome than a lost listing. */}
        <BigButton labelKey="price.skip" onClick={() => nav('/publish')} tone="no" />
      </Screen>
    );
  }

  if (!quote) {
    return (
      <Screen prompt="price.working">
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen prompt="price.title">
      <Card raised>
        <p style={{ fontSize: 44, fontWeight: 800, margin: 0, textAlign: 'center' }}>₹{price}</p>
      </Card>

      {/* One problem at a time: the floor warning is the only warning this screen can
          show, and it stays up for as long as the price is sitting on the floor. */}
      {(atFloor || quote.below_floor_warning) && (
        <p className="warn">
          <IconAlert size={22} aria-hidden />
          {t(lang, 'price.floor_warning', { floor: quote.floor })}
        </p>
      )}

      <Card>
        <Chip tone="done">{t(lang, 'price.material', { amount: quote.breakdown?.material ?? 0 })}</Chip>{' '}
        <Chip tone="done">{t(lang, 'price.labour', { amount: quote.breakdown?.labour ?? 0 })}</Chip>{' '}
        <Chip tone="done">{t(lang, 'price.margin', { amount: quote.breakdown?.margin ?? 0 })}</Chip>
        {quote.market_range && (
          <p style={{ margin: '10px 0 0' }}>
            {t(lang, 'price.market', {
              low: quote.market_range.low,
              high: quote.market_range.high,
            })}
          </p>
        )}
      </Card>

      {/* Three targets exactly: less, more, done. */}
      <div className="yesno">
        <BigButton labelKey="price.lower" onClick={lower} tone="no" disabled={busy} />
        <BigButton labelKey="price.raise" onClick={raise} tone="yes" disabled={busy} />
      </div>
      <BigButton icon={IconYes} labelKey="price.accept" onClick={accept} disabled={busy} />
    </Screen>
  );
}
