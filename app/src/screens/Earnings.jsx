import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useVoice } from '../voice/useVoice.js';
import { t, bcp47 } from '../i18n/index.js';
import { Screen, Card, Chip, Spinner, YesNo, HelpButton } from '../ui/kit.jsx';

/**
 * /earnings — money. Spec §5 row 23, §11.3.
 *
 * 🔑 The sentence this whole screen is built around: **"Amazon ne ₹4,200 bheje hain."**
 * Never "aa gaye". We can see what a marketplace says it has settled. We cannot see the
 * artisan's bank account, and pretending otherwise is how someone spends money that has
 * not arrived. So the screen has two columns and they are never merged:
 *
 *   bheje hain   what a channel reports it has sent  -> our data, unverified by the artisan
 *   aa gaye      what the artisan confirmed landed   -> their data, the only truth here
 *
 * The gap between those two numbers is the product. Aggregated across thousands of
 * artisans it is real, first-hand settlement-delay evidence — the kind of thing a ministry
 * cannot get from the marketplaces themselves — and it costs one tap per order to collect.
 *
 * Which is why the "Paisa aaya?" question is asked ONE order at a time. A list of six
 * yes/no rows is six chances to tap the wrong one, and design law rule 4 says one problem
 * at a time anyway. Oldest first: the payment that is most overdue is the one worth asking
 * about, and it is the one the artisan is already worried about.
 */
export default function Earnings() {
  const { lang, say } = useVoice();
  const [orders, setOrders] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/orders').then(setOrders, (e) => setError(e.messageKey ?? 'error.unknown'));
  }, []);

  const rows = orders ?? [];
  // "Sent" means the channel has settled or the goods are delivered and settlement is due.
  // Anything earlier than that is work in progress, not money, and is not counted — an
  // inflated total that later shrinks destroys trust faster than a small honest one.
  const sent = rows.filter((o) => ['delivered', 'settled'].includes(o.state));
  const confirmed = sent.filter((o) => o.artisan_confirmed_payment);
  const awaiting = sent.filter((o) => !o.artisan_confirmed_payment);
  const sum = (list) => list.reduce((n, o) => n + o.amount, 0);

  // `GET /orders` is newest-first, so the last unconfirmed row is the oldest one.
  const ask = awaiting[awaiting.length - 1];

  async function confirmPayment(received) {
    setBusy(true);
    setError(null);
    try {
      // Query params, not a body — see the note in OrderDetail.jsx.
      await api.post(`/orders/${ask.id}/payment-received?received=${received}`);
      // Optimistic local update rather than a refetch: the next unanswered order should
      // appear immediately, so the artisan can clear three of them in a row without the
      // screen blanking to a spinner between each.
      setOrders((list) =>
        list.map((o) => (o.id === ask.id ? { ...o, artisan_confirmed_payment: received } : o)),
      );
      say(received ? 'money.thanks' : 'money.not_yet');
    } catch (e) {
      const key = e.messageKey ?? 'error.unknown';
      setError(key);
      say(key);
    } finally {
      setBusy(false);
    }
  }

  const prompt = error ?? (orders == null
    ? 'common.loading'
    : sent.length === 0
      ? 'earnings.empty'
      : ask
        ? 'money.confirm'
        : 'earnings.title');

  /*
   * A settlement date we do not have is spoken as "soon", never as a blank or a dash. A
   * gap in a spoken sentence is heard as a mistake in the app.
   */
  const when = ask?.expected_settlement_date
    ? new Date(ask.expected_settlement_date).toLocaleDateString(bcp47(lang), {
        day: 'numeric',
        month: 'long',
      })
    : t(lang, 'money.soon');

  return (
    <Screen prompt={prompt} hero footer={<HelpButton />}>
      {orders == null && !error && <Spinner label={t(lang, 'common.loading')} />}
      {error && <p className="warn">{t(lang, error)}</p>}

      {orders != null && (
        <Card raised>
          {/* The two numbers, never added together. */}
          <p style={{ margin: '0 0 6px' }}>
            <Chip tone="pending">{t(lang, 'earnings.on_the_way')}</Chip>
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 30, fontWeight: 800 }}>
            {t(lang, 'money.rupees', { amount: sum(awaiting) })}
          </p>
          <p style={{ margin: '0 0 6px' }}>
            <Chip tone="done">{t(lang, 'earnings.received')}</Chip>
          </p>
          <p style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>
            {t(lang, 'money.rupees', { amount: sum(confirmed) })}
          </p>
        </Card>
      )}

      {orders != null && sent.length === 0 && (
        <Card>
          <p style={{ margin: 0 }}>{t(lang, 'earnings.empty_help')}</p>
        </Card>
      )}

      {ask && (
        <>
          <Card>
            <p style={{ margin: 0 }}>
              {/* "bheje hain", not "aa gaye". The verb is the whole point of this screen. */}
              {t(lang, 'money.sent', { channel: ask.channel, amount: ask.amount, date: when })}
            </p>
          </Card>
          <YesNo onYes={() => confirmPayment(true)} onNo={() => confirmPayment(false)} disabled={busy} />
        </>
      )}

      {orders != null && sent.length > 0 && !ask && (
        <Card>
          <p style={{ margin: 0 }}>{t(lang, 'earnings.all_confirmed')}</p>
        </Card>
      )}
    </Screen>
  );
}
