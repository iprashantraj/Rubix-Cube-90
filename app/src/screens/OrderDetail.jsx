import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, cachedGet } from '../api/client.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Spinner, YesNo, HelpButton } from '../ui/kit.jsx';
import { IconNext } from '../ui/icons.jsx';

/**
 * /orders/:id — one order, and the two taps it can need. Spec §5 row 22.
 *
 * An order has exactly one next physical action at any moment: pack it, hand it to the
 * courier, or confirm the money landed. So this screen shows ONE button, and which button
 * it is depends entirely on the state. A row of six state buttons would be six chances to
 * mark something shipped that is still on the floor — and a wrongly-shipped order is a
 * customer complaint the artisan has no way to answer.
 *
 * ⚠️ The state calls are QUERY parameters, not a JSON body. `POST /orders/{id}/state` takes
 * `state: OrderState` as a bare enum argument, which FastAPI reads off the query string;
 * posting `{state}` as a body gets a 422 and looks like a server bug. Same for
 * `payment-received?received=`. Do not "tidy" these into `api.post(path, { ... })`.
 *
 * Not built here, deliberately: the per-craft packing SOP video and the DPP-QR shipping
 * label from the spec row. Neither has an asset or an endpoint yet — a player pointed at
 * nothing is worse than an honest absence, and both drop in as one more card when the
 * media pipeline lands.
 */

/** placed -> packed -> shipped -> delivered. The end states have no next action. */
const NEXT = {
  placed: { state: 'packed', labelKey: 'order.mark_packed' },
  packed: { state: 'shipped', labelKey: 'order.mark_shipped' },
  shipped: { state: 'delivered', labelKey: 'order.mark_delivered' },
};

export default function OrderDetail() {
  const { id } = useParams();
  const { lang, say } = useVoice();

  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // No GET /orders/{id} exists — the inbox payload already carries every field this screen
  // renders, so we filter it rather than ask for a second endpoint that would repeat it.
  // The same cached `/orders` list the inbox rendered, so opening an order from it is free.
  //
  // ⚠️ `onUpdate` deliberately does NOT overwrite `order`. `advance()` and `confirmPayment()`
  // below write optimistically into this state, and a revalidation that landed a second
  // later would stamp the server's pre-mutation copy back over the change the artisan was
  // just told had worked. The mutation already invalidated the entry, so the next visit is
  // authoritative — that is the right place to correct this screen, not mid-tap.
  useEffect(() => {
    let alive = true;
    cachedGet('/orders').then(
      (list) => alive && setOrder(list.find((o) => o.id === id) ?? false),
      (e) => alive && setError(e.messageKey ?? 'error.unknown'),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  function fail(e) {
    const key = e.messageKey ?? 'error.unknown';
    setError(key);
    say(key); // spoken, always — a red English sentence is not an error message for our user
  }

  async function advance(next) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/orders/${id}/state?state=${next.state}`);
      setOrder((o) => ({ ...o, state: next.state }));
      say(`order.state.${next.state}`); // confirm the change aloud, never silently
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The "Paisa aaya?" tap (spec §11.3). We can see what a marketplace PROMISED to send. We
   * cannot see the artisan's bank account. One tap from thousands of artisans is what turns
   * that limitation into real settlement-delay evidence worth handing to the ministry — so
   * a "no" is as valuable as a "yes" here and is recorded just as deliberately.
   */
  async function confirmPayment(received) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/orders/${id}/payment-received?received=${received}`);
      setOrder((o) => ({ ...o, artisan_confirmed_payment: received }));
      say(received ? 'money.thanks' : 'money.not_yet');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const next = order ? NEXT[order.state] : null;
  // Ask about money only once it could plausibly have moved, and only once.
  const askMoney =
    order && ['delivered', 'settled'].includes(order.state) && !order.artisan_confirmed_payment;

  const prompt = error ?? (order == null
    ? 'common.loading'
    : order === false
      ? 'order.not_found'
      : askMoney
        ? 'money.confirm'
        : next
          ? next.labelKey
          : 'order.nothing_to_do');

  return (
    <Screen prompt={prompt} footer={<HelpButton />}>
      {order == null && !error && <Spinner label={t(lang, 'common.loading')} />}
      {error && <p className="warn">{t(lang, error)}</p>}

      {order && (
        <>
          <Card>
            <p style={{ margin: '0 0 8px', fontWeight: 700 }}>
              {t(lang, 'money.rupees', { amount: order.amount })}
            </p>
            <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
              {order.channel} · {t(lang, 'order.qty', { qty: order.quantity })}
            </p>
            <Chip tone={order.state === 'cancelled' ? 'blocked' : 'pending'}>
              {t(lang, `order.state.${order.state}`)}
            </Chip>
          </Card>

          {/*
            One problem at a time (design law §3 rule 4). When money is the open question it
            is the ONLY question — stacking a "mark shipped" button next to "did the money
            arrive?" is how both get answered wrong.
          */}
          {askMoney ? (
            <>
              <Card>
                <p style={{ margin: 0 }}>
                  {t(lang, 'money.sent', {
                    channel: order.channel,
                    amount: order.amount,
                    date: order.expected_settlement_date ?? t(lang, 'money.soon'),
                  })}
                </p>
              </Card>
              <YesNo
                onYes={() => confirmPayment(true)}
                onNo={() => confirmPayment(false)}
                disabled={busy}
              />
            </>
          ) : next ? (
            <BigButton
              icon={IconNext}
              labelKey={next.labelKey}
              onClick={() => advance(next)}
              disabled={busy}
            />
          ) : (
            <Card>
              <p style={{ margin: 0 }}>{t(lang, 'order.nothing_to_do')}</p>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
