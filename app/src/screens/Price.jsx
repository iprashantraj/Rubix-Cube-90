import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useDraft, useSession } from '../store.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Spinner } from '../ui/kit.jsx';
import { IconYes, IconRetry, IconAlert } from '../ui/icons.jsx';

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
const stepFor = (p) => Math.max(10, Math.round((p * 0.1) / 10) * 10);

/**
 * Hours out of an answer like "gyarah din laga" or "12 hours".
 * ponytail: first-number-wins, so "eleven days" spelled out yields nothing and the service
 * falls back to its own default. Upgrade to a spoken-number/unit parser when the answers
 * from real users say it is worth it — a wrong number here is worse than no number.
 */
function hoursFrom(text) {
  const n = /(\d+(?:\.\d+)?)/.exec(text ?? '');
  return n ? Number(n[1]) : null;
}

export default function Price() {
  const nav = useNavigate();
  const { say, sayRaw, lang } = useVoice();
  const draft = useDraft();
  const [quote, setQuote] = useState(null);
  const [price, setPrice] = useState(null);
  const [atFloor, setAtFloor] = useState(false);
  const [failed, setFailed] = useState(null);
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
          // No question in the five asks what the materials cost (§6.3), so this is null
          // today and the service prices on labour alone. That understates the floor,
          // which is the wrong direction — worth a sixth question.
          material_cost: d.listing?.cost_material ?? null,
          labour_hours: hoursFrom(d.answers?.time),
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
        if (alive) setFailed(e.messageKey ?? 'price.unavailable');
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
    const parts = [
      lang === 'hi' && quote.breakdown_voice_hi
        ? quote.breakdown_voice_hi
        : t(lang, 'price.suggested', { price: quote.suggested_price }),
    ];
    // The market will not pay what this cost to make. That is not a detail to bury in a
    // panel — it is the one thing they need to hear before they agree to anything.
    if (quote.below_floor_warning) parts.push(t(lang, 'price.floor_warning', { floor: quote.floor }));
    sayRaw(parts.join(' '));
  }, [quote, lang, sayRaw]);

  if (!productId) return <Navigate to="/camera" replace />;

  function lower() {
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
    setAtFloor(false);
    setPrice(price + stepFor(price));
  }

  async function accept() {
    setBusy(true);
    try {
      // Keep the MRP ratio the service computed, so the GeM mandated discount still clears
      // the floor after the artisan has moved the price.
      const mrp = quote.suggested_price
        ? Math.round((price * quote.mrp) / quote.suggested_price)
        : price;
      await api.patch(`/products/${productId}`, { price, mrp });
      useDraft.getState().setPricing({ ...quote, price, mrp });
      nav('/publish');
    } catch (e) {
      say(e.messageKey ?? 'net.offline');
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
