import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '../api/useApi.ts';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, Card, Chip, StatusDot } from '../ui/kit.jsx';
import { IconForward } from '../ui/icons.jsx';

/**
 * /orders — the unified inbox. Spec §5 row 21, backend `web/api/routers/orders.py`.
 *
 * If the artisan has to open Seller Central to find out they have an order, "virtual
 * business manager" is false advertising and the PS goes unanswered. So every channel's
 * orders land in one list, in one language, with one vocabulary of states — Beckn
 * callbacks, Amazon notifications and Flipkart webhooks all normalise to the same six
 * words before they reach this screen.
 *
 * ⚠️ GeM is honestly absent from that list. GeM has no order API; orders appear on the GeM
 * seller dashboard and nowhere else, and a cluster coordinator reconciles them in the
 * admin console. We do not fabricate a GeM row here. Stating the gap reads as maturity;
 * faking it is a question we could not survive on stage.
 *
 * The one thing this screen must never do is be quiet about a new order. A missed order is
 * a cancelled order, a cancelled order is a rating hit, and a rating hit is income. So the
 * NEW group is first, raised, and — the part that actually matters — the count is spoken
 * on entry, because our user does not scan a screen, they listen to it.
 */

/*
 * Newest-first inside each group is what the server already gives us; the grouping order
 * below is "what needs you now" -> "what is out of your hands" -> "what is over".
 * `placed` sits alone at the top because it is the only state that is an instruction.
 */
const GROUPS = [
  { state: 'placed', dot: 'error', labelKey: 'order.state.placed' },
  { state: 'packed', dot: 'pending', labelKey: 'order.state.packed' },
  { state: 'shipped', dot: 'pending', labelKey: 'order.state.shipped' },
  { state: 'delivered', dot: 'ready', labelKey: 'order.state.delivered' },
  { state: 'settled', dot: 'done', labelKey: 'order.state.settled' },
  { state: 'cancelled', dot: 'blocked', labelKey: 'order.state.cancelled' },
];

export default function Orders() {
  const nav = useNavigate();
  const { lang } = useVoice();
  const { data: orders, isPending, error } = useApiQuery('/orders');
  const errKey = error ? (error.messageKey ?? 'error.unknown') : null;

  // Cached, but on the shortest TTL in the app (60s — cache.js). An order that arrived
  // while the artisan was cataloguing matters within the minute, so this revalidates almost
  // every visit; what it buys is that the list is on screen while that happens instead of
  // a spinner standing between them and orders they already knew about.

  const fresh = orders?.filter((o) => o.state === 'placed').length ?? 0;

  /*
   * The prompt is the notification. `useSpeakOnEnter` re-fires when the KEY changes, so the
   * screen says "loading" and then, the moment the list lands, announces the new orders —
   * without us hand-rolling a second speak() call that could race the first.
   *
   * Two keys rather than one because "1 naye order" is wrong in Hindi and wrong in Odia,
   * and a business-critical sentence is not the place to accept a plural bug.
   */
  const prompt = errKey ?? (isPending
    ? 'common.loading'
    : orders.length === 0
      ? 'orders.empty'
      : fresh === 0
        ? 'orders.title'
        : fresh === 1
          ? 'orders.new_one'
          : 'orders.new_many');

  return (
    <Screen prompt={prompt} promptVars={{ count: fresh }} hero>
            {errKey && <p className="warn">{t(lang, errKey)}</p>}

      {orders?.length === 0 && (
        // An empty inbox is the normal state for a new artisan and must not read as a
        // failure — it reads as "your things are up, this is where the news will arrive".
        <Card>
          <p>{t(lang, 'orders.empty_help')}</p>
        </Card>
      )}

      {GROUPS.map((g) => {
        const rows = orders?.filter((o) => o.state === g.state) ?? [];
        if (rows.length === 0) return null;
        return (
          <Card key={g.state} raised={g.state === 'placed'}>
            <p style={{ margin: '0 0 10px' }}>
              <Chip tone={g.dot === 'error' ? 'error' : g.dot}>{t(lang, g.labelKey)}</Chip>
            </p>
            {rows.map((o) => (
              <button key={o.id} className="chan" onClick={() => nav(`/orders/${o.id}`)}>
                <StatusDot status={g.dot} />
                <span className="chan__name">
                  {t(lang, 'money.rupees', { amount: o.amount })}
                  <br />
                  <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                    {/* Channel name is raw — "Amazon" is a proper noun in every language we
                        ship, and translating it would make it unrecognisable. */}
                    {o.channel} · {t(lang, 'order.qty', { qty: o.quantity })}
                  </span>
                </span>
                <IconForward size={20} aria-hidden />
              </button>
            ))}
          </Card>
        );
      })}
    </Screen>
  );
}
