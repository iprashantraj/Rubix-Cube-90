import { getOrders, rupees } from '@/lib/admin';

/** /admin/orders — orders across every channel, and the settlement gap.
 *
 *  🔑 The "Paid?" column is the point of this screen. We can see what a marketplace
 *  PROMISED; we cannot see the artisan's bank account. One tap in the app — "Paisa aaya?" —
 *  turns that limitation into real settlement-delay evidence, and it is shown here as
 *  three distinct states rather than collapsed into a yes/no, because "not asked" and
 *  "asked, money has not arrived" mean completely different things to a coordinator. */

const OPEN = ['placed', 'packed', 'shipped'];

export default async function Page() {
  const orders = await getOrders();
  const gmv = orders.filter((o) => o.state !== 'cancelled').reduce((s, o) => s + o.amount, 0);
  const unpaid = orders.filter((o) => o.artisan_confirmed_payment === false);
  const open = orders.filter((o) => OPEN.includes(o.state));

  return (
    <>
      <div className="head">
        <span className="eyebrow">Orders · all channels</span>
        <div>
          <h1>Orders</h1>
          <p>
            {rupees(gmv)} across {orders.length} orders · {open.length} still open ·
            {' '}{unpaid.length} where the marketplace says it paid and the artisan says it has
            not arrived.
          </p>
        </div>
      </div>

      {unpaid.length > 0 && (
        <div className="panel">
          <div className="ph">
            <h2>Settlement gap</h2>
            <span className="eyebrow">Promised, not arrived</span>
          </div>
          <table>
            <thead>
              <tr><th>Artisan</th><th>Channel</th><th>Product</th><th className="num-c">Amount</th><th>Expected</th></tr>
            </thead>
            <tbody>
              {unpaid.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.artisan}</b></td>
                  <td><span className="pill">{o.channel}</span></td>
                  <td>{o.product}<span className="sub2 mono">{o.external_order_id ?? o.id}</span></td>
                  <td className="num-c mono">{rupees(o.amount)}</td>
                  <td className="mono">{o.expected_settlement ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 14 }}>
            This is why the app says <b>&ldquo;Amazon ne ₹4,200 bheje hain&rdquo;</b> and never
            <b> &ldquo;aa gaye&rdquo;</b>. Across thousands of artisans these rows are the only honest
            dataset anyone has on how long marketplace settlement actually takes.
          </p>
        </div>
      )}

      <div className="panel">
        <div className="ph">
          <h2>All orders</h2>
          <span className="eyebrow">Newest first</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Order</th><th>Artisan</th><th>Channel</th><th className="num-c">Qty</th>
              <th className="num-c">Amount</th><th>State</th><th>Expected settlement</th><th>Paid?</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <b>{o.product}</b>
                  <span className="sub2 mono">{o.external_order_id ?? `internal · ${o.id}`}</span>
                </td>
                <td>{o.artisan}</td>
                <td><span className="pill">{o.channel}</span></td>
                <td className="num-c mono">{o.quantity}</td>
                <td className="num-c mono">{rupees(o.amount)}</td>
                <td><span className={`pill ${o.state}`}>{o.state}</span></td>
                <td className="mono">{o.expected_settlement ?? '—'}</td>
                <td>
                  {o.artisan_confirmed_payment === true && <span className="pill ok">arrived</span>}
                  {o.artisan_confirmed_payment === false && <span className="pill no">not yet</span>}
                  {o.artisan_confirmed_payment === null && <span className="sub2">not asked</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
